import fs from "fs";
import os from "os";
import path from "path";
import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { IST_TIMEZONE, istDateString } from "../lib/ist";
import {
  getReportMailConfig,
  sendRawEmailWithAttachments,
} from "./reportEmail";

let started = false;

const DEFAULT_BACKUP_CRON = "30 23 * * *";
const SQLITE_HEADER = Buffer.from("SQLite format 3\0");

/** Confirm phrase required for destructive DB restore. */
export const RESTORE_DB_CONFIRM = "RESTORE DATABASE";

function cleanEnv(value: string | undefined) {
  return (value || "").trim();
}

export function isSqliteDatabaseUrl(url = process.env.DATABASE_URL || "") {
  return url.trim().toLowerCase().startsWith("file:");
}

/**
 * Resolve the on-disk SQLite path from DATABASE_URL.
 * Absolute paths (GCP `file:/data/suraj.db`) win; relative paths try `prisma/` then cwd.
 */
export function getSqliteFilePath(url = process.env.DATABASE_URL || ""): string {
  const raw = cleanEnv(url) || "file:./dev.db";
  if (!raw.toLowerCase().startsWith("file:")) {
    throw new Error(
      "SQLite backup/restore requires DATABASE_URL starting with file:",
    );
  }

  let filePart = raw.slice("file:".length);
  if (filePart.startsWith("///")) {
    filePart = filePart.slice(2);
    if (/^\/[A-Za-z]:/.test(filePart)) {
      filePart = filePart.slice(1);
    }
  } else if (filePart.startsWith("//localhost/")) {
    filePart = filePart.slice("//localhost".length);
  }

  if (path.isAbsolute(filePart)) {
    return path.normalize(filePart);
  }

  const prismaPath = path.resolve(process.cwd(), "prisma", filePart);
  const cwdPath = path.resolve(process.cwd(), filePart);
  if (fs.existsSync(prismaPath)) return prismaPath;
  if (fs.existsSync(cwdPath)) return cwdPath;
  return prismaPath;
}

function backupDirFor(dbFile: string) {
  const configured = cleanEnv(process.env.BACKUP_DB_DIR);
  if (configured) return configured;
  return path.join(path.dirname(dbFile), "backups");
}

export function assertSqliteFile(buffer: Buffer) {
  if (buffer.length < 100) {
    throw new Error("Uploaded file is too small to be a SQLite database");
  }
  if (!buffer.subarray(0, 16).equals(SQLITE_HEADER)) {
    throw new Error(
      "Uploaded file is not a SQLite database (.db). Use a Smart Billing backup .db file.",
    );
  }
}

function escapeSqliteLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function sidecarPaths(dbPath: string) {
  return [`${dbPath}-wal`, `${dbPath}-shm`];
}

async function removeSidecars(dbPath: string) {
  for (const side of sidecarPaths(dbPath)) {
    await fs.promises.unlink(side).catch(() => undefined);
  }
}

