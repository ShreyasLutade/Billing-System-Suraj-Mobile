import { Prisma } from "@prisma/client";
import type {
  Bill,
  BillItem,
  DuePayment,
  ProductReturn,
  Purchase,
  PurchaseItem,
  RepairJob as RepairJobRow,
  StockItem,
  Supplier,
  SupplierPayment,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { exchangePurchaseNote } from "./stockSync";
import { setPurchaseTotal } from "./purchasePayment";

/**
 * Recycle bin. A delete saves a JSON snapshot of every row it removes (in the
 * same transaction), so it can be undone for BIN_DAYS. Undo puts the rows
 * back with their original ids; when something they depend on has changed
 * since (IMEI back in stock, supplier gone, …) the undo is refused and
 * nothing changes.
 */

type Tx = Prisma.TransactionClient;
type User = { id?: string | null; name?: string | null } | null | undefined;

export const BIN_DAYS = 30;
const BIN_MS = BIN_DAYS * 24 * 60 * 60 * 1000;

export type BinKind = "BILL" | "SUPPLIER" | "STOCK" | "REPAIR";

/** An undo that can't be done; the message is shown to the user. */
export class RestoreError extends Error {}

// ---------------------------------------------------------------- snapshots

/** Stock units and everything removed along with them. */
type StockSnap = {
  stock: StockItem[];
  links: PurchaseItem[];
  returns: ProductReturn[];
  /** Bill lines (on other bills) that pointed at these units; a delete clears them. */
  billLinks: Array<{ id: string; stockItemId: string }>;
};

type BillPayload = {
  mode: "delete" | "restock";
  bill: Bill;
  items: BillItem[];
  duePayments: DuePayment[];
  /** delete: units removed from stock with the bill. */
  soldStock: StockSnap | null;
  /** restock: units that went back to stock (must still be there to undo). */
  releasedStockIds: string[];
  /** Exchange phones taken in on this bill. */
  exchange: {
    purchase: Purchase;
    payments: SupplierPayment[];
    /** Unsold exchange phones (deleted with the bill). */
    stock: StockSnap;
    /** Already-sold exchange phones only lost their purchase link. */
    soldLinks: PurchaseItem[];
  } | null;
};

type SupplierPayload = {
  supplier: Supplier;
  purchases: Purchase[];
  payments: SupplierPayment[];
  stock: StockSnap;
  returns: ProductReturn[];
};

type StockPayload = {
  stock: StockSnap;
  purchaseId: string | null;
  /** Set when the unit was the last in its purchase (purchase deleted too). */
  purchase: Purchase | null;
  purchasePayments: SupplierPayment[];
};

type RepairPayload = Omit<RepairJobRow, "frontPhoto" | "backPhoto"> & {
  frontPhoto: string | null;
  backPhoto: string | null;
};

async function snapshotStock(
  tx: Tx,
  ids: string[],
  exceptBillId?: string,
): Promise<StockSnap> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { stock: [], links: [], returns: [], billLinks: [] };
  const [stock, links, returns, billLinks] = await Promise.all([
    tx.stockItem.findMany({ where: { id: { in: unique } } }),
    tx.purchaseItem.findMany({ where: { stockItemId: { in: unique } } }),
    tx.productReturn.findMany({ where: { stockItemId: { in: unique } } }),
    tx.billItem.findMany({
      where: {
        stockItemId: { in: unique },
        ...(exceptBillId ? { NOT: { billId: exceptBillId } } : {}),
      },
      select: { id: true, stockItemId: true },
    }),
  ]);
  return {
    stock,
    links,
    returns,
    billLinks: billLinks.map((b) => ({ id: b.id, stockItemId: b.stockItemId! })),
  };
}

function rupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function unitId(stock: { imei: string | null; serialNumber: string | null }) {
  if (stock.imei) return `IMEI ${stock.imei.split("~")[0]}`;
  if (stock.serialNumber) return `SN ${stock.serialNumber.split("~")[0]}`;
  return "";
}

async function addEntry(
  tx: Tx,
  kind: BinKind,
  label: string,
  detail: string,
  payload: unknown,
  user: User,
) {
  await tx.recycleBinEntry.create({
    data: {
      kind,
      label,
      detail,
      payload: JSON.stringify(payload),
      deletedById: user?.id || null,
      deletedByName: user?.name || null,
    },
  });
}

/** Snapshot a repair job before deleting it, including its uploaded photos. */
export async function binRepairJob(tx: Tx, repairJobId: string, user: User) {
  const job = await tx.repairJob.findUnique({ where: { id: repairJobId } });
  if (!job) return;
  const payload: RepairPayload = {
    ...job,
    frontPhoto: job.frontPhoto ? Buffer.from(job.frontPhoto).toString("base64") : null,
    backPhoto: job.backPhoto ? Buffer.from(job.backPhoto).toString("base64") : null,
  };
  await addEntry(
    tx,
    "REPAIR",
    `Repair ${job.jobNumber} · ${job.customerName}`,
    [job.deviceName, job.customerPhone, job.status.replaceAll("_", " ").toLowerCase()].join(" · "),
    payload,
    user,
  );
}

