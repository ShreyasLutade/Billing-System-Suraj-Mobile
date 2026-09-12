import type { PrismaClient } from "@prisma/client";
import {
  EXCHANGE_NOTE_PREFIX,
  exchangePurchaseNote,
  retireStockImei,
} from "./stockSync";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

function cleanImei(value?: string | null) {
  return (value || "").replace(/\s+/g, "").trim();
}

function baseImei(value?: string | null) {
  const cleaned = cleanImei(value);
  if (!cleaned) return "";
  const idx = cleaned.indexOf("~");
  return idx >= 0 ? cleaned.slice(0, idx) : cleaned;
}

function serializeSuppliers(names: string[]) {
  return JSON.stringify(names.map((name) => name.trim()).filter(Boolean));
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * When a sold exchange phone was taken back as a later exchange, older code
 * reused the stock row and wiped the first customer's purchase link.
 *
 * Restore a historical SOLD stock row under the original exchanger, relink the
 * middle sale bill to it, and leave the current stock under the later exchanger.
 */
export async function repairOverwrittenReexchangeHistory(prisma: PrismaClient) {
  const laterPurchases = await prisma.purchase.findMany({
    where: { note: { startsWith: EXCHANGE_NOTE_PREFIX } },
    include: {
      supplier: true,
      items: {
        include: {
          stockItem: {
            include: {
              billItems: {
                include: {
                  bill: {
                    select: {
                      id: true,
                      invoiceNumber: true,
                      billDate: true,
                      customerName: true,
                    },
                  },
                },
                orderBy: { bill: { billDate: "asc" } },
              },
            },
          },
        },
      },
    },
  });

  let repaired = 0;
  const details: Array<{
    imei: string;
    originalInvoice: string;
    saleInvoice: string;
    laterInvoice: string;
    historicalStockId: string;
  }> = [];

  for (const laterPurchase of laterPurchases) {
    const laterInvoice = (laterPurchase.note || "")
      .slice(EXCHANGE_NOTE_PREFIX.length)
      .trim();
    if (!laterInvoice) continue;

    for (const link of laterPurchase.items) {
      const stock = link.stockItem;
      const imei = baseImei(stock.imei);
      if (!imei || stock.imei?.includes("~")) continue;

      const earlierExchangeBills = await prisma.bill.findMany({
        where: {
          isExchange: true,
          OR: [
            { exchangeImei1: imei },
            { exchangeItemsJson: { contains: imei } },
          ],
          billDate: { lt: laterPurchase.purchaseDate },
          NOT: { invoiceNumber: laterInvoice },
        },
        orderBy: { billDate: "asc" },
        select: {
          id: true,
          invoiceNumber: true,
          billDate: true,
          customerName: true,
          customerPhone: true,
          customerAddress: true,
          exchangeModel: true,
          exchangePlatform: true,
          exchangeColor: true,
          exchangeStorage: true,
          exchangeRam: true,
          exchangeImei1: true,
          exchangeValue: true,
          exchangeItemsJson: true,
        },
      });

      const originalBill = earlierExchangeBills.find((bill) => {
        if (cleanImei(bill.exchangeImei1) === imei) return true;
        try {
          const parsed = JSON.parse(bill.exchangeItemsJson || "[]");
          return (
            Array.isArray(parsed) &&
            parsed.some((row) => cleanImei(row?.imei1) === imei)
          );
        } catch {
          return false;
        }
      });
      if (!originalBill) continue;

      const originalNote = exchangePurchaseNote(originalBill.invoiceNumber);
      const originalPurchase = await prisma.purchase.findFirst({
        where: { note: originalNote },
        include: {
          supplier: true,
          items: { include: { stockItem: true } },
        },
      });
      if (!originalPurchase) continue;

      // Already repaired if original purchase still has a stock for this IMEI.
      const alreadyLinked = originalPurchase.items.some(
        (row) => baseImei(row.stockItem.imei) === imei,
      );
      if (alreadyLinked) continue;

      const saleBillItem =
        stock.billItems.find(
          (row) =>
            row.bill.billDate >= originalBill.billDate &&
            row.bill.billDate <= laterPurchase.purchaseDate &&
            row.bill.invoiceNumber !== laterInvoice &&
            row.bill.invoiceNumber !== originalBill.invoiceNumber,
        ) ||
        stock.billItems.find(
          (row) =>
            row.bill.invoiceNumber !== laterInvoice &&
            cleanImei(row.imei1) === imei,
        );

      if (!saleBillItem) continue;

      // Current stock supplier should be the later exchanger (overwrite symptom).
      if (stock.supplierId === originalPurchase.supplierId) continue;

      const result = await prisma.$transaction(async (tx) => {
        const historical = await tx.stockItem.create({
          data: {
            kind: stock.kind || "MOBILE",
            condition: "USED",
            platform:
              originalBill.exchangePlatform ||
              stock.platform ||
              "IOS",
            mobileName:
              originalBill.exchangeModel?.trim() || stock.mobileName,
            storage:
              originalBill.exchangeStorage?.trim() || stock.storage || "",
            ram: originalBill.exchangeRam?.trim() || stock.ram || "",
            color: originalBill.exchangeColor?.trim() || stock.color || "",
            imei: null,
            serialNumber: null,
            purchasePrice: round2(
              Number(originalBill.exchangeValue || stock.purchasePrice || 0),
            ),
            suppliers: serializeSuppliers([originalPurchase.supplier.name]),
            supplierId: originalPurchase.supplierId,
            status: "SOLD",
            createdAt: originalBill.billDate,
            createdByUserId: stock.createdByUserId,
            createdByName: stock.createdByName,
          },
        });

        await tx.stockItem.update({
          where: { id: historical.id },
          data: { imei: retireStockImei(imei, historical.id) },
        });

        await tx.purchaseItem.create({
          data: {
            purchaseId: originalPurchase.id,
            stockItemId: historical.id,
          },
        });

        await tx.billItem.update({
          where: { id: saleBillItem.id },
          data: { stockItemId: historical.id },
        });

        // Keep original purchase total aligned with restored unit value.
        const siblings = await tx.purchaseItem.findMany({
          where: { purchaseId: originalPurchase.id },
          include: { stockItem: { select: { purchasePrice: true } } },
        });
        const totalAmount = round2(
          siblings.reduce((sum, row) => sum + row.stockItem.purchasePrice, 0),
        );
        await tx.purchase.update({
          where: { id: originalPurchase.id },
          data: { totalAmount },
        });

        return historical.id;
      });

      repaired += 1;
      details.push({
        imei,
        originalInvoice: originalBill.invoiceNumber,
        saleInvoice: saleBillItem.bill.invoiceNumber,
        laterInvoice,
        historicalStockId: result,
      });
    }
  }

  return { repaired, details };
}

/** Convenience no-op export so callers can share Tx typing if needed later. */
export type RepairTx = Tx;
