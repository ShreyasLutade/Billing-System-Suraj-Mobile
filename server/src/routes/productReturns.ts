import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import {
  applyCreditToPurchases,
  applyPendingReturnCredits,
} from "../services/productReturns";

/**
 * Replace / return a sold product: the unit goes back to its supplier, the
 * bill it was sold on is marked "Replaced / Returned", and its purchase price
 * is credited to the supplier (reduces what we owe).
 */
export const productReturnsRouter = Router();

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Price of one bill line (amount, else rate × qty). */
function linePrice(line: { amount: number | null; rate: number; quantity: number }) {
  return round2(line.amount ?? line.rate * (line.quantity || 1));
}

const unitInclude = {
  supplier: { select: { id: true, name: true } },
  purchaseItem: {
    select: {
      purchase: {
        select: {
          id: true,
          purchaseDate: true,
          supplier: { select: { id: true, name: true } },
        },
      },
    },
  },
  billItems: {
    orderBy: { bill: { billDate: "desc" as const } },
    take: 1,
    select: {
      id: true,
      amount: true,
      rate: true,
      quantity: true,
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
  },
  productReturn: true,
  /** Set when the unit was given to a customer as a replacement. */
  replacementFor: { select: { billId: true, billItemId: true, createdAt: true } },
};

type Db = Prisma.TransactionClient | typeof prisma;
type UnitRow = Prisma.StockItemGetPayload<{ include: typeof unitInclude }>;

/** Where a unit was sold: its own bill line, or the bill it replaced a unit on. */
type Sale = {
  billId: string;
  billItemId: string;
  invoiceNumber: string;
  billDate: Date;
  customerName: string;
  customerPhone: string;
  /** What the customer paid for the item (default refund). */
  price: number;
  /** When this unit reached the customer (to pick the latest sale). */
  at: Date;
};

async function saleOf(db: Db, unit: UnitRow): Promise<Sale | null> {
  const line = unit.billItems[0];
  if (line) {
    return {
      billId: line.bill.id,
      billItemId: line.id,
      invoiceNumber: line.bill.invoiceNumber,
      billDate: line.bill.billDate,
      customerName: line.bill.customerName,
      customerPhone: line.bill.customerPhone,
      price: linePrice(line),
      at: line.bill.billDate,
    };
  }
  // Given as a replacement: no bill line of its own; it stands in for the
  // replaced unit's line on that bill.
  const swap = unit.replacementFor;
  if (!swap?.billId) return null;
  const [bill, item] = await Promise.all([
    db.bill.findUnique({
      where: { id: swap.billId },
      select: { id: true, invoiceNumber: true, billDate: true, customerName: true, customerPhone: true },
    }),
    swap.billItemId
      ? db.billItem.findUnique({
          where: { id: swap.billItemId },
          select: { id: true, amount: true, rate: true, quantity: true },
        })
      : null,
  ]);
  if (!bill) return null;
  return {
    billId: bill.id,
    billItemId: item?.id ?? swap.billItemId ?? "",
    invoiceNumber: bill.invoiceNumber,
    billDate: bill.billDate,
    customerName: bill.customerName,
    customerPhone: bill.customerPhone,
    price: item ? linePrice(item) : 0,
    at: swap.createdAt,
  };
}

/**
 * Find the sold unit for an IMEI or serial number. Units sold, taken back
 * and sold again keep an archived "IMEI~id" copy, so pick the latest sale.
 */
async function findSoldUnit(rawCode: string) {
  const code = rawCode.trim();
  const digits = code.replace(/\D/g, "");
  const or: Array<Record<string, unknown>> = [
    { serialNumber: code },
    { serialNumber: code.toUpperCase() },
  ];
  if (digits.length >= 8) {
    or.push({ imei: digits }, { imei: { startsWith: `${digits}~` } });
  }
  const units = await prisma.stockItem.findMany({
    where: { OR: or },
    include: unitInclude,
  });
  const sold: Array<{ unit: UnitRow; sale: Sale }> = [];
  for (const unit of units) {
    const sale = await saleOf(prisma, unit);
    if (sale) sold.push({ unit, sale });
  }
  sold.sort((a, b) => b.sale.at.getTime() - a.sale.at.getTime());
  return {
    found: sold[0] ?? null,
    inStock: units.some((u) => u.status === "AVAILABLE"),
    anyUnit: units.length > 0,
  };
}

function describeUnit(unit: UnitRow, sale: Sale, isAdmin: boolean) {
  const purchase = unit.purchaseItem?.purchase ?? null;
  const supplier = unit.supplier ?? purchase?.supplier ?? null;
  return {
    stockItemId: unit.id,
    mobileName: unit.mobileName,
    storage: unit.storage,
    ram: unit.ram,
    color: unit.color,
    platform: unit.platform,
    condition: unit.condition,
    imei: unit.imei ? unit.imei.split("~")[0] : null,
    serialNumber: unit.serialNumber,
    purchasePrice: isAdmin ? unit.purchasePrice : null,
    purchaseDate: purchase?.purchaseDate.toISOString() ?? null,
    supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
    /** What the customer paid for this item (default refund). */
    soldPrice: sale.price,
    /** True when this unit was itself given as a replacement. */
    givenAsReplacement: !unit.billItems[0] && Boolean(unit.replacementFor),
    bill: {
      id: sale.billId,
      billItemId: sale.billItemId,
      invoiceNumber: sale.invoiceNumber,
      billDate: sale.billDate.toISOString(),
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
    },
    alreadyReturned: unit.productReturn
      ? {
          createdAt: unit.productReturn.createdAt.toISOString(),
          note: unit.productReturn.note,
        }
      : null,
  };
}

/** GET /api/returns/lookup?code=IMEI-or-serial */
productReturnsRouter.get("/lookup", requireAdmin, async (req, res, next) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
    if (code.length < 3) {
      res.status(400).json({ error: "Enter the IMEI or serial number" });
      return;
    }
    const { found, inStock, anyUnit } = await findSoldUnit(code);
    if (!found) {
      res.status(404).json({
        error: inStock
          ? "This product is in stock — it hasn't been sold on a bill"
          : anyUnit
            ? "This product isn't linked to any bill"
            : "No product found with this IMEI / serial number",
      });
      return;
    }
    res.json({ data: describeUnit(found.unit, found.sale, true) });
  } catch (error) {
    next(error);
  }
});

