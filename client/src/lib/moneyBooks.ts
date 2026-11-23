import {
  Bike,
  Coffee,
  Home,
  Megaphone,
  Receipt,
  ShoppingBag,
  Users,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Shop expense kinds (server keeps the same keys). */
export const EXPENSE_CATEGORIES: Array<{
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
}> = [
  { key: "rent", label: "Rent", icon: Home, color: "#6366F1" },
  { key: "electricity", label: "Electricity", icon: Zap, color: "#F59E0B" },
  { key: "salary", label: "Salary", icon: Users, color: "#0EA5E9" },
  { key: "internet", label: "Internet & recharge", icon: Wifi, color: "#8B5CF6" },
  { key: "tea", label: "Tea & snacks", icon: Coffee, color: "#B45309" },
  { key: "transport", label: "Transport", icon: Bike, color: "#14B8A6" },
  { key: "repairs", label: "Repairs & upkeep", icon: Wrench, color: "#64748B" },
  { key: "packaging", label: "Bags & packaging", icon: ShoppingBag, color: "#EC4899" },
  { key: "marketing", label: "Ads & marketing", icon: Megaphone, color: "#EF4444" },
  { key: "other", label: "Other", icon: Receipt, color: "#94A3B8" },
];

export function expenseCategory(key: string | null | undefined) {
  return EXPENSE_CATEGORIES.find((c) => c.key === key) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
}

/** Quick reasons on the Cash / Online books (one tap fills the reason). */
export const MONEY_REASONS: Record<"IN" | "OUT", string[]> = {
  IN: ["Sale", "Due collected", "From bank", "Owner added", "Other"],
  OUT: ["Expense", "Supplier", "To bank", "Owner took", "Other"],
};

export const BOOK_META = {
  cash: {
    title: "Cash book",
    balanceLabel: "Cash in hand",
    startTitle: "Start your cash book",
    startQuestion: "How much cash is in the shop right now?",
    startButton: "from-[#34D399] to-[#10B981] text-[#04291D]",
    startGlow: "rgba(52,211,153,.9)",
    startIcon: "linear-gradient(135deg, #34D399, #059669)",
    ring: "rgba(52, 211, 153, 0.55)",
    gradient: "radial-gradient(120% 140% at 0% 0%, #0F4D3C 0%, #0B2A2A 45%, #0E1626 100%)",
    glow: "rgba(52, 211, 153, 0.35)",
    accent: "#34D399",
  },
  online: {
    title: "Online book",
    balanceLabel: "Online balance",
    startTitle: "Start your online book",
    startQuestion: "How much is in your online / bank account right now?",
    startButton: "from-[#60A5FA] to-[#3B82F6] text-[#061A3A]",
    startGlow: "rgba(96,165,250,.9)",
    startIcon: "linear-gradient(135deg, #60A5FA, #2563EB)",
    ring: "rgba(96, 165, 250, 0.55)",
    gradient: "radial-gradient(120% 140% at 0% 0%, #1B3F7A 0%, #142A52 45%, #0E1626 100%)",
    glow: "rgba(96, 165, 250, 0.35)",
    accent: "#60A5FA",
  },
} as const;

/** "2026-11" → "November 2026" / "Nov". */
export function monthLabel(month: string, short = false) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    month: short ? "short" : "long",
    ...(short ? {} : { year: "numeric" }),
  }).format(new Date(y, m - 1, 1));
}

/** Shift "2026-11" by n months. */
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "Today" / "Yesterday" / "21 Nov" / "21 Nov 2025" for an ISO date (IST). */
export function dayLabel(iso: string) {
  const ist = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const day = ist(new Date(iso));
  const today = ist(new Date());
  const yesterday = ist(new Date(Date.now() - 86_400_000));
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  const d = new Date(iso);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

/** Group entries (newest first) under their day. */
export function groupByDay<T extends { date: string }>(entries: T[]) {
  const groups: Array<{ day: string; items: T[] }> = [];
  for (const entry of entries) {
    const day = dayLabel(entry.date);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(entry);
    else groups.push({ day, items: [entry] });
  }
  return groups;
}
