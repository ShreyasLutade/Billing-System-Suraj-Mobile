import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { renderAccPdf, sendPdf, PDF_TONE, titleCase, type PdfRow, type PdfSection } from "../../services/accPdf";

/**
 * Cover boxes: where each cover (product + phone model) sits in the shop.
 * Starts with one 4 × 7 grid (A1–A4 … G1–G4); more grids or single boxes
 * can be added. Location only; quantities come from the product's stock.
 */
export const accBoxesRouter = Router();

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

async function ensureDefaultGrid() {
  if (await prisma.accBox.count()) return;
  const data = [];
  for (let r = 0; r < 7; r += 1) for (let c = 0; c < 4; c += 1) data.push({ code: `${LETTERS[r]}${c + 1}`, grid: "Main", row: r, col: c });
  await prisma.accBox.createMany({ data });
}

async function listBoxes() {
  const boxes = await prisma.accBox.findMany({
    orderBy: [{ createdAt: "asc" }, { row: "asc" }, { col: "asc" }],
    include: { items: { select: { id: true, productId: true, model: true }, orderBy: { createdAt: "asc" } } },
  });
  return boxes.map((b) => ({ id: b.id, code: b.code, grid: b.grid, row: b.row, col: b.col, items: b.items }));
}

accBoxesRouter.get("/boxes", async (_req, res, next) => {
  try {
    await ensureDefaultGrid();
    res.json({ data: await listBoxes() });
  } catch (error) {
    next(error);
  }
});

/** A new grid: rows continue the letters (H, I, …), columns 1…n. */
accBoxesRouter.post("/boxes/grid", async (req, res, next) => {
  try {
    const parsed = z
      .object({ rows: z.coerce.number().int().min(1).max(12), cols: z.coerce.number().int().min(1).max(8), name: z.string().trim().max(30).optional() })
      .safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Choose rows (1–12) and columns (1–8)" });
    const { rows, cols } = parsed.data;
    const used = new Set((await prisma.accBox.findMany({ select: { code: true } })).map((b) => b.code.replace(/\d+$/, "")));
    const free = [...LETTERS].filter((l) => !used.has(l));
    if (free.length < rows) return void res.status(400).json({ error: `Only ${free.length} row letters left` });
    const grids = await prisma.accBox.findMany({ distinct: ["grid"], select: { grid: true } });
    const name = parsed.data.name || `Grid ${grids.filter((g) => g.grid !== "Single").length + 1}`;
    const data = [];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) data.push({ code: `${free[r]}${c + 1}`, grid: name, row: r, col: c });
    await prisma.accBox.createMany({ data });
    res.status(201).json({ data: await listBoxes() });
  } catch (error) {
    next(error);
  }
});

/** One extra box (S1, S2, … or a name you choose). */
accBoxesRouter.post("/boxes/single", async (req, res, next) => {
  try {
    const wanted = String(req.body?.code || "").trim().toUpperCase().slice(0, 12);
    let code = wanted;
    if (!code) {
      const singles = await prisma.accBox.count({ where: { grid: "Single" } });
      code = `S${singles + 1}`;
      while (await prisma.accBox.findUnique({ where: { code } })) code = `S${Number(code.slice(1)) + 1}`;
    } else if (await prisma.accBox.findUnique({ where: { code } })) {
      return void res.status(409).json({ error: `A box named ${code} already exists` });
    }
    await prisma.accBox.create({ data: { code, grid: "Single" } });
    res.status(201).json({ data: await listBoxes() });
  } catch (error) {
    next(error);
  }
});

accBoxesRouter.delete("/boxes/:id", async (req, res, next) => {
  try {
    if (req.user?.role !== "ADMIN") {
      res.status(403).json({ error: "Only the admin can remove a box" });
      return;
    }
    await prisma.accBox.delete({ where: { id: req.params.id } });
    res.json({ data: await listBoxes() });
  } catch (error) {
    next(error);
  }
});

