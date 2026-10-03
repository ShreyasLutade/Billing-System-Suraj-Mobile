import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import clsx from "clsx";
import { ArrowLeft, X } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

export function BackLink({
  to,
  state,
  children,
  className,
}: {
  to: string;
  state?: unknown;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} state={state} className={clsx("back-pill", className)}>
      <ArrowLeft strokeWidth={2} />
      {children}
    </Link>
  );
}

/** Clear (×) control for search fields — show when the query is non-empty. */
export function SearchClearButton({
  visible,
  onClear,
  className,
  label = "Clear search",
}: {
  visible: boolean;
  onClear: () => void;
  className?: string;
  label?: string;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      className={clsx("tb-search-clear", className)}
      aria-label={label}
      onMouseDown={(event) => {
        // Keep the search input focused after clearing.
        event.preventDefault();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClear();
      }}
    >
      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  );
}

export function BackButton({
  onClick,
  children,
  disabled,
  className,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx("back-pill", className)}
    >
      <ArrowLeft strokeWidth={2} />
      {children}
    </button>
  );
}

/**
 * Compact page title: icon tile + title on one row, optional action on the
 * right (buttons inside are shrunk via .page-header-action), so content
 * starts high on a phone.
 */
export function PageHeader({
  icon: Icon,
  title,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h1 className="flex min-w-0 items-center gap-2.5 font-display text-[22px] font-bold tracking-tight text-ink-900 sm:text-2xl">
        {Icon ? (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-tide-100 text-tide-600 dark:bg-tide-100/30 dark:text-tide-400">
            <Icon className="h-[18px] w-[18px]" />
          </span>
        ) : null}
        <span className="truncate">{title}</span>
      </h1>
      {action ? <div className="page-header-action">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  delay = 0,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "tide" | "ember" | "ink";
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className={clsx(
        "glass-panel relative overflow-hidden p-5",
        tone === "tide" && "bg-gradient-to-br from-tide-100/80 to-white/80",
        tone === "ember" && "bg-gradient-to-br from-orange-50/90 to-white/80",
        tone === "ink" && "bg-gradient-to-br from-ink-900 to-ink-800 text-white",
      )}
    >
      <p
        className={clsx(
          "text-xs font-semibold uppercase tracking-[0.16em]",
          tone === "ink" ? "text-tide-400" : "text-ink-500",
        )}
      >
        {label}
      </p>
      <p
        className={clsx(
          "mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl",
          tone === "ink" ? "text-white" : "text-ink-900",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p
          className={clsx(
            "mt-2 text-xs",
            tone === "ink" ? "text-ink-100/80" : "text-ink-500",
          )}
        >
          {hint}
        </p>
      ) : null}
    </motion.div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="glass-panel px-6 py-16 text-center">
      <p className="font-display text-xl font-semibold text-ink-900">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">{description}</p>
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="glass-panel flex items-center justify-center gap-3 px-6 py-16 text-sm text-ink-500">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-tide-500" />
      {label}
    </div>
  );
}
