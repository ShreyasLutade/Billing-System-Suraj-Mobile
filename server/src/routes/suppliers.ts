import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { upsertSupplierByName } from "../services/suppliers";
import { buildSupplierMobilesWorkbook } from "../services/supplierStockExport";
import { buildSupplierMobilesPdf } from "../services/supplierStockPdf";
import type { SupplierMobileExportCondition } from "../services/supplierStockExport";
import { intakeKindFromNote } from "../services/stockSync";
import { buildSupplierStatement, supplierStatementData } from "../services/supplierStatement";
import {
  applyPendingReturnCredits,
  settlePendingReturnCredits,
} from "../services/productReturns";
import { binSupplier } from "../services/recycleBin";
import { format } from "date-fns";

export const suppliersRouter = Router();

function parseExportCondition(raw: unknown): SupplierMobileExportCondition | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  if (value === "NEW" || value === "USED") return value;
  return null;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function supplierLedgerStats(supplierId: string) {
  const [purchases, stockAvailable, stockSold, stockPurchased, returns] =
    await Promise.all([
      prisma.purchase.findMany({
        where: { supplierId },
        select: {
          totalAmount: true,
          paidAt: true,
          paidAmount: true,
          note: true,
        },
      }),
      prisma.stockItem.count({
        where: { supplierId, status: "AVAILABLE" },
      }),
      prisma.stockItem.count({
        where: { supplierId, status: "SOLD" },
      }),
      prisma.stockItem.count({
        where: { supplierId },
      }),
      prisma.productReturn.findMany({
        where: { supplierId },
        select: { amount: true, creditApplied: true },
      }),
    ]);

  let totalPurchased = 0;
  let totalPaid = 0;
  for (const purchase of purchases) {
    const amount = purchase.totalAmount || 0;
    totalPurchased += amount;
    totalPaid += purchase.paidAt
      ? amount
      : Math.min(purchase.paidAmount || 0, amount);
  }

  // Returned units are credited to purchases like payments (creditApplied);
  // keep "paid" to real money and show returns on their own.
  const totalReturned = round2(returns.reduce((s, r) => s + r.amount, 0));
  const creditApplied = round2(returns.reduce((s, r) => s + r.creditApplied, 0));
  const creditUnapplied = round2(Math.max(totalReturned - creditApplied, 0));
  const owedOnPurchases = round2(Math.max(totalPurchased - totalPaid, 0));

  totalPurchased = round2(totalPurchased);
  return {
    purchaseCount: purchases.length,
    totalPurchased,
    totalPaid: round2(Math.max(totalPaid - creditApplied, 0)),
    totalReturned,
    /** Return credit not yet used against a purchase (supplier owes us). */
    supplierCredit: round2(Math.max(creditUnapplied - owedOnPurchases, 0)),
    // Negative when the supplier owes us (return credit bigger than what we
    // owe); it is used up automatically against the next stock we add.
    outstanding: round2(owedOnPurchases - creditUnapplied),
    stockAvailable,
    stockSold,
    stockPurchased,
    hasExchangeIntake: purchases.some(
      (purchase) => intakeKindFromNote(purchase.note) === "exchange",
    ),
    hasReturnIntake: purchases.some(
      (purchase) => intakeKindFromNote(purchase.note) === "return",
    ),
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

suppliersRouter.get("/", async (_req, res, next) => {
  try {
    await settlePendingReturnCredits();
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

/**
 * Every mobile ever purchased (in stock or sold) with its supplier and purchase
 * date, for the Suppliers page model search ("iPhone 14" → who sold us each one).
 * Purchase price is admin only.
 */
suppliersRouter.get("/mobiles", async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === "ADMIN";
    const items = await prisma.stockItem.findMany({
      where: { NOT: { kind: "ACCESSORY" } },
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseItem: {
          select: {
            purchase: {
              select: {
                id: true,
                supplierId: true,
                purchaseDate: true,
                supplier: { select: { id: true, name: true } },
              },
            },
          },
        },
        productReturn: { select: { createdAt: true } },
        billItems: {
          select: { bill: { select: { id: true, invoiceNumber: true } } },
          orderBy: { bill: { billDate: "desc" } },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const data = items.map((item) => {
      const purchase = item.purchaseItem?.purchase || null;
      const supplier = item.supplier || purchase?.supplier || null;
      const bill = item.billItems[0]?.bill || null;
      return {
        id: item.id,
        mobileName: item.mobileName,
        platform: item.platform,
        condition: item.condition,
        storage: item.storage,
        ram: item.ram,
        color: item.color,
        // Archived units keep "IMEI~id" so the live unit can reuse the IMEI.
        imei: item.imei ? item.imei.split("~")[0] : null,
        serialNumber: item.serialNumber,
        status: item.status,
        purchasePrice: isAdmin ? item.purchasePrice : null,
        purchaseDate: (purchase?.purchaseDate || item.createdAt).toISOString(),
        supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
        sale: bill ? { billId: bill.id, invoiceNumber: bill.invoiceNumber } : null,
        returned: Boolean(item.productReturn),
        // Opens /suppliers/:supplierId/purchases/:id with this unit highlighted.
        purchase: purchase
          ? { id: purchase.id, supplierId: purchase.supplierId }
          : null,
      };
    });

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

/**
 * Admin Excel export of mobiles for a supplier (by name contains).
 * Example: GET /api/suppliers/export-mobiles?name=Tally&condition=NEW
 */
suppliersRouter.get("/export-mobiles", requireAdmin, async (req, res, next) => {
  try {
    const name =
      typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (name.length < 1) {
      res.status(400).json({ error: "Pass ?name=SupplierName" });
      return;
    }
    const condition = parseExportCondition(req.query.condition);
    if (!condition) {
      res.status(400).json({ error: "Pass ?condition=NEW or ?condition=USED" });
      return;
    }

    const suppliers = await prisma.supplier.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const needle = name.toLowerCase();
    const matched = suppliers.filter((s) =>
      s.name.trim().toLowerCase().includes(needle),
    );
    if (!matched.length) {
      res.status(404).json({
        error: `No supplier matching '${name}'`,
        suppliers: suppliers.map((s) => s.name),
      });
      return;
    }

    // Prefer exact match, otherwise first contains match.
    const exact = matched.find(
      (s) => s.name.trim().toLowerCase() === needle,
    );
    const target = exact || matched[0];
    const exportFile = await buildSupplierMobilesWorkbook(
      prisma,
      target.id,
      condition,
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportFile.filename}"`,
    );
    res.setHeader("X-Unit-Count", String(exportFile.unitCount));
    res.setHeader("X-Sold-Count", String(exportFile.soldCount));
    res.send(exportFile.buffer);
  } catch (error) {
    next(error);
  }
});

/** Admin PDF of a supplier's new / old mobiles (Export new / Export old). */
suppliersRouter.get(
  "/:id/mobiles-export",
  requireAdmin,
  async (req, res, next) => {
    try {
      const condition = parseExportCondition(req.query.condition);
      if (!condition) {
        res
          .status(400)
          .json({ error: "Pass ?condition=NEW or ?condition=USED" });
        return;
      }
      const exportFile = await buildSupplierMobilesPdf(req.params.id, condition);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${exportFile.filename}"`,
      );
      res.setHeader("X-Unit-Count", String(exportFile.unitCount));
      res.setHeader("X-Sold-Count", String(exportFile.soldCount));
      res.send(exportFile.pdf);
    } catch (error) {
      if (error instanceof Error && error.message === "SUPPLIER_NOT_FOUND") {
        res.status(404).json({ error: "Supplier not found" });
        return;
      }
      next(error);
    }
  },
);

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
    await settlePendingReturnCredits(req.params.id);
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
                    serialNumber: true,
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

/**
 * Admin only: remove a supplier with its purchases, payments and unsold
 * phones. Refused while any of its phones is on a bill, same rule as
 * deleting a single stock unit.
 */
suppliersRouter.delete("/:id", requireAdmin, async (req, res, next) => {
  try {
    const existing = await prisma.supplier.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }

    const stockWhere = {
      OR: [
        { supplierId: existing.id },
        { purchaseItem: { purchase: { supplierId: existing.id } } },
      ],
    };
    const soldCount = await prisma.stockItem.count({
      where: {
        AND: [
          stockWhere,
          { OR: [{ status: "SOLD" }, { billItems: { some: {} } }] },
        ],
      },
    });
    if (soldCount > 0) {
      res.status(400).json({
        error: `${soldCount} phone${soldCount === 1 ? " from this supplier is" : "s from this supplier are"} on a bill. Remove ${soldCount === 1 ? "it" : "them"} from the bill first.`,
      });
      return;
    }

    const removed = await prisma.$transaction(async (tx) => {
      const stockIds = await tx.stockItem.findMany({
        where: stockWhere,
        select: { id: true },
      });
      await binSupplier(
        tx,
        existing.id,
        stockIds.map((s) => s.id),
        req.user,
      );
      // Purchase items cascade with their stock; payments cascade with the supplier.
      const stock = await tx.stockItem.deleteMany({ where: stockWhere });
      const purchases = await tx.purchase.deleteMany({
        where: { supplierId: existing.id },
      });
      await tx.supplier.delete({ where: { id: existing.id } });
      return { stock: stock.count, purchases: purchases.count };
    });

    res.json({ data: { id: existing.id, ...removed } });
  } catch (error) {
    next(error);
  }
});

const paySupplierSchema = z.object({
  /** Omit to clear everything outstanding; otherwise a part payment. */
  amount: z.number().positive().finite().optional(),
  /** How it was paid; older app versions send nothing ("na"). */
  method: z.enum(["cash", "online"]).optional(),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, "Enter a valid payment date")
    .optional(),
});

/**
 * Admin only: pay a supplier against their outstanding. The amount is applied
 * to unpaid purchases oldest first (same fields as a per-purchase mark-paid),
 * and can never be more than what is outstanding.
 */
/** Admin only: the same statement as data, for the in-app statement page. */
suppliersRouter.get("/:id/statement/view", requireAdmin, async (req, res, next) => {
  try {
    const data = await supplierStatementData(req.params.id);
    if (!data) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    const { entries: _entries, ...rest } = data;
    res.json({
      data: {
        ...rest,
        generatedAt: new Date().toISOString(),
        rows: rest.rows.map((r) => ({ ...r, date: r.date.toISOString() })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Admin only: supplier statement PDF (purchases as credit, payments as debit). */
suppliersRouter.get("/:id/statement", requireAdmin, async (req, res, next) => {
  try {
    await settlePendingReturnCredits(req.params.id);
    const statement = await buildSupplierStatement(req.params.id);
    if (!statement) {
      res.status(404).json({ error: "Supplier not found" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${statement.filename}"`,
    );
    res.send(statement.pdf);
  } catch (error) {
    next(error);
  }
});

suppliersRouter.post("/:id/pay", requireAdmin, async (req, res, next) => {
  try {
    const parsed = paySupplierSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid amount" });
      return;
    }
    // Work in paise so rounding can't leave ₹0.01 behind or overpay.
    const requestedPaise =
      parsed.data.amount === undefined
        ? null
        : Math.round(parsed.data.amount * 100);
    if (requestedPaise !== null && requestedPaise <= 0) {
      res.status(400).json({ error: "Enter an amount above ₹0" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!supplier) return { status: 404, error: "Supplier not found" } as const;
      await applyPendingReturnCredits(tx, supplier.id);

      const unpaid = await tx.purchase.findMany({
        where: { supplierId: supplier.id, paidAt: null },
        select: { id: true, totalAmount: true, paidAmount: true, purchaseDate: true },
        orderBy: [{ purchaseDate: "asc" }, { createdAt: "asc" }],
      });
      const open = unpaid
        .map((p) => {
          const totalPaise = Math.round((p.totalAmount || 0) * 100);
          const paidPaise = Math.min(
            Math.round((p.paidAmount || 0) * 100),
            totalPaise,
          );
          return { ...p, totalPaise, leftPaise: totalPaise - paidPaise, paidPaise };
        })
        .filter((p) => p.leftPaise > 0);
      const outstandingPaise = open.reduce((sum, p) => sum + p.leftPaise, 0);

      if (outstandingPaise <= 0) {
        return { status: 400, error: "Nothing is outstanding for this supplier" } as const;
      }
      if (requestedPaise !== null && requestedPaise > outstandingPaise) {
        return {
          status: 400,
          error: `Amount is more than the ₹${(outstandingPaise / 100).toLocaleString("en-IN", {
            minimumFractionDigits: outstandingPaise % 100 ? 2 : 0,
            maximumFractionDigits: 2,
          })} outstanding`,
        } as const;
      }

      let leftToApply = requestedPaise ?? outstandingPaise;
      let purchasesCleared = 0;
      const paidAt = parsed.data.paidAt
        ? new Date(`${parsed.data.paidAt}T12:00:00.000Z`)
        : new Date();
      const againstDates: string[] = [];
      for (const p of open) {
        if (leftToApply <= 0) break;
        const apply = Math.min(leftToApply, p.leftPaise);
        leftToApply -= apply;
        const newPaidPaise = p.paidPaise + apply;
        const fullyPaid = newPaidPaise >= p.totalPaise;
        if (fullyPaid) purchasesCleared += 1;
        againstDates.push(format(p.purchaseDate, "dd MMM yyyy"));
        await tx.purchase.update({
          where: { id: p.id },
          data: fullyPaid
            ? { paidAt, paidAmount: p.totalAmount }
            : { paidAmount: newPaidPaise / 100 },
        });
      }

      const paidPaise = (requestedPaise ?? outstandingPaise) - leftToApply;
      // Dated record of this payment, for the supplier statement.
      await tx.supplierPayment.create({
        data: {
          supplierId: supplier.id,
          amount: paidPaise / 100,
          method: parsed.data.method ?? "na",
          paidAt,
          note: `Against purchase${againstDates.length === 1 ? "" : "s"} of ${[...new Set(againstDates)].join(", ")}`,
        },
      });
      return {
        status: 200,
        paid: paidPaise / 100,
        purchasesCleared,
        outstanding: (outstandingPaise - paidPaise) / 100,
      } as const;
    });

    if (result.status !== 200) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      data: {
        paid: result.paid,
        purchasesCleared: result.purchasesCleared,
        outstanding: result.outstanding,
      },
    });
  } catch (error) {
    next(error);
  }
});
