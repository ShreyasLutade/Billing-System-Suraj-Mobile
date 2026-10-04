import type { PrismaClient } from "@prisma/client";

/**
 * Repair counters. Each has its own jobs, job-number series and staff view.
 *  - NX: Babu Mobile NX's own repair desk (everyone with full access).
 *  - LK: Luckey's repair shop — repair-only accounts tied to it see nothing else.
 */
export const REPAIR_SHOPS = {
  NX: { label: "Babu Mobile NX", jobPrefix: "BMR-NX-", sequenceId: 3 },
  LK: { label: "Luckey", jobPrefix: "BMR-", sequenceId: 4 },
} as const;

export type RepairShop = keyof typeof REPAIR_SHOPS;

/** Shop for staff/admins with full access, and for jobs created before shops existed. */
export const DEFAULT_REPAIR_SHOP: RepairShop = "NX";

export const ALL_REPAIR_SHOPS = Object.keys(REPAIR_SHOPS) as RepairShop[];

export function isRepairShop(value: unknown): value is RepairShop {
  return typeof value === "string" && value in REPAIR_SHOPS;
}

type ShopUser = { role: string; repairShop: string | null };

/**
 * Repair shops a user may see:
 *  - repair-only account → just its own shop;
 *  - admin with full access → every shop;
 *  - staff → the main shop only.
 */
export function visibleRepairShops(user: ShopUser): RepairShop[] {
  if (user.repairShop) return isRepairShop(user.repairShop) ? [user.repairShop] : [];
  return user.role === "ADMIN" ? ALL_REPAIR_SHOPS : [DEFAULT_REPAIR_SHOP];
}

/** Shop new jobs from this user belong to. */
export function homeRepairShop(user: ShopUser): RepairShop {
  return isRepairShop(user.repairShop) ? user.repairShop : DEFAULT_REPAIR_SHOP;
}

/** "BMR-NX-0007" / "BMR-0007". */
export function repairJobNumber(shop: RepairShop, counter: number) {
  return `${REPAIR_SHOPS[shop].jobPrefix}${String(counter).padStart(4, "0")}`;
}

/**
 * One-time rename when shops were introduced: the main shop's old numbers
 * "BMR-0003" become "BMR-NX-0003" (same counter, so numbering continues),
 * freeing "BMR-xxxx" for Luckey's shop. Safe to run on every start.
 */
export async function migrateRepairJobNumbers(db: PrismaClient) {
  const legacy = await db.repairJob.findMany({
    where: { shop: DEFAULT_REPAIR_SHOP, NOT: { jobNumber: { startsWith: REPAIR_SHOPS.NX.jobPrefix } } },
    select: { id: true, jobNumber: true },
  });
  let renamed = 0;
  for (const job of legacy) {
    const match = /^BMR-(\d+)$/.exec(job.jobNumber);
    if (!match) continue;
    await db.repairJob.update({
      where: { id: job.id },
      data: { jobNumber: `${REPAIR_SHOPS.NX.jobPrefix}${match[1]}` },
    });
    renamed += 1;
  }
  return renamed;
}
