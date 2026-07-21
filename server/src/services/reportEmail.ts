import nodemailer from "nodemailer";
import type { ReportScope } from "./reportExcel";

export type ReportMailAttachment = {
  filename: string;
  buffer: Buffer;
  billCount: number;
  scope: ReportScope;
  dateLabel: string;
};

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim() &&
      process.env.REPORT_EMAIL_TO?.trim(),
  );
}

export function getReportMailConfig() {
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const to = process.env.REPORT_EMAIL_TO?.trim() || "";
  const from =
    process.env.SMTP_FROM?.trim() ||
    `"Suraj Mobile Reports" <${user}>`;
  return { user, pass, to, from, configured: smtpConfigured() };
}

function envPort() {
  const raw = Number(process.env.SMTP_PORT);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function createTransportForPort(port: number) {
  const { user, pass } = getReportMailConfig();
  const host = process.env.SMTP_HOST?.trim() || "smtp.gmail.com";
  return nodemailer.createTransport({
    host,
    port,
    // 465 uses implicit TLS; 587 upgrades via STARTTLS.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
    // Cloud hosts can be slow to open the socket; fail fast enough to retry
    // the alternate port instead of hanging the whole job.
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
  });
}

function isConnectionError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNECTION" ||
    code === "ESOCKET" ||
    code === "ECONNREFUSED"
  );
}

function candidatePorts() {
  const configured = envPort();
  // Try the configured/default port first, then fall back to the other common
  // Gmail submission port (some hosts block 465, others block 587).
  const order = configured ? [configured] : [465, 587];
  for (const port of [465, 587]) {
    if (!order.includes(port)) order.push(port);
  }
  return order;
}

async function sendWithFallback(
  message: Parameters<nodemailer.Transporter["sendMail"]>[0],
) {
  const { configured } = getReportMailConfig();
  if (!configured) {
    throw new Error("SMTP is not configured");
  }

  let lastError: unknown = null;
  for (const port of candidatePorts()) {
    try {
      const transporter = createTransportForPort(port);
      return await transporter.sendMail(message);
    } catch (error) {
      lastError = error;
      if (isConnectionError(error)) {
        console.warn(
          `[reports] SMTP port ${port} failed (${(error as { code?: string }).code}); trying next port…`,
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to connect to SMTP server");
}

export async function sendReportEmail(report: ReportMailAttachment) {
  const { to, from, configured } = getReportMailConfig();
  if (!configured) {
    throw new Error(
      "Email reports are not configured. Set SMTP_USER, SMTP_PASS, REPORT_EMAIL_TO.",
    );
  }

  const shop = process.env.SHOP_NAME || "Suraj Mobile";
  const isToday = report.scope === "today";
  const subject = isToday
    ? `${shop} — today's bills (${report.dateLabel})`
    : `${shop} — full backup (${report.dateLabel})`;

  const body = [
    `Namaste,`,
    ``,
    isToday
      ? `Attached is today's billing Excel for ${shop}.`
      : `Attached is the full up-to-date billing Excel for ${shop}.`,
    ``,
    `Date: ${report.dateLabel} (IST)`,
    `Bills in file: ${report.billCount}`,
    ``,
    `This email was sent automatically.`,
    ``,
    `— ${shop} Billing System`,
  ].join("\n");

  const info = await sendWithFallback({
    from,
    to,
    subject,
    text: body,
    attachments: [
      {
        filename: report.filename,
        content: report.buffer,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });

  return {
    messageId: info.messageId,
    to,
    subject,
  };
}
