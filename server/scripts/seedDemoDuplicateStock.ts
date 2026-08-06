/**
 * Add duplicate stock configs so Stock page shows Qty 2+.
 * Run: npx tsx scripts/seedDemoDuplicateStock.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function serializeSuppliers(names: string[]) {
  return JSON.stringify(names.map((n) => n.trim()).filter(Boolean));
}

type UnitInput = {
  platform: "IOS" | "ANDROID";
  mobileName: string;
  storage: string;
  ram: string;
  color: string;
  imei: string;
  purchasePrice: number;
};

async function main() {
  const supplier = await prisma.supplier.upsert({
    where: { name: "Bulk Match Traders" },
    create: {
      name: "Bulk Match Traders",
      phone: "9876503001",
      address: "Market Yard",
      notes: "Demo seed supplier",
    },
    update: {
      phone: "9876503001",
      notes: "Demo seed supplier",
    },
  });

  // Identical configs (same name/color/storage/RAM) → Qty groups on Stock page
  const duplicateLots: Array<{
    condition: "NEW" | "USED";
    note: string;
    daysAgo: number;
    units: UnitInput[];
  }> = [
    {
      condition: "NEW",
      note: "Demo duplicate iPhone 16 Black 128",
      daysAgo: 2,
      units: [
        {
          platform: "IOS",
          mobileName: "iPhone 16",
          storage: "128 GB",
          ram: "",
          color: "Black",
          imei: "359900000001001",
          purchasePrice: 72000,
        },
        {
          platform: "IOS",
          mobileName: "iPhone 16",
          storage: "128 GB",
          ram: "",
          color: "Black",
          imei: "359900000001002",
          purchasePrice: 71500,
        },
        {
          platform: "IOS",
          mobileName: "iPhone 16",
          storage: "128 GB",
          ram: "",
          color: "Black",
          imei: "359900000001003",
          purchasePrice: 72000,
        },
      ],
    },
    {
      condition: "NEW",
      note: "Demo duplicate S24 Ultra 256/12",
      daysAgo: 2,
      units: [
        {
          platform: "ANDROID",
          mobileName: "Samsung Galaxy S24 Ultra",
          storage: "256 GB",
          ram: "12 GB",
          color: "Titanium Gray",
          imei: "359900000001011",
          purchasePrice: 98000,
        },
        {
          platform: "ANDROID",
          mobileName: "Samsung Galaxy S24 Ultra",
          storage: "256 GB",
          ram: "12 GB",
          color: "Titanium Gray",
          imei: "359900000001012",
          purchasePrice: 97500,
        },
      ],
    },
    {
      condition: "NEW",
      note: "Demo duplicate Redmi Note 14",
      daysAgo: 1,
      units: [
        {
          platform: "ANDROID",
          mobileName: "Redmi Note 14 5G",
          storage: "128 GB",
          ram: "8 GB",
          color: "Green",
          imei: "359900000001021",
          purchasePrice: 14500,
        },
        {
          platform: "ANDROID",
          mobileName: "Redmi Note 14 5G",
          storage: "128 GB",
          ram: "8 GB",
          color: "Green",
          imei: "359900000001022",
          purchasePrice: 14500,
        },
        {
          platform: "ANDROID",
          mobileName: "Redmi Note 14 5G",
          storage: "128 GB",
          ram: "8 GB",
          color: "Green",
          imei: "359900000001023",
          purchasePrice: 14200,
        },
        {
          platform: "ANDROID",
          mobileName: "Redmi Note 14 5G",
          storage: "128 GB",
          ram: "8 GB",
          color: "Green",
          imei: "359900000001024",
          purchasePrice: 14500,
        },
      ],
    },
    {
      condition: "USED",
      note: "Demo duplicate used iPhone 13",
      daysAgo: 3,
      units: [
        {
          platform: "IOS",
          mobileName: "iPhone 13",
          storage: "128 GB",
          ram: "",
          color: "Midnight",
          imei: "359900000001031",
          purchasePrice: 28000,
        },
        {
          platform: "IOS",
          mobileName: "iPhone 13",
          storage: "128 GB",
          ram: "",
          color: "Midnight",
          imei: "359900000001032",
          purchasePrice: 27500,
        },
      ],
    },
  ];

  let createdUnits = 0;
  let skipped = 0;

  for (const lot of duplicateLots) {
    const purchaseDate = new Date();
    purchaseDate.setDate(purchaseDate.getDate() - lot.daysAgo);
    purchaseDate.setHours(10, 15, 0, 0);

    const toCreate: UnitInput[] = [];
    for (const unit of lot.units) {
      const exists = await prisma.stockItem.findUnique({
        where: { imei: unit.imei },
      });
      if (exists) {
        skipped += 1;
        continue;
      }
      toCreate.push(unit);
    }
    if (!toCreate.length) continue;

    const totalAmount = toCreate.reduce((s, u) => s + u.purchasePrice, 0);

    await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          supplierId: supplier.id,
          condition: lot.condition,
          note: lot.note,
          totalAmount,
          purchaseDate,
          paidAt: null,
        },
      });

      for (const unit of toCreate) {
        const stock = await tx.stockItem.create({
          data: {
            condition: lot.condition,
            platform: unit.platform,
            mobileName: unit.mobileName,
            storage: unit.storage,
            ram: unit.platform === "ANDROID" ? unit.ram : "",
            color: unit.color,
            imei: unit.imei,
            purchasePrice: unit.purchasePrice,
            suppliers: serializeSuppliers([supplier.name]),
            supplierId: supplier.id,
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
        createdUnits += 1;
      }
    });
  }

  // Also duplicate an existing Suraj config if still available (iPhone 16 Pro Natural Titanium 256)
  // Add a twin so Suraj Wholesale shows qty 2 for that config when both available.
  const twinImei = "359900000001041";
  const twinExists = await prisma.stockItem.findUnique({ where: { imei: twinImei } });
  const suraj = await prisma.supplier.findFirst({
    where: { name: "Suraj Wholesale Mart" },
  });
  if (!twinExists && suraj) {
    const purchaseDate = new Date();
    purchaseDate.setDate(purchaseDate.getDate() - 3);
    await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          supplierId: suraj.id,
          condition: "NEW",
          note: "Demo twin iPhone 16 Pro",
          totalAmount: 118000,
          purchaseDate,
          paidAt: null,
        },
      });
      const stock = await tx.stockItem.create({
        data: {
          condition: "NEW",
          platform: "IOS",
          mobileName: "iPhone 16 Pro",
          storage: "256 GB",
          ram: "",
          color: "Natural Titanium",
          imei: twinImei,
          purchasePrice: 118000,
          suppliers: serializeSuppliers([suraj.name]),
          supplierId: suraj.id,
          status: "AVAILABLE",
          createdAt: purchaseDate,
        },
      });
      await tx.purchaseItem.create({
        data: { purchaseId: purchase.id, stockItemId: stock.id },
      });
    });
    createdUnits += 1;
  }

  console.log(
    JSON.stringify(
      {
        supplier: supplier.name,
        createdUnits,
        skipped,
        tip: "Open Stock → New: iPhone 16 Black 128 (qty 3), S24 Ultra (qty 2), Redmi Note 14 (qty 4). Second hand: iPhone 13 Midnight (qty 2).",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
