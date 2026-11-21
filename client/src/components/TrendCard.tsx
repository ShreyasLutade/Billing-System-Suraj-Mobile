import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, TrendingUp } from "lucide-react";
import clsx from "clsx";
import { AnimatedNumber } from "./AnimatedNumber";
import { formatRupees } from "../lib/dueStatus";
import { fromState } from "../lib/navMemory";
import { SPRING } from "../lib/motion";
import { cachedTrend, changePct, loadTrend, monthLong, previousComparable } from "../lib/trend";
import type { MonthlyTrend } from "../types";

/** Analytics card: this month's sales vs last month, 12 mini bars → trend page. */
export function TrendCard() {
  const location = useLocation();
  const [data, setData] = useState<MonthlyTrend | null>(cachedTrend);

  useEffect(() => {
    let active = true;
    loadTrend()
      .then((fresh) => {
        if (active) setData(fresh);
      })
      .catch(() => {
        // The card simply stays as it was; the trend page shows the error.
      });
    return () => {
      active = false;
    };
  }, []);

  const months = data?.months ?? [];
  const current = months[months.length - 1];
  const comparable = data && current ? previousComparable(months, months.length - 1, "sales", data.today) : null;
  const change = comparable ? changePct(current.sales, comparable.value) : null;
  const max = Math.max(...months.map((m) => m.sales), 1);

  return (
    <Link
      to="/analytics/trend"
      state={fromState(location)}
      className="interactive-card group relative block overflow-hidden rounded-2xl border border-ink-100/80 bg-white/90 px-4 py-3.5 shadow-soft"
      aria-label="Monthly trend: open"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
            <TrendingUp className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#93C5FD]" strokeWidth={2.4} />
            Monthly trend
          </p>
          <p className="mt-1 text-[11.5px] font-medium text-ink-500">
            {current ? `${monthLong(current.key)} sales` : "Sales this month"}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {current ? (
              <AnimatedNumber
                value={current.sales}
                format={formatRupees}
                className="font-display text-xl font-bold tabular-nums tracking-tight text-ink-900"
              />
            ) : (
              <span className="font-display text-xl font-bold text-ink-300">—</span>
            )}
            {change != null ? (
              <motion.span
                className={clsx(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[11px] font-bold",
                  change >= 0
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-orange-500/10 text-orange-600 dark:text-orange-300",
                )}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 20, delay: 0.5 }}
              >
                {change >= 0 ? (
                  <ArrowUpRight className="h-3 w-3" strokeWidth={2.8} />
                ) : (
                  <ArrowDownRight className="h-3 w-3" strokeWidth={2.8} />
                )}
                {Math.abs(change).toFixed(0)}% {comparable?.label}
              </motion.span>
            ) : null}
          </div>
        </div>

        {/* 12 mini bars, current month in full colour. */}
        <div className="flex h-14 shrink-0 items-end gap-[3px]" aria-hidden>
          {(months.length ? months : Array.from({ length: 12 }, () => null)).map((m, i, all) => (
            <motion.span
              key={m?.key ?? i}
              className="block w-[7px] rounded-t-[3px]"
              style={{
                height: m ? `${Math.max((m.sales / max) * 100, 4)}%` : "20%",
                background: m && i === all.length - 1 ? "var(--trend-sales)" : "var(--trend-sales-soft)",
                originY: 1,
              }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ ...SPRING, delay: 0.15 + i * 0.04 }}
            />
          ))}
        </div>
      </div>
      <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] font-semibold text-ink-400 opacity-0 transition group-hover:opacity-100">
        View →
      </span>
    </Link>
  );
}
