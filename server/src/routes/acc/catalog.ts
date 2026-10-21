import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { DEFAULT_ACC_CATEGORIES, parseQuickPrices, round2 } from "../../lib/accShop";
import { renderAccPdf, rs, sendPdf, PDF_TONE, type PdfRow } from "../../services/accPdf";
import { money } from "../../services/pdf";
import { istDateString } from "../../lib/ist";

export const accCatalogRouter = Router();

const text = (max: number) => z.string().trim().max(max).optional().default("");
const amount = z.coerce.number().min(0).max(10_000_000).default(0);

function badRequest(res: import("express").Response, error: z.ZodError) {
  const flat = error.flatten();
  const first = Object.values(flat.fieldErrors).flat()[0] || flat.formErrors[0];
  res.status(400).json({ error: first || "Check the details and try again" });
}

export function serializeProduct(
  product: Prisma.AccProductGetPayload<{ include: { category: true } }> | Prisma.AccProductGetPayload<object>,
) {
  const category = "category" in product ? product.category : null;
  return {
    id: product.id,
    categoryId: product.categoryId,
    categoryName: category?.name ?? "",
    name: product.name,
    type: product.type,
    brand: product.brand,
    model: product.model,
    color: product.color,
    barcode: product.barcode,
    purchasePrice: product.purchasePrice,
    sellingPrice: product.sellingPrice,
    wholesalePrice: product.wholesalePrice,
    quickPrices: parseQuickPrices(product.quickPrices),
    stockQty: product.stockQty,
    lowStockAt: product.lowStockAt,
    isFavourite: product.isFavourite,
    active: product.active,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/** "Silicone Cover · Redmi Note 13 · Black" / "boAt Rockerz 450 Headphone". */
export function composeName(parts: {
  category: string;
  type?: string;
  brand?: string;
  model?: string;
  color?: string;
  name?: string;
}) {
  if (parts.name?.trim()) return parts.name.trim();
  const head = [parts.brand, parts.type, parts.category].map((p) => p?.trim()).filter(Boolean).join(" ");
  return [head, parts.model?.trim(), parts.color?.trim()].filter(Boolean).join(" · ");
}

async function ensureCategories() {
  const count = await prisma.accCategory.count();
  if (count) return;
  await prisma.accCategory.createMany({
    data: DEFAULT_ACC_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })),
  });
}

/* ---------------- categories ---------------- */

const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name").max(40),
  drillBy: z.enum(["TYPE", "BRAND"]).default("TYPE"),
  icon: z.string().trim().max(30).default("package"),
});

/** Everything the counter, stock and wholesale screens need in one call. */
accCatalogRouter.get("/catalog", async (_req, res, next) => {
  try {
    await ensureCategories();
    const [categories, products] = await Promise.all([
      prisma.accCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.accProduct.findMany({
        where: { active: true },
        include: { category: true },
        orderBy: [{ name: "asc" }],
      }),
    ]);
    res.json({
      data: {
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          drillBy: c.drillBy,
          icon: c.icon,
          sortOrder: c.sortOrder,
        })),
        products: products.map(serializeProduct),
      },
    });
  } catch (error) {
    next(error);
  }
});