/** Call inside the delete transaction, before anything is removed. */
export async function binBill(
  tx: Tx,
  billId: string,
  mode: "delete" | "restock",
  user: User,
) {
  const bill = await tx.bill.findUnique({ where: { id: billId } });
  if (!bill) return;
  const [items, duePayments] = await Promise.all([
    tx.billItem.findMany({ where: { billId } }),
    tx.duePayment.findMany({ where: { billId } }),
  ]);
  const stockIds = items.map((i) => i.stockItemId).filter((id): id is string => Boolean(id));

  let exchange: BillPayload["exchange"] = null;
  const exchangePurchase = await tx.purchase.findFirst({
    where: { note: exchangePurchaseNote(bill.invoiceNumber) },
    include: { items: { include: { stockItem: { select: { status: true } } } } },
  });
  if (exchangePurchase) {
    const { items: exItems, ...purchase } = exchangePurchase;
    const unsold = exItems.filter((i) => i.stockItem.status === "AVAILABLE");
    exchange = {
      purchase,
      payments: await tx.supplierPayment.findMany({ where: { purchaseId: purchase.id } }),
      stock: await snapshotStock(tx, unsold.map((i) => i.stockItemId)),
      soldLinks: exItems
        .filter((i) => i.stockItem.status !== "AVAILABLE")
        .map(({ stockItem: _s, ...link }) => link),
    };
  }

  const payload: BillPayload = {
    mode,
    bill,
    items,
    duePayments,
    soldStock: mode === "delete" ? await snapshotStock(tx, stockIds, billId) : null,
    releasedStockIds: mode === "restock" ? stockIds : [],
    exchange,
  };
  await addEntry(
    tx,
    "BILL",
    `Bill ${bill.invoiceNumber} · ${bill.customerName}`,
    [
      `${items.length} item${items.length === 1 ? "" : "s"}`,
      rupees(bill.grandTotal),
      mode === "restock" ? "items were returned to stock" : "items deleted from stock",
    ].join(" · "),
    payload,
    user,
  );
}

/** `stockIds`: every unit the supplier delete will remove. */
export async function binSupplier(tx: Tx, supplierId: string, stockIds: string[], user: User) {
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return;
  const [purchases, payments, returns, stock] = await Promise.all([
    tx.purchase.findMany({ where: { supplierId } }),
    tx.supplierPayment.findMany({ where: { supplierId } }),
    tx.productReturn.findMany({ where: { supplierId } }),
    snapshotStock(tx, stockIds),
  ]);
  const payload: SupplierPayload = { supplier, purchases, payments, stock, returns };
  await addEntry(
    tx,
    "SUPPLIER",
    `Supplier ${supplier.name}`,
    [
      `${purchases.length} purchase${purchases.length === 1 ? "" : "s"}`,
      `${stock.stock.length} item${stock.stock.length === 1 ? "" : "s"} in stock`,
      supplier.phone || null,
    ]
      .filter(Boolean)
      .join(" · "),
    payload,
    user,
  );
}

export async function binStockItem(tx: Tx, stockId: string, user: User) {
  const snap = await snapshotStock(tx, [stockId]);
  const unit = snap.stock[0];
  if (!unit) return;
  const purchaseId = snap.links[0]?.purchaseId ?? null;
  let purchase: Purchase | null = null;
  let purchasePayments: SupplierPayment[] = [];
  if (purchaseId) {
    const siblings = await tx.purchaseItem.count({ where: { purchaseId } });
    if (siblings <= 1) {
      purchase = await tx.purchase.findUnique({ where: { id: purchaseId } });
      purchasePayments = await tx.supplierPayment.findMany({ where: { purchaseId } });
    }
  }
  const supplier = unit.supplierId
    ? await tx.supplier.findUnique({ where: { id: unit.supplierId }, select: { name: true } })
    : null;
  const payload: StockPayload = { stock: snap, purchaseId, purchase, purchasePayments };
  await addEntry(
    tx,
    "STOCK",
    [unit.mobileName, unit.storage].filter(Boolean).join(" "),
    [unitId(unit), supplier ? `from ${supplier.name}` : null, rupees(unit.purchasePrice)]
      .filter(Boolean)
      .join(" · "),
    payload,
    user,
  );
}

// ------------------------------------------------------------------ restore

