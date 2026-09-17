import JSZip from "jszip";
import { istDateString } from "../lib/ist";
import { buildReportWorkbook } from "./reportExcel";
import {
  assertSqliteFile,
  createSqliteBackupBuffer,
  isSqliteDatabaseUrl,
} from "./sqliteBackup";

/**
 * Build a downloadable zip: full Excel report + SQLite .db snapshot (when available).
 */
export async function buildBackupZipBuffer(): Promise<{
  buffer: Buffer;
  filename: string;
  excelFilename: string;
  dbFilename: string | null;
  bytes: number;
}> {
  const report = await buildReportWorkbook("all");
  const zip = new JSZip();
  zip.file(report.filename, report.buffer);

  let dbFilename: string | null = null;
  if (isSqliteDatabaseUrl()) {
    const db = await createSqliteBackupBuffer();
    zip.file(db.filename, db.buffer);
    dbFilename = db.filename;
  }

  const buffer = Buffer.from(
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    }),
  );

  const filename = `SurajMobile-Backup-${istDateString()}.zip`;
  return {
    buffer,
    filename,
    excelFilename: report.filename,
    dbFilename,
    bytes: buffer.length,
  };
}

/** Accept a raw .db or a zip that contains a .db (from local backup download). */
export async function extractSqliteBackupBuffer(
  buffer: Buffer,
  originalName = "",
): Promise<Buffer> {
  const name = originalName.toLowerCase();
  const looksZip =
    name.endsWith(".zip") ||
    (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b);

  if (!looksZip) {
    assertSqliteFile(buffer);
    return buffer;
  }

  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".db"),
  );
  if (!entries.length) {
    throw new Error(
      "Zip has no .db file. Use a Suraj Mobile backup zip or a raw .db file.",
    );
  }

  // Prefer root-level / Suraj-named db if several exist.
  entries.sort((a, b) => {
    const aScore =
      (a.name.toLowerCase().includes("suraj") ? 0 : 1) +
      (a.name.includes("/") || a.name.includes("\\") ? 1 : 0);
    const bScore =
      (b.name.toLowerCase().includes("suraj") ? 0 : 1) +
      (b.name.includes("/") || b.name.includes("\\") ? 1 : 0);
    return aScore - bScore || a.name.localeCompare(b.name);
  });

  const dbBuffer = Buffer.from(await entries[0]!.async("nodebuffer"));
  assertSqliteFile(dbBuffer);
  return dbBuffer;
}
