import { format } from "date-fns";

/** Where a customer due stands against its promised date. */
export type DueUrgency = "overdue" | "today" | "upcoming" | "none";

export type DueStatus = {
  urgency: DueUrgency;
  /** Days late (overdue) or days left (upcoming). */
  days: number | null;
  label: string;
};

export function dueStatus(dueDate: string | null, now = new Date()): DueStatus {
  if (!dueDate) return { urgency: "none", days: null, label: "No due date" };
  const day = dueDate.slice(0, 10);
  const today = format(now, "yyyy-MM-dd");
  const diff = Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (diff < 0) {
    return { urgency: "overdue", days: -diff, label: `${-diff} day${diff === -1 ? "" : "s"} late` };
  }
  if (diff === 0) return { urgency: "today", days: 0, label: "Due today" };
  return { urgency: "upcoming", days: diff, label: diff === 1 ? "Due tomorrow" : `In ${diff} days` };
}

/** Colours per urgency: left stripe, avatar and status pill. */
export const URGENCY_TONE: Record<
  DueUrgency,
  { accent: string; avatar: string; pill: string }
> = {
  overdue: {
    accent: "#E5484D",
    avatar: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    pill: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  today: {
    accent: "#FFB020",
    avatar: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  upcoming: {
    accent: "#34D399",
    avatar: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  none: {
    accent: "#C9D0DB",
    avatar: "bg-ink-900/[0.06] text-ink-600 dark:bg-white/10",
    pill: "bg-ink-900/[0.06] text-ink-500 dark:bg-white/10",
  },
};

/** "Ramesh Kumar Patel" → "RP". */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** ₹15,000 for whole rupees, ₹15,000.50 only when there are paise. */
export function formatRupees(amount: number) {
  const value = Math.round((amount || 0) * 100) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}
