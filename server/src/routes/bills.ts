import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  computeBillTotals,
  createBillSchema,
} from "../lib/billing";
import { getPeriodRange, isActivityPeriod, toDateFilter } from "../lib/period";
import { buildInvoicePdf } from "../services/pdf";

export const billsRouter = Router();

function parseDateInput(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }
  return new Date(value);
}

async function nextInvoiceNumber(tx: Prisma.TransactionClient) {
  const year = new Date().getFullYear();
  const sequence = await tx.invoiceSequence.upsert({
    where: { id: 1 },
    create: { id: 1, counter: 1 },
    update: { counter: { increment: 1 } },
  });
  return `SMS-${year}-${String(sequence.counter).padStart(4, "0")}`;
}

function serializeBill<
  T extends {
    billDate: Date;
    dueDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
    dueSettledAt?: Date | null;
  },
>(bill: T) {
  return {
    ...bill,
    billDate: bill.billDate.toISOString(),
    dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
    dueSettledAt: bill.dueSettledAt ? bill.dueSettledAt.toISOString() : null,
    createdAt: bill.createdAt.toISOString(),
    updatedAt: bill.updatedAt.toISOString(),
  };
}

billsRouter.get("/", async (req, res, next) => {
  try {
    const period = isActivityPeriod(req.query.period)
      ? req.query.period
      : "all";
    const billDateFilter = toDateFilter(getPeriodRange(period));
    const where: Prisma.BillWhereInput = billDateFilter
      ? { billDate: billDateFilter }
      : {};

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
      include: { items: true },
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
    const totals = computeBillTotals(input);

    const bill = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx);

      let financeCompanyId: string | null = null;
      let financeCompanyName: string | null = null;

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
      }

      return tx.bill.create({
        data: {
          invoiceNumber,
          billDate: input.billDate ? new Date(input.billDate) : new Date(),
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress || null,
          notes: input.notes || null,
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          grandTotal: totals.grandTotal,
          payableAmount: totals.payableAmount,
          cashAmount: totals.cashAmount,
          onlineAmount: totals.onlineAmount,
          financeAmount: totals.financeAmount,
          // Use relation connect — avoids Prisma validation errors when the
          // generated client is briefly out of sync with scalar FK fields.
          ...(financeCompanyId
            ? {
                financeCompany: { connect: { id: financeCompanyId } },
                financeCompanyName,
              }
            : { financeCompanyName: null }),
          isExchange: Boolean(input.isExchange),
          exchangeModel: input.isExchange
            ? input.exchangeModel?.trim() || null
            : null,
          exchangeImei1: input.isExchange
            ? input.exchangeImei1?.trim() || null
            : null,
          exchangeImei2: input.isExchange
            ? input.exchangeImei2?.trim() || null
            : null,
          exchangeSerial: input.isExchange
            ? input.exchangeSerial?.trim() || null
            : null,
          exchangeValue: input.isExchange
            ? input.exchangeValue ?? null
            : null,
          exchangeNotes: input.isExchange
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
    const totals = computeBillTotals(input);

    const bill = await prisma.$transaction(async (tx) => {
      let financeCompanyId: string | null = null;
      let financeCompanyName: string | null = null;

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
      }

      await tx.billItem.deleteMany({ where: { billId: existing.id } });

      return tx.bill.update({
        where: { id: existing.id },
        data: {
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress || null,
          notes: input.notes || null,
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          grandTotal: totals.grandTotal,
          payableAmount: totals.payableAmount,
          cashAmount: totals.cashAmount,
          onlineAmount: totals.onlineAmount,
          financeAmount: totals.financeAmount,
          ...(financeCompanyId
            ? {
                financeCompany: { connect: { id: financeCompanyId } },
                financeCompanyName,
              }
            : {
                financeCompany: { disconnect: true },
                financeCompanyName: null,
              }),
          isExchange: Boolean(input.isExchange),
          exchangeModel: input.isExchange
            ? input.exchangeModel?.trim() || null
            : null,
          exchangeImei1: input.isExchange
            ? input.exchangeImei1?.trim() || null
            : null,
          exchangeImei2: input.isExchange
            ? input.exchangeImei2?.trim() || null
            : null,
          exchangeSerial: input.isExchange
            ? input.exchangeSerial?.trim() || null
            : null,
          exchangeValue: input.isExchange
            ? input.exchangeValue ?? null
            : null,
          exchangeNotes: input.isExchange
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

billsRouter.patch("/:id/settle-due", async (req, res, next) => {
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
    const updated = await prisma.bill.update({
      where: { id: bill.id },
      data: {
        dueSettled: true,
        dueAmount: 0,
        dueSettledMethod: method,
        dueSettledAt: new Date(),
        cashAmount:
          method === "cash"
            ? Number((bill.cashAmount + due).toFixed(2))
            : bill.cashAmount,
        onlineAmount:
          method === "online"
            ? Number((bill.onlineAmount + due).toFixed(2))
            : bill.onlineAmount,
      },
      include: { items: true },
    });

    res.json({ data: serializeBill(updated) });
  } catch (error) {
    next(error);
  }
});
