import { prisma } from "./prisma";

export type LatestBillLine = {
  rate: number;
  amount: number;
  bill: {
    id: string;
    invoiceNumber: string;
    billDate: Date;
    customerName: string;
    customerPhone: string;
  };
};

/**
 * The latest bill line (by bill date) for each stock unit.
 *
 * Lists use this instead of a nested
 * `billItems: { orderBy: { bill: { billDate } }, take: 1 }` include: on SQLite
 * that crashes Prisma's query engine ("no entry found for key") once a query
 * covers a few thousand units.
 */
export async function latestBillLines(stockItemIds: string[]) {
  const latest = new Map<string, LatestBillLine>();
  for (let i = 0; i < stockItemIds.length; i += 500) {
    const lines = await prisma.billItem.findMany({
      where: { stockItemId: { in: stockItemIds.slice(i, i + 500) } },
      select: {
        stockItemId: true,
        rate: true,
        amount: true,
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
    });
    for (const { stockItemId, ...line } of lines) {
      if (!stockItemId) continue;
      const current = latest.get(stockItemId);
      if (!current || line.bill.billDate > current.bill.billDate) {
        latest.set(stockItemId, line);
      }
    }
  }
  return latest;
}
