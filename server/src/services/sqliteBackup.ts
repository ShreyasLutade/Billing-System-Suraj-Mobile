import fs from "fs";
import os from "os";
import path from "path";
import { prisma } from "../lib/prisma";
import { istDateString } from "../lib/ist";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0");

/** Confirm phrase required for destructive DB restore. */
export const RESTORE_DB_CONFIRM = "RESTORE DATABASE";

export function isSqliteDatabaseUrl(url = process.env.DATABASE_URL || "") {
  return url.trim().toLowerCase().startsWith("file:");
}

/**
 * Resolve the on-disk SQLite path from DATABASE_URL.
 * Prisma resolves relative `file:` paths against the schema directory (`prisma/`).
 */
export function getSqliteFilePath(url = process.env.DATABASE_URL || ""): string {
  const raw = url.trim();
  if (!raw.toLowerCase().startsWith("file:")) {
    throw new Error(
      "SQLite backup/restore requires DATABASE_URL starting with file:",
    );
  }

  let filePart = raw.slice("file:".length);
  // file:///C:/path or file:///absolute
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

  return path.resolve(process.cwd(), "prisma", filePart);
}

export function assertSqliteFile(buffer: Buffer) {
  if (buffer.length < 100) {
    throw new Error("Uploaded file is too small to be a SQLite database");
  }
  if (!buffer.subarray(0, 16).equals(SQLITE_HEADER)) {
    throw new Error(
      "Uploaded file is not a SQLite database (.db). Use a Suraj Mobile backup .db file.",
    );
  }
}

function escapeSqliteLiteral(value: string) {
  return value.replace(/'/g, "''");
}

/**
 * Consistent on-disk snapshot via SQLite VACUUM INTO (safe while the app runs).
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
  const filename = `suraj-mobile-backup-${dateKey}.db`;
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
  } finally {
    await fs.promises.unlink(tempPath).catch(() => undefined);
  }
}

function sidecarPaths(dbPath: string) {
  return [`${dbPath}-wal`, `${dbPath}-shm`];
}

async function removeSidecars(dbPath: string) {
  for (const side of sidecarPaths(dbPath)) {
    await fs.promises.unlink(side).catch(() => undefined);
  }
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
  const previousBackupPath = path.join(
    dir,
    `suraj.pre-restore-${stamp}.db`,
  );
  const incomingPath = path.join(dir, `suraj.incoming-${stamp}.db`);

  await fs.promises.writeFile(incomingPath, buffer);

  try {
    // Flush WAL so the main file is complete before we move it aside.
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
