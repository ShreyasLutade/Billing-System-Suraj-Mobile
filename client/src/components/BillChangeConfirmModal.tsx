import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import type { DiffLine } from "../lib/billDiff";

function changeLabel(kind: DiffLine["kind"]) {
  if (kind === "added") return "Added";
  if (kind === "removed") return "Removed";
  return "Changed";
}

function changeText(change: DiffLine) {
  if (change.kind === "added") {
    return change.after || "—";
  }
  if (change.kind === "removed") {
    return `Removed “${change.before || "—"}”`;
  }
  return `${change.before || "—"} → ${change.after || "—"}`;
}

export function BillChangeConfirmModal({
  invoiceNumber,
  changes,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  invoiceNumber: string;
  changes: DiffLine[];
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
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
          aria-labelledby="bill-change-title"
          className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
                Confirm
              </p>
              <h2
                id="bill-change-title"
                className="mt-1 font-display text-xl font-semibold text-ink-900"
              >
                Save changes?
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                {invoiceNumber}
                {changes.length > 0
                  ? ` · ${changes.length} change${changes.length === 1 ? "" : "s"}`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              className="rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
              onClick={onCancel}
              disabled={saving}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {changes.length === 0 ? (
              <p className="rounded-2xl border border-ink-100 bg-ink-50/80 px-4 py-6 text-center text-sm text-ink-500">
                No changes detected.
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {changes.map((change) => (
                  <li
                    key={change.id}
                    className="rounded-2xl border border-ink-100 bg-ink-50/50 px-3.5 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-ink-900">{change.path}</p>
                      <span className="shrink-0 text-xs font-semibold text-ink-500">
                        {changeLabel(change.kind)}
                      </span>
                    </div>
                    <p className="mt-1.5 leading-relaxed text-ink-600">
                      {changeText(change)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
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
              className="btn-primary"
              onClick={onConfirm}
              disabled={saving || changes.length === 0}
            >
              <Check className="h-4 w-4" />
              {saving ? "Saving…" : "Confirm"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
