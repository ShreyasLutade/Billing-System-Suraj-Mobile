import { Router } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import type { RepairShop } from "../lib/repairShops";
import {
  requireAdmin,
  requireAuth,
  requireFullAccess,
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
  repairShop: string | null;
}): AuthUser {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role as Role,
    repairShop: user.repairShop,
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

    // Blocked accounts keep their history but can't get back in.
    if (matched.blocked) {
      res.status(403).json({
        error: "This account is blocked. Ask the shop admin to unblock it.",
      });
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
    const shop = process.env.SHOP_NAME || "Babu Mobile";
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
          "Could not send the OTP to the shop email address. If this keeps failing, the mail service on the server needs a working Resend key.",
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

/* ---------------------------------------------------------------- *
 * Manage users (shop admins only)
 *
 * Passwords are bcrypt hashes, so they can never be read back — the
 * admin can only set a new one, which replaces the hash.
 *
 * requireFullAccess keeps repair-only admins (Luckey's shop) out: they
 * run their own counter and have no business over shop logins.
 * ---------------------------------------------------------------- */

const manageUsers = [requireAuth, requireAdmin, requireFullAccess] as const;

/** Everyone with a login, admins first, then staff, each A→Z. */
authRouter.get("/users", ...manageUsers, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        repairShop: true,
        blocked: true,
        createdAt: true,
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
    res.json({ data: users });
  } catch (error) {
    next(error);
  }
});

/** Block / unblock an account. Admins can't block themselves. */
authRouter.patch(
  "/users/:id/blocked",
  ...manageUsers,
  async (req, res, next) => {
    try {
      const parsed = z.object({ blocked: z.boolean() }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Pass blocked: true or false" });
        return;
      }

      if (req.params.id === req.user!.id) {
        res.status(400).json({ error: "You can't block your own account" });
        return;
      }

      const target = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { id: true, role: true, repairShop: true },
      });
      if (!target) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Keep at least one shop admin able to log in. Repair-only admins
      // don't count — they can't run the mobile shop.
      if (
        parsed.data.blocked &&
        target.role === "ADMIN" &&
        !target.repairShop
      ) {
        const activeAdmins = await prisma.user.count({
          where: { role: "ADMIN", blocked: false, repairShop: null },
        });
        if (activeAdmins <= 1) {
          res
            .status(400)
            .json({ error: "At least one admin must stay unblocked" });
          return;
        }
      }

      const user = await prisma.user.update({
        where: { id: target.id },
        data: { blocked: parsed.data.blocked },
        select: {
          id: true,
          phone: true,
          name: true,
          role: true,
          repairShop: true,
          blocked: true,
          createdAt: true,
        },
      });
      res.json({ data: user });
    } catch (error) {
      next(error);
    }
  },
);

/** Set a new password for any account. The admin chooses the password. */
authRouter.patch(
  "/users/:id/password",
  ...manageUsers,
  async (req, res, next) => {
    try {
      const parsed = z
        .object({
          password: z.string().min(8, "Password must be at least 8 characters"),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error:
            parsed.error.flatten().fieldErrors.password?.[0] ||
            "Password must be at least 8 characters",
        });
        return;
      }

      const target = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!target) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      await prisma.user.update({
        where: { id: target.id },
        data: { passwordHash: await bcrypt.hash(parsed.data.password, 10) },
      });
      res.json({ data: { updated: true } });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(401).json({ error: "User not found. Please log in again" });
      return;
    }
    // Tokens live for 7 days, so a block has to end the current session too.
    if (user.blocked) {
      res.status(403).json({
        error: "This account is blocked. Ask the shop admin to unblock it.",
      });
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
  /** Repair-only account for this repair shop (lib/repairShops). */
  repairShop?: RepairShop;
}> = [
  {
    phone: "7038006342",
    password: "Shreyas@026",
    name: "Shreyas Admin",
    role: "ADMIN",
  },
  {
    phone: "7581817575",
    password: "Babumobile@123",
    name: "Hareesh",
    role: "ADMIN",
  },
  {
    phone: "7581887575",
    password: "Shop@123",
    name: "Staff-1",
    role: "STAFF",
  },
  {
    phone: "7581847575",
    password: "Shop@123",
    name: "Staff-2",
    role: "STAFF",
  },
  {
    // Luckey's repair shop: admin of that shop only, no mobile-shop access.
    phone: "9303914031",
    password: "Shop@123",
    name: "Luckey",
    role: "ADMIN",
    repairShop: "LK",
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
          repairShop: seed.repairShop ?? null,
          passwordHash: await bcrypt.hash(seed.password, 10),
        },
      });
      continue;
    }

    // Never overwrite passwords for existing users — forgot-password / admin
    // resets must survive Railway redeploys and restarts.
    // Name and shop follow the seed list (passwords never do).
    const repairShop = seed.repairShop ?? null;
    if (existing.name !== seed.name || existing.repairShop !== repairShop) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: seed.name, repairShop },
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
