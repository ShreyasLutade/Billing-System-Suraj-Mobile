import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import {
  financeSlotAmounts,
  pendingFinanceAmount,
} from "../lib/financeSlots";
import {
  getPeriodRange,
  isDuePeriod,
  periodLabel,
  toDateFilter,
} from "../lib/period";
import { buildDueStatement, getCustomerDue } from "../services/customerDue";
import { chargeBalance, splitDuePayment } from "../lib/dueCharges";
import { upsertCustomerProfile } from "../services/customers";
import { istDateString } from "../lib/ist";

export const duesRouter = Router();

function parseDateInput(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }
  return new Date(value);
}

const entryDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .nullable();

/**
 * When a You gave / You got happened (YYYY-MM-DD, IST). Today or nothing =
 * now; an earlier day = midday that day. Null for a future day.
 */
function entryDate(value: string | null | undefined): Date | null {
  const today = istDateString(new Date());
  if (!value || value === today) return new Date();
  if (value > today) return null;
  return new Date(`${value}T12:00:00.000+05:30`);
}

const financeSlotsSchema = z.object({
  slots: z
    .array(z.union([z.literal(1), z.literal(2)]))
    .min(1, "Select at least one finance payment")
    .max(2),
});

duesRouter.get("/", async (req, res, next) => {
  try {
    const period = isDuePeriod(req.query.period) ? req.query.period : "all";
    const dateFilter = toDateFilter(getPeriodRange(period));

    const isAdmin = req.user?.role === "ADMIN";
    // Staff never see private dues (admins get them with duePrivate set).

    const where: Prisma.BillWhereInput = {
      withGst: false,
      // Below 0 = advance (they paid extra / first): listed as "You will give".
      OR: [{ dueAmount: { gt: 0 } }, { dueAmount: { lt: 0 } }],
      dueSettled: false,
      ...(isAdmin ? {} : { duePrivate: false }),
      ...(dateFilter
        ? {
            AND: [
              {
                OR: [
                  { dueDate: dateFilter },
                  { AND: [{ dueDate: null }, { billDate: dateFilter }] },
                ],
              },
            ],
          }
        : {}),
    };

    const dues = await prisma.bill.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { billDate: "desc" }],
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        customerPhone: true,
        dueAmount: true,
        dueDate: true,
        billDate: true,
        grandTotal: true,
        payableAmount: true,
        isPartialPaid: true,
        duePrivate: true,
        noPurchase: true,
        duePayments: { select: { amount: true } },
        items: {
          select: {
            productName: true,
            color: true,
            storage: true,
            ram: true,
            imei1: true,
            imei2: true,
          },
        },
      },
    });

    const totalDue = dues.reduce((sum, bill) => sum + Math.max(bill.dueAmount, 0), 0);
    const totalAdvance = dues.reduce((sum, bill) => sum + Math.max(-bill.dueAmount, 0), 0);

    res.json({
      data: {
        period,
        periodLabel: periodLabel(period),
        totalDue: Number(totalDue.toFixed(2)),
        /** Khata entries that paid first: you'll give this back. */
        totalAdvance: Number(totalAdvance.toFixed(2)),
        count: dues.length,
        dues: dues.map(({ items, duePayments, ...bill }) => ({
          ...bill,
          /** Paid so far against this due (part payments). */
          paidTotal: Number(
            duePayments.reduce((sum, p) => sum + p.amount, 0).toFixed(2),
          ),
          dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
          billDate: bill.billDate.toISOString(),
          productLabels: items
            .map((item) =>
              [item.productName, item.color, item.storage, item.ram]
                .filter(Boolean)
                .join(" "),
            )
            .filter(Boolean),
          imeiNumbers: items.flatMap((item) =>
            [item.imei1, item.imei2].filter(
              (imei): imei is string => Boolean(imei),
            ),
          ),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

duesRouter.get("/finance", async (_req, res, next) => {
  try {
    const dues = await prisma.bill.findMany({
      where: {
        withGst: false,
        financeAmount: { gt: 0 },
        OR: [
          { financeReceived: false },
          {
            AND: [{ financeAmount2: { gt: 0 } }, { financeReceived2: false }],
          },
        ],
      },
      orderBy: [{ billDate: "asc" }],
      select: {
        id: true,
        invoiceNumber: true,
        billDate: true,
        customerName: true,
        customerPhone: true,
        financeAmount: true,
        financeCompanyName: true,
        financeAmount2: true,
        financeCompanyName2: true,
        financeReceived: true,
        financeReceivedAt: true,
        financeReceived2: true,
        financeReceivedAt2: true,
        items: {
          select: {
            productName: true,
            color: true,
            storage: true,
            ram: true,
            imei1: true,
            imei2: true,
          },
        },
      },
    });

    const mapped = dues.map(({ items, ...bill }) => ({
      ...bill,
      billDate: bill.billDate.toISOString(),
      financeReceivedAt: bill.financeReceivedAt?.toISOString() ?? null,
      financeReceivedAt2: bill.financeReceivedAt2?.toISOString() ?? null,
      pendingFinanceAmount: pendingFinanceAmount(bill),
      productLabels: items
        .map((item) =>
          [item.productName, item.color, item.storage, item.ram]
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean),
      imeiNumbers: items.flatMap((item) =>
        [item.imei1, item.imei2].filter(
          (imei): imei is string => Boolean(imei),
        ),
      ),
    }));

    const totalFinanceDue = mapped.reduce(
      (sum, bill) => sum + bill.pendingFinanceAmount,
      0,
    );

    res.json({
      data: {
        totalFinanceDue: Number(totalFinanceDue.toFixed(2)),
        count: mapped.length,
        dues: mapped,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Whole IST days from `from` to `to` (negative = before). */
function istDays(from: Date, to: Date) {
  const a = Date.parse(`${istDateString(from)}T00:00:00Z`);
  const b = Date.parse(`${istDateString(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * New Bill → Due: what this phone number still owes on other bills, and
 * how it paid dues before (on time / days late). `exclude` = the bill being
 * edited. Staff don't see private dues.
 */
duesRouter.get("/history", async (req, res, next) => {
  try {
    const phone = String(req.query.phone || "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) {
      res.json({ data: null });
      return;
    }
    const exclude = typeof req.query.exclude === "string" ? req.query.exclude : undefined;
    const isAdmin = req.user?.role === "ADMIN";
    const base: Prisma.BillWhereInput = {
      withGst: false,
      customerPhone: phone,
      ...(exclude ? { id: { not: exclude } } : {}),
      ...(isAdmin ? {} : { duePrivate: false }),
    };
    const now = new Date();
    const [open, cleared, advanceRows] = await Promise.all([
      prisma.bill.findMany({
        where: { ...base, dueSettled: false, dueAmount: { gt: 0 } },
        orderBy: [{ dueDate: "asc" }, { billDate: "asc" }],
        select: { invoiceNumber: true, dueAmount: true, dueDate: true, billDate: true, noPurchase: true },
      }),
      prisma.bill.findMany({
        where: { ...base, dueSettled: true, dueAmount: 0, duePayments: { some: {} } },
        orderBy: { dueSettledAt: "desc" },
        take: 50,
        select: {
          invoiceNumber: true,
          dueDate: true,
          dueSettledAt: true,
          duePayments: { orderBy: { paidAt: "desc" }, take: 1, select: { paidAt: true } },
        },
      }),
      prisma.bill.findMany({
        where: { ...base, dueSettled: false, dueAmount: { lt: 0 } },
        select: { dueAmount: true },
      }),
    ]);

    const pending = Number(open.reduce((sum, b) => sum + b.dueAmount, 0).toFixed(2));
    const lateNow = open
      .filter((b) => b.dueDate && b.dueDate < now)
      .map((b) => istDays(b.dueDate as Date, now))
      .filter((d) => d > 0);

    // Past dues, cleared: how late was the last payment vs the promised date.
    const delays = cleared
      .map((b) => {
        const paidAt = b.duePayments[0]?.paidAt ?? b.dueSettledAt;
        if (!b.dueDate || !paidAt) return null;
        return { invoiceNumber: b.invoiceNumber, delayDays: istDays(b.dueDate, paidAt), paidAt };
      })
      .filter((d): d is { invoiceNumber: string; delayDays: number; paidAt: Date } => d !== null);
    const late = delays.filter((d) => d.delayDays > 0);

    res.json({
      data: {
        pending,
        pendingCount: open.length,
        /** Extra money they paid before, kept as advance (you'll give / adjust). */
        advance: Number(advanceRows.reduce((sum, b) => sum - b.dueAmount, 0).toFixed(2)),
        /** Most days past the promised date among the open dues (0 = none late). */
        maxDaysLate: lateNow.length ? Math.max(...lateNow) : 0,
        openBills: open.map((b) => ({
          invoiceNumber: b.noPurchase ? null : b.invoiceNumber,
          dueAmount: Number(b.dueAmount.toFixed(2)),
          daysLate: b.dueDate && b.dueDate < now ? Math.max(istDays(b.dueDate, now), 0) : 0,
        })),
        paidBefore: {
          count: cleared.length,
          withDate: delays.length,
          onTime: delays.length - late.length,
          late: late.length,
          avgDaysLate: late.length
            ? Math.round(late.reduce((s, d) => s + d.delayDays, 0) / late.length)
            : 0,
          maxDaysLate: late.length ? Math.max(...late.map((d) => d.delayDays)) : 0,
          last: delays[0]
            ? {
                invoiceNumber: delays[0].invoiceNumber,
                delayDays: delays[0].delayDays,
                paidAt: delays[0].paidAt.toISOString(),
              }
            : null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Search cleared dues (balance 0, so not on the list): people who once owed
 * or were owed, matched by name, phone or invoice number.
 */
duesRouter.get("/cleared", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 60);
    if (q.length < 2) {
      res.json({ data: [] });
      return;
    }
    const digits = q.replace(/\D/g, "");
    const isAdmin = req.user?.role === "ADMIN";
    const rows = await prisma.bill.findMany({
      where: {
        withGst: false,
        dueAmount: 0,
        ...(isAdmin ? {} : { duePrivate: false }),
        // Only bills that ever had a due (paid later / given / khata entry).
        AND: [
          {
            OR: [
              { noPurchase: true },
              { duePayments: { some: {} } },
              { dueCharges: { some: {} } },
            ],
          },
          {
            OR: [
              { customerName: { contains: q } },
              { invoiceNumber: { contains: q.toUpperCase() } },
              ...(digits.length >= 3 ? [{ customerPhone: { contains: digits } }] : []),
            ],
          },
        ],
      },
      orderBy: [{ dueSettledAt: "desc" }, { billDate: "desc" }],
      take: 30,
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        customerPhone: true,
        billDate: true,
        dueSettledAt: true,
        duePrivate: true,
        noPurchase: true,
        duePayments: { select: { amount: true } },
        items: { select: { productName: true } },
      },
    });
    res.json({
      data: rows.map(({ duePayments, items, ...row }) => ({
        ...row,
        billDate: row.billDate.toISOString(),
        dueSettledAt: row.dueSettledAt?.toISOString() ?? null,
        paidTotal: Number(duePayments.reduce((sum, p) => sum + p.amount, 0).toFixed(2)),
        productLabels: items.map((item) => item.productName).filter(Boolean),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/** One customer due: purchase, payments, promised date and delay. */
duesRouter.get("/:id", async (req, res, next) => {
  try {
    const due = await getCustomerDue(req.params.id);
    if (!due || (due.duePrivate && req.user?.role !== "ADMIN")) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    res.json({ data: due });
  } catch (error) {
    next(error);
  }
});

/** Customer due statement PDF (purchase, every payment, delay). */
duesRouter.get("/:id/statement", async (req, res, next) => {
  try {
    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      select: { duePrivate: true },
    });
    if (bill?.duePrivate && req.user?.role !== "ADMIN") {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    const statement = await buildDueStatement(req.params.id);
    if (!statement) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${statement.filename}"`,
    );
    res.send(statement.pdf);
  } catch (error) {
    next(error);
  }
});

function serializeUpdatedBill(updated: {
  billDate: Date;
  dueDate: Date | null;
  dueSettledAt: Date | null;
  financeReceivedAt: Date | null;
  financeReceivedAt2: Date | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}) {
  return {
    ...updated,
    billDate: updated.billDate.toISOString(),
    dueDate: updated.dueDate?.toISOString() ?? null,
    dueSettledAt: updated.dueSettledAt?.toISOString() ?? null,
    financeReceivedAt: updated.financeReceivedAt?.toISOString() ?? null,
    financeReceivedAt2: updated.financeReceivedAt2?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

duesRouter.patch("/finance/:id/receive", requireAdmin, async (req, res, next) => {
  try {
    const parsed = financeSlotsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Select which finance payment(s) to mark received",
        details: parsed.error.flatten(),
      });
      return;
    }

    const slots = [...new Set(parsed.data.slots)];
    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        financeAmount: true,
        financeAmount2: true,
        financeReceived: true,
        financeReceived2: true,
      },
    });

    if (!bill) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }

    const { amount1, amount2 } = financeSlotAmounts(bill);
    if (amount1 <= 0 && amount2 <= 0) {
      res.status(400).json({ error: "This bill has no finance amount" });
      return;
    }

    const now = new Date();
    const data: Prisma.BillUpdateInput = {};

    for (const slot of slots) {
      if (slot === 1) {
        if (amount1 <= 0) {
          res.status(400).json({ error: "This bill has no first finance amount" });
          return;
        }
        if (bill.financeReceived) {
          res.status(400).json({
            error: "First finance payment is already received",
          });
          return;
        }
        data.financeReceived = true;
        data.financeReceivedAt = now;
      } else {
        if (amount2 <= 0) {
          res.status(400).json({
            error: "This bill has no second finance amount",
          });
          return;
        }
        if (bill.financeReceived2) {
          res.status(400).json({
            error: "Second finance payment is already received",
          });
          return;
        }
        data.financeReceived2 = true;
        data.financeReceivedAt2 = now;
      }
    }

    const updated = await prisma.bill.update({
      where: { id: bill.id },
      data,
      include: { items: true },
    });

    res.json({ data: serializeUpdatedBill(updated) });
  } catch (error) {
    next(error);
  }
});

duesRouter.patch(
  "/finance/:id/unreceive",
  requireAdmin,
  async (req, res, next) => {
    try {
      const parsed = financeSlotsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: "Select which finance payment(s) to undo",
          details: parsed.error.flatten(),
        });
        return;
      }

      const slots = [...new Set(parsed.data.slots)];
      const bill = await prisma.bill.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          financeAmount: true,
          financeAmount2: true,
          financeReceived: true,
          financeReceived2: true,
        },
      });

      if (!bill) {
        res.status(404).json({ error: "Bill not found" });
        return;
      }

      const { amount1, amount2 } = financeSlotAmounts(bill);
      if (amount1 <= 0 && amount2 <= 0) {
        res.status(400).json({ error: "This bill has no finance amount" });
        return;
      }

      const data: Prisma.BillUpdateInput = {};

      for (const slot of slots) {
        if (slot === 1) {
          if (amount1 <= 0) {
            res.status(400).json({
              error: "This bill has no first finance amount",
            });
            return;
          }
          if (!bill.financeReceived) {
            res.status(400).json({
              error: "First finance payment is already pending",
            });
            return;
          }
          data.financeReceived = false;
          data.financeReceivedAt = null;
        } else {
          if (amount2 <= 0) {
            res.status(400).json({
              error: "This bill has no second finance amount",
            });
            return;
          }
          if (!bill.financeReceived2) {
            res.status(400).json({
              error: "Second finance payment is already pending",
            });
            return;
          }
          data.financeReceived2 = false;
          data.financeReceivedAt2 = null;
        }
      }

      const updated = await prisma.bill.update({
        where: { id: bill.id },
        data,
        include: { items: true },
      });

      res.json({ data: serializeUpdatedBill(updated) });
    } catch (error) {
      next(error);
    }
  },
);

