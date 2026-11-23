import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { normalizeCapacity } from "../lib/capacity";
import { upsertSupplierByName } from "../services/suppliers";
import { upsertPhoneModel } from "../services/phoneModels";
import { requireAdmin } from "../middleware/auth";
import { setPurchaseCondition } from "../services/fixPurchaseCondition";
import { retireStockImei } from "../services/stockSync";
import { format } from "date-fns";
import { applyPendingReturnCredits } from "../services/productReturns";
import {
  paymentAtPurchaseError,
  paymentAtPurchaseSchema,
  recordPaymentAtPurchase,
} from "../services/purchasePayment";

export const purchasesRouter = Router();

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function serializeSuppliers(names: string[]) {
  return JSON.stringify(names.map((n) => n.trim()).filter(Boolean));
}

function cleanId(value: string | undefined | null) {
  return (value || "").replace(/\s+/g, "").trim();
}

const purchaseItemSchema = z
  .object({
    platform: z.enum(["IOS", "ANDROID"]),
    mobileName: z.string().trim().min(2).max(100),
    storage: z.string().trim().min(1).max(30),
    ram: z.string().trim().max(30).optional().default(""),
    color: z.string().trim().min(1).max(50),
    imei: z.string().trim().max(20).optional().default(""),
    serialNumber: z.string().trim().max(40).optional().default(""),
    purchasePrice: z.coerce.number().positive(),
  })
  .superRefine((data, ctx) => {
    if (data.platform === "ANDROID" && !data.ram?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RAM is required for Android mobiles",
        path: ["ram"],
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

const createPurchaseSchema = z.object({
  supplierId: z.string().trim().optional().nullable(),
  supplierName: z.string().trim().min(2).max(100).optional().nullable(),
  supplierPhone: z.string().trim().max(15).optional().nullable(),
  condition: z.enum(["NEW", "USED"]),
  note: z.string().trim().max(500).optional().nullable(),
  purchaseDate: z.string().trim().optional().nullable(),
  items: z.array(purchaseItemSchema).min(1, "Add at least one mobile"),
  /** Paid while entering the purchase (admin only). Omit = unpaid. */
  payment: paymentAtPurchaseSchema.optional().nullable(),
});

purchasesRouter.get("/", async (req, res, next) => {
  try {
    const supplierId =
      typeof req.query.supplierId === "string" ? req.query.supplierId : undefined;

    const purchases = await prisma.purchase.findMany({
      where: supplierId ? { supplierId } : undefined,
      orderBy: { purchaseDate: "desc" },
      include: {
        supplier: { select: { id: true, name: true } },
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
              },
            },
          },
        },
      },
    });

    res.json({ data: purchases });
  } catch (error) {
    next(error);
  }
});

const stockItemSelect = {
  id: true,
  mobileName: true,
  storage: true,
  ram: true,
  color: true,
  imei: true,
  serialNumber: true,
  purchasePrice: true,
  status: true,
  platform: true,
  condition: true,
} as const;

