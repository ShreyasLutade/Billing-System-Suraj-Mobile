import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

type StockLinkedItem = {
  stockItemId?: string | null;
  imei1?: string | null;
  productName?: string;
};

/**
 * Marks stock units as SOLD for the given bill lines.
 * Previously linked units that are no longer on the bill become AVAILABLE again.
 */
export async function syncStockForBillItems(
  tx: Tx,
  nextItems: StockLinkedItem[],
  previousStockIds: string[] = [],
) {
  const nextIds = [
    ...new Set(
      nextItems
        .map((item) => item.stockItemId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (nextIds.length !== nextItems.filter((i) => i.stockItemId?.trim()).length) {
    throw new Error("STOCK_DUPLICATE");
  }

  for (const item of nextItems) {
    const stockId = item.stockItemId?.trim();
    if (!stockId) continue;

    const stock = await tx.stockItem.findUnique({ where: { id: stockId } });
    if (!stock) {
      throw new Error("STOCK_NOT_FOUND");
    }

    const stillOwnedByThisBill = previousStockIds.includes(stockId);
    if (stock.status !== "AVAILABLE" && !stillOwnedByThisBill) {
      throw new Error("STOCK_UNAVAILABLE");
    }

    const imei = item.imei1?.replace(/\s+/g, "") || "";
    if (imei && stock.imei !== imei) {
      throw new Error("STOCK_IMEI_MISMATCH");
    }
  }

  const releaseIds = previousStockIds.filter((id) => !nextIds.includes(id));
  if (releaseIds.length) {
    await tx.stockItem.updateMany({
      where: { id: { in: releaseIds } },
      data: { status: "AVAILABLE" },
    });
  }

  if (nextIds.length) {
    await tx.stockItem.updateMany({
      where: { id: { in: nextIds } },
      data: { status: "SOLD" },
    });
  }
}

export async function releaseStockIds(tx: Tx, stockIds: string[]) {
  const ids = [...new Set(stockIds.filter(Boolean))];
  if (!ids.length) return;
  await tx.stockItem.updateMany({
    where: { id: { in: ids } },
    data: { status: "AVAILABLE" },
  });
}