accCatalogRouter.post("/categories", async (req, res, next) => {
  try {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const clash = await prisma.accCategory.findFirst({ where: { name: parsed.data.name } });
    if (clash) {
      res.status(409).json({ error: `${parsed.data.name} already exists` });
      return;
    }
    const last = await prisma.accCategory.aggregate({ _max: { sortOrder: true } });
    const category = await prisma.accCategory.create({
      data: { ...parsed.data, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    });
    res.status(201).json({ data: category });
  } catch (error) {
    next(error);
  }
});

accCatalogRouter.put("/categories/:id", async (req, res, next) => {
  try {
    const parsed = categorySchema.extend({ sortOrder: z.coerce.number().int().optional() }).safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const category = await prisma.accCategory.update({ where: { id: req.params.id }, data: parsed.data });
    res.json({ data: category });
  } catch (error) {
    next(error);
  }
});

accCatalogRouter.delete("/categories/:id", async (req, res, next) => {
  try {
    const used = await prisma.accProduct.count({ where: { categoryId: req.params.id, active: true } });
    if (used) {
      res.status(409).json({ error: `Move or remove its ${used} product(s) first` });
      return;
    }
    await prisma.accProduct.deleteMany({ where: { categoryId: req.params.id, active: false, saleItems: { none: {} } } });
    const archived = await prisma.accProduct.count({ where: { categoryId: req.params.id } });
    if (archived) {
      res.status(409).json({ error: "This category has sales history and can't be removed" });
      return;
    }
    await prisma.accCategory.delete({ where: { id: req.params.id } });
    res.json({ data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});

/* ---------------- products ---------------- */

const productFields = {
  categoryId: z.string().min(1, "Choose a category"),
  type: text(40),
  brand: text(40),
  color: text(30),
  name: text(120),
  barcode: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : null)),
  purchasePrice: amount,
  sellingPrice: amount,
  wholesalePrice: amount,
  quickPrices: z.array(z.coerce.number().positive().max(10_000_000)).max(8).default([]),
  lowStockAt: z.coerce.number().int().min(0).max(100000).default(0),
  isFavourite: z.boolean().default(false),
};

const createSchema = z.object({
  ...productFields,
  /** One product per phone model (covers / glass for many models at once). */
  variants: z
    .array(
      z.object({
        model: text(60),
        color: text(30),
        qty: z.coerce.number().int().min(0).max(100000).default(0),
      }),
    )
    .min(1)
    .max(100),
  supplierId: z.string().optional(),
});

accCatalogRouter.post("/products", async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const { variants, supplierId, ...base } = parsed.data;
    const category = await prisma.accCategory.findUnique({ where: { id: base.categoryId } });
    if (!category) {
      res.status(400).json({ error: "Category not found" });
      return;
    }
    if (base.barcode && variants.length > 1) {
      res.status(400).json({ error: "A barcode can only be set when adding one product" });
      return;
    }
    const by = req.user?.name || null;
    const created = await prisma.$transaction(async (tx) => {
      const out = [];
      const stocked: Array<{ productId: string; qty: number }> = [];
      for (const variant of variants) {
        const color = variant.color || base.color;
        const name =
          variants.length > 1 || !base.name
            ? composeName({
                category: category.name,
                type: base.type,
                brand: base.brand,
                model: variant.model,
                color,
                name: variants.length > 1 && base.name ? `${base.name} · ${variant.model}` : base.name,
              })
            : base.name;
        if (!name) throw Object.assign(new Error("Enter a product name"), { status: 400 });
        const product = await tx.accProduct.create({
          data: {
            categoryId: base.categoryId,
            name,
            type: base.type,
            brand: base.brand,
            model: variant.model,
            color,
            barcode: base.barcode,
            purchasePrice: base.purchasePrice,
            sellingPrice: base.sellingPrice,
            wholesalePrice: base.wholesalePrice,
            quickPrices: JSON.stringify(base.quickPrices),
            lowStockAt: base.lowStockAt,
            isFavourite: base.isFavourite,
            stockQty: variant.qty,
          },
          include: { category: true },
        });
        if (variant.qty > 0) {
          stocked.push({ productId: product.id, qty: variant.qty });
        }
        out.push(product);
      }
      if (stocked.length) {
        const purchase = await tx.accPurchase.create({
          data: {
            supplierId: supplierId || null,
            total: round2(stocked.reduce((s, r) => s + r.qty * base.purchasePrice, 0)),
            note: supplierId ? "" : "Opening stock",
            createdByName: by,
            items: { create: stocked.map((r) => ({ productId: r.productId, qty: r.qty, unitCost: base.purchasePrice })) },
          },
        });
        await tx.accStockMove.createMany({
          data: stocked.map((r) => ({
            productId: r.productId,
            kind: supplierId ? "PURCHASE" : "OPENING",
            qty: r.qty,
            unitCost: base.purchasePrice,
            refId: purchase.id,
            createdByName: by,
          })),
        });
      }
      return out;
    });
    res.status(201).json({ data: created.map(serializeProduct) });
  } catch (error) {
    if ((error as { status?: number }).status === 400) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }
    if ((error as { code?: string }).code === "P2002") {
      res.status(409).json({ error: "That barcode is already used by another product" });
      return;
    }
    next(error);
  }
});

