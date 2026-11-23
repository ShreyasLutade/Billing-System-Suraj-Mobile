import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, Pencil, Smartphone, Trash2, Wallet, X } from "lucide-react";
import clsx from "clsx";
import { BackLink, LoadingBlock } from "../components/ui";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { HeroSparkles } from "../components/AnalyticsBackdrop";
import { EntryDateIcon, todayIST } from "../components/EntryDateIcon";
import { SuccessBurst } from "../components/money/SuccessBurst";
import { useFixedBottomBar } from "../hooks/useFixedBottomBar";
import { api, round2 } from "../lib/api";
import { formatRupees } from "../lib/dueStatus";
import { BOOK_META, MONEY_REASONS, groupByDay } from "../lib/moneyBooks";
import { SPRING } from "../lib/motion";
import type { MoneyBookData } from "../types";
import { AmountField, ErrorNote, Sheet } from "./DueDetailPage";

type Book = "cash" | "online";
type Entry = MoneyBookData["entries"][number];

/**
 * Analytics → Cash / Online: a hand-written khata. Balance on top, every
 * entry below by day with the running balance, YOU GAVE / YOU GOT at the
 * bottom. The Cash book asks for the cash in hand the first time.
 */
export function MoneyBookPage({ book }: { book: Book }) {
  const meta = BOOK_META[book];
  const [data, setData] = useState<MoneyBookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"IN" | "OUT" | "opening" | null>(null);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const [burst, setBurst] = useState<{ label: string; sublabel?: string; color: string } | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  // First time on a book: ask for the money in it now (or skip = ₹0).
  const needsOpening = data !== null && data.opening === null;
  const showBar = Boolean(data && !needsOpening);
  const bar = useFixedBottomBar(rootRef, barRef, showBar);

  const load = useCallback(async () => {
    try {
      const { data: next } = await api.moneyBook(book);
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the book");
    }
  }, [book]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!showBar) return;
    document.body.classList.add("has-fab");
    return () => document.body.classList.remove("has-fab");
  }, [showBar]);

  const Icon = book === "cash" ? Wallet : Smartphone;

  if (!data) {
    return (
      <div>
        <BackLink to="/analytics" className="mb-4">
          Back to analytics
        </BackLink>
        {error ? <p className="glass-panel px-5 py-4 text-sm text-ember-500">{error}</p> : <LoadingBlock label="Opening book…" variant="detail" />}
      </div>
    );
  }

  if (needsOpening) {
    return (
      <>
        <OpeningSetup
          book={book}
          onSaved={async (amount) => {
            setBurst({
              label: `${meta.title} started`,
              sublabel: amount > 0 ? `${formatRupees(amount)} to start` : "Starting from ₹0",
              color: book === "cash" ? "#10B981" : "#3B82F6",
            });
            await load();
          }}
        />
        <AnimatePresence>{burst ? <SuccessBurst {...burst} onDone={() => setBurst(null)} /> : null}</AnimatePresence>
      </>
    );
  }

  const groups = groupByDay(data.entries);
  const negative = data.balance < -0.005;

  return (
    <div ref={rootRef} className="mx-auto max-w-2xl pb-4">
      <BackLink to="/analytics" className="mb-3">
        Back to analytics
      </BackLink>

      {/* Balance */}
      <motion.section
        className="relative mb-4 overflow-hidden rounded-[1.25rem] p-5 text-white shadow-lift"
        style={{ background: meta.gradient }}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SPRING}
      >
        <HeroSparkles />
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full"
          style={{ background: `radial-gradient(circle, ${meta.glow}, transparent 70%)` }}
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
              <Icon className="h-4 w-4" style={{ color: meta.accent }} />
            </span>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">{meta.title}</p>
          </div>
          <p className="mt-3 text-[11px] font-semibold text-white/60">{meta.balanceLabel}</p>
          <p
            className={clsx(
              "font-display text-[clamp(2.1rem,9vw,2.9rem)] font-bold leading-none tracking-tight tabular-nums",
              negative && "text-orange-300",
            )}
          >
            <AnimatedNumber value={data.balance} format={formatRupees} duration={1.2} />
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#5CE0AE]">
                <ArrowDownLeft className="h-3 w-3" strokeWidth={3} /> Got this month
              </p>
              <AnimatedNumber value={data.monthIn} format={formatRupees} fit className="font-display text-[17px] font-bold tabular-nums" />
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#FF9A9A]">
                <ArrowUpRight className="h-3 w-3" strokeWidth={3} /> Gave this month
              </p>
              <AnimatedNumber value={data.monthOut} format={formatRupees} fit className="font-display text-[17px] font-bold tabular-nums" />
            </div>
          </div>
          {data.opening ? (
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11.5px] font-semibold text-white/80 transition hover:bg-white/15"
              onClick={() => setSheet("opening")}
            >
              {data.opening.amount > 0 ? `Opening ${formatRupees(data.opening.amount)}` : "Set opening balance"}
              <Pencil className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </motion.section>

      {/* Entries by day */}
      {data.entries.length === 0 ? (
        <motion.div
          className="due-card px-5 py-8 text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: 0.1 }}
        >
          <p className="font-display text-base font-bold text-ink-900">No entries yet</p>
          <p className="mt-1 text-sm text-ink-500">Tap YOU GOT or YOU GAVE below to write the first one.</p>
        </motion.div>
      ) : (
        groups.map((group, gi) => (
          <motion.div
            key={group.day}
            className="mb-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: Math.min(gi, 6) * 0.05 + 0.08 }}
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">{group.day}</h2>
              <span className="text-[11px] font-semibold tabular-nums text-ink-400">
                Bal {formatRupees(group.items[0].balanceAfter)}
              </span>
            </div>
            <div className="due-card overflow-hidden !p-0">
              {group.items.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  fresh={entry.id === freshId}
                  onOpen={() => (entry.kind === "OPENING" ? setSheet("opening") : setRemoving(entry))}
                />
              ))}
            </div>
          </motion.div>
        ))
      )}

      {showBar ? (
        <>
          <div aria-hidden style={{ height: bar.height + 8 }} />
          {createPortal(
            <div
              ref={barRef}
              className={clsx(
                "fixed z-30 grid grid-cols-2 gap-2",
                (sheet || removing || burst) && "invisible",
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
                whileTap={{ scale: 0.95 }}
                className="h-11 rounded-xl bg-[#D93A3F] text-[14.5px] font-bold tracking-wide text-white shadow-[0_8px_18px_-10px_rgba(217,58,63,0.9)]"
                onClick={() => setSheet("OUT")}
              >
                YOU GAVE ₹
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                className="h-11 rounded-xl bg-[#0E9E76] text-[14.5px] font-bold tracking-wide text-white shadow-[0_8px_18px_-10px_rgba(14,158,118,0.9)]"
                onClick={() => setSheet("IN")}
              >
                YOU GOT ₹
              </motion.button>
            </div>,
            document.body,
          )}
        </>
      ) : null}

      <AnimatePresence>
        {sheet === "IN" || sheet === "OUT" ? (
          <EntrySheet
            key="entry"
            book={book}
            kind={sheet}
            balance={data.balance}
            onClose={() => setSheet(null)}
            onSaved={async (entry) => {
              setSheet(null);
              setBurst({
                label: entry.kind === "IN" ? "Money in" : "Money out",
                sublabel: `${entry.kind === "IN" ? "+" : "−"}${formatRupees(entry.amount)} · ${meta.title}`,
                color: entry.kind === "IN" ? "#10B981" : "#E5484D",
              });
              setFreshId(entry.id);
              await load();
            }}
          />
        ) : null}
        {sheet === "opening" && data.opening ? (
          <OpeningSheet
            key="opening"
            book={book}
            current={data.opening.amount}
            onClose={() => setSheet(null)}
            onSaved={async () => {
              setSheet(null);
              setBurst({ label: "Opening balance saved", color: "#10B981" });
              await load();
            }}
          />
        ) : null}
        {removing ? (
          <DeleteSheet
            key="delete"
            entry={removing}
            onClose={() => setRemoving(null)}
            onDeleted={async () => {
              setRemoving(null);
              await load();
            }}
          />
        ) : null}
        {burst ? <SuccessBurst key="burst" {...burst} onDone={() => setBurst(null)} /> : null}
      </AnimatePresence>
    </div>
  );
}

