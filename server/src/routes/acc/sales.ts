import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { accRange, nextAccNumber, round2 } from "../../lib/accShop";
import { istDateString, startOfDayIST } from "../../lib/ist";
import { renderAccPdf, rs, sendPdf, pdfDay, PDF_TONE, type PdfRow } from "../../services/accPdf";
import { money } from "../../services/pdf";
import { customerBalances } from "../../services/accDues";
import { renderAccBillPdf } from "../../services/accBillPdf";
import { upsertCustomer, customerInputSchema } from "./customers";

export const accSalesRouter = Router();

const saleInclude = {
  items: true,
  customer: { include: { group: true } },
} satisfies Prisma.AccSaleInclude;

type SaleWithItems = Prisma.AccSaleGetPayload<{ include: typeof saleInclude }>;

export function serializeSale(sale: SaleWithItems) {
  return {
    id: sale.id,
    number: sale.number,
    kind: sale.kind,
    saleDate: sale.saleDate,
    customerId: sale.customerId,
    customerName: sale.customer?.name || sale.customerName,
    customerPhone: sale.customer?.phone || sale.customerPhone,
    customerShop: sale.customer?.shopName || "",
    groupName: sale.customer?.group?.name || "",
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    costTotal: sale.costTotal,
    profit: round2(sale.total - sale.costTotal),
    cashAmount: sale.cashAmount,
    onlineAmount: sale.onlineAmount,
    dueAmount: sale.dueAmount,
    dueDate: sale.dueDate,
    note: sale.note,
    voidedAt: sale.voidedAt,
    voidReason: sale.voidReason,
    createdByName: sale.createdByName,
    createdAt: sale.createdAt,
    items: sale.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      categoryName: item.categoryName,
      qty: item.qty,
      rate: item.rate,
      amount: item.amount,
    })),
  };
}

const saleSchema = z.object({
  kind: z.enum(["RETAIL", "WHOLESALE"]),
  /** Random id from the device; a double tap or retry returns the first sale. */
  clientRef: z.string().trim().min(8).max(64).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().optional(),
        /** Only for items not in the catalogue. */
        name: z.string().trim().max(120).optional(),
        /** Phone model from the product's breakdown (optional). */
        model: z.string().trim().max(60).optional(),
        qty: z.coerce.number().int().min(1, "Quantity must be at least 1").max(100000),
        rate: z.coerce.number().min(0).max(10_000_000),
      }),
    )
    .min(1, "Add at least one item")
    .max(200),
  discount: z.coerce.number().min(0).max(10_000_000).default(0),
  cashAmount: z.coerce.number().min(0).max(10_000_000).default(0),
  onlineAmount: z.coerce.number().min(0).max(10_000_000).default(0),
  customerId: z.string().optional(),
  customer: customerInputSchema.optional(),
  customerName: z.string().trim().max(100).default(""),
  customerPhone: z.string().trim().max(15).default(""),
  /** yyyy-mm-dd: when the customer promised to pay */
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note: z.string().trim().max(500).default(""),
  allowOutOfStock: z.boolean().default(false),
});

