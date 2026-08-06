/**
 * One-off demo seed: suppliers + single/bulk purchases (iOS + Android mix).
 * Run: npx tsx scripts/seedDemoSuppliers.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Unit = {
  platform: "IOS" | "ANDROID";
  mobileName: string;
  storage: string;
  ram: string;
  color: string;
  imei: string;
  purchasePrice: number;
};

function serializeSuppliers(names: string[]) {
  return JSON.stringify(names.map((n) => n.trim()).filter(Boolean));
}

async function ensureSupplier(input: {
  name: string;
  phone?: string;
  address?: string;
}) {
  return prisma.supplier.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      phone: input.phone || null,
      address: input.address || null,
      notes: "Demo seed supplier",
    },
    update: {
      phone: input.phone || null,
      address: input.address || null,
    },
  });
}

async function createPurchase(input: {
  supplierId: string;
  supplierName: string;
  condition: "NEW" | "USED";
  note: string;
  paid: boolean;
  daysAgo: number;
  units: Unit[];
}) {
  const purchaseDate = new Date();
  purchaseDate.setDate(purchaseDate.getDate() - input.daysAgo);
  purchaseDate.setHours(11, 30, 0, 0);

  const totalAmount = input.units.reduce((sum, u) => sum + u.purchasePrice, 0);

  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        supplierId: input.supplierId,
        condition: input.condition,
        note: input.note,
        totalAmount,
        purchaseDate,
        paidAt: input.paid ? purchaseDate : null,
      },
    });

    for (const unit of input.units) {
      const existing = await tx.stockItem.findUnique({
        where: { imei: unit.imei },
      });
      if (existing) continue;

      const stock = await tx.stockItem.create({
        data: {
          condition: input.condition,
          platform: unit.platform,
          mobileName: unit.mobileName,
          storage: unit.storage,
          ram: unit.platform === "ANDROID" ? unit.ram : "",
          color: unit.color,
          imei: unit.imei,
          purchasePrice: unit.purchasePrice,
          suppliers: serializeSuppliers([input.supplierName]),
          supplierId: input.supplierId,
          status: "AVAILABLE",
          createdAt: purchaseDate,
        },
      });
      await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          stockItemId: stock.id,
        },
      });
    }

    return purchase;
  });
}

async function main() {
  // --- Single-purchase suppliers ---
  const raj = await ensureSupplier({
    name: "Raj Mobile Hub",
    phone: "9876501001",
    address: "MG Road, Kolhapur",
  });
  const city = await ensureSupplier({
    name: "City Care Electronics",
    phone: "9876501002",
    address: "Shahupuri, Kolhapur",
  });
  const quick = await ensureSupplier({
    name: "Quick Fix Traders",
    phone: "9876501003",
    address: "Rajarampuri",
  });

  // --- Bulk suppliers ---
  const suraj = await ensureSupplier({
    name: "Suraj Wholesale Mart",
    phone: "9876502001",
    address: "Laxmipuri Market",
  });
  const deccan = await ensureSupplier({
    name: "Deccan Distributors",
    phone: "9876502002",
    address: "Station Road",
  });
  const appleZone = await ensureSupplier({
    name: "Apple Zone Supplies",
    phone: "9876502003",
    address: "Tarabai Park",
  });

  // Single: 1 new iPhone
  await createPurchase({
    supplierId: raj.id,
    supplierName: raj.name,
    condition: "NEW",
    note: "Demo single iOS",
    paid: true,
    daysAgo: 12,
    units: [
      {
        platform: "IOS",
        mobileName: "iPhone 15",
        storage: "128 GB",
        ram: "",
        color: "Blue",
        imei: "359900000000101",
        purchasePrice: 62000,
      },
    ],
  });

  // Single: 1 new Android
  await createPurchase({
    supplierId: city.id,
    supplierName: city.name,
    condition: "NEW",
    note: "Demo single Android",
    paid: false,
    daysAgo: 8,
    units: [
      {
        platform: "ANDROID",
        mobileName: "Samsung Galaxy S24",
        storage: "256 GB",
        ram: "8 GB",
        color: "Black",
        imei: "359900000000201",
        purchasePrice: 58000,
      },
    ],
  });

  // Single: 1 used iPhone
  await createPurchase({
    supplierId: quick.id,
    supplierName: quick.name,
    condition: "USED",
    note: "Demo single second-hand iOS",
    paid: true,
    daysAgo: 5,
    units: [
      {
        platform: "IOS",
        mobileName: "iPhone 13",
        storage: "128 GB",
        ram: "",
        color: "Midnight",
        imei: "359900000000301",
        purchasePrice: 28000,
      },
    ],
  });

  // Bulk: mixed iOS + Android — includes duplicates so Stock shows Qty 2+
  await createPurchase({
    supplierId: suraj.id,
    supplierName: suraj.name,
    condition: "NEW",
    note: "Demo bulk mixed lot",
    paid: false,
    daysAgo: 3,
    units: [
      {
        platform: "IOS",
        mobileName: "iPhone 16",
        storage: "128 GB",
        ram: "",
        color: "Black",
        imei: "359900000000401",
        purchasePrice: 72000,
      },
      {
        platform: "IOS",
        mobileName: "iPhone 16",
        storage: "128 GB",
        ram: "",
        color: "Black",
        imei: "359900000000406",
        purchasePrice: 71500,
      },
      {
        platform: "IOS",
        mobileName: "iPhone 16",
        storage: "128 GB",
        ram: "",
        color: "Black",
        imei: "359900000000407",
        purchasePrice: 72000,
      },
      {
        platform: "IOS",
        mobileName: "iPhone 16 Pro",
        storage: "256 GB",
        ram: "",
        color: "Natural Titanium",
        imei: "359900000000402",
        purchasePrice: 118000,
      },
      {
        platform: "IOS",
        mobileName: "iPhone 16 Pro",
        storage: "256 GB",
        ram: "",
        color: "Natural Titanium",
        imei: "359900000000408",
        purchasePrice: 117500,
      },
      {
        platform: "ANDROID",
        mobileName: "OnePlus 13 5G",
        storage: "256 GB",
        ram: "12 GB",
        color: "Black",
        imei: "359900000000403",
        purchasePrice: 64000,
      },
      {
        platform: "ANDROID",
        mobileName: "vivo V40 5G",
        storage: "256 GB",
        ram: "8 GB",
        color: "Blue",
        imei: "359900000000404",
        purchasePrice: 32000,
      },
      {
        platform: "ANDROID",
        mobileName: "Redmi Note 14 5G",
        storage: "128 GB",
        ram: "8 GB",
        color: "Green",
        imei: "359900000000405",
        purchasePrice: 14500,
      },
      {
        platform: "ANDROID",
        mobileName: "Redmi Note 14 5G",
        storage: "128 GB",
        ram: "8 GB",
        color: "Green",
        imei: "359900000000409",
        purchasePrice: 14500,
      },
      {
        platform: "ANDROID",
        mobileName: "Redmi Note 14 5G",
        storage: "128 GB",
        ram: "8 GB",
        color: "Green",
        imei: "359900000000410",
        purchasePrice: 14200,
      },
    ],
  });

  // Same bulk supplier: second purchase (USED mix) — includes duplicate config
  await createPurchase({
    supplierId: suraj.id,
    supplierName: suraj.name,
    condition: "USED",
    note: "Demo bulk second-hand mix",
    paid: true,
    daysAgo: 1,
    units: [
      {
        platform: "IOS",
        mobileName: "iPhone 14",
        storage: "128 GB",
        ram: "",
        color: "Purple",
        imei: "359900000000411",
        purchasePrice: 38000,
      },
      {
        platform: "IOS",
        mobileName: "iPhone 14",
        storage: "128 GB",
        ram: "",
        color: "Purple",
        imei: "359900000000414",
        purchasePrice: 37500,
      },
      {
        platform: "ANDROID",
        mobileName: "Google Pixel 8",
        storage: "128 GB",
        ram: "8 GB",
        color: "Obsidian",
        imei: "359900000000412",
        purchasePrice: 34000,
      },
      {
        platform: "ANDROID",
        mobileName: "Nothing Phone (2a)",
        storage: "128 GB",
        ram: "8 GB",
        color: "White",
        imei: "359900000000413",
        purchasePrice: 18000,
      },
    ],
  });

  // Bulk Android-only
  await createPurchase({
    supplierId: deccan.id,
    supplierName: deccan.name,
    condition: "NEW",
    note: "Demo bulk Android",
    paid: false,
    daysAgo: 6,
    units: [
      {
        platform: "ANDROID",
        mobileName: "Samsung Galaxy A55",
        storage: "256 GB",
        ram: "8 GB",
        color: "Navy",
        imei: "359900000000501",
        purchasePrice: 28000,
      },
      {
        platform: "ANDROID",
        mobileName: "OPPO Reno13 5G",
        storage: "256 GB",
        ram: "8 GB",
        color: "Gold",
        imei: "359900000000502",
        purchasePrice: 30000,
      },
      {
        platform: "ANDROID",
        mobileName: "Motorola Edge 50 Fusion",
        storage: "256 GB",
        ram: "8 GB",
        color: "Forest",
        imei: "359900000000503",
        purchasePrice: 21000,
      },
      {
        platform: "ANDROID",
        mobileName: "Infinix Note 40 5G",
        storage: "256 GB",
        ram: "8 GB",
        color: "Black",
        imei: "359900000000504",
        purchasePrice: 12000,
      },
      {
        platform: "ANDROID",
        mobileName: "Samsung Galaxy S25",
        storage: "256 GB",
        ram: "12 GB",
        color: "Silver",
        imei: "359900000000505",
        purchasePrice: 74000,
      },
      {
        platform: "ANDROID",
        mobileName: "OnePlus Nord CE 4 5G",
        storage: "128 GB",
        ram: "8 GB",
        color: "Grey",
        imei: "359900000000506",
        purchasePrice: 22000,
      },
    ],
  });

  // Bulk iOS-only
  await createPurchase({
    supplierId: appleZone.id,
    supplierName: appleZone.name,
    condition: "NEW",
    note: "Demo bulk iOS",
    paid: true,
    daysAgo: 4,
    units: [
      {
        platform: "IOS",
        mobileName: "iPhone 17",
        storage: "256 GB",
        ram: "",
        color: "White",
        imei: "359900000000601",
        purchasePrice: 82000,
      },
      {
        platform: "IOS",
        mobileName: "iPhone 17 Pro",
        storage: "256 GB",
        ram: "",
        color: "Cosmic Orange",
        imei: "359900000000602",
        purchasePrice: 125000,
      },
      {
        platform: "IOS",
        mobileName: "iPhone 17 Pro Max",
        storage: "512 GB",
        ram: "",
        color: "Deep Blue",
        imei: "359900000000603",
        purchasePrice: 155000,
      },
      {
        platform: "IOS",
        mobileName: "iPhone Air",
        storage: "256 GB",
        ram: "",
        color: "Sky",
        imei: "359900000000604",
        purchasePrice: 95000,
      },
      {
        platform: "IOS",
        mobileName: "iPhone 15 Pro",
        storage: "256 GB",
        ram: "",
        color: "Blue Titanium",
        imei: "359900000000605",
        purchasePrice: 98000,
      },
    ],
  });

  const suppliers = await prisma.supplier.count({
    where: { notes: "Demo seed supplier" },
  });
  const stock = await prisma.stockItem.count({
    where: { imei: { startsWith: "359900000000" } },
  });
  const purchases = await prisma.purchase.count({
    where: { note: { startsWith: "Demo" } },
  });

  console.log(
    JSON.stringify(
      {
        demoSuppliers: suppliers,
        demoPurchases: purchases,
        demoStockUnits: stock,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
