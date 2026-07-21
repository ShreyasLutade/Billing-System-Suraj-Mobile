import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  requireAuth,
  signToken,
  type AuthUser,
  type Role,
} from "../middleware/auth";

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

    const passwordOk = await bcrypt.compare(
      seed.password,
      existing.passwordHash,
    );
    const needsUpdate =
      !passwordOk || existing.name !== seed.name || existing.phone !== seed.phone;

    if (needsUpdate) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: seed.name,
          phone: seed.phone,
          passwordHash: passwordOk
            ? existing.passwordHash
            : await bcrypt.hash(seed.password, 10),
        },
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
