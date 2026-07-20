import { motion } from "framer-motion";
import clsx from "clsx";
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-tide-600">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500 sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {action}
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