class SaleError extends Error {
  constructor(
    message: string,
    public status = 400,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

accSalesRouter.post("/sales", async (req, res, next) => {
  try {
    const parsed = saleSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      res.status(400).json({ error: Object.values(flat.fieldErrors).flat()[0] || flat.formErrors[0] || "Check the bill" });
      return;
    }
    const input = parsed.data;

    if (input.clientRef) {
      const existing = await prisma.accSale.findUnique({ where: { clientRef: input.clientRef }, include: saleInclude });
      if (existing) {
        res.json({ data: serializeSale(existing), duplicate: true });
        return;
      }
    }

    const productIds = [...new Set(input.items.map((i) => i.productId).filter(Boolean) as string[])];
    const products = await prisma.accProduct.findMany({ where: { id: { in: productIds } }, include: { category: true } });
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = input.items.map((item) => {
      const product = item.productId ? byId.get(item.productId) : undefined;
      if (item.productId && !product) throw new SaleError("A product on this bill was removed. Refresh and try again.");
      const model = product ? item.model?.replace(/\s+/g, " ").trim() || "" : "";
      const base = product?.name || item.name;
      if (!base) throw new SaleError("Every item needs a name");
      return {
        productId: product?.id ?? null,
        name: model ? `${base} · ${model}` : base,
        model,
        categoryName: product?.category.name ?? "",
        qty: item.qty,
        rate: round2(item.rate),
        amount: round2(item.qty * item.rate),
        unitCost: product?.purchasePrice ?? 0,
      };
    });

    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const discount = round2(Math.min(input.discount, subtotal));
    const total = round2(subtotal - discount);
    let cash = round2(input.cashAmount);
    let online = round2(input.onlineAmount);

    if (input.kind === "RETAIL") {
      if (cash + online === 0) cash = total;
      if (Math.abs(cash + online - total) > 0.01) {
        throw new SaleError(`Cash + online must equal the bill total ${money(total)}`);
      }
    } else {
      if (cash + online > total + 0.01) throw new SaleError("Paid amount is more than the bill total");
      if (!input.customerId && !input.customer) throw new SaleError("Choose or add the wholesale customer");
    }
    const due = input.kind === "WHOLESALE" ? round2(total - cash - online) : 0;
    const costTotal = round2(lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
    const by = req.user?.name || null;

    const sale = await prisma.$transaction(async (tx) => {
      let customerId: string | null = null;
      if (input.kind === "WHOLESALE") {
        customerId = input.customerId || (await upsertCustomer(tx, input.customer!)).id;
        const customer = await tx.accCustomer.findUnique({ where: { id: customerId } });
        if (!customer) throw new SaleError("Customer not found");
      }

      // Take stock atomically so two counters can't sell the last unit twice.
      const short: Array<{ name: string; inStock: number; qty: number }> = [];
      const need = new Map<string, number>();
      for (const line of lines) if (line.productId) need.set(line.productId, (need.get(line.productId) || 0) + line.qty);
      for (const [productId, qty] of need) {
        const where = input.allowOutOfStock ? { id: productId } : { id: productId, stockQty: { gte: qty } };
        const updated = await tx.accProduct.updateMany({ where, data: { stockQty: { decrement: qty } } });
        if (!updated.count) {
          const p = byId.get(productId)!;
          const fresh = await tx.accProduct.findUnique({ where: { id: productId }, select: { stockQty: true } });
          short.push({ name: p.name, inStock: fresh?.stockQty ?? 0, qty });
        }
      }
      if (short.length) {
        throw new SaleError(
          short.length === 1
            ? `Only ${short[0].inStock} of ${short[0].name} in stock`
            : `${short.length} items don't have enough stock`,
          409,
          { code: "OUT_OF_STOCK", short },
        );
      }

      const number = await nextAccNumber(tx, input.kind);
      const created = await tx.accSale.create({
        data: {
          number,
          kind: input.kind,
          customerId,
          customerName: input.kind === "RETAIL" ? input.customerName : "",
          customerPhone: input.kind === "RETAIL" ? input.customerPhone.replace(/\D/g, "") : "",
          subtotal,
          discount,
          total,
          costTotal,
          cashAmount: cash,
          onlineAmount: online,
          dueAmount: due,
          dueDate: due > 0 && input.dueDate ? new Date(`${input.dueDate}T18:00:00+05:30`) : null,
          note: input.note,
          clientRef: input.clientRef || null,
          createdByUserId: req.user?.id || null,
          createdByName: by,
          items: { create: lines },
        },
        include: saleInclude,
      });
      // Keep the phone-model breakdown in step (never below zero).
      for (const line of lines) {
        if (!line.productId || !line.model) continue;
        const row = await tx.accProductModel.findUnique({
          where: { productId_model: { productId: line.productId, model: line.model } },
        });
        if (row) {
          await tx.accProductModel.update({ where: { id: row.id }, data: { qty: Math.max(0, row.qty - line.qty) } });
        }
      }

      const moves = lines.filter((l) => l.productId);
      if (moves.length) {
        await tx.accStockMove.createMany({
          data: moves.map((l) => ({
            productId: l.productId!,
            kind: "SALE",
            qty: -l.qty,
            unitCost: l.unitCost,
            refId: created.id,
            createdByName: by,
          })),
        });
      }
      return created;
    });

    res.status(201).json({ data: serializeSale(sale) });
  } catch (error) {
    if (error instanceof SaleError) {
      res.status(error.status).json({ error: error.message, ...error.extra });
      return;
    }
    if ((error as { code?: string }).code === "P2002") {
      // Same clientRef raced in from a retry: hand back the saved one.
      const ref = (req.body as { clientRef?: string })?.clientRef;
      const existing = ref ? await prisma.accSale.findUnique({ where: { clientRef: ref }, include: saleInclude }) : null;
      if (existing) {
        res.json({ data: serializeSale(existing), duplicate: true });
        return;
      }
    }
    next(error);
  }
});

function salesWhere(query: Record<string, unknown>) {
  const range = accRange(query, "today");
  const kind = query.kind === "RETAIL" || query.kind === "WHOLESALE" ? query.kind : undefined;
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const showVoid = query.void === "1";
  const where: Prisma.AccSaleWhereInput = {
    ...(range.filter ? { saleDate: range.filter } : {}),
    ...(kind ? { kind } : {}),
    ...(showVoid ? {} : { voidedAt: null }),
    ...(typeof query.customerId === "string" ? { customerId: query.customerId } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q.toUpperCase() } },
            { customerName: { contains: q } },
            { customerPhone: { contains: q } },
            { customer: { name: { contains: q } } },
            { customer: { phone: { contains: q } } },
            { items: { some: { name: { contains: q } } } },
          ],
        }
      : {}),
  };
  return { where, range, kind };
}