const settleSchema = z
  .object({
    mode: z.enum(["full", "custom"]).default("full"),
    method: z.enum(["cash", "online", "card", "na"]),
    amount: z.number().positive().optional(),
    nextDueDate: z.string().optional().nullable(),
    /** Day the money was received (default today). */
    paidAt: entryDateField,
  })
  .superRefine((data, ctx) => {
    if (data.mode === "custom") {
      if (data.amount == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter the amount collected",
          path: ["amount"],
        });
      }
    }
  });

duesRouter.patch("/:id/settle", requireAdmin, async (req, res, next) => {
  try {
    const parsed = settleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid settlement details",
        details: parsed.error.flatten(),
      });
      return;
    }

    const bill = await prisma.bill.findUnique({ where: { id: req.params.id } });
    if (!bill) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }

    // Khata entry (no purchase): any amount; above what's owed becomes an
    // advance (balance below 0). No bill totals to touch.
    if (bill.noPurchase) {
      const balance = bill.dueSettled ? 0 : bill.dueAmount;
      const amount = Number(
        (parsed.data.mode === "full" ? Math.max(balance, 0) : parsed.data.amount || 0).toFixed(2),
      );
      if (amount <= 0) {
        res.status(400).json({ error: "Enter the amount you got" });
        return;
      }
      const left = Number((balance - amount).toFixed(2));
      const cleared = Math.abs(left) < 0.005;
      const paidAt = entryDate(parsed.data.paidAt);
      if (!paidAt) {
        res.status(400).json({ error: "The date can't be in the future" });
        return;
      }
      await prisma.bill.update({
        where: { id: bill.id },
        data: {
          dueAmount: cleared ? 0 : left,
          dueSettled: cleared,
          dueSettledMethod: parsed.data.method,
          dueSettledAt: paidAt,
          isPartialPaid: false,
          duePayments: {
            create: {
              amount,
              method: parsed.data.method,
              kind: left <= 0.005 ? "full" : "partial",
              paidAt,
              chargePart: amount,
            },
          },
        },
      });
      res.json({ data: await getCustomerDue(bill.id) });
      return;
    }

    if (bill.withGst) {
      res.status(400).json({ error: "GST invoices don't have dues" });
      return;
    }

    const { mode, method } = parsed.data;
    // Signed: below 0 = extra money already kept as advance.
    const currentDue = bill.dueSettled ? 0 : bill.dueAmount;
    const paidAmount = Number(
      (mode === "full" ? Math.max(currentDue, 0) : parsed.data.amount || 0).toFixed(2),
    );

    if (paidAmount <= 0) {
      res.status(400).json({ error: "Paid amount must be greater than 0" });
      return;
    }

    // More than what's pending is fine: the extra is kept as an advance
    // (balance below 0, "You will give").
    const remaining = Number((currentDue - paidAmount).toFixed(2));
    const cleared = Math.abs(remaining) < 0.005;
    const isFull = remaining <= 0.005;
    // Bill's own due first; anything over that clears "You gave" amounts or
    // becomes advance (kept off the bill's cash / online / card).
    const { billPart, chargePart } = splitDuePayment(
      paidAmount,
      currentDue,
      await chargeBalance(prisma, bill.id),
    );

    const paidAt = entryDate(parsed.data.paidAt);
    if (!paidAt) {
      res.status(400).json({ error: "The date can't be in the future" });
      return;
    }
    const updated = await prisma.bill.update({
      where: { id: bill.id },
      data: {
        dueAmount: cleared ? 0 : remaining,
        dueSettled: cleared,
        dueSettledMethod: method,
        dueSettledAt: paidAt,
        isPartialPaid: !isFull,
        // A part payment keeps the promised date unless a new one is given,
        // so the delay is still counted from what the customer promised.
        dueDate:
          !isFull && parsed.data.nextDueDate
            ? parseDateInput(parsed.data.nextDueDate)
            : bill.dueDate,
        cashAmount:
          method === "cash"
            ? Number((bill.cashAmount + billPart).toFixed(2))
            : bill.cashAmount,
        onlineAmount:
          method === "online"
            ? Number((bill.onlineAmount + billPart).toFixed(2))
            : bill.onlineAmount,
        cardAmount:
          method === "card"
            ? Number((bill.cardAmount + billPart).toFixed(2))
            : bill.cardAmount,
        duePayments: {
          create: {
            amount: paidAmount,
            method,
            kind: isFull ? "full" : "partial",
            paidAt,
            chargePart,
            dueDateBefore:
              !isFull && parsed.data.nextDueDate ? bill.dueDate : null,
          },
        },
      },
      include: {
        items: true,
        duePayments: { orderBy: { paidAt: "asc" } },
      },
    });

    res.json({
      data: {
        ...updated,
        billDate: updated.billDate.toISOString(),
        dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
        dueSettledAt: updated.dueSettledAt
          ? updated.dueSettledAt.toISOString()
          : null,
        financeReceivedAt: updated.financeReceivedAt?.toISOString() ?? null,
        financeReceivedAt2: updated.financeReceivedAt2?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        duePayments: updated.duePayments.map((payment) => ({
          ...payment,
          paidAt: payment.paidAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Undo the latest payment received on a due: the amount goes back to the
 * pending due and comes off the bill's cash / online / card total. Only the
 * newest payment can be undone, so the balances in the history stay right.
 */
duesRouter.delete(
  "/:id/payments/:paymentId",
  requireAdmin,
  async (req, res, next) => {
    try {
      const bill = await prisma.bill.findUnique({
        where: { id: req.params.id },
        include: { duePayments: { orderBy: { paidAt: "asc" } } },
      });
      if (!bill) {
        res.status(404).json({ error: "Bill not found" });
        return;
      }
      const payment = bill.duePayments.find((p) => p.id === req.params.paymentId);
      if (!payment) {
        res.status(404).json({ error: "Payment not found" });
        return;
      }
      const laterCharge = await prisma.dueCharge.findFirst({
        where: { billId: bill.id, givenAt: { gt: payment.paidAt } },
        select: { id: true },
      });
      if (bill.duePayments.at(-1)?.id !== payment.id || laterCharge) {
        res.status(400).json({ error: "Only the latest entry can be undone" });
        return;
      }

      const round = (value: number) => Number(value.toFixed(2));
      const takeBack = (total: number, method: string) =>
        payment.method === method
          ? round(Math.max(total - (payment.amount - payment.chargePart), 0))
          : total;
      const cashAmount = takeBack(bill.cashAmount, "cash");
      const onlineAmount = takeBack(bill.onlineAmount, "online");
      const cardAmount = takeBack(bill.cardAmount, "card");
      const previous = bill.duePayments.at(-2) ?? null;

      if (bill.noPurchase) {
        const balance = round((bill.dueSettled ? 0 : bill.dueAmount) + payment.amount);
        const cleared = Math.abs(balance) < 0.005;
        await prisma.$transaction([
          prisma.duePayment.delete({ where: { id: payment.id } }),
          prisma.bill.update({
            where: { id: bill.id },
            data: {
              dueAmount: cleared ? 0 : balance,
              dueSettled: cleared,
              dueSettledMethod: previous?.method ?? null,
              dueSettledAt: previous?.paidAt ?? null,
            },
          }),
        ]);
        res.json({ data: await getCustomerDue(bill.id) });
        return;
      }

      // Signed: undoing a payment that left an advance just shrinks it.
      const balanceAfter = round((bill.dueSettled ? 0 : bill.dueAmount) + payment.amount);
      const clearedAfter = Math.abs(balanceAfter) < 0.005;
      await prisma.$transaction([
        prisma.duePayment.delete({ where: { id: payment.id } }),
        prisma.bill.update({
          where: { id: bill.id },
          data: {
            dueAmount: clearedAfter ? 0 : balanceAfter,
            dueSettled: clearedAfter,
            dueSettledMethod: previous?.method ?? null,
            dueSettledAt: previous?.paidAt ?? null,
            dueDate: payment.dueDateBefore ?? bill.dueDate,
            cashAmount,
            onlineAmount,
            cardAmount,
            // Same rule as a bill edit: due left and something already paid.
            isPartialPaid:
              balanceAfter > 0.005 &&
              cashAmount + onlineAmount + cardAmount + bill.financeAmount + bill.financeAmount2 > 0,
          },
        }),
      ]);

      res.json({ data: await getCustomerDue(bill.id) });
    } catch (error) {
      next(error);
    }
  },
);

const giveSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  note: z.string().trim().max(200).optional().nullable(),
  /** New "collect by" date (YYYY-MM-DD), optional. */
  dueDate: z.string().optional().nullable(),
  /** Day the money was given (default today). */
  givenAt: entryDateField,
});

/**
 * "You gave": money given to (or an amount added for) the customer on this
 * due without a new bill, e.g. cash lent or an old balance. It raises what
 * the customer owes; the bill's own totals stay as they are.
 */
duesRouter.post("/:id/charges", requireAdmin, async (req, res, next) => {
  try {
    const parsed = giveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter the amount you gave", details: parsed.error.flatten() });
      return;
    }
    const bill = await prisma.bill.findUnique({ where: { id: req.params.id } });
    if (!bill) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    if (bill.withGst) {
      res.status(400).json({ error: "GST invoices don't have dues" });
      return;
    }

    const givenAt = entryDate(parsed.data.givenAt);
    if (!givenAt) {
      res.status(400).json({ error: "The date can't be in the future" });
      return;
    }
    const amount = Number(parsed.data.amount.toFixed(2));
    // Signed (below 0 = advance: they paid extra / first).
    const pendingBefore = bill.dueSettled ? 0 : bill.dueAmount;
    const pendingAfter = Number((pendingBefore + amount).toFixed(2));
    const newDate = parsed.data.dueDate ? parseDateInput(parsed.data.dueDate) : null;
    const paidSoFar =
      bill.cashAmount + bill.onlineAmount + bill.cardAmount + bill.financeAmount;

    await prisma.$transaction([
      prisma.dueCharge.create({
        data: {
          billId: bill.id,
          amount,
          note: parsed.data.note?.trim() || null,
          givenAt,
          dueDateBefore: bill.dueDate,
          createdByName: req.user?.name ?? null,
        },
      }),
      prisma.bill.update({
        where: { id: bill.id },
        data: {
          dueAmount: Math.abs(pendingAfter) < 0.005 ? 0 : pendingAfter,
          dueSettled: Math.abs(pendingAfter) < 0.005,
          isPartialPaid: pendingAfter > 0.005 && paidSoFar > 0,
          ...(newDate ? { dueDate: newDate } : {}),
        },
      }),
    ]);

    res.json({ data: await getCustomerDue(bill.id) });
  } catch (error) {
    next(error);
  }
});

/** Undo the latest "You gave" (only while nothing came after it). */
duesRouter.delete("/:id/charges/:chargeId", requireAdmin, async (req, res, next) => {
  try {
    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: {
        dueCharges: { orderBy: { givenAt: "asc" } },
        duePayments: { orderBy: { paidAt: "asc" } },
      },
    });
    if (!bill) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    const charge = bill.dueCharges.find((c) => c.id === req.params.chargeId);
    if (!charge) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    const lastPayment = bill.duePayments.at(-1);
    if (
      bill.dueCharges.at(-1)?.id !== charge.id ||
      (lastPayment && lastPayment.paidAt > charge.givenAt)
    ) {
      res.status(400).json({ error: "Only the latest entry can be undone" });
      return;
    }

    const pending = bill.dueSettled ? 0 : bill.dueAmount;
    const left = Number((pending - charge.amount).toFixed(2));
    const cleared = Math.abs(left) < 0.005;

    await prisma.$transaction([
      prisma.dueCharge.delete({ where: { id: charge.id } }),
      prisma.bill.update({
        where: { id: bill.id },
        data: {
          dueAmount: cleared ? 0 : left,
          dueSettled: cleared && (bill.noPurchase || bill.duePayments.length > 0),
          isPartialPaid: left <= 0.005
            ? false
            : bill.cashAmount + bill.onlineAmount + bill.cardAmount + bill.financeAmount > 0,
          dueDate: charge.dueDateBefore,
          ...(cleared && lastPayment
            ? { dueSettledMethod: lastPayment.method, dueSettledAt: lastPayment.paidAt }
            : {}),
        },
      }),
    ]);

    res.json({ data: await getCustomerDue(bill.id) });
  } catch (error) {
    next(error);
  }
});

/** Change (or clear) the date the customer promised to pay by. */
duesRouter.patch("/:id/due-date", requireAdmin, async (req, res, next) => {
  try {
    const parsed = z
      .object({ dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Pick a valid date" });
      return;
    }
    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      select: { id: true, withGst: true },
    });
    if (!bill || bill.withGst) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    await prisma.bill.update({
      where: { id: bill.id },
      data: { dueDate: parsed.data.dueDate ? parseDateInput(parsed.data.dueDate) : null },
    });
    res.json({ data: await getCustomerDue(bill.id) });
  } catch (error) {
    next(error);
  }
});

