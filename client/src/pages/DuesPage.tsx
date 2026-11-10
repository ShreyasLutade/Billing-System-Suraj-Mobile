import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { differenceInCalendarDays, format } from "date-fns";
import { AnimatePresence } from "framer-motion";
import {
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  Landmark,
  Lock,
  Search,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import clsx from "clsx";
import {
  DUE_PERIOD_OPTIONS,
  type DuePeriodValue,
} from "../components/PeriodFilter";
import { FinanceReceivedConfirmModal } from "../components/FinanceReceivedConfirmModal";
import { BackLink, EmptyState, LoadingBlock, SearchClearButton } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useAuth } from "../auth/AuthContext";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { usePersistedTab } from "../hooks/usePersistedTab";
import { useSessionState } from "../hooks/useSessionState";
import { fromState, readFromState, backLabel } from "../lib/navMemory";
import { api, formatFinanceCompanies, round2 } from "../lib/api";
import {
  financeSlotAmounts,
  financeSlotOptions,
  pendingFinanceAmount,
  slotsMatchingCompany,
  type FinanceSlot,
} from "../lib/financeSlots";
import {
  dueStatus,
  formatRupees,
  initials,
  URGENCY_TONE,
  type DueUrgency,
} from "../lib/dueStatus";
import {
  matchesDueSearch,
  type BillSearchScope,
} from "../lib/billSearch";
import type {
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
  { value: "finance", label: "Finance" },
];

