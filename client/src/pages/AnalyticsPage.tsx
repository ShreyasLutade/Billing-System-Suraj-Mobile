import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import {
  format,
  isSameDay,
  isSameYear,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
import {
  ArrowDownUp,
  Banknote,
  BarChart3,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronDown,
  Clock3,
  CreditCard,
  ChevronRight,
  HandCoins,
  MonitorSmartphone,
  Package,
  PackageOpen,
  ShoppingBag,
} from "lucide-react";
import clsx from "clsx";
import {
  PeriodFilter,
  type AnalyticsPeriodValue,
} from "../components/PeriodFilter";
import { EmptyState, PageHeader } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { useSessionState } from "../hooks/useSessionState";
import { api, formatINR } from "../lib/api";
import type { AnalyticsSummary } from "../types";
import { fromState } from "../lib/navMemory";
import {
  analyticsCustomerPayoutsPath,
  analyticsExchangesPath,
  analyticsPaymentsPath,
  analyticsPurchasesPath,
  type PaymentMode,
} from "../lib/analyticsNav";
import { MIX, mixSurface } from "../lib/analyticsMix";
import { motion } from "framer-motion";
import { MoneyButtons } from "../components/money/MoneyButtons";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { TrendCard } from "../components/TrendCard";
import { HeroSparkles } from "../components/AnalyticsBackdrop";
import { riseIn } from "../lib/motion";
import { formatRupees } from "../lib/dueStatus";
import { useTheme } from "../theme/ThemeContext";

const AVATAR_COLORS = [
  MIX.cash.color,
  MIX.online.color,
  MIX.card.color,
  MIX.finance.color,
  MIX.due.color,
  "#0E1626",
];

type BillSortKey = "date" | "cost" | "sell" | "profit" | "cust";
type SortDir = "asc" | "desc";

type PeriodBill = AnalyticsSummary["periodBills"][number];

const SORT_FIELD_OPTIONS: Array<{ key: BillSortKey; label: string }> = [
  { key: "date", label: "Sold date" },
  { key: "cost", label: "Cost price" },
  { key: "sell", label: "Selling price" },
  { key: "profit", label: "Profit" },
];

function sortLabel(key: BillSortKey, dir: SortDir) {
  if (key === "date") return dir === "desc" ? "Newest" : "Oldest";
  const base =
    key === "cost"
      ? "Cost"
      : key === "sell"
        ? "Selling"
        : key === "profit"
          ? "Profit"
          : "Customer";
  return `${base} ${dir === "desc" ? "↓" : "↑"}`;
}

function compareBills(a: PeriodBill, b: PeriodBill, key: BillSortKey, dir: SortDir) {
  const sign = dir === "asc" ? 1 : -1;
  if (key === "cust") {
    return (
      a.customerName.localeCompare(b.customerName, undefined, {
        sensitivity: "base",
      }) * sign
    );
  }
  if (key === "date") {
    const ax = new Date(a.billDate).getTime();
    const bx = new Date(b.billDate).getTime();
    return (ax - bx) * sign;
  }
  const ax =
    key === "cost"
      ? a.costPrice
      : key === "sell"
        ? a.sellingPrice
        : a.profit;
  const bx =
    key === "cost"
      ? b.costPrice
      : key === "sell"
        ? b.sellingPrice
        : b.profit;
  return (ax - bx) * sign;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

/** One plain sentence for the headline card. */
function summarySentence(
  period: string,
  label: string,
  collected: number,
  bills: number,
  profit: number,
) {
  const when =
    period === "all"
      ? "Since you started"
      : period === "custom"
        ? `From ${label}`
        : label;
  if (bills === 0) {
    return period === "all" ? "No bills yet." : `${when}: no bills yet.`;
  }
  return `${when}, you collected ${formatRupees(collected)} from ${bills} bill${
    bills === 1 ? "" : "s"
  } and made ${formatRupees(profit)} profit.`;
}

/** Small uppercase heading above a group of cards. */
function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">{title}</h2>
      {hint ? <span className="text-[11px] font-medium text-ink-400">{hint}</span> : null}
    </div>
  );
}