/** Checkpoint WAL then snapshot the SQLite file for email / disk retention. */
export async function createSqliteBackupSnapshot() {
  const dbFile = getSqliteFilePath();
  if (!fs.existsSync(dbFile)) {
    throw new Error(`SQLite database not found (${dbFile})`);
  }

  try {
    await prisma.$executeRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE);`);
  } catch (error) {
    console.warn("[backup] WAL checkpoint skipped:", error);
  }

  const dir = backupDirFor(dbFile);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(", ", "_")
    .replace(/:/g, "");

  const dest = path.join(dir, `smart-billing-${stamp}.db`);
  fs.copyFileSync(dbFile, dest);
  for (const extra of [`${dbFile}-wal`, `${dbFile}-shm`]) {
    if (fs.existsSync(extra)) {
      fs.copyFileSync(extra, `${dest}${extra.slice(dbFile.length)}`);
    }
  }

  const keepDays = Number(cleanEnv(process.env.BACKUP_DB_KEEP_DAYS) || "14");
  if (Number.isFinite(keepDays) && keepDays > 0) {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith("smart-billing-") && !name.startsWith("suraj-")) continue;
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        /* ignore */
      }
    }
  }

  const buffer = fs.readFileSync(dest);
  return {
    filePath: dest,
    filename: path.basename(dest),
    buffer,
    bytes: buffer.length,
    dateKey: istDateString(),
  };
}

/**
 * Consistent snapshot via SQLite VACUUM INTO (preferred for report email attach).
 * Falls back to file copy if VACUUM INTO is unavailable.
 */
export async function createSqliteBackupBuffer(): Promise<{
  buffer: Buffer;
  filename: string;
  bytes: number;
  sourcePath: string;
}> {
  if (!isSqliteDatabaseUrl()) {
    throw new Error(
      "Database backup (.db) is only available when using SQLite (DATABASE_URL=file:...)",
    );
  }

  const sourcePath = getSqliteFilePath();
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite database file not found at ${sourcePath}`);
  }

  const dateKey = istDateString();
  const filename = `smart-billing-backup-${dateKey}.db`;
  const tempPath = path.join(
    os.tmpdir(),
    `suraj-vacuum-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

  try {
    await prisma.$executeRawUnsafe(
      `VACUUM INTO '${escapeSqliteLiteral(tempPath)}'`,
    );
    const buffer = await fs.promises.readFile(tempPath);
    assertSqliteFile(buffer);
    return {
      buffer,
      filename,
      bytes: buffer.length,
      sourcePath,
    };
  } catch (error) {
    console.warn(
      "[backup] VACUUM INTO failed, falling back to file snapshot:",
      error,
    );
    const snapshot = await createSqliteBackupSnapshot();
    return {
      buffer: snapshot.buffer,
      filename,
      bytes: snapshot.bytes,
      sourcePath,
    };
  } finally {
    await fs.promises.unlink(tempPath).catch(() => undefined);
  }
}

export async function emailSqliteBackup(options: { force?: boolean } = {}) {
  const { configured, to } = getReportMailConfig();
  if (!configured || !to) {
    throw new Error("Email is not configured for DB backup");
  }

  const snapshot = await createSqliteBackupSnapshot();
  const shop = process.env.SHOP_NAME || "Smart Billing";
  const subject = `${shop} — SQLite backup (${snapshot.dateKey})`;
  const text = [
    `${shop} database backup`,
    `Date (IST): ${snapshot.dateKey}`,
    `File: ${snapshot.filename}`,
    `Size: ${(snapshot.bytes / (1024 * 1024)).toFixed(2)} MB`,
    "",
    "Keep this email. To restore: open Backup on the website, upload this .db, and confirm RESTORE DATABASE.",
    "Or stop the API, replace /data/suraj.db with this file, and start again.",
  ].join("\n");

  const mail = await sendRawEmailWithAttachments({
    subject,
    text,
    attachments: [
      {
        filename: snapshot.filename,
        content: snapshot.buffer,
        contentType: "application/x-sqlite3",
      },
    ],
  });

  console.log(
    `[backup] Emailed SQLite snapshot ${snapshot.filename} → ${to}${options.force ? " (force)" : ""}`,
  );
  return { snapshot, mail };
}

export function startSqliteBackupScheduler() {
  if (started) return;
  started = true;

  const enabled =
    (process.env.BACKUP_DB_CRON_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) {
    console.log("[backup] SQLite email backup cron disabled");
    return;
  }

  const { configured } = getReportMailConfig();
  if (!configured) {
    console.warn(
      "[backup] SQLite email backup not started — configure REPORT_EMAIL_TO + Resend/SMTP",
    );
    return;
  }

  const expression = process.env.BACKUP_DB_CRON || DEFAULT_BACKUP_CRON;
  if (!cron.validate(expression)) {
    console.error(`[backup] Invalid BACKUP_DB_CRON: ${expression}`);
    return;
  }

  cron.schedule(
    expression,
    () => {
      void emailSqliteBackup().catch((error) => {
        console.error("[backup] SQLite email backup failed:", error);
      });
    },
    { timezone: IST_TIMEZONE },
  );

  console.log(
    `[backup] SQLite email backup scheduled (${expression} ${IST_TIMEZONE})`,
  );
}

/**
 * Replace the live SQLite file with an uploaded backup.
 * Caller should restart the process after a successful response so Prisma reconnects cleanly.
 */
export async function restoreSqliteFromBuffer(buffer: Buffer): Promise<{
  restoredPath: string;
  previousBackupPath: string;
  bytes: number;
}> {
  assertSqliteFile(buffer);

  if (!isSqliteDatabaseUrl()) {
    throw new Error(
      "Database restore is only available when using SQLite (DATABASE_URL=file:...)",
    );
  }

  const livePath = getSqliteFilePath();
  const dir = path.dirname(livePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const previousBackupPath = path.join(dir, `suraj.pre-restore-${stamp}.db`);
  const incomingPath = path.join(dir, `suraj.incoming-${stamp}.db`);

  await fs.promises.writeFile(incomingPath, buffer);

  try {
    try {
      await prisma.$executeRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE)`);
    } catch {
      // Ignore if DB is not in WAL mode or checkpoint fails.
    }

    await prisma.$disconnect();

    if (fs.existsSync(livePath)) {
      await fs.promises.copyFile(livePath, previousBackupPath);
    }

    await removeSidecars(livePath);
    await fs.promises.rename(incomingPath, livePath);
    await removeSidecars(livePath);

    return {
      restoredPath: livePath,
      previousBackupPath: fs.existsSync(previousBackupPath)
        ? previousBackupPath
        : "",
      bytes: buffer.length,
    };
  } catch (error) {
    await fs.promises.unlink(incomingPath).catch(() => undefined);
    throw error;
  }
}
