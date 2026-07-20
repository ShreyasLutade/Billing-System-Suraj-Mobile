import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import {
  PeriodFilter,
  type ActivityPeriodValue,
} from "../components/PeriodFilter";
import { SalesMixPieChart } from "../components/SalesMixPieChart";
import { EmptyState, LoadingBlock, PageHeader, StatCard } from "../components/ui";
import { api, formatINR } from "../lib/api";
import type { AnalyticsSummary } from "../types";

export function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<ActivityPeriodValue>("today");

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const response = await api.analytics(period);
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
  }, [period]);

  const summary = data?.summary || data?.today;

  return (
    <div>
      <PageHeader
        eyebrow="Insights"
        title="Analytics"
        description="Sales and payment mix by period — cash, online, finance, and dues."
      />

      <div className="mb-6">
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {loading ? <LoadingBlock label="Calculating…" /> : null}
      {error ? (
        <div className="glass-panel px-5 py-4 text-sm text-ember-500">{error}</div>
      ) : null}

      {data && summary && !loading ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label={`${data.periodLabel} sale`}
              value={formatINR(summary.sales)}
              hint={`${summary.bills} bill${summary.bills === 1 ? "" : "s"}`}
              tone="ink"
              delay={0.02}
            />
            <StatCard
              label="Cash"
              value={formatINR(summary.cash)}
              hint={`Received · ${data.periodLabel.toLowerCase()}`}
              tone="tide"
              delay={0.06}
            />
            <StatCard
              label="Online"
              value={formatINR(summary.online)}
              hint="UPI / bank / card"
              delay={0.1}
            />
            <StatCard
              label="Finance"
              value={formatINR(summary.finance)}
              hint={`Financed · ${data.periodLabel.toLowerCase()}`}
              delay={0.14}
            />
            <StatCard
              label="Due created"
              value={formatINR(summary.due)}
              hint={`Pending from ${data.periodLabel.toLowerCase()} bills`}
              tone="ember"
              delay={0.18}
            />
            <StatCard
              label="Total outstanding"
              value={formatINR(data.outstandingDue.amount)}
              hint={`${data.outstandingDue.count} open due${data.outstandingDue.count === 1 ? "" : "s"}`}
              delay={0.22}
            />
          </div>

          <section className="mt-8">
            <SalesMixPieChart
              cash={summary.cash}
              online={summary.online}
              finance={summary.finance}
              due={summary.due}
              periodLabel={data.periodLabel}
            />
          </section>

          <section className="mt-8">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-display text-xl font-semibold text-ink-900">
                Upcoming dues
              </h2>
              <Link to="/dues" className="btn-secondary self-start sm:self-auto">
                View in detail
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            {data.upcomingDues.length === 0 ? (
              <EmptyState
                title="No pending dues"
                description="When a bill has leftover amount, it will show here with the expected collection date."
              />
            ) : (
              <div className="space-y-3 sm:space-y-0 sm:overflow-hidden sm:rounded-[1.5rem] sm:border sm:border-white/70 sm:bg-white/75 sm:shadow-soft sm:backdrop-blur-xl">
                <div className="hidden grid-cols-[1.1fr_1fr_1fr_1fr] gap-3 border-b border-ink-100 px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-500 sm:grid">
                  <span>Invoice</span>
                  <span>Customer</span>
                  <span>Due date</span>
                  <span className="text-right">Amount</span>
                </div>
                {data.upcomingDues.map((due) => (
                  <Link
                    key={due.id}
                    to={`/bills/${due.id}`}
                    className="glass-panel block p-4 transition hover:-translate-y-0.5 hover:shadow-lift sm:rounded-none sm:border-0 sm:border-b sm:border-ink-50 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none sm:hover:translate-y-0 sm:hover:shadow-none sm:last:border-b-0"
                  >
                    {/* Mobile card */}
                    <div className="sm:hidden">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-tide-600">
                          {due.invoiceNumber}
                        </p>
                        <p className="shrink-0 font-display text-lg font-semibold text-ember-500">
                          {formatINR(due.dueAmount)}
                        </p>
                      </div>
                      <h3 className="mt-2 font-display text-lg font-semibold text-ink-900">
                        {due.customerName}
                      </h3>
                      <p className="mt-1 text-sm text-ink-500">
                        {due.customerPhone}
                      </p>
                      <p className="mt-2 text-sm text-ink-700">
                        Due ·{" "}
                        {due.dueDate
                          ? format(new Date(due.dueDate), "dd MMM yyyy")
                          : "Not set"}
                      </p>
                    </div>

                    {/* Desktop row */}
                    <div className="hidden gap-3 px-5 py-4 sm:grid sm:grid-cols-[1.1fr_1fr_1fr_1fr] sm:items-center">
                      <p className="font-mono text-xs text-tide-600">
                        {due.invoiceNumber}
                      </p>
                      <div>
                        <p className="text-sm font-medium text-ink-900">
                          {due.customerName}
                        </p>
                        <p className="text-xs text-ink-500">{due.customerPhone}</p>
                      </div>
                      <p className="text-sm text-ink-700">
                        {due.dueDate
                          ? format(new Date(due.dueDate), "dd MMM yyyy")
                          : "—"}
                      </p>
                      <p className="text-right font-display text-lg font-semibold text-ember-500">
                        {formatINR(due.dueAmount)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
