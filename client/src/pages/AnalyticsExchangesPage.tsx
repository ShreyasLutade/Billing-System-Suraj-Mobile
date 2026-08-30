import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowDownUp, Search } from "lucide-react";
import clsx from "clsx";
import {
  ACTIVITY_PERIOD_OPTIONS,
  PeriodFilter,
  type AnalyticsPeriodValue,
} from "../components/PeriodFilter";
import { BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { analyticsExchangesPath } from "../lib/analyticsNav";
import { fromState } from "../lib/navMemory";
import { api, formatINR, formatStockUnitId } from "../lib/api";
import type { AnalyticsExchangeItem, AnalyticsExchangesSummary } from "../types";
import { MIX, mixSurface } from "../lib/analyticsMix";
import { useTheme } from "../theme/ThemeContext";
import { matchesElasticFields } from "../lib/elasticSearch";

const PERIODS = ACTIVITY_PERIOD_OPTIONS.map((option) => option.value);

function readPeriod(search: URLSearchParams): {
  period: AnalyticsPeriodValue;
  customFrom: string;
  customTo: string;
} {
  const from = search.get("from") || "";
  const to = search.get("to") || "";
  if (from || to) {
    return { period: "custom", customFrom: from, customTo: to };
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

function formatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "dd MMM yyyy");
}

function productLabel(item: AnalyticsExchangeItem) {
  const parts = [
    item.mobileName,
    item.color,
    item.storage,
    item.platform === "ANDROID" && item.ram ? item.ram : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function AnalyticsExchangesPage() {
  const location = useLocation();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [searchParams, setSearchParams] = useSearchParams();
  const { period, customFrom, customTo } = readPeriod(searchParams);

  const [data, setData] = useState<AnalyticsExchangesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const customRangeReady =
    period === "custom" && Boolean(customFrom || customTo);

  function setPeriod(next: AnalyticsPeriodValue) {
    setSearchParams(
      () => {
        const params = new URLSearchParams(
          analyticsExchangesPath(
            next,
            next === "custom" ? customFrom : "",
            next === "custom" ? customTo : "",
          ).split("?")[1] || "",
        );
        return params;
      },
      { replace: true },
    );
  }

  function setCustomFrom(value: string) {
    setSearchParams(
      () => {
        const params = new URLSearchParams(
          analyticsExchangesPath("custom", value, customTo).split("?")[1] || "",
        );
        return params;
      },
      { replace: true },
    );
  }

  function setCustomTo(value: string) {
    setSearchParams(
      () => {
        const params = new URLSearchParams(
          analyticsExchangesPath("custom", customFrom, value).split("?")[1] ||
            "",
        );
        return params;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    if (period === "custom" && !customRangeReady) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const response = await api.analyticsExchanges(
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
            err instanceof Error
              ? err.message
              : "Failed to load exchange mobiles",
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
    const items = data?.items ?? [];
    if (!query.trim()) return items;
    return items.filter((item) =>
      matchesElasticFields(
        [
          item.mobileName,
          item.color,
          item.storage,
          item.ram,
          item.imei,
          item.serialNumber || "",
          item.customerName,
          item.customerPhone || "",
          item.invoiceNumber,
          item.status,
        ],
        query,
      ),
    );
  }, [data?.items, query]);

  const listTotal = useMemo(
    () => rows.reduce((sum, row) => sum + row.value, 0),
    [rows],
  );

  const reveal = useInfiniteReveal(
    rows,
    `${period}|${customFrom}|${customTo}|${query}|${rows.length}`,
  );

  return (
    <div>
      <BackLink to="/analytics" state={fromState(location)}>
        Back to analytics
      </BackLink>

      <div className="mb-4 mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            Exchange intake
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink-900">
            Exchange mobiles
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Phones taken in from customers during sales
            {data?.periodLabel ? ` · ${data.periodLabel}` : ""}.
          </p>
        </div>
        <div
          className="grid h-11 w-11 place-items-center rounded-[12px]"
          style={mixSurface(MIX.exchange, dark)}
        >
          <ArrowDownUp className="h-5 w-5" strokeWidth={2.1} />
        </div>
      </div>

      <div className="mb-5">
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

      {loading ? <LoadingBlock label="Loading exchanges…" /> : null}
      {error ? (
        <div className="mb-3 rounded-[14px] border border-orange-100 bg-orange-50 px-5 py-4 text-sm text-ember-500">
          {error}
        </div>
      ) : null}

      {data && !loading ? (
        <>
          <section className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-soft">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Total value
              </p>
              <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink-900">
                {formatINR(query.trim() ? listTotal : data.totalValue)}
              </p>
            </div>
            <div className="rounded-xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-soft">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Units taken in
              </p>
              <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink-900">
                {query.trim() ? rows.length : data.count}
              </p>
            </div>
          </section>

          <div className="mb-3">
            <label className="tb-search">
              <Search className="h-4 w-4 shrink-0 text-ink-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search model, IMEI, customer, invoice…"
                aria-label="Search exchange mobiles"
              />
            </label>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={query.trim() ? "No matching exchanges" : "No exchange mobiles"}
              description={
                query.trim()
                  ? "Try another search, or clear the search box."
                  : "No customer exchange phones were taken in for this period."
              }
            />
          ) : (
            <div className="space-y-1.5">
              {reveal.visibleItems.map((item) => {
                const inStock = item.status === "AVAILABLE";
                const imeiLabel = formatStockUnitId(item);
                const detail = (
                  <article
                    className={clsx(
                      "interactive-card rounded-xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-sm",
                      item.billId && "block",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-ink-900">
                          {productLabel(item)}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          <span className="font-mono font-medium text-ink-700 dark:text-ink-800">
                            {imeiLabel}
                          </span>
                          <span className="text-ink-300"> · </span>
                          {item.customerName}
                          <span className="text-ink-300"> · </span>
                          <span className="font-mono text-tide-600">
                            {item.invoiceNumber || "—"}
                          </span>
                          <span className="text-ink-300"> · </span>
                          {formatDay(item.purchaseDate)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <span
                          className={clsx(
                            "rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
                            inStock
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                          )}
                        >
                          {inStock ? "In stock" : "Sold"}
                        </span>
                        <p className="text-sm font-semibold tabular-nums text-ink-900">
                          {formatINR(item.value)}
                        </p>
                      </div>
                    </div>
                  </article>
                );

                return item.billId ? (
                  <Link
                    key={item.id}
                    to={`/bills/${item.billId}`}
                    state={fromState(location)}
                    className="block"
                  >
                    {detail}
                  </Link>
                ) : (
                  <div key={item.id}>{detail}</div>
                );
              })}
              <LoadMoreSentinel
                sentinelRef={reveal.sentinelRef}
                hasMore={reveal.hasMore}
                loadingMore={reveal.loadingMore}
                totalCount={reveal.totalCount}
                showEnd={false}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
