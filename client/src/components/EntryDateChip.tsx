import { CalendarDays, ChevronDown } from "lucide-react";
import clsx from "clsx";

/** Today in India as YYYY-MM-DD. */
export function todayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function yesterdayIST() {
  return new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
}

function label(value: string) {
  if (value === todayIST()) return "Today";
  if (value === yesterdayIST()) return "Yesterday";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(y !== Number(todayIST().slice(0, 4)) ? { year: "numeric" } : {}),
  }).format(new Date(y, m - 1, d));
}

/**
 * "📅 Today ▾" chip for when money was given / received. Tapping opens the
 * phone's date picker (a hidden date input covers the chip); no future days.
 */
export function EntryDateChip({
  value,
  onChange,
  prefix,
  tone,
}: {
  /** YYYY-MM-DD (today when empty). */
  value: string;
  onChange: (value: string) => void;
  prefix: string;
  tone: "gave" | "got";
}) {
  const today = todayIST();
  const current = value || today;
  const custom = current !== today;
  return (
    <label
      className={clsx(
        "relative inline-flex h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 text-[12.5px] font-bold transition",
        custom
          ? tone === "gave"
            ? "border-rose-400/70 bg-rose-500/[0.07] text-rose-600 dark:text-rose-400"
            : "border-emerald-500/70 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-400"
          : "border-ink-100 bg-white text-ink-800 dark:border-[rgb(var(--color-line))] dark:bg-surface",
      )}
    >
      <CalendarDays className="h-4 w-4 shrink-0" strokeWidth={2.2} />
      <span className="font-semibold text-ink-400">{prefix}</span>
      <span className="truncate tabular-nums">{label(current)}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" strokeWidth={2.6} />
      <input
        type="date"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={`${prefix} date`}
        max={today}
        value={current}
        onClick={(event) => {
          // Desktop browsers only open the picker from its icon otherwise.
          try {
            (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
          } catch {
            // ignore (already open / not allowed)
          }
        }}
        onChange={(event) => {
          const next = event.target.value;
          onChange(!next || next > today ? today : next);
        }}
      />
    </label>
  );
}
