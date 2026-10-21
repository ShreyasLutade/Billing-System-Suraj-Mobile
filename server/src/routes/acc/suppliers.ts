import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { accRange, round2 } from "../../lib/accShop";
import { istDateString } from "../../lib/ist";
import { renderAccPdf, rs, sendPdf, pdfDay, PDF_TONE } from "../../services/accPdf";
import { money } from "../../services/pdf";

export const accSuppliersRouter = Router();

function badRequest(res: import("express").Response, error: z.ZodError) {
  const flat = error.flatten();
  res.status(400).json({ error: Object.values(flat.fieldErrors).flat()[0] || flat.formErrors[0] || "Check the details" });
}

async function supplierRows() {
  const [suppliers, bought, paid] = await Promise.all([
    prisma.accSupplier.findMany({ orderBy: { name: "asc" } }),
    prisma.accPurchase.groupBy({
      by: ["supplierId"],
      where: { supplierId: { not: null } },
      _sum: { total: true },
      _count: true,
      _max: { purchaseDate: true },
    }),
    prisma.accSupplierPayment.groupBy({ by: ["supplierId"], _sum: { amount: true }, _max: { paidAt: true } }),
  ]);
  const b = new Map(bought.map((r) => [r.supplierId, r]));
  const p = new Map(paid.map((r) => [r.supplierId, r]));
  return suppliers.map((s) => {
    const purchased = round2(b.get(s.id)?._sum.total || 0);
    const paidTotal = round2(p.get(s.id)?._sum.amount || 0);
    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      address: s.address,
      purchased,
      paid: paidTotal,
      balance: round2(purchased - paidTotal),
      purchaseCount: b.get(s.id)?._count || 0,
      lastPurchaseAt: b.get(s.id)?._max.purchaseDate || null,
      lastPaymentAt: p.get(s.id)?._max.paidAt || null,
    };
  });
}

accSuppliersRouter.get("/suppliers", async (_req, res, next) => {
  try {
    res.json({ data: await supplierRows() });
  } catch (error) {
    next(error);
  }
});

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Enter the supplier name").max(80),
  phone: z.string().trim().max(15).default(""),
  address: z.string().trim().max(200).default(""),
});

accSuppliersRouter.post("/suppliers", async (req, res, next) => {
  try {
    const parsed = supplierSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const supplier = await prisma.accSupplier.create({ data: parsed.data });
    res.status(201).json({ data: supplier });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      res.status(409).json({ error: "A supplier with this name already exists" });
      return;
    }
    next(error);
  }
});

accSuppliersRouter.put("/suppliers/:id", async (req, res, next) => {
  try {
    const parsed = supplierSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const supplier = await prisma.accSupplier.update({ where: { id: req.params.id }, data: parsed.data });
    res.json({ data: supplier });
  } catch (error) {
    next(error);
  }
});

accSuppliersRouter.get("/suppliers/pdf", async (_req, res, next) => {
  try {
    const rows = await supplierRows();
    const total = (k: "purchased" | "paid" | "balance") => round2(rows.reduce((a, r) => a + r[k], 0));
    const pdf = await renderAccPdf({
      title: "Suppliers",
      summary: [
        { label: "Suppliers", value: String(rows.length) },
        { label: "Total purchased", value: rs(total("purchased")), tone: "blue" },
        { label: "Total paid", value: rs(total("paid")), tone: "green" },
        { label: "Balance to pay", value: rs(total("balance")), tone: "red" },
      ],
      sections: [
        {
          columns: [
            { key: "name", label: "Supplier", width: 28 },
            { key: "phone", label: "Phone", width: 13 },
            { key: "last", label: "Last purchase", width: 14 },
            { key: "purchased", label: "Purchased", width: 15, align: "right" },
            { key: "paid", label: "Paid", width: 15, align: "right" },
            { key: "balance", label: "Balance", width: 15, align: "right" },
          ],
          rows: rows.map((r) => ({
            cells: {
              name: r.name,
              phone: r.phone,
              last: pdfDay(r.lastPurchaseAt),
              purchased: money(r.purchased),
              paid: money(r.paid),
              balance: money(r.balance),
            },
            sub: { name: r.address, last: r.purchaseCount ? `${r.purchaseCount} purchases` : "" },
            color: { balance: r.balance > 0 ? PDF_TONE.red : PDF_TONE.green },
          })),
          total: { name: "Total", purchased: money(total("purchased")), paid: money(total("paid")), balance: money(total("balance")) },
          empty: "No suppliers yet.",
        },
      ],
    });
    sendPdf(res, pdf, `accessories-suppliers-${istDateString()}.pdf`);
  } catch (error) {
    next(error);
  }
});

