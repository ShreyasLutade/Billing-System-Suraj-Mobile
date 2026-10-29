import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { AnimatePresence } from "framer-motion";
import {
  BarChart3,
  CalendarDays,
  Check,
  Filter,
  MessageCircle,
  Phone,
  Search,
  UserRound,
} from "lucide-react";
import { BRAND_NAME_TEXT } from "../components/BrandName";
import clsx from "clsx";
import {
  DUE_PERIOD_OPTIONS,
  type DuePeriodValue,
} from "../components/PeriodFilter";
import { SettleDueModal } from "../components/SettleDueModal";
import { FinanceReceivedConfirmModal } from "../components/FinanceReceivedConfirmModal";
import { BackLink, EmptyState, LoadingBlock, PageHeader, SearchClearButton } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useAuth } from "../auth/AuthContext";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { usePersistedTab } from "../hooks/usePersistedTab";
import { useSessionState } from "../hooks/useSessionState";
import { fromState, readFromState, backLabel } from "../lib/navMemory";
import { api, formatFinanceCompanies, formatINR, round2 } from "../lib/api";
import {
  financeSlotAmounts,
  financeSlotOptions,
  pendingFinanceAmount,
  slotsMatchingCompany,
  type FinanceSlot,
} from "../lib/financeSlots";
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
    const { amount1, amount2 } = financeSlotAmounts(due);
    const name1 = due.financeCompanyName?.trim();
    const name2 = due.financeCompanyName2?.trim();

    if (name1 && amount1 > 0 && !due.financeReceived) {
      totals.set(name1, round2((totals.get(name1) || 0) + amount1));
    }
    if (name2 && amount2 > 0 && !due.financeReceived2) {
      totals.set(name2, round2((totals.get(name2) || 0) + amount2));
    }
    if (!name1 && !name2) {
      const pending = pendingFinanceAmount(due);
      if (pending > 0) {
        totals.set(
          "Unknown company",
          round2((totals.get("Unknown company") || 0) + pending),
        );
      }
    }
  }

  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

/** 10-digit Indian mobile for wa.me, or null. */
function whatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? `91${digits}` : null;
}

/** Polite Hindi payment reminder for WhatsApp (customer dues). */
function dueReminderHindi(due: DueItem) {
  const mobile = due.productLabels?.[0]?.trim();
  const amount = formatINR(due.dueAmount);
  const lines = [
    `नमस्ते ${due.customerName} जी,`,
    "",
    `${BRAND_NAME_TEXT} की ओर से विनम्र अनुस्मारक:`,
    `आपके ${mobile ? `मोबाइल *${mobile}*` : "मोबाइल"} (बिल नं. ${due.invoiceNumber}) का *${amount}* भुगतान अभी बाकी है।`,
    "",
    "कृपया जल्द से जल्द भुगतान करने की कृपा करें।",
    "",
    "धन्यवाद,",
    BRAND_NAME_TEXT,
  ];
  return lines.filter((line, i) => line !== "" || lines[i - 1] !== "").join("\n");
}

function dueDateStatus(dueDate: string | null) {
  if (!dueDate) return null;
  const day = dueDate.slice(0, 10);
  const today = format(new Date(), "yyyy-MM-dd");
  const display = format(new Date(dueDate), "dd MMM");
  if (day < today) return { label: `Overdue · ${display}`, overdue: true };
  if (day === today) return { label: "Due today", overdue: false };
  return { label: `Due ${display}`, overdue: false };
}

function dueMatchesFinanceCompany(due: FinanceDueItem, company: string) {
  const { amount1, amount2 } = financeSlotAmounts(due);
  const name1 = due.financeCompanyName?.trim() || "";
  const name2 = due.financeCompanyName2?.trim() || "";
  if (company === "Unknown company") {
    return !name1 && !name2 && pendingFinanceAmount(due) > 0;
  }
  if (name1 === company && amount1 > 0 && !due.financeReceived) return true;
  if (name2 === company && amount2 > 0 && !due.financeReceived2) return true;
  return false;
}

function financeAmountForCompany(due: FinanceDueItem, company: string | null) {
  if (!company) return pendingFinanceAmount(due);
  const { amount1, amount2 } = financeSlotAmounts(due);
  const name1 = due.financeCompanyName?.trim() || "";
  const name2 = due.financeCompanyName2?.trim() || "";
  if (company === "Unknown company") return pendingFinanceAmount(due);
  let total = 0;
  if (name1 === company && amount1 > 0 && !due.financeReceived) {
    total = round2(total + amount1);
  }
  if (name2 === company && amount2 > 0 && !due.financeReceived2) {
    total = round2(total + amount2);
  }
  return total;
}

