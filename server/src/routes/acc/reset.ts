import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { prisma } from "../../lib/prisma";
import { requireAdmin } from "../../middleware/auth";
import { getSqliteFilePath, isSqliteDatabaseUrl } from "../../services/sqliteBackup";

/**
 * Start the accessories shop over with real data: clears its products,
 * stock history, bills, customers, dues, suppliers and purchases. Only Acc*
 * tables are touched (the mobile shop and repair desk are separate).
 * Categories stay (they are the shop's setup), and bill numbers restart at
 * AR-0001 / AW-0001. A JSON copy of what was cleared is saved next to the
 * database first, so a mistake can still be recovered.
 */
export const accResetRouter = Router();

/** Bill-number counters; other AccCounter keys are one-time migration marks. */
const BILL_COUNTERS = ["RETAIL", "WHOLESALE"];

const CONFIRM_WORD = "DELETE";

async function counts() {
  const [products, sales, customers, payments, suppliers, purchases] = await Promise.all([
    prisma.accProduct.count(),
    prisma.accSale.count(),
    prisma.accCustomer.count(),
    prisma.accPayment.count(),
    prisma.accSupplier.count(),
    prisma.accPurchase.count(),
  ]);
  return { products, sales, customers, payments, suppliers, purchases };
}

accResetRouter.get("/admin/reset-summary", requireAdmin, async (_req, res, next) => {
  try {
    res.json({ data: { ...(await counts()), confirmWord: CONFIRM_WORD } });
  } catch (error) {
    next(error);
  }
});

async function saveSnapshot(by: string) {
  if (!isSqliteDatabaseUrl()) return null;
  const [
    categories,
    products,
    productModels,
    stockMoves,
    customerGroups,
    customers,
    sales,
    saleItems,
    payments,
    supplierGroups,
    suppliers,
    purchases,
    purchaseItems,
    supplierPayments,
    counters,
  ] = await Promise.all([
    prisma.accCategory.findMany(),
    prisma.accProduct.findMany(),
    prisma.accProductModel.findMany(),
    prisma.accStockMove.findMany(),
    prisma.accCustomerGroup.findMany(),
    prisma.accCustomer.findMany(),
    prisma.accSale.findMany(),
    prisma.accSaleItem.findMany(),
    prisma.accPayment.findMany(),
    prisma.accSupplierGroup.findMany(),
    prisma.accSupplier.findMany(),
    prisma.accPurchase.findMany(),
    prisma.accPurchaseItem.findMany(),
    prisma.accSupplierPayment.findMany(),
    prisma.accCounter.findMany(),
  ]);
  const snapshot = {
    savedAt: new Date().toISOString(),
    clearedBy: by,
    tables: {
      categories,
      products,
      productModels,
      stockMoves,
      customerGroups,
      customers,
      sales,
      saleItems,
      payments,
      supplierGroups,
      suppliers,
      purchases,
      purchaseItems,
      supplierPayments,
      counters,
    },
  };
  const dir = path.dirname(getSqliteFilePath());
  const file = path.join(dir, `accessories-before-reset-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  // Bytes (photos) don't survive JSON; Acc* tables have none.
  await fs.writeFile(file, JSON.stringify(snapshot));
  return file;
}

accResetRouter.post("/admin/reset", requireAdmin, async (req, res, next) => {
  try {
    if (String(req.body?.confirm || "").trim().toUpperCase() !== CONFIRM_WORD) {
      res.status(400).json({ error: `Type ${CONFIRM_WORD} to confirm` });
      return;
    }
    const before = await counts();
    const snapshot = await saveSnapshot(req.user?.name || req.user?.phone || "admin");

    await prisma.$transaction([
      // Children before parents (some relations don't cascade).
      prisma.accSaleItem.deleteMany(),
      prisma.accPayment.deleteMany(),
      prisma.accSale.deleteMany(),
      prisma.accCustomer.deleteMany(),
      prisma.accCustomerGroup.deleteMany(),
      prisma.accPurchaseItem.deleteMany(),
      prisma.accSupplierPayment.deleteMany(),
      prisma.accPurchase.deleteMany(),
      prisma.accSupplier.deleteMany(),
      prisma.accSupplierGroup.deleteMany(),
      prisma.accStockMove.deleteMany(),
      prisma.accProductModel.deleteMany(),
      prisma.accProduct.deleteMany(),
      prisma.accCounter.deleteMany({ where: { key: { in: BILL_COUNTERS } } }),
    ]);

    console.log(
      `[acc] Accessories data cleared by ${req.user?.name} (${req.user?.phone}): ${JSON.stringify(before)}${
        snapshot ? `; copy saved to ${snapshot}` : ""
      }`,
    );
    res.json({ data: { cleared: before, snapshotSaved: Boolean(snapshot) } });
  } catch (error) {
    next(error);
  }
});
