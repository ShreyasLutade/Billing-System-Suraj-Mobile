/**
 * One-off helper for Gurunanak 10 Sep purchase (NEW → USED).
 *
 * Prefer the startup backfill / admin API in production.
 * Local / railway shell:
 *   npx tsx scripts/fix-gurunanak-sep10-to-used.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { fixGurunanakSep10PurchaseToUsed } from "../src/services/fixPurchaseCondition";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  if (!APPLY) {
    const purchase = await prisma.purchase.findUnique({
      where: { id: "cmtvrhss800c2hv6gqstc7iul" },
      include: {
        supplier: { select: { name: true } },
        items: { include: { stockItem: true } },
      },
    });
    console.log(
      JSON.stringify(
        purchase
          ? {
              id: purchase.id,
              supplier: purchase.supplier.name,
              condition: purchase.condition,
              by: purchase.createdByName,
              items: purchase.items.map((i) => ({
                id: i.stockItem.id,
                name: i.stockItem.mobileName,
                condition: i.stockItem.condition,
                status: i.stockItem.status,
              })),
            }
          : null,
        null,
        2,
      ),
    );
    console.log("Dry-run. Re-run with --apply to update.");
    return;
  }

  const result = await fixGurunanakSep10PurchaseToUsed(prisma);
  console.log(result);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
