import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import {
  Banknote,
  ChartColumn,
  Clock3,
  MonitorSmartphone,
  Search,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import {
  ACTIVITY_PERIOD_OPTIONS,
  type AnalyticsPeriodValue,
} from "../components/PeriodFilter";
import { BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { type PaymentMode } from "../lib/analyticsNav";
import { fromState } from "../lib/navMemory";
import { api, formatINR } from "../lib/api";
import type { AnalyticsSummary } from "../types";
import { MIX, mixSurface, type MixTone } from "../lib/analyticsMix";
import { useTheme } from "../theme/ThemeContext";

const AVATAR_COLORS = [
  MIX.cash.color,
  MIX.online.color,
  MIX.finance.color,
  MIX.due.color,
  "#0E1626",
];

const PERIODS = ACTIVITY_PERIOD_OPTIONS.map((option) => option.value);

type SortKey = "amount" | "date";
type SourceRow = NonNullable<AnalyticsSummary["paymentSources"]>[number];

const MODE_META: Record<
  PaymentMode,
  {
    name: string;
    verb: string;
    countLabel: string;
    colors: MixTone;
    icon: LucideIcon;
  }
> = {
  cash: {
    name: "Cash",
    verb: "Received via cash",
    countLabel: "Payments",
    colors: MIX.cash,
    icon: Banknote,
  },
  online: {
    name: "Online",
    verb: "Received via online (UPI / card)",
    countLabel: "Payments",
    colors: MIX.online,
    icon: MonitorSmartphone,
  },
  finance: {
    name: "Finance",
    verb: "Financed (EMI)",
    countLabel: "Loans",
    colors: MIX.finance,
    icon: ChartColumn,
  },
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function amountFor(row: SourceRow, mode: PaymentMode) {
  if (mode === "cash") return row.cashAmount;
  if (mode === "online") return row.onlineAmount;
  return row.financeAmount;
}

function readPeriod(search: URLSearchParams): {
  period: AnalyticsPeriodValue;
  customFrom: string;
  customTo: string;
} {
  const customFrom = search.get("from") || "";
  const customTo = search.get("to") || "";
  if (customFrom || customTo) {
    return { period: "custom", customFrom, customTo };
  }
  const raw = search.get("period");
  if (raw && (PERIODS as readonly string[]).includes(raw)) {
    return {
      period: raw as AnalyticsPeriodValue,
      customFrom: "",
      customTo: "",
    };
  }
  return { period: "all", customFrom: "", customTo: "" };
}

function readMode(search: URLSearchParams): PaymentMode {
  const raw = search.get("mode");
  if (raw === "online" || raw === "finance" || raw === "cash") return raw;
  return "cash";
}

export function AnalyticsPaymentsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = readMode(searchParams);
  const { period, customFrom, customTo } = readPeriod(searchParams);

  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("amount");

  const customRangeReady =
    period === "custom" && Boolean(customFrom || customTo);

  useEffect(() => {
    if (searchParams.get("mode") === "due") {
      navigate("/dues", { replace: true, state: fromState(location) });
    }
  }, [location, navigate, searchParams]);

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
            err instanceof Error ? err.message : "Failed to load payments",
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

  const rows = useMemo(() => {
    const sources = data?.paymentSources ?? [];
    const needle = query.trim().toLowerCase();
    const filtered = sources
      .map((row) => ({ row, amount: amountFor(row, mode) }))
      .filter(({ amount }) => amount > 0)
      .filter(({ row }) => {
        if (!needle) return true;
        return `${row.customerName} ${row.invoiceNumber}`
          .toLowerCase()
          .includes(needle);
      });
    filtered.sort((a, b) => {
      if (sort === "amount") return b.amount - a.amount;
      return (
        new Date(b.row.billDate).getTime() - new Date(a.row.billDate).getTime()
      );
    });
    return filtered;
  }, [data?.paymentSources, mode, query, sort]);

  const listReveal = useInfiniteReveal(
    rows,
    `${mode}|${sort}|${query}|${rows.length}`,
  );

  const meta = MODE_META[mode];
  const ModeIcon = meta.icon;
  const summary = data?.summary;
  const mixTotal = summary?.mixTotal || 0;
  const modeTotal =
    mode === "cash"
      ? summary?.cash ?? 0
      : mode === "online"
        ? summary?.online ?? 0
        : summary?.finance ?? 0;
  const share = mixTotal > 0 ? Math.round((modeTotal / mixTotal) * 100) : 0;

  function setMode(next: PaymentMode) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("mode", next);
    setSearchParams(nextParams, { replace: true });
  }

  function goDue() {
    navigate("/dues", { state: fromState(location) });
  }

  return (
    <div>
      <BackLink to="/analytics" className="mb-4">
        Back to analytics
      </BackLink>
      <p className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        Payment breakdown · {data?.periodLabel || "All time"}
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {(
          [
            ["cash", MODE_META.cash, summary?.cash ?? 0],
            ["online", MODE_META.online, summary?.online ?? 0],
            ["finance", MODE_META.finance, summary?.finance ?? 0],
          ] as const
        ).map(([key, item, value]) => {
          const Icon = item.icon;
          const on = mode === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={clsx(
                "rounded-[14px] border-[1.5px] bg-white/90 p-3.5 text-left shadow-soft transition hover:-translate-y-0.5",
                on ? "shadow-lift" : "border-ink-100 hover:border-[#DCE2EA]",
              )}
              style={on ? { borderColor: item.colors.color } : undefined}
            >
              <div className="mb-2.5 flex items-center gap-2">
                <span
                  className="grid h-7 w-7 place-items-center rounded-[8px]"
                  style={mixSurface(item.colors, dark)}
                >
                  <Icon className="h-[15px] w-[15px]" strokeWidth={2.2} />
                </span>
                <span className="text-[12.5px] font-medium text-ink-400">
                  {item.name}
                </span>
              </div>
              <p className="font-display text-lg font-bold tabular-nums text-ink-900">
                {formatINR(value)}
              </p>
            </button>
          );
        })}
        <button
          type="button"
          onClick={goDue}
          className="rounded-[14px] border-[1.5px] border-ink-100 bg-white/90 p-3.5 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-[#DCE2EA]"
        >
          <div className="mb-2.5 flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-[8px]"
              style={mixSurface(MIX.due, dark)}
            >
              <Clock3 className="h-[15px] w-[15px]" strokeWidth={2.2} />
            </span>
            <span className="text-[12.5px] font-medium text-ink-400">Due</span>
          </div>
          <p className="font-display text-lg font-bold tabular-nums text-ink-900">
            {formatINR(summary?.due ?? 0)}
          </p>
        </button>
      </div>

      {loading ? <LoadingBlock label="Loading payments…" /> : null}
      {error ? (
        <div className="glass-panel px-5 py-4 text-sm text-ember-500">{error}</div>
      ) : null}

      {data && !loading ? (
        <>
          <div className="relative mb-4 overflow-hidden rounded-2xl border border-ink-100/80 bg-white/90 px-6 py-5 shadow-soft">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-[170px] w-[170px] rounded-full opacity-50"
              style={{
                background: `radial-gradient(circle, ${
                  dark ? meta.colors.softDark : meta.colors.soft
                }, transparent 70%)`,
              }}
            />
            <div className="relative flex flex-wrap items-center gap-5">
              <span
                className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[15px]"
                style={mixSurface(meta.colors, dark)}
              >
                <ModeIcon className="h-[26px] w-[26px]" strokeWidth={2.1} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                  {meta.verb}
                </p>
                <p
                  className="mt-1 font-display text-[32px] font-bold leading-none tabular-nums"
                  style={{ color: dark ? meta.colors.inkDark : meta.colors.ink }}
                >
                  {formatINR(modeTotal)}
                </p>
              </div>
              <div className="ml-auto flex gap-7 max-sm:ml-0 max-sm:w-full max-sm:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-400">
                    {meta.countLabel}
                  </p>
                  <p className="mt-1 font-display text-[19px] font-bold tabular-nums text-ink-900">
                    {rows.length}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-ink-400">
                    Share of billed
                  </p>
                  <p className="mt-1 font-display text-[19px] font-bold tabular-nums text-ink-900">
                    {share}%
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <div className="tb-search min-h-11">
              <Search className="h-[17px] w-[17px] shrink-0 text-ink-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search customer or invoice…"
                aria-label="Search customer or invoice"
              />
            </div>
            <div className="inline-flex gap-0.5 rounded-[10px] bg-[#EBEDF1] p-[3px]">
              {(
                [
                  { key: "amount", label: "By amount" },
                  { key: "date", label: "By date" },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={clsx(
                    "rounded-[8px] px-3.5 py-1.5 text-[12.5px] transition",
                    sort === option.key
                      ? "bg-white font-semibold text-ink-900 shadow-soft"
                      : "font-medium text-ink-500",
                  )}
                  onClick={() => setSort(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {listReveal.visibleItems.length === 0 ? (
            <EmptyState
              title={query.trim() ? `No ${mode} payments match` : `No ${mode} payments`}
              description={
                query.trim()
                  ? "Try another search, or clear the search box."
                  : "Bills with this payment mode will show here."
              }
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {listReveal.visibleItems.map(({ row, amount }, index) => (
                <Link
                  key={row.id}
                  to={`/bills/${row.id}`}
                  state={fromState({
                    pathname: location.pathname,
                    search: location.search,
                  })}
                  className="relative flex cursor-pointer items-center gap-3.5 overflow-hidden rounded-[14px] border border-ink-100/80 bg-white/90 px-4 py-3.5 shadow-soft transition hover:-translate-y-0.5 hover:border-[#DCE2EA]"
                >
                  <span
                    aria-hidden
                    className="absolute bottom-[11px] left-0 top-[11px] w-[3px] rounded-[3px]"
                    style={{ background: meta.colors.color }}
                  />
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] font-display text-[13px] font-bold text-white"
                    style={{
                      background:
                        AVATAR_COLORS[index % AVATAR_COLORS.length],
                    }}
                  >
                    {initials(row.customerName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold text-ink-900">
                      {row.customerName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-400">
                      {row.invoiceNumber}
                      <span className="mx-1.5 opacity-50">·</span>
                      {format(new Date(row.billDate), "dd MMM")}
                    </p>
                    {mode === "finance" && row.financeLabel ? (
                      <p className="mt-1 text-[11.5px] font-semibold text-[#7C3AED]">
                        ● via {row.financeLabel}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-base font-bold tabular-nums text-ink-900">
                      {formatINR(amount)}
                    </p>
                    {amount + 0.005 < row.billTotal ? (
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        of {formatINR(row.billTotal)} bill
                      </p>
                    ) : null}
                  </div>
                </Link>
              ))}
              <LoadMoreSentinel
                sentinelRef={listReveal.sentinelRef}
                hasMore={listReveal.hasMore}
                loadingMore={listReveal.loadingMore}
                totalCount={listReveal.totalCount}
                showEnd={false}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
