import fs from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";

export const KEEP_NORMAL_SUFFIXES = ["0014", "0031", "0032"] as const;
export const PURGE_CONFIRM = "KEEP_GST_AND_0014_0031_0032";

function normalSuffix(invoiceNumber: string) {
  const match = invoiceNumber.trim().match(/-(\d+)$/);
  if (!match) return null;
  return match[1].padStart(4, "0");
}

export function shouldKeepBill(bill: {
  withGst: boolean;
  invoiceNumber: string;
}) {
  if (bill.withGst) return true;
  const suffix = normalSuffix(bill.invoiceNumber);
  return Boolean(
    suffix && (KEEP_NORMAL_SUFFIXES as readonly string[]).includes(suffix),
  );
}

function sqliteFilePath(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) return null;
  const raw = databaseUrl.slice("file:".length);
  if (raw.startsWith("/")) return raw;
  return path.resolve(process.cwd(), raw);
}

export function backupSqliteFile() {
  const databaseUrl = process.env.DATABASE_URL || "";
  const dbFile = sqliteFilePath(databaseUrl);
  if (!dbFile || !fs.existsSync(dbFile)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbFile}.keep-gst-backup-${stamp}`;
  fs.copyFileSync(dbFile, backupPath);
  for (const extra of [`${dbFile}-wal`, `${dbFile}-shm`]) {
    if (fs.existsSync(extra)) {
      fs.copyFileSync(extra, `${backupPath}${extra.slice(dbFile.length)}`);
    }
  }
  return backupPath;
}

export async function planOperationalPurge(prisma: PrismaClient) {
  const [bills, stock, suppliers, purchases, payments, customers] =
    await Promise.all([
      prisma.bill.findMany({
        select: {
          id: true,
          invoiceNumber: true,
          withGst: true,
          customerName: true,
        },
        orderBy: { invoiceNumber: "asc" },
      }),
      prisma.stockItem.count(),
      prisma.supplier.count(),
      prisma.purchase.count(),
      prisma.supplierPayment.count(),
      prisma.customer.count(),
    ]);

  const keep = bills.filter(shouldKeepBill);
  const remove = bills.filter((bill) => !shouldKeepBill(bill));
  const gstKeep = keep.filter((bill) => bill.withGst);
  const shopKeep = keep.filter((bill) => !bill.withGst);
  const missingShopBills = KEEP_NORMAL_SUFFIXES.filter(
    (suffix) =>
      !shopKeep.some((bill) => normalSuffix(bill.invoiceNumber) === suffix),
  );

  return {
    keep,
    remove,
    gstKeep,
    shopKeep,
    missingShopBills,
    counts: {
      bills: bills.length,
      keep: keep.length,
      remove: remove.length,
      stock,
      suppliers,
      purchases,
      payments,
      customers,
    },
  };
}

function summarizeBills(
  rows: Array<{
    invoiceNumber: string;
    withGst: boolean;
    customerName: string;
  }>,
) {
  return rows.map((bill) => ({
    invoiceNumber: bill.invoiceNumber,
    withGst: bill.withGst,
    customerName: bill.customerName,
  }));
}

export async function purgeOperationalData(
  prisma: PrismaClient,
  options: { apply: boolean },
) {
  const plan = await planOperationalPurge(prisma);
  const preview = {
    apply: options.apply,
    keepGst: summarizeBills(plan.gstKeep),
    keepShop: summarizeBills(plan.shopKeep),
    deleteBills: summarizeBills(plan.remove),
    missingShopBills: plan.missingShopBills,
    counts: plan.counts,
    backupPath: null as string | null,
  };

  if (!options.apply) return preview;

  if (plan.missingShopBills.length) {
    throw new Error(
      `Missing shop bills to keep: ${plan.missingShopBills.join(", ")}`,
    );
  }

  preview.backupPath = backupSqliteFile();
  const keepIds = plan.keep.map((bill) => bill.id);
  const removeIds = plan.remove.map((bill) => bill.id);

  await prisma.$transaction(async (tx) => {
    if (keepIds.length) {
      await tx.billItem.updateMany({
        where: { billId: { in: keepIds }, stockItemId: { not: null } },
        data: { stockItemId: null },
      });
    }
    if (removeIds.length) {
      await tx.bill.deleteMany({ where: { id: { in: removeIds } } });
    }
    await tx.purchaseItem.deleteMany({});
    await tx.stockItem.deleteMany({});
    await tx.purchase.deleteMany({});
    await tx.supplierPayment.deleteMany({});
    await tx.supplier.deleteMany({});
    await tx.customer.deleteMany({});

    const keptBills = await tx.bill.findMany({
      select: {
        customerPhone: true,
        customerName: true,
        customerAddress: true,
      },
    });
    const byPhone = new Map<
      string,
      { phone: string; name: string; address: string | null }
    >();
    for (const bill of keptBills) {
      const phone = bill.customerPhone.trim();
      if (!phone || byPhone.has(phone)) continue;
      byPhone.set(phone, {
        phone,
        name: bill.customerName,
        address: bill.customerAddress || null,
      });
    }
    for (const customer of byPhone.values()) {
      await tx.customer.create({ data: customer });
    }
  });

  const remaining = await prisma.bill.findMany({
    select: {
      invoiceNumber: true,
      withGst: true,
      customerName: true,
    },
    orderBy: { invoiceNumber: "asc" },
  });

  return {
    ...preview,
    remaining: summarizeBills(remaining),
    after: {
      bills: remaining.length,
      gst: remaining.filter((bill) => bill.withGst).length,
      shop: remaining.filter((bill) => !bill.withGst).length,
      stock: await prisma.stockItem.count(),
      suppliers: await prisma.supplier.count(),
      purchases: await prisma.purchase.count(),
      payments: await prisma.supplierPayment.count(),
      customers: await prisma.customer.count(),
    },
  };
}
