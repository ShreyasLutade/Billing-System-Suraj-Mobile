import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import clsx from "clsx";
import { subscribeOutsideDismiss } from "../lib/floatingMenu";
import type { FinanceCompany } from "../types";

export const ADD_NEW_FINANCE = "__add_new__";

type Props = {
  companies: FinanceCompany[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  excludeIds?: string[];
};

export function FinanceCompanyPicker({
  companies,
  value,
  onChange,
  required,
  excludeIds = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const visibleCompanies = companies.filter(
    (company) => !excludeIds.includes(company.id) || company.id === value,
  );

  const selectedLabel =
    value === ADD_NEW_FINANCE
      ? "+ Add new"
      : companies.find((company) => company.id === value)?.name ||
        "Select finance company";

  useEffect(() => {
    if (!open) return;
    return subscribeOutsideDismiss(
      (target) => Boolean(rootRef.current?.contains(target as Node | null)),
      () => setOpen(false),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <select
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select finance company</option>
        {visibleCompanies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
        <option value={ADD_NEW_FINANCE}>+ Add new</option>
      </select>

      <button
        type="button"
        className={clsx(
          "flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[13px] border-[1.5px] border-ink-100 bg-white px-3 py-2.5 text-left text-base transition sm:text-[14.5px]",
          open &&
            "border-[#12B886] shadow-[0_0_0_4px_rgba(18,184,134,.14)]",
          !value && "text-[#9AA6B6]",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <ChevronDown
          className={clsx(
            "h-[18px] w-[18px] shrink-0 text-ink-500 transition",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="mt-2 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-[0_10px_24px_rgba(16,25,40,.10),0_30px_70px_-20px_rgba(16,25,40,.28)]"
        >
          <div className="max-h-56 overflow-y-auto overscroll-contain p-1.5 sm:max-h-64">
            <PickerOption
              active={!value}
              label="Select finance company"
              muted
              onSelect={() => {
                onChange("");
                setOpen(false);
              }}
            />
            {visibleCompanies.map((company) => (
              <PickerOption
                key={company.id}
                active={value === company.id}
                label={company.name}
                onSelect={() => {
                  onChange(company.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="border-t border-ink-100 p-2">
            <button
              type="button"
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-semibold transition",
                value === ADD_NEW_FINANCE
                  ? "bg-[#E7F8F1] text-[#0E9E76]"
                  : "text-[#0E9E76] hover:bg-[#E7F8F1]",
              )}
              onClick={() => {
                onChange(ADD_NEW_FINANCE);
                setOpen(false);
              }}
            >
              <Plus className="h-[17px] w-[17px]" strokeWidth={2.2} />
              Add new finance company
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PickerOption({
  label,
  active,
  muted,
  icon,
  onSelect,
}: {
  label: string;
  active?: boolean;
  muted?: boolean;
  icon?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={Boolean(active)}
      className={clsx(
        "flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2.5 text-left transition",
        active
          ? "bg-[#E7F8F1]"
          : "hover:bg-[#F4F7FA] active:bg-[#F4F7FA]",
        muted && !active && "text-ink-300",
      )}
      onClick={onSelect}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span
        className={clsx(
          "min-w-0 flex-1 truncate text-sm font-semibold",
          muted && !active ? "text-ink-300" : "text-ink-900",
        )}
      >
        {label}
      </span>
      <Check
        className={clsx(
          "h-[18px] w-[18px] shrink-0 text-[#0E9E76] transition",
          active ? "opacity-100" : "opacity-0",
        )}
        strokeWidth={2.6}
      />
    </button>
  );
}
