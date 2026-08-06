import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  computeBillTotals,
  createBillSchema,
} from "../lib/billing";
import { getPeriodRange, isActivityPeriod, toDateFilter } from "../lib/period";
import { buildInvoicePdf } from "../services/pdf";
import { upsertMobileCatalog } from "../services/mobileCatalog";
import {
  releaseStockIds,
  syncStockForBillItems,
} from "../services/stockSync";
import { requireAdmin } from "../middleware/auth";

export const billsRouter = Router();

function parseDateInput(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }
  return new Date(value);
}

async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  withGst = false,
) {
  if (withGst) {
    // Separate series for GST submission invoices: SMS-GST-3000, 3001, …
    const sequence = await tx.invoiceSequence.upsert({
      where: { id: 2 },
      create: { id: 2, counter: 3000 },
      update: { counter: { increment: 1 } },
    });
    return `SMS-GST-${sequence.counter}`;
  }

  const year = new Date().getFullYear();
  const sequence = await tx.invoiceSequence.upsert({
    where: { id: 1 },
    create: { id: 1, counter: 1 },
    update: { counter: { increment: 1 } },
  });
  return `SMS-${year}-${String(sequence.counter).padStart(4, "0")}`;
}

function totalsForPersist(
  input: { withGst?: boolean },
  totals: ReturnType<typeof computeBillTotals>,
) {
  if (!input.withGst) return totals;
  // GST invoices are submission-only — no payments, dues, exchange, or stock links
  return {
    ...totals,
    payableAmount: totals.grandTotal,
    cashAmount: 0,
    onlineAmount: 0,
    financeAmount: 0,
    financeAmount2: 0,
    dueAmount: 0,
    items: totals.items.map((item) => ({
      ...item,
      stockItemId: null,
    })),
  };
}

function exchangeInputForPersist<T extends { withGst?: boolean; isExchange?: boolean }>(
  input: T,
): T {
  if (!input.withGst) return input;
  return { ...input, isExchange: false };
}

async function resolveExchangeCatalog(
  tx: Prisma.TransactionClient,
  input: {
    isExchange?: boolean;
    exchangeModel?: string | null;
    exchangePlatform?: "IOS" | "ANDROID" | null;
    exchangeColor?: string | null;
    exchangeStorage?: string | null;
    exchangeRam?: string | null;
  },
) {
  if (
    !input.isExchange ||
    !input.exchangeModel?.trim() ||
    !input.exchangePlatform ||
    !input.exchangeColor?.trim() ||
    !input.exchangeStorage?.trim()
  ) {
    return {
      exchangePlatform: null as string | null,
      exchangeColor: null as string | null,
      exchangeStorage: null as string | null,
      exchangeRam: null as string | null,
      exchangeMobileCatalogId: null as string | null,
      exchangeModel: input.isExchange
        ? input.exchangeModel?.trim() || null
        : null,
    };
  }

  const { mobile } = await upsertMobileCatalog(tx, {
    name: input.exchangeModel,
    platform: input.exchangePlatform,
    condition: "USED",
    color: input.exchangeColor,
    storage: input.exchangeStorage,
    ram: input.exchangeRam,
  });

  return {
    exchangeModel: mobile.name,
    exchangePlatform: mobile.platform,
    exchangeColor: mobile.color,
    exchangeStorage: mobile.storage,
    exchangeRam: mobile.ram || null,
    exchangeMobileCatalogId: mobile.id,
  };
}

function serializeBill<
  T extends {
    billDate: Date;
    dueDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
    dueSettledAt?: Date | null;
    financeReceivedAt?: Date | null;
    duePayments?: Array<{
      id: string;
      amount: number;
      method: string;
      kind: string;
      paidAt: Date;
      note?: string | null;
    }>;
  },