async function restoreStock(tx: Tx, snap: StockSnap) {
  for (const unit of snap.stock) {
    if (await tx.stockItem.findUnique({ where: { id: unit.id }, select: { id: true } })) {
      throw new RestoreError(`${unit.mobileName} is already back in stock.`);
    }
    if (unit.imei && (await tx.stockItem.findUnique({ where: { imei: unit.imei } }))) {
      throw new RestoreError(
        `${unitId(unit)} is in stock again as another unit, so ${unit.mobileName} can't come back.`,
      );
    }
    if (
      unit.serialNumber &&
      (await tx.stockItem.findUnique({ where: { serialNumber: unit.serialNumber } }))
    ) {
      throw new RestoreError(
        `SN ${unit.serialNumber} is in stock again as another unit, so ${unit.mobileName} can't come back.`,
      );
    }
    if (
      unit.supplierId &&
      !(await tx.supplier.findUnique({ where: { id: unit.supplierId }, select: { id: true } }))
    ) {
      throw new RestoreError(`The supplier of ${unit.mobileName} has been deleted since.`);
    }
    await tx.stockItem.create({ data: unit });
  }
  for (const link of snap.links) {
    if (!(await tx.purchase.findUnique({ where: { id: link.purchaseId }, select: { id: true } }))) {
      throw new RestoreError("The purchase these items came in on has been deleted since.");
    }
    await tx.purchaseItem.create({ data: link });
  }
  for (const r of snap.returns) {
    const supplierOk =
      !r.supplierId ||
      (await tx.supplier.findUnique({ where: { id: r.supplierId }, select: { id: true } }));
    await tx.productReturn.create({ data: { ...r, supplierId: supplierOk ? r.supplierId : null } });
  }
  for (const link of snap.billLinks) {
    await tx.billItem.updateMany({
      where: { id: link.id, stockItemId: null },
      data: { stockItemId: link.stockItemId },
    });
  }
}

async function restoreBill(tx: Tx, p: BillPayload) {
  if (await tx.bill.findUnique({ where: { invoiceNumber: p.bill.invoiceNumber } })) {
    throw new RestoreError(`Invoice ${p.bill.invoiceNumber} is used by another bill now.`);
  }

  if (p.exchange) {
    const { purchase } = p.exchange;
    if (!(await tx.supplier.findUnique({ where: { id: purchase.supplierId }, select: { id: true } }))) {
      throw new RestoreError("The exchange customer's supplier entry has been deleted since.");
    }
    await tx.purchase.create({ data: purchase });
    for (const pay of p.exchange.payments) await tx.supplierPayment.create({ data: pay });
    await restoreStock(tx, p.exchange.stock);
    for (const link of p.exchange.soldLinks) {
      const free =
        (await tx.stockItem.findUnique({ where: { id: link.stockItemId }, select: { id: true } })) &&
        !(await tx.purchaseItem.findUnique({ where: { stockItemId: link.stockItemId } }));
      if (free) await tx.purchaseItem.create({ data: link });
    }
  }

  if (p.mode === "delete" && p.soldStock) {
    await restoreStock(tx, p.soldStock);
  } else if (p.releasedStockIds.length) {
    const units = await tx.stockItem.findMany({ where: { id: { in: p.releasedStockIds } } });
    for (const id of p.releasedStockIds) {
      const unit = units.find((u) => u.id === id);
      const line = p.items.find((i) => i.stockItemId === id);
      const name = unit?.mobileName || line?.productName || "An item";
      if (!unit) throw new RestoreError(`${name} has been deleted from stock since.`);
      if (unit.status !== "AVAILABLE") {
        throw new RestoreError(`${name} (${unitId(unit)}) has been sold again on another bill.`);
      }
    }
    await tx.stockItem.updateMany({
      where: { id: { in: p.releasedStockIds } },
      data: { status: "SOLD" },
    });
  }

  const financeOk = async (id: string | null) =>
    !id || Boolean(await tx.financeCompany.findUnique({ where: { id }, select: { id: true } }));
  await tx.bill.create({
    data: {
      ...p.bill,
      financeCompanyId: (await financeOk(p.bill.financeCompanyId)) ? p.bill.financeCompanyId : null,
      financeCompanyId2: (await financeOk(p.bill.financeCompanyId2)) ? p.bill.financeCompanyId2 : null,
    },
  });
  for (const item of p.items) {
    const catalogOk =
      !item.mobileCatalogId ||
      (await tx.mobileCatalog.findUnique({ where: { id: item.mobileCatalogId }, select: { id: true } }));
    const stockOk =
      !item.stockItemId ||
      (await tx.stockItem.findUnique({ where: { id: item.stockItemId }, select: { id: true } }));
    await tx.billItem.create({
      data: {
        ...item,
        mobileCatalogId: catalogOk ? item.mobileCatalogId : null,
        stockItemId: stockOk ? item.stockItemId : null,
      },
    });
  }
  for (const pay of p.duePayments) await tx.duePayment.create({ data: pay });
  return `/bills/${p.bill.id}`;
}

