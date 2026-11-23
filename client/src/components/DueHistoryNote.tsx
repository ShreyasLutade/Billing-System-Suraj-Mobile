import { motion } from "framer-motion";
import { AlertTriangle, CircleCheck, Clock3 } from "lucide-react";
import { formatRupees } from "../lib/dueStatus";
import type { DueHistory } from "../types";

function days(n: number) {
  return `${n} day${n === 1 ? "" : "s"}`;
}

/**
 * On the New Bill due card: what this number still owes on other bills
 * (red, highlighted), and how it paid dues before: on time, or how many
 * days late (small line).
 */
export function DueHistoryNote({ history }: { history: DueHistory }) {
  const { pending, pendingCount, advance, maxDaysLate, openBills, paidBefore } = history;
  const pastLine = (() => {
    const total = paidBefore.withDate;
    if (total === 0) return null;
    const paid = `Paid ${total} past due${total === 1 ? "" : "s"}`;
    if (paidBefore.late === 0) {
      return { tone: "good" as const, text: `${paid} · ${total === 1 ? "on time" : "all on time"}` };
    }
    if (total === 1) {
      return { tone: "bad" as const, text: `${paid} · ${days(paidBefore.maxDaysLate)} late` };
    }
    const last = paidBefore.last;
    const lastText = last ? (last.delayDays > 0 ? `last one ${days(last.delayDays)} late` : "last one on time") : null;
    const howLate =
      paidBefore.late === 1
        ? `1 late by ${days(paidBefore.maxDaysLate)}`
        : `${paidBefore.late} late (usually ${days(paidBefore.avgDaysLate)}, worst ${days(paidBefore.maxDaysLate)})`;
    return { tone: "bad" as const, text: [paid, howLate, lastText].filter(Boolean).join(" · ") };
  })();

  if (pending <= 0 && !pastLine && advance <= 0) return null;

  return (
    <div className="mb-3 space-y-1.5" role="note" aria-live="polite">
      {pending > 0 ? (
        <motion.div
          className="due-history-alert relative overflow-hidden rounded-xl border border-rose-400/60 bg-rose-50 px-3 py-2.5 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-200"
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 26 }}
        >
          <p className="flex items-start gap-2 text-[13px] font-bold leading-snug">
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.4} />
            <span>
              Already pending {formatRupees(pending)} on {pendingCount} other bill
              {pendingCount === 1 ? "" : "s"}
              {maxDaysLate > 0 ? ` · ${days(maxDaysLate)} late` : ""}
            </span>
          </p>
          <p className="mt-1 pl-6 text-[11.5px] font-semibold text-rose-600/90 dark:text-rose-200/80">
            {openBills
              .slice(0, 3)
              .map(
                (b) =>
                  `${b.invoiceNumber ?? "No bill"} ${formatRupees(b.dueAmount)}${b.daysLate > 0 ? ` (${b.daysLate}d late)` : ""}`,
              )
              .join(" · ")}
            {openBills.length > 3 ? ` · +${openBills.length - 3} more` : ""}
          </p>
        </motion.div>
      ) : null}
      {advance > 0 ? (
        <p className="flex items-start gap-1.5 px-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
          <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
          Has {formatRupees(advance)} advance with you (paid extra before)
        </p>
      ) : null}
      {pastLine ? (
        <p
          className={
            pastLine.tone === "bad"
              ? "flex items-start gap-1.5 px-1 text-[11.5px] font-semibold text-rose-600 dark:text-rose-300"
              : "flex items-start gap-1.5 px-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400"
          }
        >
          {pastLine.tone === "bad" ? (
            <Clock3 className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
          ) : (
            <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
          )}
          {pastLine.text}
        </p>
      ) : null}
    </div>
  );
}
