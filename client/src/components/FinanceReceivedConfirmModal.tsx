import { motion } from "framer-motion";
import { Building2, Check, Undo2, X } from "lucide-react";
import { formatINR } from "../lib/api";

export function FinanceReceivedConfirmModal({
  mode = "receive",
  invoiceNumber,
  financeCompanyName,
  amount,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  mode?: "receive" | "undo";
  invoiceNumber: string;
  financeCompanyName?: string | null;
  amount: number;
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isUndo = mode === "undo";

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
          <div className="flex items-center justify-between gap-4">
            <span className="text-ink-500">Finance company</span>
            <span className="text-right font-medium text-ink-900">
              {financeCompanyName || "Finance company"}
            </span>
          </div>
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
              {formatINR(amount)}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-ink-500">
            {isUndo
              ? "This will set finance status back to Pending so it appears in finance dues again."
              : "Confirm only after the full finance amount has reached your account."}
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
            className={isUndo ? "btn-secondary border-amber-300 text-amber-800 hover:bg-amber-50" : "btn-primary"}
            onClick={onConfirm}
            disabled={saving}
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