function summarize(sales: SaleWithItems[]) {
  const live = sales.filter((s) => !s.voidedAt);
  const sum = (fn: (s: SaleWithItems) => number) => round2(live.reduce((acc, s) => acc + fn(s), 0));
  const retail = live.filter((s) => s.kind === "RETAIL");
  const wholesale = live.filter((s) => s.kind === "WHOLESALE");
  return {
    count: live.length,
    total: sum((s) => s.total),
    retailTotal: round2(retail.reduce((a, s) => a + s.total, 0)),
    retailCount: retail.length,
    wholesaleTotal: round2(wholesale.reduce((a, s) => a + s.total, 0)),
    wholesaleCount: wholesale.length,
    cash: sum((s) => s.cashAmount),
    online: sum((s) => s.onlineAmount),
    due: sum((s) => s.dueAmount),
    discount: sum((s) => s.discount),
    profit: sum((s) => s.total - s.costTotal),
    items: live.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0),
  };
}

accSalesRouter.get("/sales", async (req, res, next) => {
  try {
    const { where, range } = salesWhere(req.query);
    const sales = await prisma.accSale.findMany({
      where,
      include: saleInclude,
      orderBy: { saleDate: "desc" },
      take: Math.min(Number(req.query.limit) || 500, 2000),
    });
    res.json({ data: { sales: sales.map(serializeSale), summary: summarize(sales), label: range.label } });
  } catch (error) {
    next(error);
  }
});

accSalesRouter.get("/sales/pdf", async (req, res, next) => {
  try {
    const { where, range, kind } = salesWhere({ ...req.query, void: "0" });
    const sales = await prisma.accSale.findMany({ where, include: saleInclude, orderBy: { saleDate: "asc" } });
    const s = summarize(sales);
    const detailed = req.query.items === "1";
    const rows: PdfRow[] = [];
    let day = "";
    for (const sale of sales) {
      const d = istDateString(sale.saleDate);
      if (d !== day) {
        day = d;
        const daySales = sales.filter((x) => istDateString(x.saleDate) === d);
        rows.push({
          kind: "group",
          cells: {
            a: pdfDay(sale.saleDate),
            b: `${daySales.length} bills`,
            c: rs(round2(daySales.reduce((a, x) => a + x.total, 0))),
          },
        });
      }
      const itemsText = sale.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
      rows.push({
        cells: {
          number: sale.number,
          time: sale.saleDate.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
          party: sale.customer?.name || sale.customerName || (sale.kind === "RETAIL" ? "Walk-in" : ""),
          items: detailed ? itemsText : `${sale.items.reduce((a, i) => a + i.qty, 0)} pcs`,
          total: money(sale.total),
          cash: sale.cashAmount ? money(sale.cashAmount) : "",
          online: sale.onlineAmount ? money(sale.onlineAmount) : "",
          due: sale.dueAmount ? money(sale.dueAmount) : "",
        },
        sub: {
          number: sale.kind === "RETAIL" ? "Retail" : "Wholesale",
          party: sale.customer?.group?.name || sale.customer?.shopName || "",
          items: detailed ? "" : itemsText,
        },
        color: sale.dueAmount ? { due: PDF_TONE.red } : undefined,
      });
    }
    const pdf = await renderAccPdf({
      title: kind === "RETAIL" ? "Retail sales" : kind === "WHOLESALE" ? "Wholesale sales" : "Sales report",
      subtitle: range.label,
      landscape: true,
      summary: [
        { label: "Bills", value: String(s.count) },
        { label: "Total sales", value: rs(s.total), tone: "blue" },
        { label: "Retail", value: `${rs(s.retailTotal)} (${s.retailCount})` },
        { label: "Wholesale", value: `${rs(s.wholesaleTotal)} (${s.wholesaleCount})` },
        { label: "Pieces sold", value: String(s.items) },
        { label: "Cash", value: rs(s.cash), tone: "green" },
        { label: "Online", value: rs(s.online), tone: "green" },
        { label: "Given on credit", value: rs(s.due), tone: "red" },
        { label: "Discount", value: rs(s.discount) },
        ...(req.user?.role === "ADMIN" ? [{ label: "Profit", value: rs(s.profit), tone: "green" as const }] : []),
      ],
      sections: [
        {
          columns: [
            { key: "number", label: "Bill", width: 9 },
            { key: "time", label: "Time", width: 7 },
            { key: "party", label: "Customer", width: 17 },
            { key: "items", label: "Items", width: 33 },
            { key: "total", label: "Total", width: 9, align: "right" },
            { key: "cash", label: "Cash", width: 8, align: "right" },
            { key: "online", label: "Online", width: 8, align: "right" },
            { key: "due", label: "Due", width: 8, align: "right" },
          ],
          rows,
          total: {
            number: `${s.count} bills`,
            total: money(s.total),
            cash: money(s.cash),
            online: money(s.online),
            due: money(s.due),
          },
          empty: "No sales in this period.",
        },
      ],
      footNote: "Voided bills are not included.",
    });
    sendPdf(res, pdf, `accessories-sales-${range.period}-${istDateString()}.pdf`);
  } catch (error) {
    next(error);
  }
});

