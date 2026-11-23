import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { formatRupees } from "../lib/dueStatus";
import type { DueHistory } from "../types";

/**
 * On the New Bill due card, short: what this number still owes on other
 * bills (red, highlighted) and how it paid before, in a few words.
 */
export function DueHistoryNote({ history }: { history: DueHistory }) {
  const { pending, pendingCount, advance, maxDaysLate, paidBefore } = history;
  const past =
    paidBefore.withDate === 0
      ? null
      : paidBefore.late === 0
        ? { bad: false, text: "Paid on time before" }
        : { bad: true, text: `Paid late before · ${paidBefore.maxDaysLate}d` };

  if (pending <= 0 && !past && advance <= 0) return null;

  return (
    <div className="mb-3" role="note" aria-live="polite">
      {pending > 0 ? (
        <motion.p
          className="due-history-alert flex items-center gap-1.5 rounded-lg border border-rose-400/60 bg-rose-50 px-2.5 py-1.5 text-[12.5px] font-bold text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-200"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 26 }}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} />
          <span className="min-w-0 truncate">
            Pending {formatRupees(pending)}
            {pendingCount > 1 ? ` · ${pendingCount} bills` : ""}
            {maxDaysLate > 0 ? ` · ${maxDaysLate}d late` : ""}
          </span>
        </motion.p>
      ) : null}
      {past || advance > 0 ? (
        <p className="mt-1 flex flex-wrap gap-x-2 px-0.5 text-[11px] font-semibold">
          {past ? (
            <span className={past.bad ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-400"}>
              {past.text}
            </span>
          ) : null}
          {advance > 0 ? (
            <span className="text-emerald-600 dark:text-emerald-400">Advance {formatRupees(advance)}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
