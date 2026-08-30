import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Check, Undo2, X } from "lucide-react";
import { formatINR } from "../lib/api";
import type { FinanceSlot, FinanceSlotOption } from "../lib/financeSlots";

export function FinanceReceivedConfirmModal({
  mode = "receive",
  invoiceNumber,
  financeCompanyName,
  amount,
  options,
  initialSlots,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  mode?: "receive" | "undo";
  invoiceNumber: string;
  /** Used when there is only one option / no selectable list */
  financeCompanyName?: string | null;
  /** Used when there is only one option / no selectable list */
  amount?: number;
  options?: FinanceSlotOption[];
  /** Pre-select these slots (e.g. company filter on dues). Defaults to all options. */
  initialSlots?: FinanceSlot[];
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (slots: FinanceSlot[]) => void;
}) {
  const isUndo = mode === "undo";
  const selectable = options && options.length > 0 ? options : null;

  const defaultSlots = useMemo(() => {
    if (initialSlots && initialSlots.length > 0) {
      const allowed = new Set((selectable || []).map((o) => o.slot));
      const filtered = initialSlots.filter((s) => allowed.has(s));
      if (filtered.length > 0) return filtered;
    }
    return (selectable || []).map((o) => o.slot);
  }, [initialSlots, selectable]);

  const [selected, setSelected] = useState<FinanceSlot[]>(defaultSlots);

  useEffect(() => {
    setSelected(defaultSlots);
  }, [defaultSlots, invoiceNumber, mode]);

  const selectedAmount = useMemo(() => {
    if (!selectable) return amount || 0;
    return selectable
      .filter((o) => selected.includes(o.slot))
      .reduce((sum, o) => sum + o.amount, 0);
  }, [selectable, selected, amount]);

  const selectedLabel = useMemo(() => {
    if (!selectable) return financeCompanyName || "Finance company";
    const names = selectable
      .filter((o) => selected.includes(o.slot))
      .map((o) => o.label);
    return names.length ? names.join(" + ") : "Select finance payment";
  }, [selectable, selected, financeCompanyName]);

  const showChooser = Boolean(selectable && selectable.length > 1);
  const canConfirm = selectable
    ? selected.length > 0
    : (amount || 0) > 0;

  function toggleSlot(slot: FinanceSlot) {
    setSelected((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot],
    );
  }

  function handleConfirm() {
    if (!canConfirm || saving) return;
    if (selectable) {
      onConfirm(selected);
      return;
    }
    onConfirm([1]);
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !saving && onCancel()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="finance-received-title"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <span
              className={
                isUndo
                  ? "rounded-xl bg-amber-100 p-2 text-amber-700"
                  : "rounded-xl bg-tide-100 p-2 text-tide-600"
              }
            >
              {isUndo ? (
                <Undo2 className="h-5 w-5" />
              ) : (
                <Building2 className="h-5 w-5" />
              )}
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
                Finance payment
              </p>
              <h2
                id="finance-received-title"
                className="mt-1 font-display text-xl font-semibold text-ink-900"
              >
                {isUndo ? "Undo received status?" : "Mark as received?"}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            onClick={onCancel}
            disabled={saving}
            aria-label="Close confirmation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-ink-500">Invoice</span>
            <span className="font-mono font-medium text-ink-900">
              {invoiceNumber}
            </span>
          </div>

          {showChooser ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
                {isUndo
                  ? "Choose payments to undo"
                  : "Choose payments received"}
              </p>
              {selectable!.map((option) => {
                const checked = selected.includes(option.slot);
                return (
                  <label
                    key={option.slot}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-3 transition ${
                      checked
                        ? isUndo
                          ? "border-amber-300 bg-amber-50"
                          : "border-tide-300 bg-tide-50"
                        : "border-ink-100 bg-white hover:border-ink-200"
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${
                        checked
                          ? isUndo
                            ? "border-amber-600 bg-amber-600 text-white"
                            : "border-tide-600 bg-tide-600 text-white"
                          : "border-ink-300 bg-white"
                      }`}
                      aria-hidden
                    >
                      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      disabled={saving}
                      onChange={() => toggleSlot(option.slot)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink-900">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-500">
                        {formatINR(option.amount)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <span className="text-ink-500">Finance company</span>
              <span className="text-right font-medium text-ink-900">
                {selectedLabel}
              </span>
            </div>
          )}

          <div
            className={
              isUndo
                ? "flex items-center justify-between gap-4 rounded-2xl bg-amber-50 px-4 py-3"
                : "flex items-center justify-between gap-4 rounded-2xl bg-tide-100/70 px-4 py-3"
            }
          >
            <span
              className={
                isUndo
                  ? "font-medium text-amber-800"
                  : "font-medium text-tide-600"
              }
            >
              {isUndo ? "Finance amount" : "Amount received"}
            </span>
            <span className="font-display text-xl font-semibold text-ink-900">
              {formatINR(selectedAmount)}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-ink-500">
            {isUndo
              ? showChooser
                ? "Selected payments go back to Pending and appear in finance dues again."
                : "This will set finance status back to Pending so it appears in finance dues again."
              : showChooser
                ? "Only the selected finance payments will be marked received. Others stay pending."
                : "Confirm only after this finance amount has reached your account."}
          </p>
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
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className={
              isUndo
                ? "btn-secondary border-amber-300 text-amber-800 hover:bg-amber-50"
                : "btn-primary"
            }
            onClick={handleConfirm}
            disabled={saving || !canConfirm}
          >
            {isUndo ? (
              <Undo2 className="h-4 w-4" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {saving
              ? "Saving…"
              : isUndo
                ? "Yes, undo received"
                : "Yes, mark received"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
