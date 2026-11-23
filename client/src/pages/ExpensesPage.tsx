import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus, Receipt, X } from "lucide-react";
import clsx from "clsx";
import { BackLink, LoadingBlock } from "../components/ui";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { HeroSparkles } from "../components/AnalyticsBackdrop";
import { EntryDateIcon, todayIST } from "../components/EntryDateIcon";
import { SuccessBurst } from "../components/money/SuccessBurst";
import { useFixedBottomBar } from "../hooks/useFixedBottomBar";
import { api, round2 } from "../lib/api";
import { formatRupees } from "../lib/dueStatus";
import { EXPENSE_CATEGORIES, expenseCategory, groupByDay, monthLabel, shiftMonth } from "../lib/moneyBooks";
import { SPRING } from "../lib/motion";
import type { ExpenseMonth, MoneyEntry } from "../types";
import { AmountField, ErrorNote, Sheet } from "./DueDetailPage";
import { DeleteSheet } from "./MoneyBookPage";

const thisMonth = () => todayIST().slice(0, 7);

/**
 * Analytics → Expense: the shop's spending by month. A 12-month bar strip to
 * move between months, the month's total and split by kind (rent,
 * electricity, salary…), every expense by day, and + ADD EXPENSE.
 */
export function ExpensesPage() {
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<ExpenseMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<MoneyEntry | null>(null);
  const [burst, setBurst] = useState<{ label: string; sublabel?: string; color: string } | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const bar = useFixedBottomBar(rootRef, barRef, Boolean(data));

  const load = useCallback(async (which: string) => {
    try {
      const { data: next } = await api.expenses(which);
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load expenses");
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  useEffect(() => {
    document.body.classList.add("has-fab");
    return () => document.body.classList.remove("has-fab");
  }, []);

  if (!data) {
    return (
      <div>
        <BackLink to="/analytics" className="mb-4">
          Back to analytics
        </BackLink>
        {error ? <p className="glass-panel px-5 py-4 text-sm text-ember-500">{error}</p> : <LoadingBlock label="Loading expenses…" />}
      </div>
    );
  }

  const max = Math.max(...data.months.map((m) => m.total), 1);
  const prevMonth = data.months.find((m) => m.month === shiftMonth(data.month, -1));
  const diff = prevMonth ? round2(data.total - prevMonth.total) : null;
  const atLatest = month >= thisMonth();
  const groups = groupByDay(data.entries);

  return (
    <div ref={rootRef} className="mx-auto max-w-2xl pb-4">
      <BackLink to="/analytics" className="mb-3">
        Back to analytics
      </BackLink>

      {/* Month total + 12-month bars */}
      <motion.section
        className="relative mb-4 overflow-hidden rounded-[1.25rem] p-5 text-white shadow-lift"
        style={{ background: "radial-gradient(120% 140% at 0% 0%, #5A1830 0%, #2A1530 45%, #0E1626 100%)" }}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SPRING}
      >
        <HeroSparkles />
        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <Receipt className="h-4 w-4 text-[#FDA4AF]" />
              </span>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">Shop expenses</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
                aria-label="Previous month"
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-30"
                aria-label="Next month"
                disabled={atLatest}
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={data.month}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.2 }}
            >
              <p className="mt-3 text-[12px] font-semibold text-white/65">Spent in {monthLabel(data.month)}</p>
              <p className="font-display text-[clamp(2.1rem,9vw,2.9rem)] font-bold leading-none tracking-tight tabular-nums">
                <AnimatedNumber value={data.total} format={formatRupees} duration={0.9} />
              </p>
              {diff !== null && prevMonth && prevMonth.total > 0 ? (
                <span
                  className={clsx(
                    "mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-bold",
                    diff > 0 ? "bg-orange-300/15 text-orange-300" : "bg-[#5CE0AE]/15 text-[#5CE0AE]",
                  )}
                >
                  {diff > 0 ? "▲" : diff < 0 ? "▼" : "="} {formatRupees(Math.abs(diff))} vs {monthLabel(prevMonth.month, true)}
                </span>
              ) : null}
            </motion.div>
          </AnimatePresence>

          {/* Tap a bar to open that month */}
          <div className="mt-4 flex h-[92px] items-end gap-[5px]" role="tablist" aria-label="Months">
            {data.months.map((m, i) => {
              const on = m.month === data.month;
              const h = m.total > 0 ? Math.max((m.total / max) * 64, 4) : 2;
              return (
                <button
                  key={m.month}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-label={`${monthLabel(m.month)}: ${formatRupees(m.total)}`}
                  className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                  onClick={() => setMonth(m.month)}
                >
                  <motion.span
                    className={clsx(
                      "block w-full max-w-[22px] rounded-t-[5px] rounded-b-[2px]",
                      on ? "bg-gradient-to-t from-[#F43F5E] to-[#FDA4AF]" : "bg-white/20 group-hover:bg-white/35",
                    )}
                    style={on ? { boxShadow: "0 0 18px rgba(244,63,94,.6)" } : undefined}
                    initial={{ height: 0 }}
                    animate={{ height: h }}
                    transition={{ ...SPRING, delay: i * 0.025 }}
                  />
                  <span className={clsx("text-[9.5px] font-bold", on ? "text-white" : "text-white/45")}>
                    {monthLabel(m.month, true).slice(0, 3)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </motion.section>

      {/* Split by kind */}
      {data.byCategory.length > 0 ? (
        <motion.section
          className="due-card mb-4 px-4 py-3.5"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: 0.08 }}
        >
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">Where it went</h2>
          <div className="mb-3 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-ink-900/[0.06] dark:bg-white/10">
            {data.byCategory.map((c, i) => (
              <motion.span
                key={c.category}
                className="block h-full"
                style={{ background: expenseCategory(c.category).color }}
                initial={{ width: 0 }}
                animate={{ width: `${(c.total / Math.max(data.total, 1)) * 100}%` }}
                transition={{ ...SPRING, delay: 0.15 + i * 0.05 }}
              />
            ))}
          </div>
          <ul className="space-y-2">
            {data.byCategory.map((c) => {
              const cat = expenseCategory(c.category);
              const Icon = cat.icon;
              const share = data.total > 0 ? Math.round((c.total / data.total) * 100) : 0;
              return (
                <li key={c.category} className="flex items-center gap-2.5">
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
                    style={{ background: `${cat.color}1F`, color: cat.color }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink-900">{cat.label}</span>
                    <span className="block text-[11px] text-ink-400">
                      {c.count} entr{c.count === 1 ? "y" : "ies"} · {share}%
                    </span>
                  </span>
                  <span className="text-[14px] font-bold tabular-nums text-ink-900">{formatRupees(c.total)}</span>
                </li>
              );
            })}
          </ul>
        </motion.section>
      ) : null}

      {/* Every expense by day */}
      {data.entries.length === 0 ? (
        <motion.div
          className="due-card px-5 py-8 text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="font-display text-base font-bold text-ink-900">No expenses in {monthLabel(data.month)}</p>
          <p className="mt-1 text-sm text-ink-500">Tap + ADD EXPENSE to write rent, electricity, salary…</p>
        </motion.div>
      ) : (
        groups.map((group, gi) => (
          <motion.div
            key={`${data.month}-${group.day}`}
            className="mb-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: Math.min(gi, 6) * 0.05 + 0.1 }}
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">{group.day}</h2>
              <span className="text-[11px] font-semibold tabular-nums text-ink-400">
                {formatRupees(group.items.reduce((s, e) => s + e.amount, 0))}
              </span>
            </div>
            <div className="due-card overflow-hidden !p-0">
              {group.items.map((entry) => {
                const cat = expenseCategory(entry.category);
                const Icon = cat.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={clsx(
                      "flex w-full items-center gap-2.5 border-b border-[#EEF1F5] px-3 py-2.5 text-left transition last:border-b-0 hover:bg-ink-900/[0.02] active:bg-ink-900/[0.05] dark:border-[rgb(var(--color-line))]",
                      entry.id === freshId && "money-row-new",
                    )}
                    onClick={() => setRemoving(entry)}
                  >
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                      style={{ background: `${cat.color}1F`, color: cat.color }}
                      aria-hidden
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-ink-900">{cat.label}</span>
                      <span className="block truncate text-[11.5px] text-ink-400">
                        {[entry.note, entry.method === "online" ? "Online" : entry.method === "cash" ? "Cash" : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[14px] font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      −{formatRupees(entry.amount)}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ))
      )}

      <div aria-hidden style={{ height: bar.height + 8 }} />
      {createPortal(
        <div
          ref={barRef}
          className={clsx(
            "fixed z-30",
            (adding || removing || burst) && "invisible",
            bar.mobile &&
              "border-t border-ink-100/80 bg-white/95 px-3 py-2 backdrop-blur dark:bg-surface-elevated/95",
          )}
          style={
            bar.mobile
              ? { left: 0, right: 0, bottom: bar.bottom }
              : { left: bar.left, width: bar.width, bottom: 16 }
          }
        >
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#F43F5E] to-[#E11D48] text-[14.5px] font-bold tracking-wide text-white shadow-[0_10px_22px_-10px_rgba(225,29,72,0.95)]"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.8} />
            ADD EXPENSE
          </motion.button>
        </div>,
        document.body,
      )}

      <AnimatePresence>
        {adding ? (
          <AddExpenseSheet
            key="add"
            onClose={() => setAdding(false)}
            onSaved={async (entry) => {
              setAdding(false);
              const cat = expenseCategory(entry.category);
              setBurst({ label: "Expense saved", sublabel: `${cat.label} · ${formatRupees(entry.amount)}`, color: "#F43F5E" });
              setFreshId(entry.id);
              const entryMonth = entry.date.slice(0, 7);
              const istMonth = new Date(entry.date).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
              if ((istMonth || entryMonth) !== month) setMonth(istMonth || entryMonth);
              else await load(month);
            }}
          />
        ) : null}
        {removing ? (
          <DeleteSheet
            key="delete"
            entry={removing}
            title={expenseCategory(removing.category).label}
            onClose={() => setRemoving(null)}
            onDeleted={async () => {
              setRemoving(null);
              await load(month);
            }}
          />
        ) : null}
        {burst ? <SuccessBurst key="burst" {...burst} onDone={() => setBurst(null)} /> : null}
      </AnimatePresence>
    </div>
  );
}

function AddExpenseSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (entry: MoneyEntry) => void | Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [method, setMethod] = useState<"cash" | "online">("cash");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(todayIST);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = amount.trim() === "" ? null : Number(amount);

  async function save() {
    if (value === null || !Number.isFinite(value) || value <= 0) {
      setError("Enter the amount");
      return;
    }
    if (!category) {
      setError("Pick what it was for");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.addExpense({
        amount: round2(value),
        category,
        method,
        note: note.trim() || null,
        date: day,
      });
      await onSaved(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="add-expense-title" busy={saving} onClose={onClose} place="top">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-rose-600 dark:text-rose-400">New expense</p>
          <h2 id="add-expense-title" className="font-display text-[17px] font-bold text-ink-900">
            What did the shop spend on?
          </h2>
        </div>
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-900/[0.05] text-ink-500 transition hover:bg-ink-900/10 dark:bg-white/10"
          onClick={onClose}
          disabled={saving}
          aria-label="Close"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>
      <AmountField
        id="expense-amount"
        value={amount}
        tone="gave"
        trailing={<EntryDateIcon value={day} onChange={setDay} prefix="Spent on" tone="gave" />}
        onChange={(next) => {
          setAmount(next);
          setError(null);
        }}
      />
      <div className="mt-2.5 grid grid-cols-5 gap-1.5">
        {EXPENSE_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const on = category === cat.key;
          return (
            <motion.button
              key={cat.key}
              type="button"
              whileTap={{ scale: 0.9 }}
              animate={on ? { scale: [1, 1.08, 1] } : { scale: 1 }}
              transition={{ duration: 0.25 }}
              className={clsx(
                "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center transition",
                on
                  ? "border-transparent text-white shadow-[0_8px_16px_-10px_rgba(0,0,0,.6)]"
                  : "border-ink-100 bg-white text-ink-600 dark:border-[rgb(var(--color-line))] dark:bg-surface-elevated",
              )}
              style={on ? { background: cat.color } : undefined}
              onClick={() => {
                setCategory(cat.key);
                setError(null);
              }}
              aria-pressed={on}
            >
              <Icon className="h-[18px] w-[18px]" style={on ? undefined : { color: cat.color }} />
              <span className="line-clamp-2 text-[9.5px] font-bold leading-tight">{cat.label}</span>
            </motion.button>
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["cash", "online"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={clsx(
              "h-10 rounded-xl border text-sm font-bold transition",
              method === option
                ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "border-ink-100 bg-white text-ink-700 dark:border-[rgb(var(--color-line))] dark:bg-surface-elevated",
            )}
            onClick={() => setMethod(option)}
          >
            Paid by {option === "cash" ? "Cash" : "Online"}
          </button>
        ))}
      </div>
      <input
        className="field sheet-field mt-2"
        autoComplete="off"
        maxLength={200}
        placeholder="Note (optional), e.g. November rent"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <ErrorNote error={error} />
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        className="mt-3 h-12 w-full rounded-2xl bg-gradient-to-r from-[#F43F5E] to-[#E11D48] text-[15px] font-bold text-white disabled:opacity-60"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : value && value > 0 ? `Save ${formatRupees(value)}` : "Save"}
      </motion.button>
    </Sheet>
  );
}
