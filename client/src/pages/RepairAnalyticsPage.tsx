import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Clock3, Inbox, PackageCheck, Wrench } from "lucide-react";
import clsx from "clsx";
import { EmptyState, PageHeader } from "../components/ui";
import { ApiError, api, formatINR } from "../lib/api";
import { MIX } from "../lib/analyticsMix";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { REPAIR_SHOP_LABEL, formatRupees } from "../lib/repair";
import { useAuth } from "../auth/AuthContext";
import type { RepairAnalytics } from "../types";

/** Same row avatar colours as the shop's analytics bills list. */
const AVATAR_COLORS = [MIX.cash.color, MIX.online.color, MIX.card.color, MIX.finance.color, MIX.due.color, "#0E1626"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

const PERIODS: Array<{ value: RepairAnalytics["period"]; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

export function RepairAnalyticsPage() {
  const [period, setPeriod] = useState<RepairAnalytics["period"]>("today");
  const { isAdmin, repairOnly } = useAuth();
  /** Full-access admins can narrow to one repair shop; others see their own only. */
  const multiShop = isAdmin && !repairOnly;
  const [shop, setShop] = useState("all");
  const [data, setData] = useState<RepairAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .repairAnalytics(period, shop === "all" ? undefined : shop)
      .then(({ data: next }) => {
        if (active) setData(next);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Couldn't load repair analytics");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period, shop]);

  const checked = data ? data.fixedCount + data.notFixedCount : 0;
  const fixedShare = data && checked ? (data.fixedCount / checked) * 100 : 0;

  // Repairs list (same as the shop's bills list): newest delivery first.
  const jobs = useMemo(() => data?.recentDelivered ?? [], [data]);
  const showDate = period !== "today" && period !== "yesterday";
  const rowGrid = showDate
    ? "sm:grid-cols-[minmax(0,1.5fr)_1fr_0.9fr_0.9fr_0.9fr]"
    : "sm:grid-cols-[minmax(0,1.8fr)_0.9fr_0.9fr_0.9fr]";
  const jobsReveal = useInfiniteReveal(jobs, `${period}|${shop}|${jobs.length}`);
  /** Cost and profit only count repaired jobs with a cost price. */
  const totals = useMemo(
    () =>
      jobs.reduce(
        (sum, job) => {
          const charge = job.finalCharge ?? 0;
          const cost = job.outcome !== "NOT_FIXED" ? job.costPrice : null;
          return {
            charge: sum.charge + charge,
            cost: sum.cost + (cost ?? 0),
            profit: sum.profit + (cost != null ? charge - cost : 0),
          };
        },
        { charge: 0, cost: 0, profit: 0 },
      ),
    [jobs],
  );
  const missingCost = jobs.filter((job) => job.outcome !== "NOT_FIXED" && job.costPrice == null).length;
  return (
    <div className="rp-analytics">
      <PageHeader
        eyebrow="Insights"
        title="Repair sales"
      />

      {multiShop ? (
        <div className="rp-filter rp-period rp-an-filter" role="group" aria-label="Repair shop">
          {[["all", "All shops"], ...Object.entries(REPAIR_SHOP_LABEL)].map(([key, name]) => (
            <button
              key={key}
              type="button"
              className={clsx("rp-filter-btn", shop === key && "is-on")}
              aria-pressed={shop === key}
              onClick={() => setShop(key)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rp-filter rp-period rp-an-filter" role="group" aria-label="Period">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={clsx("rp-filter-btn", period === option.value && "is-on")}
            aria-pressed={period === option.value}
            onClick={() => setPeriod(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rp-empty">{error}</p>
      ) : !data ? (
        <p className="rp-empty">Loading…</p>
      ) : (
        <div className={clsx("rp-an", loading && "is-loading")}>
          <section className="rp-an-hero" aria-label="Repair revenue">
            <p className="rp-an-hero-label">Repair revenue · {data.periodLabel.toLowerCase()}</p>
            <p className="rp-an-hero-value">{formatRupees(data.revenue)}</p>
            <div className="rp-an-hero-row">
              <div>
                <span>Phones delivered</span>
                <strong>{data.deliveredCount}</strong>
              </div>
              <div>
                <span>Average charge</span>
                <strong>{formatRupees(Math.round(data.averageCharge))}</strong>
              </div>
              {/* Profit on delivered phones with a cost price; * = some costs missing. */}
              <div>
                <span>Profit</span>
                <strong className={clsx("rp-an-profit", totals.profit < 0 && "is-loss")}>
                  {formatRupees(totals.profit)}
                  {missingCost ? <sup className="rp-an-star">*</sup> : null}
                </strong>
              </div>
            </div>
            {missingCost ? (
              <p className="rp-an-footnote">
                * cost pending for {missingCost} phone{missingCost === 1 ? "" : "s"}
              </p>
            ) : null}
          </section>

          <div className="rp-an-tiles">
            <Link to="/repair/history?tab=received" className="rp-an-tile">
              <span className="rp-an-tile-icon">
                <Inbox aria-hidden />
              </span>
              <span className="rp-an-tile-label">Phones received</span>
              <strong className="rp-an-tile-value">{data.receivedCount}</strong>
              <span className="rp-an-tile-sub">{data.periodLabel}</span>
            </Link>

            <Link to="/repair/history?tab=repaired" className="rp-an-tile">
              <span className="rp-an-tile-icon">
                <Wrench aria-hidden />
              </span>
              <span className="rp-an-tile-label">Repaired</span>
              <strong className="rp-an-tile-value">{checked}</strong>
              <div
                className="rp-an-split"
                role="img"
                aria-label={`${data.fixedCount} fixed, ${data.notFixedCount} couldn't fix`}
              >
                <span style={{ width: `${fixedShare}%` }} />
              </div>
            </Link>

            <Link to="/repair/history?tab=inShop" className="rp-an-tile">
              <span className="rp-an-tile-icon is-waiting">
                <Clock3 aria-hidden />
              </span>
              <span className="rp-an-tile-label">In the shop now</span>
              <strong className="rp-an-tile-value">{data.waitingCount}</strong>
              <span className="rp-an-tile-sub">Waiting to be repaired</span>
            </Link>

            <Link to="/repair/history?tab=ready" className="rp-an-tile">
              <span className="rp-an-tile-icon is-ready">
                <PackageCheck aria-hidden />
              </span>
              <span className="rp-an-tile-label">Ready for pickup</span>
              <strong className="rp-an-tile-value">{data.readyCount}</strong>
              <span className="rp-an-tile-sub">
                {data.readyValue ? `${formatRupees(data.readyValue)} to collect` : "Nothing to collect"}
              </span>
            </Link>
          </div>

          {/* Same layout as the mobile shop's "Bills · period" list. */}
          <div className="mb-3.5 mt-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-[19px] font-semibold text-ink-900">
                Repairs · {data.periodLabel}
              </h2>
              <p className="mt-0.5 text-[13px] text-ink-500">
                Phones handed back in this period: your cost vs the charge.
                {missingCost ? ` ${missingCost} without a cost price.` : ""}
              </p>
            </div>
            <Link
              to="/repair/history"
              className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold text-ink-900 transition hover:bg-ink-50 dark:hover:bg-surface-muted"
            >
              View all →
            </Link>
          </div>

          {jobs.length === 0 ? (
            <EmptyState
              title="No repairs in this period"
              description="Phones delivered in the selected timeline will show here with cost and charge."
            />
          ) : (
            <section
              className="overflow-hidden rounded-2xl border border-ink-100/80 bg-white/90 shadow-soft"
              aria-label={`Repairs for ${data.periodLabel}`}
            >
              <div
                className={`hidden gap-3 border-b border-ink-100 bg-[#FAFBFC] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-300 sm:grid ${rowGrid}`}
              >
                <span>Customer</span>
                {showDate ? <span>Delivered</span> : null}
                <span className="text-right">Cost</span>
                <span className="text-right">Charge</span>
                <span className="text-right">Profit</span>
              </div>

              {jobsReveal.visibleItems.map((job, index) => {
                const unrepaired = job.outcome === "NOT_FIXED";
                const charge = job.finalCharge ?? 0;
                const profit = !unrepaired && job.costPrice != null ? charge - job.costPrice : null;
                return (
                  <Link
                    key={job.id}
                    to={`/repair/${job.id}`}
                    className={`interactive-card-row border-b border-ink-100 px-4 py-3.5 last:border-b-0 sm:grid sm:items-center sm:gap-3 sm:px-5 ${rowGrid}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] font-display text-[13px] font-bold text-white"
                        style={{ background: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
                      >
                        {initials(job.customerName)}
                      </div>
                      <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink-900">
                          <span className="truncate">{job.customerName}</span>
                          {unrepaired ? (
                            <span className="shrink-0 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                              Unrepaired
                            </span>
                          ) : job.costPrice == null ? (
                            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                              Cost pending
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-ink-500">
                          {job.jobNumber} · {job.deviceName}
                        </p>
                      </div>
                    </div>

                    {showDate ? (
                      <div className="mt-2 text-[13.5px] text-ink-700 sm:mt-0">
                        <span className="text-ink-500 sm:hidden">Delivered · </span>
                        {job.deliveredAt ? format(new Date(job.deliveredAt), "dd MMM yyyy") : "—"}
                      </div>
                    ) : null}

                    <div className="mt-2 grid grid-cols-3 gap-2 sm:mt-0 sm:contents">
                      <div className="text-left sm:text-right">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300 sm:hidden">Cost</p>
                        <p className="text-[14px] tabular-nums text-ink-700 sm:text-[15px]">
                          {!unrepaired && job.costPrice != null ? formatINR(job.costPrice) : "—"}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300 sm:hidden">Charge</p>
                        <p className="text-[14px] font-semibold tabular-nums text-ink-900 sm:text-[15px]">
                          {formatINR(charge)}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300 sm:hidden">Profit</p>
                        <p
                          className={clsx(
                            "font-display text-[14px] font-bold tabular-nums sm:text-[15px]",
                            profit == null ? "text-ink-400" : profit >= 0 ? "text-bright" : "text-[#E5484D]",
                          )}
                        >
                          {profit == null ? "—" : formatINR(profit)}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}

              <LoadMoreSentinel
                sentinelRef={jobsReveal.sentinelRef}
                hasMore={jobsReveal.hasMore}
                loadingMore={jobsReveal.loadingMore}
                totalCount={jobsReveal.totalCount}
                showEnd={false}
              />

              <div className={`grid items-center gap-3 border-t-2 border-ink-900 bg-[#F7F9FC] px-4 py-3.5 sm:px-5 ${rowGrid}`}>
                <p
                  className="font-display text-sm font-semibold text-ink-900 sm:col-span-1"
                  style={showDate ? { gridColumn: "1 / span 2" } : undefined}
                >
                  Total
                </p>
                <p className="hidden text-right text-[13.5px] font-bold tabular-nums text-ink-900 sm:block">
                  {formatINR(totals.cost)}
                </p>
                <p className="hidden text-right text-[13.5px] font-bold tabular-nums text-ink-900 sm:block">
                  {formatINR(totals.charge)}
                </p>
                <p className="hidden text-right font-display text-[15px] font-bold tabular-nums text-bright sm:block">
                  {formatINR(totals.profit)}
                </p>
                <div className="col-span-full grid grid-cols-3 gap-2 sm:hidden">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">Cost</p>
                    <p className="text-sm font-bold tabular-nums text-ink-900">{formatINR(totals.cost)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">Charge</p>
                    <p className="text-sm font-bold tabular-nums text-ink-900">{formatINR(totals.charge)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-300">Profit</p>
                    <p className="font-display text-sm font-bold tabular-nums text-bright">{formatINR(totals.profit)}</p>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
