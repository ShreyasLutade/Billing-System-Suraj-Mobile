import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { accRange, round2, takeStockOff } from "../../lib/accShop";
import { requireAdmin } from "../../middleware/auth";
import { istDateString } from "../../lib/ist";
import { renderAccPdf, rs, sendPdf, pdfDay, PDF_TONE, type PdfSection } from "../../services/accPdf";
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
      city: s.city,
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

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name").max(80),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, "").slice(-10))
    .pipe(z.string().length(10, "Enter the supplier's 10-digit mobile number")),
  city: z.string().trim().max(60).default(""),
  address: z.string().trim().max(200).default(""),
});

type SupplierInput = z.infer<typeof supplierSchema>;

class SupplierClash extends Error {}

/** Create (or, with id, update) a supplier; one mobile number = one supplier. */
async function saveSupplier(tx: Prisma.TransactionClient, input: SupplierInput, id?: string) {
  const sameName = await tx.accSupplier.findFirst({ where: { name: input.name, ...(id ? { NOT: { id } } : {}) } });
  if (sameName) throw new SupplierClash(`A supplier named ${input.name} already exists`);
  const samePhone = await tx.accSupplier.findFirst({ where: { phone: input.phone, ...(id ? { NOT: { id } } : {}) } });
  if (samePhone) throw new SupplierClash(`${input.phone} is already saved as ${samePhone.name}`);

  const data = { name: input.name, phone: input.phone, city: input.city, address: input.address };
  return id ? tx.accSupplier.update({ where: { id }, data }) : tx.accSupplier.create({ data });
}

function clashResponse(res: import("express").Response, error: unknown) {
  if (error instanceof SupplierClash) {
    res.status(409).json({ error: error.message });
    return true;
  }
  return false;
}

accSuppliersRouter.post("/suppliers", async (req, res, next) => {
  try {
    const parsed = supplierSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const supplier = await prisma.$transaction((tx) => saveSupplier(tx, parsed.data));
    res.status(201).json({ data: supplier });
  } catch (error) {
    if (!clashResponse(res, error)) next(error);
  }
});

accSuppliersRouter.put("/suppliers/:id", async (req, res, next) => {
  try {
    const parsed = supplierSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const supplier = await prisma.$transaction((tx) => saveSupplier(tx, parsed.data, req.params.id));
    res.json({ data: supplier });
  } catch (error) {
    if (!clashResponse(res, error)) next(error);
  }
});

accSuppliersRouter.get("/suppliers/pdf", async (_req, res, next) => {
  try {
    const rows = await supplierRows();
    const total = (k: "purchased" | "paid" | "balance", list = rows) => round2(list.reduce((a, r) => a + r[k], 0));
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
          heading: `All suppliers  ·  ${rows.length} supplier${rows.length === 1 ? "" : "s"}`,
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
            sub: { name: [r.city, r.address].filter(Boolean).join(", "), last: r.purchaseCount ? `${r.purchaseCount} purchase${r.purchaseCount === 1 ? "" : "s"}` : "" },
            color: { balance: r.balance > 0 ? PDF_TONE.red : PDF_TONE.green },
          })),
          total: {
            name: "Total",
            purchased: money(total("purchased")),
            paid: money(total("paid")),
            balance: money(total("balance")),
          },
          empty: "No suppliers yet.",
        },
      ],
    });
    sendPdf(res, pdf, `accessories-suppliers-${istDateString()}.pdf`);
  } catch (error) {
    next(error);
  }
});

const PAY_METHOD: Record<string, string> = { CASH: "cash", UPI: "UPI", BANK: "bank transfer", CHEQUE: "cheque" };

/**
 * One supplier with everything bought and paid, plus a statement: purchases
 * (Dr) and payments (Cr) by date with the running balance, so each payment
 * can be ticked off against the bank statement by its UTR / cheque no.
 */
