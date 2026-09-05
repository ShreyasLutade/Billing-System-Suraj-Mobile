import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { normalizeCapacity } from "../lib/capacity";
import { requireAdmin } from "../middleware/auth";
import { upsertSupplierByName } from "../services/suppliers";
import { intakeKindFromNote } from "../services/stockSync";

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
  kind?: string | null;
  condition: string;
  platform: string;
  mobileName: string;
  storage: string;
  ram: string;
  color: string;
  imei: string | null;
  serialNumber?: string | null;
  purchasePrice: number;
  suppliers: string;
  supplierId?: string | null;
  status: string;
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  supplier?: { id: string; name: string; isExchange?: boolean } | null;
  purchaseItem?: { purchase?: { note?: string | null } | null } | null;
}) {
  const fromJson = parseSuppliers(item.suppliers);
  const supplierName = item.supplier?.name;
  const note = item.purchaseItem?.purchase?.note || null;
  const intakeKind = intakeKindFromNote(note);
  return {
    ...item,
    kind: item.kind === "ACCESSORY" ? "ACCESSORY" : "MOBILE",
    imei: item.imei || null,
    serialNumber: item.serialNumber || null,
    supplierId: item.supplierId || null,
    supplierName: supplierName || fromJson[0] || null,
    supplierIsExchange: Boolean(item.supplier?.isExchange),
    intakeKind,
    suppliers: supplierName
      ? [supplierName]
      : fromJson.length
        ? fromJson
        : [],
  };
}

function cleanId(value: string | undefined | null) {
  return (value || "").replace(/\s+/g, "").trim();
}

const createStockSchema = z
  .object({
    condition: z.enum(["NEW", "USED"]),
    platform: z.enum(["IOS", "ANDROID"]),
    mobileName: z.string().trim().min(2, "Mobile name is required").max(100),
    storage: z.string().trim().min(1, "Storage is required").max(30),
    ram: z.string().trim().max(30).optional().default(""),
    color: z.string().trim().min(1, "Color is required").max(50),
    imei: z.string().trim().max(20).optional().default(""),
    serialNumber: z.string().trim().max(40).optional().default(""),
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
    const imei = cleanId(data.imei);
    const serial = cleanId(data.serialNumber);
    if (!imei && !serial) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter IMEI or serial number",
        path: ["imei"],
      });
    }
    if (imei && imei.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "IMEI must be at least 8 characters",
        path: ["imei"],
      });
    }
    if (serial && serial.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Serial number looks too short",
        path: ["serialNumber"],
      });
    }
  });

