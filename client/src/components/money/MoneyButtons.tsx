import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Receipt, Smartphone, Wallet, type LucideIcon } from "lucide-react";
import { api } from "../../lib/api";
import { formatRupees } from "../../lib/dueStatus";
import type { MoneySummary } from "../../types";
import { AnimatedNumber } from "../AnimatedNumber";
import { SPRING } from "../../lib/motion";

type Tile = {
  key: string;
  to: string;
  label: string;
  hint: string;
  value: number | null;
  icon: LucideIcon;
  from: string;
  to2: string;
  glow: string;
};

/**
 * Analytics → three buttons under the summary card: Cash, Online and
 * Expense books, each with its live figure. Tapping zooms into the book.
 */
export function MoneyButtons() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<MoneySummary | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .moneySummary()
      .then(({ data }) => alive && setSummary(data))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const tiles: Tile[] = [
    {
      key: "cash",
      to: "/analytics/cash",
      label: "Cash",
      hint: summary && !summary.cash.started ? "Tap to start" : "in hand",
      value: summary ? summary.cash.balance : null,
      icon: Wallet,
      from: "#10B981",
      to2: "#047857",
      glow: "rgba(16,185,129,.45)",
    },
    {
      key: "online",
      to: "/analytics/online",
      label: "Online",
      hint: "balance",
      value: summary ? summary.online.balance : null,
      icon: Smartphone,
      from: "#3B82F6",
      to2: "#1D4ED8",
      glow: "rgba(59,130,246,.45)",
    },
    {
      key: "expense",
      to: "/analytics/expenses",
      label: "Expense",
      hint: "this month",
      value: summary ? summary.expense.thisMonth : null,
      icon: Receipt,
      from: "#F43F5E",
      to2: "#BE123C",
      glow: "rgba(244,63,94,.45)",
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-3 gap-2.5" role="group" aria-label="Money books">
      {tiles.map((tile, index) => {
        const Icon = tile.icon;
        return (
          <motion.button
            key={tile.key}
            type="button"
            className="money-tile group relative overflow-hidden rounded-2xl border border-[#E7EAF0] bg-white px-2.5 pb-2.5 pt-3 text-left shadow-[0_10px_24px_-16px_rgba(11,31,51,0.45)] dark:border-[rgb(var(--color-line))] dark:bg-surface"
            style={{ "--tile-glow": tile.glow } as React.CSSProperties}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...SPRING, delay: 0.12 + index * 0.07 }}
            whileTap={{ scale: 0.94 }}
            whileHover={{ y: -2 }}
            onClick={() => navigate(tile.to)}
            aria-label={`Open ${tile.label} book`}
          >
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-white shadow-[0_8px_16px_-8px_var(--tile-glow)]"
              style={{ background: `linear-gradient(135deg, ${tile.from}, ${tile.to2})` }}
              aria-hidden
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2.3} />
            </span>
            <span className="mt-2 block text-[13px] font-bold text-ink-900">{tile.label}</span>
            <span className="block min-h-[20px] font-display text-[15px] font-bold tabular-nums text-ink-900">
              {tile.value === null ? (
                <span className="inline-block h-3.5 w-14 animate-pulse rounded bg-ink-900/10 align-middle dark:bg-white/10" />
              ) : (
                <AnimatedNumber value={tile.value} format={formatRupees} fit duration={1} />
              )}
            </span>
            <span className="block text-[10.5px] font-semibold text-ink-400">{tile.hint}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
