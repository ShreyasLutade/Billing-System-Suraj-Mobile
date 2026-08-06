import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeCapacity } from "../lib/capacity";

type Db = PrismaClient | Prisma.TransactionClient;

export type MobileCatalogInput = {
  name: string;
  platform: "IOS" | "ANDROID";
  condition: "NEW" | "USED";
  color: string;
  storage: string;
  ram?: string | null;
};

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function capitalizeFirst(value: string) {
  const normalized = clean(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function normalizeMobileCatalogValues(input: MobileCatalogInput) {
  return {
    name: capitalizeFirst(input.name),
    platform: input.platform,
    condition: input.condition,
    color: capitalizeFirst(input.color),
    storage: normalizeCapacity(input.storage),
    ram:
      input.platform === "ANDROID"
        ? normalizeCapacity(input.ram || "")
        : "",
  };
}

export async function upsertMobileCatalog(db: Db, input: MobileCatalogInput) {
  const values = normalizeMobileCatalogValues(input);
  const existing = await db.mobileCatalog.findFirst({ where: values });
  if (existing) {
    return { mobile: existing, created: false as const };
  }
  const mobile = await db.mobileCatalog.create({ data: values });
  return { mobile, created: true as const };
}
