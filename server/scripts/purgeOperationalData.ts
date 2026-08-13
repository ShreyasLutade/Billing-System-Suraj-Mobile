/**
 * Production cleanup: keep GST bills + shop bills 0014 / 0031 / 0032.
 *
 *   npx tsx scripts/purgeOperationalData.ts
 *   npx tsx scripts/purgeOperationalData.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { purgeOperationalData } from "../src/services/purgeOperationalData";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const result = await purgeOperationalData(prisma, { apply: APPLY });
  console.log(JSON.stringify(result, null, 2));
  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to execute.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
