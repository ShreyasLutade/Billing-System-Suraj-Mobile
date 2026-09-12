import type { PrismaClient } from "@prisma/client";

const TARGET_PURCHASE_ID = "cmtvrhss800c2hv6gqstc7iul";

/**
 * Move a purchase + its stock units (+ sold bill lines) between NEW and USED.
 */
export async function setPurchaseCondition(
  prisma: PrismaClient,
  purchaseId: string,
  condition: "NEW" | "USED",
) {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { select: { stockItemId: true } },
    },
  });
  if (!purchase) {
    return { ok: false as const, error: "Purchase not found" };
  }

  const stockIds = purchase.items.map((item) => item.stockItemId);

  await prisma.$transaction(async (tx) => {
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { condition },
    });
    if (stockIds.length) {
      await tx.stockItem.updateMany({
        where: { id: { in: stockIds } },
        data: { condition },
      });
      await tx.billItem.updateMany({
        where: { stockItemId: { in: stockIds } },
        data: { condition },
      });
    }
  });

  return {
    ok: true as const,
    purchaseId: purchase.id,
    supplierName: purchase.supplier.name,
    previousCondition: purchase.condition,
    condition,
    stockCount: stockIds.length,
  };
}

/**
 * One-shot: Anish's 10 Sep 2026 Gurunanak purchase was saved as NEW by mistake.
 * Idempotent — no-ops once already USED.
 */
export async function fixGurunanakSep10PurchaseToUsed(prisma: PrismaClient) {
  const purchase = await prisma.purchase.findUnique({
    where: { id: TARGET_PURCHASE_ID },
    include: {
      supplier: { select: { name: true } },
      items: { select: { stockItemId: true } },
    },
  });

  if (!purchase) {
    return { skipped: true as const, reason: "purchase-not-found" };
  }
  if (!/guru\s*nanak/i.test(purchase.supplier.name)) {
    return { skipped: true as const, reason: "supplier-mismatch" };
  }
  if (String(purchase.condition).toUpperCase() === "USED") {
    return { skipped: true as const, reason: "already-used" };
  }
  if (
    purchase.createdByName &&
    !/anish/i.test(purchase.createdByName)
  ) {
    return { skipped: true as const, reason: "creator-mismatch" };
  }

  const result = await setPurchaseCondition(
    prisma,
    TARGET_PURCHASE_ID,
    "USED",
  );
  if (!result.ok) {
    return { skipped: true as const, reason: result.error };
  }
  return {
    skipped: false as const,
    purchaseId: result.purchaseId,
    stockCount: result.stockCount,
    from: result.previousCondition,
    to: result.condition,
  };
}
