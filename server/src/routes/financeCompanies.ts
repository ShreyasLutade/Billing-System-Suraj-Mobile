import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const financeCompaniesRouter = Router();

const createSchema = z.object({
  name: z.string().trim().min(2, "Finance company name is required").max(80),
});

financeCompaniesRouter.get("/", async (_req, res, next) => {
  try {
    const companies = await prisma.financeCompany.findMany({
      orderBy: { name: "asc" },
    });
    res.json({ data: companies });
  } catch (error) {
    next(error);
  }
});

financeCompaniesRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const name = parsed.data.name.replace(/\s+/g, " ");
    const existing = await prisma.financeCompany.findFirst({
      where: { name: { equals: name } },
    });
    if (existing) {
      res.json({ data: existing, created: false });
      return;
    }

    const company = await prisma.financeCompany.create({
      data: { name },
    });
    res.status(201).json({ data: company, created: true });
  } catch (error) {
    next(error);
  }
});

export async function seedFinanceCompanies() {
  const defaults = ["Bajaj Finance", "ICICI Finance"];
  for (const name of defaults) {
    await prisma.financeCompany.upsert({
      where: { name },
      create: { name },
      update: {},
    });
  }
}