/** A tappable row in a grouped card: icon · title + detail · value › */
function InsightRow({
  to,
  icon: Icon,
  colors,
  dark,
  title,
  sub,
  value,
  alert = false,
}: {
  to: string;
  icon: typeof Clock3;
  colors: (typeof MIX)[keyof typeof MIX];
  dark: boolean;
  title: string;
  sub: string;
  value: ReactNode;
  alert?: boolean;
}) {
  const location = useLocation();
  return (
    <Link
      to={to}
      state={fromState(location)}
      className="interactive-card-row flex min-h-[60px] items-center gap-3 border-b border-[#EEF1F5] px-4 py-2.5 last:border-b-0 dark:border-[rgb(var(--color-line))]"
    >
      <span
        className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
        style={mixSurface(colors, dark)}
      >
        <Icon className="h-4 w-4" strokeWidth={2.2} />
        {alert ? (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#E5484D] ring-2 ring-white dark:ring-[rgb(var(--color-surface))]" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-900">{title}</span>
        <span className="block truncate text-xs text-ink-500">{sub}</span>
      </span>
      <span className="shrink-0 text-right text-sm font-bold tabular-nums text-ink-900">{value}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
    </Link>
  );
}

function formatShare(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatChange(pct: number | null) {
  if (pct == null) return null;
  const abs = Math.abs(pct).toFixed(1);
  if (pct > 0) return { text: `▲ ${abs}%`, up: true };
  if (pct < 0) return { text: `▼ ${abs}%`, up: false };
  return { text: `${abs}%`, up: null as boolean | null };
}

/**
 * Dates covered by the selected period, in local time. Week and month run up to
 * today (later days have no bills yet), matching the server’s week start (Monday).
 */
function periodDateRangeLabel(
  period: AnalyticsPeriodValue,
  customFrom: string,
  customTo: string,
  now = new Date(),
) {
  const today = startOfDay(now);
  const parseDay = (value: string) => {
    if (!value) return null;
    const day = parseISO(value);
    return isValid(day) ? day : null;
  };

  let from: Date | null;
  let to: Date | null = today;
  switch (period) {
    case "today":
      from = today;
      break;
    case "yesterday":
      from = to = subDays(today, 1);
      break;
    case "week":
      from = startOfWeek(today, { weekStartsOn: 1 });
      break;
    case "month":
      from = startOfMonth(today);
      break;
    case "custom":
      from = parseDay(customFrom);
      to = parseDay(customTo);
      break;
    default:
      from = null;
  }

  const full = (day: Date) => format(day, "d MMM yyyy");
  if (from && to) {
    if (isSameDay(from, to)) return full(from);
    return isSameYear(from, to)
      ? `${format(from, "d MMM")} – ${full(to)}`
      : `${full(from)} – ${full(to)}`;
  }
  if (from) return `From ${full(from)}`;
  if (to) return `Up to ${full(to)}`;
  return null;
}

/** Last summary shown, so coming back to Analytics shows it at once. */
let lastSummary: { key: string; data: AnalyticsSummary } | null = null;

/** Where the page was when a link on it was opened (cleared by the main nav). */
const RETURN_KEY = "analytics.returnScroll";
type ReturnScroll = { top: number; count: number };

function readReturnScroll(): ReturnScroll | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    return raw ? (JSON.parse(raw) as ReturnScroll) : null;
  } catch {
    return null;
  }
}

/** The app's scrolling area (AppShell <main>). */
function scroller() {
  return document.querySelector("main");
}

export function AnalyticsPage() {
  const location = useLocation();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [period, setPeriod] = useSessionState<AnalyticsPeriodValue>(
    "analytics.period",
    "today",
  );
  const [customFrom, setCustomFrom] = useSessionState(
    "analytics.customFrom",
    "",
  );
  const [customTo, setCustomTo] = useSessionState("analytics.customTo", "");
  const summaryKey = `${period}|${customFrom}|${customTo}`;
  const [data, setData] = useState<AnalyticsSummary | null>(() =>
    lastSummary?.key === summaryKey ? lastSummary.data : null,
  );
  const [loading, setLoading] = useState(() => lastSummary?.key !== summaryKey);
  const [error, setError] = useState<string | null>(null);
  const [returnScroll] = useState(readReturnScroll);
  const restoredRef = useRef(false);

  // Used once: a later visit (e.g. from the menu) starts at the top.
  useEffect(() => {
    try {
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      // ignore
    }
  }, []);
  const [sortKey, setSortKey] = useSessionState<BillSortKey>(
    "analytics.sortKey",
    "date",
  );
  const [sortDir, setSortDir] = useSessionState<SortDir>(
    "analytics.sortDir",
    "desc",
  );
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef<HTMLDivElement>(null);
  /** Exchange accessories still owed — all time, not tied to the period filter. */
  const [pendingItems, setPendingItems] = useState<{
    billCount: number;
    itemCount: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    api
      .pendingAccessories()
      .then((response) => {
        if (active) {
          setPendingItems({
            billCount: response.data.billCount,
            itemCount: response.data.itemCount,
          });
        }
      })
      .catch(() => {
        if (active) setPendingItems(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const periodRangeLabel = periodDateRangeLabel(period, customFrom, customTo);

  const customRangeReady =
    period === "custom" && Boolean(customFrom || customTo);

  useEffect(() => {
    if (period === "custom" && !customRangeReady) return;

    let active = true;
    // Same filter as last time: keep showing it and refresh quietly.
    const cached = lastSummary?.key === summaryKey ? lastSummary.data : null;
    if (cached) setData(cached);
    else setLoading(true);
    (async () => {
      try {
        const response = await api.analytics(
          period === "custom" ? "all" : period,
          period === "custom" && customRangeReady
            ? {
                from: customFrom || undefined,
                to: customTo || undefined,
              }
            : undefined,
        );
        if (active) {
          lastSummary = { key: summaryKey, data: response.data };
          setData(response.data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load analytics",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // summaryKey is built from period / customFrom / customTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo, customRangeReady]);

  useEffect(() => {
    if (!sortOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        sortWrapRef.current &&
        !sortWrapRef.current.contains(event.target as Node)
      ) {
        setSortOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sortOpen]);

  const sortedBills = useMemo(() => {
    const bills = data?.periodBills ?? [];
    return [...bills].sort((a, b) => compareBills(a, b, sortKey, sortDir));
  }, [data?.periodBills, sortKey, sortDir]);

  const billsReveal = useInfiniteReveal(
    sortedBills,
    `${period}|${customFrom}|${customTo}|${sortKey}|${sortDir}|${sortedBills.length}`,
    undefined,
    returnScroll?.count,
  );

  // Back from a bill (or any card) opened here: same place in the list.
  useEffect(() => {
    if (!returnScroll || restoredRef.current || !data || loading) return;
    if (billsReveal.visibleCount < Math.min(returnScroll.count, sortedBills.length)) {
      return;
    }
    restoredRef.current = true;
    requestAnimationFrame(() => {
      scroller()?.scrollTo({ top: returnScroll.top });
    });
  }, [returnScroll, data, loading, billsReveal.visibleCount, sortedBills.length]);

  /** Remember the spot when a link on this page is opened. */
  function rememberSpot(event: ReactMouseEvent<HTMLDivElement>) {
    if (!(event.target as Element).closest("a[href]")) return;
    try {
      sessionStorage.setItem(
        RETURN_KEY,
        JSON.stringify({
          top: scroller()?.scrollTop ?? 0,
          count: billsReveal.visibleCount,
        } satisfies ReturnScroll),
      );
    } catch {
      // Private mode / quota — ignore.
    }
  }

  const billTotals = useMemo(() => {
    return sortedBills.reduce(
      (acc, bill) => {
        acc.cost += bill.costPrice;
        acc.sell += bill.sellingPrice;
        acc.profit += bill.profit;
        return acc;
      },
      { cost: 0, sell: 0, profit: 0 },
    );
  }, [sortedBills]);

  const summary = data?.summary;
  const shares = summary?.shares;
  const change = formatChange(data?.vsPrevious.mixTotalChangePct ?? null);
  const profitAmount = summary?.profit ?? 0;
  const revenueAmount = summary?.sales ?? 0;
  const profitMarginPct =
    revenueAmount > 0
      ? Math.round((profitAmount / revenueAmount) * 1000) / 10
      : null;
  const showSoldDate = data != null && data.period !== "today";
  const billsRowGrid = showSoldDate
    ? "sm:grid-cols-[minmax(0,1.5fr)_1fr_0.9fr_0.9fr_0.9fr]"
    : "sm:grid-cols-[minmax(0,1.8fr)_0.9fr_0.9fr_0.9fr]";
  const mixSegments = summary
    ? [
        { key: "cash", width: shares?.cash ?? 0, color: MIX.cash.color },
        { key: "online", width: shares?.online ?? 0, color: MIX.online.color },
        { key: "card", width: shares?.card ?? 0, color: MIX.card.color },
        {
          key: "finance",
          width: shares?.finance ?? 0,
          color: MIX.finance.color,
        },
        { key: "due", width: shares?.due ?? 0, color: MIX.due.color },
      ]
    : [];

  const kpis = summary
    ? [
        {
          key: "cash",
          name: "Cash received",
          value: summary.cash,
          share: shares?.cash ?? 0,
          colors: MIX.cash,
          icon: Banknote,
        },
        {
          key: "online",
          name: "Online · UPI",
          value: summary.online,
          share: shares?.online ?? 0,
          colors: MIX.online,
          icon: MonitorSmartphone,
        },
        {
          key: "card",
          name: "Card",
          value: summary.card,
          share: shares?.card ?? 0,
          colors: MIX.card,
          icon: CreditCard,
        },
        {
          key: "finance",
          name: "Financed (EMI)",
          value: summary.finance,
          share: shares?.finance ?? 0,
          colors: MIX.finance,
          icon: ChartColumn,
        },
        {
          key: "due",
          name: "Due created",
          value: summary.due,
          share: shares?.due ?? 0,
          colors: MIX.due,
          icon: Clock3,
        },
      ]
    : [];

  return (
    <div onClickCapture={rememberSpot}>
      <PageHeader
        icon={BarChart3}
        title="Analytics"
      />
      <div className="mb-5 sm:mb-6">
        <PeriodFilter
          allowCustom
          pillId="analytics-period"
          value={period}
          onChange={setPeriod}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />
      </div>

      {loading ? (
        <div className="space-y-3" aria-label="Loading analytics">
          <div className="trend-skeleton h-[250px] rounded-[1.25rem]" />
          <div className="trend-skeleton h-[300px] rounded-[20px]" />
        </div>
      ) : null}
      {error ? (
        <div className="glass-panel px-5 py-4 text-sm text-ember-500">{error}</div>
      ) : null}

      {data && summary && !loading ? (
        <>
          <div className="lg:grid lg:grid-cols-[1.35fr_1fr] lg:items-start lg:gap-6">
            <div>
              {/* 1. Headline: money collected, in plain words */}
              <motion.section
                variants={riseIn}
                initial="hidden"
                animate="show"
                custom={0}
                className="fx-sheen relative mb-5 overflow-hidden rounded-[1.25rem] bg-[radial-gradient(120%_140%_at_0%_0%,#1B2740_0%,#0E1626_55%)] p-5 text-white shadow-lift sm:p-6"
                aria-label="Summary"
              >
                <HeroSparkles />
                {/* Centred: title, date, amount, change, sentence, three equal boxes. */}
                <div className="relative flex flex-col items-center text-center">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#8EA0BC] sm:text-[11px]">
                    Money collected · {data.periodLabel.toLowerCase()}
                  </p>
                  {periodRangeLabel ? (
                    <span className="mt-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-white/90 sm:text-[11.5px]">
                      <CalendarDays className="h-3 w-3 text-[#8EA0BC]" aria-hidden />
                      {periodRangeLabel}
                    </span>
                  ) : null}
                  <p className="mt-3 font-display text-[clamp(2.25rem,10vw,3.25rem)] font-bold leading-none tracking-tight tabular-nums">
                    <AnimatedNumber value={summary.collected} format={formatRupees} duration={1.3} />
                  </p>
                  {change && data.vsPrevious.label ? (
                    <motion.span
                      className={clsx(
                        "mt-2.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold",
                        change.up === true
                          ? "bg-[#5CE0AE]/15 text-[#5CE0AE]"
                          : change.up === false
                            ? "bg-orange-300/15 text-orange-300"
                            : "bg-white/10 text-white",
                      )}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.9 }}
                    >
                      {change.text} {data.vsPrevious.label}
                    </motion.span>
                  ) : null}
                  <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-[#C4CEDD]">
                    {summarySentence(data.period, data.periodLabel, summary.collected, summary.bills, profitAmount)}
                  </p>

                  <div className="mt-4 grid w-full grid-cols-3 gap-2">
                    {[
                      { label: "Sales", value: revenueAmount, tone: "text-white", note: "before costs" },
                      {
                        label: "Profit",
                        value: profitAmount,
                        tone: profitAmount >= 0 ? "text-[#5CE0AE]" : "text-orange-300",
                        note: profitMarginPct != null ? `${profitMarginPct.toFixed(1)}% margin` : "margin —",
                      },
                      {
                        label: "Bills",
                        value: summary.bills,
                        tone: "text-white",
                        count: true,
                        note:
                          summary.bills > 0
                            ? `avg ${formatRupees(Math.round(revenueAmount / summary.bills))}`
                            : "no bills yet",
                      },
                    ].map((tile) => (
                      <div
                        key={tile.label}
                        className="flex min-w-0 flex-col items-center rounded-xl border border-white/10 bg-white/[0.06] px-2 py-2.5"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8EA0BC]">
                          {tile.label}
                        </p>
                        <AnimatedNumber
                          value={tile.value}
                          format={tile.count ? (v) => String(Math.round(v)) : formatRupees}
                          fit
                          className={clsx("mt-0.5 font-display text-[17px] font-bold tabular-nums", tile.tone)}
                        />
                        <p className="mt-0.5 truncate text-[10px] font-semibold text-white/50">{tile.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.section>

              {/* Money books: Cash · Online · Expense */}
              <MoneyButtons />

              {/* 2. Where the money came from */}
              <SectionTitle title="Where the money came from" hint="Tap for the bills" />
              <motion.section
                variants={riseIn}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.05 }}
                custom={1}
                className="due-card mb-6 overflow-hidden"
                aria-label="Payment breakdown"
              >
                <div className="px-4 pb-1 pt-4">
                  <div
                    className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-ink-900/[0.06] dark:bg-white/10"
                    role="img"
                    aria-label={`Payment mix: cash ${formatShare(shares?.cash ?? 0)}, online ${formatShare(shares?.online ?? 0)}, card ${formatShare(shares?.card ?? 0)}, finance ${formatShare(shares?.finance ?? 0)}, dues ${formatShare(shares?.due ?? 0)}`}
                  >
                    {mixSegments.map((seg, i) =>
                      seg.width > 0 ? (
                        <span
                          key={seg.key}
                          className="block h-full origin-left scale-x-0 motion-reduce:scale-x-100"
                          style={{
                            width: `${seg.width}%`,
                            background: seg.color,
                            animation: "analytics-mix-grow .9s cubic-bezier(.22,1,.36,1) forwards",
                            animationDelay: `${0.15 + i * 0.09}s`,
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
                {kpis.map((kpi) => {
                  const Icon = kpi.icon;
                  return (
                    <Link
                      key={kpi.key}
                      to={analyticsPaymentsPath(kpi.key as PaymentMode, period, customFrom, customTo)}
                      state={fromState(location)}
                      className="interactive-card-row flex min-h-[56px] items-center gap-3 border-b border-[#EEF1F5] px-4 py-2.5 last:border-b-0 dark:border-[rgb(var(--color-line))]"
                    >
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
                        style={mixSurface(kpi.colors, dark)}
                      >
                        <Icon className="h-4 w-4" strokeWidth={2.2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-ink-900">{kpi.name}</span>
                          <AnimatedNumber
                            value={kpi.value}
                            format={formatRupees}
                            className="shrink-0 text-sm font-bold tabular-nums text-ink-900"
                          />
                        </span>
                        <span className="mt-1.5 flex items-center gap-2">
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-ink-900/[0.06] dark:bg-white/10">
                            <motion.span
                              className="block h-full rounded-full"
                              style={{ background: kpi.colors.color, originX: 0 }}
                              initial={{ scaleX: 0 }}
                              whileInView={{ scaleX: Math.min(kpi.share, 100) / 100 }}
                              viewport={{ once: true }}
                              transition={{ type: "spring", stiffness: 120, damping: 22, delay: 0.2 }}
                            />
                          </span>
                          <span className="w-11 shrink-0 text-right text-[11px] font-semibold tabular-nums text-ink-500">
                            {formatShare(kpi.share)}
                          </span>
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
                    </Link>
                  );
                })}
              </motion.section>
            </div>

            <div>
              {/* 3. Trend */}
              <SectionTitle title="Trend" />
              <motion.section
                variants={riseIn}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.05 }}
                custom={2}
                className="mb-6"
                aria-label="Monthly trend"
              >
                <TrendCard />
              </motion.section>

              {/* 4. Needs attention */}
              <SectionTitle title="Needs attention" />
              <motion.section
                variants={riseIn}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.05 }}
                custom={3}
                className="due-card mb-6 overflow-hidden"
                aria-label="Needs attention"
              >
                <InsightRow
                  to="/dues"
                  icon={Clock3}
                  colors={MIX.due}
                  dark={dark}
                  title="Customer dues"
                  alert={data.outstandingDue.amount > 0}
                  sub={
                    data.outstandingDue.count > 0
                      ? `${data.outstandingDue.count} bill${data.outstandingDue.count === 1 ? "" : "s"}${
                          data.outstandingDue.oldestDueDays != null
                            ? ` · oldest ${data.outstandingDue.oldestDueDays} day${data.outstandingDue.oldestDueDays === 1 ? "" : "s"}`
                            : ""
                        }`
                      : "Nothing pending"
                  }
                  value={<AnimatedNumber value={data.outstandingDue.amount} format={formatRupees} />}
                />
                <InsightRow
                  to="/analytics/pending-items"
                  icon={PackageOpen}
                  colors={MIX.due}
                  dark={dark}
                  title="Pending items"
                  alert={(pendingItems?.itemCount ?? 0) > 0}
                  sub={
                    pendingItems
                      ? pendingItems.itemCount > 0
                        ? `Box, charger, bill… from ${pendingItems.billCount} customer${pendingItems.billCount === 1 ? "" : "s"}`
                        : "Nothing owed by customers"
                      : "—"
                  }
                  value={pendingItems ? String(pendingItems.itemCount) : "—"}
                />
                <InsightRow
                  to={analyticsCustomerPayoutsPath(period, customFrom, customTo)}
                  icon={HandCoins}
                  colors={MIX.due}
                  dark={dark}
                  title="Money given back"
                  sub={`${data.customerPayouts?.count ?? 0} time${(data.customerPayouts?.count ?? 0) === 1 ? "" : "s"} · ${data.periodLabel.toLowerCase()}`}
                  value={<AnimatedNumber value={data.customerPayouts?.value ?? 0} format={formatRupees} />}
                />
              </motion.section>

              {/* 5. Stock & buying */}
              <SectionTitle title="Stock & buying" />
              <motion.section
                variants={riseIn}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.05 }}
                custom={4}
                className="due-card mb-6 overflow-hidden"
                aria-label="Stock and buying"
              >
                <InsightRow
                  to="/stock"
                  icon={Package}
                  colors={MIX.online}
                  dark={dark}
                  title="Stock on hand"
                  sub={`${data.stockOnHand?.count ?? 0} mobile${(data.stockOnHand?.count ?? 0) === 1 ? "" : "s"} available`}
                  value={<AnimatedNumber value={data.stockOnHand?.value ?? 0} format={formatRupees} />}
                />
                <InsightRow
                  to={analyticsPurchasesPath(period, customFrom, customTo)}
                  icon={ShoppingBag}
                  colors={MIX.purchase}
                  dark={dark}
                  title="Bought from suppliers"
                  sub={`${data.purchaseHistory?.count ?? 0} mobile${(data.purchaseHistory?.count ?? 0) === 1 ? "" : "s"} · ${data.periodLabel.toLowerCase()}`}
                  value={<AnimatedNumber value={data.purchaseHistory?.value ?? 0} format={formatRupees} />}
                />
                <InsightRow
                  to={analyticsExchangesPath(period, customFrom, customTo)}
                  icon={ArrowDownUp}
                  colors={MIX.exchange}
                  dark={dark}
                  title="Exchange mobiles taken"
                  sub={`${data.exchangeIntake?.count ?? 0} unit${(data.exchangeIntake?.count ?? 0) === 1 ? "" : "s"} · ${data.periodLabel.toLowerCase()}`}
                  value={<AnimatedNumber value={data.exchangeIntake?.value ?? 0} format={formatRupees} />}
                />
              </motion.section>

              {/* 6. What sold: phones vs accessories */}
              <SectionTitle title="What sold" />
              <motion.section
                variants={riseIn}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.05 }}
                custom={5}
                className="due-card mb-6 px-4 py-3.5"
                aria-label="What sold"
              >
                {(() => {
                  const phones = Math.max(revenueAmount, 0);
                  const accessories = Math.max(summary.accessoriesRevenue ?? 0, 0);
                  const total = phones + accessories;
                  const phoneShare = total > 0 ? (phones / total) * 100 : 0;
                  return (
                    <>
                      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-ink-900/[0.06] dark:bg-white/10">
                        {total > 0 ? (
                          <>
                            <motion.span
                              className="block h-full"
                              style={{ width: `${phoneShare}%`, background: MIX.online.color, originX: 0 }}
                              initial={{ scaleX: 0 }}
                              whileInView={{ scaleX: 1 }}
                              viewport={{ once: true }}
                              transition={{ type: "spring", stiffness: 120, damping: 22, delay: 0.15 }}
                            />
                            <motion.span
                              className="block h-full"
                              style={{ width: `${100 - phoneShare}%`, background: MIX.finance.color, originX: 0 }}
                              initial={{ scaleX: 0 }}
                              whileInView={{ scaleX: 1 }}
                              viewport={{ once: true }}
                              transition={{ type: "spring", stiffness: 120, damping: 22, delay: 0.3 }}
                            />
                          </>
                        ) : null}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                            <span className="h-2 w-2 rounded-[3px]" style={{ background: MIX.online.color }} />
                            Phones
                          </p>
                          <AnimatedNumber
                            value={phones}
                            format={formatRupees}
                            className="mt-0.5 block font-display text-lg font-bold tabular-nums text-ink-900"
                          />
                          <p className="text-[11.5px] text-ink-500">
                            {total > 0 ? `${phoneShare.toFixed(0)}% of sales` : "No sales"}
                          </p>
                        </div>
                        <div>
                          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                            <span className="h-2 w-2 rounded-[3px]" style={{ background: MIX.finance.color }} />
                            Accessories
                          </p>
                          <AnimatedNumber
                            value={accessories}
                            format={formatRupees}
                            className="mt-0.5 block font-display text-lg font-bold tabular-nums text-ink-900"
                          />
                          <p className="text-[11.5px] text-ink-500">
                            {summary.accessoriesSold ?? 0} item{(summary.accessoriesSold ?? 0) === 1 ? "" : "s"} sold
                          </p>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </motion.section>
            </div>
          </div>

          {/* Period bills */}
          <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                Phones sold · {data.periodLabel.toLowerCase()}
              </h2>
              <p className="mt-1 text-[13px] text-ink-500">
                Cost, selling price and profit for each phone. Tap one to open the bill.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative" ref={sortWrapRef}>
                <button
                  type="button"
                  className={clsx(
                    "inline-flex items-center justify-center gap-2 rounded-[11px] border bg-white p-2.5 text-[13px] font-semibold text-ink-700 shadow-soft transition sm:px-3.5 sm:py-2",
                    sortOpen
                      ? "border-ink-900 text-ink-900"
                      : "border-ink-100 text-ink-500 hover:border-ink-300 hover:text-ink-900",
                  )}
                  aria-haspopup="true"
                  aria-expanded={sortOpen}
                  aria-label={`Sort: ${sortLabel(sortKey, sortDir)}`}
                  title={`Sort: ${sortLabel(sortKey, sortDir)}`}
                  onClick={() => setSortOpen((open) => !open)}
                >
                  <ArrowDownUp
                    className="h-4 w-4 text-ink-500 sm:h-[15px] sm:w-[15px] sm:text-ink-300"
                    strokeWidth={2}
                  />
                  <span className="hidden sm:inline">
                    Sort:{" "}
                    <b className="font-semibold text-ink-900">
                      {sortLabel(sortKey, sortDir)}
                    </b>
                  </span>
                  <ChevronDown
                    className={clsx(
                      "hidden h-[13px] w-[13px] text-ink-300 transition sm:block",
                      sortOpen && "rotate-180",
                    )}
                    strokeWidth={2}
                  />
                </button>

                {sortOpen ? (
                  <div
                    className="absolute right-0 top-[calc(100%+8px)] z-40 w-[230px] origin-top-right rounded-[14px] border border-ink-100 bg-white p-3 shadow-[0_8px_20px_rgba(16,25,40,.10),0_24px_60px_rgba(16,25,40,.16)]"
                    role="menu"
                    aria-label="Sort bills"
                  >
                    <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-300">
                      Direction
                    </p>
                    <div className="mb-3 grid grid-cols-2 gap-0.5 rounded-[10px] bg-[#EEF0F3] p-[3px]">
                      {(
                        [
                          { value: "desc" as const, label: "High → Low" },
                          { value: "asc" as const, label: "Low → High" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={clsx(
                            "rounded-[7px] px-2 py-1.5 text-center text-xs transition",
                            sortDir === option.value
                              ? "bg-white font-semibold text-ink-900 shadow-soft"
                              : "font-medium text-ink-500 hover:text-ink-900",
                          )}
                          onClick={() => setSortDir(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-300">
                      Sort by
                    </p>
                    <div className="space-y-0.5">
                      {SORT_FIELD_OPTIONS.map((option) => {
                        const on = sortKey === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            role="menuitemradio"
                            aria-checked={on}
                            className={clsx(
                              "flex w-full items-center justify-between rounded-[9px] px-2.5 py-2 text-left text-[13.5px] transition",
                              on
                                ? "bg-tide-100/60 font-semibold text-ink-900"
                                : "font-medium text-ink-500 hover:bg-[#F4F5F7] hover:text-ink-900",
                            )}
                            onClick={() => setSortKey(option.key)}
                          >
                            {option.label}
                            <Check
                              className={clsx(
                                "h-[15px] w-[15px] text-tide-600",
                                on ? "opacity-100" : "opacity-0",
                              )}
                              strokeWidth={2.6}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              <Link
                to="/bills"
                className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold text-ink-900 transition hover:bg-ink-50 dark:hover:bg-surface-muted"
              >
                View all →
              </Link>
            </div>
          </div>

          {sortedBills.length === 0 ? (
            <EmptyState
              title="No bills in this period"
              description="Bills created in the selected timeline will show here with cost and selling price."
            />
          ) : (
            <motion.section
            variants={riseIn}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.05 }}
            custom={4}
           
              className="overflow-hidden rounded-2xl border border-ink-100/80 bg-white/90 shadow-soft"
              aria-label={`Bills for ${data.periodLabel}`}
            >
              <div
                className={`hidden gap-3 border-b border-ink-100 bg-[#FAFBFC] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-300 sm:grid ${billsRowGrid}`}
              >
                <span>Customer</span>
                {showSoldDate ? <span>Sold date</span> : null}
                <span className="text-right">Cost</span>
                <span className="text-right">Selling</span>
                <span className="text-right">Profit</span>
              </div>

              {billsReveal.visibleItems.map((bill, index) => (
                <Link
                  key={bill.entryId ?? bill.id}
                  to={`/bills/${bill.id}`}
                  state={fromState(location)}
                  className={`interactive-card-row border-b border-ink-100 px-4 py-3.5 last:border-b-0 sm:grid sm:items-center sm:gap-3 sm:px-5 ${billsRowGrid}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] font-display text-[13px] font-bold text-white"
                      style={{
                        background:
                          AVATAR_COLORS[index % AVATAR_COLORS.length],
                      }}
                    >
                      {initials(bill.customerName)}
                    </div>
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink-900">
                        <span className="truncate">{bill.customerName}</span>
                        {bill.kind === "REPLACED" || bill.kind === "RETURNED" ? (
                          <span
                            className={clsx(
                              "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                              bill.kind === "RETURNED"
                                ? "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                            )}
                          >
                            {bill.kind === "RETURNED"
                              ? `Returned · ${bill.refundMethod === "online" ? "Online" : "Cash"}`
                              : "Replaced"}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-ink-500">
                        {bill.invoiceNumber}
                        {bill.productLabel !== "—"
                          ? ` · ${bill.productLabel}`
                          : ""}
                      </p>
                    </div>
                  </div>

                  {showSoldDate ? (
                    <div className="mt-2 text-[13.5px] text-ink-700 sm:mt-0">
                      <span className="text-ink-500 sm:hidden">
                        {bill.kind === "RETURNED"
                          ? "Returned · "
                          : bill.kind === "REPLACED"
                            ? "Replaced · "
                            : "Sold · "}
                      </span>
                      {format(new Date(bill.billDate), "dd MMM yyyy")}
                    </div>
                  ) : null}

                  <div className="mt-2 grid grid-cols-3 gap-2 sm:mt-0 sm:contents">
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300 sm:hidden">
                        Cost
                      </p>
                      <p className="text-[14px] tabular-nums text-ink-700 sm:text-[15px]">
                        {bill.kind === "REPLACED" ? "—" : formatINR(bill.costPrice)}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300 sm:hidden">
                        Selling
                      </p>
                      <p
                        className={clsx(
                          "text-[14px] font-semibold tabular-nums sm:text-[15px]",
                          bill.sellingPrice < 0 ? "text-[#E5484D]" : "text-ink-900",
                        )}
                      >
                        {bill.kind === "REPLACED" ? "—" : formatINR(bill.sellingPrice)}
                      </p>
                      {(bill.exchangeValue || 0) > 0 ? (
                        <p className="text-[11px] font-medium text-[#B76E00]">
                          incl. {formatINR(bill.exchangeValue || 0)} exchange
                        </p>
                      ) : null}
                      {(bill.companyDiscount || 0) > 0 ? (
                        <p className="text-[11px] font-medium text-[#0E9E76]">
                          incl. {formatINR(bill.companyDiscount || 0)} cashback
                        </p>
                      ) : null}
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300 sm:hidden">
                        Profit
                      </p>
                      <p
                        className={`font-display text-[14px] font-bold tabular-nums sm:text-[15px] ${
                          bill.kind === "REPLACED"
                            ? "text-ink-400"
                            : bill.profit >= 0
                              ? "text-[#0E9E76]"
                              : "text-[#E5484D]"
                        }`}
                      >
                        {bill.kind === "REPLACED" ? "—" : formatINR(bill.profit)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}

              <LoadMoreSentinel
                sentinelRef={billsReveal.sentinelRef}
                hasMore={billsReveal.hasMore}
                loadingMore={billsReveal.loadingMore}
                totalCount={billsReveal.totalCount}
                showEnd={false}
              />

              <div
                className={`grid items-center gap-3 border-t-2 border-ink-900 bg-[#F7F9FC] px-4 py-3.5 sm:px-5 ${billsRowGrid}`}
              >
                <p
                  className="font-display text-sm font-semibold text-ink-900 sm:col-span-1"
                  style={
                    showSoldDate
                      ? { gridColumn: "1 / span 2" }
                      : undefined
                  }
                >
                  Total
                </p>
                <p className="hidden text-right text-[13.5px] font-bold tabular-nums text-ink-900 sm:block">
                  {formatINR(billTotals.cost)}
                </p>
                <p className="hidden text-right text-[13.5px] font-bold tabular-nums text-ink-900 sm:block">
                  {formatINR(billTotals.sell)}
                </p>
                <p className="hidden text-right font-display text-[15px] font-bold tabular-nums text-[#0E9E76] sm:block">
                  {formatINR(billTotals.profit)}
                </p>
                <div className="col-span-full grid grid-cols-3 gap-2 sm:hidden">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                      Cost
                    </p>
                    <p className="text-sm font-bold tabular-nums text-ink-900">
                      {formatINR(billTotals.cost)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                      Selling
                    </p>
                    <p className="text-sm font-bold tabular-nums text-ink-900">
                      {formatINR(billTotals.sell)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">
                      Profit
                    </p>
                    <p className="font-display text-sm font-bold tabular-nums text-[#0E9E76]">
                      {formatINR(billTotals.profit)}
                    </p>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </>
      ) : null}

      <style>{`
        @keyframes analytics-mix-grow { to { transform: scaleX(1); } }
        @media (prefers-reduced-motion: reduce) {
          [style*="analytics-mix-grow"] { animation: none !important; transform: scaleX(1) !important; }
        }
      `}      </style>
    </div>
  );
}
