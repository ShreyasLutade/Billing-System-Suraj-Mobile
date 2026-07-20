import clsx from "clsx";

export const ACTIVITY_PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All time" },
] as const;

export const DUE_PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "yesterday", label: "Yesterday" },
  { value: "past_due", label: "Past due" },
  { value: "future_due", label: "Future due" },
  { value: "all", label: "All time" },
] as const;

export type ActivityPeriodValue =
  (typeof ACTIVITY_PERIOD_OPTIONS)[number]["value"];
export type DuePeriodValue = (typeof DUE_PERIOD_OPTIONS)[number]["value"];

type PeriodFilterProps =
  | {
      variant?: "activity";
      value: ActivityPeriodValue;
      onChange: (value: ActivityPeriodValue) => void;
    }
  | {
      variant: "dues";
      value: DuePeriodValue;
      onChange: (value: DuePeriodValue) => void;
    };

export function PeriodFilter(props: PeriodFilterProps) {
  const options =
    props.variant === "dues" ? DUE_PERIOD_OPTIONS : ACTIVITY_PERIOD_OPTIONS;

  return (
    <div
      className="flex gap-1 overflow-x-auto rounded-2xl border border-ink-100/80 bg-white/70 p-1"
      role="tablist"
      aria-label="Date filter"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={props.value === option.value}
          className={clsx(
            "shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition sm:px-4 sm:text-sm",
            props.value === option.value
              ? "bg-ink-900 text-white shadow-soft"
              : "text-ink-500 hover:bg-ink-50 hover:text-ink-900",
          )}
          onClick={() => {
            if (props.variant === "dues") {
              props.onChange(option.value as DuePeriodValue);
            } else {
              props.onChange(option.value as ActivityPeriodValue);
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
