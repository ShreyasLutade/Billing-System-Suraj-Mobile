import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import clsx from "clsx";
import { formatINR } from "../lib/api";

export type SavePurchaseItem = {
  product: string;
  imei: string;
  price: number;
};

export function SavePurchaseConfirmModal({
  supplierName,
  condition,
  items,
  total,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  supplierName: string;
  condition: "NEW" | "USED";
  items: SavePurchaseItem[];
  total: number;
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const used = condition === "USED";

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => !saving && onCancel()}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-purchase-title"
          className="max-h-[90vh] w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
                Confirm
              </p>
              <h2
                id="save-purchase-title"
                className="mt-1 font-display text-xl font-semibold text-ink-900"
              >
                Save this purchase?
              </h2>
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

          <div className="max-h-[50vh] space-y-3 overflow-y-auto px-5 py-4 text-sm">
            <div className="flex items-start justify-between gap-4">
              <span className="shrink-0 text-ink-500">Supplier</span>
              <span className="text-right font-medium text-ink-800">
                {supplierName || "—"}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="shrink-0 text-ink-500">Type</span>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
                  used
                    ? "bg-[#FEF3E2] text-[#B76E00]"
                    : "bg-[#E7F8F1] text-[#0E9E76]",
                )}
              >
                {used ? "Second hand" : "New"}
              </span>
            </div>

            <div className="border-t border-ink-100 pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                {items.length} mobile{items.length === 1 ? "" : "s"}
              </p>
              <ul className="space-y-2">
                {items.map((item, index) => (
                  <li
                    key={`${item.imei}-${index}`}
                    className="rounded-xl border border-ink-100 bg-[#FCFDFE] px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold leading-snug text-ink-900">
                          {item.product}
                        </p>
                        {item.imei ? (
                          <p className="mt-1 break-all font-mono text-[12px] text-ink-500">
                            IMEI {item.imei}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={clsx(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
                            used
                              ? "bg-[#FEF3E2] text-[#B76E00]"
                              : "bg-[#E7F8F1] text-[#0E9E76]",
                          )}
                        >
                          {used ? "Second hand" : "New"}
                        </span>
                        <span className="text-[13px] font-semibold tabular-nums text-ink-900">
                          {formatINR(item.price)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-baseline justify-between gap-3 border-t-2 border-ink-900 pt-3">
              <span className="text-sm font-semibold text-ink-900">Total</span>
              <span className="font-display text-xl font-bold tabular-nums text-ink-900">
                {formatINR(total)}
              </span>
            </div>
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
              Review
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={onConfirm}
              disabled={saving}
            >
              <Check className="h-4 w-4" />
              {saving ? "Saving…" : "Confirm save"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
