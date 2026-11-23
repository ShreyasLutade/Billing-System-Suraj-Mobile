import clsx from "clsx";
import { Check, Clock } from "lucide-react";
import {
  EXCHANGE_ACCESSORIES,
  joinAccessoryLabels,
  pendingAccessories,
} from "../lib/exchangeAccessories";
import type { ExchangeAccessory, ExchangeAccessoryKey } from "../types";

type Props = {
  value: ExchangeAccessory[];
  onChange: (next: ExchangeAccessory[]) => void;
};

/**
 * Tap a tile to mark it as came-with-phone (defaults to Given — the common case),
 * then flip to Pending when the customer will bring it later.
 */
export function ExchangeAccessoriesPicker({ value, onChange }: Props) {
  const byKey = new Map(value.map((a) => [a.key, a]));
  const pending = pendingAccessories(value);

  function toggle(key: ExchangeAccessoryKey) {
    if (byKey.has(key)) {
      onChange(value.filter((a) => a.key !== key));
      return;
    }
    // Keep the fixed display order so saved JSON reads consistently.
    const next = [...value, { key, status: "GIVEN" as const }];
    const order = EXCHANGE_ACCESSORIES.map((a) => a.key);
    next.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    onChange(next);
  }

  function setStatus(key: ExchangeAccessoryKey, status: ExchangeAccessory["status"]) {
    onChange(
      value.map((a) =>
        a.key === key
          ? {
              ...a,
              status,
              receivedAt: status === "PENDING" ? null : a.receivedAt ?? null,
            }
          : a,
      ),
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label mb-0">Came with the phone</span>
        {pending.length ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <Clock className="h-3 w-3" strokeWidth={2.4} />
            {pending.length} pending
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {EXCHANGE_ACCESSORIES.map(({ key, label, icon: Icon }) => {
          const selected = byKey.get(key);
          const isPending = selected?.status === "PENDING";
          return (
            <div
              key={key}
              className={clsx(
                "overflow-hidden rounded-xl border transition",
                !selected &&
                  "border-ink-100 bg-white hover:border-ink-200 dark:bg-transparent",
                selected &&
                  !isPending &&
                  "border-emerald-300 bg-emerald-50/70 dark:border-emerald-500/40 dark:bg-emerald-500/10",
                isPending &&
                  "border-amber-300 bg-amber-50/80 dark:border-amber-500/45 dark:bg-amber-500/10",
              )}
            >
              <button
                type="button"
                aria-pressed={Boolean(selected)}
                onClick={() => toggle(key)}
                className="flex w-full items-center gap-2 px-3 pb-2 pt-2.5 text-left"
              >
                <Icon
                  className={clsx(
                    "h-4 w-4 shrink-0",
                    !selected && "text-ink-400",
                    selected && !isPending && "text-emerald-600 dark:text-emerald-400",
                    isPending && "text-amber-600 dark:text-amber-400",
                  )}
                  strokeWidth={2.1}
                />
                <span
                  className={clsx(
                    "min-w-0 flex-1 truncate text-sm font-semibold",
                    selected ? "text-ink-900" : "text-ink-500",
                  )}
                >
                  {label}
                </span>
                <span
                  className={clsx(
                    "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition",
                    !selected && "border-ink-200 bg-white dark:bg-transparent",
                    selected &&
                      !isPending &&
                      "border-emerald-500 bg-emerald-500 text-white",
                    isPending && "border-amber-500 bg-amber-500 text-white",
                  )}
                >
                  {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                </span>
              </button>

              {selected ? (
                <div className="grid grid-cols-2 gap-1 px-1.5 pb-1.5">
                  {(["GIVEN", "PENDING"] as const).map((status) => {
                    const active = selected.status === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setStatus(key, status)}
                        className={clsx(
                          "rounded-lg py-1.5 text-[11.5px] font-semibold transition",
                          active && status === "GIVEN" &&
                            "bg-emerald-600 text-white shadow-sm",
                          active && status === "PENDING" &&
                            "bg-amber-500 text-white shadow-sm",
                          !active &&
                            "text-ink-500 hover:bg-white/80 hover:text-ink-800 dark:hover:bg-white/5",
                        )}
                      >
                        {status === "GIVEN" ? "Given" : "Pending"}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="px-3 pb-2.5 text-[11.5px] text-ink-300">
                  Not included
                </p>
              )}
            </div>
          );
        })}
      </div>

      {pending.length ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          <span>
            Customer will bring the{" "}
            <b className="font-semibold">
              {joinAccessoryLabels(pending.map((a) => a.key))}
            </b>{" "}
            later. You'll see this under Analytics → Pending items.
          </span>
        </p>
      ) : null}
    </div>
  );
}
