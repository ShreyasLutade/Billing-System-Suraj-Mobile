import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { upsertMobileCatalog } from "../services/mobileCatalog";

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

    const { mobile, created } = await upsertMobileCatalog(prisma, parsed.data);
    res.status(created ? 201 : 200).json({ data: mobile, created });
  } catch (error) {
    next(error);
  }
});
