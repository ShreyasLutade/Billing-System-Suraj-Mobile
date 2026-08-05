import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

function parseSupplierNames(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeSupplierName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

/** Create Supplier rows from legacy free-text stock.suppliers and link stockItem.supplierId. */
export async function backfillSuppliersFromStock(prisma: PrismaClient) {
  const items = await prisma.stockItem.findMany({
    where: { supplierId: null },
    select: { id: true, suppliers: true },
  });

  if (!items.length) return { linked: 0, created: 0 };

  const nameCache = new Map<string, string>();
  let created = 0;
  let linked = 0;

  for (const item of items) {
    const names = parseSupplierNames(item.suppliers);
    const primary = names[0] ? normalizeSupplierName(names[0]) : null;
    if (!primary) continue;

    const key = primary.toLowerCase();
    let supplierId = nameCache.get(key);

    if (!supplierId) {
      const existing = await prisma.supplier.findFirst({
        where: { name: { equals: primary } },
      });
      if (existing) {
        supplierId = existing.id;
      } else {
        const supplier = await prisma.supplier.create({
          data: { name: primary },
        });
        supplierId = supplier.id;
        created += 1;
      }
      nameCache.set(key, supplierId);
    }

    await prisma.stockItem.update({
      where: { id: item.id },
      data: { supplierId },
    });
    linked += 1;
  }

  return { linked, created };
}

export async function upsertSupplierByName(
  prisma: Db,
  name: string,
  extras?: { phone?: string | null; address?: string | null; notes?: string | null },
) {
  const normalized = normalizeSupplierName(name);
  if (!normalized) {
    throw new Error("SUPPLIER_NAME_REQUIRED");
  }

  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: normalized } },
  });
  if (existing) {
    if (extras && (extras.phone || extras.address || extras.notes)) {
      return prisma.supplier.update({
        where: { id: existing.id },
        data: {
          phone: extras.phone ?? existing.phone,
          address: extras.address ?? existing.address,
          notes: extras.notes ?? existing.notes,
        },
      });
    }
    return existing;
  }

  return prisma.supplier.create({
    data: {
      name: normalized,
      phone: extras?.phone || null,
      address: extras?.address || null,
      notes: extras?.notes || null,
    },
  });
}
