import cron from "node-cron";
import { prisma } from "../lib/prisma";
import {
  IST_TIMEZONE,
  istDateString,
  isReportDayIST,
} from "../lib/ist";
import { buildReportWorkbook, type ReportScope } from "./reportExcel";
import {
  getReportMailConfig,
  sendReportEmail,
  verifyReportSmtp,
} from "./reportEmail";

let started = false;

/** Default: 11:00 PM IST on Wednesday and Sunday. */
const DEFAULT_REPORT_CRON = "0 23 * * 0,3";

function cronHourMinute() {
  const expression = process.env.REPORT_CRON || DEFAULT_REPORT_CRON;
  const parts = expression.trim().split(/\s+/);
  // node-cron: minute hour …
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  return {
    hour: Number.isFinite(hour) ? hour : 23,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function istNowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || "0");
  return { hour: get("hour"), minute: get("minute") };
}

/** True once IST clock is at/after the configured REPORT_CRON time. */
export function isPastReportCronTime(date = new Date()) {
  const target = cronHourMinute();
  const now = istNowParts(date);
  return (
    now.hour > target.hour ||
    (now.hour === target.hour && now.minute >= target.minute)
  );
}

async function alreadySent(scope: ReportScope, dateKey: string) {
  const existing = await prisma.reportSendLog.findUnique({
    where: { scope_dateKey: { scope, dateKey } },
  });
  return Boolean(existing);
}

async function markSent(
  scope: ReportScope,
  dateKey: string,
  messageId?: string | null,
  toEmail?: string | null,
) {
  await prisma.reportSendLog.upsert({
    where: { scope_dateKey: { scope, dateKey } },
    create: {
      scope,
      dateKey,
      messageId: messageId || null,
      toEmail: toEmail || null,
    },
    update: {
      sentAt: new Date(),
      messageId: messageId || null,
      toEmail: toEmail || null,
    },
  });
}

export async function runBillingReport(
  scope: ReportScope,
  options: { force?: boolean } = {},
) {
  const dateKey = istDateString();
  if (!options.force && (await alreadySent(scope, dateKey))) {
    console.log(
      `[reports] Skipping ${scope} — already sent for ${dateKey} (IST)`,
    );
    return {
      report: null as Awaited<ReturnType<typeof buildReportWorkbook>> | null,
      mail: null as Awaited<ReturnType<typeof sendReportEmail>> | null,
      skipped: true as const,
      dateKey,
    };
  }

  const report = await buildReportWorkbook(scope);
  const mail = await sendReportEmail(report);
  await markSent(scope, dateKey, mail.messageId, mail.to);
  console.log(
    `[reports] Sent ${scope} Excel (${report.billCount} bills) to ${mail.to} — ${report.filename}`,
  );
  return { report, mail, skipped: false as const, dateKey };
}

/**
 * Scheduled job: full billing dump on Wednesday and Sunday only.
 * Manual admin endpoints can still send "today" or "all" anytime.
 */
export async function runScheduledReports(options: { force?: boolean } = {}) {
  if (!options.force && !isReportDayIST()) {
    console.log(
      "[reports] Not a report day (Wed/Sun IST) — skipping scheduled full dump",
    );
    return {
      all: null as Awaited<ReturnType<typeof runBillingReport>> | null,
      skippedDay: true as const,
    };
  }

  const all = await runBillingReport("all", options).catch((error) => {
    console.error("[reports] Full dump report failed:", error);
    return null;
  });

  return { all, skippedDay: false as const };
}

/**
 * If the process missed the in-memory cron (common on Railway redeploys),
 * send the full dump once on Wed/Sun after the cron time if it hasn't gone out yet.
 */
export async function catchUpMissedReports() {
  const { configured } = getReportMailConfig();
  if (!configured) return;
  if ((process.env.REPORT_CRON_ENABLED || "true").toLowerCase() === "false") {
    return;
  }
  if (!isReportDayIST()) {
    console.log("[reports] Catch-up skipped — not Wed/Sun (IST)");
    return;
  }
  if (!isPastReportCronTime()) {
    console.log("[reports] Catch-up skipped — cron time not reached yet (IST)");
    return;
  }

  console.log("[reports] Checking for missed report emails…");
  await runScheduledReports();
}

export function startDailyReportScheduler() {
  if (started) return;
  started = true;

  const enabled =
    (process.env.REPORT_CRON_ENABLED || "true").toLowerCase() !== "false";
  const { configured, to, user, provider, from } = getReportMailConfig();

  if (!enabled) {
    console.log("[reports] Cron disabled (REPORT_CRON_ENABLED=false)");
    return;
  }

  if (!configured) {
    console.warn(
      "[reports] Cron not started — set REPORT_EMAIL_TO and RESEND_API_KEY (Railway) or SMTP_USER + SMTP_PASS",
    );
    return;
  }

  // Wednesday + Sunday at 11:00 PM India time (full dump each time)
  const expression = process.env.REPORT_CRON || DEFAULT_REPORT_CRON;

  if (!cron.validate(expression)) {
    console.error(`[reports] Invalid REPORT_CRON expression: ${expression}`);
    return;
  }

  cron.schedule(
    expression,
    () => {
      void runScheduledReports();
    },
    { timezone: IST_TIMEZONE },
  );

  console.log(
    `[reports] Scheduler active — ${expression} (${IST_TIMEZONE}) → ${to} via ${provider}`,
  );
  console.log(
    `[reports] From ${from}${provider === "smtp" ? ` (SMTP user ${user})` : ""}`,
  );
  console.log(
    "[reports] Full dump twice a week: Wednesday + Sunday (IST)",
  );

  // Non-blocking SMTP probe + same-day catch-up after listen window.
  void (async () => {
    await verifyReportSmtp();
    // Small delay so the HTTP server is up before a long SMTP/Excel job.
    setTimeout(() => {
      void catchUpMissedReports();
    }, 15_000);
  })();
}
