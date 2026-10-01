import clsx from "clsx";
import { Wallet } from "lucide-react";
import { formatINR } from "../lib/api";

export type PaymentMode = "FULL" | "UNPAID" | "CUSTOM";

/** What was paid to the supplier while entering a purchase. */
export type PaymentDraft = { mode: PaymentMode; amount: string };

export const blankPayment = (): PaymentDraft => ({ mode: "UNPAID", amount: "" });

const MODES: Array<{ value: PaymentMode; label: string }> = [
  { value: "FULL", label: "Fully paid" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "CUSTOM", label: "Custom paid" },
];

const toPaise = (value: number) => Math.round((value || 0) * 100);

/** Amount paid now for a purchase of `total`. */
export function paidNow(payment: PaymentDraft, total: number) {
  if (payment.mode === "FULL") return total;
  if (payment.mode === "UNPAID") return 0;
  const amount = Number(payment.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** Error to show before saving, or null when the payment is fine. */
export function paymentDraftError(payment: PaymentDraft, total: number) {
  if (payment.mode !== "CUSTOM") return null;
  const amount = Number(payment.amount);
  if (!payment.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
    return "Enter the amount paid to the supplier";
  }
  if (toPaise(amount) > toPaise(total)) {
    return `Paid amount is more than the ${formatINR(total)} purchase total`;
  }
  return null;
}

/** Request body for the API (custom paid in full is sent as fully paid). */
export function paymentPayload(payment: PaymentDraft, total: number) {
  if (payment.mode !== "CUSTOM") return { mode: payment.mode };
  const amount = Number(payment.amount);
  return toPaise(amount) >= toPaise(total)
    ? { mode: "FULL" as const }
    : { mode: "CUSTOM" as const, amount };
}

export function PaymentAtPurchaseField({
  value,
  total,
  disabled,
  onChange,
  idPrefix = "purchase-payment",
}: {
  value: PaymentDraft;
  total: number;
  disabled?: boolean;
  onChange: (next: PaymentDraft) => void;
  idPrefix?: string;
}) {
  const paid = Math.min(paidNow(value, total), total);
  const outstanding = Math.max(total - paid, 0);
  const tooMuch =
    value.mode === "CUSTOM" && toPaise(Number(value.amount) || 0) > toPaise(total);

  return (
    <div className="space-y-2">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        <Wallet className="h-3 w-3" />
        Payment
      </span>
      <div
        role="radiogroup"
        aria-label="Payment to supplier"
        className="grid grid-cols-3 gap-0.5 rounded-[10px] bg-[#EBEDF1] p-0.5 dark:bg-surface-muted"
      >
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={value.mode === mode.value}
            className={clsx(
              "whitespace-nowrap rounded-lg px-1 py-1.5 text-[12px] transition",
              value.mode === mode.value ? "segment-on" : "segment-off",
            )}
            onClick={() => onChange({ ...value, mode: mode.value })}
            disabled={disabled}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {value.mode === "CUSTOM" ? (
        <input
          id={`${idPrefix}-amount`}
          aria-label="Amount paid now"
          className="field"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          placeholder={total > 0 ? `Amount paid (up to ${formatINR(total)})` : "Amount paid"}
          disabled={disabled}
          autoFocus
        />
      ) : null}

      <div className="flex items-center justify-between gap-3 px-0.5 text-[12px]">
        <span className="text-ink-500">
          Paid{" "}
          <b className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatINR(paid)}
          </b>
        </span>
        <span className="text-ink-500">
          Due{" "}
          <b
            className={clsx(
              "font-semibold tabular-nums",
              outstanding > 0 ? "text-rose-600 dark:text-rose-400" : "text-ink-900",
            )}
          >
            {formatINR(outstanding)}
          </b>
        </span>
      </div>
      {tooMuch ? (
        <p className="px-0.5 text-[12px] text-rose-600 dark:text-rose-400">
          More than the {formatINR(total)} total
        </p>
      ) : null}
    </div>
  );
}
