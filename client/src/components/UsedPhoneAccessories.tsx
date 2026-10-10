import clsx from "clsx";
import { format } from "date-fns";
import { Check, Info } from "lucide-react";
import {
  EXCHANGE_ACCESSORIES,
  accessoryLabel,
  parseIncludedAccessories,
  serializeIncludedAccessories,
} from "../lib/exchangeAccessories";
import type { ExchangeAccessoryKey, ExchangeIntake } from "../types";

/** One line: what the shop got with this phone when it was taken on exchange. */
export function ReceivedWithPhoneNote({ intake }: { intake: ExchangeIntake }) {
  const date = new Date(intake.billDate);
  const source = [
    intake.customerName,
    intake.invoiceNumber,
    Number.isNaN(date.getTime()) ? "" : format(date, "dd MMM yyyy"),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className="flex items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50/80 px-2.5 py-1.5 text-[12px] text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"
      title={`From exchange: ${source}`}
    >
      <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
      <span className="shrink-0 font-semibold">
        {intake.accessories.length ? "Received:" : "Nothing received with this phone"}
      </span>
      {intake.accessories.length ? (
        <span className="min-w-0 truncate">
          {intake.accessories.map((acc, index) => (
            <span key={acc.key}>
              {index > 0 ? <span className="text-sky-400"> · </span> : null}
              <span
                className={
                  acc.status === "PENDING"
                    ? "font-medium text-amber-700 dark:text-amber-300"
                    : undefined
                }
              >
                {accessoryLabel(acc.key)}
                {acc.status === "PENDING" ? " (pending)" : ""}
              </span>
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

type PickerProps = {
  /** "BOX,CHARGER" */
  value?: string | null;
  onChange: (next: string | null) => void;
  /** Items actually in hand from the exchange — offered as a one-tap fill. */
  receivedKeys?: ExchangeAccessoryKey[];
};

/** Tick what goes to the buyer with this second-hand phone; printed on the bill PDF. */
export function GivenWithPhonePicker({ value, onChange, receivedKeys }: PickerProps) {
  const selected = parseIncludedAccessories(value);
  const canCopy =
    Boolean(receivedKeys?.length) &&
    serializeIncludedAccessories(receivedKeys!) !==
      serializeIncludedAccessories(selected);

  function toggle(key: ExchangeAccessoryKey) {
    onChange(
      serializeIncludedAccessories(
        selected.includes(key)
          ? selected.filter((k) => k !== key)
          : [...selected, key],
      ),
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label mb-0">Given with this phone</span>
        {canCopy ? (
          <button
            type="button"
            className="text-[11.5px] font-semibold text-tide-600 hover:underline"
            onClick={() => onChange(serializeIncludedAccessories(receivedKeys!))}
          >
            Same as received
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {EXCHANGE_ACCESSORIES.map(({ key, label, icon: Icon }) => {
          const on = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(key)}
              className={clsx(
                "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition",
                on
                  ? "border-emerald-300 bg-emerald-50/70 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                  : "border-ink-100 bg-white hover:border-ink-200 dark:bg-transparent",
              )}
            >
              <Icon
                className={clsx(
                  "h-4 w-4 shrink-0",
                  on ? "text-emerald-600 dark:text-emerald-400" : "text-ink-400",
                )}
                strokeWidth={2.1}
              />
              <span
                className={clsx(
                  "min-w-0 flex-1 truncate text-sm font-semibold",
                  on ? "text-ink-900" : "text-ink-500",
                )}
              >
                {label}
              </span>
              <span
                className={clsx(
                  "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition",
                  on
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-ink-200 bg-white dark:bg-transparent",
                )}
              >
                {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