function searchPlaceholder(
  scope: BillSearchScope,
  tab: "customer" | "finance",
) {
  if (scope === "phone") return "Search by number…";
  if (scope === "imei") return "Search by IMEI…";
  if (scope === "product") return "Search by product…";
  if (scope === "finance") return "Search by finance company…";
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

const URGENCY_ORDER: DueUrgency[] = ["overdue", "today", "upcoming", "none"];

const GROUP_TITLE: Record<DueUrgency, string> = {
  overdue: "Overdue · collect first",
  today: "Due today",
  upcoming: "Coming up",
  none: "No due date",
};

const URGENCY_ICON: Record<DueUrgency, typeof Clock3> = {
  overdue: CircleAlert,
  today: Clock3,
  upcoming: CalendarDays,
  none: CalendarDays,
};

const COMPANY_AVATARS = [
  "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  "bg-sky-500/10 text-sky-700 dark:text-sky-400",
];

/** Same company, same colour. */
function companyAvatar(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COMPANY_AVATARS[hash % COMPANY_AVATARS.length];
}

function daysSince(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(differenceInCalendarDays(new Date(), date), 0);
}

function waitingDays(days: number) {
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** Finance money waiting a week or more is red, a few days amber. */
function waitingAccent(days: number) {
  if (days >= 7) return "#E5484D";
  if (days >= 3) return "#FFB020";
  return "#34D399";
}

/** Navy summary card at the top of the Dues page. */
function DuesHero({
  label,
  amount,
  side,
  children,
}: {
  label: string;
  amount: number | null;
  side?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="dues-hero mb-2" aria-label={label}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/65">
            {label}
          </p>
          <p className="font-display text-[23px] font-bold leading-tight tracking-tight tabular-nums">
            {amount === null ? (
              "—"
            ) : (
              <>
                <span className="mr-0.5 text-[#FFA800]">₹</span>
                {formatRupees(amount).replace("₹", "")}
              </>
            )}
          </p>
        </div>
        {side ? (
          <p className="shrink-0 pb-1 text-right text-xs font-semibold leading-snug text-white/70">
            {side}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
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
  /** Admin only: list just the dues kept private from staff. */
  const [privateOnly, setPrivateOnly] = useSessionState("dues.privateOnly", false);
  const showPrivateOnly = isAdmin && tab === "customer" && privateOnly;

  const filtersActive =
    (tab === "customer" && period !== "all") ||
    searchScope !== "all" ||
    showPrivateOnly;

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
  // Customer dues have no finance company, so "Finance" only applies on the Finance tab.
  const activeScope: BillSearchScope =
    tab === "customer" && searchScope === "finance" ? "all" : searchScope;

  const filteredDues =
    data?.dues.filter(
      (due) =>
        (!showPrivateOnly || due.duePrivate) &&
        matchesDueSearch(due, searchQuery, { scope: activeScope }),
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

  const statusRows = filteredDues.map((due) => ({
    due,
    status: dueStatus(due.dueDate),
  }));
  // Overdue first, then today, coming up, no date (server order kept inside).
  const groupedDues = URGENCY_ORDER.flatMap((urgency) =>
    statusRows.filter((row) => row.status.urgency === urgency),
  );
  const groupTotals = Object.fromEntries(
    URGENCY_ORDER.map((urgency) => [urgency, 0]),
  ) as Record<DueUrgency, number>;
  for (const row of groupedDues) {
    groupTotals[row.status.urgency] = round2(
      groupTotals[row.status.urgency] + row.due.dueAmount,
    );
  }
  const customerTotal = round2(filteredTotal);
  const customerCount = query.trim() || showPrivateOnly ? filteredDues.length : (data?.count ?? 0);
  const heroSegments = [
    { label: "Overdue", color: "#FF6B6B", amount: groupTotals.overdue },
    { label: "Today", color: "#FFB020", amount: groupTotals.today },
    {
      label: "Later",
      color: "#34D399",
      amount: round2(groupTotals.upcoming + groupTotals.none),
    },
  ];
  const oldestFinanceDays = filteredFinanceDues.reduce(
    (max, due) => Math.max(max, daysSince(due.billDate)),
    0,
  );

  const customerReveal = useInfiniteReveal(
    groupedDues,
    `customer|${period}|${searchQuery}|${searchScope}|${showPrivateOnly}|${groupedDues.length}`,
  );
  const financeReveal = useInfiniteReveal(
    filteredFinanceDues,
    `finance|${searchQuery}|${searchScope}|${financeCompanyFilter || "all"}|${filteredFinanceDues.length}`,
  );

  const resetFilters = () => {
    setPeriod("all");
    setSearchScope("all");
    setFinanceCompanyFilter(null);
    setPrivateOnly(false);
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

  function openOnEnter(event: ReactKeyboardEvent<HTMLElement>, to: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigate(to, { state: fromState(location) });
    }
  }

  return (
    <div>
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink-900">
            Dues
          </h1>
          <p className="text-[12.5px] text-ink-500">
            {tab === "customer"
              ? "Money customers still owe you"
              : "Money finance companies still owe you"}
          </p>
        </div>
        {from ? <BackLink to={from}>{backLabel(from)}</BackLink> : null}
      </div>

      {tab === "customer" ? (
        <DuesHero
          label={`Total to collect${period !== "all" && data ? ` · ${data.periodLabel}` : ""}`}
          amount={data ? customerTotal : null}
          side={
            data
              ? `${customerCount} open due${customerCount === 1 ? "" : "s"}`
              : null
          }
        >
          {data && customerTotal > 0 ? (
            <>
              <div className="mt-2 flex h-1 gap-[3px] overflow-hidden rounded-full bg-white/10">
                {heroSegments.map((segment) =>
                  segment.amount > 0 ? (
                    <span
                      key={segment.label}
                      className="h-full"
                      style={{
                        width: `${(segment.amount / customerTotal) * 100}%`,
                        background: segment.color,
                      }}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-1">
                {heroSegments.map((segment) => (
                  <span
                    key={segment.label}
                    className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-white/70"
                  >
                    <span
                      className="h-[7px] w-[7px] rounded-full"
                      style={{ background: segment.color }}
                    />
                    {segment.label}
                    <b className="font-bold tabular-nums text-white">
                      {formatRupees(segment.amount)}
                    </b>
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </DuesHero>
      ) : (
        <DuesHero
          label={`Finance pending${financeCompanyFilter ? ` · ${financeCompanyFilter}` : ""}`}
          amount={financeData ? round2(filteredFinanceTotal) : null}
          side={
            financeData ? (
              <>
                {filteredFinanceDues.length} settlement
                {filteredFinanceDues.length === 1 ? "" : "s"}
                {filteredFinanceDues.length > 0 ? (
                  <>
                    <br />
                    oldest {waitingDays(oldestFinanceDays)}
                  </>
                ) : null}
              </>
            ) : null
          }
        />
      )}

      <div className="dues-seg mb-2" role="tablist" aria-label="Due type">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "customer"}
          className={clsx("dues-seg-btn", tab === "customer" && "dues-seg-on")}
          onClick={() => setTab("customer")}
        >
          <UserRound className="h-[15px] w-[15px] shrink-0" />
          Customer
          <span className="dues-seg-cnt">
            {data?.count ?? (tab === "customer" ? filteredDues.length : "—")}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "finance"}
          className={clsx("dues-seg-btn", tab === "finance" && "dues-seg-on")}
          onClick={() => setTab("finance")}
        >
          <Landmark className="h-[15px] w-[15px] shrink-0" />
          Finance
          <span className="dues-seg-cnt">
            {financeData?.count ??
              (tab === "finance" ? filteredFinanceDues.length : "—")}
          </span>
        </button>
      </div>

      <div className="tb-toolbar">
        <div className="tb-searchrow">
          <div className="tb-search">
            <Search className="h-[17px] w-[17px] shrink-0 text-[#7A8699]" />
            <input
              id="dues-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder(activeScope, tab)}
              aria-label={searchPlaceholder(activeScope, tab)}
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
              <SlidersHorizontal className="h-[19px] w-[19px]" strokeWidth={2} />
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
                    {SCOPE_CHIPS.filter(
                      (chip) => tab === "finance" || chip.value !== "finance",
                    ).map((chip) => {
                      const on = activeScope === chip.value;
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

                {isAdmin && tab === "customer" ? (
                  <label className="mb-3.5 flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink-100 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-ink-900 dark:accent-tide-400"
                      checked={privateOnly}
                      onChange={(event) => setPrivateOnly(event.target.checked)}
                    />
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-800">
                      <Lock className="h-3.5 w-3.5 text-ink-500" strokeWidth={2.2} />
                      Show only private dues
                    </span>
                  </label>
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
        <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {tab === "customer" && data && !loading ? (
        filteredDues.length === 0 ? (
          <EmptyState
            title={query.trim() ? "No matching dues" : "No dues in this period"}
            description={
              query.trim()
                ? "Try another search, or clear the search box."
                : "Try another filter, or check back when a bill has pending amount."
            }
          />
        ) : (
          <div>
            {customerReveal.visibleItems.map(({ due, status }, index) => {
              const tone = URGENCY_TONE[status.urgency];
              const overdue = status.urgency === "overdue";
              const StatusIcon = URGENCY_ICON[status.urgency];
              const paid = round2(due.paidTotal ?? 0);
              const startsGroup =
                index === 0 ||
                customerReveal.visibleItems[index - 1].status.urgency !==
                  status.urgency;
              const to = `/dues/${due.id}`;
              return (
                <Fragment key={due.id}>
                  {startsGroup ? (
                    <div
                      className={clsx(
                        "mb-1.5 flex items-center justify-between gap-3 px-1",
                        index > 0 && "mt-3",
                      )}
                    >
                      <h2 className="flex items-center gap-2 text-[12.5px] font-bold text-ink-900">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: tone.accent }}
                        />
                        {GROUP_TITLE[status.urgency]}
                      </h2>
                      <span className="text-[12.5px] font-bold tabular-nums text-ink-500">
                        {formatRupees(groupTotals[status.urgency])}
                      </span>
                    </div>
                  ) : null}
                  <article
                    role="link"
                    tabIndex={0}
                    className={clsx(
                      "due-card due-card-stripe interactive-card mb-1.5 cursor-pointer px-3 py-2.5",
                      overdue && "due-card-overdue interactive-card-danger",
                    )}
                    style={{ "--due-accent": tone.accent } as CSSProperties}
                    onClick={() => navigate(to, { state: fromState(location) })}
                    onKeyDown={(event) => openOnEnter(event, to)}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={clsx(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-bold",
                          overdue
                            ? "bg-white/80 text-rose-600 dark:bg-white/10 dark:text-rose-300"
                            : tone.avatar,
                        )}
                        aria-hidden
                      >
                        {initials(due.customerName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h3 className="truncate text-sm font-bold text-ink-900">
                            {due.customerName}
                          </h3>
                          {isAdmin && due.duePrivate ? (
                            <Lock
                              className="h-3.5 w-3.5 shrink-0 text-ink-400"
                              strokeWidth={2.4}
                              aria-label="Private due"
                            />
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-ink-400">
                          <span className="tabular-nums">{due.customerPhone}</span>
                          <span className="text-ink-300"> · </span>
                          <span className="font-mono text-tide-600">
                            {due.invoiceNumber}
                          </span>
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[15px] font-bold tabular-nums tracking-tight text-ink-900">
                          {formatRupees(due.dueAmount)}
                        </p>
                        <span
                          className={clsx(
                            "mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-bold",
                            overdue ? "bg-[#E5484D] text-white" : tone.pill,
                          )}
                        >
                          <StatusIcon className="h-2.5 w-2.5" strokeWidth={2.6} />
                          {status.label}
                        </span>
                      </div>
                    </div>
                    {paid > 0 ? (
                      <div className="mt-2 flex items-center gap-2.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-900/[0.07] dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{
                              width: `${Math.min(paid / (paid + due.dueAmount), 1) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink-500">
                          <b className="text-emerald-600 dark:text-emerald-400">
                            {formatRupees(paid)}
                          </b>{" "}
                          paid of {formatRupees(round2(paid + due.dueAmount))}
                        </span>
                      </div>
                    ) : null}
                  </article>
                </Fragment>
              );
            })}
            <LoadMoreSentinel
              sentinelRef={customerReveal.sentinelRef}
              hasMore={customerReveal.hasMore}
              loadingMore={customerReveal.loadingMore}
              totalCount={customerReveal.totalCount}
            />
          </div>
        )
      ) : null}

      {tab === "finance" && financeData && !loading ? (
        <>
          {financeCompanyTotals.length > 0 ? (
            <div className="-mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              {[
                {
                  name: null as string | null,
                  label: "All",
                  amount: financeCompanyTotals.reduce(
                    (sum, company) => sum + company.amount,
                    0,
                  ),
                },
                ...financeCompanyTotals.map((company) => ({
                  name: company.name as string | null,
                  label: company.name,
                  amount: company.amount,
                })),
              ].map((chip) => {
                const on = financeCompanyFilter === chip.name;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    aria-pressed={on}
                    className={clsx(
                      "min-w-[6rem] shrink-0 rounded-xl border px-2.5 py-1.5 text-left transition",
                      on
                        ? "dues-seg-on border-transparent"
                        : "border-[#E7EAF0] bg-white hover:border-ink-300 dark:border-[rgb(var(--color-line))] dark:bg-surface",
                    )}
                    onClick={() =>
                      setFinanceCompanyFilter(on || !chip.name ? null : chip.name)
                    }
                  >
                    <p
                      className={clsx(
                        "max-w-[10rem] truncate text-[11px] font-semibold",
                        on ? "text-white/70 dark:text-[#1f1600]/70" : "text-ink-500",
                      )}
                    >
                      {chip.label}
                    </p>
                    <p
                      className={clsx(
                        "text-sm font-bold tabular-nums",
                        on ? "text-[#FFA800] dark:text-[#1f1600]" : "text-ink-900",
                      )}
                    >
                      {formatRupees(chip.amount)}
                    </p>
                  </button>
                );
              })}
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
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
                <h2 className="flex items-center gap-2 text-[12.5px] font-bold text-ink-900">
                  <span className="h-2 w-2 rounded-full bg-[#FFB020]" />
                  Waiting longest
                </h2>
                <span className="text-[12.5px] font-bold tabular-nums text-ink-500">
                  {filteredFinanceDues.length} bill
                  {filteredFinanceDues.length === 1 ? "" : "s"}
                </span>
              </div>
              {financeReveal.visibleItems.map((due) => {
                const company = financeCompanyFilter
                  ? financeCompanyFilter
                  : formatFinanceCompanies(
                      due.financeReceived ? null : due.financeCompanyName,
                      due.financeReceived2 ? null : due.financeCompanyName2,
                    ) || "Finance company";
                const days = daysSince(due.billDate);
                const to = `/bills/${due.id}`;
                return (
                  <article
                    key={due.id}
                    role="link"
                    tabIndex={0}
                    className="due-card due-card-stripe interactive-card mb-1.5 cursor-pointer px-3 py-2.5"
                    style={{ "--due-accent": waitingAccent(days) } as CSSProperties}
                    onClick={() => navigate(to, { state: fromState(location) })}
                    onKeyDown={(event) => openOnEnter(event, to)}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={clsx(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12.5px] font-bold",
                          companyAvatar(company),
                        )}
                        aria-hidden
                      >
                        {initials(company)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-bold text-ink-900">
                          {company}
                        </h3>
                        <p className="truncate text-xs text-ink-400">
                          {due.customerName}
                          <span className="text-ink-300"> · </span>
                          <span className="font-mono text-tide-600">
                            {due.invoiceNumber}
                          </span>
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-[15px] font-bold tabular-nums tracking-tight text-ink-900">
                        {formatRupees(
                          financeAmountForCompany(due, financeCompanyFilter),
                        )}
                      </p>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-dashed border-[#E7EAF0] pt-2 dark:border-[rgb(var(--color-line))]">
                      <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-ink-500">
                        <Clock3 className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                        <span className="truncate">
                          {days > 0 ? `Waiting ${waitingDays(days)}` : "Sold today"}
                          {" · "}sold {format(new Date(due.billDate), "dd MMM")}
                        </span>
                      </p>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="due-btn-dark inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-bold transition disabled:opacity-50"
                          disabled={receivingId === due.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            setError(null);
                            setSelectedFinanceDue(due);
                          }}
                          aria-label={`Mark ${due.invoiceNumber} finance amount as received`}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
                          {receivingId === due.id ? "…" : "Received"}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
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