purchasesRouter.get("/:id", async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === "ADMIN";
    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            stockItem: {
              select: {
                ...stockItemSelect,
                productReturn: {
                  select: { createdAt: true, note: true, invoiceNumber: true, billId: true },
                },
                replacementFor: {
                  select: { invoiceNumber: true, billId: true, customerName: true },
                },
                billItems: {
                  orderBy: { bill: { billDate: "desc" } },
                  take: 1,
                  select: {
                    billId: true,
                    amount: true,
                    rate: true,
                    bill: {
                      select: {
                        id: true,
                        invoiceNumber: true,
                        customerName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!purchase) {
      res.status(404).json({ error: "Purchase not found" });
      return;
    }

    res.json({
      data: {
        ...purchase,
        items: purchase.items.map((item) => {
          const saleLine = item.stockItem.billItems[0];
          const sale = saleLine?.bill;
          const {
            billItems: _billItems,
            productReturn,
            replacementFor,
            ...stockItem
          } = item.stockItem;
          return {
            ...item,
            stockItem: {
              ...stockItem,
              // Given to a customer as a replacement (no bill line of its own).
              soldBillId: sale?.id ?? replacementFor?.billId ?? null,
              soldInvoiceNumber: sale?.invoiceNumber ?? replacementFor?.invoiceNumber ?? null,
              soldCustomerName: sale?.customerName ?? replacementFor?.customerName ?? null,
              givenAsReplacement: Boolean(replacementFor),
              // Sent back to the supplier (customer got a replacement / refund).
              returned: productReturn
                ? {
                    createdAt: productReturn.createdAt.toISOString(),
                    note: productReturn.note,
                    invoiceNumber: productReturn.invoiceNumber,
                    billId: productReturn.billId,
                  }
                : null,
              // Selling price only for admins (staff never receive it).
              soldPrice: isAdmin
                ? saleLine != null
                  ? round2(saleLine.amount ?? saleLine.rate ?? 0)
                  : null
                : undefined,
            },
          };
        }),
      },
    });
  } catch (error) {
    next(error);
  }
});

purchasesRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createPurchaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const data = parsed.data;
    if (
      data.payment &&
      data.payment.mode !== "UNPAID" &&
      req.user?.role !== "ADMIN"
    ) {
      res.status(403).json({ error: "Only an admin can record a payment" });
      return;
    }
    const units = data.items.map((item) => ({
      imei: cleanId(item.imei) || null,
      serialNumber: cleanId(item.serialNumber) || null,
    }));
    const imeis = units.map((u) => u.imei).filter((v): v is string => Boolean(v));
    const serials = units
      .map((u) => u.serialNumber)
      .filter((v): v is string => Boolean(v));

    if (new Set(imeis).size !== imeis.length) {
      res.status(400).json({ error: "Duplicate IMEI numbers in this purchase" });
      return;
    }
    if (new Set(serials).size !== serials.length) {
      res
        .status(400)
        .json({ error: "Duplicate serial numbers in this purchase" });
      return;
    }

    // Only IMEIs/serials still in stock block a new purchase. A sold phone can be
    // bought back: its old row keeps its history under a retired IMEI (same
    // as a re-exchange in stockSync).
    const soldImeiOwners: Array<{ id: string; imei: string }> = [];
    if (imeis.length) {
      const existingImei = await prisma.stockItem.findMany({
        where: { imei: { in: imeis } },
        select: { id: true, imei: true, status: true },
      });
      const inStock = existingImei.filter((e) => e.status === "AVAILABLE");
      if (inStock.length) {
        res.status(409).json({
          error: `IMEI already in stock: ${inStock.map((e) => e.imei).join(", ")}`,
        });
        return;
      }
      for (const e of existingImei) {
        if (e.imei) soldImeiOwners.push({ id: e.id, imei: e.imei });
      }
    }
    const soldSerialOwners: Array<{ id: string; serialNumber: string }> = [];
    if (serials.length) {
      const existingSerial = await prisma.stockItem.findMany({
        where: { serialNumber: { in: serials } },
        select: { id: true, serialNumber: true, status: true },
      });
      for (const e of existingSerial) {
        if (e.status !== "AVAILABLE" && e.serialNumber) {
          soldSerialOwners.push({ id: e.id, serialNumber: e.serialNumber });
        }
      }
      const inStockSerials = existingSerial.filter(
        (e) => e.status === "AVAILABLE",
      );
      if (inStockSerials.length) {
        res.status(409).json({
          error: `Serial already in stock: ${inStockSerials
            .map((e) => e.serialNumber)
            .join(", ")}`,
        });
        return;
      }
    }

    let supplier =
      data.supplierId
        ? await prisma.supplier.findUnique({ where: { id: data.supplierId } })
        : null;

    if (!supplier && data.supplierName?.trim()) {
      const phoneDigits = data.supplierPhone?.replace(/\D/g, "") || null;
      supplier = await upsertSupplierByName(prisma, data.supplierName, {
        phone: phoneDigits,
      });
    }

    if (!supplier) {
      res.status(400).json({ error: "Select or enter a supplier" });
      return;
    }

    let purchaseDate = new Date();
    if (data.purchaseDate && /^\d{4}-\d{2}-\d{2}$/.test(data.purchaseDate)) {
      const [y, m, d] = data.purchaseDate.split("-").map(Number);
      purchaseDate = new Date(y, m - 1, d, 12, 0, 0);
    }

    const totalAmount = round2(
      data.items.reduce((sum, item) => sum + item.purchasePrice, 0),
    );
    const paymentError = paymentAtPurchaseError(data.payment, totalAmount);
    if (paymentError) {
      res.status(400).json({ error: paymentError });
      return;
    }

    const purchase = await prisma.$transaction(async (tx) => {
      for (const owner of soldImeiOwners) {
        await tx.stockItem.update({
          where: { id: owner.id },
          data: { imei: retireStockImei(owner.imei, owner.id) },
        });
      }
      for (const owner of soldSerialOwners) {
        await tx.stockItem.update({
          where: { id: owner.id },
          data: { serialNumber: retireStockImei(owner.serialNumber, owner.id) },
        });
      }

      const created = await tx.purchase.create({
        data: {
          supplierId: supplier!.id,
          purchaseDate,
          note: data.note || null,
          condition: data.condition,
          totalAmount,
          createdByUserId: req.user?.id || null,
          createdByName: req.user?.name || null,
        },
      });

      const stockItems = [];
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        const ids = units[i];
        const stock = await tx.stockItem.create({
          data: {
            kind: "MOBILE",
            condition: data.condition,
            platform: item.platform,
            mobileName: item.mobileName.trim(),
            storage: normalizeCapacity(item.storage),
            ram:
              item.platform === "ANDROID"
                ? normalizeCapacity(item.ram)
                : "",
            color: item.color.trim(),
            imei: ids.imei,
            serialNumber: ids.serialNumber,
            purchasePrice: item.purchasePrice,
            suppliers: serializeSuppliers([supplier!.name]),
            supplierId: supplier!.id,
            status: "AVAILABLE",
            createdAt: purchaseDate,
            createdByUserId: req.user?.id || null,
            createdByName: req.user?.name || null,
          },
        });
        await tx.purchaseItem.create({
          data: {
            purchaseId: created.id,
            stockItemId: stock.id,
          },
        });
        stockItems.push(stock);
      }

      await recordPaymentAtPurchase(tx, created, data.payment);
      // Supplier credit from returned products clears what's left unpaid.
      await applyPendingReturnCredits(tx, created.supplierId);

      return tx.purchase.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          supplier: true,
          items: { include: { stockItem: true } },
        },
      });
    });

    // Remember model variants (no color) for future stock search.
    for (const item of data.items) {
      try {
        await upsertPhoneModel(prisma, {
          platform: item.platform,
          name: item.mobileName,
          storage: item.storage,
          ram: item.ram,
        });
      } catch (error) {
        console.warn("[phone-models] Upsert after purchase failed:", error);
      }
    }

    res.status(201).json({ data: purchase });
  } catch (error) {
    next(error);
  }
});