export function DuesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = readFromState(location.state);
  const { isAdmin } = useAuth();
  const [tab, setTab] = usePersistedTab(
    "tab",
    "dues.tab",
    ["customer", "finance"] as const,
    "customer",
  );
  const [period, setPeriod] = useSessionState<DuePeriodValue>("dues.period", "all");
  const [data, setData] = useState<DuesSummary | null>(null);
  const [financeData, setFinanceData] = useState<FinanceDuesSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDue, setSelectedDue] = useState<DueItem | null>(null);
  const [query, setQuery] = useSessionState("dues.query", "");
  const [searchScope, setSearchScope] = useSessionState<BillSearchScope>(
    "dues.searchScope",
    "all",
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [selectedFinanceDue, setSelectedFinanceDue] =
    useState<FinanceDueItem | null>(null);
  const [financeCompanyFilter, setFinanceCompanyFilter] = useSessionState<
    string | null
  >("dues.financeCompanyFilter", null);
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
    return filteredFinanceDues.reduce(
      (sum, due) => sum + pendingFinanceAmount(due),
      0,
    );
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

  async function markFinanceReceived(
    due: FinanceDueItem,
    slots: FinanceSlot[],
  ) {
    if (slots.length === 0) return;
    setReceivingId(due.id);
    setError(null);
    try {
      await api.markFinanceReceived(due.id, slots);
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
        action={
          // Opened from the nav bar: no back button; from another page: back to it.
          from ? <BackLink to={from}>{backLabel(from)}</BackLink> : undefined
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
            <SearchClearButton
              visible={Boolean(query)}
              onClear={() => setQuery("")}
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
                              ? "segment-on border-transparent"
                              : "border-ink-100 bg-white text-ink-500 hover:border-ink-300 dark:border-ink-100 dark:bg-surface-elevated dark:hover:border-ink-300",
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
                                ? "segment-on border-transparent"
                                : "border-ink-100 bg-white text-ink-500 hover:border-ink-300 dark:border-ink-100 dark:bg-surface-elevated dark:hover:border-ink-300",
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
                    className="rounded-[9px] bg-ink-900 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-black dark:bg-tide-400 dark:!text-[#0F172A] dark:hover:bg-tide-500"
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
              {customerReveal.visibleItems.map((due) => {
                const dueWhen = dueDateStatus(due.dueDate);
                return (
                <article
                  key={due.id}
                  role="link"
                  tabIndex={0}
                  className={clsx(
                    "interactive-card rounded-2xl border px-3.5 py-2.5 shadow-sm backdrop-blur-sm",
                    dueWhen?.overdue
                      ? "interactive-card-danger border-red-500/40 bg-red-500/20"
                      : "border-ink-100/80 bg-white/90 shadow-ink-900/5",
                  )}
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
                  <div className="flex items-center gap-2">
                    <h3 className="min-w-0 truncate text-[15px] font-semibold text-ink-900">
                      {due.customerName}
                    </h3>
                    {due.isPartialPaid ? (
                      <span className="shrink-0 rounded-full bg-ember-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ember-500">
                        Partial
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 font-display text-[17px] font-semibold tabular-nums text-ember-500">
                      {formatINR(due.dueAmount)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span
                        className={clsx(
                          "inline-block max-w-full truncate rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold",
                          dueWhen?.overdue
                            ? "bg-[#E5484D]/10 text-[#E5484D]"
                            : dueWhen
                              ? "bg-[#B76E00]/10 text-[#B76E00]"
                              : "bg-ink-50 text-ink-400 dark:bg-white/5",
                        )}
                      >
                        {dueWhen?.label || "No due date"}
                      </span>
                    </span>
                    {due.customerPhone ? (
                      <a
                        href={`tel:${due.customerPhone.replace(/[^\d+]/g, "")}`}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-tide-500/30 bg-tide-100 text-bright transition hover:border-tide-500 hover:bg-[#d3ecff] dark:border-tide-400/40 dark:bg-tide-400/15 dark:text-tide-400"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        aria-label={`Call ${due.customerName}`}
                        title={`Call ${due.customerPhone}`}
                      >
                        <Phone className="h-4 w-4" />
                      </a>
                    ) : null}
                    {whatsappNumber(due.customerPhone || "") ? (
                      <a
                        href={`https://wa.me/${whatsappNumber(due.customerPhone)}?text=${encodeURIComponent(dueReminderHindi(due))}`}
                        target="_blank"
                        rel="noreferrer"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#25D366]/40 bg-[#25D366]/10 text-[#128C4A] transition hover:border-[#25D366] hover:bg-[#25D366]/20 dark:border-[#25D366]/45 dark:bg-[#25D366]/15 dark:text-[#4ADE80]"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        aria-label={`WhatsApp reminder to ${due.customerName}`}
                        title="Send payment reminder on WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    ) : null}
                    {isAdmin ? (
                      <button
                        type="button"
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-ink-900 px-3 text-xs font-semibold text-white transition hover:bg-ink-800 dark:bg-tide-400 dark:!text-[#0F172A] dark:hover:bg-tide-500"
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
                </article>
                );
              })}
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
                      ? "border-ink-900 bg-ink-900 dark:border-tide-400 dark:bg-tide-400"
                      : "border-ink-100 bg-white/90 text-ink-700 hover:border-ink-300 dark:border-ink-100 dark:bg-surface-elevated dark:hover:border-ink-300",
                  )}
                  onClick={() => setFinanceCompanyFilter(null)}
                >
                  <p
                    className={clsx(
                      "truncate text-xs",
                      !financeCompanyFilter
                        ? "text-white/70 dark:!text-slate-700"
                        : "text-ink-500",
                    )}
                  >
                    All
                  </p>
                  <p
                    className={clsx(
                      "mt-0.5 text-sm font-semibold tabular-nums",
                      !financeCompanyFilter
                        ? "text-white dark:!text-slate-900"
                        : "text-ember-500",
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
                          ? "border-ink-900 bg-ink-900 dark:border-tide-400 dark:bg-tide-400"
                          : "border-ink-100 bg-white/90 text-ink-700 hover:border-ink-300 dark:border-ink-100 dark:bg-surface-elevated dark:hover:border-ink-300",
                      )}
                      aria-pressed={on}
                      onClick={() =>
                        setFinanceCompanyFilter(on ? null : company.name)
                      }
                    >
                      <p
                        className={clsx(
                          "truncate text-xs",
                          on ? "text-white/70 dark:!text-slate-700" : "text-ink-500",
                        )}
                      >
                        {company.name}
                      </p>
                      <p
                        className={clsx(
                          "mt-0.5 text-sm font-semibold tabular-nums",
                          on ? "text-white dark:!text-slate-900" : "text-ember-500",
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
                  className="interactive-card rounded-2xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-sm shadow-ink-900/5 backdrop-blur-sm"
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
                  <div className="flex items-center gap-2">
                    <h3 className="min-w-0 truncate text-[15px] font-semibold text-ink-900">
                      {financeCompanyFilter
                        ? financeCompanyFilter
                        : formatFinanceCompanies(
                            due.financeReceived ? null : due.financeCompanyName,
                            due.financeReceived2 ? null : due.financeCompanyName2,
                          ) || "Finance company"}
                    </h3>
                    <span className="ml-auto shrink-0 font-display text-[17px] font-semibold tabular-nums text-ember-500">
                      {formatINR(financeAmountForCompany(due, financeCompanyFilter))}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="min-w-0 truncate text-xs text-ink-500">{due.customerName}</span>
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tide-100 px-2 py-0.5 text-[11px] font-semibold text-tide-600 dark:bg-tide-400/15 dark:text-tide-400"
                        title="Date the finance bill was made"
                      >
                        <CalendarDays className="h-3 w-3" />
                        {format(new Date(due.billDate), "dd MMM yyyy")}
                      </span>
                    </span>
                    {isAdmin ? (
                      <button
                        type="button"
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-ink-900 px-3 text-xs font-semibold text-white transition hover:bg-ink-800 disabled:opacity-50 dark:bg-tide-400 dark:!text-[#0F172A] dark:hover:bg-tide-500"
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
            options={(() => {
              const pending = financeSlotOptions(selectedFinanceDue, "receive");
              if (!financeCompanyFilter) return pending;
              const allowed = new Set(
                slotsMatchingCompany(
                  selectedFinanceDue,
                  financeCompanyFilter,
                ),
              );
              return pending.filter((option) => allowed.has(option.slot));
            })()}
            initialSlots={
              financeCompanyFilter
                ? slotsMatchingCompany(
                    selectedFinanceDue,
                    financeCompanyFilter,
                  )
                : undefined
            }
            saving={receivingId === selectedFinanceDue.id}
            error={error}
            onCancel={() => {
              if (receivingId) return;
              setSelectedFinanceDue(null);
              setError(null);
            }}
            onConfirm={(slots) =>
              void markFinanceReceived(selectedFinanceDue, slots)
            }
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
