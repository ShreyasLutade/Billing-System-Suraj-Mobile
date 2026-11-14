import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowDownUp, Search } from "lucide-react";
import clsx from "clsx";
import { PeriodChipRow } from "../components/PeriodFilter";
import { EmptyState, LoadingBlock, SearchClearButton } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { useSessionState } from "../hooks/useSessionState";
import { fromState } from "../lib/navMemory";
import { api, formatStockUnitId } from "../lib/api";
import type { ExchangeMobile, ExchangeMobilesSummary } from "../types";
import { MIX, mixSurface } from "../lib/analyticsMix";
import { useTheme } from "../theme/ThemeContext";
import { matchesElasticFields } from "../lib/elasticSearch";

type ExchangePeriod = ExchangeMobilesSummary["period"];

const PERIOD_OPTIONS: ReadonlyArray<{ value: ExchangePeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "all", label: "All" },
];

function readPeriod(search: URLSearchParams): ExchangePeriod {
  const raw = search.get("period");
  return raw === "yesterday" || raw === "all" ? raw : "today";
}

function formatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "dd MMM yyyy");
}

function productLabel(item: ExchangeMobile) {
  const parts = [
    item.mobileName,
    item.color,
    item.storage,
    item.platform === "ANDROID" && item.ram ? item.ram : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Exchange mobiles taken in from customers, for staff (in the bottom nav).
 * Same list as Analytics → Exchange mobiles, without any prices.
 */
export function ExchangesPage() {
  const location = useLocation();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [searchParams, setSearchParams] = useSearchParams();
  const period = readPeriod(searchParams);

  const [data, setData] = useState<ExchangeMobilesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useSessionState("exchanges.query", "");

  function setPeriod(next: ExchangePeriod) {
    setSearchParams(next === "today" ? {} : { period: next }, { replace: true });
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const response = await api.listExchangeMobiles(period);
        if (active) {
          setData(response.data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load exchange mobiles",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [period]);

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
          item.imei || "",
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

  const inStock = rows.filter((row) => row.status === "AVAILABLE").length;

  const reveal = useInfiniteReveal(
    rows,
    `${period}|${query}|${rows.length}`,
  );

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
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
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px]"
          style={mixSurface(MIX.exchange, dark)}
        >
          <ArrowDownUp className="h-5 w-5" strokeWidth={2.1} />
        </div>
      </div>

      <div className="mb-5 w-full max-w-md">
        <PeriodChipRow
          compact
          options={PERIOD_OPTIONS}
          value={period}
          onChange={setPeriod}
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
                Units taken in
              </p>
              <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink-900">
                {rows.length}
              </p>
            </div>
            <div className="rounded-xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-soft">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Still in stock
              </p>
              <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink-900">
                {inStock}
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
              <SearchClearButton
                visible={Boolean(query)}
                onClear={() => setQuery("")}
              />
            </label>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={query.trim() ? "No matching exchanges" : "No exchange mobiles"}
              description={
                query.trim()
                  ? "Try another search, or clear the search box."
                  : period === "today"
                    ? "No customer exchange phones were taken in today."
                    : period === "yesterday"
                      ? "No customer exchange phones were taken in yesterday."
                      : "No customer exchange phones have been taken in yet."
              }
            />
          ) : (
            <div className="space-y-1.5">
              {reveal.visibleItems.map((item) => {
                const available = item.status === "AVAILABLE";
                const detail = (
                  <article className="interactive-card block rounded-xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-ink-900">
                          {productLabel(item)}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          <span className="font-mono font-medium text-ink-700 dark:text-ink-800">
                            {formatStockUnitId(item)}
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
                      <span
                        className={clsx(
                          "shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
                          available
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {available ? "In stock" : "Sold"}
                      </span>
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
