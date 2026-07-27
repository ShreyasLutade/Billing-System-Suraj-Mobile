import dns from "dns";
import { lookup } from "dns/promises";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { ReportScope } from "./reportExcel";

// Prefer A records globally — Railway often cannot route to Gmail AAAA.
dns.setDefaultResultOrder("ipv4first");

export type ReportMailAttachment = {
  filename: string;
  buffer: Buffer;
  billCount: number;
  scope: ReportScope;
  dateLabel: string;
};

type MailProvider = "resend" | "smtp";

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

function resendApiKey() {
  return cleanEnv(process.env.RESEND_API_KEY);
}

function smtpReady() {
  return Boolean(
    cleanEnv(process.env.SMTP_USER) &&
      cleanEnv(process.env.SMTP_PASS) &&
      cleanEnv(process.env.REPORT_EMAIL_TO),
  );
}

function emailProvider(): MailProvider | null {
  const to = cleanEnv(process.env.REPORT_EMAIL_TO);
  if (!to) return null;
  // Prefer Resend on Railway — outbound SMTP (465/587) is often firewalled.
  if (resendApiKey()) return "resend";
  if (smtpReady()) return "smtp";
  return null;
}

export function getReportMailConfig() {
  const user = cleanEnv(process.env.SMTP_USER);
  const pass = cleanEnv(process.env.SMTP_PASS).replace(/\s+/g, "");
  const to = cleanEnv(process.env.REPORT_EMAIL_TO);
  const provider = emailProvider();
  const shop = process.env.SHOP_NAME || "Suraj Mobile";
  const from =
    cleanEnv(process.env.RESEND_FROM) ||
    cleanEnv(process.env.SMTP_FROM) ||
    (provider === "resend"
      ? `${shop} Reports <onboarding@resend.dev>`
      : `"${shop} Reports" <${user}>`);

  return {
    user,
    pass,
    to,
    from,
    provider,
    configured: provider !== null,
  };
}

function envPort() {
  const raw = Number(cleanEnv(process.env.SMTP_PORT));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

async function resolveSmtpIpv4(hostname: string) {
  const result = await lookup(hostname, { family: 4 });
  return result.address;
}

async function createTransportForPort(port: number) {
  const { user, pass } = getReportMailConfig();
  const hostname = cleanEnv(process.env.SMTP_HOST) || "smtp.gmail.com";
  // Connect by IPv4 address so nodemailer cannot pick an unreachable AAAA.
  const ipv4 = await resolveSmtpIpv4(hostname);
  console.log(`[reports] SMTP DNS ${hostname} → ${ipv4} (IPv4)`);

  const options: SMTPTransport.Options = {
    host: ipv4,
    port,
    // 465 uses implicit TLS; 587 upgrades via STARTTLS.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    name: hostname,
    tls: {
      minVersion: "TLSv1.2",
      servername: hostname,
    },
  };

  return nodemailer.createTransport(options);
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
    code === "ENOTFOUND" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("socket hang up") ||
    message.includes("connection closed") ||
    message.includes("network is unreachable")
  );
}

function candidatePorts() {
  const configured = envPort();
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

async function sendWithSmtp(
  message: Parameters<nodemailer.Transporter["sendMail"]>[0],
) {
  let lastError: unknown = null;
  for (const port of candidatePorts()) {
    try {
      const transporter = await createTransportForPort(port);
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

  const hint =
    " Railway often blocks outbound SMTP. Set RESEND_API_KEY and send via HTTPS instead (see README).";
  const base =
    lastError instanceof Error
      ? lastError
      : new Error("Failed to connect to SMTP server");
  throw new Error(`${base.message}.${hint}`);
}

async function sendWithResend(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  filename: string;
  buffer: Buffer;
}) {
  const apiKey = resendApiKey();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      attachments: [
        {
          filename: input.filename,
          content: input.buffer.toString("base64"),
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };

  if (!response.ok) {
    throw new Error(
      payload.message ||
        payload.name ||
        `Resend API failed with status ${response.status}`,
    );
  }

  console.log(`[reports] Resend OK — id ${payload.id || "unknown"}`);
  return { messageId: payload.id || `resend-${Date.now()}` };
}

/** Probe mail provider at boot so Railway logs show clear status. */
export async function verifyReportSmtp() {
  const { configured, provider, user, to, from } = getReportMailConfig();
  if (!configured) {
    console.warn(
      "[reports] Email not configured — set REPORT_EMAIL_TO and either RESEND_API_KEY (recommended on Railway) or SMTP_USER + SMTP_PASS",
    );
    return false;
  }

  if (provider === "resend") {
    console.log(
      `[reports] Using Resend HTTPS API → ${to} (from ${from})`,
    );
    return true;
  }

  let lastError: unknown = null;
  for (const port of candidatePorts()) {
    try {
      const transporter = await createTransportForPort(port);
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
  console.error(
    "[reports] Tip: Railway blocks SMTP. Create a free Resend key at https://resend.com and set RESEND_API_KEY.",
  );
  return false;
}

export async function sendReportEmail(report: ReportMailAttachment) {
  const { to, from, configured, provider } = getReportMailConfig();
  if (!configured || !provider) {
    throw new Error(
      "Email reports are not configured. Set REPORT_EMAIL_TO and either RESEND_API_KEY or SMTP_USER/SMTP_PASS.",
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

  if (provider === "resend") {
    const info = await sendWithResend({
      from,
      to,
      subject,
      text: body,
      filename: report.filename,
      buffer: report.buffer,
    });
    return { messageId: info.messageId, to, subject };
  }

  const info = await sendWithSmtp({
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