purchasesRouter.patch("/:id/condition", requireAdmin, async (req, res, next) => {
  try {
    const parsed = z
      .object({ condition: z.enum(["NEW", "USED"]) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Pass condition NEW or USED",
        details: parsed.error.flatten(),
      });
      return;
    }

    const result = await setPurchaseCondition(
      prisma,
      req.params.id,
      parsed.data.condition,
    );
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }

    const purchase = await prisma.purchase.findUnique({
      where: { id: result.purchaseId },
      include: {
        supplier: true,
        items: { include: { stockItem: true } },
      },
    });

    res.json({
      data: purchase,
      meta: {
        previousCondition: result.previousCondition,
        condition: result.condition,
        stockCount: result.stockCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

const markPaidSchema = z.object({
  /** Omit to mark the whole purchase paid; otherwise a part payment. */
  amount: z.number().positive().optional(),
});

purchasesRouter.post("/:id/mark-paid", requireAdmin, async (req, res, next) => {
  try {
    const parsed = markPaidSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid amount" });
      return;
    }

    const purchase = await prisma.purchase.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        items: { include: { stockItem: true } },
      },
    });
    if (!purchase) {
      res.status(404).json({ error: "Purchase not found" });
      return;
    }
    if (purchase.paidAt) {
      res.status(400).json({ error: "This purchase is already marked paid" });
      return;
    }

    const total = purchase.totalAmount || 0;
    const alreadyPaid = Math.min(purchase.paidAmount || 0, total);
    const remaining = Math.round((total - alreadyPaid) * 100) / 100;
    const amount = parsed.data.amount ?? remaining;
    if (amount > remaining + 0.005) {
      res.status(400).json({
        error: `Amount is more than the ₹${remaining.toLocaleString("en-IN")} left to pay`,
      });
      return;
    }
    const newPaid = Math.round((alreadyPaid + amount) * 100) / 100;
    const fullyPaid = newPaid >= total - 0.005;

    const paidNow = Math.round((newPaid - alreadyPaid) * 100) / 100;
    const updated = await prisma.$transaction(async (tx) => {
      if (paidNow > 0) {
        // Dated record of this payment, for the supplier statement.
        await tx.supplierPayment.create({
          data: {
            supplierId: purchase.supplierId,
            amount: paidNow,
            method: "na",
            note: `Against purchase of ${format(purchase.purchaseDate, "dd MMM yyyy")}`,
          },
        });
      }
      return tx.purchase.update({
        where: { id: purchase.id },
        data: fullyPaid
          ? { paidAt: new Date(), paidAmount: total }
          : { paidAmount: newPaid },
        include: {
          supplier: true,
          items: { include: { stockItem: true } },
        },
      });
    });

    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});
