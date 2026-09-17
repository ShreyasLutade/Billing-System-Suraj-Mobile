import { Router } from "express";
import multer from "multer";
import fs from "fs";
import { z } from "zod";
import { runBillingReport, runScheduledReports } from "../services/dailyReports";
import { getReportMailConfig } from "../services/reportEmail";
import {
  PURGE_CONFIRM,
  purgeOperationalData,
} from "../services/purgeOperationalData";
import {
  RENUMBER_SHOP_CONFIRM,
  renumberShopBillsFrom3000,
} from "../services/renumberShopBills";
import { prisma } from "../lib/prisma";
import {
  RESTORE_DB_CONFIRM,
  emailSqliteBackup,
  getSqliteFilePath,
  isSqliteDatabaseUrl,
  restoreSqliteFromBuffer,
} from "../services/sqliteBackup";
import {
  buildBackupZipBuffer,
  extractSqliteBackupBuffer,
} from "../services/backupBundle";

export const reportsRouter = Router();

const sendSchema = z.object({
  scope: z.enum(["today", "all"]).default("today"),
  force: z.boolean().optional().default(false),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
});

reportsRouter.post("/send", async (req, res, next) => {
  try {
    const parsed = sendSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { report, mail, skipped, dateKey, dbFilename, dbBytes } =
      await runBillingReport(parsed.data.scope, { force: parsed.data.force });

    if (skipped || !report || !mail) {
      res.json({
        data: {
          skipped: true,
          scope: parsed.data.scope,
          dateKey,
          message: `Report already sent for ${dateKey} (IST). Pass force:true to resend.`,
        },
      });
      return;
    }

    res.json({
      data: {
        skipped: false,
        scope: report.scope,
        filename: report.filename,
        billCount: report.billCount,
        dateLabel: report.dateLabel,
        emailedTo: mail.to,
        subject: mail.subject,
        messageId: mail.messageId,
        dateKey,
        dbFilename,
        dbBytes,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Admin: email a fresh SQLite .db snapshot (GCP free-stack backups). */
reportsRouter.post("/backup-db", async (req, res, next) => {
  try {
    const force = Boolean(req.body?.force);
    const result = await emailSqliteBackup({ force });
    res.json({
      data: {
        filename: result.snapshot.filename,
        bytes: result.snapshot.bytes,
        dateKey: result.snapshot.dateKey,
        emailedTo: result.mail.to,
        messageId: result.mail.messageId,
      },
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get("/backup-status", async (_req, res, next) => {
  try {
    const sqlite = isSqliteDatabaseUrl();
    let bytes: number | null = null;
    if (sqlite) {
      try {
        const dbPath = getSqliteFilePath();
        bytes = fs.statSync(dbPath).size;
      } catch {
        bytes = null;
      }
    }
    res.json({
      data: {
        sqlite,
        canRestore: sqlite,
        approxDbBytes: bytes,
        confirmPhrase: RESTORE_DB_CONFIRM,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Admin-only: download a zip with full Excel report + live SQLite .db snapshot.
 */
reportsRouter.get("/download-backup-zip", async (_req, res, next) => {
  try {
    const bundle = await buildBackupZipBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${bundle.filename}"`,
    );
    res.setHeader("Content-Length", String(bundle.bytes));
    if (bundle.dbFilename) {
      res.setHeader("X-Db-Filename", bundle.dbFilename);
    }
    res.setHeader("X-Excel-Filename", bundle.excelFilename);
    res.send(bundle.buffer);
  } catch (error) {
    next(error);
  }
});

/**
 * Admin-only: upload a Suraj Mobile .db (or backup .zip) and replace the live SQLite file.
 * Server restarts shortly after so Prisma opens the restored database.
 */
reportsRouter.post(
  "/restore-db",
  upload.single("database"),
  async (req, res, next) => {
    try {
      const confirm =
        typeof req.body?.confirm === "string" ? req.body.confirm.trim() : "";
      if (confirm !== RESTORE_DB_CONFIRM) {
        res.status(400).json({
          error: `Type confirm: "${RESTORE_DB_CONFIRM}" to restore`,
        });
        return;
      }

      if (!req.file?.buffer?.length) {
        res.status(400).json({
          error: "Choose a .db or backup .zip file to upload",
        });
        return;
      }

      const dbBuffer = await extractSqliteBackupBuffer(
        req.file.buffer,
        req.file.originalname || "",
      );
      const result = await restoreSqliteFromBuffer(dbBuffer);
      res.json({
        data: {
          ok: true,
          bytes: result.bytes,
          restoredPath: result.restoredPath,
          previousBackupPath: result.previousBackupPath || null,
          restarting: true,
          message:
            "Database restored. Server is restarting — refresh the page in a few seconds.",
        },
      });

      setTimeout(() => {
        console.log(
          "[backup] Exiting after SQLite restore so the process restarts",
        );
        process.exit(0);
      }, 750);
    } catch (error) {
      next(error);
    }
  },
);

const purgeSchema = z.object({
  confirm: z.literal(PURGE_CONFIRM),
  apply: z.boolean().optional().default(false),
});

/** Admin-only: keep GST bills + shop 0014/0031/0032; wipe other bills/stock/suppliers. */
reportsRouter.post("/purge-operational-data", async (req, res, next) => {
  try {
    const parsed = purgeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: `Send confirm: "${PURGE_CONFIRM}"`,
        details: parsed.error.flatten(),
      });
      return;
    }
    const data = await purgeOperationalData(prisma, {
      apply: parsed.data.apply,
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

const renumberSchema = z.object({
  confirm: z.literal(RENUMBER_SHOP_CONFIRM),
  apply: z.boolean().optional().default(false),
});

/** Admin-only: shop bills 3000+; sequence set so the next shop bill is 3004. */
reportsRouter.post("/renumber-shop-bills", async (req, res, next) => {
  try {
    const parsed = renumberSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: `Send confirm: "${RENUMBER_SHOP_CONFIRM}"`,
        details: parsed.error.flatten(),
      });
      return;
    }
    const data = await renumberShopBillsFrom3000(prisma, {
      apply: parsed.data.apply,
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

/**
 * Railway Cron / external scheduler endpoint.
 * Auth: Authorization: Bearer <REPORT_CRON_SECRET> or x-cron-secret header.
 * Mounted without JWT so Railway Cron Jobs can call it.
 */
export const reportsCronRouter = Router();

function cronSecretOk(req: { headers: Record<string, unknown> }) {
  const expected = (process.env.REPORT_CRON_SECRET || "").trim();
  if (!expected) return false;
  const header =
    (typeof req.headers["x-cron-secret"] === "string"
      ? req.headers["x-cron-secret"]
      : "") || "";
  const auth =
    typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  return header === expected || bearer === expected;
}

reportsCronRouter.post("/run", async (req, res, next) => {
  try {
    if (!cronSecretOk(req)) {
      res.status(401).json({
        error:
          "Unauthorized. Set REPORT_CRON_SECRET and pass it as Bearer token or x-cron-secret header.",
      });
      return;
    }

    const { configured } = getReportMailConfig();
    if (!configured) {
      res.status(503).json({
        error: "SMTP is not configured on this deployment",
      });
      return;
    }

    const force =
      req.body?.force === true ||
      req.query.force === "1" ||
      req.query.force === "true";

    const results = await runScheduledReports({ force });
    res.json({
      data: {
        ok: true,
        skippedDay: Boolean(results.skippedDay),
        fullDump: results.all
          ? {
              skipped: results.all.skipped,
              dateKey: results.all.dateKey,
              billCount: results.all.report?.billCount ?? null,
              emailedTo: results.all.mail?.to ?? null,
              dbFilename: results.all.dbFilename ?? null,
              dbBytes: results.all.dbBytes ?? null,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
});
