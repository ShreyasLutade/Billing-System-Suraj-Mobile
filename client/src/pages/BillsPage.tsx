import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  Download,
  Filter,
  Plus,
  Search,
  Share2,
} from "lucide-react";
import clsx from "clsx";
import {
  ACTIVITY_PERIOD_OPTIONS,
  type ActivityPeriodValue,
} from "../components/PeriodFilter";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { LoadMoreSentinel } from "../components/LoadMoreSentinel";
import { useInfiniteReveal } from "../hooks/useInfiniteReveal";
import { usePersistedTab } from "../hooks/usePersistedTab";
import { fromState } from "../lib/navMemory";
import { api, formatFinanceCompanies, formatINR } from "../lib/api";
import {
  matchesBillSearch,
  type BillSearchScope,
} from "../lib/billSearch";
import { isShareAbort, shareInvoicePdf } from "../lib/shareInvoice";
import { formatCapacityLabel } from "../lib/phoneModelSearch";
import type { Bill } from "../types";

type BillsPeriod = ActivityPeriodValue | "custom";
type BillSortKey = "date" | "amount" | "due" | "customer";
type SortDir = "asc" | "desc";

const SORT_FIELD_OPTIONS: Array<{ key: BillSortKey; label: string }> = [
  { key: "date", label: "Sold date" },
  { key: "amount", label: "Amount" },
  { key: "due", label: "Due" },
  { key: "customer", label: "Customer" },
];

function billSortLabel(key: BillSortKey, dir: SortDir) {
  if (key === "date") return dir === "desc" ? "Newest" : "Oldest";
  if (key === "customer") return dir === "asc" ? "A → Z" : "Z → A";
  const base = key === "amount" ? "Amount" : "Due";
  return `${base} ${dir === "desc" ? "↓" : "↑"}`;
}

function compareBills(a: Bill, b: Bill, key: BillSortKey, dir: SortDir) {
  const sign = dir === "asc" ? 1 : -1;
  if (key === "customer") {
    return (
      a.customerName.localeCompare(b.customerName, undefined, {
        sensitivity: "base",
      }) * sign
    );
  }
  if (key === "date") {
    return (
      (new Date(a.billDate).getTime() - new Date(b.billDate).getTime()) * sign
    );
  }
  if (key === "amount") {
    return (a.payableAmount - b.payableAmount) * sign;
  }
  return (a.dueAmount - b.dueAmount) * sign;
}

const PERIOD_LABELS: Record<ActivityPeriodValue, string> = {
  all: "All time",
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  month: "This month",
};

const PERIOD_CHIP_LABELS: Record<ActivityPeriodValue, string> = {
  all: "All",
  today: "Today",
  yesterday: "Yday",
  week: "Week",
  month: "Mth",
};

function todayInputValue() {
  return format(new Date(), "yyyy-MM-dd");
}

function formatCustomPeriodLabel(from: string, to: string) {
  const fromLabel = from
    ? format(new Date(`${from}T12:00:00`), "dd MMM yyyy")
    : "…";
  const toLabel = to
    ? format(new Date(`${to}T12:00:00`), "dd MMM yyyy")
    : "…";
  if (from && to && from === to) return fromLabel;
  return `${fromLabel} – ${toLabel}`;
}

const SCOPE_CHIPS: Array<{ value: BillSearchScope; label: string }> = [
  { value: "all", label: "All" },
  { value: "phone", label: "Number" },
  { value: "imei", label: "IMEI" },
  { value: "product", label: "Product" },
];

const PAY = {
  cash: "#12B886",
  online: "#3B82F6",
  card: "#6366F1",
  finance: "#8B5CF6",
  exchange: "#64748B",
  due: "#B76E00",
} as const;

function formatPhoneDisplay(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return phone;
}

function searchPlaceholder(scope: BillSearchScope) {
  if (scope === "phone") return "Search by number…";
  if (scope === "imei") return "Search by IMEI…";
  if (scope === "product") return "Search by product…";
  return "Search customer, phone, invoice…";
}

