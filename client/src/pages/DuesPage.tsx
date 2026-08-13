import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { AnimatePresence } from "framer-motion";
import {
  BarChart3,
  Check,
  Filter,
  Search,
  UserRound,
} from "lucide-react";
import clsx from "clsx";
import {
  DUE_PERIOD_OPTIONS,
  type DuePeriodValue,
} from "../components/PeriodFilter";
import { SettleDueModal } from "../components/SettleDueModal";
import { FinanceReceivedConfirmModal } from "../components/FinanceReceivedConfirmModal";
import { BackLink, EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useAuth } from "../auth/AuthContext";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { usePersistedTab } from "../hooks/usePersistedTab";
import { fromState } from "../lib/navMemory";
import { api, formatFinanceCompanies, formatINR, round2 } from "../lib/api";
import {
  matchesDueSearch,
  type BillSearchScope,
} from "../lib/billSearch";
import type {
  DueItem,
  DuesSummary,
  FinanceDueItem,
  FinanceDuesSummary,
} from "../types";

const DUE_PERIOD_LABELS: Record<DuePeriodValue, string> = {
  all: "All time",
  today: "Today",
  tomorrow: "Tomorrow",
  yesterday: "Yesterday",
  past_due: "Past due",
  future_due: "Future due",
};

const DUE_PERIOD_CHIP_LABELS: Record<DuePeriodValue, string> = {
  all: "All",
  today: "Today",
  tomorrow: "Tmrw",
  yesterday: "Yday",
  past_due: "Past",
  future_due: "Future",
};

const SCOPE_CHIPS: Array<{ value: BillSearchScope; label: string }> = [
  { value: "all", label: "All" },
  { value: "phone", label: "Number" },
  { value: "imei", label: "IMEI" },
  { value: "product", label: "Product" },
];

function searchPlaceholder(
  scope: BillSearchScope,
  tab: "customer" | "finance",
) {
  if (scope === "phone") return "Search by number…";
  if (scope === "imei") return "Search by IMEI…";
  if (scope === "product") return "Search by product…";
  if (tab === "finance") {
    return "Search finance, customer, invoice…";
  }
  return "Search customer, phone, invoice…";
}
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

function dueMatchesFinanceCompany(due: FinanceDueItem, company: string) {
  const name1 = due.financeCompanyName?.trim() || "";
  const name2 = due.financeCompanyName2?.trim() || "";
  if (company === "Unknown company") {
    return !name1 && !name2 && due.financeAmount > 0;
  }
  return name1 === company || name2 === company;
}

function financeAmountForCompany(due: FinanceDueItem, company: string | null) {
  if (!company) return due.financeAmount;
  const amount2 = due.financeAmount2 || 0;
  const amount1 = round2(Math.max((due.financeAmount || 0) - amount2, 0));
  const name1 = due.financeCompanyName?.trim() || "";
  const name2 = due.financeCompanyName2?.trim() || "";
  if (company === "Unknown company") return due.financeAmount;
  let total = 0;
  if (name1 === company) total = round2(total + amount1);
  if (name2 === company) total = round2(total + amount2);
  return total;
}

