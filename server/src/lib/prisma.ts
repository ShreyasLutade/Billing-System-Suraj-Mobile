import path from "path";
import { PrismaClient } from "@prisma/client";
import { demoEnabled, isDemoRequest } from "./tenant";

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

const mainClient =
  globalForPrisma.prisma && isClientCurrent(globalForPrisma.prisma)
    ? globalForPrisma.prisma
    : createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = mainClient;
}

/** The shop's real database, whatever request is running (startup jobs). */
export const mainPrisma = mainClient;

/**
 * Demo database: a separate SQLite file next to the real one (or
 * DEMO_DATABASE_URL). Null when the real database isn't SQLite or the demo
 * is off.
 */
export function demoDatabaseUrl(): string | null {
  if (!demoEnabled()) return null;
  if (process.env.DEMO_DATABASE_URL) return process.env.DEMO_DATABASE_URL;
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url.toLowerCase().startsWith("file:")) return null;
  let filePart = url.slice("file:".length).split("?")[0];
  if (filePart.startsWith("//")) filePart = filePart.replace(/^\/\/(localhost)?/, "");
  // Prisma reads relative paths from the prisma/ folder.
  const abs = path.isAbsolute(filePart)
    ? filePart
    : path.resolve(__dirname, "../../prisma", filePart);
  return `file:${path.join(path.dirname(abs), "demo.db")}`;
}

let demoClient: PrismaClient | null = null;
export function demoPrisma(): PrismaClient {
  const url = demoDatabaseUrl();
  if (!url) throw new Error("Demo database is not available");
  if (!demoClient) {
    demoClient = new PrismaClient({
      datasources: { db: { url } },
      log: ["error"],
    });
  }
  return demoClient;
}

/**
 * Every route uses this. It is the real database, except while handling a
 * request from the demo login, when it is the demo database.
 */
export const prisma = new Proxy(mainClient, {
  get(target, prop) {
    const client = isDemoRequest() ? demoPrisma() : target;
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as PrismaClient;