stockRouter.get("/", async (req, res, next) => {
  try {
    const condition =
      typeof req.query.condition === "string"
        ? req.query.condition.toUpperCase()
        : undefined;
    const kind =
      typeof req.query.kind === "string"
        ? req.query.kind.toUpperCase()
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

    const kindFilter =
      kind === "ACCESSORY"
        ? { kind: "ACCESSORY" }
        : kind === "ALL"
          ? {}
          : { NOT: { kind: "ACCESSORY" } };

    const items = await prisma.stockItem.findMany({
      where: {
        AND: [
          kindFilter,
          condition === "NEW" || condition === "USED" ? { condition } : {},
          supplierId ? { supplierId } : {},
          includeIds.length
            ? {
                OR: [{ status: "AVAILABLE" }, { id: { in: includeIds } }],
              }
            : { status: "AVAILABLE" },
        ],
      },
      include: {
        supplier: { select: { id: true, name: true, isExchange: true } },
        purchaseItem: { select: { purchase: { select: { note: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { mobileName: "asc" }],
    });

    // Mobiles first, then accessories (create-bill dropdown search order).
    const sorted =
      kind === "ALL"
        ? [...items].sort((a, b) => {
            const aAcc = a.kind === "ACCESSORY" ? 1 : 0;
            const bAcc = b.kind === "ACCESSORY" ? 1 : 0;
            if (aAcc !== bAcc) return aAcc - bAcc;
            return 0;
          })
        : items;

    res.json({ data: sorted.map(mapStockItem) });
  } catch (error) {
    next(error);
  }
});

/** Distinct accessory names for typeahead suggestions. */
stockRouter.get("/accessory-names", async (_req, res, next) => {
  try {
    const rows = await prisma.stockItem.findMany({
      where: { kind: "ACCESSORY" },
      select: { mobileName: true },
      distinct: ["mobileName"],
      orderBy: { mobileName: "asc" },
      take: 200,
    });
    res.json({
      data: rows
        .map((row) => row.mobileName.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    });
  } catch (error) {
    next(error);
  }
});

const createAccessoriesSchema = z
  .object({
    name: z.string().trim().min(2, "Accessory name is required").max(100),
    purchasePrice: z.coerce
      .number({ invalid_type_error: "Purchase price is required" })
      .min(0, "Purchase price cannot be negative"),
    serials: z
      .array(z.string().trim().min(1, "Serial number is required").max(40))
      .min(1, "Add at least one serial number")
      .max(50),
    supplierId: z.string().trim().optional().nullable(),
    supplierName: z.string().trim().min(2).max(100).optional().nullable(),
    supplierPhone: z.string().trim().max(15).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (!data.supplierId?.trim() && !data.supplierName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select or enter a supplier",
        path: ["supplierId"],
      });
    }
  });

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

stockRouter.post("/accessories", async (req, res, next) => {
  try {
    const parsed = createAccessoriesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const name = parsed.data.name.trim();
    const purchasePrice = parsed.data.purchasePrice;
    const serials = parsed.data.serials.map((s) => cleanId(s));

    if (serials.some((s) => s.length < 3)) {
      res.status(400).json({ error: "Each serial number must be at least 3 characters" });
      return;
    }

    const unique = new Set(serials.map((s) => s.toLowerCase()));
    if (unique.size !== serials.length) {
      res.status(400).json({ error: "Duplicate serial numbers in this entry" });
      return;
    }

    for (const serial of serials) {
      const existing = await prisma.stockItem.findUnique({
        where: { serialNumber: serial },
        select: { id: true },
      });
      if (existing) {
        res.status(409).json({ error: `Serial ${serial} is already in stock` });
        return;
      }
    }

    let supplier = parsed.data.supplierId
      ? await prisma.supplier.findUnique({
          where: { id: parsed.data.supplierId },
        })
      : null;

    if (!supplier && parsed.data.supplierName?.trim()) {
      const phoneDigits =
        parsed.data.supplierPhone?.replace(/\D/g, "") || null;
      supplier = await upsertSupplierByName(prisma, parsed.data.supplierName, {
        phone: phoneDigits,
      });
    }

    if (!supplier) {
      res.status(400).json({ error: "Select or enter a supplier" });
      return;
    }

    const purchaseDate = new Date();
    const totalAmount = round2(purchasePrice * serials.length);

    const created = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          supplierId: supplier!.id,
          purchaseDate,
          note: "ACCESSORIES",
          condition: "NEW",
          totalAmount,
          createdByUserId: req.user?.id || null,
          createdByName: req.user?.name || null,
        },
      });

      const items = [];
      for (const serialNumber of serials) {
        const item = await tx.stockItem.create({
          data: {
            kind: "ACCESSORY",
            condition: "NEW",
            platform: "ACCESSORY",
            mobileName: name,
            storage: "",
            ram: "",
            color: "",
            imei: null,
            serialNumber,
            purchasePrice,
            suppliers: serializeSuppliers([supplier!.name]),
            supplierId: supplier!.id,
            status: "AVAILABLE",
            createdAt: purchaseDate,
            createdByUserId: req.user?.id || null,
            createdByName: req.user?.name || null,
          },
          include: {
            supplier: { select: { id: true, name: true, isExchange: true } },
            purchaseItem: {
              select: { purchase: { select: { note: true } } },
            },
          },
        });
        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            stockItemId: item.id,
          },
        });
        items.push(item);
      }
      return items;
    });

    res.status(201).json({ data: created.map(mapStockItem) });
  } catch (error) {
    next(error);
  }
});

