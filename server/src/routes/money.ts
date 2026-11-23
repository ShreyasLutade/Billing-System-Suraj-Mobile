import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { istDateString } from "../lib/ist";

/**
 * Analytics → Cash / Online / Expense books (admin only, mounted with
 * requireAdmin). Manual khata: every entry is typed in by the owner.
 */
export const moneyRouter = Router();

const BOOKS = ["CASH", "ONLINE"] as const;
type Book = (typeof BOOKS)[number];

export const EXPENSE_CATEGORIES = [
  "rent",
  "electricity",
  "salary",
  "internet",
  "tea",
  "transport",
  "repairs",
  "packaging",
  "marketing",
  "other",
] as const;

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const dayField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .nullable();

/** Today (or nothing) = now; an earlier IST day = midday that day; future = null. */
function entryDate(value: string | null | undefined): Date | null {
  const today = istDateString(new Date());
  if (!value || value === today) return new Date();
  if (value > today) return null;
  return new Date(`${value}T12:00:00.000+05:30`);
}

/** "2026-11" → IST month bounds [from, to). */
function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(`${month}-01T00:00:00.000+05:30`);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const to = new Date(`${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00.000+05:30`);
  return { from, to };
}

function currentMonth() {
  return istDateString(new Date()).slice(0, 7);
}

function parseBook(raw: string): Book | null {
  const book = raw.toUpperCase();
  return (BOOKS as readonly string[]).includes(book) ? (book as Book) : null;
}

function serialize(entry: {
  id: string;
  kind: string;
  amount: number;
  category: string | null;
  method: string | null;
  note: string | null;
  entryDate: Date;
  createdAt: Date;
  createdByName: string | null;
}) {
  return {
    id: entry.id,
    kind: entry.kind,
    amount: round2(entry.amount),
    category: entry.category,
    method: entry.method,
    note: entry.note,
    date: entry.entryDate.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    createdByName: entry.createdByName,
  };
}

/** Balance of a book: opening + in − out. */
async function bookBalance(book: Book) {
  const groups = await prisma.moneyEntry.groupBy({
    by: ["kind"],
    where: { book },
    _sum: { amount: true },
  });
  const sum = (kind: string) => groups.find((g) => g.kind === kind)?._sum.amount ?? 0;
  return round2(sum("OPENING") + sum("IN") - sum("OUT"));
}

