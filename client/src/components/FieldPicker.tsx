import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import clsx from "clsx";
import {
  compactSearchText,
  matchesElasticFields,
  matchesElasticSearch,
  normalizeSearchText,
} from "../lib/elasticSearch";
import { subscribeOutsideDismiss } from "../lib/floatingMenu";
import { useTheme } from "../theme/ThemeContext";

export type FieldPickerAvatar = {
  letter: string;
  bg: string;
  fg: string;
};

export type FieldPickerOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  badge?: string;
  badgeTone?: "new" | "old";
  /** Right-column meta (e.g. ₹ price) */
  meta?: string;
  avatar?: FieldPickerAvatar;
  /** Used by in-dropdown New/Old filters */
  condition?: "NEW" | "USED";
};

type ConditionFilter = "ALL" | "NEW" | "USED";

type Props = {
  options: FieldPickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Show All / New / Old segment filters inside the open dropdown */
  conditionFilters?: boolean;
  autoFocus?: boolean;
  /** Footer action under the list (e.g. Add to stock) */
  footerAction?: {
    label: string;
    onClick: () => void;
  };
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
  conditionFilters = false,
  autoFocus = false,
  footerAction,
}: Props) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [conditionFilter, setConditionFilter] =
    useState<ConditionFilter>("ALL");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected
    ? [
        selected.label,
        selected.description?.replace(/^IMEI\s+/i, ""),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const conditionCounts = useMemo(() => {
    let all = 0;
    let neu = 0;
    let old = 0;
    for (const option of options) {
      if (!option.condition) continue;
      all += 1;
      if (option.condition === "NEW") neu += 1;
      if (option.condition === "USED") old += 1;
    }
    return { all, neu, old };
  }, [options]);

  const filteredOptions = useMemo(() => {
    return options.filter((option) => {
      if (
        conditionFilter !== "ALL" &&
        option.condition &&
        option.condition !== conditionFilter
      ) {
        return false;
      }
      if (!query.trim()) return true;
      return matchesElasticFields(
        [option.label, option.description, option.badge, option.meta],
        query,
      );
    });
  }, [options, query, conditionFilter]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setQuery("");
    setOpen(true);
  }, [disabled]);

  const focusSearchInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = searchRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    return subscribeOutsideDismiss((target) => {
      const node = target as Node | null;
      if (rootRef.current?.contains(node)) return true;
      if (menuRef.current?.contains(node)) return true;
      return false;
    }, close);
  }, [open, close]);

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
      focusSearchInput();
    }
  }, [open, searchable, focusSearchInput]);

  const menu =
    open && !disabled ? (
      <div
        ref={menuRef}
        id={listId}
        role="listbox"
        className="absolute left-0 right-0 top-full z-30 mt-1.5 min-w-0 w-full overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-[0_10px_24px_rgba(16,25,40,.10),0_30px_70px_-20px_rgba(16,25,40,.28)] dark:border-ink-100 dark:bg-surface-elevated dark:shadow-lift"
      >
            {conditionFilters ? (
              <div className="flex items-center gap-1.5 border-b border-ink-100 px-3.5 py-3">
                <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
                  Show
                </span>
                <div
                  className="inline-flex gap-0.5 rounded-[9px] bg-[#EEF0F3] p-0.5 dark:bg-surface-muted"
                  role="radiogroup"
                  aria-label="Filter by condition"
                >
                  {(
                    [
                      {
                        value: "ALL" as const,
                        label: "All",
                        count: conditionCounts.all,
                      },
                      {
                        value: "NEW" as const,
                        label: "New",
                        count: conditionCounts.neu,
                      },
                      {
                        value: "USED" as const,
                        label: "Old",
                        count: conditionCounts.old,
                      },
                    ] as const
                  ).map((option) => {
                    const on = conditionFilter === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={clsx(
                          "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] transition",
                          on ? "segment-on" : "segment-off",
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          setConditionFilter(option.value);
                        }}
                      >
                        {option.label}
                        <span className="text-[10.5px] font-bold opacity-70">
                          {option.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <span className="ml-auto text-[11.5px] text-ink-500">
                  {filteredOptions.filter((o) => o.condition).length} shown
                </span>
              </div>
            ) : null}

            <div className="max-h-[min(320px,45dvh)] min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain p-1.5">
              {filteredOptions.length === 0 ? (
                <div className="px-3.5 py-7 text-center text-[13.5px] text-ink-500">
                  {query.trim() ? (
                    <>
                      No matches for{" "}
                      <b className="text-ink-900">“{query.trim()}”</b>.
                      <br />
                      Try a different search
                      {footerAction ? " or add it below" : ""}.
                    </>
                  ) : (
                    "No options available"
                  )}
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <PickerOption
                    key={option.value}
                    active={value === option.value}
                    label={option.label}
                    description={option.description}
                    icon={option.icon}
                    badge={option.badge}
                    badgeTone={option.badgeTone}
                    meta={option.meta}
                    avatar={option.avatar}
                    query={query}
                    dark={dark}
                    onSelect={() => {
                      onChange(option.value);
                      close();
                    }}
                  />
                ))
              )}
            </div>

            {footerAction ? (
              <div className="border-t border-ink-100 p-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-semibold text-[#0E9E76] transition hover:bg-[#E7F8F1] dark:text-tide-400 dark:hover:bg-tide-100/40"
                  onClick={() => {
                    close();
                    footerAction.onClick();
                  }}
                >
                  <Plus className="h-[17px] w-[17px]" strokeWidth={2.2} />
                  {footerAction.label}
                </button>
              </div>
            ) : null}
          </div>
    ) : null;

  const showClear = Boolean(value) || (open && Boolean(query));

  return (
    <div ref={rootRef} className={clsx("relative min-w-0 w-full", open && "z-50")}>
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

      {searchable ? (
        <div
          className={clsx(
            "flex min-h-[48px] min-w-0 items-center gap-2.5 overflow-hidden rounded-[13px] border-[1.5px] border-ink-100 bg-white px-3 transition dark:border-ink-100 dark:bg-surface-elevated",
            open &&
              "border-[#12B886] shadow-[0_0_0_4px_rgba(18,184,134,.14)]",
            disabled && "cursor-not-allowed opacity-55",
          )}
          onPointerDown={(event) => {
            if (disabled) return;
            if (
              event.target instanceof HTMLElement &&
              event.target.closest("button")
            ) {
              return;
            }
            if (!open) {
              openMenu();
              focusSearchInput();
            }
          }}
        >
          <Search
            className="h-[18px] w-[18px] shrink-0 text-ink-500"
            aria-hidden
          />
          <input
            ref={searchRef}
            className="min-w-0 flex-1 truncate bg-transparent py-3 text-base text-ink-900 outline-none placeholder:text-[#9AA6B6] sm:text-[14.5px]"
            value={open ? query : selectedLabel}
            onChange={(event) => {
              if (!open) {
                setQuery(event.target.value);
                setOpen(true);
                return;
              }
              setQuery(event.target.value);
            }}
            onFocus={() => {
              if (disabled) return;
              if (!open) {
                setQuery("");
                setOpen(true);
              }
              focusSearchInput();
            }}
            placeholder={open ? searchPlaceholder : selectedLabel || searchPlaceholder}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            inputMode="search"
            enterKeyHint="search"
            autoFocus={autoFocus}
          />
          {showClear ? (
            <button
              type="button"
              className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] bg-[#EEF1F5] text-ink-500"
              aria-label="Clear"
              disabled={disabled}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
                if (value) onChange("");
                close();
              }}
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </button>
          ) : null}
          <ChevronDown
            className={clsx(
              "h-[18px] w-[18px] shrink-0 text-ink-500 transition",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          className={clsx(
            "flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[13px] border-[1.5px] border-ink-100 bg-white px-3 py-2.5 text-left text-base transition dark:border-ink-100 dark:bg-surface-elevated dark:text-ink-900 sm:text-[14.5px]",
            open &&
              "border-[#12B886] shadow-[0_0_0_4px_rgba(18,184,134,.14)]",
            !value && "text-[#9AA6B6]",
            disabled && "cursor-not-allowed opacity-55",
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            if (disabled) return;
            if (open) {
              close();
              return;
            }
            openMenu();
            requestAnimationFrame(() => {
              rootRef.current?.scrollIntoView({
                block: "center",
                behavior: "smooth",
              });
            });
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {selectedLabel || placeholder}
          </span>
          <ChevronDown
            className={clsx(
              "h-[18px] w-[18px] shrink-0 text-ink-500 transition",
              open && "rotate-180",
            )}
          />
        </button>
      )}

      {menu}
    </div>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const index = lower.indexOf(qLower);
  if (index >= 0) {
    return (
      <>
        {text.slice(0, index)}
        <mark className="rounded-[3px] bg-[#FFF1B8] px-px text-inherit dark:bg-amber-400/30 dark:text-ink-900">
          {text.slice(index, index + q.length)}
        </mark>
        {text.slice(index + q.length)}
      </>
    );
  }

  // Compact query ("redmia13") — highlight words that participate in the match
  const qCompact = compactSearchText(q);
  if (!qCompact || !matchesElasticSearch(text, q)) return <>{text}</>;

  const chunks = text.split(/(\s+)/);
  return (
    <>
      {chunks.map((chunk, i) => {
        if (!chunk || /^\s+$/.test(chunk)) {
          return <span key={i}>{chunk}</span>;
        }
        const chunkCompact = compactSearchText(chunk);
        const hit =
          chunkCompact.length > 0 &&
          (qCompact.includes(chunkCompact) ||
            chunkCompact.includes(qCompact) ||
            normalizeSearchText(chunk)
              .split(" ")
              .filter(Boolean)
              .every((token) => qCompact.includes(token)));
        return hit ? (
          <mark
            key={i}
            className="rounded-[3px] bg-[#FFF1B8] px-px text-inherit dark:bg-amber-400/30 dark:text-ink-900"
          >
            {chunk}
          </mark>
        ) : (
          <span key={i}>{chunk}</span>
        );
      })}
    </>
  );
}

function pickerAvatarStyle(
  avatar: FieldPickerAvatar,
  dark: boolean,
): { background: string; color: string } {
  if (!dark) {
    return { background: avatar.bg, color: avatar.fg };
  }
  return {
    background: `color-mix(in srgb, ${avatar.fg} 22%, rgb(30 41 59))`,
    color: `color-mix(in srgb, ${avatar.fg} 55%, white)`,
  };
}

function PickerOption({
  label,
  description,
  active,
  icon,
  badge,
  badgeTone,
  meta,
  avatar,
  query,
  dark,
  onSelect,
}: {
  label: string;
  description?: string;
  active?: boolean;
  icon?: ReactNode;
  badge?: string;
  badgeTone?: "new" | "old";
  meta?: string;
  avatar?: FieldPickerAvatar;
  query?: string;
  dark: boolean;
  onSelect: () => void;
}) {
  const q = query || "";
  return (
    <button
      type="button"
      role="option"
      aria-selected={Boolean(active)}
      className={clsx(
        "flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[11px] py-2.5 pl-2.5 pr-1.5 text-left transition sm:gap-3 sm:px-2.5",
        active
          ? "bg-[#E7F8F1] dark:bg-tide-100/40"
          : "hover:bg-[#F4F7FA] active:bg-[#F4F7FA] dark:hover:bg-surface-muted dark:active:bg-surface-muted",
      )}
      onClick={onSelect}
    >
      {avatar ? (
        <span
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] text-sm font-bold ring-1 ring-black/5 dark:ring-white/10"
          style={pickerAvatarStyle(avatar, dark)}
        >
          {avatar.letter}
        </span>
      ) : icon ? (
        <span className="shrink-0 text-ink-700">{icon}</span>
      ) : null}

      <span className="min-w-0 flex-1 overflow-hidden">
        <span
          className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-ink-900"
          title={label}
        >
          <HighlightText text={label} query={q} />
        </span>
        {description ? (
          <span
            className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-xs tracking-wide text-ink-500 tabular-nums"
            title={description}
          >
            <HighlightText text={description} query={q} />
          </span>
        ) : null}
      </span>

      {(badge || meta) && (
        <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
          {badge ? (
            <span
              className={clsx(
                "rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide",
                badgeTone === "old"
                  ? "bg-[#FEF3E2] text-[#B76E00] dark:bg-amber-500/20 dark:text-amber-400"
                  : "bg-[#E7F8F1] text-[#0E9E76] dark:bg-tide-400/20 dark:text-tide-400",
              )}
            >
              {badge}
            </span>
          ) : null}
          {meta ? (
            <span className="text-[13.5px] font-bold tabular-nums text-ink-900">
              {meta}
            </span>
          ) : null}
        </span>
      )}

      <Check
        className={clsx(
          "hidden h-[18px] w-[18px] shrink-0 text-[#0E9E76] transition dark:text-tide-400 sm:block",
          active ? "opacity-100" : "opacity-0",
        )}
        strokeWidth={2.6}
      />
    </button>
  );
}
