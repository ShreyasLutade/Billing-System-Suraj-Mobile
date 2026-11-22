import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { istDateString } from "../lib/ist";

/**
 * Staff attendance and money given (shared by both shops).
 * Anyone signed in marks today's attendance; a past day, or changing a day
 * already marked, needs an admin's password. A small photo is stored with
 * each mark and only admins can see it.
 */
export const staffRouter = Router();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
/** ~4–8 KB JPEG data URLs; anything bigger is refused. */
const MAX_PHOTO = 40_000;

const isAdmin = (req: { user?: { role?: string } }) => req.user?.role === "ADMIN";

async function adminPasswordOk(password: string) {
  if (!password) return false;
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", blocked: false }, select: { passwordHash: true } });
  for (const a of admins) if (await bcrypt.compare(password, a.passwordHash)) return true;
  return false;
}

/* ---------------- auto salary ---------------- */

const pad = (n: number) => String(n).padStart(2, "0");

/** The pay date of a month ("2026-02", day 31 → "2026-02-28"). */
function payDate(month: string, day: number) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${pad(Math.min(Math.max(day, 1), last))}`;
}

function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}

/**
 * Add the salary entries that are due: for each staff member with auto
 * salary on, every month from the day it was turned on up to today gets one
 * SALARY entry on the chosen day. Runs whenever the staff page loads.
 */
export async function runAutoSalary(onlyId?: string) {
  const today = istDateString();
  const staff = await prisma.staff.findMany({
    where: { active: true, autoSalary: true, salaryAmount: { gt: 0 }, ...(onlyId ? { id: onlyId } : {}) },
  });
  for (const s of staff) {
    if (!s.autoSince) continue;
    let month = s.lastAutoMonth ? nextMonth(s.lastAutoMonth) : s.autoSince.slice(0, 7);
    let last = s.lastAutoMonth;
    const creates: Array<{ day: string }> = [];
    while (month <= today.slice(0, 7)) {
      const day = payDate(month, s.salaryDay);
      if (day > today) break; // this month's pay day hasn't come yet
      if (day >= s.autoSince) creates.push({ day });
      last = month;
      month = nextMonth(month);
    }
    if (last === s.lastAutoMonth) continue;
    await prisma.$transaction([
      ...creates.map((c) =>
        prisma.staffPayment.create({
          data: { staffId: s.id, amount: s.salaryAmount, day: c.day, kind: "SALARY", mode: s.salaryMode, note: "Auto salary", auto: true, createdByName: "Auto" },
        }),
      ),
      prisma.staff.update({ where: { id: s.id }, data: { lastAutoMonth: last } }),
    ]);
  }
}

staffRouter.put("/:id/salary", requireAdmin, async (req, res, next) => {
  try {
    const parsed = z
      .object({
        autoSalary: z.boolean(),
        salaryAmount: z.coerce.number().min(0).max(10_000_000),
        salaryDay: z.coerce.number().int().min(1).max(31),
        salaryMode: z.enum(["CASH", "ONLINE"]).default("CASH"),
      })
      .safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message });
    if (parsed.data.autoSalary && !(parsed.data.salaryAmount > 0)) return void res.status(400).json({ error: "Enter the monthly salary" });
    const current = await prisma.staff.findUnique({ where: { id: req.params.id } });
    if (!current) return void res.status(404).json({ error: "Staff not found" });
    const turningOn = parsed.data.autoSalary && !current.autoSalary;
    await prisma.staff.update({
      where: { id: current.id },
      data: {
        ...parsed.data,
        // Starts from today: nothing is added for days before it was turned on.
        // (this month stays done if its salary was already added before)
        ...(turningOn
          ? { autoSince: istDateString(), lastAutoMonth: current.lastAutoMonth >= istDateString().slice(0, 7) ? current.lastAutoMonth : "" }
          : {}),
      },
    });
    await runAutoSalary(current.id);
    res.json({ data: { saved: true } });
  } catch (error) {
    next(error);
  }
});

staffRouter.get("/", async (req, res, next) => {
  try {
    await runAutoSalary().catch((err) => console.error("[staff] auto salary failed", err));
    const month = typeof req.query.month === "string" && MONTH.test(req.query.month) ? req.query.month : istDateString().slice(0, 7);
    const staff = await prisma.staff.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        attendance: {
          where: { day: { startsWith: month } },
          select: { id: true, day: true, kind: true, byAdmin: true, markedByName: true, createdAt: true },
          orderBy: { day: "asc" },
        },
        payments: isAdmin(req)
          ? { where: { day: { startsWith: month } }, orderBy: { day: "desc" } }
          : false,
      },
    });
    // Which marks have a photo (admins open it separately to keep this light).
    const withPhoto = isAdmin(req)
      ? new Set(
          (
            await prisma.staffAttendance.findMany({
              where: { day: { startsWith: month }, photo: { not: null } },
              select: { id: true },
            })
          ).map((a) => a.id),
        )
      : new Set<string>();
    res.json({
      data: {
        month,
        today: istDateString(),
        staff: staff.map((s) => ({
          id: s.id,
          name: s.name,
          phone: s.phone,
          since: istDateString(s.createdAt),
          attendance: s.attendance.map((a) => ({ ...a, hasPhoto: withPhoto.has(a.id) })),
          payments: "payments" in s ? s.payments : [],
          ...(isAdmin(req)
            ? { salary: { auto: s.autoSalary, amount: s.salaryAmount, day: s.salaryDay, mode: s.salaryMode, since: s.autoSince } }
            : {}),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

const staffSchema = z.object({
  name: z.string().trim().min(2, "Enter the name").max(60),
  phone: z.string().trim().max(15).default(""),
});

staffRouter.post("/", requireAdmin, async (req, res, next) => {
  try {
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message });
    res.status(201).json({ data: await prisma.staff.create({ data: parsed.data }) });
  } catch (error) {
    next(error);
  }
});

staffRouter.patch("/:id", requireAdmin, async (req, res, next) => {
  try {
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message });
    res.json({ data: await prisma.staff.update({ where: { id: req.params.id }, data: parsed.data }) });
  } catch (error) {
    next(error);
  }
});

/** Removing keeps the history (the person just leaves the list). */
staffRouter.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    await prisma.staff.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ data: { removed: true } });
  } catch (error) {
    next(error);
  }
});

const markSchema = z.object({
  day: z.string().regex(DAY),
  kind: z.enum(["FULL", "HALF", "CLEAR"]),
  photo: z.string().startsWith("data:image/").max(MAX_PHOTO).optional().nullable(),
  adminPassword: z.string().max(100).optional(),
});

staffRouter.post("/:id/attendance", async (req, res, next) => {
  try {
    const parsed = markSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Check the attendance details" });
    const { day, kind, photo, adminPassword } = parsed.data;
    const today = istDateString();
    if (day > today) return void res.status(400).json({ error: "Attendance can't be marked for a future day" });
    const staff = await prisma.staff.findFirst({ where: { id: req.params.id, active: true } });
    if (!staff) return void res.status(404).json({ error: "Staff not found" });
    const existing = await prisma.staffAttendance.findUnique({ where: { staffId_day: { staffId: staff.id, day } } });
    // Today, first mark: anyone. Past day, a change, or clearing: admin password.
    // Staff mark their own day from their account; an admin marking (any
    // day), a past day, a change or clearing needs the admin password.
    const needsAdmin = day !== today || Boolean(existing) || kind === "CLEAR" || isAdmin(req);
    if (needsAdmin && !(await adminPasswordOk(adminPassword || ""))) {
      return void res.status(403).json({ error: "Wrong admin password", code: "ADMIN_PASSWORD" });
    }
    if (kind === "CLEAR") {
      if (existing) await prisma.staffAttendance.delete({ where: { id: existing.id } });
      return void res.json({ data: null });
    }
    const data = { kind, byAdmin: needsAdmin, markedByName: req.user?.name || null, ...(photo ? { photo } : {}) };
    const saved = existing
      ? await prisma.staffAttendance.update({ where: { id: existing.id }, data })
      : await prisma.staffAttendance.create({ data: { ...data, staffId: staff.id, day } });
    res.json({ data: { id: saved.id, day: saved.day, kind: saved.kind, byAdmin: saved.byAdmin } });
  } catch (error) {
    next(error);
  }
});

staffRouter.get("/attendance/:attId/photo", requireAdmin, async (req, res, next) => {
  try {
    const row = await prisma.staffAttendance.findUnique({ where: { id: req.params.attId }, select: { photo: true } });
    res.json({ data: { photo: row?.photo || null } });
  } catch (error) {
    next(error);
  }
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Enter the amount").max(10_000_000),
  day: z.string().regex(DAY),
  kind: z.enum(["ADVANCE", "SALARY", "OTHER"]).default("ADVANCE"),
  mode: z.enum(["CASH", "ONLINE"]).default("CASH"),
  note: z.string().trim().max(200).default(""),
});

staffRouter.post("/:id/payments", requireAdmin, async (req, res, next) => {
  try {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0].message });
    const created = await prisma.staffPayment.create({
      data: { ...parsed.data, staffId: req.params.id, createdByName: req.user?.name || null },
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

staffRouter.delete("/payments/:paymentId", requireAdmin, async (req, res, next) => {
  try {
    await prisma.staffPayment.delete({ where: { id: req.params.paymentId } });
    res.json({ data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});
