import type { PrismaClient, Prisma } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** Save / refresh customer profile for phone autofill (unique on phone). */
export async function upsertCustomerProfile(
  db: Db,
  input: {
    customerPhone: string;
    customerName: string;
    customerAddress?: string | null;
  },
) {
  const phone = input.customerPhone.replace(/\D/g, "").slice(0, 10);
  const name = input.customerName.trim().replace(/\s+/g, " ");
  const address = input.customerAddress?.trim() || null;
  if (phone.length !== 10 || !name) return null;

  return db.customer.upsert({
    where: { phone },
    create: { phone, name, address },
    update: { name, address },
  });
}