async function restoreSupplier(tx: Tx, p: SupplierPayload) {
  const clash = await tx.supplier.findFirst({
    where: { OR: [{ id: p.supplier.id }, { name: p.supplier.name }] },
  });
  if (clash) {
    throw new RestoreError(`A supplier named "${p.supplier.name}" exists now.`);
  }
  await tx.supplier.create({ data: p.supplier });
  for (const purchase of p.purchases) await tx.purchase.create({ data: purchase });
  for (const pay of p.payments) await tx.supplierPayment.create({ data: pay });
  await restoreStock(tx, p.stock);
  const restoredReturns = new Set(p.stock.returns.map((r) => r.id));
  for (const r of p.returns) {
    if (restoredReturns.has(r.id)) continue;
    const unit = await tx.stockItem.findUnique({ where: { id: r.stockItemId }, select: { id: true } });
    const taken = await tx.productReturn.findUnique({ where: { stockItemId: r.stockItemId } });
    if (unit && !taken) await tx.productReturn.create({ data: r });
  }
  return `/suppliers/${p.supplier.id}`;
}

async function restoreStockEntry(tx: Tx, p: StockPayload) {
  if (p.purchase) {
    if (
      !(await tx.supplier.findUnique({ where: { id: p.purchase.supplierId }, select: { id: true } }))
    ) {
      throw new RestoreError("Its supplier has been deleted since.");
    }
    await tx.purchase.create({ data: p.purchase });
    for (const pay of p.purchasePayments) await tx.supplierPayment.create({ data: pay });
  }
  await restoreStock(tx, p.stock);
  if (p.purchaseId) {
    const links = await tx.purchaseItem.findMany({
      where: { purchaseId: p.purchaseId },
      include: { stockItem: { select: { purchasePrice: true } } },
    });
    await setPurchaseTotal(
      tx,
      p.purchaseId,
      links.reduce((sum, l) => sum + l.stockItem.purchasePrice, 0),
    );
  }
  const unit = p.stock.stock[0];
  return unit?.supplierId ? `/suppliers/${unit.supplierId}` : "/stock";
}

async function restoreRepairJob(tx: Tx, p: RepairPayload) {
  const { frontPhoto, backPhoto, ...job } = p;
  await tx.repairJob.create({
    data: {
      ...job,
      frontPhoto: frontPhoto ? Buffer.from(frontPhoto, "base64") : null,
      backPhoto: backPhoto ? Buffer.from(backPhoto, "base64") : null,
    },
  });
  return `/repair/${job.id}`;
}

/** Undo a delete. Returns the page to open afterwards. */
export async function restoreEntry(id: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const entry = await tx.recycleBinEntry.findUnique({ where: { id } });
      if (!entry || isExpired(entry.deletedAt)) {
        throw new RestoreError("This item is no longer in the recycle bin.");
      }
      const payload = JSON.parse(entry.payload);
      const path =
        entry.kind === "REPAIR"
          ? await restoreRepairJob(tx, payload as RepairPayload)
          : entry.kind === "BILL"
          ? await restoreBill(tx, payload as BillPayload)
          : entry.kind === "SUPPLIER"
            ? await restoreSupplier(tx, payload as SupplierPayload)
            : await restoreStockEntry(tx, payload as StockPayload);
      await tx.recycleBinEntry.delete({ where: { id } });
      return { kind: entry.kind as BinKind, label: entry.label, path };
    });
  } catch (error) {
    if (error instanceof RestoreError) throw error;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2003")
    ) {
      throw new RestoreError(
        "Something it depends on has changed since it was deleted, so it can't be restored.",
      );
    }
    throw error;
  }
}

// -------------------------------------------------------------- list / purge

function isExpired(deletedAt: Date) {
  return Date.now() - deletedAt.getTime() > BIN_MS;
}

export async function purgeExpiredBin() {
  const { count } = await prisma.recycleBinEntry.deleteMany({
    where: { deletedAt: { lt: new Date(Date.now() - BIN_MS) } },
  });
  return count;
}

export async function listBin() {
  await purgeExpiredBin();
  const rows = await prisma.recycleBinEntry.findMany({
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      kind: true,
      label: true,
      detail: true,
      deletedAt: true,
      deletedByName: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    expiresAt: new Date(row.deletedAt.getTime() + BIN_MS).toISOString(),
  }));
}

/** Clears expired entries now and every hour. */
export function startRecycleBinPurge() {
  const run = () =>
    purgeExpiredBin().catch((error) => console.warn("[recycle-bin] purge failed:", error));
  void run();
  setInterval(run, 60 * 60 * 1000).unref();
}
