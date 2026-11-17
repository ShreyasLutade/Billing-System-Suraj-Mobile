import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";

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
