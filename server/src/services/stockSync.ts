import type { Prisma } from "@prisma/client";
import { normalizeCapacity } from "../lib/capacity";
import { upsertPhoneModel } from "./phoneModels";

type Tx = Prisma.TransactionClient;

type StockLinkedItem = {
  stockItemId?: string | null;
  imei1?: string | null;
  productName?: string;
};

const EXCHANGE_NOTE_PREFIX = "EXCHANGE_INVOICE:";

export function exchangePurchaseNote(invoiceNumber: string) {
  return `${EXCHANGE_NOTE_PREFIX}${invoiceNumber.trim()}`;
}

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

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function serializeSuppliers(names: string[]) {
  return JSON.stringify(names.map((n) => n.trim()).filter(Boolean));
}

function resolveExchangeImei(invoiceNumber: string, rawImei?: string | null) {
  const cleaned = (rawImei || "").replace(/\s+/g, "").trim();
  if (cleaned) return cleaned;
  const safeInvoice = invoiceNumber.replace(/[^a-zA-Z0-9]/g, "").slice(-10);
  return `EXC${safeInvoice}${Date.now().toString(36).toUpperCase()}`;
}

async function upsertExchangeSupplier(
  tx: Tx,
  input: {
    customerName: string;
    customerPhone: string;
    customerAddress?: string | null;
  },
) {
  const phone = input.customerPhone.trim();
  const name = normalizeName(input.customerName);
  const address = input.customerAddress?.trim() || null;

  const byPhone = phone
    ? await tx.supplier.findFirst({
        where: { phone, isExchange: true },
      })
    : null;
  if (byPhone) {
    return tx.supplier.update({
      where: { id: byPhone.id },
      data: {
        address: address ?? byPhone.address,
        isExchange: true,
        notes: byPhone.notes || "Customer exchange",
      },
    });
  }

  let supplierName = name;
  const nameTaken = await tx.supplier.findFirst({
    where: { name: supplierName },
  });
  if (nameTaken) {
    supplierName = phone ? `${name} (${phone})` : `${name} · exchange`;
  }

  return tx.supplier.create({
    data: {
      name: supplierName,
      phone: phone || null,
      address,
      isExchange: true,
      notes: "Customer exchange",
    },
  });
}

async function removeExchangePurchase(tx: Tx, invoiceNumber: string) {
  const note = exchangePurchaseNote(invoiceNumber);
  const purchase = await tx.purchase.findFirst({
    where: { note },
    include: { items: { include: { stockItem: true } } },
  });
  if (!purchase) return;

  for (const item of purchase.items) {
    if (item.stockItem.status === "AVAILABLE") {
      await tx.purchaseItem.delete({ where: { id: item.id } });
      await tx.stockItem.delete({ where: { id: item.stockItemId } });
    } else {
      // Already sold — keep the stock row, only detach purchase link.
      await tx.purchaseItem.delete({ where: { id: item.id } });
    }
  }
  await tx.purchase.delete({ where: { id: purchase.id } });
}

export type ExchangeStockInput = {
  invoiceNumber: string;
  isExchange: boolean;
  customerName: string;
  customerPhone: string;
  customerAddress?: string | null;
  exchangeModel?: string | null;
  exchangePlatform?: string | null;
  exchangeColor?: string | null;
  exchangeStorage?: string | null;
  exchangeRam?: string | null;
  exchangeImei1?: string | null;
  exchangeValue?: number | null;
  purchaseDate?: Date;
};

/**
 * Puts the exchange phone into second-hand (USED) stock under the customer
 * as an exchange-marked supplier. Idempotent per invoice number.
 */
export async function syncExchangeStock(tx: Tx, input: ExchangeStockInput) {
  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) return null;

  if (
    !input.isExchange ||
    !input.exchangeModel?.trim() ||
    !input.exchangePlatform ||
    !input.exchangeColor?.trim() ||
    !input.exchangeStorage?.trim()
  ) {
    await removeExchangePurchase(tx, invoiceNumber);
    return null;
  }

  const platform = input.exchangePlatform === "ANDROID" ? "ANDROID" : "IOS";
  const mobileName = normalizeName(input.exchangeModel);
  const storage = normalizeCapacity(input.exchangeStorage);
  const ram =
    platform === "ANDROID" ? normalizeCapacity(input.exchangeRam || "") : "";
  const color = normalizeName(input.exchangeColor);
  const purchasePrice = Number(input.exchangeValue ?? 0) || 0;
  const note = exchangePurchaseNote(invoiceNumber);
  const purchaseDate = input.purchaseDate || new Date();

  const supplier = await upsertExchangeSupplier(tx, {
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerAddress: input.customerAddress,
  });

  const existingPurchase = await tx.purchase.findFirst({
    where: { note },
    include: { items: { include: { stockItem: true } } },
  });

  const existingStock = existingPurchase?.items[0]?.stockItem || null;
  const imei = input.exchangeImei1?.replace(/\s+/g, "").trim()
    ? resolveExchangeImei(invoiceNumber, input.exchangeImei1)
    : existingStock?.imei || resolveExchangeImei(invoiceNumber, null);

  // IMEI clash with a different stock row (not this exchange).
  const imeiOwner = await tx.stockItem.findUnique({ where: { imei } });
  const ownedByThisExchange = existingStock?.id === imeiOwner?.id;
  if (imeiOwner && !ownedByThisExchange) {
    throw new Error("EXCHANGE_IMEI_TAKEN");
  }

  await upsertPhoneModel(tx, {
    platform,
    name: mobileName,
    storage,
    ram,
  });

  if (existingPurchase && existingStock) {
    const stock = await tx.stockItem.update({
      where: { id: existingStock.id },
      data: {
        condition: "USED",
        platform,
        mobileName,
        storage,
        ram,
        color,
        imei,
        purchasePrice,
        suppliers: serializeSuppliers([supplier.name]),
        supplierId: supplier.id,
      },
    });
    await tx.purchase.update({
      where: { id: existingPurchase.id },
      data: {
        supplierId: supplier.id,
        totalAmount: purchasePrice,
        condition: "USED",
        purchaseDate,
        paidAt: purchaseDate,
        note,
      },
    });
    return stock;
  }

  if (existingPurchase) {
    await tx.purchase.delete({ where: { id: existingPurchase.id } });
  }

  const stock = await tx.stockItem.create({
    data: {
      condition: "USED",
      platform,
      mobileName,
      storage,
      ram,
      color,
      imei,
      purchasePrice,
      suppliers: serializeSuppliers([supplier.name]),
      supplierId: supplier.id,
      status: "AVAILABLE",
      createdAt: purchaseDate,
    },
  });

  const purchase = await tx.purchase.create({
    data: {
      supplierId: supplier.id,
      purchaseDate,
      note,
      totalAmount: purchasePrice,
      condition: "USED",
      paidAt: purchaseDate,
    },
  });

  await tx.purchaseItem.create({
    data: {
      purchaseId: purchase.id,
      stockItemId: stock.id,
    },
  });

  return stock;
}

/** Remove unused exchange stock when a bill is deleted. */
export async function clearExchangeStock(tx: Tx, invoiceNumber: string) {
  await removeExchangePurchase(tx, invoiceNumber);
}