/** Put a cover (product + phone model) in a box. */
accBoxesRouter.post("/boxes/:id/items", async (req, res, next) => {
  try {
    const parsed = z.object({ productId: z.string().min(1), model: z.string().trim().max(60).default("") }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Choose a cover" });
    const { productId, model } = parsed.data;
    await prisma.accBoxItem.upsert({
      where: { boxId_productId_model: { boxId: req.params.id, productId, model } },
      create: { boxId: req.params.id, productId, model },
      update: {},
    });
    res.status(201).json({ data: await listBoxes() });
  } catch (error) {
    next(error);
  }
});

/** Put several covers in one box at once ("Fill box"). */
accBoxesRouter.post("/boxes/:id/items/bulk", async (req, res, next) => {
  try {
    const parsed = z
      .object({ items: z.array(z.object({ productId: z.string().min(1), model: z.string().trim().max(60).default("") })).min(1).max(500) })
      .safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Choose the covers" });
    const boxId = req.params.id;
    await prisma.$transaction(
      parsed.data.items.map(({ productId, model }) =>
        prisma.accBoxItem.upsert({
          where: { boxId_productId_model: { boxId, productId, model } },
          create: { boxId, productId, model },
          update: {},
        }),
      ),
    );
    res.status(201).json({ data: await listBoxes() });
  } catch (error) {
    next(error);
  }
});

accBoxesRouter.delete("/boxes/items/:itemId", async (req, res, next) => {
  try {
    await prisma.accBoxItem.delete({ where: { id: req.params.itemId } });
    res.json({ data: await listBoxes() });
  } catch (error) {
    next(error);
  }
});

/**
 * Cover boxes as a PDF: every box with the covers inside (phone model,
 * cover, pieces, other boxes it is also in), plus covers not in any box.
 * ?boxId= gives just that one box.
 */
accBoxesRouter.get("/boxes/pdf", async (req, res, next) => {
  try {
    const boxId = typeof req.query.boxId === "string" ? req.query.boxId : "";
    await ensureDefaultGrid();
    const [boxes, products] = await Promise.all([
      prisma.accBox.findMany({
        orderBy: [{ createdAt: "asc" }, { row: "asc" }, { col: "asc" }],
        include: { items: { orderBy: { createdAt: "asc" } } },
      }),
      prisma.accProduct.findMany({
        where: { active: true },
        include: { category: { select: { name: true } }, models: true },
      }),
    ]);
    const covers = products.filter((p) => /cover/i.test(p.category.name));
    const byId = new Map(covers.map((p) => [p.id, p]));
    const qtyOf = (productId: string, model: string) => {
      const p = byId.get(productId);
      if (!p) return 0;
      if (model) return p.models.filter((m) => m.model === model).reduce((a, m) => a + m.qty, 0); // all lots
      return Math.max(0, p.stockQty - p.models.reduce((a, m) => a + Math.max(0, m.qty), 0));
    };
    const where = new Map<string, string[]>();
    for (const b of boxes) for (const i of b.items) {
      const k = `${i.productId}|${i.model}`;
      where.set(k, [...(where.get(k) ?? []), b.code]);
    }
    const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    const columns = [
      { key: "n", label: "#", width: 0.45, align: "center" as const },
      { key: "model", label: "Phone model", width: 2.5, keepCase: true },
      { key: "cover", label: "Cover", width: 3.8, keepCase: true },
      { key: "qty", label: "Pcs", width: 0.9, align: "right" as const },
      { key: "also", label: "Also in", width: 1.3 },
    ];

    const picked = boxId ? boxes.filter((b) => b.id === boxId) : boxes.filter((b) => b.items.length);
    if (boxId && !picked.length) {
      res.status(404).json({ error: "Box not found" });
      return;
    }
    let pieces = 0;
    let lines = 0;
    const sections: PdfSection[] = picked.map((b) => {
      const items = b.items
        .filter((i) => byId.has(i.productId))
        .sort((x, y) => collator.compare(x.model || "~", y.model || "~") || collator.compare(byId.get(x.productId)!.name, byId.get(y.productId)!.name));
      let boxPcs = 0;
      const rows: PdfRow[] = items.map((i, n) => {
        const qty = qtyOf(i.productId, i.model);
        boxPcs += qty;
        const also = (where.get(`${i.productId}|${i.model}`) ?? []).filter((c) => c !== b.code);
        return {
          cells: {
            n: String(n + 1),
            model: i.model || "Not split",
            cover: titleCase(byId.get(i.productId)!.name),
            qty: String(qty),
            also: also.join(", ") || "-",
          },
          color: { ...(i.model ? {} : { model: PDF_TONE.amber }), ...(qty <= 0 ? { qty: PDF_TONE.red } : {}) },
        };
      });
      pieces += boxPcs;
      lines += rows.length;
      return {
        heading: `Box ${b.code}  ·  ${rows.length} ${rows.length === 1 ? "cover" : "covers"}`,
        columns,
        rows,
        total: { model: "Box total", qty: String(boxPcs) },
        empty: "This box is empty.",
      };
    });

    // Whole-shop PDF: covers that are not in any box yet.
    let loose = 0;
    if (!boxId) {
      const rows: PdfRow[] = [];
      for (const p of covers) {
        const piles = [...new Set(p.models.filter((m) => m.qty > 0).map((m) => m.model)), ""];
        for (const model of piles) {
          const qty = qtyOf(p.id, model);
          if (qty <= 0 || where.has(`${p.id}|${model}`)) continue;
          loose += qty;
          rows.push({ cells: { n: "", model: model || "Not split", cover: titleCase(p.name), qty: String(qty), also: "-" }, color: model ? {} : { model: PDF_TONE.amber } });
        }
      }
      rows.sort((x, y) => collator.compare(x.cells.model, y.cells.model));
      rows.forEach((r, i) => (r.cells.n = String(i + 1)));
      if (rows.length) {
        sections.push({ heading: "Not in any box", full: true, columns, rows, total: { model: "Total", qty: String(loose) } });
      }
    }

    const one = boxId ? picked[0] : null;
    const pdf = await renderAccPdf({
      title: one ? `Box ${one.code}` : "Cover Boxes",
      twoUp: !one,
      subtitle: one ? "Covers in this box" : "Where every cover is kept",
      summary: one
        ? [
            { label: "Covers", value: String(lines), tone: "blue" },
            { label: "Pieces", value: String(pieces), tone: "green" },
          ]
        : [
            { label: "Boxes in use", value: `${picked.length} / ${boxes.length}`, tone: "blue" },
            { label: "Covers in boxes", value: String(lines), tone: "green" },
            { label: "Pieces in boxes", value: String(pieces), tone: "green" },
            { label: "Not in a box", value: `${loose} pcs`, tone: loose ? "amber" : "green" },
          ],
      sections: sections.length ? sections : [{ columns, rows: [], empty: "No covers are in boxes yet." }],
      notes: ["Pcs = pieces of that phone model in stock. A cover kept in two boxes shows the same pieces in both."],
    });
    sendPdf(res, pdf, one ? `box-${one.code}.pdf` : "cover-boxes.pdf");
  } catch (error) {
    next(error);
  }
});

/**
 * One cover product split by phone model as a PDF: each model with its
 * pieces and the boxes it is kept in, plus the pieces not split yet.
 */
accBoxesRouter.get("/products/:id/models/pdf", async (req, res, next) => {
  try {
    const product = await prisma.accProduct.findUnique({
      where: { id: req.params.id },
      include: { category: { select: { name: true } }, models: true, boxItems: { include: { box: { select: { code: true } } } } },
    });
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    const where = new Map<string, string[]>();
    for (const i of product.boxItems) where.set(i.model, [...(where.get(i.model) ?? []), i.box.code]);
    const models = product.models.filter((m) => m.qty > 0).sort((a, b) => b.qty - a.qty || collator.compare(a.model, b.model));
    const total = Math.max(product.stockQty, 0);
    const split = models.reduce((a, m) => a + m.qty, 0);
    const notSplit = Math.max(total - split, 0);
    const columns = [
      { key: "n", label: "#", width: 0.5, align: "center" as const },
      { key: "model", label: "Phone model", width: 4, keepCase: true },
      { key: "qty", label: "Pcs", width: 1, align: "right" as const },
      { key: "box", label: "Kept in box", width: 2 },
    ];
    const rows: PdfRow[] = models.map((m, i) => ({
      cells: { n: String(i + 1), model: m.model, qty: String(m.qty), box: (where.get(m.model) ?? []).sort(collator.compare).join(", ") || "-" },
    }));
    if (notSplit > 0) {
      rows.push({
        cells: { n: "", model: "Not split yet", qty: String(notSplit), box: (where.get("") ?? []).join(", ") || "-" },
        color: { model: PDF_TONE.amber, qty: PDF_TONE.amber },
      });
    }
    const pdf = await renderAccPdf({
      title: titleCase(product.name),
      subtitle: `${product.category.name} · split by phone model`,
      summary: [
        { label: "Total pieces", value: String(total), tone: "blue" },
        { label: "Split by model", value: `${split} pcs · ${models.length} models`, tone: "green" },
        { label: "Not split yet", value: `${notSplit} pcs`, tone: notSplit ? "amber" : "green" },
      ],
      sections: [{ columns, rows, total: { model: "Total", qty: String(total) }, empty: "Not split by model yet." }],
    });
    sendPdf(res, pdf, `${product.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "cover"}-models.pdf`);
  } catch (error) {
    next(error);
  }
});
