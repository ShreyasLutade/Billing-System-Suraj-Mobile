import type { PrismaClient } from "@prisma/client";

/**
 * Older builds used a single financeReceived flag for the whole bill.
 * After adding financeReceived2, copy received status onto slot 2 for
 * dual-finance bills that were already marked received.
 */
export async function backfillFinanceReceived2(prisma: PrismaClient) {
  const result = await prisma.bill.updateMany({
    where: {
      financeReceived: true,
      financeAmount2: { gt: 0 },
      financeReceived2: false,
    },
    data: {
      financeReceived2: true,
    },
  });

  if (result.count > 0) {
    // Align timestamps where possible (SQLite can't do column copy in updateMany)
    const bills = await prisma.bill.findMany({
      where: {
        financeReceived: true,
        financeReceived2: true,
        financeAmount2: { gt: 0 },
        financeReceivedAt2: null,
        financeReceivedAt: { not: null },
      },
      select: { id: true, financeReceivedAt: true },
    });
    for (const bill of bills) {
      await prisma.bill.update({
        where: { id: bill.id },
        data: { financeReceivedAt2: bill.financeReceivedAt },
      });
    }
  }

  return result.count;
}
