import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Plus } from "lucide-react";
import clsx from "clsx";
import type { FinanceCompany } from "../types";

export const ADD_NEW_FINANCE = "__add_new__";

type Props = {
  companies: FinanceCompany[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
};

export function FinanceCompanyPicker({
  companies,
  value,
  onChange,
  required,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedLabel =
    value === ADD_NEW_FINANCE
      ? "+ Add new"
      : companies.find((company) => company.id === value)?.name ||
        "Select finance company";

  useEffect(() => {
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, []);

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
      {/* Keep a real select for form validation / accessibility fallback */}
      <select
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select finance company</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
        <option value={ADD_NEW_FINANCE}>+ Add new</option>
      </select>

      <button
        type="button"
        className={clsx(
          "field flex min-h-[48px] items-center justify-between gap-3 text-left text-base sm:text-sm",
          open && "border-tide-500 ring-4 ring-tide-400/20",
          !value && "text-ink-300",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <ChevronDown
          className={clsx(
            "h-5 w-5 shrink-0 text-ink-500 transition",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={listId}
            role="listbox"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="mt-2 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-lift"
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
              {companies.map((company) => (
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
              <div className="my-1 border-t border-ink-50" />
              <PickerOption
                active={value === ADD_NEW_FINANCE}
                label="Add new"
                icon={<Plus className="h-4 w-4" />}
                onSelect={() => {
                  onChange(ADD_NEW_FINANCE);
                  setOpen(false);
                }}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
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
        "flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-base transition sm:text-sm",
        active
          ? "bg-ink-900 text-white"
          : "text-ink-800 active:bg-ink-50 hover:bg-ink-50",
        muted && !active && "text-ink-300",
      )}
      onClick={onSelect}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active ? <Check className="h-4 w-4 shrink-0" /> : null}
    </button>
  );
}