/** Look up one AVAILABLE stock unit by IMEI or serial (create-bill autofill). */
stockRouter.get("/lookup", async (req, res, next) => {
  try {
    const imeiRaw =
      typeof req.query.imei === "string" ? req.query.imei.trim() : "";
    const serialRaw =
      typeof req.query.serial === "string" ? req.query.serial.trim() : "";
    const imei = imeiRaw.replace(/\D/g, "");
    const serial = cleanId(serialRaw);

    if (!imei && !serial) {
      res.status(400).json({ error: "IMEI or serial number is required" });
      return;
    }
    if (imei && imei.length < 8 && !serial) {
      res.status(400).json({ error: "IMEI is required" });
      return;
    }
    if (serial && serial.length < 3 && !imei) {
      res.status(400).json({ error: "Serial number is required" });
      return;
    }

    const item = await prisma.stockItem.findFirst({
      where: {
        status: "AVAILABLE",
        OR: [
          ...(imei.length >= 8 ? [{ imei }] : []),
          ...(serial.length >= 3 ? [{ serialNumber: serial }] : []),
        ],
      },
      include: {
        supplier: { select: { id: true, name: true, isExchange: true } },
        purchaseItem: { select: { purchase: { select: { note: true } } } },
      },
    });

    if (!item) {
      res.status(404).json({
        error: serial && !imei ? "No accessory found" : "No mobile found",
      });
      return;
    }

    res.json({ data: mapStockItem(item) });
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
    const imei = cleanId(data.imei) || null;
    const serialNumber = cleanId(data.serialNumber) || null;

    if (imei) {
      const existingImei = await prisma.stockItem.findUnique({ where: { imei } });
      if (existingImei) {
        res.status(409).json({ error: `IMEI ${imei} is already in stock` });
        return;
      }
    }
    if (serialNumber) {
      const existingSerial = await prisma.stockItem.findUnique({
        where: { serialNumber },
      });
      if (existingSerial) {
        res
          .status(409)
          .json({ error: `Serial ${serialNumber} is already in stock` });
        return;
      }
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
          createdByUserId: req.user?.id || null,
          createdByName: req.user?.name || null,
        },
      });

      const item = await tx.stockItem.create({
        data: {
          kind: "MOBILE",
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
            serialNumber,
            purchasePrice: data.purchasePrice,
          suppliers: serializeSuppliers([supplier!.name]),
          supplierId: supplier!.id,
          status: "AVAILABLE",
          createdByUserId: req.user?.id || null,
          createdByName: req.user?.name || null,
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

const updateStockSchema = z
  .object({
    mobileName: z.string().trim().min(2, "Mobile name is required").max(100),
    platform: z.enum(["IOS", "ANDROID"]),
    storage: z.string().trim().min(1, "Storage is required").max(30),
    ram: z.string().trim().max(30).optional().default(""),
    color: z.string().trim().min(1, "Color is required").max(40),
    purchasePrice: z.coerce
      .number({ invalid_type_error: "Purchase price is required" })
      .positive("Purchase price must be greater than 0"),
    imei: z.string().trim().max(20).optional().default(""),
    serialNumber: z.string().trim().max(40).optional().default(""),
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
        message: "RAM is required for Android",
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
    const imei = cleanId(data.imei);
    const serial = cleanId(data.serialNumber);
    if (!imei && !serial) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter IMEI or serial number",
        path: ["imei"],
      });
    }
    if (imei && imei.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "IMEI must be at least 8 characters",
        path: ["imei"],
      });
    }
    if (serial && serial.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Serial number looks too short",
        path: ["serialNumber"],
      });
    }
  });

stockRouter.patch("/:id", requireAdmin, async (req, res, next) => {
  try {
    const existing = await prisma.stockItem.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseItem: {
          select: {
            purchaseId: true,
            purchase: { select: { id: true, supplierId: true } },
          },
        },
      },
    });

    if (!existing) {
      res.status(404).json({ error: "Stock item not found" });
      return;
    }

    const parsed = updateStockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const data = parsed.data;
    const imei = cleanId(data.imei) || null;
    const serialNumber = cleanId(data.serialNumber) || null;

    if (imei) {
      const clash = await prisma.stockItem.findFirst({
        where: { imei, NOT: { id: existing.id } },
        select: { id: true },
      });
      if (clash) {
        res.status(409).json({ error: `IMEI ${imei} is already in stock` });
        return;
      }
    }
    if (serialNumber) {
      const clash = await prisma.stockItem.findFirst({
        where: { serialNumber, NOT: { id: existing.id } },
        select: { id: true },
      });
      if (clash) {
        res
          .status(409)
          .json({ error: `Serial ${serialNumber} is already in stock` });
        return;
      }
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

    const mobileName = data.mobileName.trim();
    const purchasePrice = data.purchasePrice;
    const platform = data.platform;
    const storage = normalizeCapacity(data.storage);
    const ram =
      platform === "ANDROID" ? normalizeCapacity(data.ram || "") : "";
    const color = data.color.trim();

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.update({
        where: { id: existing.id },
        data: {
          mobileName,
          platform,
          storage,
          ram,
          color,
          purchasePrice,
          imei,
          serialNumber,
          suppliers: serializeSuppliers([supplier!.name]),
          supplierId: supplier!.id,
        },
        include: {
          supplier: { select: { id: true, name: true, isExchange: true } },
          purchaseItem: {
            select: { purchase: { select: { note: true } } },
          },
        },
      });

      const purchaseId = existing.purchaseItem?.purchaseId;
      if (purchaseId) {
        const siblings = await tx.purchaseItem.findMany({
          where: { purchaseId },
          include: { stockItem: { select: { id: true, purchasePrice: true } } },
        });
        const totalAmount = siblings.reduce((sum, row) => {
          const price =
            row.stockItemId === existing.id
              ? purchasePrice
              : row.stockItem.purchasePrice;
          return sum + price;
        }, 0);

        await tx.purchase.update({
          where: { id: purchaseId },
          data: {
            supplierId: supplier!.id,
            totalAmount,
          },
        });
      }

      // Keep sold bills in sync when identity fields change.
      await tx.billItem.updateMany({
        where: { stockItemId: existing.id },
        data: {
          productName: mobileName,
          platform,
          storage,
          ram,
          color,
          imei1: imei,
          serialNumber,
        },
      });

      return item;
    });

    res.json({ data: mapStockItem(result) });
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
