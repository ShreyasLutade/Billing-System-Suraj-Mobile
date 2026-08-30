import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowDownUp,
  Banknote,
  ChartColumn,
  Check,
  ChevronDown,
  Clock3,
  Headphones,
  MonitorSmartphone,
} from "lucide-react";
import clsx from "clsx";
import {
  PeriodFilter,
  type AnalyticsPeriodValue,
} from "../components/PeriodFilter";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { api, formatINR } from "../lib/api";
import type { AnalyticsSummary } from "../types";
import { fromState } from "../lib/navMemory";
import { analyticsPaymentsPath, type PaymentMode } from "../lib/analyticsNav";
import { MIX, mixSurface } from "../lib/analyticsMix";
import { useTheme } from "../theme/ThemeContext";

const AVATAR_COLORS = [
  MIX.cash.color,
  MIX.online.color,
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

export function AnalyticsPage() {
  const location = useLocation();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<AnalyticsPeriodValue>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sortKey, setSortKey] = useState<BillSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef<HTMLDivElement>(null);

  const customRangeReady =
    period === "custom" && Boolean(customFrom || customTo);

  useEffect(() => {
    if (period === "custom" && !customRangeReady) return;

    let active = true;
    setLoading(true);
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
  );

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
  const showSoldDate = data != null && data.period !== "today";
  const billsRowGrid = showSoldDate
    ? "sm:grid-cols-[minmax(0,1.5fr)_1fr_0.9fr_0.9fr_0.9fr]"
    : "sm:grid-cols-[minmax(0,1.8fr)_0.9fr_0.9fr_0.9fr]";
  const mixSegments = summary
    ? [
        { key: "cash", width: shares?.cash ?? 0, color: MIX.cash.color },
        { key: "online", width: shares?.online ?? 0, color: MIX.online.color },
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
          name: "Online · UPI / card",
          value: summary.online,
          share: shares?.online ?? 0,
          colors: MIX.online,
          icon: MonitorSmartphone,
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
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Analytics"
        description="Where your money came from and what's still owed — cash, online, finance, and dues."
      />
      <div className="mb-5 sm:mb-6">
        <PeriodFilter
          allowCustom
          value={period}
          onChange={setPeriod}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />
      </div>

      {loading ? <LoadingBlock label="Calculating…" /> : null}
      {error ? (
        <div className="glass-panel px-5 py-4 text-sm text-ember-500">{error}</div>
      ) : null}

      {data && summary && !loading ? (
        <>
          <section className="mb-4 grid gap-4 lg:grid-cols-[1.7fr_1fr]">
            {/* Hero — total collected + payment mix */}
            <div className="relative overflow-hidden rounded-[1.125rem] bg-[radial-gradient(120%_140%_at_0%_0%,#1B2740_0%,#0E1626_55%)] p-6 text-white shadow-lift sm:p-7">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-50"
                style={{
                  background:
                    "radial-gradient(60% 90% at 92% 8%, rgba(18,184,134,.16), transparent 60%)",
                }}
              />
              <div className="relative">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8EA0BC]">
                  Total collected · {data.periodLabel.toLowerCase()}
                </p>
                <p className="mt-2.5 font-display text-[clamp(2.125rem,6vw,3.25rem)] font-bold leading-none tracking-tight tabular-nums">
                  {formatINR(summary.collected)}
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8EA0BC]">
                      Profit earned
                    </p>
                    <p
                      className={`mt-1 font-display text-xl font-bold leading-none tabular-nums sm:text-2xl ${
                        (summary.profit ?? 0) >= 0
                          ? "text-[#5CE0AE]"
                          : "text-orange-300"
                      }`}
                    >
                      {formatINR(summary.profit ?? 0)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[#A9B6CC]">
                  <span>
                    Across{" "}
                    <b className="font-semibold text-white">{summary.bills}</b>{" "}
                    bill{summary.bills === 1 ? "" : "s"}
                  </span>
                  {change && data.vsPrevious.label ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        <span
                          className={
                            change.up === true
                              ? "font-semibold text-[#5CE0AE]"
                              : change.up === false
                                ? "font-semibold text-orange-300"
                                : "font-semibold text-white"
                          }
                        >
                          {change.text}
                        </span>{" "}
                        {data.vsPrevious.label}
                      </span>
                    </>
                  ) : null}
                </div>

                <div className="mt-6">
                  <div
                    className="flex h-3.5 overflow-hidden rounded-lg bg-white/10"
                    role="img"
                    aria-label={`Payment mix: cash ${formatShare(shares?.cash ?? 0)}, online ${formatShare(shares?.online ?? 0)}, finance ${formatShare(shares?.finance ?? 0)}, dues ${formatShare(shares?.due ?? 0)}`}
                  >
                    {mixSegments.map((seg, i) =>
                      seg.width > 0 ? (
                        <span
                          key={seg.key}
                          className="block h-full origin-left scale-x-0 motion-reduce:scale-x-100"
                          style={{
                            width: `${seg.width}%`,
                            background: seg.color,
                            animation:
                              "analytics-mix-grow .9s cubic-bezier(.22,1,.36,1) forwards",
                            animationDelay: `${0.05 + i * 0.09}s`,
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[#C4CEDD]">
                    {(
                      [
                        ["Cash", MIX.cash.color, shares?.cash ?? 0],
                        ["Online", MIX.online.color, shares?.online ?? 0],
                        ["Finance", MIX.finance.color, shares?.finance ?? 0],
                        ["Dues", MIX.due.color, shares?.due ?? 0],
                      ] as const
                    ).map(([label, color, share]) => (
                      <div key={label} className="flex items-center gap-2">
                        <span
                          className="block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                          style={{ background: color }}
                        />
                        {label}{" "}
                        <b className="font-semibold text-white">
                          {formatShare(share)}
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Outstanding + stock */}
            <div className="relative flex flex-col overflow-hidden rounded-[1.125rem] border border-ink-100/80 bg-white/90 p-6 shadow-soft">
              <div
                aria-hidden
                className="absolute bottom-0 left-0 top-0 w-1"
                style={{ background: MIX.due.color }}
              />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
                Total outstanding
              </p>
              <p className="mt-3.5 font-display text-[2.375rem] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
                {formatINR(data.outstandingDue.amount)}
              </p>
              <span
                className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={mixSurface(MIX.due, dark)}
              >
                ● Pending across {data.outstandingDue.count} bill
                {data.outstandingDue.count === 1 ? "" : "s"}
              </span>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-4 text-[13px] text-ink-500">
                <span>
                  {data.outstandingDue.oldestDueDays != null
                    ? `Oldest due · ${data.outstandingDue.oldestDueDays} day${data.outstandingDue.oldestDueDays === 1 ? "" : "s"}`
                    : "No overdue yet"}
                </span>
                <Link
                  to="/dues"
                  state={fromState(location)}
                  className="font-semibold text-ink-900 transition hover:text-[#B76E00]"
                >
                  Collect now →
                </Link>
          </div>

              <div className="mt-4 border-t border-ink-100 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
                  Stock on hand
                </p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="font-display text-2xl font-bold leading-none tracking-tight text-ink-900 tabular-nums">
                      {data.stockOnHand?.count ?? 0}
                    </p>
                    <p className="mt-1 text-[13px] text-ink-500">
                      mobile{(data.stockOnHand?.count ?? 0) === 1 ? "" : "s"}{" "}
                      available
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                      Total value
                    </p>
                    <p className="mt-1 font-display text-lg font-bold tabular-nums text-ink-900">
                      {formatINR(data.stockOnHand?.value ?? 0)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Link
                    to="/stock"
                    className="text-[13px] font-semibold text-ink-900 transition hover:text-tide-600"
                  >
                    View stock →
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* KPI cards */}
          <section
            className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Payment breakdown"
          >
            {kpis.map((kpi) => {
              const Icon = kpi.icon;
              const to =
                kpi.key === "due"
                  ? "/dues"
                  : analyticsPaymentsPath(
                      kpi.key as PaymentMode,
                      period,
                      customFrom,
                      customTo,
                    );
              return (
                <Link
                  key={kpi.key}
                  to={to}
                  state={fromState(location)}
                  className="group rounded-2xl border border-ink-100/80 bg-white/90 p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div
                      className="grid h-[34px] w-[34px] place-items-center rounded-[10px]"
                      style={mixSurface(kpi.colors, dark)}
                    >
                      <Icon className="h-[17px] w-[17px]" strokeWidth={2.25} />
                    </div>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-bold"
                      style={mixSurface(kpi.colors, dark)}
                    >
                      {formatShare(kpi.share)}
                    </span>
                  </div>
                  <p className="mb-1 text-[12.5px] font-medium text-ink-500">
                    {kpi.name}
                  </p>
                  <p className="font-display text-2xl font-bold leading-tight tracking-tight text-ink-900 tabular-nums">
                    {formatINR(kpi.value)}
                  </p>
                </Link>
              );
            })}
          </section>

          <section
            className="mb-8 overflow-hidden rounded-[1.125rem] border border-ink-100/80 bg-white/90 p-5 shadow-soft sm:p-6"
            aria-label="Accessories revenue"
          >
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div className="flex min-w-0 items-start gap-3.5">
                <div
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px]"
                  style={mixSurface(MIX.online, dark)}
                >
                  <Headphones className="h-5 w-5" strokeWidth={2.1} />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                    Accessories revenue
                  </p>
                  <p className="mt-1.5 font-display text-[clamp(1.5rem,4vw,2rem)] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
                    {formatINR(summary.accessoriesRevenue ?? 0)}
                  </p>
                  <p className="mt-2 text-[13px] text-ink-500">
                    Cases, glass, chargers, earphones & more
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                  Items sold
                </p>
                <p className="mt-1.5 font-display text-2xl font-bold tabular-nums text-ink-900">
                  {summary.accessoriesSold ?? 0}
                </p>
              </div>
            </div>
          </section>

          {/* Period bills */}
          <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-[19px] font-semibold text-ink-900">
                Bills · {data.periodLabel}
              </h2>
              <p className="mt-0.5 text-[13px] text-ink-500">
                Mobile cost vs selling price. Exchange is not deducted; cashback
                is included. Accessories are counted separately above.
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
                                ? "bg-[#F1F5FF] font-semibold text-ink-900"
                                : "font-medium text-ink-500 hover:bg-[#F4F5F7] hover:text-ink-900",
                            )}
                            onClick={() => setSortKey(option.key)}
                          >
                            {option.label}
                            <Check
                              className={clsx(
                                "h-[15px] w-[15px] text-[#2563EB]",
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
            <section
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
                  key={bill.id}
                  to={`/bills/${bill.id}`}
                  state={fromState(location)}
                  className={`block border-b border-ink-100 px-4 py-3.5 transition last:border-b-0 hover:bg-[#F7FAFF] dark:hover:bg-surface-muted sm:grid sm:items-center sm:gap-3 sm:px-5 ${billsRowGrid}`}
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
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {bill.customerName}
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
                      <span className="text-ink-500 sm:hidden">Sold · </span>
                      {format(new Date(bill.billDate), "dd MMM yyyy")}
                    </div>
                  ) : null}

                  <div className="mt-2 grid grid-cols-3 gap-2 sm:mt-0 sm:contents">
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300 sm:hidden">
                        Cost
                      </p>
                      <p className="text-[14px] tabular-nums text-ink-700 sm:text-[15px]">
                        {formatINR(bill.costPrice)}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300 sm:hidden">
                        Selling
                      </p>
                      <p className="text-[14px] font-semibold tabular-nums text-ink-900 sm:text-[15px]">
                        {formatINR(bill.sellingPrice)}
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
                          bill.profit >= 0
                            ? "text-[#0E9E76]"
                            : "text-[#E5484D]"
                        }`}
                      >
                        {formatINR(bill.profit)}
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
            </section>
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
