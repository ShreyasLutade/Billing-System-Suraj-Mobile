import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Download, HandCoins, Search } from "lucide-react";
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
import { analyticsCustomerPayoutsPath } from "../lib/analyticsNav";
import { fromState } from "../lib/navMemory";
import { api, formatINR } from "../lib/api";
import type {
  AnalyticsCustomerPayout,
  AnalyticsCustomerPayoutsSummary,
} from "../types";
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

function reasonLabel(item: AnalyticsCustomerPayout) {
  if (item.reason === "RETURN") {
    return `Refund · ${item.method === "online" ? "Online" : "Cash"}`;
  }
  if (item.cashReturn > 0 && item.extraExchange > 0) {
    return "Cash return + extra";
  }
  return item.cashReturn > 0 ? "Cash return" : "Extra exchange";
}

/** Second line: what was exchanged / returned, and the split when both apply. */
function detailLabel(item: AnalyticsCustomerPayout) {
  if (item.cashReturn > 0 && item.extraExchange > 0) {
    return `${item.detail} · ${formatINR(item.cashReturn)} + ${formatINR(item.extraExchange)}`;
  }
  return item.detail;
}

export function AnalyticsCustomerPayoutsPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { period, customFrom, customTo } = readPeriod(searchParams);

  const [data, setData] = useState<AnalyticsCustomerPayoutsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [query, setQuery] = useSessionState("analytics.customerPayouts.query", "");

  const customRangeReady =
    period === "custom" && Boolean(customFrom || customTo);
  const rangeOptions =
    period === "custom" && customRangeReady
      ? { from: customFrom || undefined, to: customTo || undefined }
      : undefined;

  function goTo(next: AnalyticsPeriodValue, from: string, to: string) {
    setSearchParams(
      new URLSearchParams(
        analyticsCustomerPayoutsPath(next, from, to).split("?")[1] || "",
      ),
      { replace: true },
    );
  }

  useEffect(() => {
    if (period === "custom" && !customRangeReady) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const response = await api.analyticsCustomerPayouts(
          period === "custom" ? "all" : period,
          rangeOptions,
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
              : "Failed to load money given to customers",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // rangeOptions is derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo, customRangeReady]);

  async function downloadPdf() {
    setDownloading(true);
    setError(null);
    try {
      await api.downloadCustomerPayoutsPdf(
        period === "custom" ? "all" : period,
        rangeOptions,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download PDF");
    } finally {
      setDownloading(false);
    }
  }

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    if (!query.trim()) return items;
    return items.filter((item) =>
      matchesElasticFields(
        [
          item.customerName,
          item.customerPhone,
          item.invoiceNumber,
          item.detail,
          reasonLabel(item),
        ],
        query,
      ),
    );
  }, [data?.items, query]);

  const listTotal = useMemo(
    () => rows.reduce((sum, row) => sum + row.amount, 0),
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
            Paid back
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink-900">
            Money given to customers
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Exchange cash returns, extra exchange value and return refunds
            {data?.periodLabel ? ` · ${data.periodLabel}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary !h-9 !gap-1.5 !rounded-[10px] !px-2.5 !py-0 text-xs"
            disabled={downloading || loading || !data}
            onClick={() => void downloadPdf()}
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "Preparing…" : "Download PDF"}
          </button>
          <div className="grid h-11 w-11 place-items-center rounded-[12px] bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <HandCoins className="h-5 w-5" strokeWidth={2.1} />
          </div>
        </div>
      </div>

      <div className="mb-5">
        <PeriodFilter
          allowCustom
          value={period}
          onChange={(next) =>
            goTo(
              next,
              next === "custom" ? customFrom : "",
              next === "custom" ? customTo : "",
            )
          }
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={(value) => goTo("custom", value, customTo)}
          onCustomToChange={(value) => goTo("custom", customFrom, value)}
        />
      </div>

      {loading ? <LoadingBlock label="Loading…" /> : null}
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
                Total given
              </p>
              <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink-900">
                {formatINR(query.trim() ? listTotal : data.totalAmount)}
              </p>
            </div>
            <div className="rounded-xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-soft">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Times given
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
                placeholder="Search customer, phone, invoice…"
                aria-label="Search money given to customers"
              />
              <SearchClearButton
                visible={Boolean(query)}
                onClear={() => setQuery("")}
              />
            </label>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={query.trim() ? "No matches" : "No money given"}
              description={
                query.trim()
                  ? "Try another search, or clear the search box."
                  : "No money was given back to customers in this period."
              }
            />
          ) : (
            <div className="space-y-1.5">
              {reveal.visibleItems.map((item) => {
                const detail = (
                  <article className="interactive-card rounded-xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-ink-900">
                          {item.customerName}
                          {item.customerPhone ? (
                            <span className="font-normal text-ink-500">
                              {" "}
                              · {item.customerPhone}
                            </span>
                          ) : null}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          <span className="font-mono text-tide-600">
                            {item.invoiceNumber || "—"}
                          </span>
                          <span className="text-ink-300"> · </span>
                          {formatDay(item.date)}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          {detailLabel(item)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <span
                          className={clsx(
                            "whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
                            item.reason === "RETURN"
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                              : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                          )}
                        >
                          {reasonLabel(item)}
                        </span>
                        <p className="text-sm font-semibold tabular-nums text-ink-900">
                          {formatINR(item.amount)}
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