>(bill: T) {
  const { duePayments, ...rest } = bill;
  return {
    ...rest,
    billDate: bill.billDate.toISOString(),
    dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
    dueSettledAt: bill.dueSettledAt ? bill.dueSettledAt.toISOString() : null,
    financeReceivedAt: bill.financeReceivedAt
      ? bill.financeReceivedAt.toISOString()
      : null,
    createdAt: bill.createdAt.toISOString(),
    updatedAt: bill.updatedAt.toISOString(),
    duePayments: (duePayments || []).map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      method: payment.method,
      kind: payment.kind,
      paidAt: payment.paidAt.toISOString(),
      note: payment.note ?? null,
    })),
  };
}

const billDetailInclude = {
  items: true,
  duePayments: { orderBy: { paidAt: "asc" as const } },
} satisfies Prisma.BillInclude;

billsRouter.get("/", async (req, res, next) => {
  try {
    const period = isActivityPeriod(req.query.period)
      ? req.query.period
      : "all";
    const billDateFilter = toDateFilter(getPeriodRange(period));
    const where: Prisma.BillWhereInput = billDateFilter
      ? { billDate: billDateFilter }
      : {};

    if (req.query.withGst === "true") {
      where.withGst = true;
    } else if (req.query.withGst === "false") {
      where.withGst = false;
    }

    const bills = await prisma.bill.findMany({
      where,
      include: { items: true },
      orderBy: { billDate: "desc" },
    });
    res.json({ data: bills.map(serializeBill), period });
  } catch (error) {
    next(error);
  }
});

billsRouter.get("/:id", async (req, res, next) => {
  try {
    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: billDetailInclude,
    });
    if (!bill) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    res.json({ data: serializeBill(bill) });
  } catch (error) {
    next(error);
  }
});

billsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createBillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const input = parsed.data;
    const totals = totalsForPersist(input, computeBillTotals(input));

    const bill = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx, Boolean(input.withGst));

      let financeCompanyId: string | null = null;
      let financeCompanyName: string | null = null;
      let financeCompanyId2: string | null = null;
      let financeCompanyName2: string | null = null;

      if (input.useFinance) {
        if (input.financeCompanyId) {
          const company = await tx.financeCompany.findUnique({
            where: { id: input.financeCompanyId },
          });
          if (!company) {
            throw new Error("FINANCE_COMPANY_NOT_FOUND");
          }
          financeCompanyId = company.id;
          financeCompanyName = company.name;
        } else if (input.financeCompanyName?.trim()) {
          const name = input.financeCompanyName.trim().replace(/\s+/g, " ");
          const company = await tx.financeCompany.upsert({
            where: { name },
            create: { name },
            update: {},
          });
          financeCompanyId = company.id;
          financeCompanyName = company.name;
        }

        if (totals.financeAmount2 > 0) {
          if (input.financeCompanyId2) {
            const company = await tx.financeCompany.findUnique({
              where: { id: input.financeCompanyId2 },
            });
            if (!company) {
              throw new Error("FINANCE_COMPANY_NOT_FOUND");
            }
            financeCompanyId2 = company.id;
            financeCompanyName2 = company.name;
          } else if (input.financeCompanyName2?.trim()) {
            const name = input.financeCompanyName2.trim().replace(/\s+/g, " ");
            const company = await tx.financeCompany.upsert({
              where: { name },
              create: { name },
              update: {},
            });
            financeCompanyId2 = company.id;
            financeCompanyName2 = company.name;
          }
        }
      }

      const persistInput = exchangeInputForPersist(input);
      const exchange = await resolveExchangeCatalog(tx, persistInput);

      await syncStockForBillItems(tx, totals.items);

      return tx.bill.create({
        data: {
          invoiceNumber,
          billDate: input.billDate
            ? parseDateInput(input.billDate)
            : new Date(),
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress || null,
          notes: input.notes || null,
          withGst: Boolean(input.withGst),
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          grandTotal: totals.grandTotal,
          payableAmount: totals.payableAmount,
          cashAmount: totals.cashAmount,
          onlineAmount: totals.onlineAmount,
          financeAmount: totals.financeAmount,
          financeAmount2: totals.financeAmount2,
          // Use relation connect — avoids Prisma validation errors when the
          // generated client is briefly out of sync with scalar FK fields.
          ...(financeCompanyId
            ? {
                financeCompany: { connect: { id: financeCompanyId } },
                financeCompanyName,
              }
            : { financeCompanyName: null }),
          financeCompanyId2,
          financeCompanyName2,
          isExchange: Boolean(persistInput.isExchange),
          exchangeModel: exchange.exchangeModel,
          exchangePlatform: exchange.exchangePlatform,
          exchangeColor: exchange.exchangeColor,
          exchangeStorage: exchange.exchangeStorage,
          exchangeRam: exchange.exchangeRam,
          exchangeMobileCatalogId: exchange.exchangeMobileCatalogId,
          exchangeImei1: persistInput.isExchange
            ? input.exchangeImei1?.trim() || null
            : null,
          exchangeImei2: persistInput.isExchange
            ? input.exchangeImei2?.trim() || null
            : null,
          exchangeSerial: persistInput.isExchange
            ? input.exchangeSerial?.trim() || null
            : null,
          exchangeValue: persistInput.isExchange
            ? input.exchangeValue ?? null
            : null,
          exchangeNotes: persistInput.isExchange
            ? input.exchangeNotes?.trim() || null
            : null,
          dueAmount: totals.dueAmount,
          dueDate:
            totals.dueAmount > 0 && input.dueDate
              ? parseDateInput(input.dueDate)
              : null,
          createdByUserId: req.user?.id || null,
          createdByName: req.user?.name || null,
          createdByRole: req.user?.role || null,
          items: {
            create: totals.items.map((item) => ({
              productName: item.productName,
              mobileCatalogId: item.mobileCatalogId,
              stockItemId: item.stockItemId || null,
              platform: item.platform,
              color: item.color,
              storage: item.storage,
              ram: item.ram,
              condition: item.condition,
              quantity: item.quantity,
              rate: item.rate,
              gstPercent: item.gstPercent,
              amount: item.amount,
              imei1: item.imei1,
              imei2: item.imei2,
              serialNumber: item.serialNumber,
              warrantyMonths: item.warrantyMonths,
            })),
          },
        },
        include: { items: true },
      });
    });

    res.status(201).json({ data: serializeBill(bill) });
  } catch (error) {
    if (error instanceof Error && error.message === "FINANCE_COMPANY_NOT_FOUND") {
      res.status(400).json({ error: "Selected finance company was not found" });
      return;
    }
    if (error instanceof Error && error.message === "STOCK_NOT_FOUND") {
      res.status(400).json({ error: "Selected stock phone was not found" });
      return;
    }
    if (error instanceof Error && error.message === "STOCK_UNAVAILABLE") {
      res.status(400).json({
        error: "One of the selected phones is already sold or unavailable",
      });
      return;
    }
    if (error instanceof Error && error.message === "STOCK_DUPLICATE") {
      res.status(400).json({
        error: "The same stock phone cannot be added twice on one bill",
      });
      return;
    }
    if (error instanceof Error && error.message === "STOCK_IMEI_MISMATCH") {
      res.status(400).json({
        error: "IMEI does not match the selected stock phone",
      });
      return;
    }
    next(error);
  }
});

