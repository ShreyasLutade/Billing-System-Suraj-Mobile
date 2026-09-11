import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      _count: { select: { stockItems: true, purchases: true } },
    },
  });
  console.log("SUPPLIERS");
  for (const s of suppliers) {
    console.log(
      `- ${s.name} | stock=${s._count.stockItems} purchases=${s._count.purchases}`,
    );
  }

  const stock = await prisma.stockItem.findMany({
    where: { NOT: { kind: "ACCESSORY" } },
    select: {
      mobileName: true,
      suppliers: true,
      supplierId: true,
      status: true,
      purchasePrice: true,
    },
  });
  console.log(`\nMOBILE STOCK UNITS: ${stock.length}`);
  const bySupplierJson = new Map<string, number>();
  for (const row of stock) {
    let names: string[] = [];
    try {
      const parsed = JSON.parse(row.suppliers);
      if (Array.isArray(parsed)) names = parsed.map(String);
    } catch {
      // ignore
    }
    const key = names.join(", ") || "(none)";
    bySupplierJson.set(key, (bySupplierJson.get(key) || 0) + 1);
  }
  console.log("By legacy suppliers JSON:");
  for (const [k, n] of [...bySupplierJson.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${k}: ${n}`);
  }

  const tallyish = stock.filter((row) =>
    `${row.suppliers} ${row.mobileName}`.toLowerCase().includes("tally"),
  );
  console.log(`\nRows mentioning 'tally': ${tallyish.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
