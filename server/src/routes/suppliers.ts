import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { upsertSupplierByName } from "../services/suppliers";

export const suppliersRouter = Router();

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function supplierLedgerStats(supplierId: string) {
  const [purchases, stockAvailable, stockSold] = await Promise.all([
    prisma.purchase.findMany({
      where: { supplierId },
      select: { totalAmount: true, paidAt: true },
    }),
    prisma.stockItem.count({
      where: { supplierId, status: "AVAILABLE" },
    }),
    prisma.stockItem.count({
      where: { supplierId, status: "SOLD" },
    }),
  ]);

  let totalPurchased = 0;
  let totalPaid = 0;
  for (const purchase of purchases) {
    const amount = purchase.totalAmount || 0;
    totalPurchased += amount;
    if (purchase.paidAt) totalPaid += amount;
  }

  totalPurchased = round2(totalPurchased);
  totalPaid = round2(totalPaid);
  return {
    purchaseCount: purchases.length,
    totalPurchased,
    totalPaid,
    outstanding: round2(Math.max(totalPurchased - totalPaid, 0)),
    stockAvailable,
    stockSold,
  };
}

const createSupplierSchema = z.object({
  name: z.string().trim().min(2, "Supplier name is required").max(100),
  phone: z.string().trim().max(15).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const updateSupplierSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(15).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Payment amount must be greater than 0"),
  method: z.enum(["cash", "online", "na"]).default("cash"),
  paidAt: z.string().trim().optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

suppliersRouter.get("/", async (_req, res, next) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });
    const data = await Promise.all(
      suppliers.map(async (supplier) => ({
        ...supplier,
        ...(await supplierLedgerStats(supplier.id)),
      })),
    );
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

suppliersRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const supplier = await upsertSupplierByName(prisma, parsed.data.name, {
      phone: parsed.data.phone,
      address: parsed.data.address,
      notes: parsed.data.notes,
    });

    res.status(201).json({
      data: { ...supplier, ...(await supplierLedgerStats(supplier.id)) },
    });
  } catch (error) {
    next(error);
  }
});

suppliersRouter.get("/:id", async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        purchases: {
          orderBy: { purchaseDate: "desc" },
          include: {
            items: {
              include: {
                stockItem: {
                  select: {
                    id: true,
                    mobileName: true,
                    imei: true,
                    purchasePrice: true,
                    status: true,
                    color: true,
                    storage: true,
                    ram: true,
                    platform: true,
                    condition: true,
                  },
                },
              },
            },
          },
        },
        payments: { orderBy: { paidAt: "desc" } },
        stockItems: {
          where: { status: "AVAILABLE" },
          orderBy: { createdAt: "desc" },
          take: 200,
        },
      },
    });

    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    const stats = await supplierLedgerStats(supplier.id);
    res.json({
      data: {
        ...supplier,
        ...stats,
        stockItems: supplier.stockItems.map((item) => ({
          ...item,
          suppliers: item.supplierId
            ? [supplier.name]
            : [],
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

suppliersRouter.patch("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.supplier.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    const parsed = updateSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    if (parsed.data.name) {
      const clash = await prisma.supplier.findFirst({
        where: {
          name: { equals: parsed.data.name.trim().replace(/\s+/g, " ") },
          NOT: { id: existing.id },
        },
      });
      if (clash) {
        res.status(409).json({ error: "Another supplier already has this name" });
        return;
      }
    }

    const supplier = await prisma.supplier.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name
          ? { name: parsed.data.name.trim().replace(/\s+/g, " ") }
          : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
        ...(parsed.data.address !== undefined
          ? { address: parsed.data.address }
          : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      },
    });

    res.json({
      data: { ...supplier, ...(await supplierLedgerStats(supplier.id)) },
    });
  } catch (error) {
    next(error);
  }
});

suppliersRouter.post("/:id/payments", async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
    });
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const stats = await supplierLedgerStats(supplier.id);
    if (parsed.data.amount > stats.outstanding + 0.009) {
      res.status(400).json({
        error: `Payment exceeds outstanding (${stats.outstanding})`,
      });
      return;
    }

    let paidAt = new Date();
    if (parsed.data.paidAt && /^\d{4}-\d{2}-\d{2}$/.test(parsed.data.paidAt)) {
      const [y, m, d] = parsed.data.paidAt.split("-").map(Number);
      paidAt = new Date(y, m - 1, d, 12, 0, 0);
    }

    const payment = await prisma.supplierPayment.create({
      data: {
        supplierId: supplier.id,
        amount: round2(parsed.data.amount),
        method: parsed.data.method,
        paidAt,
        note: parsed.data.note || null,
      },
    });

    res.status(201).json({
      data: payment,
      ledger: await supplierLedgerStats(supplier.id),
    });
  } catch (error) {
    next(error);
  }
});