accSalesRouter.get("/sales/:id", async (req, res, next) => {
  try {
    const sale = await prisma.accSale.findUnique({ where: { id: req.params.id }, include: saleInclude });
    if (!sale) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    res.json({ data: serializeSale(sale) });
  } catch (error) {
    next(error);
  }
});

/** Bill PDF to share with the customer. */
accSalesRouter.get("/sales/:id/pdf", async (req, res, next) => {
  try {
    const sale = await prisma.accSale.findUnique({ where: { id: req.params.id }, include: saleInclude });
    if (!sale) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    const c = sale.customer;
    let balance: number | null = null;
    if (c) balance = (await customerBalances([c.id])).get(c.id)?.balance ?? null;
    const pdf = await renderAccBillPdf({
      number: sale.number,
      kind: sale.kind === "WHOLESALE" ? "WHOLESALE" : "RETAIL",
      saleDate: sale.saleDate,
      dueDate: sale.dueDate,
      voidedAt: sale.voidedAt,
      customer: {
        name: c?.name || sale.customerName,
        phone: c?.phone || sale.customerPhone,
        shopName: c?.shopName,
        address: c?.address,
        city: c?.city,
        gstin: c?.gstin,
      },
      items: sale.items.map((item) => ({
        name: item.name,
        categoryName: item.categoryName,
        qty: item.qty,
        rate: item.rate,
        amount: item.amount,
      })),
      subtotal: sale.subtotal,
      discount: sale.discount,
      total: sale.total,
      cashAmount: sale.cashAmount,
      onlineAmount: sale.onlineAmount,
      dueAmount: sale.dueAmount,
      outstanding: balance,
      note: sale.note,
    });
    sendPdf(res, pdf, `${sale.number}.pdf`);
  } catch (error) {
    next(error);
  }
});

/**
 * Cancel a bill: stock goes back, it drops out of sales and dues. Staff can
 * void their own bills on the same day; admins any bill.
 */
accSalesRouter.post("/sales/:id/void", async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || "").trim().slice(0, 200);
    const sale = await prisma.accSale.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!sale) {
      res.status(404).json({ error: "Bill not found" });
      return;
    }
    if (sale.voidedAt) {
      res.status(400).json({ error: "This bill is already void" });
      return;
    }
    const isAdmin = req.user?.role === "ADMIN";
    const sameDay = sale.saleDate >= startOfDayIST();
    if (!isAdmin && !(sameDay && sale.createdByUserId === req.user?.id)) {
      res.status(403).json({ error: "Only an admin can cancel this bill" });
      return;
    }
    const by = req.user?.name || null;
    const updated = await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        if (!item.productId) continue;
        const exists = await tx.accProduct.findUnique({ where: { id: item.productId }, select: { id: true } });
        if (!exists) continue;
        await tx.accProduct.update({ where: { id: item.productId }, data: { stockQty: { increment: item.qty } } });
        if (item.model) {
          await tx.accProductModel.updateMany({
            where: { productId: item.productId, model: item.model },
            data: { qty: { increment: item.qty } },
          });
        }
        await tx.accStockMove.create({
          data: {
            productId: item.productId,
            kind: "VOID",
            qty: item.qty,
            unitCost: item.unitCost,
            refId: sale.id,
            note: reason || null,
            createdByName: by,
          },
        });
      }
      return tx.accSale.update({
        where: { id: sale.id },
        data: { voidedAt: new Date(), voidReason: reason || null },
        include: saleInclude,
      });
    });
    res.json({ data: serializeSale(updated) });
  } catch (error) {
    next(error);
  }
});
