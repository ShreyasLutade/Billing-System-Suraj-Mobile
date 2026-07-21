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

function createTransport() {
  const { user, pass, configured } = getReportMailConfig();
  if (!configured) {
    throw new Error("SMTP is not configured");
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
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

  const transporter = createTransport();
  const info = await transporter.sendMail({
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
