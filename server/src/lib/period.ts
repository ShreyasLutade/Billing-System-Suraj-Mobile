import {
  addDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import type { Prisma } from "@prisma/client";

/** Bill date ranges for Bills + Analytics */
export const ACTIVITY_PERIODS = [
  "today",
  "yesterday",
  "week",
  "month",
  "all",
] as const;

/** Due-date ranges for the Dues page */
export const DUE_PERIODS = [
  "today",
  "tomorrow",
  "yesterday",
  "past_due",
  "future_due",
  "all",
] as const;

export const PERIODS = [
  "today",
  "tomorrow",
  "yesterday",
  "week",
  "month",
  "past_due",
  "future_due",
  "all",
] as const;

export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];
export type DuePeriod = (typeof DUE_PERIODS)[number];
export type Period = (typeof PERIODS)[number];

export type PeriodRange = {
  from: Date | null;
  to: Date | null;
};

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && PERIODS.includes(value as Period);
}

export function isActivityPeriod(value: unknown): value is ActivityPeriod {
  return (
    typeof value === "string" &&
    ACTIVITY_PERIODS.includes(value as ActivityPeriod)
  );
}

export function isDuePeriod(value: unknown): value is DuePeriod {
  return typeof value === "string" && DUE_PERIODS.includes(value as DuePeriod);
}

export function getPeriodRange(period: Period, now = new Date()): PeriodRange {
  switch (period) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "tomorrow": {
      const day = addDays(now, 1);
      return { from: startOfDay(day), to: endOfDay(day) };
    }
    case "yesterday": {
      const day = subDays(now, 1);
      return { from: startOfDay(day), to: endOfDay(day) };
    }
    case "week":
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: endOfWeek(now, { weekStartsOn: 1 }),
      };
    case "month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "past_due":
      return { from: null, to: endOfDay(subDays(now, 1)) };
    case "future_due":
      return { from: startOfDay(addDays(now, 1)), to: null };
    case "all":
      return { from: null, to: null };
  }
}

export function toDateFilter(
  range: PeriodRange,
): Prisma.DateTimeFilter | undefined {
  if (!range.from && !range.to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (range.from) filter.gte = range.from;
  if (range.to) filter.lte = range.to;
  return filter;
}

export function periodLabel(period: Period) {
  switch (period) {
    case "today":
      return "Today";
    case "tomorrow":
      return "Tomorrow";
    case "yesterday":
      return "Yesterday";
    case "week":
      return "This week";
    case "month":
      return "This month";
    case "past_due":
      return "Past due";
    case "future_due":
      return "Future due";
    case "all":
      return "All time";
  }
}
