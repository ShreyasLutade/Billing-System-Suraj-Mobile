import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  ensurePhoneModelsSeeded,
  upsertPhoneModel,
} from "../services/phoneModels";

export const phoneModelsRouter = Router();

phoneModelsRouter.get("/", async (req, res, next) => {
  try {
    await ensurePhoneModelsSeeded(prisma);
    const platform =
      req.query.platform === "IOS" || req.query.platform === "ANDROID"
        ? req.query.platform
        : undefined;

    const models = await prisma.phoneModel.findMany({
      where: platform ? { platform } : undefined,
      orderBy: [{ name: "asc" }, { storage: "asc" }, { ram: "asc" }],
      select: {
        id: true,
        platform: true,
        name: true,
        storage: true,
        ram: true,
      },
    });

    res.json({ data: models });
  } catch (error) {
    next(error);
  }
});

const upsertSchema = z
  .object({
    platform: z.enum(["IOS", "ANDROID"]),
    name: z.string().trim().min(2).max(100),
    storage: z.string().trim().min(1).max(30),
    ram: z.string().trim().max(30).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.platform === "ANDROID" && !data.ram?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RAM is required for Android",
        path: ["ram"],
      });
    }
  });

phoneModelsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }
    const model = await upsertPhoneModel(prisma, parsed.data);
    res.status(201).json({ data: model });
  } catch (error) {
    next(error);
  }
});