billsRouter.put("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }

    const parsed = createBillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const input = parsed.data;
    const totals = totalsForPersist(input, computeBillTotals(input));

    const bill = await prisma.$transaction(async (tx) => {
      let financeCompanyId: string | null = null;
      let financeCompanyName: string | null = null;
      let financeCompanyId2: string | null = null;
      let financeCompanyName2: string | null = null;

      if (input.useFinance) {
        if (input.financeCompanyId) {
          const company = await tx.financeCompany.findUnique({
            where: { id: input.financeCompanyId },
          });
          if (!company) {
            throw new Error("FINANCE_COMPANY_NOT_FOUND");
          }
          financeCompanyId = company.id;
          financeCompanyName = company.name;
        } else if (input.financeCompanyName?.trim()) {
          const name = input.financeCompanyName.trim().replace(/\s+/g, " ");
          const company = await tx.financeCompany.upsert({
            where: { name },
            create: { name },
            update: {},
          });
          financeCompanyId = company.id;
          financeCompanyName = company.name;
        }

        if (totals.financeAmount2 > 0) {
          if (input.financeCompanyId2) {
            const company = await tx.financeCompany.findUnique({
              where: { id: input.financeCompanyId2 },
            });
            if (!company) {
              throw new Error("FINANCE_COMPANY_NOT_FOUND");
            }
            financeCompanyId2 = company.id;
            financeCompanyName2 = company.name;
          } else if (input.financeCompanyName2?.trim()) {
            const name = input.financeCompanyName2.trim().replace(/\s+/g, " ");
            const company = await tx.financeCompany.upsert({
              where: { name },
              create: { name },
              update: {},
            });
            financeCompanyId2 = company.id;
            financeCompanyName2 = company.name;
          }
        }
      }

      await tx.billItem.deleteMany({ where: { billId: existing.id } });
      const financeDetailsUnchanged =
        input.useFinance &&
        existing.financeAmount === totals.financeAmount &&
        existing.financeAmount2 === totals.financeAmount2 &&
        existing.financeCompanyId === financeCompanyId &&
        existing.financeCompanyId2 === financeCompanyId2;

      const persistInput = exchangeInputForPersist(input);
      const exchange = await resolveExchangeCatalog(tx, persistInput);

      const previousStockIds = existing.items
        .map((item) => item.stockItemId)
        .filter((id): id is string => Boolean(id));
      await syncStockForBillItems(tx, totals.items, previousStockIds);

      return tx.bill.update({
        where: { id: existing.id },
        data: {
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress || null,
          notes: input.notes || null,
          withGst: Boolean(input.withGst),
          ...(input.billDate
            ? { billDate: parseDateInput(input.billDate) }
            : {}),
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          grandTotal: totals.grandTotal,
          payableAmount: totals.payableAmount,
          cashAmount: totals.cashAmount,
          onlineAmount: totals.onlineAmount,
          financeAmount: totals.financeAmount,
          financeAmount2: totals.financeAmount2,
          ...(financeCompanyId
            ? {
                financeCompany: { connect: { id: financeCompanyId } },
                financeCompanyName,
              }
            : {
                financeCompany: { disconnect: true },
                financeCompanyName: null,
              }),
          financeCompanyId2,
          financeCompanyName2,
          financeReceived:
            financeDetailsUnchanged && existing.financeReceived,
          financeReceivedAt:
            financeDetailsUnchanged && existing.financeReceived
              ? existing.financeReceivedAt
              : null,
          isExchange: Boolean(persistInput.isExchange),
          exchangeModel: exchange.exchangeModel,
          exchangePlatform: exchange.exchangePlatform,
          exchangeColor: exchange.exchangeColor,
          exchangeStorage: exchange.exchangeStorage,
          exchangeRam: exchange.exchangeRam,
          exchangeMobileCatalogId: exchange.exchangeMobileCatalogId,
          exchangeImei1: persistInput.isExchange
            ? input.exchangeImei1?.trim() || null
            : null,
          exchangeImei2: persistInput.isExchange
            ? input.exchangeImei2?.trim() || null
            : null,
          exchangeSerial: persistInput.isExchange
            ? input.exchangeSerial?.trim() || null
            : null,
          exchangeValue: persistInput.isExchange
            ? input.exchangeValue ?? null
            : null,
          exchangeNotes: persistInput.isExchange
            ? input.exchangeNotes?.trim() || null
            : null,
          dueAmount: totals.dueAmount,
          dueDate:
            totals.dueAmount > 0 && input.dueDate
              ? parseDateInput(input.dueDate)
              : null,
          dueSettled: totals.dueAmount <= 0,
          dueSettledMethod:
            totals.dueAmount <= 0 ? existing.dueSettledMethod : null,
          dueSettledAt: totals.dueAmount <= 0 ? existing.dueSettledAt : null,
          isPartialPaid:
            totals.dueAmount > 0 &&
            totals.cashAmount + totals.onlineAmount + totals.financeAmount > 0,
          items: {
            create: totals.items.map((item) => ({
              productName: item.productName,
              mobileCatalogId: item.mobileCatalogId,
              stockItemId: item.stockItemId || null,
              platform: item.platform,
              color: item.color,
              storage: item.storage,
              ram: item.ram,
              condition: item.condition,
              quantity: item.quantity,
              rate: item.rate,
              gstPercent: item.gstPercent,
              amount: item.amount,
              imei1: item.imei1,
              imei2: item.imei2,
              serialNumber: item.serialNumber,
              warrantyMonths: item.warrantyMonths,
            })),
          },
        },
        include: { items: true },
      });
    });

    res.json({ data: serializeBill(bill) });
  } catch (error) {
    if (error instanceof Error && error.message === "FINANCE_COMPANY_NOT_FOUND") {
      res.status(400).json({ error: "Selected finance company was not found" });
      return;
    }
    if (error instanceof Error && error.message === "STOCK_NOT_FOUND") {
      res.status(400).json({ error: "Selected stock phone was not found" });
      return;
    }
    if (error instanceof Error && error.message === "STOCK_UNAVAILABLE") {
      res.status(400).json({
        error: "One of the selected phones is already sold or unavailable",
      });
      return;
    }
    if (error instanceof Error && error.message === "STOCK_DUPLICATE") {
      res.status(400).json({
        error: "The same stock phone cannot be added twice on one bill",
      });
      return;
    }
    if (error instanceof Error && error.message === "STOCK_IMEI_MISMATCH") {
      res.status(400).json({
        error: "IMEI does not match the selected stock phone",
      });
      return;
    }
    next(error);
  }
});