function EntryRow({ entry, fresh, onOpen }: { entry: Entry; fresh: boolean; onOpen: () => void }) {
  const got = entry.kind !== "OUT";
  const title =
    entry.kind === "OPENING" ? "Opening balance" : entry.category || (got ? "Money in" : "Money out");
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(entry.createdAt));
  return (
    <button
      type="button"
      className={clsx(
        "flex w-full items-center gap-2.5 border-b border-[#EEF1F5] px-3 py-2.5 text-left transition last:border-b-0 hover:bg-ink-900/[0.02] active:bg-ink-900/[0.05] dark:border-[rgb(var(--color-line))]",
        fresh && "money-row-new",
      )}
      onClick={onOpen}
    >
      <span
        className={clsx(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full",
          entry.kind === "OPENING"
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
            : got
              ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
              : "bg-rose-500/12 text-rose-600 dark:text-rose-400",
        )}
        aria-hidden
      >
        {entry.kind === "OPENING" ? (
          <Wallet className="h-4 w-4" />
        ) : got ? (
          <ArrowDownLeft className="h-4 w-4" strokeWidth={2.6} />
        ) : (
          <ArrowUpRight className="h-4 w-4" strokeWidth={2.6} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold text-ink-900">{title}</span>
        <span className="block truncate text-[11.5px] text-ink-400">
          {[entry.note, entry.kind === "OPENING" ? null : time].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={clsx(
            "block text-[14px] font-bold tabular-nums",
            entry.kind === "OPENING"
              ? "text-ink-900"
              : got
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
          )}
        >
          {entry.kind === "OPENING" ? "" : got ? "+" : "−"}
          {formatRupees(entry.amount)}
        </span>
        <span className="block text-[10.5px] font-semibold tabular-nums text-ink-400">
          Bal {formatRupees(entry.balanceAfter)}
        </span>
      </span>
    </button>
  );
}

/** First time on a book: how much is in it right now? (or skip = ₹0) */
function OpeningSetup({
  book,
  onSaved,
}: {
  book: Book;
  onSaved: (amount: number) => void | Promise<void>;
}) {
  const meta = BOOK_META[book];
  const BookIcon = book === "cash" ? Wallet : Smartphone;
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = amount.trim() === "" ? null : Number(amount);

  async function save(start: number) {
    if (!Number.isFinite(start) || start < 0) {
      setError("Enter the cash you have now");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.setOpening(book, round2(start), todayIST());
      await onSaved(round2(start));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <BackLink to="/analytics" className="mb-3">
        Back to analytics
      </BackLink>
      <motion.section
        className="relative overflow-hidden rounded-[1.5rem] px-5 pb-6 pt-8 text-center text-white shadow-lift"
        style={{ background: meta.gradient }}
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }}
      >
        <HeroSparkles />
        {/* Wallet with rings pulsing out and coins floating around it */}
        <div className="relative mx-auto mb-5 h-28 w-28">
          <span className="money-ring" style={{ borderColor: meta.ring }} />
          <span className="money-ring" style={{ animationDelay: "0.9s", borderColor: meta.ring }} />
          <span className="money-ring" style={{ animationDelay: "1.8s", borderColor: meta.ring }} />
          {[
            { left: "-14px", top: "8px", delay: "0s", size: 22 },
            { right: "-12px", top: "22px", delay: "0.8s", size: 18 },
            { left: "6px", bottom: "-6px", delay: "1.6s", size: 16 },
            { right: "4px", bottom: "-10px", delay: "2.2s", size: 20 },
          ].map((coin, i) => (
            <span
              key={i}
              className="money-coin grid place-items-center rounded-full text-[10px] font-black text-[#7A5A00]"
              style={{
                ...coin,
                width: coin.size,
                height: coin.size,
                animationDelay: coin.delay,
                background: "radial-gradient(circle at 35% 30%, #FFF3B0, #FFC93C 55%, #E0A100)",
                boxShadow: "0 4px 10px rgba(255,201,60,.45)",
              }}
              aria-hidden
            >
              ₹
            </span>
          ))}
          <motion.div
            className="relative grid h-28 w-28 place-items-center rounded-[2rem]"
            style={{
              background: meta.startIcon,
              boxShadow: `0 20px 40px -12px ${meta.startGlow}`,
            }}
            initial={{ rotate: -12, scale: 0.6 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.15 }}
          >
            <BookIcon className="h-12 w-12" strokeWidth={1.8} />
          </motion.div>
        </div>
        <motion.h1
          className="relative font-display text-2xl font-bold"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          {meta.startTitle}
        </motion.h1>
        <motion.p
          className="relative mt-1 text-[14px] text-white/75"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {meta.startQuestion}
        </motion.p>
        <motion.label
          htmlFor="opening-amount"
          className="relative mx-auto mt-5 flex max-w-[16rem] items-center justify-center gap-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur focus-within:border-white/60"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <span className="font-display text-3xl font-bold" style={{ color: meta.accent }}>
            ₹
          </span>
          <input
            id="opening-amount"
            className="w-full min-w-0 bg-transparent text-center font-display text-3xl font-bold tabular-nums text-white outline-none placeholder:text-white/30"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError(null);
            }}
          />
        </motion.label>
        {error ? <p className="relative mt-3 text-sm font-semibold text-orange-300">{error}</p> : null}
        <motion.button
          type="button"
          className={clsx(
            "relative mt-5 h-12 w-full max-w-[16rem] rounded-2xl bg-gradient-to-r text-[15px] font-bold disabled:opacity-60",
            meta.startButton,
          )}
          style={{ boxShadow: `0 12px 26px -12px ${meta.startGlow}` }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          whileTap={{ scale: 0.95 }}
          disabled={saving || value === null || value < 0}
          onClick={() => void save(value ?? 0)}
        >
          {saving ? "Starting…" : value ? `Start with ${formatRupees(value)}` : "Start"}
        </motion.button>
        <button
          type="button"
          className="relative mx-auto mt-3 block rounded-full border border-white/15 px-4 py-1.5 text-[13px] font-semibold text-white/75 transition hover:border-white/30 hover:text-white"
          disabled={saving}
          onClick={() => void save(0)}
        >
          Skip for now · start at ₹0
        </button>
      </motion.section>
      <p className="mt-3 px-2 text-center text-[12px] text-ink-500">
        You can set or change the opening balance later from the top of the book.
      </p>
    </div>
  );
}

