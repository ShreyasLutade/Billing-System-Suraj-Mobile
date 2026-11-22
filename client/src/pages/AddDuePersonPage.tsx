import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, Phone, UserRound } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { api, round2 } from "../lib/api";
import { formatRupees } from "../lib/dueStatus";
import { EntryDateChip, todayIST } from "../components/EntryDateChip";

type Direction = "gave" | "got";
type Method = "cash" | "online" | "na";

const METHODS: Array<{ value: Method; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online" },
  { value: "na", label: "N/A" },
];

/** IST date (YYYY-MM-DD) `days` from today. */
function istDatePlus(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
}

const QUICK_DATES = [
  { label: "1 week", days: 7 },
  { label: "15 days", days: 15 },
  { label: "1 month", days: 30 },
];

const TONE = {
  gave: {
    text: "text-rose-600 dark:text-rose-400",
    ring: "focus-within:border-rose-500",
    button: "bg-[#D93A3F] hover:bg-[#C5333A] shadow-[0_10px_22px_-12px_rgba(217,58,63,0.95)]",
    glow: "rgba(229,72,77,0.16)",
  },
  got: {
    text: "text-emerald-600 dark:text-emerald-400",
    ring: "focus-within:border-emerald-500",
    button: "bg-[#0E9E76] hover:bg-[#0C8C69] shadow-[0_10px_22px_-12px_rgba(14,158,118,0.95)]",
    glow: "rgba(14,158,118,0.16)",
  },
} as const;

/**
 * Dues "+": add someone you gave money to, or who gave you money, without a
 * purchase. Saving morphs this card into their due page.
 */