billsRouter.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const existing = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: { items: { select: { stockItemId: true } } },
    });
    if (!existing) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await releaseStockIds(
        tx,
        existing.items
          .map((item) => item.stockItemId)
          .filter((id): id is string => Boolean(id)),
      );
      await tx.bill.delete({ where: { id: existing.id } });
    });

    res.json({
      data: { id: existing.id, invoiceNumber: existing.invoiceNumber },
    });
  } catch (error) {
    next(error);
  }
});

billsRouter.get("/:id/pdf", async (req, res, next) => {
  try {
    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!bill) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }

    const pdf = await buildInvoicePdf(bill);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${bill.invoiceNumber}.pdf"`,
    );
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

billsRouter.patch("/:id/settle-due", requireAdmin, async (req, res, next) => {
  try {
    const method =
      typeof req.body?.method === "string" ? req.body.method : "na";
    if (!["cash", "online", "na"].includes(method)) {
      res.status(400).json({ error: "Invalid settlement method" });
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

    const due = bill.dueAmount;
    const paidAt = new Date();
    const updated = await prisma.bill.update({
      where: { id: bill.id },
      data: {
        dueSettled: true,
        dueAmount: 0,
        dueSettledMethod: method,
        dueSettledAt: paidAt,
        isPartialPaid: false,
        cashAmount:
          method === "cash"
            ? Number((bill.cashAmount + due).toFixed(2))
            : bill.cashAmount,
        onlineAmount:
          method === "online"
            ? Number((bill.onlineAmount + due).toFixed(2))
            : bill.onlineAmount,
        duePayments: {
          create: {
            amount: due,
            method,
            kind: "full",
            paidAt,
          },
        },
      },
      include: billDetailInclude,
    });

    res.json({ data: serializeBill(updated) });
  } catch (error) {
    next(error);
  }
});