accSuppliersRouter.get("/suppliers/:id", async (req, res, next) => {
  try {
    const supplier = await prisma.accSupplier.findUnique({
      where: { id: req.params.id },
      include: {
        purchases: { include: { items: { include: { product: { select: { name: true } } } } }, orderBy: { purchaseDate: "desc" } },
        payments: { orderBy: { paidAt: "desc" } },
      },
    });
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const purchased = round2(supplier.purchases.reduce((a, p) => a + p.total, 0));
    const paid = round2(supplier.payments.reduce((a, p) => a + p.amount, 0));
    res.json({
      data: {
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        address: supplier.address,
        purchased,
        paid,
        balance: round2(purchased - paid),
        purchases: supplier.purchases.map((p) => ({
          id: p.id,
          purchaseDate: p.purchaseDate,
          billNo: p.billNo,
          total: p.total,
          note: p.note,
          pieces: p.items.reduce((a, i) => a + i.qty, 0),
          items: p.items.map((i) => ({ name: i.product.name, qty: i.qty, unitCost: i.unitCost })),
        })),
        payments: supplier.payments,
      },
    });
  } catch (error) {
    next(error);
  }
});

accSuppliersRouter.post("/suppliers/:id/payments", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        amount: z.coerce.number().positive("Enter the amount").max(100_000_000),
        method: z.enum(["CASH", "UPI", "BANK", "CHEQUE"]).default("CASH"),
        note: z.string().trim().max(200).default(""),
      })
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const payment = await prisma.accSupplierPayment.create({
      data: { supplierId: req.params.id, ...parsed.data, amount: round2(parsed.data.amount) },
    });
    res.status(201).json({ data: payment });
  } catch (error) {
    next(error);
  }
});

/* ---------------- stock in (purchase) ---------------- */

const purchaseSchema = z.object({
  supplierId: z.string().optional().nullable(),
  /** New supplier typed on the form. */
  supplierName: z.string().trim().max(80).optional(),
  billNo: z.string().trim().max(40).default(""),
  note: z.string().trim().max(300).default(""),
  paidNow: z.coerce.number().min(0).max(100_000_000).default(0),
  paidMethod: z.enum(["CASH", "UPI", "BANK", "CHEQUE"]).default("CASH"),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        qty: z.coerce.number().int().min(1).max(1_000_000),
        unitCost: z.coerce.number().min(0).max(10_000_000),
        /** Optional new selling price to set while restocking. */
        sellingPrice: z.coerce.number().min(0).max(10_000_000).optional(),
      }),
    )
    .min(1, "Add at least one item")
    .max(300),
});

accSuppliersRouter.post("/purchases", async (req, res, next) => {
  try {
    const parsed = purchaseSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const input = parsed.data;
    const by = req.user?.name || null;
    const purchase = await prisma.$transaction(async (tx) => {
      let supplierId = input.supplierId || null;
      if (!supplierId && input.supplierName) {
        supplierId = (
          await tx.accSupplier.upsert({
            where: { name: input.supplierName },
            create: { name: input.supplierName },
            update: {},
          })
        ).id;
      }
      const total = round2(input.items.reduce((a, i) => a + i.qty * i.unitCost, 0));
      const created = await tx.accPurchase.create({
        data: {
          supplierId,
          billNo: input.billNo,
          note: input.note,
          total,
          createdByName: by,
          items: { create: input.items.map((i) => ({ productId: i.productId, qty: i.qty, unitCost: i.unitCost })) },
        },
      });
      for (const item of input.items) {
        const product = await tx.accProduct.findUniqueOrThrow({ where: { id: item.productId } });
        // Weighted average cost over what is in stock now plus this lot.
        const onHand = Math.max(product.stockQty, 0);
        const cost =
          onHand + item.qty > 0
            ? round2((onHand * product.purchasePrice + item.qty * item.unitCost) / (onHand + item.qty))
            : item.unitCost;
        await tx.accProduct.update({
          where: { id: product.id },
          data: {
            stockQty: { increment: item.qty },
            purchasePrice: cost,
            ...(item.sellingPrice ? { sellingPrice: item.sellingPrice } : {}),
          },
        });
        await tx.accStockMove.create({
          data: {
            productId: product.id,
            kind: "PURCHASE",
            qty: item.qty,
            unitCost: item.unitCost,
            refId: created.id,
            createdByName: by,
          },
        });
      }
      if (supplierId && input.paidNow > 0) {
        await tx.accSupplierPayment.create({
          data: {
            supplierId,
            amount: round2(Math.min(input.paidNow, total)),
            method: input.paidMethod,
            note: input.billNo ? `Paid with bill ${input.billNo}` : "Paid at purchase",
          },
        });
      }
      return created;
    });
    res.status(201).json({ data: purchase });
  } catch (error) {
    next(error);
  }
});

accSuppliersRouter.get("/purchases", async (req, res, next) => {
  try {
    const range = accRange(req.query, "month");
    const purchases = await prisma.accPurchase.findMany({
      where: range.filter ? { purchaseDate: range.filter } : {},
      include: { supplier: true, items: { include: { product: { select: { name: true } } } } },
      orderBy: { purchaseDate: "desc" },
      take: 300,
    });
    res.json({
      data: purchases.map((p) => ({
        id: p.id,
        purchaseDate: p.purchaseDate,
        supplierName: p.supplier?.name || p.note || "Opening stock",
        billNo: p.billNo,
        total: p.total,
        pieces: p.items.reduce((a, i) => a + i.qty, 0),
        items: p.items.map((i) => ({ name: i.product.name, qty: i.qty, unitCost: i.unitCost })),
        createdByName: p.createdByName,
      })),
    });
  } catch (error) {
    next(error);
  }
});
