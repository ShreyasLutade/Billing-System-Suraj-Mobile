import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import { Check, ChevronDown, Search, X } from "lucide-react";
import clsx from "clsx";
import { useVisualViewportStyle } from "../hooks/useVisualViewport";
import { api, formatINR } from "../lib/api";
import { matchesElasticFields } from "../lib/elasticSearch";

export type PaySupplierListItem = {
  id: string;
  name: string;
  phone?: string | null;
  outstanding: number;
};

type PaySupplierResponse = Promise<{ data: { paid: number; outstanding: number } }>;

/** Rupees → paise, so comparisons against the outstanding are exact. */
function toPaise(value: number) {
  return Math.round(value * 100);
}

/**
 * Parse the custom amount box. Returns paise, or an error message.
 * Accepts "5000", "5,000", "5000.5"; rejects 0, negatives and >2 decimals.
 */
function parseAmount(raw: string): { paise: number } | { error: string } {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return { error: "Enter the amount paid" };
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) {
    return { error: "Enter a valid amount (up to 2 decimals)" };
  }
  const paise = toPaise(Number(cleaned));
  if (paise <= 0) return { error: "Enter an amount above ₹0" };
  return { paise };
}

export function PaySupplierModal({
  open,
  suppliers,
  onClose,
  onPaid,
  paySupplier = api.paySupplier,
}: {
  open: boolean;
  /** Suppliers from the list page (with their ledger totals). */
  suppliers: PaySupplierListItem[];
  onClose: () => void;
  /** Called after a successful payment so the page can reload totals. */
  onPaid: (message: string) => void;
  /** Allows another shop section to reuse this exact payment experience. */
  paySupplier?: (id: string, amount?: number, paidAt?: string) => PaySupplierResponse;
}) {
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"full" | "custom">("full");
  const [customAmount, setCustomAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Keep the dialog in the visible area above the phone keyboard.
  const viewportStyle = useVisualViewportStyle(open);

  // Only suppliers that are actually owed money can be paid.
  const payable = useMemo(
    () =>
      suppliers
        .filter((s) => toPaise(s.outstanding) > 0)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        ),
    [suppliers],
  );
  const selected = payable.find((s) => s.id === selectedId) ?? null;
  const matches = useMemo(
    () => payable.filter((s) => matchesElasticFields([s.name, s.phone], query)),
    [payable, query],
  );

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setListOpen(false);
    setSelectedId(null);
    setMode("full");
    setCustomAmount("");
    setPaidAt(format(new Date(), "yyyy-MM-dd"));
    setError(null);
    setPaying(false);
  }, [open]);

  useEffect(() => {
    if (!listOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setListOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [listOpen]);

  const outstandingPaise = selected ? toPaise(selected.outstanding) : 0;
  const parsed = mode === "custom" ? parseAmount(customAmount) : null;
  const payPaise =
    mode === "full" ? outstandingPaise : parsed && "paise" in parsed ? parsed.paise : 0;
  const overpay = mode === "custom" && payPaise > outstandingPaise;
  const remainingPaise = Math.max(outstandingPaise - payPaise, 0);
  const canPay =
    Boolean(selected) &&
    Boolean(paidAt) &&
    !paying &&
    payPaise > 0 &&
    !overpay &&
    (mode === "full" || (parsed !== null && "paise" in parsed));

  function choose(supplier: PaySupplierListItem) {
    setSelectedId(supplier.id);
    setQuery(supplier.name);
    setListOpen(false);
    setMode("full");
    setCustomAmount("");
    setError(null);
  }

  function close() {
    if (!paying) onClose();
  }

  async function pay() {
    if (!selected) {
      setError("Choose a supplier");
      return;
    }
    if (mode === "custom") {
      if (parsed && "error" in parsed) {
        setError(parsed.error);
        return;
      }
      if (overpay) {
        setError(`Can't pay more than the ${formatINR(selected.outstanding)} outstanding`);
        return;
      }
    }
    if (!paidAt) {
      setError("Choose the payment date");
      return;
    }
    if (payPaise <= 0) return;

    setPaying(true);
    setError(null);
    try {
      // "Full" sends no amount, so the server clears exactly what it has as
      // outstanding even if the list here is a little out of date.
      const { data } = await paySupplier(
        selected.id,
        mode === "full" ? undefined : payPaise / 100,
        paidAt,
      );
      onPaid(
        data.outstanding > 0
          ? `Paid ${formatINR(data.paid)} to ${selected.name} · ${formatINR(data.outstanding)} still outstanding`
          : `Paid ${formatINR(data.paid)} to ${selected.name} · fully settled`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setPaying(false);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/45 p-4"
          style={viewportStyle}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-supplier-title"
            className="w-full max-w-md rounded-3xl border border-white/70 bg-white shadow-lift dark:border-ink-100 dark:bg-surface-elevated"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <h2
                id="pay-supplier-title"
                className="mt-0.5 font-display text-xl font-semibold text-ink-900"
              >
                Pay supplier
              </h2>
              <button
                type="button"
                className="shrink-0 rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
                onClick={close}
                aria-label="Close"
                disabled={paying}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4 text-sm text-ink-600">
              <div ref={pickerRef} className="relative">
                <span className="mb-1 block text-xs font-semibold text-ink-500">
                  Supplier
                </span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                  <input
                    className="field w-full !pl-9 !pr-9"
                    placeholder={
                      payable.length
                        ? "Type or choose a supplier…"
                        : "No supplier has anything outstanding"
                    }
                    value={query}
                    autoFocus
                    autoComplete="off"
                    disabled={paying || payable.length === 0}
                    role="combobox"
                    aria-expanded={listOpen}
                    aria-controls="pay-supplier-list"
                    onFocus={() => setListOpen(true)}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setListOpen(true);
                      // Typing again un-picks the supplier until one is chosen.
                      if (selectedId) setSelectedId(null);
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && listOpen && matches.length) {
                        event.preventDefault();
                        choose(matches[0]);
                      }
                    }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-400 hover:text-ink-700"
                    aria-label="Show suppliers"
                    disabled={paying || payable.length === 0}
                    onClick={() => setListOpen((v) => !v)}
                  >
                    <ChevronDown
                      className={clsx("h-4 w-4 transition", listOpen && "rotate-180")}
                    />
                  </button>
                </div>

                {listOpen && payable.length ? (
                  <ul
                    id="pay-supplier-list"
                    role="listbox"
                    className="absolute inset-x-0 top-[calc(100%+6px)] z-10 max-h-44 overflow-y-auto rounded-2xl border border-ink-100 bg-white p-1.5 shadow-[0_8px_20px_rgba(16,25,40,.10),0_24px_60px_rgba(16,25,40,.16)] dark:bg-surface-elevated"
                  >
                    {matches.length ? (
                      matches.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={s.id === selectedId}
                            className={clsx(
                              "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-tide-100",
                              s.id === selectedId && "bg-tide-100",
                            )}
                            onClick={() => choose(s)}
                          >
                            <span className="min-w-0 truncate font-semibold text-ink-900">
                              {s.name}
                            </span>
                            <span className="shrink-0 tabular-nums text-[12.5px] text-ink-500">
                              {formatINR(s.outstanding)}
                            </span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="px-3 py-2 text-ink-400">
                        No supplier with outstanding matches “{query.trim()}”
                      </li>
                    )}
                  </ul>
                ) : null}
              </div>

              {selected ? (
                <>
                  <div className="flex items-center justify-between rounded-2xl bg-ink-50 px-4 py-3 dark:bg-surface-muted">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
                      Outstanding
                    </span>
                    <span className="font-display text-xl font-semibold tabular-nums text-ink-900">
                      {formatINR(selected.outstanding)}
                    </span>
                  </div>

                  <div
                    className="grid grid-cols-2 gap-2"
                    role="radiogroup"
                    aria-label="How much to pay"
                  >
                    {(
                      [
                        { value: "full", label: "Pay full" },
                        { value: "custom", label: "Custom" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={mode === option.value}
                        className={clsx(
                          "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                          mode === option.value
                            ? "border-tide-500 bg-tide-100/80 text-bright dark:border-tide-400 dark:bg-tide-400/15 dark:text-tide-400"
                            : "border-ink-100 text-ink-600 hover:bg-ink-50",
                        )}
                        onClick={() => {
                          setMode(option.value);
                          setError(null);
                        }}
                        disabled={paying}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {mode === "custom" ? (
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-ink-500">
                        Amount paid now (max {formatINR(selected.outstanding)})
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className={clsx(
                          "field w-full tabular-nums",
                          overpay && "!border-rose-400",
                        )}
                        placeholder="0"
                        value={customAmount}
                        autoFocus
                        onChange={(event) => {
                          // Digits, commas and one decimal point only.
                          setCustomAmount(event.target.value.replace(/[^\d.,]/g, ""));
                          setError(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void pay();
                        }}
                        disabled={paying}
                      />
                      {overpay ? (
                        <span className="mt-1 block text-[12.5px] font-semibold text-rose-600">
                          More than the {formatINR(selected.outstanding)} outstanding
                        </span>
                      ) : null}
                    </label>
                  ) : null}

                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-ink-500">
                      Payment date
                    </span>
                    <input
                      type="date"
                      className="field w-full"
                      value={paidAt}
                      onChange={(event) => {
                        setPaidAt(event.target.value);
                        setError(null);
                      }}
                      disabled={paying}
                      required
                    />
                  </label>

                  <div className="space-y-1.5 rounded-2xl border border-ink-100 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-ink-500">Paying now</span>
                      <span className="font-semibold tabular-nums text-ink-900">
                        {formatINR(overpay ? 0 : payPaise / 100)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-ink-500">Remaining after</span>
                      <span
                        className={clsx(
                          "font-semibold tabular-nums",
                          !overpay && payPaise > 0 && remainingPaise === 0
                            ? "text-[#0E9E76]"
                            : "text-ink-900",
                        )}
                      >
                        {overpay
                          ? "—"
                          : remainingPaise === 0 && payPaise > 0
                            ? "Fully settled"
                            : formatINR(remainingPaise / 100)}
                      </span>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {error ? (
              <p className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={close}
                disabled={paying}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void pay()}
                disabled={!canPay}
              >
                <Check className="h-4 w-4" />
                {paying
                  ? "Paying…"
                  : canPay
                    ? `Pay ${formatINR(payPaise / 100)}`
                    : "Pay"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
