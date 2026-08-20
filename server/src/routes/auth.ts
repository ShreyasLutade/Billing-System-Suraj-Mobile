import { Router } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  requireAuth,
  signToken,
  type AuthUser,
  type Role,
} from "../middleware/auth";
import { sendPlainEmail } from "../services/reportEmail";
import {
  deletePasswordResetOtps,
  findLatestPasswordResetOtp,
  incrementPasswordResetOtpAttempts,
  replacePasswordResetOtp,
} from "../services/passwordResetOtp";

export const authRouter = Router();

const loginSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "Enter a valid 10-digit phone number"),
  password: z.string().min(1, "Password is required"),
});

function publicUser(user: {
  id: string;
  phone: string;
  name: string;
  role: string;
}): AuthUser {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role as Role,
  };
}

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid login details",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { phone, password } = parsed.data;
    const candidates = await prisma.user.findMany({ where: { phone } });

    let matched: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (await bcrypt.compare(password, candidate.passwordHash)) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      res.status(401).json({ error: "Invalid phone number or password" });
      return;
    }

    const user = publicUser(matched);
    const token = signToken(user);
    res.json({ data: { token, user } });
  } catch (error) {
    next(error);
  }
});

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Enter a valid 10-digit phone number");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function hashOtp(phone: string, otp: string) {
  const secret = process.env.JWT_SECRET || "change-me-in-production";
  return createHash("sha256").update(`${phone}:${otp}:${secret}`).digest("hex");
}

function otpMatches(phone: string, otp: string, storedHash: string) {
  const next = Buffer.from(hashOtp(phone, otp));
  const prev = Buffer.from(storedHash);
  return next.length === prev.length && timingSafeEqual(next, prev);
}

authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const parsed = z.object({ phone: phoneSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Enter a valid 10-digit phone number",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { phone } = parsed.data;
    const users = await prisma.user.findMany({ where: { phone } });
    if (!users.length) {
      res.status(404).json({ error: "No account found for this number" });
      return;
    }

    const latest = await findLatestPasswordResetOtp(phone);
    if (
      latest &&
      Date.now() - latest.createdAt.getTime() < OTP_RESEND_MS
    ) {
      res.status(429).json({
        error: "Please wait a minute before requesting another code",
      });
      return;
    }

    const otp = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const names = users.map((user) => user.name).join(", ");
    const shop = process.env.SHOP_NAME || "Suraj Mobile";
    const mail = await sendPlainEmail({
      subject: `${shop} password reset OTP (${phone})`,
      text: [
        `Namaste,`,
        ``,
        `A password reset was requested for ${shop} billing.`,
        ``,
        `Account phone: ${phone}`,
        `Staff: ${names}`,
        `OTP: ${otp}`,
        ``,
        `This code expires in 10 minutes.`,
        `Share it only with the person who requested the reset.`,
        ``,
        `If you did not expect this, ignore the email.`,
        ``,
        `— ${shop} Billing System`,
      ].join("\n"),
    });
    await replacePasswordResetOtp({
      phone,
      otpHash: hashOtp(phone, otp),
      expiresAt,
    });

    res.json({
      data: {
        sent: true,
        email: mail.to,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[auth] forgot-password failed:", message);
    if (
      /resend|smtp|email|configured|testing emails|password reset table/i.test(
        message,
      )
    ) {
      res.status(503).json({
        error:
          "Could not send the OTP to the shop Gmail. Open surajmobile33556@gmail.com (including Spam). If this keeps failing, the mail service on the server needs a working Resend key.",
        detail: message,
      });
      return;
    }
    next(error);
  }
});

authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        phone: phoneSchema,
        otp: z
          .string()
          .trim()
          .regex(/^\d{6}$/, "Enter the 6-digit OTP"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Check the OTP and new password",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { phone, otp, password } = parsed.data;
    const users = await prisma.user.findMany({ where: { phone } });
    if (!users.length) {
      res.status(404).json({ error: "No account found for this number" });
      return;
    }

    const row = await findLatestPasswordResetOtp(phone);
    if (!row || row.expiresAt.getTime() < Date.now()) {
      res.status(400).json({
        error: "OTP expired. Request a new code",
      });
      return;
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      await deletePasswordResetOtps(phone);
      res.status(400).json({
        error: "Too many attempts. Request a new code",
      });
      return;
    }

    if (!otpMatches(phone, otp, row.otpHash)) {
      await incrementPasswordResetOtpAttempts(row.id);
      res.status(400).json({ error: "Incorrect OTP" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.updateMany({
      where: { phone },
      data: { passwordHash },
    });
    await deletePasswordResetOtps(phone);

    res.json({ data: { reset: true } });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(401).json({ error: "User not found. Please log in again" });
      return;
    }
    res.json({ data: { user: publicUser(user) } });
  } catch (error) {
    next(error);
  }
});

const SEED_USERS: Array<{
  phone: string;
  password: string;
  name: string;
  role: Role;
}> = [
  {
    phone: "9302222585",
    password: "Surajbudhwani@123",
    name: "Suraj Admin",
    role: "ADMIN",
  },
  {
    phone: "7038006342",
    password: "Shreyas@123",
    name: "Shreyas Admin",
    role: "ADMIN",
  },
  {
    phone: "6265086510",
    password: "Shop@123",
    name: "Anuj",
    role: "STAFF",
  },
  {
    phone: "8989192440",
    password: "Shop@123",
    name: "Chhatresh",
    role: "STAFF",
  },
  {
    phone: "8962948807",
    password: "Shop@123",
    name: "Mayank",
    role: "STAFF",
  },
];

export async function seedUsers() {
  for (const seed of SEED_USERS) {
    const existing = await prisma.user.findFirst({
      where: { phone: seed.phone, role: seed.role },
    });

    if (!existing) {
      await prisma.user.create({
        data: {
          phone: seed.phone,
          name: seed.name,
          role: seed.role,
          passwordHash: await bcrypt.hash(seed.password, 10),
        },
      });
      continue;
    }

    if (existing.name !== seed.name) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: seed.name },
      });
    }
  }

  // Remove accounts that are no longer part of the official seed list
  // (e.g. old shared staff login with Mobile@123).
  const keepKeys = new Set(
    SEED_USERS.map((seed) => `${seed.phone}:${seed.role}`),
  );
  const allUsers = await prisma.user.findMany({
    select: { id: true, phone: true, role: true },
  });
  const obsoleteIds = allUsers
    .filter((user) => !keepKeys.has(`${user.phone}:${user.role}`))
    .map((user) => user.id);

  if (obsoleteIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: obsoleteIds } } });
  }
}
