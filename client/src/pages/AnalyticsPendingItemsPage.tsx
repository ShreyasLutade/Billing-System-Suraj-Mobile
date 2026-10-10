import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { differenceInCalendarDays, format } from "date-fns";
import { Check, Clock, Phone, Search, Undo2 } from "lucide-react";
import clsx from "clsx";
import {
  BackLink,
  EmptyState,
  LoadingBlock,
  SearchClearButton,
} from "../components/ui";
import { useSessionState } from "../hooks/useSessionState";
import { fromState } from "../lib/navMemory";
import { api } from "../lib/api";
import {
  EXCHANGE_ACCESSORIES,
  accessoryIcon,
  accessoryLabel,
} from "../lib/exchangeAccessories";
import { matchesElasticFields } from "../lib/elasticSearch";
import type {
  ExchangeAccessoryKey,
  PendingAccessoriesSummary,
  PendingAccessoryBill,
} from "../types";

type Filter = "ALL" | ExchangeAccessoryKey;

/** billId:itemIndex:key */
function slotId(billId: string, itemIndex: number, key: ExchangeAccessoryKey) {
  return `${billId}:${itemIndex}:${key}`;
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10
    ? `${digits.slice(0, 5)} ${digits.slice(5)}`
    : phone;
}

function waitingLabel(billDate: string) {
  const days = differenceInCalendarDays(new Date(), new Date(billDate));
  if (days <= 0) return { text: "Today", days: 0 };
  if (days === 1) return { text: "1 day", days };
  return { text: `${days} days`, days };
}

