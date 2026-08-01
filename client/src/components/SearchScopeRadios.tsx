import type { BillSearchScope } from "../lib/billSearch";

const OPTIONS: Array<{ value: Exclude<BillSearchScope, "all">; label: string }> =
  [
    { value: "name", label: "Name" },
    { value: "phone", label: "Phone" },
    { value: "imei", label: "IMEI" },
    { value: "product", label: "Product" },
  ];

type Props = {
  value: BillSearchScope;
  onChange: (value: BillSearchScope) => void;
  /** Unique radio group name when multiple search bars exist */
  name?: string;
};

/** Radios below search. None selected = search all fields. Click again to clear. */
export function SearchScopeRadios({
  value,
  onChange,
  name = "search-scope",
}: Props) {
  return (
    <div
      className="flex flex-wrap gap-x-4 gap-y-2 px-1"
      role="radiogroup"
      aria-label="Search by field"
    >
      {OPTIONS.map((option) => {
        const checked = value === option.value;
        return (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 text-sm text-ink-600"
          >
            <input
              type="radio"
              name={name}
              className="h-4 w-4 border-ink-300 text-tide-600 focus:ring-tide-500"
              checked={checked}
              onChange={() => onChange(option.value)}
              onClick={(e) => {
                // Allow deselecting so default "search all" returns
                if (checked) {
                  e.preventDefault();
                  onChange("all");
                }
              }}
            />
            <span className={checked ? "font-semibold text-ink-900" : undefined}>
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
