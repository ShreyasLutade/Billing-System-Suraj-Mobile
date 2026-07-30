import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const mobileCatalogRouter = Router();

const createMobileSchema = z
  .object({
    name: z.string().trim().min(2, "Phone name is required").max(100),
    platform: z.enum(["IOS", "ANDROID"]),
    condition: z.enum(["NEW", "USED"]).default("NEW"),
    color: z.string().trim().min(1, "Color is required").max(50),
    storage: z.string().trim().min(1, "Storage is required").max(30),
    ram: z.string().trim().max(30).optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.platform === "ANDROID" && !data.ram) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RAM is required for Android mobiles",
        path: ["ram"],
      });
    }
  });

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function capitalizeFirst(value: string) {
  const normalized = clean(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeCapacity(value: string) {
  const normalized = clean(value);
  const capacity = normalized.replace(/\s*gb\s*$/i, "").trim();
  return /^\d+$/.test(capacity) ? `${capacity} GB` : normalized;
}

mobileCatalogRouter.get("/", async (_req, res, next) => {
  try {
    const mobiles = await prisma.mobileCatalog.findMany({
      orderBy: [
        { name: "asc" },
        { condition: "asc" },
        { storage: "asc" },
        { color: "asc" },
      ],
    });
    res.json({ data: mobiles });
  } catch (error) {
    next(error);
  }
});

mobileCatalogRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createMobileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const input = parsed.data;
    const values = {
      name: capitalizeFirst(input.name),
      platform: input.platform,
      condition: input.condition,
      color: capitalizeFirst(input.color),
      storage: normalizeCapacity(input.storage),
      ram: input.platform === "ANDROID" ? normalizeCapacity(input.ram) : "",
    };

    const existing = await prisma.mobileCatalog.findFirst({
      where: values,
    });
    if (existing) {
      res.json({ data: existing, created: false });
      return;
    }

    const mobile = await prisma.mobileCatalog.create({ data: values });
    res.status(201).json({ data: mobile, created: true });
  } catch (error) {
    next(error);
  }
});