const updateSchema = z.object({ ...productFields, model: text(60) });

accCatalogRouter.put("/products/:id", async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const category = await prisma.accCategory.findUnique({ where: { id: parsed.data.categoryId } });
    if (!category) {
      res.status(400).json({ error: "Category not found" });
      return;
    }
    const { quickPrices, ...rest } = parsed.data;
    const product = await prisma.accProduct.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        name: composeName({ category: category.name, ...rest }),
        quickPrices: JSON.stringify(quickPrices),
      },
      include: { category: true },
    });
    res.json({ data: serializeProduct(product) });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      res.status(409).json({ error: "That barcode is already used by another product" });
      return;
    }
    next(error);
  }
});

accCatalogRouter.patch("/products/:id/favourite", async (req, res, next) => {
  try {
    const isFavourite = Boolean(req.body?.isFavourite);
    const product = await prisma.accProduct.update({
      where: { id: req.params.id },
      data: { isFavourite },
      include: { category: true },
    });
    res.json({ data: serializeProduct(product) });
  } catch (error) {
    next(error);
  }
});

/** Stock count correction (damaged, lost, counted). */
accCatalogRouter.post("/products/:id/adjust", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        setTo: z.coerce.number().int().min(0).max(1_000_000),
        note: text(200),
      })
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.accProduct.findUniqueOrThrow({ where: { id: req.params.id } });
      const delta = parsed.data.setTo - current.stockQty;
      if (delta !== 0) {
        await tx.accStockMove.create({
          data: {
            productId: current.id,
            kind: "ADJUST",
            qty: delta,
            unitCost: current.purchasePrice,
            note: parsed.data.note || null,
            createdByName: req.user?.name || null,
          },
        });
      }
      return tx.accProduct.update({
        where: { id: current.id },
        data: { stockQty: parsed.data.setTo },
        include: { category: true },
      });
    });
    res.json({ data: serializeProduct(product) });
  } catch (error) {
    next(error);
  }
});

