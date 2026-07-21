import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import clsx from "clsx";

export type FieldPickerOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
};

type Props = {
  options: FieldPickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
};

export function FieldPicker({
  options,
  value,
  onChange,
  placeholder = "Select",
  required,
  disabled,
  searchable = false,
  searchPlaceholder = "Search…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selectedLabel =
    options.find((option) => option.value === value)?.label || placeholder;
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      `${option.label} ${option.description || ""}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [close]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  useEffect(() => {
    if (open && searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, searchable]);

  return (
    <div ref={rootRef} className="relative">
      <select
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        required={required}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {open && searchable && !disabled ? (
        <div className="field flex min-h-[48px] items-center gap-3 border-tide-500 ring-4 ring-tide-400/20">
          <input
            ref={searchRef}
            className="min-w-0 flex-1 bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-300 sm:text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
          />
          <button
            type="button"
            className="shrink-0 text-ink-500"
            onClick={close}
            aria-label="Close dropdown"
          >
            <ChevronDown className="h-5 w-5 rotate-180" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          className={clsx(
            "field flex min-h-[48px] items-center justify-between gap-3 text-left text-base sm:text-sm",
            open && "border-tide-500 ring-4 ring-tide-400/20",
            !value && "text-ink-300",
            disabled && "cursor-not-allowed opacity-55",
          )}
          aria-haspopup={searchable ? "listbox" : undefined}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            if (!disabled) setOpen((prev) => !prev);
          }}
        >
          <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
          <ChevronDown
            className={clsx(
              "h-5 w-5 shrink-0 text-ink-500 transition",
              open && "rotate-180",
            )}
          />
        </button>
      )}

      {open && !disabled ? (
        <div
          id={listId}
          role="listbox"
          className="mt-2 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-lift"
        >
          <div className="max-h-56 overflow-y-auto overscroll-contain p-1.5 sm:max-h-64">
            <PickerOption
              active={!value}
              label={placeholder}
              muted
              onSelect={() => {
                onChange("");
                close();
              }}
            />
            {filteredOptions.map((option) => (
              <PickerOption
                key={option.value}
                active={value === option.value}
                label={option.label}
                description={option.description}
                icon={option.icon}
                onSelect={() => {
                  onChange(option.value);
                  close();
                }}
              />
            ))}
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-ink-400">
                No matching option found
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PickerOption({
  label,
  description,
  active,
  muted,
  icon,
  onSelect,
}: {
  label: string;
  description?: string;
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
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description ? (
          <span
            className={clsx(
              "mt-0.5 block text-xs leading-5",
              active ? "text-white/75" : "text-ink-400",
            )}
          >
            {description}
          </span>
        ) : null}
      </span>
      {active ? <Check className="h-4 w-4 shrink-0" /> : null}
    </button>
  );
}
