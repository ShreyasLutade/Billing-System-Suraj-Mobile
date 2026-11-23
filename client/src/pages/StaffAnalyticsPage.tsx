import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { ArrowDownUp, BarChart3, ChevronRight, PackageOpen } from "lucide-react";
import clsx from "clsx";
import { PeriodChipRow } from "../components/PeriodFilter";
import { EmptyState, PageHeader, LoadingBlock } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { HeroSparkles } from "../components/AnalyticsBackdrop";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { api } from "../lib/api";
import { formatRupees } from "../lib/dueStatus";
import { MIX, mixSurface } from "../lib/analyticsMix";
import { fromState } from "../lib/navMemory";
import { riseIn } from "../lib/motion";
import { useTheme } from "../theme/ThemeContext";
import type { StaffSalesSummary } from "../types";

type Period = StaffSalesSummary["period"];

const PERIOD_OPTIONS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "all", label: "All" },
];

const AVATAR_COLORS = ["#3B82F6", "#12B886", "#8B5CF6", "#F59E0B", "#EC4899", "#0EA5E9"];

function readPeriod(search: URLSearchParams): Period {
  const raw = search.get("period");
  return raw === "yesterday" || raw === "all" ? raw : "today";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Analytics for staff: exchange mobiles taken, pending items and the phones
 * sold, with selling prices only (the server never sends cost or profit).
 */
export function StaffAnalyticsPage() {
  const location = useLocation();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [searchParams, setSearchParams] = useSearchParams();
  const period = readPeriod(searchParams);

  const [sales, setSales] = useState<StaffSalesSummary | null>(null);
  const [exchangeCount, setExchangeCount] = useState<number | null>(null);
  const [pending, setPending] = useState<{ itemCount: number; billCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setPeriod(next: Period) {
    setSearchParams(next === "today" ? {} : { period: next }, { replace: true });
  }

  useEffect(() => {
    let active = true;
    Promise.all([api.listSales(period), api.listExchangeMobiles(period)])
      .then(([salesRes, exchangeRes]) => {
        if (!active) return;
        setSales(salesRes.data);
        setExchangeCount(exchangeRes.data.count);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load analytics");
      });
    return () => {
      active = false;
    };
  }, [period]);

  // Pending items are not tied to a period.
  useEffect(() => {
    let active = true;
    api
      .pendingAccessories()
      .then((res) => {
        if (active) setPending({ itemCount: res.data.itemCount, billCount: res.data.billCount });
      })
      .catch(() => {
        if (active) setPending(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const rows = sales?.items ?? [];
  const reveal = useInfiniteReveal(rows, `${period}|${rows.length}`);
  const periodWord = sales?.periodLabel.toLowerCase() ?? "";
  const showDate = period !== "today";

  return (
    <div>
      <PageHeader icon={BarChart3} title="Analytics" />
      <div className="mb-4 w-full max-w-md">
        <PeriodChipRow
          compact
          pillId="staff-period"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={setPeriod}
        />
      </div>

      {error ? (
        <div className="mb-3 rounded-[14px] border border-orange-100 bg-orange-50 px-5 py-4 text-sm text-ember-500">
          {error}
        </div>
      ) : null}

      {!sales ? (
        <LoadingBlock label="Loading analytics…" />
      ) : (
        <>
          {/* Headline: phones sold and what they sold for */}
          <motion.section
            variants={riseIn}
            initial="hidden"
            animate="show"
            custom={0}
            className="fx-sheen relative mb-5 overflow-hidden rounded-[1.25rem] bg-[radial-gradient(120%_140%_at_0%_0%,#1B2740_0%,#0E1626_55%)] p-5 text-white shadow-lift"
            aria-label="Summary"
          >
            <HeroSparkles />
            <div className="relative">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#8EA0BC]">
                Phones sold · {periodWord}
              </p>
              <p className="mt-2 font-display text-[2.6rem] font-bold leading-none tracking-tight tabular-nums">
                <AnimatedNumber value={sales.soldCount} format={(v) => String(Math.round(v))} />
              </p>
              <p className="mt-3 text-[13.5px] leading-relaxed text-[#C4CEDD]">
                {sales.soldCount === 0
                  ? `No phones sold ${period === "all" ? "yet" : periodWord}.`
                  : `${period === "all" ? "Since the start" : sales.periodLabel}, ${sales.soldCount} bill${
                      sales.soldCount === 1 ? "" : "s"
                    } with phones, selling for ${formatRupees(sales.soldTotal)} in all.`}
              </p>
            </div>
          </motion.section>

          {/* Exchange + pending items */}
          <SectionTitle title="Exchange & pending" />
          <motion.section
            variants={riseIn}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.05 }}
            custom={1}
            className="due-card mb-6 overflow-hidden"
          >
            <Link
              to={`/staff-analytics/exchanges${period === "today" ? "" : `?period=${period}`}`}
              state={fromState(location)}
              className="interactive-card-row flex min-h-[60px] items-center gap-3 border-b border-[#EEF1F5] px-4 py-2.5 dark:border-[rgb(var(--color-line))]"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
                style={mixSurface(MIX.exchange, dark)}
              >
                <ArrowDownUp className="h-4 w-4" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-900">Exchange mobiles taken</span>
                <span className="block truncate text-xs text-ink-500">Phones taken in during sales · {periodWord}</span>
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-ink-900">
                {exchangeCount ?? "—"}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
            </Link>
            <Link
              to="/staff-analytics/pending-items"
              state={fromState(location)}
              className="interactive-card-row flex min-h-[60px] items-center gap-3 px-4 py-2.5"
            >
              <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <PackageOpen className="h-4 w-4" strokeWidth={2.2} />
                {(pending?.itemCount ?? 0) > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#E5484D] ring-2 ring-white dark:ring-[rgb(var(--color-surface))]" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-900">Pending items</span>
                <span className="block truncate text-xs text-ink-500">
                  {pending
                    ? pending.itemCount > 0
                      ? `Box, charger, bill… from ${pending.billCount} customer${pending.billCount === 1 ? "" : "s"}`
                      : "Nothing owed by customers"
                    : "—"}
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-ink-900">
                {pending ? pending.itemCount : "—"}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
            </Link>
          </motion.section>

          {/* Phones sold: selling price only */}
          <SectionTitle title={`Phones sold · ${periodWord}`} />
          {rows.length === 0 ? (
            <EmptyState
              title="No phones sold"
              description={
                period === "today"
                  ? "Phones sold today will show here."
                  : period === "yesterday"
                    ? "No phones were sold yesterday."
                    : "No phones sold yet."
              }
            />
          ) : (
            <motion.section
              variants={riseIn}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.05 }}
              custom={2}
              className="due-card mb-4 overflow-hidden"
              aria-label={`Phones sold ${periodWord}`}
            >
              {reveal.visibleItems.map((row, index) => (
                <Link
                  key={row.entryId}
                  to={`/bills/${row.id}`}
                  state={fromState(location)}
                  className="interactive-card-row flex min-h-[60px] items-center gap-3 border-b border-[#EEF1F5] px-4 py-2.5 dark:border-[rgb(var(--color-line))]"
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] font-display text-[13px] font-bold text-white"
                    style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
                    aria-hidden
                  >
                    {initials(row.customerName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink-900">{row.customerName}</span>
                      {row.kind !== "SALE" ? (
                        <span
                          className={clsx(
                            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                            row.kind === "RETURNED"
                              ? "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                          )}
                        >
                          {row.kind === "RETURNED"
                            ? `Returned · ${row.refundMethod === "online" ? "Online" : "Cash"}`
                            : "Replaced"}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-ink-500">
                      {row.invoiceNumber}
                      {row.productLabel !== "—" ? ` · ${row.productLabel}` : ""}
                      {showDate ? ` · ${format(new Date(row.billDate), "dd MMM")}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={clsx(
                        "block text-sm font-bold tabular-nums",
                        row.sellingPrice < 0 ? "text-[#E5484D]" : "text-ink-900",
                      )}
                    >
                      {row.kind === "REPLACED" ? "—" : formatRupees(row.sellingPrice)}
                    </span>
                    {row.exchangeValue > 0 ? (
                      <span className="block text-[10.5px] font-medium text-[#B76E00]">
                        incl. {formatRupees(row.exchangeValue)} exchange
                      </span>
                    ) : null}
                  </span>
                </Link>
              ))}
              <LoadMoreSentinel
                sentinelRef={reveal.sentinelRef}
                hasMore={reveal.hasMore}
                loadingMore={reveal.loadingMore}
                totalCount={reveal.totalCount}
                showEnd={false}
              />
              <div className="flex items-center justify-between gap-3 border-t-2 border-ink-900 bg-[#F7F9FC] px-4 py-3 dark:border-ink-300 dark:bg-white/5">
                <span className="text-sm font-semibold text-ink-900">Total selling</span>
                <span className="font-display text-[15px] font-bold tabular-nums text-ink-900">
                  {formatRupees(sales.soldTotal)}
                </span>
              </div>
            </motion.section>
          )}
        </>
      )}
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">{title}</h2>
  );
}