/** Remove from the catalogue; history and past bills keep the name. */
accCatalogRouter.delete("/products/:id", async (req, res, next) => {
  try {
    const sold = await prisma.accSaleItem.count({ where: { productId: req.params.id } });
    if (sold) {
      await prisma.accProduct.update({ where: { id: req.params.id }, data: { active: false, isFavourite: false, barcode: null } });
    } else {
      await prisma.accProduct.delete({ where: { id: req.params.id } });
    }
    res.json({ data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});

accCatalogRouter.get("/products/:id/history", async (req, res, next) => {
  try {
    const moves = await prisma.accStockMove.findMany({
      where: { productId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const saleIds = moves.filter((m) => m.kind === "SALE" || m.kind === "VOID").map((m) => m.refId!).filter(Boolean);
    const sales = await prisma.accSale.findMany({
      where: { id: { in: saleIds } },
      select: { id: true, number: true, kind: true, customerName: true },
    });
    const byId = new Map(sales.map((s) => [s.id, s]));
    res.json({
      data: moves.map((m) => ({
        id: m.id,
        kind: m.kind,
        qty: m.qty,
        unitCost: m.unitCost,
        note: m.note,
        createdAt: m.createdAt,
        createdByName: m.createdByName,
        sale: m.refId ? byId.get(m.refId) ?? null : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/* ---------------- stock PDF ---------------- */

accCatalogRouter.get("/products/pdf", async (req, res, next) => {
  try {
    const filter = String(req.query.filter || "all");
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : "";
    const withCost = req.query.cost === "1";
    const products = await prisma.accProduct.findMany({
      where: {
        active: true,
        ...(categoryId ? { categoryId } : {}),
        ...(filter === "out" ? { stockQty: { lte: 0 } } : {}),
        ...(filter === "fav" ? { isFavourite: true } : {}),
        ...(filter === "instock" ? { stockQty: { gt: 0 } } : {}),
      },
      include: { category: true },
    });
    const rows = products.filter((p) => filter !== "low" || (p.stockQty <= p.lowStockAt && p.lowStockAt > 0) || p.stockQty <= 0);
    const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    rows.sort(
      (a, b) =>
        a.category.sortOrder - b.category.sortOrder ||
        collator.compare(a.category.name, b.category.name) ||
        collator.compare(a.type || a.brand, b.type || b.brand) ||
        collator.compare(a.name, b.name),
    );

    const pdfRows: PdfRow[] = [];
    let units = 0;
    let costValue = 0;
    let retailValue = 0;
    let current = "";
    let groupUnits = 0;
    let groupCost = 0;
    let groupRetail = 0;
    const flush = () => {
      if (!current) return;
      pdfRows.push({
        kind: "subtotal",
        cells: {
          name: `${current} total`,
          qty: String(groupUnits),
          ...(withCost ? { cost: money(groupCost) } : {}),
          value: money(groupRetail),
        },
      });
    };
    for (const p of rows) {
      if (p.category.name !== current) {
        flush();
        current = p.category.name;
        groupUnits = 0;
        groupCost = 0;
        groupRetail = 0;
        pdfRows.push({ kind: "group", cells: { name: current.toUpperCase() } });
      }
      const qty = Math.max(p.stockQty, 0);
      units += qty;
      groupUnits += qty;
      costValue += qty * p.purchasePrice;
      groupCost += qty * p.purchasePrice;
      retailValue += qty * p.sellingPrice;
      groupRetail += qty * p.sellingPrice;
      const low = p.stockQty <= 0 || (p.lowStockAt > 0 && p.stockQty <= p.lowStockAt);
      pdfRows.push({
        cells: {
          name: p.name,
          kind: [p.type, p.brand].filter(Boolean).join(" · "),
          qty: String(p.stockQty),
          ...(withCost ? { cost: money(p.purchasePrice) } : {}),
          sell: money(p.sellingPrice),
          whole: p.wholesalePrice ? money(p.wholesalePrice) : "",
          value: money(qty * p.sellingPrice),
        },
        sub: { name: [p.model, p.color, p.isFavourite ? "★ Counter" : ""].filter(Boolean).join(" · ") },
        color: low ? { qty: p.stockQty <= 0 ? PDF_TONE.red : PDF_TONE.amber } : undefined,
      });
    }
    flush();

    const category = categoryId ? await prisma.accCategory.findUnique({ where: { id: categoryId } }) : null;
    const filterLabel =
      { all: "All products", low: "Low & out of stock", out: "Out of stock", fav: "Counter favourites", instock: "In stock" }[
        filter
      ] || "All products";
    const pdf = await renderAccPdf({
      title: "Stock report",
      subtitle: `${category ? `${category.name} · ` : ""}${filterLabel}`,
      summary: [
        { label: "Products", value: String(rows.length) },
        { label: "Units in stock", value: String(units), tone: "blue" },
        ...(withCost ? [{ label: "Value at cost", value: rs(round2(costValue)) }] : []),
        { label: "Value at selling price", value: rs(round2(retailValue)), tone: "green" as const },
        {
          label: "Low / out",
          value: `${rows.filter((p) => p.lowStockAt > 0 && p.stockQty > 0 && p.stockQty <= p.lowStockAt).length} / ${rows.filter((p) => p.stockQty <= 0).length}`,
          tone: "amber" as const,
        },
      ],
      sections: [
        {
          columns: [
            { key: "name", label: "Product", width: 30 },
            { key: "kind", label: "Type / brand", width: 13 },
            { key: "qty", label: "Qty", width: 6, align: "right" },
            ...(withCost ? [{ key: "cost", label: "Cost", width: 9, align: "right" as const }] : []),
            { key: "sell", label: "Selling", width: 9, align: "right" },
            { key: "whole", label: "Wholesale", width: 9, align: "right" },
            { key: "value", label: "Stock value", width: 11, align: "right" },
          ],
          rows: pdfRows,
          total: {
            name: `Total · ${rows.length} products`,
            qty: String(units),
            ...(withCost ? { cost: money(round2(costValue)) } : {}),
            value: money(round2(retailValue)),
          },
          empty: "No products for this filter.",
        },
      ],
      footNote: "Stock value at selling price. Red qty = out of stock, amber = low.",
    });
    sendPdf(res, pdf, `accessories-stock-${istDateString()}.pdf`);
  } catch (error) {
    next(error);
  }
});
