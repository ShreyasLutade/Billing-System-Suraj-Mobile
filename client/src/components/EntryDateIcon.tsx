import { CalendarDays } from "lucide-react";
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
 * Calendar icon for the right side of an amount box. Today: just the icon;
 * another day: icon + short date. Tapping opens the phone's date picker.
 */
export function EntryDateIcon({
  value,
  onChange,
  prefix,
  tone,
}: {
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
        "relative inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-xl transition",
        custom ? "px-2.5" : "w-10",
        custom
          ? tone === "gave"
            ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "bg-ink-900/[0.05] text-ink-500 hover:text-ink-800 dark:bg-white/[0.07]",
      )}
      title={`${prefix} ${label(current)}`}
    >
      <CalendarDays className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} />
      {custom ? (
        <span className="whitespace-nowrap text-[12px] font-bold tabular-nums">{label(current)}</span>
      ) : null}
      <input
        type="date"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={`${prefix} date: ${label(current)}`}
        max={today}
        value={current}
        onClick={(event) => {
          try {
            (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
          } catch {
            // ignore
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
