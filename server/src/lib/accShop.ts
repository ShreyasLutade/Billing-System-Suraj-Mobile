import type { NextFunction, Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { endOfDayIST, istDateString, startOfDayIST } from "./ist";

/**
 * Accessories shop: a separate counter (quick retail + wholesale on credit).
 * Every admin of the Babu shop can open it, plus these logins. Set
 * ACCESSORIES_SHOP_PHONES="7038006342,7581817575" to let more staff in.
 */
export const ACC_PHONES = (process.env.ACCESSORIES_SHOP_PHONES || "7038006342")
  .split(",")
  .map((phone) => phone.trim())
  .filter(Boolean);

export function canUseAccessories(user: { phone: string; role: string; repairShop: string | null } | undefined) {
  return Boolean(user && !user.repairShop && (user.role === "ADMIN" || ACC_PHONES.includes(user.phone)));
}

export function requireAccessories(req: Request, res: Response, next: NextFunction) {
  if (!canUseAccessories(req.user)) {
    res.status(403).json({ error: "The accessories shop is not open for this account" });
    return;
  }
  next();
}

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/* ---------------- IST date ranges (server runs in UTC) ---------------- */

export const ACC_PERIODS = ["today", "yesterday", "week", "month", "last30", "all", "custom"] as const;
export type AccPeriod = (typeof ACC_PERIODS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

function istWeekday(date: Date) {
  // 0 = Monday … 6 = Sunday
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(date);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);
}

/** yyyy-mm-dd → start / end of that IST day. */
function istDay(value: unknown, end: boolean) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function accRange(query: Record<string, unknown>, fallback: AccPeriod = "today") {
  const raw = String(query.period || fallback);
  const period: AccPeriod = (ACC_PERIODS as readonly string[]).includes(raw) ? (raw as AccPeriod) : fallback;
  const now = new Date();
  let from: Date | null = null;
  let to: Date | null = null;
  let label = "";
  switch (period) {
    case "today":
      from = startOfDayIST(now);
      to = endOfDayIST(now);
      label = "Today";
      break;
    case "yesterday": {
      const day = new Date(now.getTime() - DAY_MS);
      from = startOfDayIST(day);
      to = endOfDayIST(day);
      label = "Yesterday";
      break;
    }
    case "week":
      from = startOfDayIST(new Date(now.getTime() - istWeekday(now) * DAY_MS));
      to = endOfDayIST(now);
      label = "This week";
      break;
    case "month":
      from = new Date(`${istDateString(now).slice(0, 8)}01T00:00:00.000+05:30`);
      to = endOfDayIST(now);
      label = "This month";
      break;
    case "last30":
      from = startOfDayIST(new Date(now.getTime() - 29 * DAY_MS));
      to = endOfDayIST(now);
      label = "Last 30 days";
      break;
    case "custom":
      from = istDay(query.from, false);
      to = istDay(query.to, true);
      label = [query.from, query.to].filter(Boolean).join(" to ") || "Custom";
      break;
    case "all":
      label = "All time";
      break;
  }
  const filter: Prisma.DateTimeFilter | undefined =
    from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
  return { period, from, to, label, filter };
}

/* ---------------- bill numbers ---------------- */

export async function nextAccNumber(tx: Prisma.TransactionClient, kind: "RETAIL" | "WHOLESALE") {
  const row = await tx.accCounter.upsert({
    where: { key: kind },
    create: { key: kind, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${kind === "RETAIL" ? "AR" : "AW"}-${String(row.value).padStart(4, "0")}`;
}

export function parseQuickPrices(raw: string | null | undefined): number[] {
  try {
    const list = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(list)
      ? list.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

/** Starter tiles so the counter isn't empty on day one. */
export const DEFAULT_ACC_CATEGORIES: Array<{ name: string; drillBy: "TYPE" | "BRAND"; icon: string }> = [
  { name: "Cover", drillBy: "TYPE", icon: "smartphone" },
  { name: "Glass", drillBy: "TYPE", icon: "shield" },
  { name: "Headphone", drillBy: "BRAND", icon: "headphones" },
  { name: "Neckband", drillBy: "BRAND", icon: "neckband" },
  { name: "Earbuds", drillBy: "BRAND", icon: "ear" },
  { name: "Charger", drillBy: "BRAND", icon: "plug" },
  { name: "Cable", drillBy: "BRAND", icon: "cable" },
  { name: "Speaker", drillBy: "BRAND", icon: "speaker" },
  { name: "Power bank", drillBy: "BRAND", icon: "battery" },
  { name: "Smart watch", drillBy: "BRAND", icon: "watch" },
];

/**
 * Take `qty` pieces off a product (not below zero). Pieces sorted by phone
 * brand can't add up to more than the stock, so the brand split is trimmed
 * too, largest brand first. Returns how many pieces actually came off.
 */
export async function takeStockOff(tx: Prisma.TransactionClient, productId: string, qty: number) {
  const product = await tx.accProduct.findUnique({ where: { id: productId }, include: { models: true } });
  if (!product || qty <= 0) return 0;
  const next = Math.max(0, product.stockQty - qty);
  await tx.accProduct.update({ where: { id: productId }, data: { stockQty: next } });
  let over = product.models.reduce((a, m) => a + m.qty, 0) - next;
  for (const m of [...product.models].sort((a, b) => b.qty - a.qty)) {
    if (over <= 0) break;
    const cut = Math.min(m.qty, over);
    await tx.accProductModel.update({ where: { id: m.id }, data: { qty: m.qty - cut } });
    over -= cut;
  }
  return product.stockQty - next;
}
