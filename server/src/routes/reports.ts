import { Router } from "express";
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

export const reportsRouter = Router();

const sendSchema = z.object({
  scope: z.enum(["today", "all"]).default("today"),
  force: z.boolean().optional().default(false),
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

    const { report, mail, skipped, dateKey } = await runBillingReport(
      parsed.data.scope,
      { force: parsed.data.force },
    );

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
      },
    });
  } catch (error) {
    next(error);
  }
});

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
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
});
