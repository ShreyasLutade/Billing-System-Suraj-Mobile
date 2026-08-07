import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { normalizeCapacity } from "../lib/capacity";
import { upsertSupplierByName } from "../services/suppliers";

export const stockRouter = Router();

function parseSuppliers(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function serializeSuppliers(names: string[]): string {
  return JSON.stringify(names.map((name) => name.trim()).filter(Boolean));
}

function mapStockItem(item: {
  id: string;
  condition: string;
  platform: string;
  mobileName: string;
  storage: string;
  ram: string;
  color: string;
  imei: string;
  purchasePrice: number;
  suppliers: string;
  supplierId?: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  supplier?: { id: string; name: string; isExchange?: boolean } | null;
}) {
  const fromJson = parseSuppliers(item.suppliers);
  const supplierName = item.supplier?.name;
  return {
    ...item,
    supplierId: item.supplierId || null,
    supplierName: supplierName || fromJson[0] || null,
    supplierIsExchange: Boolean(item.supplier?.isExchange),
    suppliers: supplierName
      ? [supplierName]
      : fromJson.length
        ? fromJson
        : [],
  };
}

const createStockSchema = z
  .object({
    condition: z.enum(["NEW", "USED"]),
    platform: z.enum(["IOS", "ANDROID"]),
    mobileName: z.string().trim().min(2, "Mobile name is required").max(100),
    storage: z.string().trim().min(1, "Storage is required").max(30),
    ram: z.string().trim().max(30).optional().default(""),
    color: z.string().trim().min(1, "Color is required").max(50),
    imei: z
      .string()
      .trim()
      .min(8, "IMEI number is required")
      .max(20, "IMEI looks too long"),
    purchasePrice: z.coerce
      .number({ invalid_type_error: "Purchase price is required" })
      .positive("Purchase price must be greater than 0"),
    supplierId: z.string().trim().optional().nullable(),
    suppliers: z
      .array(z.string().trim().min(1).max(80))
      .max(1)
      .optional()
      .default([]),
  })
  .superRefine((data, ctx) => {
    if (data.platform === "ANDROID" && !data.ram?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RAM is required for Android mobiles",
        path: ["ram"],
      });
    }
    if (!data.supplierId?.trim() && !data.suppliers?.[0]?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Supplier is required",
        path: ["supplierId"],
      });
    }
  });

stockRouter.get("/", async (req, res, next) => {
  try {
    const condition =
      typeof req.query.condition === "string"
        ? req.query.condition.toUpperCase()
        : undefined;
    const includeIds =
      typeof req.query.includeIds === "string"
        ? req.query.includeIds
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : [];
    const supplierId =
      typeof req.query.supplierId === "string" ? req.query.supplierId : undefined;

    const items = await prisma.stockItem.findMany({
      where: {
        AND: [
          condition === "NEW" || condition === "USED" ? { condition } : {},
          supplierId ? { supplierId } : {},
          includeIds.length
            ? {
                OR: [{ status: "AVAILABLE" }, { id: { in: includeIds } }],
              }
            : { status: "AVAILABLE" },
        ],
      },
      include: { supplier: { select: { id: true, name: true, isExchange: true } } },
      orderBy: [{ createdAt: "desc" }, { mobileName: "asc" }],
    });

    res.json({ data: items.map(mapStockItem) });
  } catch (error) {
    next(error);
  }
});

stockRouter.get("/:id/history", async (req, res, next) => {
  try {
    const item = await prisma.stockItem.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        purchaseItem: {
          include: {
            purchase: {
              include: { supplier: true },
            },
          },
        },
        billItems: {
          include: {
            bill: {
              select: {
                id: true,
                invoiceNumber: true,
                billDate: true,
                customerName: true,
                customerPhone: true,
              },
            },
          },
          orderBy: { bill: { billDate: "desc" } },
          take: 5,
        },
      },
    });

    if (!item) {
      res.status(404).json({ error: "Stock item not found" });
      return;
    }

    const purchase = item.purchaseItem?.purchase;
    const sale = item.billItems[0]?.bill || null;

    res.json({
      data: {
        stock: mapStockItem(item),
        purchase: purchase
          ? {
              id: purchase.id,
              purchaseDate: purchase.purchaseDate,
              note: purchase.note,
              supplier: purchase.supplier,
            }
          : null,
        supplier: item.supplier
          ? { id: item.supplier.id, name: item.supplier.name }
          : purchase?.supplier
            ? { id: purchase.supplier.id, name: purchase.supplier.name }
            : null,
        sale: sale
          ? {
              billId: sale.id,
              invoiceNumber: sale.invoiceNumber,
              billDate: sale.billDate,
              customerName: sale.customerName,
              customerPhone: sale.customerPhone,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

stockRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createStockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const data = parsed.data;
    const imei = data.imei.replace(/\s+/g, "");

    const existing = await prisma.stockItem.findUnique({ where: { imei } });
    if (existing) {
      res.status(409).json({ error: `IMEI ${imei} is already in stock` });
      return;
    }

    let supplier = data.supplierId
      ? await prisma.supplier.findUnique({ where: { id: data.supplierId } })
      : null;

    if (!supplier && data.suppliers?.[0]) {
      supplier = await upsertSupplierByName(prisma, data.suppliers[0]);
    }

    if (!supplier) {
      res.status(400).json({ error: "Supplier is required" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          supplierId: supplier!.id,
          condition: data.condition,
          totalAmount: data.purchasePrice,
          purchaseDate: new Date(),
        },
      });

      const item = await tx.stockItem.create({
        data: {
          condition: data.condition,
          platform: data.platform,
          mobileName: data.mobileName.trim(),
          storage: normalizeCapacity(data.storage),
          ram:
            data.platform === "ANDROID"
              ? normalizeCapacity(data.ram)
              : "",
          color: data.color.trim(),
          imei,
          purchasePrice: data.purchasePrice,
          suppliers: serializeSuppliers([supplier!.name]),
          supplierId: supplier!.id,
          status: "AVAILABLE",
        },
        include: { supplier: { select: { id: true, name: true, isExchange: true } } },
      });

      await tx.purchaseItem.create({
        data: { purchaseId: purchase.id, stockItemId: item.id },
      });

      return item;
    });

    res.status(201).json({ data: mapStockItem(result) });
  } catch (error) {
    next(error);
  }
});

stockRouter.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.stockItem.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Stock item not found" });
      return;
    }

    await prisma.stockItem.delete({ where: { id: existing.id } });
    res.json({ data: { id: existing.id } });
  } catch (error) {
    next(error);
  }
});
