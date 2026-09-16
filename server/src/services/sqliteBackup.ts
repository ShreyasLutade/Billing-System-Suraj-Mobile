import fs from "fs";
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

function cleanEnv(value: string | undefined) {
  return (value || "").trim();
}

function databaseFilePath() {
  const url = cleanEnv(process.env.DATABASE_URL) || "file:./dev.db";
  if (!url.startsWith("file:")) return null;
  const raw = url.slice("file:".length);
  return path.isAbsolute(raw)
    ? raw
    : path.resolve(process.cwd(), raw);
}

function backupDirFor(dbFile: string) {
  const configured = cleanEnv(process.env.BACKUP_DB_DIR);
  if (configured) return configured;
  return path.join(path.dirname(dbFile), "backups");
}

/** Checkpoint WAL then snapshot the SQLite file for email / disk retention. */
export async function createSqliteBackupSnapshot() {
  const dbFile = databaseFilePath();
  if (!dbFile || !fs.existsSync(dbFile)) {
    throw new Error(`SQLite database not found (${dbFile || "unset"})`);
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

  const dest = path.join(dir, `suraj-${stamp}.db`);
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
      if (!name.startsWith("suraj-")) continue;
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

export async function emailSqliteBackup(options: { force?: boolean } = {}) {
  const { configured, to } = getReportMailConfig();
  if (!configured || !to) {
    throw new Error("Email is not configured for DB backup");
  }

  const snapshot = await createSqliteBackupSnapshot();
  const shop = process.env.SHOP_NAME || "Suraj Mobile";
  const subject = `${shop} — SQLite backup (${snapshot.dateKey})`;
  const text = [
    `${shop} database backup`,
    `Date (IST): ${snapshot.dateKey}`,
    `File: ${snapshot.filename}`,
    `Size: ${(snapshot.bytes / (1024 * 1024)).toFixed(2)} MB`,
    "",
    "Keep this email. To restore: stop the API, replace /data/suraj.db with this file, start again.",
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
