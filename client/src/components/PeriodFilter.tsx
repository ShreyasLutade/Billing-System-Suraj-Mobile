import clsx from "clsx";
import { format } from "date-fns";
import type { ReactNode } from "react";

export const ACTIVITY_PERIOD_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

/** Compact labels so All + Custom fit one row without scroll. */
const ACTIVITY_PERIOD_SHORT = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yday" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

export const DUE_PERIOD_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "yesterday", label: "Yesterday" },
  { value: "past_due", label: "Past due" },
  { value: "future_due", label: "Future due" },
] as const;

export type ActivityPeriodValue =
  (typeof ACTIVITY_PERIOD_OPTIONS)[number]["value"];
export type DuePeriodValue = (typeof DUE_PERIOD_OPTIONS)[number]["value"];
export type AnalyticsPeriodValue = ActivityPeriodValue | "custom";

function todayInputValue() {
  return format(new Date(), "yyyy-MM-dd");
}

type PeriodFilterProps =
  | {
      variant?: "activity";
      value: ActivityPeriodValue;
      onChange: (value: ActivityPeriodValue) => void;
      allowCustom?: false;
    }
  | {
      variant?: "activity";
      value: AnalyticsPeriodValue;
      onChange: (value: AnalyticsPeriodValue) => void;
      allowCustom: true;
      customFrom: string;
      customTo: string;
      onCustomFromChange: (value: string) => void;
      onCustomToChange: (value: string) => void;
    }
  | {
      variant: "dues";
      value: DuePeriodValue;
      onChange: (value: DuePeriodValue) => void;
    };

export function PeriodFilter(props: PeriodFilterProps) {
  if (props.variant === "dues") {
    return (
      <PeriodChipRow
        options={DUE_PERIOD_OPTIONS}
        value={props.value}
        onChange={props.onChange}
      />
    );
  }

  if (props.allowCustom) {
    return (
      <div className="w-full max-w-xl">
        <PeriodChipRow
          compact
          options={ACTIVITY_PERIOD_SHORT}
          value={props.value === "custom" ? null : props.value}
          onChange={(value) => props.onChange(value)}
          trailing={
            <button
              type="button"
              role="tab"
              aria-selected={props.value === "custom"}
              title="Custom date range"
              className={clsx(
                "min-w-0 flex-1 rounded-lg px-1.5 py-2 text-center text-[11px] font-semibold transition sm:rounded-xl sm:px-2 sm:text-xs",
                props.value === "custom"
                  ? "bg-[#3B82F6] text-white shadow-[0_0_0_3px_#E8F0FE] dark:shadow-[0_0_0_3px_rgba(59,130,246,0.28)]"
                  : "bg-[#E8F0FE] text-[#2563EB] hover:bg-[#DBEAFE] dark:bg-[#3B82F6]/20 dark:text-[#93C5FD] dark:hover:bg-[#3B82F6]/30",
              )}
              onClick={() => {
                props.onChange("custom");
                if (!props.customFrom && !props.customTo) {
                  const today = todayInputValue();
                  props.onCustomFromChange(today);
                  props.onCustomToChange(today);
                }
              }}
            >
              Custom
            </button>
          }
        />
        {props.value === "custom" ? (
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-[#BFDBFE] bg-[#F0F7FF] p-3 dark:border-[#3B82F6]/35 dark:bg-[#3B82F6]/10">
            <div>
              <label
                htmlFor="analytics-custom-from"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#2563EB] dark:text-[#93C5FD]"
              >
                From
              </label>
              <input
                id="analytics-custom-from"
                type="date"
                className="w-full rounded-lg border border-[#BFDBFE] bg-white px-2 py-2 text-[13px] text-ink-900 outline-none focus:border-[#3B82F6] focus:shadow-[0_0_0_3px_#E8F0FE] dark:border-[#3B82F6]/35 dark:bg-surface-elevated dark:text-ink-900 dark:[color-scheme:dark] dark:focus:border-[#60A5FA] dark:focus:shadow-[0_0_0_3px_rgba(59,130,246,0.25)]"
                value={props.customFrom}
                max={props.customTo || undefined}
                onChange={(e) => props.onCustomFromChange(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="analytics-custom-to"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#2563EB] dark:text-[#93C5FD]"
              >
                To
              </label>
              <input
                id="analytics-custom-to"
                type="date"
                className="w-full rounded-lg border border-[#BFDBFE] bg-white px-2 py-2 text-[13px] text-ink-900 outline-none focus:border-[#3B82F6] focus:shadow-[0_0_0_3px_#E8F0FE] dark:border-[#3B82F6]/35 dark:bg-surface-elevated dark:text-ink-900 dark:[color-scheme:dark] dark:focus:border-[#60A5FA] dark:focus:shadow-[0_0_0_3px_rgba(59,130,246,0.25)]"
                value={props.customTo}
                min={props.customFrom || undefined}
                onChange={(e) => props.onCustomToChange(e.target.value)}
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <PeriodChipRow
      options={ACTIVITY_PERIOD_OPTIONS}
      value={props.value}
      onChange={props.onChange}
    />
  );
}

function PeriodChipRow<T extends string>({
  options,
  value,
  onChange,
  trailing,
  compact = false,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
  trailing?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex rounded-2xl border border-ink-100/80 bg-white/70 p-1 dark:border-ink-100 dark:bg-surface-elevated/80",
        compact ? "w-full gap-0.5" : "gap-1 overflow-x-auto",
      )}
      role="tablist"
      aria-label="Date filter"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          title={
            option.value === "yesterday"
              ? "Yesterday"
              : option.value === "all"
                ? "All time"
                : option.label
          }
          className={clsx(
            "font-semibold transition",
            compact
              ? "min-w-0 flex-1 rounded-lg px-1.5 py-2 text-center text-[11px] sm:rounded-xl sm:px-2 sm:text-xs"
              : "shrink-0 rounded-xl px-3 py-2 text-xs sm:px-4 sm:text-sm",
            value === option.value
              ? "segment-on"
              : "segment-off",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}