const createSchema = z
  .object({
    stockItemId: z.string().min(1),
    note: z.string().trim().max(500).optional().nullable(),
    /** REPLACE: give another unit from stock. RETURN: refund the customer. */
    kind: z.enum(["REPLACE", "RETURN"]),
    replacementStockItemId: z.string().min(1).optional().nullable(),
    refundAmount: z.number().finite().positive().optional().nullable(),
    refundMethod: z.enum(["cash", "online"]).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "REPLACE" && !data.replacementStockItemId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose the replacement product from stock" });
    }
    if (data.kind === "RETURN" && !data.refundMethod) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose how the refund was given" });
    }
  });

/** POST /api/returns — record the replacement / return. */
productReturnsRouter.post("/", requireAdmin, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || "Choose the product to return",
      });
      return;
    }
    const input = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const unit = await tx.stockItem.findUnique({
        where: { id: parsed.data.stockItemId },
        include: unitInclude,
      });
      if (!unit) return { status: 404, error: "Product not found" } as const;
      if (unit.productReturn) {
        return {
          status: 409,
          error: "This product is already marked replaced / returned",
        } as const;
      }
      // Sold on a bill line, or given to the customer as a replacement.
      const sale = await saleOf(tx, unit);
      if (!sale) {
        return { status: 400, error: "This product hasn't been sold on a bill" } as const;
      }

      // Replace: the new unit must be in stock now; it leaves stock as sold.
      let replacementId: string | null = null;
      if (input.kind === "REPLACE") {
        const replacement = await tx.stockItem.findUnique({
          where: { id: input.replacementStockItemId! },
          select: { id: true, status: true, mobileName: true },
        });
        if (!replacement || replacement.id === unit.id) {
          return { status: 400, error: "Choose a different product from stock" } as const;
        }
        if (replacement.status !== "AVAILABLE") {
          return {
            status: 409,
            error: `${replacement.mobileName} is not in stock any more`,
          } as const;
        }
        await tx.stockItem.update({
          where: { id: replacement.id },
          data: { status: "SOLD" },
        });
        replacementId = replacement.id;
      }

      // Return: the customer gets back what they paid for this item.
      const refund = input.kind === "RETURN" ? round2(sale.price) : 0;
      if (input.kind === "RETURN" && refund <= 0) {
        return { status: 400, error: "Nothing was paid for this item to refund" } as const;
      }

      const purchase = unit.purchaseItem?.purchase ?? null;
      const supplierId = unit.supplierId ?? purchase?.supplier?.id ?? null;
      const amount = round2(unit.purchasePrice || 0);

      // Credit the supplier: clear the unit's own purchase first, then the
      // oldest unpaid ones. Anything left stays as supplier credit.
      let appliedPaise = 0;
      if (supplierId && amount > 0) {
        await applyPendingReturnCredits(tx, supplierId);
        appliedPaise = await applyCreditToPurchases(
          tx,
          supplierId,
          Math.round(amount * 100),
          purchase?.id,
        );
      }

      const created = await tx.productReturn.create({
        data: {
          stockItemId: unit.id,
          supplierId,
          billId: sale.billId,
          billItemId: sale.billItemId || null,
          invoiceNumber: sale.invoiceNumber,
          customerName: sale.customerName,
          amount,
          creditApplied: appliedPaise / 100,
          kind: input.kind,
          refundAmount: refund,
          refundMethod: input.kind === "RETURN" ? input.refundMethod : null,
          replacementStockItemId: replacementId,
          note: input.note?.trim() || null,
          createdByUserId: req.user?.id ?? null,
          createdByName: req.user?.name ?? null,
        },
      });
      return { status: 201, created, billId: sale.billId } as const;
    });

    if (result.status !== 201) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json({
      data: {
        id: result.created.id,
        billId: result.billId,
        amount: result.created.amount,
        creditApplied: result.created.creditApplied,
      },
    });
  } catch (error) {
    next(error);
  }
});