/** The three buttons on Analytics: balances and this month's expense. */
moneyRouter.get("/summary", async (_req, res, next) => {
  try {
    const { from, to } = monthRange(currentMonth());
    const [cash, online, opening, expense] = await Promise.all([
      bookBalance("CASH"),
      bookBalance("ONLINE"),
      prisma.moneyEntry.findFirst({ where: { book: "CASH", kind: "OPENING" }, select: { id: true } }),
      prisma.moneyEntry.aggregate({
        where: { book: "EXPENSE", entryDate: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
    ]);
    res.json({
      data: {
        cash: { balance: cash, started: Boolean(opening) },
        online: { balance: online },
        expense: { thisMonth: round2(expense._sum.amount ?? 0), month: currentMonth() },
      },
    });
  } catch (error) {
    next(error);
  }
});

/** One book (Cash / Online): balance, this month in / out, every entry newest first. */
moneyRouter.get("/book/:book", async (req, res, next) => {
  try {
    const book = parseBook(req.params.book);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    const rows = await prisma.moneyEntry.findMany({
      where: { book },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    });
    // Opening first, then by date: the running balance after each entry.
    const opening = rows.find((r) => r.kind === "OPENING") ?? null;
    let balance = 0;
    const ordered = [...(opening ? [opening] : []), ...rows.filter((r) => r.kind !== "OPENING")];
    const entries = ordered.map((row) => {
      balance = round2(balance + (row.kind === "OUT" ? -row.amount : row.amount));
      return { ...serialize(row), balanceAfter: balance };
    });
    const { from, to } = monthRange(currentMonth());
    const inMonth = rows.filter(
      (r) => r.kind !== "OPENING" && r.entryDate >= from && r.entryDate < to,
    );
    res.json({
      data: {
        book,
        balance,
        opening: opening ? { amount: round2(opening.amount), date: opening.entryDate.toISOString() } : null,
        monthIn: round2(inMonth.filter((r) => r.kind === "IN").reduce((s, r) => s + r.amount, 0)),
        monthOut: round2(inMonth.filter((r) => r.kind === "OUT").reduce((s, r) => s + r.amount, 0)),
        entries: entries.reverse(),
      },
    });
  } catch (error) {
    next(error);
  }
});

const entrySchema = z.object({
  kind: z.enum(["IN", "OUT"]),
  amount: z.number().positive().max(100_000_000),
  category: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
  date: dayField,
});

/** Money got (IN) / gave (OUT) in a book. */
moneyRouter.post("/book/:book/entries", async (req, res, next) => {
  try {
    const book = parseBook(req.params.book);
    if (!book) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    const parsed = entrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter the amount" });
      return;
    }
    const when = entryDate(parsed.data.date);
    if (!when) {
      res.status(400).json({ error: "The date can't be in the future" });
      return;
    }
    const entry = await prisma.moneyEntry.create({
      data: {
        book,
        kind: parsed.data.kind,
        amount: round2(parsed.data.amount),
        category: parsed.data.category || null,
        note: parsed.data.note || null,
        entryDate: when,
        createdByName: req.user?.name ?? null,
      },
    });
    res.status(201).json({ data: { ...serialize(entry), balance: await bookBalance(book) } });
  } catch (error) {
    next(error);
  }
});

const openingSchema = z.object({
  amount: z.number().min(0).max(100_000_000),
  date: dayField,
});

/** Cash in hand when the book starts (set once; can be changed later). */
moneyRouter.put("/book/cash/opening", async (req, res, next) => {
  try {
    const parsed = openingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter the cash you have now" });
      return;
    }
    const when = entryDate(parsed.data.date);
    if (!when) {
      res.status(400).json({ error: "The date can't be in the future" });
      return;
    }
    const existing = await prisma.moneyEntry.findFirst({
      where: { book: "CASH", kind: "OPENING" },
    });
    const amount = round2(parsed.data.amount);
    if (existing) {
      await prisma.moneyEntry.update({
        where: { id: existing.id },
        data: { amount, entryDate: when },
      });
    } else {
      await prisma.moneyEntry.create({
        data: {
          book: "CASH",
          kind: "OPENING",
          amount,
          note: "Opening balance",
          entryDate: when,
          createdByName: req.user?.name ?? null,
        },
      });
    }
    res.json({ data: { balance: await bookBalance("CASH") } });
  } catch (error) {
    next(error);
  }
});

/** Delete any entry (Cash / Online / Expense), not the opening balance. */
moneyRouter.delete("/entries/:id", async (req, res, next) => {
  try {
    const entry = await prisma.moneyEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    if (entry.kind === "OPENING") {
      res.status(400).json({ error: "Change the opening balance instead" });
      return;
    }
    await prisma.moneyEntry.delete({ where: { id: entry.id } });
    res.json({ data: { id: entry.id } });
  } catch (error) {
    next(error);
  }
});

/** Expenses of a month: total, by category, entries, and the last 12 months. */
moneyRouter.get("/expenses", async (req, res, next) => {
  try {
    const raw = typeof req.query.month === "string" ? req.query.month : "";
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : currentMonth();
    const { from, to } = monthRange(month);
    // 12 months ending with the later of this month / the chosen month.
    const endMonth = month > currentMonth() ? month : currentMonth();
    const [ey, em] = endMonth.split("-").map(Number);
    const months: string[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(ey, em - 1 - i, 1));
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    const span = { from: monthRange(months[0]).from, to: monthRange(months[11]).to };
    const [entries, yearRows] = await Promise.all([
      prisma.moneyEntry.findMany({
        where: { book: "EXPENSE", entryDate: { gte: from, lt: to } },
        orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      }),
      prisma.moneyEntry.findMany({
        where: { book: "EXPENSE", entryDate: { gte: span.from, lt: span.to } },
        select: { amount: true, entryDate: true },
      }),
    ]);
    const totals = new Map(months.map((m) => [m, 0]));
    for (const row of yearRows) {
      const key = istDateString(row.entryDate).slice(0, 7);
      if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + row.amount);
    }
    const byCategory = new Map<string, { total: number; count: number }>();
    for (const e of entries) {
      const key = e.category || "other";
      const cur = byCategory.get(key) ?? { total: 0, count: 0 };
      byCategory.set(key, { total: cur.total + e.amount, count: cur.count + 1 });
    }
    res.json({
      data: {
        month,
        total: round2(entries.reduce((s, e) => s + e.amount, 0)),
        byCategory: [...byCategory.entries()]
          .map(([category, v]) => ({ category, total: round2(v.total), count: v.count }))
          .sort((a, b) => b.total - a.total),
        months: months.map((m) => ({ month: m, total: round2(totals.get(m) ?? 0) })),
        entries: entries.map(serialize),
      },
    });
  } catch (error) {
    next(error);
  }
});

const expenseSchema = z.object({
  amount: z.number().positive().max(100_000_000),
  category: z.enum(EXPENSE_CATEGORIES),
  method: z.enum(["cash", "online", "na"]).optional(),
  note: z.string().trim().max(200).optional().nullable(),
  date: dayField,
});

moneyRouter.post("/expenses", async (req, res, next) => {
  try {
    const parsed = expenseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter the amount and pick what it was for" });
      return;
    }
    const when = entryDate(parsed.data.date);
    if (!when) {
      res.status(400).json({ error: "The date can't be in the future" });
      return;
    }
    const entry = await prisma.moneyEntry.create({
      data: {
        book: "EXPENSE",
        kind: "OUT",
        amount: round2(parsed.data.amount),
        category: parsed.data.category,
        method: parsed.data.method ?? "cash",
        note: parsed.data.note || null,
        entryDate: when,
        createdByName: req.user?.name ?? null,
      },
    });
    res.status(201).json({ data: serialize(entry) });
  } catch (error) {
    next(error);
  }
});
