import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { accRange, round2 } from "../../lib/accShop";
import { istDateString } from "../../lib/ist";
import { customerBalances } from "../../services/accDues";
import { renderAccPdf, rs, sendPdf } from "../../services/accPdf";
import { money } from "../../services/pdf";

export const accAnalyticsRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

function istHour(date: Date) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(date),
  ) % 24;
}

async function salesIn(filter: { gte?: Date; lte?: Date } | undefined) {
  return prisma.accSale.findMany({
    where: { voidedAt: null, ...(filter ? { saleDate: filter } : {}) },
    select: {
      id: true,
      kind: true,
      saleDate: true,
      total: true,
      costTotal: true,
      discount: true,
      cashAmount: true,
      onlineAmount: true,
      dueAmount: true,
      createdByName: true,
      customerId: true,
      customer: { select: { name: true, shopName: true, group: { select: { id: true, name: true, color: true } } } },
      items: { select: { productId: true, name: true, categoryName: true, qty: true, amount: true, unitCost: true } },
    },
    orderBy: { saleDate: "asc" },
  });
}

export async function buildAccAnalytics(query: Record<string, unknown>) {
  const range = accRange(query, "month");
  const sales = await salesIn(range.filter as { gte?: Date; lte?: Date } | undefined);

  const sum = (list: typeof sales, fn: (s: (typeof sales)[number]) => number) =>
    round2(list.reduce((a, s) => a + fn(s), 0));
  const retail = sales.filter((s) => s.kind === "RETAIL");
  const wholesale = sales.filter((s) => s.kind === "WHOLESALE");
  const revenue = sum(sales, (s) => s.total);
  const profit = sum(sales, (s) => s.total - s.costTotal);
  const pieces = sales.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0);

  // Same-length window right before this one, for the growth arrow.
  let previous: { revenue: number; profit: number; bills: number } | null = null;
  if (range.from && range.to) {
    const span = range.to.getTime() - range.from.getTime();
    const prev = await salesIn({ gte: new Date(range.from.getTime() - span - 1), lte: new Date(range.from.getTime() - 1) });
    previous = {
      revenue: sum(prev, (s) => s.total),
      profit: sum(prev, (s) => s.total - s.costTotal),
      bills: prev.length,
    };
  }

  const paymentsIn = await prisma.accPayment.aggregate({
    where: { ...(range.filter ? { paidAt: range.filter } : {}), NOT: { method: "DISCOUNT" } },
    _sum: { amount: true },
  });

  // Trend: by day, or by month for long ranges.
  const first = sales[0]?.saleDate;
  const spanDays = range.from && range.to ? (range.to.getTime() - range.from.getTime()) / DAY_MS : first ? (Date.now() - first.getTime()) / DAY_MS : 0;
  const byMonth = spanDays > 62;
  const trendMap = new Map<string, { key: string; retail: number; wholesale: number; profit: number }>();
  if (!byMonth && range.from && range.to) {
    for (let t = range.from.getTime(); t <= range.to.getTime(); t += DAY_MS) {
      const key = istDateString(new Date(t));
      trendMap.set(key, { key, retail: 0, wholesale: 0, profit: 0 });
    }
  }
  for (const s of sales) {
    const day = istDateString(s.saleDate);
    const key = byMonth ? day.slice(0, 7) : day;
    const row = trendMap.get(key) || { key, retail: 0, wholesale: 0, profit: 0 };
    if (s.kind === "RETAIL") row.retail = round2(row.retail + s.total);
    else row.wholesale = round2(row.wholesale + s.total);
    row.profit = round2(row.profit + s.total - s.costTotal);
    trendMap.set(key, row);
  }

  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, bills: 0, revenue: 0 }));
  for (const s of retail) {
    const h = hours[istHour(s.saleDate)];
    h.bills += 1;
    h.revenue = round2(h.revenue + s.total);
  }

  const cat = new Map<string, { name: string; qty: number; revenue: number; profit: number }>();
  const prod = new Map<string, { productId: string | null; name: string; category: string; qty: number; revenue: number; profit: number }>();
  for (const s of sales) {
    // Bill discount spread over its lines so category totals add up to revenue.
    const gross = s.items.reduce((a, i) => a + i.amount, 0) || 1;
    const factor = (gross - s.discount) / gross;
    for (const i of s.items) {
      const amount = i.amount * factor;
      const p = amount - i.qty * i.unitCost;
      const c = cat.get(i.categoryName || "Other") || { name: i.categoryName || "Other", qty: 0, revenue: 0, profit: 0 };
      c.qty += i.qty;
      c.revenue += amount;
      c.profit += p;
      cat.set(c.name, c);
      const key = i.productId || i.name;
      const r = prod.get(key) || { productId: i.productId, name: i.name, category: i.categoryName, qty: 0, revenue: 0, profit: 0 };
      r.qty += i.qty;
      r.revenue += amount;
      r.profit += p;
      prod.set(key, r);
    }
  }
  const roundRow = <T extends { revenue: number; profit: number }>(r: T) => ({ ...r, revenue: round2(r.revenue), profit: round2(r.profit) });

  const groups = new Map<string, { id: string; name: string; color: string; revenue: number; bills: number; credit: number }>();
  const customers = new Map<string, { id: string; name: string; shopName: string; revenue: number; bills: number; pieces: number }>();
  for (const s of wholesale) {
    const g = s.customer?.group;
    const key = g?.id || "none";
    const row = groups.get(key) || { id: key, name: g?.name || "No group", color: g?.color || "#94a3b8", revenue: 0, bills: 0, credit: 0 };
    row.revenue = round2(row.revenue + s.total);
    row.credit = round2(row.credit + s.dueAmount);
    row.bills += 1;
    groups.set(key, row);
    if (s.customerId) {
      const c = customers.get(s.customerId) || {
        id: s.customerId,
        name: s.customer?.name || "",
        shopName: s.customer?.shopName || "",
        revenue: 0,
        bills: 0,
        pieces: 0,
      };
      c.revenue = round2(c.revenue + s.total);
      c.bills += 1;
      c.pieces += s.items.reduce((a, i) => a + i.qty, 0);
      customers.set(s.customerId, c);
    }
  }

  const staff = new Map<string, { name: string; bills: number; revenue: number }>();
  for (const s of sales) {
    const name = s.createdByName || "—";
    const row = staff.get(name) || { name, bills: 0, revenue: 0 };
    row.bills += 1;
    row.revenue = round2(row.revenue + s.total);
    staff.set(name, row);
  }

  const products = await prisma.accProduct.findMany({
    where: { active: true },
    select: { id: true, name: true, stockQty: true, lowStockAt: true, purchasePrice: true, sellingPrice: true, category: { select: { name: true } } },
  });
  const soldIds = new Set([...prod.values()].map((p) => p.productId).filter(Boolean));
  const stock = {
    products: products.length,
    units: products.reduce((a, p) => a + Math.max(p.stockQty, 0), 0),
    costValue: round2(products.reduce((a, p) => a + Math.max(p.stockQty, 0) * p.purchasePrice, 0)),
    retailValue: round2(products.reduce((a, p) => a + Math.max(p.stockQty, 0) * p.sellingPrice, 0)),
    low: products.filter((p) => p.lowStockAt > 0 && p.stockQty > 0 && p.stockQty <= p.lowStockAt).length,
    out: products.filter((p) => p.stockQty <= 0).length,
    lowList: products
      .filter((p) => p.stockQty <= 0 || (p.lowStockAt > 0 && p.stockQty <= p.lowStockAt))
      .sort((a, b) => a.stockQty - b.stockQty)
      .slice(0, 12)
      .map((p) => ({ id: p.id, name: p.name, category: p.category.name, stockQty: p.stockQty, lowStockAt: p.lowStockAt })),
    // In stock but not sold in this period: money sitting on the shelf.
    slow: products
      .filter((p) => p.stockQty > 0 && !soldIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, category: p.category.name, stockQty: p.stockQty, value: round2(p.stockQty * p.purchasePrice) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
  };

  const balances = await customerBalances();
  const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  let outstanding = 0;
  let overdue = 0;
  for (const b of balances.values()) {
    if (b.balance <= 0) continue;
    outstanding += b.balance;
    overdue += b.overdue;
    for (const k of Object.keys(aging) as Array<keyof typeof aging>) aging[k] = round2(aging[k] + b.aging[k]);
  }

  return {
    period: range.period,
    label: range.label,
    totals: {
      revenue,
      profit,
      margin: revenue ? round2((profit / revenue) * 100) : 0,
      bills: sales.length,
      pieces,
      avgBill: sales.length ? round2(revenue / sales.length) : 0,
      retail: sum(retail, (s) => s.total),
      retailBills: retail.length,
      retailProfit: sum(retail, (s) => s.total - s.costTotal),
      wholesale: sum(wholesale, (s) => s.total),
      wholesaleBills: wholesale.length,
      wholesaleProfit: sum(wholesale, (s) => s.total - s.costTotal),
      cash: sum(sales, (s) => s.cashAmount),
      online: sum(sales, (s) => s.onlineAmount),
      creditGiven: sum(sales, (s) => s.dueAmount),
      collected: round2(paymentsIn._sum.amount || 0),
      discount: sum(sales, (s) => s.discount),
    },
    previous,
    trend: { byMonth, rows: [...trendMap.values()].sort((a, b) => a.key.localeCompare(b.key)) },
    hours: hours.filter((h) => h.hour >= 8 && h.hour <= 23),
    categories: [...cat.values()].map(roundRow).sort((a, b) => b.revenue - a.revenue),
    topProducts: [...prod.values()].map(roundRow).sort((a, b) => b.revenue - a.revenue).slice(0, 12),
    groups: [...groups.values()].sort((a, b) => b.revenue - a.revenue),
    topCustomers: [...customers.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    staff: [...staff.values()].sort((a, b) => b.revenue - a.revenue),
    stock,
    dues: { outstanding: round2(outstanding), overdue: round2(overdue), aging },
  };
}

accAnalyticsRouter.get("/analytics", async (req, res, next) => {
  try {
    res.json({ data: await buildAccAnalytics(req.query) });
  } catch (error) {
    next(error);
  }
});

accAnalyticsRouter.get("/analytics/pdf", async (req, res, next) => {
  try {
    const a = await buildAccAnalytics(req.query);
    const t = a.totals;
    const pdf = await renderAccPdf({
      title: "Business report",
      subtitle: a.label,
      summary: [
        { label: "Total sales", value: rs(t.revenue), tone: "blue" },
        { label: "Profit", value: `${rs(t.profit)} (${t.margin}%)`, tone: "green" },
        { label: "Bills", value: `${t.bills} · avg ${money(t.avgBill)}` },
        { label: "Pieces sold", value: String(t.pieces) },
        { label: "Retail", value: `${rs(t.retail)} (${t.retailBills})` },
        { label: "Wholesale", value: `${rs(t.wholesale)} (${t.wholesaleBills})` },
        { label: "Cash + online", value: rs(round2(t.cash + t.online)), tone: "green" },
        { label: "Credit given", value: rs(t.creditGiven), tone: "red" },
        { label: "Dues collected", value: rs(t.collected), tone: "green" },
        { label: "Outstanding now", value: rs(a.dues.outstanding), tone: "red" },
      ],
      sections: [
        {
          heading: "Sales by category",
          columns: [
            { key: "name", label: "Category", width: 40 },
            { key: "qty", label: "Pieces", width: 15, align: "right" },
            { key: "revenue", label: "Sales", width: 22, align: "right" },
            { key: "profit", label: "Profit", width: 22, align: "right" },
          ],
          rows: a.categories.map((c) => ({
            cells: { name: c.name, qty: String(c.qty), revenue: money(c.revenue), profit: money(c.profit) },
          })),
          empty: "No sales in this period.",
        },
        {
          heading: "Top products",
          columns: [
            { key: "name", label: "Product", width: 46 },
            { key: "qty", label: "Pieces", width: 12, align: "right" },
            { key: "revenue", label: "Sales", width: 20, align: "right" },
            { key: "profit", label: "Profit", width: 20, align: "right" },
          ],
          rows: a.topProducts.map((p) => ({
            cells: { name: p.name, qty: String(p.qty), revenue: money(p.revenue), profit: money(p.profit) },
            sub: { name: p.category },
          })),
        },
        ...(a.groups.length
          ? [
              {
                heading: "Wholesale by customer group",
                columns: [
                  { key: "name", label: "Group", width: 40 },
                  { key: "bills", label: "Bills", width: 15, align: "right" as const },
                  { key: "revenue", label: "Sales", width: 22, align: "right" as const },
                  { key: "credit", label: "Given on credit", width: 22, align: "right" as const },
                ],
                rows: a.groups.map((g) => ({
                  cells: { name: g.name, bills: String(g.bills), revenue: money(g.revenue), credit: money(g.credit) },
                })),
              },
            ]
          : []),
        {
          heading: "Dues ageing (all customers, today)",
          columns: [
            { key: "a", label: "0–30 days", width: 20, align: "right" },
            { key: "b", label: "31–60 days", width: 20, align: "right" },
            { key: "c", label: "61–90 days", width: 20, align: "right" },
            { key: "d", label: "90+ days", width: 20, align: "right" },
            { key: "e", label: "Total", width: 20, align: "right" },
          ],
          rows: [
            {
              cells: {
                a: money(a.dues.aging.d0_30),
                b: money(a.dues.aging.d31_60),
                c: money(a.dues.aging.d61_90),
                d: money(a.dues.aging.d90p),
                e: money(a.dues.outstanding),
              },
            },
          ],
        },
        ...(a.stock.slow.length
          ? [
              {
                heading: "Not sold in this period (highest stock value)",
                columns: [
                  { key: "name", label: "Product", width: 56 },
                  { key: "qty", label: "In stock", width: 20, align: "right" as const },
                  { key: "value", label: "Value at cost", width: 24, align: "right" as const },
                ],
                rows: a.stock.slow.map((p) => ({
                  cells: { name: p.name, qty: String(p.stockQty), value: money(p.value) },
                  sub: { name: p.category },
                })),
              },
            ]
          : []),
      ],
      footNote: "Voided bills excluded. Profit uses the average cost at the time of sale.",
    });
    sendPdf(res, pdf, `accessories-report-${a.period}-${istDateString()}.pdf`);
  } catch (error) {
    next(error);
  }
});