function phoneLabel(phone: PendingAccessoryBill["phones"][number]) {
  return [
    phone.model,
    phone.color,
    phone.storage,
    phone.platform === "ANDROID" && phone.ram ? phone.ram : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AnalyticsPendingItemsPage() {
  const location = useLocation();
  const [data, setData] = useState<PendingAccessoriesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useSessionState("analytics.pendingItems.query", "");
  const [filter, setFilter] = useSessionState<Filter>(
    "analytics.pendingItems.filter",
    "ALL",
  );
  /** Slots marked received on this visit — kept on screen so Undo is one tap away. */
  const [received, setReceived] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await api.pendingAccessories();
        if (active) {
          setData(response.data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load pending items",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function setStatus(
    bill: PendingAccessoryBill,
    itemIndex: number,
    key: ExchangeAccessoryKey,
    status: "GIVEN" | "PENDING",
  ) {
    const id = slotId(bill.billId, itemIndex, key);
    setBusy((current) => new Set(current).add(id));
    setActionError(null);
    try {
      await api.setExchangeAccessoryStatus(bill.billId, {
        itemIndex,
        key,
        status,
      });
      setReceived((current) => {
        const next = new Set(current);
        if (status === "GIVEN") next.add(id);
        else next.delete(id);
        return next;
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not update the item",
      );
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  const stillPending = useMemo(() => {
    const counts: Record<Filter, number> = {
      ALL: 0,
      BOX: 0,
      CHARGER: 0,
      CABLE: 0,
      BILL: 0,
    };
    for (const bill of data?.bills ?? []) {
      for (const phone of bill.phones) {
        for (const key of phone.pending) {
          if (received.has(slotId(bill.billId, phone.itemIndex, key))) continue;
          counts.ALL += 1;
          counts[key] += 1;
        }
      }
    }
    return { counts };
  }, [data?.bills, received]);

  const rows = useMemo(() => {
    let bills = data?.bills ?? [];
    if (filter !== "ALL") {
      bills = bills.filter((bill) =>
        bill.phones.some((phone) => phone.pending.includes(filter)),
      );
    }
    if (query.trim()) {
      bills = bills.filter((bill) =>
        matchesElasticFields(
          [
            bill.customerName,
            bill.customerPhone,
            bill.invoiceNumber,
            ...bill.phones.flatMap((phone) => [
              phone.model,
              phone.imei1,
              ...phone.pending.map(accessoryLabel),
            ]),
          ],
          query,
        ),
      );
    }
    return bills;
  }, [data?.bills, filter, query]);

  return (
    <div>
      <BackLink to="/analytics" state={fromState(location)}>
        Back to analytics
      </BackLink>

      <h1 className="mb-4 mt-3 font-display text-2xl font-semibold text-ink-900">
        Pending items
      </h1>

      {loading ? <LoadingBlock label="Loading pending items…" /> : null}
      {error ? (
        <div className="mb-3 rounded-[14px] border border-orange-100 bg-orange-50 px-5 py-4 text-sm text-ember-500">
          {error}
        </div>
      ) : null}

      {data && !loading ? (
        <>
          <section className="mb-3">
            <div className="rounded-xl border border-ink-100/80 bg-white/90 px-3.5 py-2.5 shadow-soft">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Items pending
              </p>
              <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink-900">
                {stillPending.counts.ALL}
              </p>
            </div>
          </section>

          {data.bills.length > 0 ? (
            <>
              <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1">
                {(["ALL", ...EXCHANGE_ACCESSORIES.map((a) => a.key)] as Filter[]).map(
                  (key) => {
                    const active = filter === key;
                    const count = stillPending.counts[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setFilter(key)}
                        className={clsx(
                          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                          active
                            ? "border-ink-900 bg-ink-900 text-white dark:border-tide-400 dark:bg-tide-400 dark:text-[#0F172A]"
                            : "border-ink-100 bg-white/90 text-ink-600 hover:border-ink-200",
                        )}
                      >
                        {key === "ALL" ? "All" : accessoryLabel(key)}
                        <span
                          className={clsx(
                            "tabular-nums",
                            active ? "opacity-80" : "text-ink-400",
                          )}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  },
                )}
              </div>

              <div className="mb-3">
                <label className="tb-search">
                  <Search className="h-4 w-4 shrink-0 text-ink-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search customer, phone number, model, invoice…"
                    aria-label="Search pending items"
                  />
                  <SearchClearButton
                    visible={Boolean(query)}
                    onClear={() => setQuery("")}
                  />
                </label>
              </div>
            </>
          ) : null}

          {actionError ? (
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {actionError}
            </div>
          ) : null}

          {rows.length === 0 ? (
            <EmptyState
              title={
                data.bills.length === 0
                  ? "Nothing pending"
                  : "No matching customers"
              }
              description={
                data.bills.length === 0
                  ? "Every exchange accessory has been handed over. Items marked Pending on a bill will appear here."
                  : "Try another search or filter."
              }
            />
          ) : (
            <div className="space-y-2.5">
              {rows.map((bill) => {
                const waiting = waitingLabel(bill.billDate);
                const remaining = bill.phones.reduce(
                  (sum, phone) =>
                    sum +
                    phone.pending.filter(
                      (key) =>
                        !received.has(slotId(bill.billId, phone.itemIndex, key)),
                    ).length,
                  0,
                );
                const done = remaining === 0;
                const digits = bill.customerPhone.replace(/\D/g, "");

                return (
                  <article
                    key={bill.billId}
                    className={clsx(
                      "rounded-2xl border bg-white/90 shadow-soft transition",
                      done
                        ? "border-emerald-200 dark:border-emerald-500/30"
                        : "border-ink-100/80",
                    )}
                  >
                    <div className="flex items-center gap-3 px-3.5 pb-2.5 pt-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="truncate text-[15px] font-semibold text-ink-900">
                            {bill.customerName}
                          </h3>
                          {done ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                              <Check className="h-3 w-3" strokeWidth={3} />
                              All received
                            </span>
                          ) : (
                            <span
                              className={clsx(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
                                waiting.days > 7
                                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                              )}
                              title={`Bill date ${format(new Date(bill.billDate), "dd MMM yyyy")}`}
                            >
                              <Clock className="h-3 w-3" strokeWidth={2.4} />
                              {waiting.text}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          <span className="font-medium tabular-nums text-ink-700 dark:text-ink-800">
                            {formatPhone(bill.customerPhone)}
                          </span>
                          <span className="text-ink-300"> · </span>
                          <Link
                            to={`/bills/${bill.billId}`}
                            state={fromState(location)}
                            className="font-mono text-tide-600 hover:underline"
                          >
                            {bill.invoiceNumber}
                          </Link>
                          <span className="text-ink-300"> · </span>
                          {format(new Date(bill.billDate), "dd MMM yyyy")}
                        </p>
                      </div>
                      {digits ? (
                        <a
                          href={`tel:${digits}`}
                          aria-label={`Call ${bill.customerName}`}
                          title={`Call ${formatPhone(bill.customerPhone)}`}
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_6px_16px_rgba(16,185,129,.35)] transition hover:bg-emerald-600 active:scale-95"
                        >
                          <Phone className="h-[18px] w-[18px]" strokeWidth={2.3} />
                        </a>
                      ) : null}
                    </div>

                    <div className="space-y-2 border-t border-ink-100/70 px-3.5 py-2.5">
                      {bill.phones.map((phone) => (
                        <div key={phone.itemIndex}>
                          <p className="truncate text-[12.5px] font-medium text-ink-700 dark:text-ink-800">
                            {phoneLabel(phone)}
                            <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-400">
                              {phone.imei1}
                            </span>
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {phone.pending.map((key) => {
                              const id = slotId(bill.billId, phone.itemIndex, key);
                              const isReceived = received.has(id);
                              const isBusy = busy.has(id);
                              const Icon = accessoryIcon(key);
                              const dimmed = filter !== "ALL" && filter !== key;
                              return (
                                <div
                                  key={key}
                                  className={clsx(
                                    "inline-flex items-center overflow-hidden rounded-full border text-[12.5px] font-semibold transition",
                                    isReceived
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                                      : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-200",
                                    dimmed && "opacity-50",
                                  )}
                                >
                                  <span className="inline-flex items-center gap-1.5 py-1.5 pl-2.5 pr-2">
                                    <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                                    {accessoryLabel(key)}
                                  </span>
                                  {isReceived ? (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() =>
                                        setStatus(bill, phone.itemIndex, key, "PENDING")
                                      }
                                      className="inline-flex items-center gap-1 self-stretch border-l border-emerald-200 px-2.5 text-[11.5px] text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
                                    >
                                      <Undo2 className="h-3 w-3" strokeWidth={2.4} />
                                      Undo
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() =>
                                        setStatus(bill, phone.itemIndex, key, "GIVEN")
                                      }
                                      className="inline-flex items-center gap-1 self-stretch border-l border-amber-200 bg-white/70 px-2.5 text-[11.5px] text-ink-700 transition hover:bg-emerald-500 hover:text-white disabled:opacity-50 dark:border-amber-500/35 dark:bg-transparent dark:text-ink-800"
                                    >
                                      <Check className="h-3 w-3" strokeWidth={3} />
                                      {isBusy ? "Saving…" : "Received"}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
