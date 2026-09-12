import type { PrismaClient } from "@prisma/client";
import { shouldStockRemainSold } from "./stockSync";

/**
 * Finds stock rows still marked AVAILABLE even though they are linked to a
 * sale that happened after their current intake (and were not returned).
 * Common cause: re-saving an exchange bill after the phone was already sold.
 *
 * Skips phones that were sold earlier and later taken back (return / re-exchange).
 */
export async function repairSoldStockMarkedAvailable(prisma: PrismaClient) {
  const candidates = await prisma.stockItem.findMany({
    where: {
      status: "AVAILABLE",
      billItems: { some: {} },
    },
    include: {
      billItems: {
        take: 1,
        include: {
          bill: {
            select: {
              invoiceNumber: true,
              customerName: true,
              customerPhone: true,
              billDate: true,
            },
          },
        },
        orderBy: { bill: { billDate: "desc" } },
      },
      purchaseItem: {
        include: {
          purchase: { select: { note: true, purchaseDate: true } },
        },
      },
    },
  });

  const details: Array<{
    stockId: string;
    imei: string | null;
    mobileName: string;
    invoiceNumber: string;
    customerName: string;
  }> = [];

  for (const row of candidates) {
    if (!shouldStockRemainSold(row)) continue;

    await prisma.stockItem.update({
      where: { id: row.id },
      data: { status: "SOLD" },
    });

    const sale = row.billItems[0]?.bill;
    details.push({
      stockId: row.id,
      imei: row.imei,
      mobileName: row.mobileName,
      invoiceNumber: sale?.invoiceNumber || "—",
      customerName: sale?.customerName || "—",
    });
  }

  return { repaired: details.length, details };
}