function EntrySheet({
  book,
  kind,
  balance,
  onClose,
  onSaved,
}: {
  book: Book;
  kind: "IN" | "OUT";
  balance: number;
  onClose: () => void;
  onSaved: (entry: { id: string; kind: "IN" | "OUT"; amount: number }) => void | Promise<void>;
}) {
  const got = kind === "IN";
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [day, setDay] = useState(todayIST);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = amount.trim() === "" ? null : Number(amount);
  const after = value !== null && value > 0 ? round2(balance + (got ? value : -value)) : null;

  async function save() {
    if (value === null || !Number.isFinite(value) || value <= 0) {
      setError("Enter the amount");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.addMoneyEntry(book, {
        kind,
        amount: round2(value),
        category: reason,
        note: note.trim() || null,
        date: day,
      });
      await onSaved({ id: data.id, kind, amount: data.amount });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="money-entry-title" busy={saving} onClose={onClose} place="top">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p
            className={clsx(
              "text-[10.5px] font-bold uppercase tracking-[0.14em]",
              got ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
            )}
          >
            {got ? "You got" : "You gave"}
          </p>
          <h2 id="money-entry-title" className="font-display text-[17px] font-bold text-ink-900">
            {BOOK_META[book].title}
            <span className="ml-1.5 text-[13px] font-semibold text-ink-400">
              · Bal <span className="tabular-nums">{formatRupees(balance)}</span>
            </span>
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
        id="money-entry-amount"
        value={amount}
        tone={got ? "got" : "gave"}
        trailing={<EntryDateIcon value={day} onChange={setDay} prefix={got ? "Got on" : "Gave on"} tone={got ? "got" : "gave"} />}
        onChange={(next) => {
          setAmount(next);
          setError(null);
        }}
      />
      <p className="mt-1.5 min-h-[18px] text-xs font-medium text-ink-500">
        {after !== null ? (
          <>
            Balance becomes <b className="tabular-nums text-ink-900">{formatRupees(after)}</b>
          </>
        ) : null}
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {MONEY_REASONS[kind].map((option) => {
          const on = reason === option;
          return (
            <motion.button
              key={option}
              type="button"
              whileTap={{ scale: 0.92 }}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition",
                on
                  ? got
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                  : "border-ink-100 bg-white text-ink-600 dark:border-[rgb(var(--color-line))] dark:bg-surface-elevated",
              )}
              onClick={() => setReason(on ? null : option)}
            >
              {option}
            </motion.button>
          );
        })}
      </div>
      <input
        className="field sheet-field mt-2"
        autoComplete="off"
        maxLength={200}
        placeholder="Note (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <ErrorNote error={error} />
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        className={clsx(
          "mt-3 h-12 w-full rounded-2xl text-[15px] font-bold text-white transition disabled:opacity-60",
          got ? "bg-[#0E9E76] hover:bg-[#0C8C69]" : "bg-[#D93A3F] hover:bg-[#C5333A]",
        )}
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : value && value > 0 ? `Save ${formatRupees(value)}` : "Save"}
      </motion.button>
    </Sheet>
  );
}