export function AddDuePersonPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [direction, setDirection] = useState<Direction>("gave");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [entryDay, setEntryDay] = useState(todayIST);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [knownName, setKnownName] = useState<string | null>(null);
  const nameTouched = useRef(false);

  // Bought before? Fill the name from the number.
  useEffect(() => {
    setKnownName(null);
    if (phone.length !== 10) return;
    const controller = new AbortController();
    api
      .lookupCustomerByPhone(phone, { signal: controller.signal })
      .then(({ data }) => {
        if (!data?.customerName) return;
        setKnownName(data.customerName);
        if (!nameTouched.current || !name.trim()) setName(data.customerName);
      })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  if (!isAdmin) return <Navigate to="/dues" replace />;

  const tone = TONE[direction];
  const value = amount.trim() === "" ? null : Number(amount);
  const validAmount = value !== null && Number.isFinite(value) && value > 0;
  const who = name.trim().split(/\s+/)[0] || "They";
  const summary = validAmount
    ? direction === "gave"
      ? `${who} will owe you ${formatRupees(round2(value))}`
      : `You will owe ${name.trim() ? who : "them"} ${formatRupees(round2(value))}`
    : direction === "gave"
      ? "Money you gave: they pay you back"
      : "Money you got: you give it back";

  async function save() {
    if (!validAmount) {
      setError("Enter the amount");
      return;
    }
    if (phone.length !== 10) {
      setError("Enter a 10-digit mobile number");
      return;
    }
    if (!name.trim()) {
      setError("Enter the name");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.createDuePerson({
        customerName: name.trim(),
        customerPhone: phone,
        direction,
        amount: round2(value),
        method: direction === "got" ? method : undefined,
        note: note.trim() || null,
        dueDate: direction === "gave" && dueDate ? dueDate : null,
        entryDate: entryDay,
      });
      (document.activeElement as HTMLElement | null)?.blur?.();
      const go = () =>
        navigate(`/dues/${data.id}`, {
          replace: true,
          state: { from: "/dues", created: data },
        });
      // The amount card morphs into the due page's balance card.
      const doc = document as Document & {
        startViewTransition?: (update: () => void) => unknown;
      };
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (doc.startViewTransition && !reduce) {
        doc.startViewTransition(() => flushSync(go));
      } else {
        go();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl pb-6">
      <div className="mb-3 flex items-center gap-2.5">
        <Link
          to="/dues"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#E7EAF0] bg-white text-ink-900 shadow-sm transition hover:border-ink-300 dark:border-[rgb(var(--color-line))] dark:bg-surface"
          aria-label="Back to dues"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display text-[19px] font-bold leading-tight tracking-tight text-ink-900">
            Add to khata
          </h1>
          <p className="text-[12.5px] text-ink-500">Money given or received, no purchase</p>
        </div>
      </div>

      {/* Direction + amount (morphs into the due page's balance card) */}
      <section
        className="due-card relative overflow-hidden px-3.5 pb-3.5 pt-3"
        style={{ viewTransitionName: "due-hero" } as React.CSSProperties}
      >
        <motion.div
          className="pointer-events-none absolute inset-0"
          animate={{
            background: `radial-gradient(120% 80% at 50% 0%, ${tone.glow}, transparent 70%)`,
          }}
          transition={{ duration: 0.45 }}
          aria-hidden
        />
        <motion.div
          className="absolute inset-x-0 top-0 h-1"
          animate={{ background: direction === "gave" ? "#E5484D" : "#0E9E76" }}
          transition={{ duration: 0.35 }}
          aria-hidden
        />

        <div className="relative grid grid-cols-2 gap-1 rounded-2xl bg-ink-900/[0.05] p-1 dark:bg-white/[0.06]" role="tablist">
          {(
            [
              { value: "gave", label: "I gave", Icon: ArrowUpRight },
              { value: "got", label: "I got", Icon: ArrowDownLeft },
            ] as const
          ).map(({ value: option, label, Icon }) => {
            const on = direction === option;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={on}
                className={clsx(
                  "relative flex h-10 items-center justify-center gap-1.5 rounded-xl text-[14px] font-bold transition-colors",
                  on ? "text-white" : "text-ink-500 hover:text-ink-800",
                )}
                onClick={() => {
                  setDirection(option);
                  setError(null);
                }}
              >
                {on ? (
                  <motion.span
                    layoutId="khata-direction"
                    className={clsx(
                      "absolute inset-0 rounded-xl",
                      option === "gave" ? "bg-[#D93A3F]" : "bg-[#0E9E76]",
                    )}
                    transition={{ type: "spring", stiffness: 520, damping: 38 }}
                  />
                ) : null}
                <Icon className="relative h-4 w-4" strokeWidth={2.6} />
                <span className="relative">{label}</span>
              </button>
            );
          })}
        </div>

        <label
          htmlFor="khata-amount"
          className="relative mt-3 flex items-center gap-1.5 border-b-2 border-ink-900/10 pb-1 transition-colors dark:border-white/10"
        >
          <span className={clsx("font-display text-[30px] font-bold", tone.text)}>₹</span>
          <input
            id="khata-amount"
            className={clsx(
              "w-full min-w-0 bg-transparent font-display text-[30px] font-bold tabular-nums outline-none placeholder:text-ink-300",
              tone.text,
            )}
            type="number"
            inputMode="decimal"
            min={0.01}
            step="0.01"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError(null);
            }}
          />
        </label>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={`${direction}-${validAmount}`}
            className="relative mt-1.5 text-[12.5px] font-semibold text-ink-500"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {summary}
          </motion.p>
        </AnimatePresence>
        <div className="relative mt-2.5">
          <EntryDateChip
            value={entryDay}
            onChange={setEntryDay}
            prefix={direction === "gave" ? "Given on" : "Got on"}
            tone={direction}
          />
        </div>
      </section>

      {/* Person */}
      <div className="mt-3 space-y-2.5">
        <label className="block">
          <span className="mb-1 block px-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
            Mobile number
          </span>
          <span className="relative block">
            <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="field sheet-field !pl-10 tabular-nums"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              placeholder="10-digit number"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value.replace(/\D/g, "").slice(0, 10));
                setError(null);
              }}
            />
          </span>
          {knownName ? (
            <span className="mt-1 flex items-center gap-1 px-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" strokeWidth={2.8} />
              Bought before as {knownName}
            </span>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1 block px-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
            Name
          </span>
          <span className="relative block">
            <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="field sheet-field !pl-10"
              autoComplete="off"
              autoCapitalize="words"
              maxLength={80}
              placeholder="Customer name"
              value={name}
              onChange={(event) => {
                nameTouched.current = true;
                setName(event.target.value);
                setError(null);
              }}
            />
          </span>
        </label>

        <AnimatePresence mode="wait" initial={false}>
          {direction === "gave" ? (
            <motion.div
              key="gave"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <span className="mb-1 block px-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                Collect by (optional)
              </span>
              <div className="grid grid-cols-[repeat(3,auto)_minmax(0,1fr)] gap-1.5">
                {QUICK_DATES.map((option) => {
                  const date = istDatePlus(option.days);
                  const on = dueDate === date;
                  return (
                    <button
                      key={option.days}
                      type="button"
                      className={clsx(
                        "h-11 rounded-xl border px-2.5 text-[12.5px] font-bold transition",
                        on
                          ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                          : "border-ink-100 bg-white text-ink-600 hover:border-ink-300 dark:border-[rgb(var(--color-line))] dark:bg-surface-elevated",
                      )}
                      onClick={() => setDueDate(on ? "" : date)}
                    >
                      {option.label}
                    </button>
                  );
                })}
                <input
                  className="field sheet-field sheet-date"
                  type="date"
                  aria-label="Collect by date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="got"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <span className="mb-1 block px-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
                Received via
              </span>
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={clsx(
                      "h-11 rounded-xl border text-sm font-bold transition",
                      method === option.value
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "border-ink-100 bg-white text-ink-700 hover:border-ink-300 dark:border-[rgb(var(--color-line))] dark:bg-surface-elevated",
                    )}
                    onClick={() => setMethod(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <label className="block">
          <span className="mb-1 block px-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">
            Note (optional)
          </span>
          <input
            className="field sheet-field"
            autoComplete="off"
            maxLength={200}
            placeholder={direction === "gave" ? "e.g. Cash lent, old balance" : "e.g. Advance for a phone"}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p className="mt-3 rounded-2xl bg-orange-50 px-4 py-3 text-sm text-ember-500 dark:bg-orange-500/10">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className={clsx(
          "mt-4 h-12 w-full rounded-2xl text-[15px] font-bold text-white transition disabled:opacity-60",
          tone.button,
        )}
        disabled={saving}
        onClick={() => void save()}
      >
        {saving
          ? "Saving…"
          : validAmount
            ? `Save · ${direction === "gave" ? "I gave" : "I got"} ${formatRupees(round2(value))}`
            : "Save"}
      </button>
    </div>
  );
}
