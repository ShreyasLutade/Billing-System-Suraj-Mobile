import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import {
  getPeriodRange,
  isDuePeriod,
  periodLabel,
  toDateFilter,
} from "../lib/period";

export const duesRouter = Router();

function parseDateInput(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }
  return new Date(value);
}

duesRouter.get("/", async (req, res, next) => {
  try {
    const period = isDuePeriod(req.query.period) ? req.query.period : "all";
    const dateFilter = toDateFilter(getPeriodRange(period));

    const where: Prisma.BillWhereInput = {
      withGst: false,
      dueAmount: { gt: 0 },
      dueSettled: false,
      ...(dateFilter
        ? {
            OR: [
              { dueDate: dateFilter },
              { AND: [{ dueDate: null }, { billDate: dateFilter }] },
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

    const totalDue = dues.reduce((sum, bill) => sum + bill.dueAmount, 0);

    res.json({
      data: {
        period,
        periodLabel: periodLabel(period),
        totalDue: Number(totalDue.toFixed(2)),
        count: dues.length,
        dues: dues.map(({ items, ...bill }) => ({
          ...bill,
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
        financeReceived: false,
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

    const totalFinanceDue = dues.reduce(
      (sum, bill) => sum + bill.financeAmount,
      0,
    );

    res.json({
      data: {
        totalFinanceDue: Number(totalFinanceDue.toFixed(2)),
        count: dues.length,
        dues: dues.map(({ items, ...bill }) => ({
          ...bill,
          billDate: bill.billDate.toISOString(),
          financeReceivedAt: bill.financeReceivedAt?.toISOString() ?? null,
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

duesRouter.patch("/finance/:id/receive", requireAdmin, async (req, res, next) => {
  try {
    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        financeAmount: true,
        financeReceived: true,
      },
    });

    if (!bill) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    if (bill.financeAmount <= 0) {
      res.status(400).json({ error: "This bill has no finance amount" });
      return;
    }
    if (bill.financeReceived) {
      res.status(400).json({ error: "Finance amount is already received" });
      return;
    }

    const updated = await prisma.bill.update({
      where: { id: bill.id },
      data: {
        financeReceived: true,
        financeReceivedAt: new Date(),
      },
      include: { items: true },
    });

    res.json({
      data: {
        ...updated,
        billDate: updated.billDate.toISOString(),
        dueDate: updated.dueDate?.toISOString() ?? null,
        dueSettledAt: updated.dueSettledAt?.toISOString() ?? null,
        financeReceivedAt: updated.financeReceivedAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

const settleSchema = z
  .object({
    mode: z.enum(["full", "custom"]).default("full"),
    method: z.enum(["cash", "online", "na"]),
    amount: z.number().positive().optional(),
    nextDueDate: z.string().optional().nullable(),
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
    if (bill.dueAmount <= 0 || bill.dueSettled) {
      res.status(400).json({ error: "This bill has no pending due" });
      return;
    }

    const { mode, method } = parsed.data;
    const currentDue = bill.dueAmount;
    let paidAmount =
      mode === "full"
        ? currentDue
        : Number((parsed.data.amount || 0).toFixed(2));

    if (paidAmount <= 0) {
      res.status(400).json({ error: "Paid amount must be greater than 0" });
      return;
    }
    if (paidAmount > currentDue) {
      res.status(400).json({
        error: "Paid amount cannot exceed the pending due",
      });
      return;
    }

    // Treat exact/full payment as fully settled
    const isFull = mode === "full" || paidAmount >= currentDue;
    if (isFull) {
      paidAmount = currentDue;
    }

    const remaining = Number((currentDue - paidAmount).toFixed(2));

    if (!isFull) {
      if (!parsed.data.nextDueDate) {
        res.status(400).json({
          error: "Select next due date for the remaining amount",
        });
        return;
      }
    }

    const paidAt = new Date();
    const updated = await prisma.bill.update({
      where: { id: bill.id },
      data: {
        dueAmount: isFull ? 0 : remaining,
        dueSettled: isFull,
        dueSettledMethod: method,
        dueSettledAt: paidAt,
        isPartialPaid: isFull ? false : true,
        dueDate: isFull
          ? bill.dueDate
          : parseDateInput(parsed.data.nextDueDate as string),
        cashAmount:
          method === "cash"
            ? Number((bill.cashAmount + paidAmount).toFixed(2))
            : bill.cashAmount,
        onlineAmount:
          method === "online"
            ? Number((bill.onlineAmount + paidAmount).toFixed(2))
            : bill.onlineAmount,
        duePayments: {
          create: {
            amount: paidAmount,
            method,
            kind: isFull ? "full" : "partial",
            paidAt,
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
