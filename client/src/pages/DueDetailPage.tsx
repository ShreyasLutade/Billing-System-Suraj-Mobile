import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Download,
  Lock,
  Phone,
  Undo2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { useFixedBottomBar } from "../hooks/useFixedBottomBar";
import { EmptyState, LoadingBlock, BackLink } from "../components/ui";
import { WhatsAppIcon } from "../components/WhatsAppIcon";
import { api, formatINR, round2 } from "../lib/api";
import { formatRupees, initials, URGENCY_TONE, type DueUrgency } from "../lib/dueStatus";
import { dueReminderLink } from "../lib/dueReminder";
import { backLabel, fromState, readFromState } from "../lib/navMemory";
import type { CustomerDueDetail } from "../types";

type Entry = CustomerDueDetail["entries"][number];

function formatDate(value: string | null, withYear = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(date);
}

/** "12 Oct" this year, "12 Oct 2025" otherwise. */
function shortDate(value: string) {
  const sameYear =
    new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric" }) ===
    new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric" });
  return formatDate(value, !sameYear);
}

/** IST date for an <input type="date"> (YYYY-MM-DD). */
function inputDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function lateText(days: number | null) {
  if (days === null || days <= 0) return null;
  return `${days}d late`;
}

export function DueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const from = readFromState(location.state);
  const { isAdmin } = useAuth();
  const [data, setData] = useState<CustomerDueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sheet, setSheet] = useState<"got" | "gave" | "date" | null>(null);
  /** Latest entry the admin is about to undo (confirm sheet open). */
  const [undoing, setUndoing] = useState<Entry | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const showBar = Boolean(isAdmin && data);
  // You gave / You got stay stuck at the bottom (above the phone nav), measured.
  const bar = useFixedBottomBar(rootRef, barRef, showBar);

  // Lift the scroll-to-top button above the bar (same as the Add stock button).
  useEffect(() => {
    if (!showBar) return;
    document.body.classList.add("has-fab");
    return () => document.body.classList.remove("has-fab");
  }, [showBar]);

  async function load() {
    if (!id) return;
    try {
      const { data: detail } = await api.getCustomerDue(id);
      setData(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load due");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
  }, [id]);

  async function downloadStatement() {
    if (!id) return;
    setDownloading(true);
    setError(null);
    try {
      await api.downloadDueStatement(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download statement");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <LoadingBlock label="Loading due…" />;
  if (!data) {
    return (
      <div className="space-y-3">
        <BackLink to={from ?? "/dues"} className="mb-4">
          {from ? backLabel(from) : "Back to dues"}
        </BackLink>
        <EmptyState title="Due not found" description={error || "This bill does not exist."} />
      </div>
    );
  }

  const late = !data.settled && data.delayDays !== null && data.delayDays > 0;
  const urgency: DueUrgency = data.settled
    ? "upcoming"
    : late
      ? "overdue"
      : data.delayDays === 0
        ? "today"
        : data.delayDays === null
          ? "none"
          : "upcoming";
  const tone = URGENCY_TONE[urgency];
  const products = data.products.map((p) => p.label).filter(Boolean);
  const productSummary = products.length
    ? `${products[0]}${products.length > 1 ? ` +${products.length - 1} more` : ""}`
    : null;
  const newestFirst = [...data.entries].reverse();
  // Only the newest "You gave" / "You got" can be undone (never the bill).
  const undoableId = newestFirst[0]?.kind !== "bill" ? newestFirst[0]?.id : null;
  const backText = from ? backLabel(from) : "Back to dues";
  const reminder = data.settled
    ? null
    : dueReminderLink({
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        dueAmount: data.pending,
        productLabels: products,
      });
  const gotCount = data.entries.filter((e) => e.kind === "got").length;
  const gaveCount = data.entries.filter((e) => e.kind === "gave").length;

  const dateLine = data.settled
    ? data.settledAt
      ? `Cleared on ${formatDate(data.settledAt)}`
      : "Nothing pending"
    : data.dueDate
      ? `Collect by ${formatDate(data.dueDate)}`
      : "No collect-by date";
  const dateStatus = data.settled
    ? null
    : late
      ? `${data.delayDays} day${data.delayDays === 1 ? "" : "s"} late`
      : data.delayDays === 0
        ? "due today"
        : data.delayDays !== null
          ? `in ${-data.delayDays} day${data.delayDays === -1 ? "" : "s"}`
          : null;

  const actions: Array<{
    key: string;
    label: string;
    icon: ReactNode;
    href?: string;
    onClick?: () => void;
    disabled?: boolean;
    busy?: boolean;
    className?: string;
  }> = [
    {
      key: "call",
      label: "Call",
      icon: <Phone className="h-[15px] w-[15px]" />,
      href: `tel:${data.customerPhone}`,
    },
    {
      key: "remind",
      label: "Remind",
      icon: <WhatsAppIcon className="h-[15px] w-[15px]" />,
      href: reminder ?? undefined,
      disabled: !reminder,
      className: "text-[#1DA851] dark:text-[#3BD07A]",
    },
    ...(isAdmin
      ? [
          {
            key: "date",
            label: "Date",
            icon: <CalendarDays className="h-[15px] w-[15px]" />,
            onClick: () => setSheet("date"),
            disabled: data.settled,
          },
        ]
      : []),
    {
      key: "pdf",
      label: "PDF",
      icon: <Download className="h-[15px] w-[15px]" />,
      onClick: () => void downloadStatement(),
      busy: downloading,
    },
  ];

  return (
    <div ref={rootRef} className="mx-auto max-w-2xl pb-4">
      {/* Back · customer · private */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <Link
          to={from ?? "/dues"}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#E7EAF0] bg-white text-ink-900 shadow-sm transition hover:border-ink-300 dark:border-[rgb(var(--color-line))] dark:bg-surface"
          aria-label={backText}
          title={backText}
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Link>
        <div
          className={clsx(
            "grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-bold",
            tone.avatar,
          )}
          aria-hidden
        >
          {initials(data.customerName)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[17px] font-bold leading-tight tracking-tight text-ink-900">
            {data.customerName}
          </h1>
          <p className="mt-px flex items-center gap-1.5 text-[12.5px] text-ink-400">
            <span className="tabular-nums">{data.customerPhone}</span>
            {isAdmin && data.duePrivate ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-900/[0.07] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-ink-700 dark:bg-white/10 dark:text-ink-800">
                <Lock className="h-2.5 w-2.5" strokeWidth={2.6} />
                Private
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* Balance + quick actions */}
      <section className="due-card px-3.5 pb-3 pt-3.5">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: tone.accent }} aria-hidden />
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-400">
          {data.settled ? "Settled" : "You will get"}
        </p>
        <p
          className={clsx(
            "mt-px font-display text-[26px] font-bold leading-tight tracking-tight tabular-nums",
            data.settled
              ? "text-emerald-600 dark:text-emerald-400"
              : late
                ? "text-rose-600 dark:text-rose-400"
                : "text-ink-900",
          )}
        >
          {data.settled ? "Fully paid" : formatRupees(data.pending)}
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          {dateLine}
          {dateStatus ? (
            <>
              {" · "}
              <b
                className={clsx(
                  "font-bold",
                  late
                    ? "text-rose-600 dark:text-rose-400"
                    : data.delayDays === 0
                      ? "text-amber-600 dark:text-amber-300"
                      : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {dateStatus}
              </b>
            </>
          ) : null}
        </p>

        <div
          className="mt-2.5 grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}
        >
          {actions.map((action) => {
            const cls = clsx(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-ink-900/[0.045] text-[12px] font-bold text-ink-700 transition hover:bg-ink-900/[0.08] dark:bg-white/[0.06] dark:text-ink-800 dark:hover:bg-white/10",
              action.disabled && "pointer-events-none opacity-40",
              action.className,
            );
            const inner = (
              <>
                {action.busy ? (
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-tide-500" />
                ) : (
                  action.icon
                )}
                {action.label}
              </>
            );
            return action.href ? (
              <a
                key={action.key}
                href={action.href}
                className={cls}
                aria-disabled={action.disabled || undefined}
                {...(action.key === "remind" ? { target: "_blank", rel: "noreferrer" } : {})}
              >
                {inner}
              </a>
            ) : (
              <button
                key={action.key}
                type="button"
                className={cls}
                disabled={action.disabled || action.busy}
                onClick={action.onClick}
              >
                {inner}
              </button>
            );
          })}
        </div>
      </section>

      {/* Entries, newest first, ending with the bill */}
      <div className="mb-1.5 mt-4 flex items-center justify-between gap-3 px-1">
        <h2 className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-400">Entries</h2>
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">
          {[
            "1 bill",
            gaveCount ? `${gaveCount} given` : null,
            `${gotCount} payment${gotCount === 1 ? "" : "s"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="due-card overflow-hidden !p-0">
        <div className="grid grid-cols-[minmax(0,1fr)_84px_84px] border-b border-[#EEF1F5] bg-ink-900/[0.025] text-[10px] font-bold uppercase tracking-[0.08em] text-ink-400 dark:border-[rgb(var(--color-line))] dark:bg-white/[0.03]">
          <span className="px-3 py-2">Entry</span>
          <span className="px-3 py-2 text-right">You gave</span>
          <span className="px-3 py-2 text-right">You got</span>
        </div>
        <ol>
          {newestFirst.map((entry) => (
            <EntryRow
              key={`${entry.kind}-${entry.id}`}
              entry={entry}
              due={data}
              productSummary={productSummary}
              billLink={
                <Link
                  to={`/bills/${data.id}`}
                  state={fromState(location)}
                  className="absolute inset-0 z-[1]"
                  aria-label={`Open bill ${data.invoiceNumber}`}
                />
              }
              onUndo={isAdmin && entry.id === undoableId ? () => setUndoing(entry) : undefined}
            />
          ))}
        </ol>
      </div>

      {showBar ? (
        <>
          {/* Room so the last rows aren't hidden behind the fixed bar. */}
          <div aria-hidden style={{ height: bar.height + 8 }} />
          {/* On <body> so "fixed" means the screen, not a page wrapper. */}
          {createPortal(
            <div
              ref={barRef}
              className={clsx(
                "fixed z-30 grid grid-cols-2 gap-2",
                // Hidden (not unmounted) under a sheet so its size stays measured.
                (sheet || undoing) && "invisible",
                bar.mobile &&
                  "border-t border-ink-100/80 bg-white/95 px-3 py-2 backdrop-blur dark:bg-surface-elevated/95",
              )}
              style={
                bar.mobile
                  ? { left: 0, right: 0, bottom: bar.bottom }
                  : { left: bar.left, width: bar.width, bottom: 16 }
              }
            >
              <button
                type="button"
                className="h-11 rounded-xl bg-[#D93A3F] text-[14.5px] font-bold tracking-wide text-white shadow-[0_8px_18px_-10px_rgba(217,58,63,0.9)] transition hover:bg-[#C5333A]"
                onClick={() => setSheet("gave")}
              >
                YOU GAVE ₹
              </button>
              <button
                type="button"
                className="h-11 rounded-xl bg-[#0E9E76] text-[14.5px] font-bold tracking-wide text-white shadow-[0_8px_18px_-10px_rgba(14,158,118,0.9)] transition hover:bg-[#0C8C69] disabled:opacity-45 disabled:shadow-none"
                disabled={data.settled}
                onClick={() => setSheet("got")}
              >
                YOU GOT ₹
              </button>
            </div>,
            document.body,
          )}
        </>
      ) : null}

      <AnimatePresence>
        {sheet === "got" && isAdmin ? (
          <GotSheet
            due={data}
            onClose={() => setSheet(null)}
            onSaved={async () => {
              setSheet(null);
              await load();
            }}
          />
        ) : null}
        {sheet === "gave" && isAdmin ? (
          <GaveSheet
            due={data}
            onClose={() => setSheet(null)}
            onSaved={(updated) => {
              setSheet(null);
              setData(updated);
            }}
          />
        ) : null}
        {sheet === "date" && isAdmin ? (
          <DateSheet
            due={data}
            onClose={() => setSheet(null)}
            onSaved={(updated) => {
              setSheet(null);
              setData(updated);
            }}
          />
        ) : null}
        {undoing && isAdmin ? (
          <UndoSheet
            due={data}
            entry={undoing}
            onClose={() => setUndoing(null)}
            onUndone={(updated) => {
              setUndoing(null);
              setData(updated);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** One ledger row: what it was, and the amount under You gave or You got. */
function EntryRow({
  entry,
  due,
  productSummary,
  billLink,
  onUndo,
}: {
  entry: Entry;
  due: CustomerDueDetail;
  productSummary: string | null;
  billLink: ReactNode;
  onUndo?: () => void;
}) {
  const isBill = entry.kind === "bill";
  const gave = entry.kind !== "got";
  const late = entry.kind === "got" ? lateText(entry.delayDays) : null;
  const title = isBill
    ? due.invoiceNumber
    : entry.kind === "gave"
      ? "Given"
      : entry.method === "na" || !entry.methodLabel
        ? "Payment"
        : entry.methodLabel;
  const detail = isBill ? productSummary : entry.note;

  return (
    <li
      className={clsx(
        "relative grid grid-cols-[minmax(0,1fr)_84px_84px] border-b border-[#EEF1F5] last:border-b-0 dark:border-[rgb(var(--color-line))]",
        isBill && "transition hover:bg-tide-500/[0.04] active:bg-tide-500/[0.07]",
      )}
    >
      {isBill ? billLink : null}
      <div className="min-w-0 px-3 py-2">
        <p className="flex items-center gap-1 text-[12.5px] font-semibold text-ink-900">
          <span className="shrink-0 text-ink-500">{shortDate(entry.date)} ·</span>
          <span
            className={clsx(
              "truncate",
              isBill && "font-mono font-bold text-tide-600 dark:text-tide-400",
            )}
          >
            {title}
          </span>
          {isBill ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-tide-600 dark:text-tide-400" strokeWidth={2.6} />
          ) : null}
        </p>
        {detail ? <p className="truncate text-[11px] text-ink-500">{detail}</p> : null}
        <p className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-ink-400">
          {isBill ? <span>Bill {formatRupees(due.billTotal)} ·</span> : null}
          <span>
            Bal{" "}
            <span className="font-semibold tabular-nums text-ink-500">
              {formatRupees(entry.balanceAfter)}
            </span>
          </span>
          {late ? <b className="font-bold text-rose-600 dark:text-rose-400">· {late}</b> : null}
          {onUndo ? (
            <button
              type="button"
              className="relative z-[2] ml-auto inline-flex items-center gap-0.5 rounded-md px-1 py-px text-[10.5px] font-bold text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-400"
              onClick={onUndo}
            >
              <Undo2 className="h-3 w-3" strokeWidth={2.6} />
              Undo
            </button>
          ) : null}
        </p>
      </div>
      <div
        className={clsx(
          "px-3 py-2 text-right text-[13px] font-bold tabular-nums",
          gave && "bg-rose-500/[0.05] text-rose-600 dark:bg-rose-500/[0.08] dark:text-rose-400",
        )}
      >
        {gave ? formatRupees(entry.amount) : ""}
      </div>
      <div
        className={clsx(
          "px-3 py-2 text-right text-[13px] font-bold tabular-nums",
          !gave &&
            "bg-emerald-500/[0.06] text-emerald-600 dark:bg-emerald-500/[0.08] dark:text-emerald-400",
        )}
      >
        {!gave ? formatRupees(entry.amount) : ""}
      </div>
    </li>
  );
}

/** Bottom sheet frame shared by the You gave / You got / Date / Undo sheets. */
function Sheet({
  labelledBy,
  busy,
  onClose,
  children,
}: {
  labelledBy: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !busy && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-5 shadow-lift dark:border-white/10 dark:bg-surface-elevated"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function SheetHeader({
  id,
  eyebrow,
  eyebrowClass,
  due,
  busy,
  onClose,
}: {
  id: string;
  eyebrow: string;
  eyebrowClass: string;
  due: CustomerDueDetail;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className={clsx("text-[11px] font-bold uppercase tracking-[0.14em]", eyebrowClass)}>{eyebrow}</p>
        <h2 id={id} className="mt-0.5 truncate font-display text-lg font-bold text-ink-900">
          {due.customerName}
        </h2>
        <p className="text-sm text-ink-500">
          Balance{" "}
          <span className="font-semibold tabular-nums text-ink-900">{formatRupees(due.pending)}</span>
        </p>
      </div>
      <button
        type="button"
        className="rounded-xl p-2 text-ink-500 hover:bg-ink-50 dark:hover:bg-white/10"
        onClick={onClose}
        disabled={busy}
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="mt-3 rounded-2xl bg-orange-50 px-4 py-3 text-sm text-ember-500 dark:bg-orange-500/10">
      {error}
    </p>
  );
}

function AmountField({
  id,
  value,
  onChange,
  tone,
  invalid,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  tone: "gave" | "got";
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={clsx(
        "flex items-center gap-1.5 rounded-2xl border-[1.5px] bg-white px-3.5 py-2 dark:bg-surface",
        invalid
          ? "border-rose-500"
          : tone === "gave"
            ? "border-rose-400/80 focus-within:border-rose-500"
            : "border-emerald-500/80 focus-within:border-emerald-500",
      )}
    >
      <span className="font-display text-2xl font-bold text-ink-400">₹</span>
      <input
        id={id}
        className="w-full min-w-0 bg-transparent font-display text-2xl font-bold tabular-nums text-ink-900 outline-none placeholder:text-ink-300"
        type="number"
        inputMode="decimal"
        min={0.01}
        step="0.01"
        value={value}
        autoFocus
        placeholder={placeholder ?? "0"}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

type PayMethod = "cash" | "online" | "na";

const METHODS: Array<{ value: PayMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online" },
  { value: "na", label: "N/A" },
];

/** "You got": amount + Cash / Online / N/A, up to what's pending. */
function GotSheet({
  due,
  onClose,
  onSaved,
}: {
  due: CustomerDueDetail;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = amount.trim() === "" ? null : Number(amount);
  const tooMuch = value !== null && value > due.pending + 0.005;
  const left = value !== null && !tooMuch && value > 0 ? round2(due.pending - value) : null;

  async function save() {
    if (value === null || !Number.isFinite(value) || value <= 0) {
      setError("Enter the amount you got");
      return;
    }
    if (tooMuch) {
      setError(`Amount can't be more than the pending ${formatINR(due.pending)}`);
      return;
    }
    if (!method) {
      setError("Select Cash, Online or N/A");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const paid = round2(value);
      await api.settleDue(due.id, {
        mode: paid >= due.pending ? "full" : "custom",
        method,
        amount: paid,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save payment");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="due-got-title" busy={saving} onClose={onClose}>
      <SheetHeader
        id="due-got-title"
        eyebrow="You got"
        eyebrowClass="text-emerald-600 dark:text-emerald-400"
        due={due}
        busy={saving}
        onClose={onClose}
      />
      <AmountField
        id="due-got-amount"
        value={amount}
        tone="got"
        invalid={tooMuch}
        placeholder={String(round2(due.pending))}
        onChange={(next) => {
          setAmount(next);
          setError(null);
        }}
      />
      <p
        className={clsx(
          "mt-1.5 min-h-[18px] text-xs font-medium",
          tooMuch ? "text-rose-600" : "text-ink-500",
        )}
      >
        {tooMuch
          ? `More than the pending ${formatINR(due.pending)}`
          : left === null
            ? ""
            : left > 0
              ? `${formatINR(left)} will still be pending`
              : "Due will be fully cleared"}
      </p>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {METHODS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={clsx(
              "rounded-xl border px-3 py-2.5 text-sm font-bold transition",
              method === option.value
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-ink-100 bg-white text-ink-700 hover:border-ink-300 dark:border-[rgb(var(--color-line))] dark:bg-surface-elevated",
            )}
            onClick={() => {
              setMethod(option.value);
              setError(null);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <ErrorNote error={error} />

      <button
        type="button"
        className="mt-4 h-12 w-full rounded-2xl bg-[#0E9E76] text-[15px] font-bold text-white transition hover:bg-[#0C8C69] disabled:opacity-60"
        disabled={saving || tooMuch}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : value && value > 0 && !tooMuch ? `Save ${formatRupees(value)}` : "Save"}
      </button>
    </Sheet>
  );
}

/** "You gave": money given / an amount added without a new bill. */
function GaveSheet({
  due,
  onClose,
  onSaved,
}: {
  due: CustomerDueDetail;
  onClose: () => void;
  onSaved: (updated: CustomerDueDetail) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState(inputDate(due.settled ? null : due.dueDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = amount.trim() === "" ? null : Number(amount);
  const after = value !== null && value > 0 ? round2(due.pending + value) : null;

  async function save() {
    if (value === null || !Number.isFinite(value) || value <= 0) {
      setError("Enter the amount you gave");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: updated } = await api.addDueCharge(due.id, {
        amount: round2(value),
        note: note.trim() || null,
        dueDate: dueDate || null,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="due-gave-title" busy={saving} onClose={onClose}>
      <SheetHeader
        id="due-gave-title"
        eyebrow="You gave"
        eyebrowClass="text-rose-600 dark:text-rose-400"
        due={due}
        busy={saving}
        onClose={onClose}
      />
      <AmountField
        id="due-gave-amount"
        value={amount}
        tone="gave"
        onChange={(next) => {
          setAmount(next);
          setError(null);
        }}
      />
      <p className="mt-1.5 min-h-[18px] text-xs font-medium text-ink-500">
        {after !== null ? (
          <>
            Balance becomes{" "}
            <b className="tabular-nums text-rose-600 dark:text-rose-400">{formatRupees(after)}</b>
          </>
        ) : (
          "Cash given, repair, old balance… added to what he owes"
        )}
      </p>

      <label className="label mt-2" htmlFor="due-gave-note">
        Note
      </label>
      <input
        id="due-gave-note"
        className="field"
        maxLength={200}
        value={note}
        placeholder="e.g. Cash lent, old balance"
        onChange={(event) => setNote(event.target.value)}
      />

      <label className="label mt-3" htmlFor="due-gave-date">
        Collect by (optional)
      </label>
      <input
        id="due-gave-date"
        className="field"
        type="date"
        value={dueDate}
        onChange={(event) => setDueDate(event.target.value)}
      />

      <ErrorNote error={error} />

      <button
        type="button"
        className="mt-4 h-12 w-full rounded-2xl bg-[#D93A3F] text-[15px] font-bold text-white transition hover:bg-[#C5333A] disabled:opacity-60"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : value && value > 0 ? `Save ${formatRupees(value)}` : "Save"}
      </button>
    </Sheet>
  );
}

/** Change or clear the collect-by (promised) date. */
function DateSheet({
  due,
  onClose,
  onSaved,
}: {
  due: CustomerDueDetail;
  onClose: () => void;
  onSaved: (updated: CustomerDueDetail) => void;
}) {
  const [value, setValue] = useState(inputDate(due.dueDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    setSaving(true);
    setError(null);
    try {
      const { data: updated } = await api.setDueDate(due.id, next);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the date");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="due-date-title" busy={saving} onClose={onClose}>
      <SheetHeader
        id="due-date-title"
        eyebrow="Collect by"
        eyebrowClass="text-tide-600 dark:text-tide-400"
        due={due}
        busy={saving}
        onClose={onClose}
      />
      <input
        className="field"
        type="date"
        value={value}
        aria-label="Collect by date"
        onChange={(event) => setValue(event.target.value)}
      />
      <ErrorNote error={error} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn-secondary !py-2.5"
          disabled={saving || !due.dueDate}
          onClick={() => void save(null)}
        >
          Remove date
        </button>
        <button
          type="button"
          className="due-btn-dark h-11 rounded-2xl text-sm font-bold disabled:opacity-60"
          disabled={saving || !value}
          onClick={() => void save(value)}
        >
          {saving ? "Saving…" : "Save date"}
        </button>
      </div>
    </Sheet>
  );
}

/** "Undo this entry?" for the newest You gave / You got. */
function UndoSheet({
  due,
  entry,
  onClose,
  onUndone,
}: {
  due: CustomerDueDetail;
  entry: Entry;
  onClose: () => void;
  onUndone: (updated: CustomerDueDetail) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const got = entry.kind === "got";
  const pendingAfter = round2(Math.max(due.pending + (got ? entry.amount : -entry.amount), 0));
  const what = got
    ? `${formatRupees(entry.amount)} ${entry.method === "na" || !entry.methodLabel ? "payment" : entry.methodLabel.toLowerCase()} on ${formatDate(entry.date)}`
    : `${formatRupees(entry.amount)} given on ${formatDate(entry.date)}`;

  async function undo() {
    setSaving(true);
    setError(null);
    try {
      const { data: updated } = got
        ? await api.undoDuePayment(due.id, entry.id)
        : await api.undoDueCharge(due.id, entry.id);
      onUndone(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="undo-entry-title" busy={saving} onClose={onClose}>
      <div className="mb-3 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
          <Undo2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 id="undo-entry-title" className="font-display text-lg font-bold text-ink-900">
            {got ? "Undo this payment?" : "Undo this entry?"}
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {what}
            {got ? ` from ${due.customerName}` : ` to ${due.customerName}`}
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-ink-900/[0.04] px-3.5 py-2.5 text-sm dark:bg-white/5">
        <p className="flex items-center justify-between gap-2">
          <span className="text-ink-500">Balance now</span>
          <span className="font-semibold tabular-nums text-ink-900">{formatRupees(due.pending)}</span>
        </p>
        <p className="mt-1 flex items-center justify-between gap-2">
          <span className="text-ink-500">Balance after undo</span>
          <span
            className={clsx(
              "font-bold tabular-nums",
              got ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {formatRupees(pendingAfter)}
          </span>
        </p>
      </div>
      {got ? (
        <p className="mt-2 text-xs text-ink-500">
          The payment is removed from the entries and its amount comes off the bill's{" "}
          {entry.method === "na" || !entry.methodLabel ? "payments" : `${entry.methodLabel.toLowerCase()} total`}.
        </p>
      ) : null}

      <ErrorNote error={error} />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary !py-2.5" onClick={onClose} disabled={saving}>
          Keep it
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-60"
          onClick={() => void undo()}
          disabled={saving}
        >
          <Undo2 className="h-4 w-4" />
          {saving ? "Undoing…" : "Undo"}
        </button>
      </div>
    </Sheet>
  );
}
