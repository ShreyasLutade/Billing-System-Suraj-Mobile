import { api } from "./api";
import type { MonthlyTrend, TrendMonth, TrendTotals } from "../types";

export type TrendMetric = "sales" | "collected" | "phones";

/** Last trend loaded, so the card and the page show at once. */
let cached: MonthlyTrend | null = null;

export function cachedTrend() {
  return cached;
}

export async function loadTrend() {
  const { data } = await api.analyticsMonthly(12);
  cached = data;
  return data;
}

export function metricValue(totals: TrendTotals, metric: TrendMetric) {
  return metric === "phones" ? totals.phones : metric === "collected" ? totals.collected : totals.sales;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-11" → "Nov" / "November 2026". */
export function monthShort(key: string) {
  return MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}
export function monthLong(key: string) {
  return `${MONTHS_LONG[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`;
}

/** Indian short form for axes and small labels: ₹950, ₹45K, ₹4.3L, ₹1.2Cr. */
export function compactINR(amount: number) {
  const sign = amount < 0 ? "−" : "";
  const value = Math.abs(amount);
  const trim = (n: number) => String(Number(n.toFixed(n >= 10 ? 0 : 1)));
  if (value >= 1e7) return `${sign}₹${trim(value / 1e7)}Cr`;
  if (value >= 1e5) return `${sign}₹${trim(value / 1e5)}L`;
  if (value >= 1e3) return `${sign}₹${trim(value / 1e3)}K`;
  return `${sign}₹${Math.round(value)}`;
}

/** % change vs the previous month, or null when there is nothing to compare. */
export function changePct(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return Math.abs(pct) > 999 ? null : pct;
}

/** Round axis ticks (0, 50K, 1L…) covering `lo`..`hi`. */
export function niceTicks(lo: number, hi: number, count = 3) {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const step =
    (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10) *
    magnitude;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  return ticks;
}

export function bestMonth(months: TrendMonth[], metric: TrendMetric) {
  return months.reduce<TrendMonth | null>(
    (best, m) => (!best || metricValue(m, metric) > metricValue(best, metric) ? m : best),
    null,
  );
}

/**
 * What to compare a month with: the whole previous month, or — for the month
 * still in progress — the same days of the previous month (1st … today).
 */
export function previousComparable(
  months: TrendMonth[],
  index: number,
  metric: TrendMetric,
  today: string,
) {
  const previous = index > 0 ? months[index - 1] : null;
  if (!previous) return null;
  if (index !== months.length - 1) {
    return { value: metricValue(previous, metric), label: `vs ${monthShort(previous.key)}` };
  }
  const upTo = Number(today.slice(8, 10));
  const value = previous.days
    .filter((day) => Number(day.date.slice(8, 10)) <= upTo)
    .reduce((sum, day) => sum + metricValue(day, metric), 0);
  return { value, label: `vs ${monthShort(previous.key)} 1–${upTo}` };
}
