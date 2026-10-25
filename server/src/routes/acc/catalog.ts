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

/** Category plus the phone-model breakdown, for every product sent to the app. */
export const productInclude = {
  category: true,
  models: { orderBy: { model: "asc" } },
} satisfies Prisma.AccProductInclude;

export function serializeProduct(
  product:
    | Prisma.AccProductGetPayload<{ include: typeof productInclude }>
    | Prisma.AccProductGetPayload<{ include: { category: true } }>
    | Prisma.AccProductGetPayload<object>,
) {
  const category = "category" in product ? product.category : null;
  const models = "models" in product ? product.models : [];
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
    countedAt: product.countedAt,
    models: models.map((m) => ({ model: m.model, qty: m.qty })),
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
  if (!count) {
    await prisma.accCategory.createMany({
      data: DEFAULT_ACC_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })),
    });
    return;
  }
  await Promise.all(
    DEFAULT_ACC_CATEGORIES.map((c, i) =>
      prisma.accCategory.updateMany({ where: { name: c.name }, data: { drillBy: c.drillBy, icon: c.icon, sortOrder: i } }),
    ),
  );
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
        include: productInclude,
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
});

/** Stock only ever comes in through a supplier (Add stock), never directly. */
const NO_DIRECT_STOCK = "Stock can only be added from a supplier on the Add stock page";

accCatalogRouter.post("/products", async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const { variants, ...base } = parsed.data;
    if (variants.some((v) => v.qty > 0)) {
      res.status(400).json({ error: `New products start at 0. ${NO_DIRECT_STOCK}.` });
      return;
    }
    const category = await prisma.accCategory.findUnique({ where: { id: base.categoryId } });
    if (!category) {
      res.status(400).json({ error: "Category not found" });
      return;
    }
    if (base.barcode && variants.length > 1) {
      res.status(400).json({ error: "A barcode can only be set when adding one product" });
      return;
    }
    const created = await prisma.$transaction(async (tx) => {
      const out = [];
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
          },
          include: productInclude,
        });
        out.push(product);
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
      include: productInclude,
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
      include: productInclude,
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
      if (delta > 0) {
        throw Object.assign(new Error(`A correction can only lower stock. ${NO_DIRECT_STOCK}.`), { status: 400 });
      }
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
        data: { stockQty: parsed.data.setTo, countedAt: new Date() },
        include: productInclude,
      });
    });
    res.json({ data: serializeProduct(product) });
  } catch (error) {
    if ((error as { status?: number }).status === 400) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }
    next(error);
  }
});

/* ---------------- phone-model breakdown & stock check ---------------- */

const modelRows = z
  .array(
    z.object({
      model: z.string().trim().min(1, "Enter the phone model").max(60),
      qty: z.coerce.number().int().min(0).max(1_000_000),
    }),
  )
  .max(300);

/** Same model typed twice ("iphone 15" / "iPhone 15 ") counts as one. */
function cleanModels(rows: z.infer<typeof modelRows>) {
  const seen = new Map<string, { model: string; qty: number }>();
  for (const row of rows) {
    const model = row.model.replace(/\s+/g, " ").trim();
    const key = model.toLowerCase();
    const prev = seen.get(key);
    seen.set(key, { model: prev?.model || model, qty: (prev?.qty || 0) + row.qty });
  }
  return [...seen.values()];
}

async function replaceModels(
  tx: Prisma.TransactionClient,
  productId: string,
  rows: Array<{ model: string; qty: number }>,
) {
  await tx.accProductModel.deleteMany({
    where: { productId, model: { notIn: rows.map((r) => r.model) } },
  });
  for (const row of rows) {
    await tx.accProductModel.upsert({
      where: { productId_model: { productId, model: row.model } },
      create: { productId, model: row.model, qty: row.qty },
      update: { qty: row.qty },
    });
  }
}

/** Split a product's stock by phone model (for the record only). */
accCatalogRouter.put("/products/:id/models", async (req, res, next) => {
  try {
    const parsed = z.object({ models: modelRows }).safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const rows = cleanModels(parsed.data.models);
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.accProduct.findUniqueOrThrow({ where: { id: req.params.id } });
      const sorted = rows.reduce((a, r) => a + r.qty, 0);
      if (sorted > Math.max(current.stockQty, 0)) {
        throw Object.assign(
          new Error(`Sorted ${sorted} pcs but only ${Math.max(current.stockQty, 0)} in stock. Lower a model or do a stock check.`),
          { status: 400 },
        );
      }
      await replaceModels(tx, current.id, rows);
      return tx.accProduct.findUniqueOrThrow({ where: { id: current.id }, include: productInclude });
    });
    res.json({ data: serializeProduct(product) });
  } catch (error) {
    if ((error as { status?: number }).status === 400) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }
    next(error);
  }
});

/**
 * Weekly stock check: the counted quantity for each product (and, for
 * products sorted by model, each model). Differences are logged as COUNT
 * moves; every product sent is marked as checked now.
 */
accCatalogRouter.post("/stock-check", async (req, res, next) => {
  try {
    const parsed = z
      .object({
        items: z
          .array(
            z.object({
              productId: z.string().min(1),
              qty: z.coerce.number().int().min(0).max(1_000_000),
              models: modelRows.optional(),
            }),
          )
          .min(1, "Count at least one product")
          .max(2000),
        note: text(200),
      })
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const by = req.user?.name || null;
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      let changed = 0;
      const out = [];
      for (const item of parsed.data.items) {
        const current = await tx.accProduct.findUnique({ where: { id: item.productId } });
        if (!current) continue;
        const rows = item.models ? cleanModels(item.models) : null;
        if (rows && rows.reduce((a, r) => a + r.qty, 0) > item.qty) {
          throw Object.assign(new Error(`${current.name}: models add up to more than the total counted`), { status: 400 });
        }
        const delta = item.qty - current.stockQty;
        if (delta > 0) {
          throw Object.assign(
            new Error(`${current.name}: counted ${item.qty} but stock is ${current.stockQty}. ${NO_DIRECT_STOCK}.`),
            { status: 400 },
          );
        }
        if (delta !== 0) {
          changed++;
          await tx.accStockMove.create({
            data: {
              productId: current.id,
              kind: "COUNT",
              qty: delta,
              unitCost: current.purchasePrice,
              note: parsed.data.note || "Stock check",
              createdByName: by,
            },
          });
        }
        if (rows) await replaceModels(tx, current.id, rows);
        out.push(
          await tx.accProduct.update({
            where: { id: current.id },
            data: { stockQty: item.qty, countedAt: now },
            include: productInclude,
          }),
        );
      }
      return { changed, products: out };
    });
    res.json({
      data: {
        checked: result.products.length,
        changed: result.changed,
        products: result.products.map(serializeProduct),
      },
    });
  } catch (error) {
    if ((error as { status?: number }).status === 400) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }
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
      const outOfStock = p.stockQty <= 0;
      const low = p.lowStockAt > 0 && p.stockQty <= p.lowStockAt;
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
        color: outOfStock ? { name: PDF_TONE.red, qty: PDF_TONE.red } : low ? { qty: PDF_TONE.amber } : undefined,
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
