import nodemailer from "nodemailer";
import type { ReportScope } from "./reportExcel";

export type ReportMailAttachment = {
  filename: string;
  buffer: Buffer;
  billCount: number;
  scope: ReportScope;
  dateLabel: string;
};

/** Strip accidental wrapping quotes from Railway / copied env values. */
function cleanEnv(value: string | undefined) {
  const trimmed = (value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function smtpConfigured() {
  return Boolean(
    cleanEnv(process.env.SMTP_USER) &&
      cleanEnv(process.env.SMTP_PASS) &&
      cleanEnv(process.env.REPORT_EMAIL_TO),
  );
}

export function getReportMailConfig() {
  const user = cleanEnv(process.env.SMTP_USER);
  const pass = cleanEnv(process.env.SMTP_PASS).replace(/\s+/g, "");
  const to = cleanEnv(process.env.REPORT_EMAIL_TO);
  const from =
    cleanEnv(process.env.SMTP_FROM) || `"Suraj Mobile Reports" <${user}>`;
  return { user, pass, to, from, configured: smtpConfigured() };
}

function envPort() {
  const raw = Number(cleanEnv(process.env.SMTP_PORT));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function createTransportForPort(port: number) {
  const { user, pass } = getReportMailConfig();
  const host = cleanEnv(process.env.SMTP_HOST) || "smtp.gmail.com";
  return nodemailer.createTransport({
    host,
    port,
    // 465 uses implicit TLS; 587 upgrades via STARTTLS.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
    // Railway/containers often have broken or unreachable IPv6 routes.
    // Gmail AAAA records then fail with ENETUNREACH — force IPv4.
    family: 4,
    // Cloud hosts can be slow to open the socket; fail fast enough to retry
    // the alternate port instead of hanging the whole job.
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    tls: {
      // Some PaaS middleboxes renegotiate TLS oddly; still verify certs.
      minVersion: "TLSv1.2",
      servername: host,
    },
  });
}

function isConnectionError(error: unknown) {
  const err = error as { code?: string; message?: string } | null;
  const code = err?.code || "";
  const message = (err?.message || "").toLowerCase();
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNECTION" ||
    code === "ESOCKET" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    code === "ETLS" ||
    code === "EDNS" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("socket hang up") ||
    message.includes("connection closed") ||
    message.includes("network is unreachable")
  );
}

function candidatePorts() {
  const configured = envPort();
  // Railway / many PaaS hosts block outbound 465. Prefer 587 in production
  // unless SMTP_PORT is explicitly set.
  const prefer587 =
    !configured &&
    (process.env.NODE_ENV === "production" ||
      Boolean(process.env.RAILWAY_ENVIRONMENT));
  const order = configured
    ? [configured]
    : prefer587
      ? [587, 465]
      : [465, 587];
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
      const info = await transporter.sendMail(message);
      console.log(`[reports] SMTP OK on port ${port}`);
      return info;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code || "unknown";
      const msg = error instanceof Error ? error.message : String(error);
      if (isConnectionError(error)) {
        console.warn(
          `[reports] SMTP port ${port} failed (${code}: ${msg}); trying next port…`,
        );
        continue;
      }
      console.error(`[reports] SMTP port ${port} rejected mail (${code}): ${msg}`);
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to connect to SMTP server");
}

/** Probe SMTP at boot so Railway logs show clear config/auth status. */
export async function verifyReportSmtp() {
  const { configured, user, to } = getReportMailConfig();
  if (!configured) {
    console.warn(
      "[reports] SMTP not configured — set SMTP_USER, SMTP_PASS, REPORT_EMAIL_TO",
    );
    return false;
  }

  let lastError: unknown = null;
  for (const port of candidatePorts()) {
    try {
      const transporter = createTransportForPort(port);
      await transporter.verify();
      console.log(
        `[reports] SMTP verified — ${user} → ${to} via port ${port}`,
      );
      return true;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code || "unknown";
      const msg = error instanceof Error ? error.message : String(error);
      if (isConnectionError(error)) {
        console.warn(
          `[reports] SMTP verify port ${port} failed (${code}); trying next…`,
        );
        continue;
      }
      console.error(
        `[reports] SMTP verify failed on port ${port} (${code}): ${msg}`,
      );
      return false;
    }
  }

  console.error(
    "[reports] SMTP verify failed on all ports:",
    lastError instanceof Error ? lastError.message : lastError,
  );
  return false;
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
