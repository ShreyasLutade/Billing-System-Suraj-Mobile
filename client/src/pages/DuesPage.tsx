import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AnimatePresence } from "framer-motion";
import { ArrowLeft, Building2, Check, Search, UserRound } from "lucide-react";
import {
  PeriodFilter,
  type DuePeriodValue,
} from "../components/PeriodFilter";
import { SettleDueModal } from "../components/SettleDueModal";
import { FinanceReceivedConfirmModal } from "../components/FinanceReceivedConfirmModal";
import { EmptyState, LoadingBlock, PageHeader, StatCard } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { api, formatFinanceCompanies, formatINR, round2 } from "../lib/api";
import type {
  DueItem,
  DuesSummary,
  FinanceDueItem,
  FinanceDuesSummary,
} from "../types";

function financeTotalsByCompany(dues: FinanceDueItem[]) {
  const totals = new Map<string, number>();

  for (const due of dues) {
    const amount2 = due.financeAmount2 || 0;
    const amount1 = round2(Math.max((due.financeAmount || 0) - amount2, 0));
    const name1 = due.financeCompanyName?.trim();
    const name2 = due.financeCompanyName2?.trim();

    if (name1 && amount1 > 0) {
      totals.set(name1, round2((totals.get(name1) || 0) + amount1));
    }
    if (name2 && amount2 > 0) {
      totals.set(name2, round2((totals.get(name2) || 0) + amount2));
    }
    if (!name1 && !name2 && due.financeAmount > 0) {
      totals.set(
        "Unknown company",
        round2((totals.get("Unknown company") || 0) + due.financeAmount),
      );
    }
  }

  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

export function DuesPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<"customer" | "finance">("customer");
  const [period, setPeriod] = useState<DuePeriodValue>("all");
  const [data, setData] = useState<DuesSummary | null>(null);
  const [financeData, setFinanceData] = useState<FinanceDuesSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDue, setSelectedDue] = useState<DueItem | null>(null);
  const [query, setQuery] = useState("");
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [selectedFinanceDue, setSelectedFinanceDue] =
    useState<FinanceDueItem | null>(null);

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

  async function loadFinanceDues() {
    setLoading(true);
    try {
      const response = await api.listFinanceDues();
      setFinanceData(response.data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load finance dues",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "customer") {
      void loadDues(period);
    } else {
      void loadFinanceDues();
    }
  }, [period, tab]);

  const filteredDues =
    data?.dues.filter((due) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        due.invoiceNumber.toLowerCase().includes(q) ||
        due.customerName.toLowerCase().includes(q) ||
        due.customerPhone.includes(q) ||
        due.imeiNumbers?.some((imei) => imei.toLowerCase().includes(q))
      );
    }) || [];

  const filteredTotal = filteredDues.reduce((sum, due) => sum + due.dueAmount, 0);
  const filteredFinanceDues =
    financeData?.dues.filter((due) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        due.invoiceNumber.toLowerCase().includes(q) ||
        due.customerName.toLowerCase().includes(q) ||
        due.customerPhone.includes(q) ||
        due.financeCompanyName?.toLowerCase().includes(q) ||
        due.financeCompanyName2?.toLowerCase().includes(q) ||
        due.imeiNumbers?.some((imei) => imei.toLowerCase().includes(q))
      );
    }) || [];
  const filteredFinanceTotal = filteredFinanceDues.reduce(
    (sum, due) => sum + due.financeAmount,
    0,
  );
  const financeCompanyTotals = useMemo(
    () => financeTotalsByCompany(filteredFinanceDues),
    [filteredFinanceDues],
  );

  async function markFinanceReceived(due: FinanceDueItem) {
    setReceivingId(due.id);
    setError(null);
    try {
      await api.markFinanceReceived(due.id);
      setSelectedFinanceDue(null);
      await loadFinanceDues();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to mark finance amount as received",
      );
    } finally {
      setReceivingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Collections"
        title="Due details"
        description="Track pending customer payments and finance-company settlements."
        action={
              <Link to="/" className="btn-secondary">
                <ArrowLeft className="h-4 w-4" />
                Home
              </Link>
        }
      />

      <div className="mb-6 space-y-3">
        <div
          className="grid grid-cols-2 gap-1 rounded-2xl border border-ink-100 bg-white/70 p-1"
          role="tablist"
          aria-label="Due type"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "customer"}
            className={
              tab === "customer"
                ? "flex items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 py-3 text-sm font-semibold text-white shadow-soft"
                : "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-ink-500 transition hover:bg-white hover:text-ink-900"
            }
            onClick={() => setTab("customer")}
          >
            <UserRound className="h-4 w-4" />
            Dues
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "finance"}
            className={
              tab === "finance"
                ? "flex items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 py-3 text-sm font-semibold text-white shadow-soft"
                : "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-ink-500 transition hover:bg-white hover:text-ink-900"
            }
            onClick={() => setTab("finance")}
          >
            <Building2 className="h-4 w-4" />
            Finance dues
          </button>
        </div>

        {tab === "customer" ? (
          <PeriodFilter variant="dues" value={period} onChange={setPeriod} />
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
          <input
            className="field pl-11"
            placeholder={
              tab === "customer"
                ? "Search invoice, customer, phone, or IMEI…"
                : "Search finance, customer, phone, or IMEI…"
            }
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

      {tab === "customer" && data && !loading ? (
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
                      {isAdmin ? (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => setSelectedDue(due)}
                        >
                          <Check className="h-4 w-4" />
                          Paid
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === "finance" && financeData && !loading ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Finance amount pending"
              value={formatINR(
                query.trim()
                  ? filteredFinanceTotal
                  : financeData.totalFinanceDue,
              )}
              hint={`${query.trim() ? filteredFinanceDues.length : financeData.count} pending finance bill${(query.trim() ? filteredFinanceDues.length : financeData.count) === 1 ? "" : "s"}`}
              tone="ember"
            />
            <StatCard
              label="Finance settlements"
              value={String(
                query.trim() ? filteredFinanceDues.length : financeData.count,
              )}
              hint="Waiting to receive"
              tone="ink"
              delay={0.05}
            />
          </div>

          {financeCompanyTotals.length > 0 ? (
            <div className="mb-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
                Remaining by company
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {financeCompanyTotals.map((company) => (
                  <div
                    key={company.name}
                    className="rounded-2xl border border-ink-100 bg-white/80 px-4 py-3"
                  >
                    <p className="truncate text-sm font-medium text-ink-700">
                      {company.name}
                    </p>
                    <p className="mt-1 font-display text-xl font-semibold text-ember-500">
                      {formatINR(company.amount)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {filteredFinanceDues.length === 0 ? (
            <EmptyState
              title={
                query.trim()
                  ? "No matching finance dues"
                  : "No finance dues pending"
              }
              description={
                query.trim()
                  ? "Try another search, or clear the search box."
                  : "All finance-company amounts have been received."
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredFinanceDues.map((due) => (
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
                        {formatFinanceCompanies(
                          due.financeCompanyName,
                          due.financeCompanyName2,
                        ) || "Finance company"}
                      </h3>
                      <p className="mt-1 text-sm text-ink-500">
                        {due.customerName} · {due.customerPhone}
                      </p>
                      <p className="mt-1 text-xs text-ink-400">
                        Bill {format(new Date(due.billDate), "dd MMM yyyy")}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:items-end">
                      <p className="font-display text-2xl font-semibold text-ember-500">
                        {formatINR(due.financeAmount)}
                      </p>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={receivingId === due.id}
                          onClick={() => {
                            setError(null);
                            setSelectedFinanceDue(due);
                          }}
                          aria-label={`Mark ${due.invoiceNumber} finance amount as received`}
                        >
                          <Check className="h-4 w-4" />
                          {receivingId === due.id ? "Saving…" : "Received"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {selectedDue && isAdmin ? (
        <SettleDueModal
          bill={selectedDue}
          onClose={() => setSelectedDue(null)}
          onSettled={() => loadDues(period)}
        />
      ) : null}

      <AnimatePresence>
        {selectedFinanceDue && isAdmin ? (
          <FinanceReceivedConfirmModal
            invoiceNumber={selectedFinanceDue.invoiceNumber}
            financeCompanyName={
              formatFinanceCompanies(
                selectedFinanceDue.financeCompanyName,
                selectedFinanceDue.financeCompanyName2,
              ) || selectedFinanceDue.financeCompanyName
            }
            amount={selectedFinanceDue.financeAmount}
            saving={receivingId === selectedFinanceDue.id}
            error={error}
            onCancel={() => {
              if (receivingId) return;
              setSelectedFinanceDue(null);
              setError(null);
            }}
            onConfirm={() => void markFinanceReceived(selectedFinanceDue)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
