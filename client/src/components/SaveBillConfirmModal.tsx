import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { formatINR } from "../lib/api";

export type SaveBillSummary = {
  customerName: string;
  customerPhone: string;
  itemCount: number;
  payableAmount: number;
  payCustomerAmount?: number;
  cashAmount: number;
  onlineAmount: number;
  financeAmount: number;
  financeCompanyName?: string | null;
  dueAmount: number;
  dueDate?: string | null;
  isExchange: boolean;
  exchangeValue?: number | null;
  companyDiscount?: number;
};

export function SaveBillConfirmModal({
  summary,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  summary: SaveBillSummary;
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const payments: string[] = [];
  if (summary.cashAmount > 0) payments.push(`Cash ${formatINR(summary.cashAmount)}`);
  if (summary.onlineAmount > 0)
    payments.push(`Online ${formatINR(summary.onlineAmount)}`);
  if (summary.financeAmount > 0) {
    payments.push(
      `Finance ${formatINR(summary.financeAmount)}${
        summary.financeCompanyName ? ` · ${summary.financeCompanyName}` : ""
      }`,
    );
  }

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
          aria-labelledby="save-bill-title"
          className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
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
                id="save-bill-title"
                className="mt-1 font-display text-xl font-semibold text-ink-900"
              >
                Save this bill?
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

          <div className="space-y-3 px-5 py-4 text-sm">
            <Row label="Customer" value={summary.customerName} />
            <Row label="Phone" value={summary.customerPhone} />
            <Row
              label="Items"
              value={`${summary.itemCount} product${summary.itemCount === 1 ? "" : "s"}`}
            />
            <Row
              label={
                summary.payCustomerAmount && summary.payCustomerAmount > 0
                  ? "Pay customer"
                  : "Payable"
              }
              value={formatINR(
                summary.payCustomerAmount && summary.payCustomerAmount > 0
                  ? summary.payCustomerAmount
                  : summary.payableAmount,
              )}
              strong
              accent={Boolean(
                summary.payCustomerAmount && summary.payCustomerAmount > 0,
              )}
            />
            {summary.payCustomerAmount && summary.payCustomerAmount > 0 ? (
              <Row label="Paid" value="Shop pays customer" />
            ) : payments.length > 0 ? (
              <Row label="Paid" value={payments.join(" · ")} />
            ) : (
              <Row label="Paid" value="Nothing paid yet" />
            )}
            {summary.isExchange && summary.exchangeValue != null ? (
              <Row
                label="Exchange"
                value={`− ${formatINR(summary.exchangeValue)}`}
              />
            ) : null}
            {summary.companyDiscount && summary.companyDiscount > 0 ? (
              <Row
                label="Company cashback"
                value={`+ ${formatINR(summary.companyDiscount)}`}
              />
            ) : null}
            {summary.payCustomerAmount && summary.payCustomerAmount > 0 ? (
              <Row label="Due" value="None" />
            ) : summary.dueAmount > 0 ? (
              <Row
                label="Due"
                value={`${formatINR(summary.dueAmount)}${
                  summary.dueDate ? ` · by ${summary.dueDate}` : ""
                }`}
                accent
              />
            ) : (
              <Row label="Due" value="Fully paid" />
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
              disabled={saving}
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

function Row({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-ink-500">{label}</span>
      <span
        className={
          strong
            ? "text-right font-display font-semibold text-ink-900"
            : accent
              ? "text-right font-semibold text-ember-500"
              : "text-right font-medium text-ink-800"
        }
      >
        {value}
      </span>
    </div>
  );
}