const personSchema = z.object({
  customerName: z.string().trim().min(1, "Enter the name").max(80),
  customerPhone: z.string().trim().regex(/^\d{10}$/, "Enter a 10-digit number"),
  /** gave: you gave money (they owe you). got: they gave you money first. */
  direction: z.enum(["gave", "got"]),
  amount: z.number().positive().max(10_000_000),
  /** For "got": how you received it. */
  method: z.enum(["cash", "online", "card", "na"]).optional(),
  note: z.string().trim().max(200).optional().nullable(),
  /** "Collect by" date (YYYY-MM-DD) for money you gave. */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  /** Day the money was given / received (default today). */
  entryDate: entryDateField,
});

/**
 * New khata entry without a purchase (Dues page "+"): someone you gave money
 * to, or who gave you money. Stored as a bill with no items and totals 0
 * (noPurchase), so it gets the same due page: You gave / You got, undo, PDF.
 */
duesRouter.post("/people", requireAdmin, async (req, res, next) => {
  try {
    const parsed = personSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message;
      res.status(400).json({ error: first || "Check the details", details: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;
    const amount = Number(input.amount.toFixed(2));
    const gave = input.direction === "gave";
    const now = entryDate(input.entryDate);
    if (!now) {
      res.status(400).json({ error: "The date can't be in the future" });
      return;
    }
    const name = input.customerName.replace(/\s+/g, " ");
    const invoiceNumber = `KH-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296)
      .toString(36)
      .toUpperCase()
      .padStart(2, "0")}`;

    const bill = await prisma.$transaction(async (tx) => {
      const created = await tx.bill.create({
        data: {
          invoiceNumber,
          billDate: now,
          customerName: name,
          customerPhone: input.customerPhone,
          withGst: false,
          noPurchase: true,
          subtotal: 0,
          gstAmount: 0,
          grandTotal: 0,
          payableAmount: 0,
          dueAmount: gave ? amount : -amount,
          dueSettled: false,
          dueDate: gave && input.dueDate ? parseDateInput(input.dueDate) : null,
          createdByUserId: req.user?.id ?? null,
          createdByName: req.user?.name ?? null,
          createdByRole: req.user?.role ?? null,
          ...(gave
            ? {
                dueCharges: {
                  create: {
                    amount,
                    note: input.note?.trim() || null,
                    givenAt: now,
                    createdByName: req.user?.name ?? null,
                  },
                },
              }
            : {
                dueSettledMethod: input.method ?? "cash",
                dueSettledAt: now,
                duePayments: {
                  create: {
                    amount,
                    method: input.method ?? "cash",
                    kind: "full",
                    paidAt: now,
                    note: input.note?.trim() || null,
                    chargePart: amount,
                  },
                },
              }),
        },
      });
      await upsertCustomerProfile(tx, { customerName: name, customerPhone: input.customerPhone });
      return created;
    });

    res.status(201).json({ data: await getCustomerDue(bill.id) });
  } catch (error) {
    next(error);
  }
});
