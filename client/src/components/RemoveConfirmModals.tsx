import { useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, PackageCheck, RotateCcw, Trash2, X } from "lucide-react";
import type { Bill, BillItem } from "../types";
import { playWarningSound } from "../utils/beep";

/** Deleted bills and stock stay in the Recycle bin this long. */
export const RECYCLE_BIN_DAYS = 3;

function stockLines(bill: Bill) {
  return bill.items.filter((item) => item.stockItemId);
}

function unitLabel(item: BillItem) {
  const id = item.imei1 || item.serialNumber;
  return id ? `${item.productName} · ${id}` : item.productName;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

type BillModalProps = {
  bill: Bill;
  working: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Plain confirm for a bill's "Return" (phones become second-hand stock). */
export function ReturnBillConfirmModal({
  bill,
  working,
  error,
  onCancel,
  onConfirm,
}: BillModalProps) {
  const lines = stockLines(bill);
  return (
    <ConfirmModal
      title="Return this bill?"
      subtitle={`${bill.invoiceNumber} · ${bill.customerName}`}
      confirmLabel="Return"
      icon={<RotateCcw className="h-4 w-4" />}
      working={working}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        The bill is removed and{" "}
        <span className="font-semibold text-ink-800">
          {plural(lines.length, "mobile")}
        </span>{" "}
        go back to second-hand stock (adds a Return card).
      </p>
      <ul className="space-y-1.5">
        {lines.map((item, index) => (
          <li
            key={item.id ?? index}
            className="flex items-center gap-2 rounded-xl border border-ink-100 bg-ink-50/50 px-3 py-2 text-[13px] font-medium text-ink-800"
          >
            <RotateCcw className="h-4 w-4 shrink-0 text-tide-600" />
            <span className="min-w-0 truncate">{unitLabel(item)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-500">
        You can undo this from the Recycle bin for {RECYCLE_BIN_DAYS} days.
      </p>
    </ConfirmModal>
  );
}

/** Plain confirm for "Return to Stock" (sale undone, as if never sold). */
export function ReturnToStockConfirmModal({
  bill,
  working,
  error,
  onCancel,
  onConfirm,
}: BillModalProps) {
  const lines = stockLines(bill);
  return (
    <ConfirmModal
      title="Return to stock?"
      subtitle={`${bill.invoiceNumber} · ${bill.customerName}`}
      icon={<PackageCheck className="h-4 w-4" />}
      working={working}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        The bill is removed and{" "}
        <span className="font-semibold text-ink-800">
          {plural(lines.length, "mobile")}
        </span>{" "}
        go back in stock under the original supplier, as if never sold.
      </p>
      <ul className="space-y-1.5">
        {lines.map((item, index) => (
          <li
            key={item.id ?? index}
            className="flex items-center gap-2 rounded-xl border border-ink-100 bg-ink-50/50 px-3 py-2 text-[13px] font-medium text-ink-800"
          >
            <PackageCheck className="h-4 w-4 shrink-0 text-tide-600" />
            <span className="min-w-0 truncate">{unitLabel(item)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-500">
        You can undo this from the Recycle bin for {RECYCLE_BIN_DAYS} days.
      </p>
    </ConfirmModal>
  );
}

/** Bill "Delete": invoice and its stock mobiles are removed. */
export function DeleteBillModal({
  bill,
  working,
  error,
  onCancel,
  onConfirm,
}: BillModalProps) {
  const lines = stockLines(bill);
  return (
    <DangerConfirmModal
      title="Delete this bill?"
      subtitle={`${bill.invoiceNumber} · ${bill.customerName}`}
      undoDays={RECYCLE_BIN_DAYS}
      points={[
        "The invoice is removed.",
        ...(lines.length
          ? [
              <>
                {plural(lines.length, "mobile")} deleted from stock, <b>not</b>{" "}
                returned.
              </>,
            ]
          : []),
      ]}
      hint={
        lines.length ? (
          <>
            Sale cancelled? Use{" "}
            <span className="font-semibold text-ink-800">Return to Stock</span>{" "}
            or <span className="font-semibold text-ink-800">Return</span>{" "}
            instead.
          </>
        ) : null
      }
      cancelLabel="Keep bill"
      working={working}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/** The app's plain confirm dialog. Use inside <AnimatePresence>. */
export function ConfirmModal({
  title,
  subtitle,
  children,
  confirmLabel = "Confirm",
  workingLabel = "Working…",
  icon = <Check className="h-4 w-4" />,
  working,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  workingLabel?: string;
  icon?: ReactNode;
  working: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !working && onCancel()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              Confirm
            </p>
            <h2
              id="confirm-modal-title"
              className="mt-1 font-display text-xl font-semibold text-ink-900"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 break-words text-sm text-ink-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            onClick={onCancel}
            disabled={working}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {children ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm text-ink-600">
            {children}
          </div>
        ) : null}

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
            disabled={working}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={working}
          >
            {icon}
            {working ? workingLabel : confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Loud warning before deleting: plays an alert sound, shakes once and lists
 * what will be lost. Use inside <AnimatePresence>.
 */
export function DangerConfirmModal({
  title = "Delete?",
  subtitle,
  points,
  hint = null,
  undoDays,
  confirmLabel = undoDays ? "Delete" : "Delete forever",
  workingLabel = "Deleting…",
  cancelLabel = "Cancel",
  working,
  error,
  onCancel,
  onConfirm,
}: {
  title?: string;
  subtitle?: ReactNode;
  /** What will be lost; the undo / "cannot be undone" line is added last. */
  points: ReactNode[];
  hint?: ReactNode;
  /** Set when the delete goes to the Recycle bin (undo possible for N days). */
  undoDays?: number;
  confirmLabel?: string;
  workingLabel?: string;
  cancelLabel?: string;
  working: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    playWarningSound();
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-950/60 p-4 backdrop-blur-[2px] sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !working && onCancel()}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-forever-title"
        aria-describedby="delete-forever-desc"
        className="w-full max-w-sm overflow-hidden rounded-3xl border border-rose-200 bg-white shadow-lift dark:border-rose-500/40"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1, x: [0, -10, 10, -7, 7, -3, 0] }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.45, x: { delay: 0.12, duration: 0.45 } }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex flex-col items-center bg-gradient-to-b from-rose-50 to-white px-6 pb-4 pt-7 text-center dark:from-rose-500/15 dark:to-transparent">
          <button
            type="button"
            className="absolute right-3 top-3 rounded-xl p-2 text-ink-400 transition hover:bg-white/70 hover:text-ink-700"
            onClick={onCancel}
            disabled={working}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <span className="relative grid h-16 w-16 place-items-center">
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full bg-rose-400/30"
              animate={{ scale: [1, 1.45], opacity: [0.6, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
            />
            <span className="relative grid h-16 w-16 place-items-center rounded-full bg-rose-600 text-white shadow-[0_8px_24px_rgba(225,29,72,.35)]">
              <AlertTriangle className="h-8 w-8" strokeWidth={2.2} />
            </span>
          </span>
          <h2
            id="delete-forever-title"
            className="mt-4 font-display text-[22px] font-bold text-ink-900"
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 break-words text-sm text-ink-500">{subtitle}</p>
          ) : null}
        </div>

        <div id="delete-forever-desc" className="space-y-3 px-6 pb-2 text-sm">
          <ul className="space-y-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800 dark:border-rose-500/35 dark:bg-rose-500/10 dark:text-rose-300">
            {points.map((point, index) => (
              <li key={index} className="flex gap-2">
                <span aria-hidden>•</span>
                <span>{point}</span>
              </li>
            ))}
            <li className="flex gap-2 font-semibold">
              <span aria-hidden>•</span>
              {undoDays
                ? `You can undo this from the Recycle bin for ${undoDays} days.`
                : "This cannot be undone."}
            </li>
          </ul>
          {hint ? <p className="text-[12.5px] text-ink-500">{hint}</p> : null}
        </div>

        {error ? (
          <p className="mx-6 mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 px-6 pb-6 pt-4 sm:flex-row">
          <button
            type="button"
            className="btn-secondary flex-1"
            onClick={onCancel}
            disabled={working}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn-danger flex-1 whitespace-nowrap"
            onClick={onConfirm}
            disabled={working}
          >
            <Trash2 className="h-4 w-4" />
            {working ? workingLabel : confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