async function supplierAccount(id: string) {
  const supplier = await prisma.accSupplier.findUnique({
    where: { id },
    include: {
      purchases: { include: { items: { include: { product: { select: { name: true, categoryId: true } } } } }, orderBy: { purchaseDate: "desc" } },
      payments: { orderBy: { paidAt: "desc" } },
    },
  });
  if (!supplier) return null;
  const purchased = round2(supplier.purchases.reduce((a, p) => a + p.total, 0));
  const paid = round2(supplier.payments.reduce((a, p) => a + p.amount, 0));

  const entries = [
    ...supplier.purchases.map((p) => ({
      date: p.purchaseDate,
      kind: "PURCHASE" as const,
      id: p.id,
      detail: `${p.items.length} product${p.items.length === 1 ? "" : "s"} · ${p.items.reduce((a, i) => a + i.qty, 0)} pcs`,
      reference: p.billNo,
      debit: p.total,
      credit: 0,
    })),
    ...supplier.payments.map((p) => ({
      date: p.paidAt,
      kind: "PAYMENT" as const,
      id: p.id,
      detail: [`Paid by ${PAY_METHOD[p.method] || p.method}`, p.note].filter(Boolean).join(" · "),
      reference: p.reference,
      debit: 0,
      credit: p.amount,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.kind === "PURCHASE" ? -1 : 1));
  let running = 0;
  const statement = entries.map((e) => {
    running = round2(running + e.debit - e.credit);
    return { ...e, balance: running };
  });

  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    city: supplier.city,
    address: supplier.address,
    createdAt: supplier.createdAt,
    purchased,
    paid,
    balance: round2(purchased - paid),
    pieces: supplier.purchases.reduce((a, p) => a + p.items.reduce((b, i) => b + i.qty, 0), 0),
    lastPurchaseAt: supplier.purchases[0]?.purchaseDate || null,
    lastPaymentAt: supplier.payments[0]?.paidAt || null,
    purchases: supplier.purchases.map((p) => ({
      id: p.id,
      purchaseDate: p.purchaseDate,
      billNo: p.billNo,
      total: p.total,
      note: p.note,
      createdByName: p.createdByName,
      pieces: p.items.reduce((a, i) => a + i.qty, 0),
      items: p.items.map((i) => ({ name: i.product.name, qty: i.qty, unitCost: i.unitCost, amount: round2(i.qty * i.unitCost) })),
    })),
    payments: supplier.payments,
    statement,
  };
}

accSuppliersRouter.get("/suppliers/:id", async (req, res, next) => {
  try {
    const account = await supplierAccount(req.params.id);
    if (!account) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    res.json({ data: account });
  } catch (error) {
    next(error);
  }
});

/** Supplier statement: what we bought from them, what we paid, what is left. */
accSuppliersRouter.get("/suppliers/:id/pdf", async (req, res, next) => {
  try {
    const a = await supplierAccount(req.params.id);
    if (!a) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const sections: PdfSection[] = [
      {
        heading: "Statement",
        columns: [
          { key: "date", label: "Date", width: 12 },
          { key: "detail", label: "Particulars", width: 32 },
          { key: "ref", label: "Bill / UTR", width: 20 },
          { key: "debit", label: "Bought (Dr)", width: 12, align: "right" },
          { key: "credit", label: "Paid (Cr)", width: 12, align: "right" },
          { key: "balance", label: "Balance", width: 12, align: "right" },
        ],
        rows: a.statement.map((e) => ({
          cells: {
            date: pdfDay(e.date),
            detail: e.kind === "PURCHASE" ? `Purchase · ${e.detail}` : e.detail,
            ref: e.reference,
            debit: e.debit ? money(e.debit) : "",
            credit: e.credit ? money(e.credit) : "",
            balance: money(e.balance),
          },
          color: { credit: PDF_TONE.green },
        })),
        total: { detail: "Closing balance", debit: money(a.purchased), credit: money(a.paid), balance: money(a.balance) },
        empty: "Nothing bought or paid yet.",
      },
      {
        heading: "Items bought",
        columns: [
          { key: "date", label: "Date", width: 14 },
          { key: "item", label: "Item", width: 44 },
          { key: "qty", label: "Qty", width: 10, align: "right" },
          { key: "cost", label: "Cost", width: 14, align: "right" },
          { key: "amount", label: "Amount", width: 18, align: "right" },
        ],
        rows: [...a.purchases].reverse().flatMap((p) =>
          p.items.map((i) => ({
            cells: { date: pdfDay(p.purchaseDate), item: i.name, qty: String(i.qty), cost: money(i.unitCost), amount: money(i.amount) },
          })),
        ),
        total: { item: "Total", qty: String(a.pieces), amount: money(a.purchased) },
        empty: "Nothing bought yet.",
      },
    ];
    const pdf = await renderAccPdf({
      title: "Supplier statement",
      subtitle: `As of ${pdfDay(new Date())}`,
      info: [
        { label: "Supplier", value: a.name },
        { label: "Phone", value: a.phone },
        { label: "City", value: a.city },
        { label: "Address", value: a.address },
      ],
      summary: [
        { label: "Purchases", value: String(a.purchases.length) },
        { label: "Total bought", value: rs(a.purchased), tone: "blue" },
        { label: "Total paid", value: rs(a.paid), tone: "green" },
        { label: "Balance to pay", value: rs(a.balance), tone: "red" },
      ],
      sections,
    });
    sendPdf(res, pdf, `supplier-${a.name.replace(/[^a-z0-9]+/gi, "-")}-${istDateString()}.pdf`);
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
        /** UTR / cheque no. as it appears on the bank statement. */
        reference: z.string().trim().max(60).default(""),
        /** yyyy-mm-dd; today when left out. */
        paidAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        note: z.string().trim().max(200).default(""),
      })
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    if (!(await prisma.accSupplier.findUnique({ where: { id: req.params.id } }))) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const { paidAt, ...rest } = parsed.data;
    const payment = await prisma.accSupplierPayment.create({
      data: {
        supplierId: req.params.id,
        ...rest,
        amount: round2(rest.amount),
        // A past date is kept at midday IST; today keeps the actual time.
        ...(paidAt && paidAt !== istDateString() ? { paidAt: new Date(`${paidAt}T12:00:00.000+05:30`) } : {}),
      },
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
  supplier: supplierSchema.optional(),
  billNo: z.string().trim().max(40).default(""),
  note: z.string().trim().max(300).default(""),
  paidNow: z.coerce.number().min(0).max(100_000_000).default(0),
  paidMethod: z.enum(["CASH", "UPI", "BANK", "CHEQUE"]).default("CASH"),
  items: z
    .array(
      z
        .object({
          productId: z.string().min(1).optional(),
          /** A product bought for the first time, created with this purchase. */
          newProduct: z
            .object({
              categoryId: z.string().min(1, "Choose a category"),
              name: z.string().trim().min(2, "Enter the product name").max(120),
              brand: z.string().trim().max(40).optional().default(""),
              wholesalePrice: z.coerce.number().min(0).max(10_000_000).default(0),
            })
            .optional(),
          qty: z.coerce.number().int().min(1).max(1_000_000),
          unitCost: z.coerce.number().gt(0, "Enter the cost price").max(10_000_000),
          /** Selling price: required for a new product, optional new MRP otherwise. */
          sellingPrice: z.coerce.number().min(0).max(10_000_000).optional(),
          wholesalePrice: z.coerce.number().min(0).max(10_000_000).optional(),
        })
        .refine((i) => Boolean(i.productId) !== Boolean(i.newProduct), "Each item needs a product"),
    )
    .min(1, "Add at least one item")
    .max(300),
});

accSuppliersRouter.post("/purchases", async (req, res, next) => {
  try {
    const parsed = purchaseSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const input = parsed.data;
    // Every piece that comes in is tracked against the supplier it came from.
    if (!input.supplierId && !input.supplier) {
      res.status(400).json({ error: "Choose the supplier this stock came from" });
      return;
    }
    if (input.supplierId && !(await prisma.accSupplier.findUnique({ where: { id: input.supplierId } }))) {
      res.status(400).json({ error: "Supplier not found" });
      return;
    }
    const categoryIds = [...new Set(input.items.flatMap((i) => (i.newProduct ? [i.newProduct.categoryId] : [])))];
    if (categoryIds.length && (await prisma.accCategory.count({ where: { id: { in: categoryIds } } })) !== categoryIds.length) {
      res.status(400).json({ error: "Category not found" });
      return;
    }
    const by = req.user?.name || null;
    const purchase = await prisma.$transaction(async (tx) => {
      let supplierId = input.supplierId || null;
      if (!supplierId && input.supplier) supplierId = (await saveSupplier(tx, input.supplier)).id;
      // New products start at 0; this purchase is what stocks them.
      const items: Array<{ productId: string; qty: number; unitCost: number; sellingPrice?: number; wholesalePrice?: number }> = [];
      for (const item of input.items) {
        let productId = item.productId;
        if (item.newProduct) {
          const created = await tx.accProduct.create({
            data: {
              categoryId: item.newProduct.categoryId,
              name: item.newProduct.name,
              brand: item.newProduct.brand?.trim() || "",
              purchasePrice: item.unitCost,
              sellingPrice: item.sellingPrice || 0,
              wholesalePrice: item.newProduct.wholesalePrice,
              lowStockAt: 2,
              isFavourite: true,
            },
          });
          productId = created.id;
        }
        items.push({ productId: productId!, qty: item.qty, unitCost: item.unitCost, sellingPrice: item.sellingPrice, wholesalePrice: item.wholesalePrice });
      }
      const total = round2(items.reduce((a, i) => a + i.qty * i.unitCost, 0));
      const created = await tx.accPurchase.create({
        data: {
          supplierId,
          billNo: input.billNo,
          note: input.note,
          total,
          createdByName: by,
          items: { create: items.map((i) => ({ productId: i.productId, qty: i.qty, unitCost: i.unitCost })) },
        },
      });
      for (const item of items) {
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
            ...(item.wholesalePrice ? { wholesalePrice: item.wholesalePrice } : {}),
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
    if (!clashResponse(res, error)) next(error);
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

/**
 * Delete a supplier (admin): their purchases and payments go, and the
 * pieces bought from them come off stock. A product left with no stock, no
 * other supplier's purchases and no sales is removed entirely; one with
 * sales history stays (with its lower stock) so old bills keep their item.
 */
accSuppliersRouter.delete("/suppliers/:id", requireAdmin, async (req, res, next) => {
  try {
    const supplier = await prisma.accSupplier.findUnique({
      where: { id: req.params.id },
      include: { purchases: { include: { items: true } } },
    });
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const bought = new Map<string, number>();
    for (const p of supplier.purchases) for (const i of p.items) bought.set(i.productId, (bought.get(i.productId) || 0) + i.qty);
    const by = req.user?.name || null;
    const result = await prisma.$transaction(async (tx) => {
      let piecesRemoved = 0;
      for (const [productId, qty] of bought) {
        const removed = await takeStockOff(tx, productId, qty);
        piecesRemoved += removed;
        if (removed > 0) {
          await tx.accStockMove.create({
            data: { productId, kind: "ADJUST", qty: -removed, note: `Supplier ${supplier.name} deleted`, createdByName: by },
          });
        }
      }
      const purchaseIds = supplier.purchases.map((p) => p.id);
      await tx.accPurchase.deleteMany({ where: { id: { in: purchaseIds } } });
      await tx.accSupplier.delete({ where: { id: supplier.id } });
      const gone = await tx.accProduct.findMany({
        where: { id: { in: [...bought.keys()] }, stockQty: { lte: 0 }, saleItems: { none: {} }, purchaseItems: { none: {} } },
        select: { id: true },
      });
      await tx.accProduct.deleteMany({ where: { id: { in: gone.map((p) => p.id) } } });
      return { piecesRemoved, productsRemoved: gone.length, purchases: purchaseIds.length };
    });
    console.log(`[acc] Supplier ${supplier.name} deleted by ${by}: ${JSON.stringify(result)}`);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});
