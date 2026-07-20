import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Check, Search } from "lucide-react";
import {
  PeriodFilter,
  type DuePeriodValue,
} from "../components/PeriodFilter";
import { SettleDueModal } from "../components/SettleDueModal";
import { EmptyState, LoadingBlock, PageHeader, StatCard } from "../components/ui";
import { api, formatINR } from "../lib/api";
import type { DueItem, DuesSummary } from "../types";

export function DuesPage() {
  const [period, setPeriod] = useState<DuePeriodValue>("all");
  const [data, setData] = useState<DuesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDue, setSelectedDue] = useState<DueItem | null>(null);
  const [query, setQuery] = useState("");

  async function loadDues(activePeriod: DuePeriodValue) {
    setLoading(true);
    try {
      const response = await api.listDues(activePeriod);
      setData(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dues");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDues(period);
  }, [period]);

  const filteredDues =
    data?.dues.filter((due) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        due.invoiceNumber.toLowerCase().includes(q) ||
        due.customerName.toLowerCase().includes(q) ||
        due.customerPhone.includes(q)
      );
    }) || [];

  const filteredTotal = filteredDues.reduce((sum, due) => sum + due.dueAmount, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Collections"
        title="Due details"
        description="Filter by period and search by invoice, customer, or phone."
        action={
              <Link to="/" className="btn-secondary">
                <ArrowLeft className="h-4 w-4" />
                Home
              </Link>
        }
      />

      <div className="mb-6 space-y-3">
        <PeriodFilter variant="dues" value={period} onChange={setPeriod} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
          <input
            className="field pl-11"
            placeholder="Search dues…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {loading ? <LoadingBlock label="Loading dues…" /> : null}
      {error ? (
        <div className="mb-4 glass-panel px-5 py-4 text-sm text-ember-500">
          {error}
        </div>
      ) : null}

      {data && !loading ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <StatCard
              label={`Total due · ${data.periodLabel}`}
              value={formatINR(query.trim() ? filteredTotal : data.totalDue)}
              hint={`${query.trim() ? filteredDues.length : data.count} pending bill${(query.trim() ? filteredDues.length : data.count) === 1 ? "" : "s"}`}
              tone="ember"
            />
            <StatCard
              label="Open dues"
              value={String(query.trim() ? filteredDues.length : data.count)}
              hint="Waiting for collection"
              tone="ink"
              delay={0.05}
            />
          </div>

          {filteredDues.length === 0 ? (
            <EmptyState
              title={query.trim() ? "No matching dues" : "No dues in this period"}
              description={
                query.trim()
                  ? "Try another search, or clear the search box."
                  : "Try another filter, or check back when a bill has pending amount."
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredDues.map((due) => (
                <article key={due.id} className="glass-panel p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link
                        to={`/bills/${due.id}`}
                        className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-tide-600 hover:underline"
                      >
                        {due.invoiceNumber}
                      </Link>
                      <h3 className="mt-1 font-display text-xl font-semibold text-ink-900">
                        {due.customerName}
                      </h3>
                      <p className="mt-1 text-sm text-ink-500">
                        {due.customerPhone}
                        {due.dueDate
                          ? ` · Due ${format(new Date(due.dueDate), "dd MMM yyyy")}`
                          : ` · Bill ${format(new Date(due.billDate), "dd MMM yyyy")}`}
                      </p>
                      {due.isPartialPaid ? (
                        <p className="mt-2 text-xs font-semibold text-ember-500">
                          Partial paid · Remaining {formatINR(due.dueAmount)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
                      <p className="font-display text-2xl font-semibold text-ember-500">
                        {formatINR(due.dueAmount)}
                      </p>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => setSelectedDue(due)}
                      >
                        <Check className="h-4 w-4" />
                        Paid
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {selectedDue ? (
        <SettleDueModal
          bill={selectedDue}
          onClose={() => setSelectedDue(null)}
          onSettled={() => loadDues(period)}
        />
      ) : null}
    </div>
  );
}
