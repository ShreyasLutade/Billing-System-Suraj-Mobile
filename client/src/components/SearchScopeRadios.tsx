import type { BillSearchScope } from "../lib/billSearch";

const OPTIONS: Array<{ value: Exclude<BillSearchScope, "all">; label: string }> =
  [
    { value: "name", label: "Name" },
    { value: "phone", label: "Number" },
    { value: "imei", label: "IMEI" },
    { value: "product", label: "Product" },
  ];

type Props = {
  value: BillSearchScope;
  onChange: (value: BillSearchScope) => void;
  /** Kept for call-site compatibility; unused (toggle buttons, not native radios). */
  name?: string;
};

/** Radios below search. None selected = search all. Click selected again to clear. */
export function SearchScopeRadios({ value, onChange }: Props) {
  return (
    <div
      className="flex flex-wrap gap-x-4 gap-y-2 px-1"
      role="radiogroup"
      aria-label="Search by field"
    >
      {OPTIONS.map((option) => {
        const checked = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            className="flex cursor-pointer items-center gap-2 text-sm text-ink-600"
            onClick={() => onChange(checked ? "all" : option.value)}
          >
            <span
              className={
                checked
                  ? "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[5px] border-tide-600 bg-white"
                  : "flex h-4 w-4 shrink-0 rounded-full border border-ink-300 bg-white"
              }
              aria-hidden
            />
            <span className={checked ? "font-semibold text-ink-900" : undefined}>
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
