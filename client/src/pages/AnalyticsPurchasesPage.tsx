import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Search, ShoppingBag } from "lucide-react";
import clsx from "clsx";
import {
  ACTIVITY_PERIOD_OPTIONS,
  PeriodFilter,
  type AnalyticsPeriodValue,
} from "../components/PeriodFilter";
import { BackLink, EmptyState, LoadingBlock, SearchClearButton } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { useSessionState } from "../hooks/useSessionState";
import { analyticsPurchasesPath } from "../lib/analyticsNav";
import { fromState } from "../lib/navMemory";
import { api, formatINR } from "../lib/api";
import { formatCapacityLabel } from "../lib/phoneModelSearch";
import type { AnalyticsPurchasesSummary } from "../types";
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

/** Mobiles bought from suppliers in the chosen period. */
export function AnalyticsPurchasesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [searchParams, setSearchParams] = useSearchParams();
  const { period, customFrom, customTo } = readPeriod(searchParams);

  const [data, setData] = useState<AnalyticsPurchasesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useSessionState("analytics.purchases.query", "");

  const customRangeReady =
    period === "custom" && Boolean(customFrom || customTo);

  function setRange(next: AnalyticsPeriodValue, from: string, to: string) {
    setSearchParams(
      new URLSearchParams(analyticsPurchasesPath(next, from, to).split("?")[1] || ""),
      { replace: true },
    );
  }

  useEffect(() => {
    if (period === "custom" && !customRangeReady) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const response = await api.analyticsPurchases(
          period === "custom" ? "all" : period,
          period === "custom" && customRangeReady
            ? { from: customFrom || undefined, to: customTo || undefined }
            : undefined,
        );
        if (active) {
          setData(response.data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load purchase history",
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
          item.supplierName,
        ],
        query,
      ),
    );
  }, [data?.items, query]);

  const listTotal = useMemo(
    () => rows.reduce((sum, row) => sum + row.price, 0),
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
            Purchases
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink-900">
            Purchase history
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Mobiles bought from suppliers
            {data?.periodLabel ? ` · ${data.periodLabel}` : ""}.
          </p>
        </div>
        <div
          className="grid h-11 w-11 place-items-center rounded-[12px]"
          style={mixSurface(MIX.purchase, dark)}
        >
          <ShoppingBag className="h-5 w-5" strokeWidth={2.1} />
        </div>
      </div>

      <div className="mb-5">
        <PeriodFilter
          allowCustom
          value={period}
          onChange={(next) =>
            setRange(
              next,
              next === "custom" ? customFrom : "",
              next === "custom" ? customTo : "",
            )
          }
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={(value) => setRange("custom", value, customTo)}
          onCustomToChange={(value) => setRange("custom", customFrom, value)}
        />
      </div>

      {loading ? <LoadingBlock label="Loading purchases…" /> : null}
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
                Total spent
              </p>
              <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink-900">
                {formatINR(query.trim() ? listTotal : data.totalValue)}
              </p>
            </div>
            <div className="rounded-xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-soft">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Mobiles bought
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
                placeholder="Search model, IMEI, supplier…"
                aria-label="Search purchase history"
              />
              <SearchClearButton
                visible={Boolean(query)}
                onClear={() => setQuery("")}
              />
            </label>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={query.trim() ? "No matching purchases" : "No purchases"}
              description={
                query.trim()
                  ? "Try another search, or clear the search box."
                  : "No mobiles were bought from suppliers in this period."
              }
            />
          ) : (
            <div className="ledger-card">
              <div className="ledger-scroll">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Mobile</th>
                      <th>Storage</th>
                      <th>RAM</th>
                      <th>Supplier</th>
                      <th className="text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reveal.visibleItems.map((item) => {
                      const used = item.condition === "USED";
                      return (
                        <tr
                          key={item.id}
                          className="ledger-row-click"
                          onClick={() =>
                            navigate(
                              `/suppliers/${item.supplierId}/purchases/${item.purchaseId}`,
                              {
                                state: {
                                  ...fromState(location),
                                  highlightStockId: item.id,
                                },
                              },
                            )
                          }
                        >
                          <td className="whitespace-normal">
                            <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold text-ink-900">
                              {item.mobileName}
                              <span
                                className={clsx(
                                  "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  used
                                    ? "border-orange-200 bg-orange-50 text-ember-500"
                                    : "border-tide-500/30 bg-tide-100/80 text-bright dark:border-tide-400/40 dark:bg-tide-400/15 dark:text-tide-400",
                                )}
                              >
                                {used ? "Old" : "New"}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-xs text-ink-400">
                              {[item.color, formatDay(item.purchaseDate)]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </td>
                          <td className="tabular-nums text-ink-500">
                            {item.storage ? formatCapacityLabel(item.storage) : "—"}
                          </td>
                          <td className="tabular-nums text-ink-500">
                            {item.platform === "ANDROID" && item.ram
                              ? formatCapacityLabel(item.ram)
                              : "—"}
                          </td>
                          <td className="whitespace-normal text-ink-700 dark:text-ink-800">
                            {item.supplierName}
                          </td>
                          <td className="text-right font-semibold tabular-nums text-ink-900">
                            {formatINR(item.price)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