function OpeningSheet({
  book,
  current,
  onClose,
  onSaved,
}: {
  book: Book;
  current: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState(current > 0 ? String(current) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(value) || value < 0) {
      setError("Enter the opening cash");
      return;
    }
    setSaving(true);
    try {
      await api.setOpening(book, round2(value));
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="opening-title" busy={saving} onClose={onClose} place="top">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
        {BOOK_META[book].title}
      </p>
      <h2 id="opening-title" className="mb-2.5 font-display text-[17px] font-bold text-ink-900">
        Opening balance
      </h2>
      <AmountField
        id="opening-edit"
        value={amount}
        tone="got"
        onChange={(next) => setAmount(next)}
      />
      <p className="mt-1.5 text-xs text-ink-500">
        {book === "cash" ? "The cash you had" : "The online / bank balance you had"} when the book started.
      </p>
      <ErrorNote error={error} />
      <button
        type="button"
        className="mt-3 h-12 w-full rounded-2xl bg-[#0E9E76] text-[15px] font-bold text-white transition hover:bg-[#0C8C69] disabled:opacity-60"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </Sheet>
  );
}

/** Tap an entry: see it, delete it. */
export function DeleteSheet({
  entry,
  title,
  onClose,
  onDeleted,
}: {
  entry: { id: string; amount: number; kind: string; note: string | null; category: string | null; date: string };
  title?: string;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const day = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(entry.date));

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await api.deleteMoneyEntry(entry.id);
      await onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="delete-entry-title" busy={saving} onClose={onClose}>
      <div className="mb-3 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
          <Trash2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 id="delete-entry-title" className="font-display text-lg font-bold text-ink-900">
            Delete this entry?
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {formatRupees(entry.amount)} · {title || entry.category || (entry.kind === "IN" ? "Money in" : "Money out")} · {day}
          </p>
          {entry.note ? <p className="mt-0.5 text-sm italic text-ink-500">“{entry.note}”</p> : null}
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary !py-2.5" onClick={onClose} disabled={saving}>
          Keep it
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-60"
          onClick={() => void remove()}
          disabled={saving}
        >
          <Trash2 className="h-4 w-4" />
          {saving ? "Deleting…" : "Delete"}
        </button>
      </div>
    </Sheet>
  );
}
