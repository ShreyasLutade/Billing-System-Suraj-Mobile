import { Router } from "express";
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
};

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
  const withSale = units
    .filter((u) => u.billItems.length > 0)
    .sort(
      (a, b) =>
        b.billItems[0].bill.billDate.getTime() -
        a.billItems[0].bill.billDate.getTime(),
    );
  return { unit: withSale[0] ?? null, anyUnit: units.length > 0 };
}

function describeUnit(
  unit: NonNullable<Awaited<ReturnType<typeof findSoldUnit>>["unit"]>,
  isAdmin: boolean,
) {
  const purchase = unit.purchaseItem?.purchase ?? null;
  const supplier = unit.supplier ?? purchase?.supplier ?? null;
  const line = unit.billItems[0];
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
    bill: {
      id: line.bill.id,
      billItemId: line.id,
      invoiceNumber: line.bill.invoiceNumber,
      billDate: line.bill.billDate.toISOString(),
      customerName: line.bill.customerName,
      customerPhone: line.bill.customerPhone,
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
    const { unit, anyUnit } = await findSoldUnit(code);
    if (!unit) {
      res.status(404).json({
        error: anyUnit
          ? "This product is in stock — it hasn't been sold on a bill"
          : "No product found with this IMEI / serial number",
      });
      return;
    }
    res.json({ data: describeUnit(unit, true) });
  } catch (error) {
    next(error);
  }
});

const createSchema = z.object({
  stockItemId: z.string().min(1),
  note: z.string().trim().max(500).optional().nullable(),
});

/** POST /api/returns — record the replacement / return. */
productReturnsRouter.post("/", requireAdmin, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Choose the product to return" });
      return;
    }

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
      const line = unit.billItems[0];
      if (!line) {
        return { status: 400, error: "This product hasn't been sold on a bill" } as const;
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
          billId: line.bill.id,
          billItemId: line.id,
          invoiceNumber: line.bill.invoiceNumber,
          customerName: line.bill.customerName,
          amount,
          creditApplied: appliedPaise / 100,
          note: parsed.data.note?.trim() || null,
          createdByUserId: req.user?.id ?? null,
          createdByName: req.user?.name ?? null,
        },
      });
      return { status: 201, created, billId: line.bill.id } as const;
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