function billFinanceTotal(bill: Bill) {
  return Number(bill.financeAmount || 0) + Number(bill.financeAmount2 || 0);
}

function isBillPaid(bill: Bill) {
  return !(bill.dueAmount > 0 && !bill.dueSettled);
}

/** Sold product label for bill list cards (not the exchange phone). */
function soldItemLabel(item: Bill["items"][number]): string | null {
  const name = item.productName?.trim();
  if (!name) return null;
  const parts = [name];
  const storage = item.storage?.trim()
    ? formatCapacityLabel(item.storage)
    : "";
  if (storage) parts.push(storage);
  const ram = item.ram?.trim() ? formatCapacityLabel(item.ram) : "";
  if (ram) parts.push(ram);
  return parts.join(" · ");
}

function soldProductLabel(bill: Bill): string | null {
  const labels: string[] = [];
  for (const item of bill.items || []) {
    const label = soldItemLabel(item);
    if (!label || labels.includes(label)) continue;
    labels.push(label);
  }
  if (!labels.length) return null;
  if (labels.length === 1) return labels[0];
  return `${labels[0]} +${labels.length - 1} more`;
}

export function BillsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = usePersistedTab(
    "tab",
    "bills.tab",
    ["shop", "gst"] as const,
    "shop",
  );
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<BillSearchScope>("all");
  const [period, setPeriod] = useState<BillsPeriod>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const [sortKey, setSortKey] = useState<BillSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef<HTMLDivElement>(null);

  const searchQuery = query.trim();
  const isGstTab = tab === "gst";
  const customRangeReady =
    period === "custom" && Boolean(customFrom || customTo);
  const filtersActive =
    (period !== "all" && (period !== "custom" || customRangeReady)) ||
    searchScope !== "all";

  const periodTagLabel =
    period === "custom"
      ? customRangeReady
        ? formatCustomPeriodLabel(customFrom, customTo)
        : "Custom"
      : PERIOD_LABELS[period];

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.listBills(
          period === "custom" ? undefined : period,
          {
            withGst: tab === "gst",
            ...(period === "custom" && customRangeReady
              ? {
                  from: customFrom || undefined,
                  to: customTo || undefined,
                }
              : {}),
          },
        );
        if (active) {
          setBills(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load bills");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [period, tab, customFrom, customTo, customRangeReady]);

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

  useEffect(() => {
    if (!sortOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        sortWrapRef.current &&
        !sortWrapRef.current.contains(event.target as Node)
      ) {
        setSortOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sortOpen]);

  const filtered = useMemo(() => {
    const matched = bills.filter((bill) =>
      matchesBillSearch(bill, searchQuery, searchScope),
    );
    return [...matched].sort((a, b) => compareBills(a, b, sortKey, sortDir));
  }, [bills, searchQuery, searchScope, sortKey, sortDir]);

  const billsReveal = useInfiniteReveal(
    filtered,
    `${tab}|${period}|${customFrom}|${customTo}|${searchQuery}|${searchScope}|${sortKey}|${sortDir}|${filtered.length}`,
  );

  const resetFilters = () => {
    setPeriod("all");
    setCustomFrom("");
    setCustomTo("");
    setSearchScope("all");
  };

  return (
    <div>
      <PageHeader
        eyebrow="History"
        title="Bills"
        description="Every bill with its payment split. Search by name, phone, product or IMEI — filters stack with the period."
        action={
          <Link to="/" state={fromState(location)} className="btn-primary">
            <Plus className="h-4 w-4" />
            New bill
          </Link>
        }
      />

      {/* Toolbar */}
      <div className="tb-toolbar">
        <div className="tb-tabs" role="tablist" aria-label="Bill type">
          <button
            type="button"
            role="tab"
            aria-selected={!isGstTab}
            className={clsx("tb-tab", !isGstTab && "tb-tab-on")}
            onClick={() => setTab("shop")}
          >
            Bills
            {!isGstTab ? (
              <span className="tb-cnt">{filtered.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isGstTab}
            className={clsx("tb-tab", isGstTab && "tb-tab-on")}
            onClick={() => setTab("gst")}
          >
            GST bills
            {isGstTab ? (
              <span className="tb-cnt">{filtered.length}</span>
            ) : null}
          </button>
        </div>

        <div className="tb-searchrow">
          <div className="tb-search">
            <Search className="h-[17px] w-[17px] shrink-0 text-[#7A8699]" />
            <input
              id="bills-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder(searchScope)}
              aria-label={searchPlaceholder(searchScope)}
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
              aria-label="Filter bills"
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

                <div className="mb-3.5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-300">
                    Period
                  </p>
                  <div className="grid grid-cols-6 gap-1">
                    {ACTIVITY_PERIOD_OPTIONS.map((option) => {
                      const on = period === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={on}
                          aria-label={PERIOD_LABELS[option.value]}
                          title={PERIOD_LABELS[option.value]}
                          className={clsx(
                            "rounded-full border px-1 py-1.5 text-center text-[11px] transition sm:text-[12px]",
                            on
                              ? "border-ink-900 bg-ink-900 font-semibold text-white"
                              : "border-ink-100 bg-white text-ink-500 hover:border-ink-300",
                          )}
                          onClick={() => {
                            setPeriod(option.value);
                            setCustomFrom("");
                            setCustomTo("");
                            setFilterOpen(false);
                          }}
                        >
                          {PERIOD_CHIP_LABELS[option.value]}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={period === "custom"}
                      aria-label="Custom date range"
                      title="Custom date range"
                      className={clsx(
                        "rounded-full border px-1 py-1.5 text-center text-[11px] font-semibold transition sm:text-[12px]",
                        period === "custom"
                          ? "border-[#2563EB] bg-[#3B82F6] text-white shadow-[0_0_0_3px_#E8F0FE]"
                          : "border-[#93C5FD] bg-[#E8F0FE] text-[#2563EB] hover:border-[#3B82F6] hover:bg-[#DBEAFE]",
                      )}
                      onClick={() => {
                        setPeriod("custom");
                        if (!customFrom && !customTo) {
                          setCustomFrom(todayInputValue());
                          setCustomTo(todayInputValue());
                        }
                      }}
                    >
                      Custom
                    </button>
                  </div>

                  {period === "custom" ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-ink-100 bg-[#F7F8FA] p-3">
                      <div>
                        <label
                          htmlFor="bills-custom-from"
                          className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400"
                        >
                          From
                        </label>
                        <input
                          id="bills-custom-from"
                          type="date"
                          className="w-full rounded-lg border border-ink-100 bg-white px-2 py-2 text-[13px] text-ink-900 outline-none focus:border-blue-400"
                          value={customFrom}
                          max={customTo || undefined}
                          onChange={(e) => setCustomFrom(e.target.value)}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="bills-custom-to"
                          className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400"
                        >
                          To
                        </label>
                        <input
                          id="bills-custom-to"
                          type="date"
                          className="w-full rounded-lg border border-ink-100 bg-white px-2 py-2 text-[13px] text-ink-900 outline-none focus:border-blue-400"
                          value={customTo}
                          min={customFrom || undefined}
                          onChange={(e) => setCustomTo(e.target.value)}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

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

      {/* Result bar */}
      {!loading && !error ? (
        <div className="mb-2.5 flex items-center justify-between gap-3 px-1 text-[13px] text-ink-500">
          <span className="flex flex-wrap items-center gap-1">
            <b className="font-semibold text-ink-900">{filtered.length}</b>{" "}
            {isGstTab ? "GST bills" : "bills"}
            <span className="ml-1 inline-flex items-center rounded-full bg-[#EDEFF3] px-2.5 py-0.5 text-xs font-semibold text-ink-500">
              {periodTagLabel}
            </span>
          </span>
          <div className="relative shrink-0" ref={sortWrapRef}>
            <button
              type="button"
              className={clsx(
                "inline-flex items-center justify-center gap-2 rounded-[11px] border bg-white p-2.5 text-[13px] font-semibold text-ink-700 shadow-soft transition sm:px-3.5 sm:py-2",
                sortOpen
                  ? "border-ink-900 text-ink-900"
                  : "border-ink-100 text-ink-500 hover:border-ink-300 hover:text-ink-900",
              )}
              aria-haspopup="true"
              aria-expanded={sortOpen}
              aria-label={`Sort: ${billSortLabel(sortKey, sortDir)}`}
              title={`Sort: ${billSortLabel(sortKey, sortDir)}`}
              onClick={() => setSortOpen((open) => !open)}
            >
              <ArrowDownUp
                className="h-4 w-4 text-ink-500 sm:h-[15px] sm:w-[15px] sm:text-ink-300"
                strokeWidth={2}
              />
              <span className="hidden sm:inline">
                Sort:{" "}
                <b className="font-semibold text-ink-900">
                  {billSortLabel(sortKey, sortDir)}
                </b>
              </span>
              <ChevronDown
                className={clsx(
                  "hidden h-[13px] w-[13px] text-ink-300 transition sm:block",
                  sortOpen && "rotate-180",
                )}
                strokeWidth={2}
              />
            </button>

            {sortOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+8px)] z-40 w-[230px] origin-top-right rounded-[14px] border border-ink-100 bg-white p-3 shadow-[0_8px_20px_rgba(16,25,40,.10),0_24px_60px_rgba(16,25,40,.16)]"
                role="menu"
                aria-label="Sort bills"
              >
                <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-300">
                  Direction
                </p>
                <div className="mb-3 grid grid-cols-2 gap-0.5 rounded-[10px] bg-[#EEF0F3] p-[3px]">
                  {(
                    [
                      { value: "desc" as const, label: "High → Low" },
                      { value: "asc" as const, label: "Low → High" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={clsx(
                        "rounded-[7px] px-2 py-1.5 text-center text-xs transition",
                        sortDir === option.value
                          ? "bg-white font-semibold text-ink-900 shadow-soft"
                          : "font-medium text-ink-500 hover:text-ink-900",
                      )}
                      onClick={() => setSortDir(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-300">
                  Sort by
                </p>
                <div className="space-y-0.5">
                  {SORT_FIELD_OPTIONS.map((option) => {
                    const on = sortKey === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        role="menuitemradio"
                        aria-checked={on}
                        className={clsx(
                          "flex w-full items-center justify-between rounded-[9px] px-2.5 py-2 text-left text-[13.5px] transition",
                          on
                            ? "bg-[#F1F5FF] font-semibold text-ink-900"
                            : "font-medium text-ink-500 hover:bg-[#F4F5F7] hover:text-ink-900",
                        )}
                        onClick={() => {
                          setSortKey(option.key);
                          if (option.key === "customer") setSortDir("asc");
                          else if (option.key === "date") setSortDir("desc");
                        }}
                      >
                        {option.label}
                        <Check
                          className={clsx(
                            "h-[15px] w-[15px] text-[#2563EB]",
                            on ? "opacity-100" : "opacity-0",
                          )}
                          strokeWidth={2.6}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {loading ? <LoadingBlock label="Fetching bills…" /> : null}
      {error ? (
        <div className="glass-panel px-5 py-4 text-sm text-ember-500">{error}</div>
      ) : null}
      {shareError ? (
        <div className="mb-3 rounded-[14px] border border-orange-100 bg-orange-50 px-5 py-4 text-sm text-ember-500">
          {shareError}
        </div>
      ) : null}

      {!loading && !error && filtered.length === 0 ? (
        <EmptyState
          title={
            searchQuery
              ? isGstTab
                ? "No matching GST bills"
                : "No matching bills"
              : isGstTab
                ? "No GST bills in this period"
                : "No bills in this period"
          }
          description={
            searchQuery
              ? "Try another name, phone, product, IMEI, or invoice number."
              : isGstTab
                ? "Create a bill with “Generate GST bill” turned on."
                : "Try another filter, or create a new bill from the New Bill screen."
          }
        />
      ) : null}

      <div className="flex flex-col gap-2">
        {billsReveal.visibleItems.map((bill, index) => {
          const paid = isBillPaid(bill);
          const finance = billFinanceTotal(bill);
          const financeNames = formatFinanceCompanies(
            bill.financeCompanyName,
            bill.financeCompanyName2,
          );
          const soldLabel = soldProductLabel(bill);

          return (
            <article
              key={bill.id}
              role="link"
              tabIndex={0}
              className={clsx(
                "interactive-card relative grid items-center gap-x-3 overflow-hidden rounded-[14px] border border-ink-100/80 bg-white/90 py-3 pl-[18px] pr-3.5 shadow-soft sm:gap-x-4 sm:pr-4",
                "grid-cols-1 max-[420px]:gap-y-2.5 sm:grid-cols-[minmax(160px,1.25fr)_minmax(120px,1.35fr)_148px_74px]",
                soldLabel
                  ? "max-sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)] max-sm:items-start max-sm:gap-y-2 max-sm:[grid-template-areas:'who_money'_'product_product'_'pays_pays'_'actions_actions']"
                  : "max-sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)] max-sm:items-start max-sm:gap-y-2.5 max-sm:[grid-template-areas:'who_money'_'pays_pays'_'actions_actions']",
              )}
              style={{ animationDelay: `${0.02 + index * 0.03}s` }}
              onClick={() =>
                navigate(`/bills/${bill.id}`, { state: fromState(location) })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/bills/${bill.id}`, { state: fromState(location) });
                }
              }}
            >
              <span
                aria-hidden
                className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-[3px]"
                style={{ background: paid ? PAY.cash : PAY.due }}
              />

              <div className="min-w-0 max-sm:[grid-area:who]">
                <p className="truncate font-display text-[15px] font-semibold leading-snug text-ink-900">
                  {bill.customerName}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  <span className="font-semibold tracking-wide text-ink-700">
                    {bill.invoiceNumber}
                  </span>
                  <span className="mx-1.5 opacity-50">·</span>
                  <span className="tabular-nums">
                    {formatPhoneDisplay(bill.customerPhone)}
                  </span>
                  <span className="mx-1.5 opacity-50">·</span>
                  {format(new Date(bill.billDate), "dd MMM")}
                </p>
                {soldLabel ? (
                  <p className="mt-1 hidden truncate text-[12.5px] font-semibold leading-snug text-[#2563EB] dark:text-[#93C5FD] sm:block">
                    {soldLabel}
                  </p>
                ) : null}
              </div>

              {soldLabel ? (
                <p className="min-w-0 truncate text-[12.5px] font-semibold leading-snug text-[#2563EB] dark:text-[#93C5FD] max-sm:[grid-area:product] sm:hidden">
                  {soldLabel}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-1.5 max-sm:[grid-area:pays]">
                {isGstTab ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-ink-100 bg-[#F7F8FA] px-2.5 py-1 text-xs font-medium text-ink-500">
                    GST invoice
                  </span>
                ) : (
                  <>
                    {bill.cashAmount > 0 ? (
                      <PayChip tone="cash" label="Cash" amount={bill.cashAmount} />
                    ) : null}
                    {bill.onlineAmount > 0 ? (
                      <PayChip
                        tone="online"
                        label="Online"
                        amount={bill.onlineAmount}
                      />
                    ) : null}
                    {(bill.cardAmount || 0) > 0 ? (
                      <PayChip
                        tone="card"
                        label="Card"
                        amount={bill.cardAmount || 0}
                      />
                    ) : null}
                    {finance > 0 ? (
                      <PayChip
                        tone="finance"
                        label={
                          financeNames
                            ? `Finance · ${financeNames}`
                            : "Finance"
                        }
                        amount={finance}
                      />
                    ) : null}
                    {bill.isExchange && bill.exchangeValue ? (
                      <PayChip
                        tone="exchange"
                        label={`Exch · ${bill.exchangeModel || "Mobile"}`}
                        amount={bill.exchangeValue}
                      />
                    ) : null}
                    {bill.dueAmount > 0 && !bill.dueSettled ? (
                      <PayChip
                        tone="due"
                        label={bill.isPartialPaid ? "Remaining" : "Due"}
                        amount={bill.dueAmount}
                      />
                    ) : null}
                    {!bill.cashAmount &&
                    !bill.onlineAmount &&
                    !(bill.cardAmount || 0) &&
                    finance <= 0 &&
                    !(bill.isExchange && bill.exchangeValue) &&
                    !(bill.dueAmount > 0 && !bill.dueSettled) ? (
                      <span className="inline-flex items-center rounded-lg border border-ink-100 bg-[#F7F8FA] px-2.5 py-1 text-xs text-ink-500">
                        No payment recorded
                      </span>
                    ) : null}
                  </>
                )}
              </div>

              <div className="min-w-0 max-w-full justify-self-end text-right max-sm:[grid-area:money]">
                <p className="truncate font-display text-base font-bold leading-tight tabular-nums text-ink-900 sm:text-lg">
                  {formatINR(bill.grandTotal)}
                </p>
                {!isGstTab && (bill.companyDiscount || 0) > 0 ? (
                  <p className="mt-0.5 truncate text-[11px] font-medium text-[#B76E00]">
                    incl. {formatINR(bill.companyDiscount || 0)} discount
                  </p>
                ) : null}
                {isGstTab ? (
                  <p className="mt-0.5 truncate text-[11.5px] font-medium text-ink-500">
                    Tax invoice
                  </p>
                ) : paid ? (
                  <p className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[11.5px] font-semibold text-[#0E9E76]">
                    <Check className="h-3 w-3 shrink-0" strokeWidth={2.6} />
                    Fully paid
                  </p>
                ) : (
                  <p className="mt-0.5 truncate text-[11.5px] font-semibold text-[#B76E00]">
                    ● {formatINR(bill.dueAmount)} due
                    {bill.isExchange ? (
                      <span className="font-medium text-ink-500">
                        {" "}
                        · after exch
                      </span>
                    ) : null}
                  </p>
                )}
              </div>

              <div className="flex justify-start gap-1 max-sm:[grid-area:actions] max-sm:justify-end sm:justify-end">
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-[9px] border border-ink-100 bg-white text-ink-500 outline-none transition hover:border-ink-300 hover:bg-[#F7F8FA] hover:text-ink-900 focus:outline-none focus-visible:shadow-soft disabled:opacity-50 dark:border-ink-100 dark:bg-surface-elevated dark:hover:bg-surface-muted"
                  aria-label="Share"
                  disabled={sharingId === bill.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShareError(null);
                    setSharingId(bill.id);
                    void shareInvoicePdf(bill.id, bill.invoiceNumber)
                      .catch((err) => {
                        if (!isShareAbort(err)) {
                          setShareError(
                            err instanceof Error
                              ? err.message
                              : "Could not open share sheet",
                          );
                        }
                      })
                      .finally(() => setSharingId(null));
                  }}
                >
                  <Share2 className="h-[15px] w-[15px]" />
                </button>
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-[9px] border border-ink-100 bg-white text-ink-500 outline-none transition hover:border-ink-300 hover:bg-[#F7F8FA] hover:text-ink-900 focus:outline-none focus-visible:shadow-soft dark:border-ink-100 dark:bg-surface-elevated dark:hover:bg-surface-muted"
                  aria-label="Download PDF"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(
                      api.pdfUrl(bill.id),
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  <Download className="h-[15px] w-[15px]" />
                </button>
              </div>
            </article>
          );
        })}
        <LoadMoreSentinel
          sentinelRef={billsReveal.sentinelRef}
          hasMore={billsReveal.hasMore}
          loadingMore={billsReveal.loadingMore}
          totalCount={billsReveal.totalCount}
        />
      </div>
    </div>
  );
}

function PayChip({
  tone,
  label,
  amount,
}: {
  tone: keyof typeof PAY;
  label: string;
  amount: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-ink-100 bg-[#F7F8FA] px-2.5 py-1 text-xs font-medium tabular-nums text-ink-500">
      <i
        className="block h-[7px] w-[7px] shrink-0 rounded-[2.5px]"
        style={{ background: PAY[tone] }}
      />
      {label}{" "}
      <b className="font-semibold text-ink-900">{formatINR(amount)}</b>
    </span>
  );
}