export function DuesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const [tab, setTab] = usePersistedTab(
    "tab",
    "dues.tab",
    ["customer", "finance"] as const,
    "customer",
  );
  const [period, setPeriod] = useState<DuePeriodValue>("all");
  const [data, setData] = useState<DuesSummary | null>(null);
  const [financeData, setFinanceData] = useState<FinanceDuesSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDue, setSelectedDue] = useState<DueItem | null>(null);
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<BillSearchScope>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [selectedFinanceDue, setSelectedFinanceDue] =
    useState<FinanceDueItem | null>(null);
  const [financeCompanyFilter, setFinanceCompanyFilter] = useState<
    string | null
  >(null);
  const filterWrapRef = useRef<HTMLDivElement>(null);

  const filtersActive =
    (tab === "customer" && period !== "all") || searchScope !== "all";

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
    setFinanceCompanyFilter(null);
  }, [period, tab]);

  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        filterWrapRef.current &&
        !filterWrapRef.current.contains(event.target as Node)
      ) {
        setFilterOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOpen]);

  const searchQuery = query.trim();

  const filteredDues =
    data?.dues.filter((due) =>
      matchesDueSearch(due, searchQuery, { scope: searchScope }),
    ) || [];

  const filteredTotal = filteredDues.reduce((sum, due) => sum + due.dueAmount, 0);
  const searchMatchedFinance =
    financeData?.dues.filter((due) =>
      matchesDueSearch(due, searchQuery, {
        includeFinanceCompany: searchScope === "all",
        scope: searchScope,
      }),
    ) || [];
  const financeCompanyTotals = useMemo(
    () => financeTotalsByCompany(searchMatchedFinance),
    [searchMatchedFinance],
  );
  const filteredFinanceDues = useMemo(() => {
    if (!financeCompanyFilter) return searchMatchedFinance;
    return searchMatchedFinance.filter((due) =>
      dueMatchesFinanceCompany(due, financeCompanyFilter),
    );
  }, [searchMatchedFinance, financeCompanyFilter]);
  const filteredFinanceTotal = useMemo(() => {
    if (financeCompanyFilter) {
      const match = financeCompanyTotals.find(
        (company) => company.name === financeCompanyFilter,
      );
      return match?.amount ?? 0;
    }
    return filteredFinanceDues.reduce((sum, due) => sum + due.financeAmount, 0);
  }, [financeCompanyFilter, financeCompanyTotals, filteredFinanceDues]);

  const customerReveal = useInfiniteReveal(
    filteredDues,
    `customer|${period}|${searchQuery}|${searchScope}|${filteredDues.length}`,
  );
  const financeReveal = useInfiniteReveal(
    filteredFinanceDues,
    `finance|${searchQuery}|${searchScope}|${financeCompanyFilter || "all"}|${filteredFinanceDues.length}`,
  );

  const resetFilters = () => {
    setPeriod("all");
    setSearchScope("all");
    setFinanceCompanyFilter(null);
  };

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
        title="Dues"
        description="Pending payments from customers and financiers."
        action={
          <BackLink to="/">Home</BackLink>
        }
      />

      <div className="tb-toolbar">
        <div className="tb-tabs" role="tablist" aria-label="Due type">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "customer"}
            className={clsx("tb-tab", tab === "customer" && "tb-tab-on")}
            onClick={() => setTab("customer")}
          >
            <UserRound className="h-4 w-4 shrink-0" />
            Customer
            <span className="tb-cnt">
              {data?.count ?? (tab === "customer" ? filteredDues.length : "—")}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "finance"}
            className={clsx("tb-tab", tab === "finance" && "tb-tab-on")}
            onClick={() => setTab("finance")}
          >
            <BarChart3 className="h-4 w-4 shrink-0" />
            Finance
            <span className="tb-cnt">
              {financeData?.count ??
                (tab === "finance" ? filteredFinanceDues.length : "—")}
            </span>
          </button>
        </div>

        <div className="tb-searchrow">
          <div className="tb-search">
            <Search className="h-[17px] w-[17px] shrink-0 text-[#7A8699]" />
            <input
              id="dues-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder(searchScope, tab)}
              aria-label={searchPlaceholder(searchScope, tab)}
            />
          </div>

          <div className="relative shrink-0" ref={filterWrapRef}>
            <button
              type="button"
              className={clsx(
                "tb-filter-btn",
                filterOpen && "tb-filter-btn-open",
              )}
              aria-haspopup="true"
              aria-expanded={filterOpen}
              aria-label="Filter dues"
              onClick={() => setFilterOpen((open) => !open)}
            >
              <Filter className="h-[19px] w-[19px]" strokeWidth={2} />
              <span
                className={clsx(
                  "tb-filter-badge",
                  filtersActive && "tb-filter-badge-on",
                )}
              />
            </button>

            {filterOpen ? (
              <div className="tb-pop tb-pop-wide" role="menu">
                <div className="mb-3.5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-300">
                    Match search on
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SCOPE_CHIPS.map((chip) => {
                      const on = searchScope === chip.value;
                      return (
                        <button
                          key={chip.value}
                          type="button"
                          className={clsx(
                            "rounded-full border px-2.5 py-1.5 text-[12.5px] transition",
                            on
                              ? "border-ink-900 bg-ink-900 font-semibold text-white"
                              : "border-ink-100 bg-white text-ink-500 hover:border-ink-300",
                          )}
                          onClick={() => setSearchScope(chip.value)}
                        >
                          {chip.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {tab === "customer" ? (
                  <div className="mb-3.5">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-300">
                      Period
                    </p>
                    <div className="grid grid-cols-6 gap-1">
                      {DUE_PERIOD_OPTIONS.map((option) => {
                        const on = period === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={on}
                            aria-label={DUE_PERIOD_LABELS[option.value]}
                            title={DUE_PERIOD_LABELS[option.value]}
                            className={clsx(
                              "rounded-full border px-1 py-1.5 text-center text-[11px] transition sm:text-[12px]",
                              on
                                ? "border-ink-900 bg-ink-900 font-semibold text-white"
                                : "border-ink-100 bg-white text-ink-500 hover:border-ink-300",
                            )}
                            onClick={() => {
                              setPeriod(option.value);
                              setFilterOpen(false);
                            }}
                          >
                            {DUE_PERIOD_CHIP_LABELS[option.value]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="mt-0.5 flex items-center justify-between border-t border-ink-100 pt-3">
                  <button
                    type="button"
                    className="rounded-lg px-1 py-1.5 text-[13px] text-ink-300 transition hover:text-[#B76E00]"
                    onClick={resetFilters}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="rounded-[9px] bg-ink-900 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-black"
                    onClick={() => setFilterOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {loading ? <LoadingBlock label="Loading dues…" /> : null}
      {error ? (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {tab === "customer" && data && !loading ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-ember-500/10 to-transparent px-4 py-2.5 ring-1 ring-ember-500/15">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {data.periodLabel}
              </p>
              <p className="text-sm text-ink-700">
                {query.trim() ? filteredDues.length : data.count} open due
                {(query.trim() ? filteredDues.length : data.count) === 1
                  ? ""
                  : "s"}
              </p>
            </div>
            <p className="font-display text-xl font-semibold tabular-nums text-ember-500">
              {formatINR(query.trim() ? filteredTotal : data.totalDue)}
            </p>
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
            <div className="space-y-2">
              {customerReveal.visibleItems.map((due) => (
                <article
                  key={due.id}
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer rounded-2xl border border-ink-100/80 bg-white/90 px-3.5 py-3 shadow-sm shadow-ink-900/5 backdrop-blur-sm transition hover:border-tide-200 hover:shadow-md"
                  onClick={() =>
                    navigate(`/bills/${due.id}`, { state: fromState(location) })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/bills/${due.id}`, {
                        state: fromState(location),
                      });
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <h3 className="truncate text-sm font-semibold text-ink-900">
                          {due.customerName}
                        </h3>
                        {due.isPartialPaid ? (
                          <span className="rounded-full bg-ember-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ember-500">
                            Partial
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        <span className="tabular-nums">{due.customerPhone}</span>
                        <span className="text-ink-300"> · </span>
                        <span className="font-mono text-tide-600">
                          {due.invoiceNumber}
                        </span>
                        <span className="text-ink-300"> · </span>
                        {due.dueDate
                          ? format(new Date(due.dueDate), "dd MMM")
                          : format(new Date(due.billDate), "dd MMM")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <p className="text-right text-base font-semibold tabular-nums text-ember-500">
                        {formatINR(due.dueAmount)}
                      </p>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded-full bg-ink-900 px-3 text-xs font-semibold text-white transition hover:bg-ink-800"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedDue(due);
                          }}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Paid
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              <LoadMoreSentinel
                sentinelRef={customerReveal.sentinelRef}
                hasMore={customerReveal.hasMore}
                loadingMore={customerReveal.loadingMore}
                totalCount={customerReveal.totalCount}
              />
            </div>
          )}
        </>
      ) : null}

      {tab === "finance" && financeData && !loading ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-ember-500/10 to-transparent px-4 py-2.5 ring-1 ring-ember-500/15">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Finance pending
                {financeCompanyFilter ? ` · ${financeCompanyFilter}` : ""}
              </p>
              <p className="text-sm text-ink-700">
                {filteredFinanceDues.length} settlement
                {filteredFinanceDues.length === 1 ? "" : "s"}
              </p>
            </div>
            <p className="font-display text-xl font-semibold tabular-nums text-ember-500">
              {formatINR(filteredFinanceTotal)}
            </p>
          </div>

          {financeCompanyTotals.length > 0 ? (
            <div className="mb-3 overflow-x-auto pb-1">
              <div className="flex w-max min-w-full justify-center gap-2 px-1">
                <button
                  type="button"
                  className={clsx(
                    "min-w-[5.5rem] shrink-0 rounded-2xl border px-3 py-2 text-left shadow-sm transition",
                    !financeCompanyFilter
                      ? "border-ink-900 bg-ink-900 text-white"
                      : "border-ink-100 bg-white/90 text-ink-700 hover:border-ink-300",
                  )}
                  onClick={() => setFinanceCompanyFilter(null)}
                >
                  <p
                    className={clsx(
                      "truncate text-xs",
                      !financeCompanyFilter ? "text-white/70" : "text-ink-500",
                    )}
                  >
                    All
                  </p>
                  <p
                    className={clsx(
                      "mt-0.5 text-sm font-semibold tabular-nums",
                      !financeCompanyFilter ? "text-white" : "text-ember-500",
                    )}
                  >
                    {formatINR(
                      financeCompanyTotals.reduce(
                        (sum, company) => sum + company.amount,
                        0,
                      ),
                    )}
                  </p>
                </button>
                {financeCompanyTotals.map((company) => {
                  const on = financeCompanyFilter === company.name;
                  return (
                    <button
                      key={company.name}
                      type="button"
                      className={clsx(
                        "min-w-[9.5rem] shrink-0 rounded-2xl border px-3 py-2 text-left shadow-sm transition",
                        on
                          ? "border-ink-900 bg-ink-900 text-white"
                          : "border-ink-100 bg-white/90 text-ink-700 hover:border-ink-300",
                      )}
                      aria-pressed={on}
                      onClick={() =>
                        setFinanceCompanyFilter(on ? null : company.name)
                      }
                    >
                      <p
                        className={clsx(
                          "truncate text-xs",
                          on ? "text-white/70" : "text-ink-500",
                        )}
                      >
                        {company.name}
                      </p>
                      <p
                        className={clsx(
                          "mt-0.5 text-sm font-semibold tabular-nums",
                          on ? "text-white" : "text-ember-500",
                        )}
                      >
                        {formatINR(company.amount)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {filteredFinanceDues.length === 0 ? (
            <EmptyState
              title={
                query.trim() || financeCompanyFilter
                  ? "No matching finance dues"
                  : "No finance dues pending"
              }
              description={
                financeCompanyFilter
                  ? `No pending bills for ${financeCompanyFilter}. Tap All or another company.`
                  : query.trim()
                    ? "Try another search, or clear the search box."
                    : "All finance-company amounts have been received."
              }
            />
          ) : (
            <div className="space-y-2">
              {financeReveal.visibleItems.map((due) => (
                <article
                  key={due.id}
                  role="link"
                  tabIndex={0}
                  className="cursor-pointer rounded-2xl border border-ink-100/80 bg-white/90 px-3.5 py-3 shadow-sm shadow-ink-900/5 backdrop-blur-sm transition hover:border-tide-200 hover:shadow-md"
                  onClick={() =>
                    navigate(`/bills/${due.id}`, { state: fromState(location) })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/bills/${due.id}`, {
                        state: fromState(location),
                      });
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-ink-900">
                        {formatFinanceCompanies(
                          due.financeCompanyName,
                          due.financeCompanyName2,
                        ) || "Finance company"}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        {due.customerName}
                        <span className="text-ink-300"> · </span>
                        <span className="tabular-nums">{due.customerPhone}</span>
                        <span className="text-ink-300"> · </span>
                        <span className="font-mono text-tide-600">
                          {due.invoiceNumber}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <p className="text-right text-base font-semibold tabular-nums text-ember-500">
                        {formatINR(
                          financeAmountForCompany(due, financeCompanyFilter),
                        )}
                      </p>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1 rounded-full bg-ink-900 px-3 text-xs font-semibold text-white transition hover:bg-ink-800 disabled:opacity-50"
                          disabled={receivingId === due.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setError(null);
                            setSelectedFinanceDue(due);
                          }}
                          aria-label={`Mark ${due.invoiceNumber} finance amount as received`}
                        >
                          <Check className="h-3.5 w-3.5" />
                          {receivingId === due.id ? "…" : "Received"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              <LoadMoreSentinel
                sentinelRef={financeReveal.sentinelRef}
                hasMore={financeReveal.hasMore}
                loadingMore={financeReveal.loadingMore}
                totalCount={financeReveal.totalCount}
              />
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
