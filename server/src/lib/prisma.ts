import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function isClientCurrent(client: PrismaClient) {
  // After `prisma generate`, tsx may keep an old singleton without new models.
  return Boolean((client as { phoneModel?: unknown }).phoneModel);
}

const existing = globalForPrisma.prisma;
if (existing && !isClientCurrent(existing)) {
  void existing.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = undefined;
}

export const prisma =
  globalForPrisma.prisma && isClientCurrent(globalForPrisma.prisma)
    ? globalForPrisma.prisma
    : createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
