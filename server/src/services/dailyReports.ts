import cron from "node-cron";
import { IST_TIMEZONE } from "../lib/ist";
import { buildReportWorkbook, type ReportScope } from "./reportExcel";
import { getReportMailConfig, sendReportEmail } from "./reportEmail";

let started = false;

export async function runBillingReport(scope: ReportScope) {
  const report = await buildReportWorkbook(scope);
  const mail = await sendReportEmail(report);
  console.log(
    `[reports] Sent ${scope} Excel (${report.billCount} bills) to ${mail.to} — ${report.filename}`,
  );
  return { report, mail };
}

async function runScheduledReports() {
  try {
    await runBillingReport("today");
  } catch (error) {
    console.error("[reports] Daily (today) report failed:", error);
  }

  // Sundays also get the full backup (in addition to today's file).
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: IST_TIMEZONE,
    weekday: "short",
  }).format(new Date());
  if (weekday === "Sun") {
    try {
      await runBillingReport("all");
    } catch (error) {
      console.error("[reports] Sunday full report failed:", error);
    }
  }
}

export function startDailyReportScheduler() {
  if (started) return;
  started = true;

  const enabled = (process.env.REPORT_CRON_ENABLED || "true").toLowerCase() !== "false";
  const { configured, to, user } = getReportMailConfig();

  if (!enabled) {
    console.log("[reports] Cron disabled (REPORT_CRON_ENABLED=false)");
    return;
  }

  if (!configured) {
    console.warn(
      "[reports] Cron not started — set SMTP_USER, SMTP_PASS, REPORT_EMAIL_TO",
    );
    return;
  }

  // 11:00 PM India time, every day
  const expression = process.env.REPORT_CRON || "0 23 * * *";

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
    `[reports] Scheduler active — ${expression} (${IST_TIMEZONE}) → ${to} (from ${user})`,
  );
  console.log(
    "[reports] Daily: today's bills · Sunday: today's bills + full backup",
  );
}
