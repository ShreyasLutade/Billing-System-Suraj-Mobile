import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BillPdfViewer } from "../components/BillPdfViewer";
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  CreditCard,
  Download,
  FileText,
  Lock,
  Phone,
  ShoppingBag,
  Smartphone,
  Undo2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { useFixedBottomBar } from "../hooks/useFixedBottomBar";
import { BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { api, formatINR, round2 } from "../lib/api";
import {
  formatRupees,
  initials,
  URGENCY_TONE,
  type DueUrgency,
} from "../lib/dueStatus";
import { backLabel, fromState, readFromState } from "../lib/navMemory";
import type { CustomerDueDetail } from "../types";

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

const METHOD_ICON: Record<string, LucideIcon> = {
  cash: Banknote,
  online: Smartphone,
  card: CreditCard,
};

function delayLabel(days: number | null) {
  if (days === null) return null;
  if (days <= 0) return "On time";
  return `${days} day${days === 1 ? "" : "s"} late`;
}

/** Red when late, green when on time. */
function DelayPill({ days, className }: { days: number | null; className?: string }) {
  const label = delayLabel(days);
  if (!label) return null;
  const late = days !== null && days > 0;
  const Icon = late ? CircleAlert : Check;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-bold",
        late
          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.4} />
      {label}
    </span>
  );
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
  const [paying, setPaying] = useState(false);
  const [viewingBill, setViewingBill] = useState(false);
  /** Latest payment the admin is about to undo (confirm sheet open). */
  const [undoing, setUndoing] = useState<CustomerDueDetail["payments"][number] | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const showPayBar = Boolean(isAdmin && data && !data.settled);
  // Mark paid stays stuck at the bottom (above the phone nav), measured.
  const bar = useFixedBottomBar(rootRef, barRef, showPayBar);

  // Lift the scroll-to-top button above the bar (same as the Add stock button).
  useEffect(() => {
    if (!showPayBar) return;
    document.body.classList.add("has-fab");
    return () => document.body.classList.remove("has-fab");
  }, [showPayBar]);

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

  const back = (
    <BackLink to={from ?? "/dues"} className="mb-4">
      {from ? backLabel(from) : "Back to dues"}
    </BackLink>
  );

  if (loading) return <LoadingBlock label="Loading due…" />;
  if (!data) {
    return (
      <div className="space-y-3">
        {back}
        <EmptyState title="Due not found" description={error || "This bill does not exist."} />
      </div>
    );
  }

  const late = data.delayDays !== null && data.delayDays > 0;
  const paidShare =
    data.originalDue > 0 ? Math.min(data.paidTotal / data.originalDue, 1) : 1;
  // Settled → green; late → red; due today → amber; otherwise by date.
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
  const statusLabel = late
    ? `${delayLabel(data.delayDays)}`
    : data.settled
      ? data.delayDays === null
        ? "Paid"
        : "On time"
      : data.delayDays === null
        ? "No due date"
        : data.delayDays === 0
          ? "Due today"
          : `${-data.delayDays} day${data.delayDays === -1 ? "" : "s"} left`;
  const StatusIcon = data.settled
    ? CircleCheck
    : late
      ? CircleAlert
      : data.delayDays === 0
        ? Clock3
        : CalendarDays;
  const products = data.products.map((p) => p.label).filter(Boolean);
  const productSummary = products.length
    ? `${products[0]}${products.length > 1 ? ` +${products.length - 1} more` : ""}`
    : null;
  const newestFirst = [...data.payments].reverse();
  const backText = from ? backLabel(from) : "Back to dues";

  return (
    <div ref={rootRef} className="mx-auto max-w-2xl pb-4">
      {/* Back · title · statement */}
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <Link
          to={from ?? "/dues"}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#E7EAF0] bg-white text-ink-900 shadow-sm transition hover:border-ink-300 dark:border-[rgb(var(--color-line))] dark:bg-surface"
          aria-label={backText}
          title={backText}
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Link>
        <p className="text-sm font-bold text-ink-900">Due details</p>
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#E7EAF0] bg-white text-ink-900 shadow-sm transition hover:border-ink-300 disabled:opacity-60 dark:border-[rgb(var(--color-line))] dark:bg-surface"
          disabled={downloading}
          onClick={() => void downloadStatement()}
          aria-label="Download statement PDF"
          title="Download statement PDF"
        >
          {downloading ? (
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-tide-500" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Customer + call */}
      <div className="mb-2.5 flex items-center gap-2.5 px-0.5">
        <div
          className={clsx(
            "grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-bold",
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
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-ink-400">
            <span className="tabular-nums">{data.customerPhone}</span>
            <span className="text-ink-300">·</span>
            <Link
              to={`/bills/${data.id}`}
              state={fromState(location)}
              className="font-mono text-tide-600 hover:underline"
            >
              {data.invoiceNumber}
            </Link>
            {isAdmin && data.duePrivate ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-900/[0.07] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-ink-700 dark:bg-white/10 dark:text-ink-800">
                <Lock className="h-2.5 w-2.5" strokeWidth={2.6} />
                Private
              </span>
            ) : null}
          </p>
        </div>
        <a
          href={`tel:${data.customerPhone}`}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_6px_14px_-6px_rgba(16,185,129,0.7)] transition hover:bg-emerald-600"
          aria-label={`Call ${data.customerName}`}
          title={`Call ${data.customerPhone}`}
        >
          <Phone className="h-[18px] w-[18px]" />
        </a>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* Still to collect · status · paid so far */}
      <section className="due-card px-3 pb-2.5 pt-3">
        <div
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: tone.accent }}
          aria-hidden
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-400">
              {data.settled ? "Settled" : "Still to collect"}
            </p>
            <p
              className={clsx(
                "mt-px font-display text-2xl font-bold leading-tight tracking-tight tabular-nums",
                data.settled
                  ? "text-emerald-600 dark:text-emerald-400"
                  : late
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-ink-900",
              )}
            >
              {data.settled ? "Fully paid" : formatRupees(data.pending)}
            </p>
          </div>
          <span
            className={clsx(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold",
              data.settled && !late ? URGENCY_TONE.upcoming.pill : tone.pill,
            )}
          >
            <StatusIcon className="h-3 w-3" strokeWidth={2.4} />
            {statusLabel}
          </span>
        </div>

        <div
          className="mb-1.5 mt-2 h-1.5 overflow-hidden rounded-full bg-ink-900/[0.07] dark:bg-white/10"
          role="progressbar"
          aria-label="Paid so far"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(paidShare * 100)}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
            style={{ width: `${paidShare * 100}%` }}
          />
        </div>
        <p className="flex items-center justify-between gap-2 text-[11.5px] font-semibold text-ink-500">
          <span>
            <span className="text-emerald-600 dark:text-emerald-400">
              Paid{" "}
              <b className="tabular-nums">{formatRupees(data.paidTotal)}</b>
            </span>{" "}
            of <b className="tabular-nums text-ink-900">{formatRupees(data.originalDue)}</b>
          </span>
          <span
            className={clsx(
              "text-right",
              data.settled
                ? "text-emerald-600 dark:text-emerald-400"
                : late && "text-rose-600 dark:text-rose-400",
            )}
          >
            {data.settled && data.settledAt
              ? `Cleared ${formatDate(data.settledAt)}`
              : data.dueDate
                ? `Promised ${formatDate(data.dueDate)}`
                : "No promise date"}
          </span>
        </p>
      </section>

      {/* Payment history, newest first, ending with the purchase */}
      <div className="mb-2 mt-4 flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-900">
          Payment history
          <span className="rounded-full bg-ink-900/[0.06] px-2 py-px text-xs font-bold tabular-nums text-ink-500 dark:bg-white/10">
            {data.payments.length}
          </span>
        </h2>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-tide-600 transition hover:text-tide-500 dark:text-tide-400"
          onClick={() => setViewingBill(true)}
        >
          <FileText className="h-3.5 w-3.5" />
          View bill
        </button>
      </div>

      {data.payments.length === 0 ? (
        <p className="mb-3 px-1 text-[13px] text-ink-500">No payments received yet.</p>
      ) : null}

      <ol className="mb-4">
        {newestFirst.map((payment, index) => {
          const MethodIcon = METHOD_ICON[payment.method] ?? Wallet;
          return (
            <li key={payment.id} className="due-timeline-item relative flex gap-2.5 pb-2">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <MethodIcon className="h-4 w-4" />
              </div>
              <div className="due-card min-w-0 flex-1 rounded-2xl px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-ink-900">
                    {payment.method === "na"
                      ? "Payment received"
                      : `${payment.methodLabel} received`}
                  </p>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    + {formatRupees(payment.amount)}
                  </p>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-ink-400">
                  <span>{formatDate(payment.paidAt)}</span>
                  {payment.balanceAfter > 0 ? (
                    <span className="font-semibold text-ink-500">
                      Balance{" "}
                      <b className="tabular-nums text-ink-900">
                        {formatRupees(payment.balanceAfter)}
                      </b>
                    </span>
                  ) : (
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      Fully cleared
                    </span>
                  )}
                </div>
                {payment.note ? (
                  <p className="mt-0.5 text-xs italic text-ink-500">“{payment.note}”</p>
                ) : null}
                {payment.delayDays !== null || (isAdmin && index === 0) ? (
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <DelayPill days={payment.delayDays} />
                    {isAdmin && index === 0 ? (
                      // Only the newest payment can be undone.
                      <button
                        type="button"
                        className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg border border-rose-500/30 px-2 text-[11.5px] font-bold text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-400"
                        onClick={() => setUndoing(payment)}
                      >
                        <Undo2 className="h-3.5 w-3.5" strokeWidth={2.4} />
                        Undo
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
        <li className="due-timeline-item relative flex gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0B1F33] text-[#FFA800] dark:ring-1 dark:ring-white/10">
            <ShoppingBag className="h-4 w-4" />
          </div>
          <div className="due-card min-w-0 flex-1 rounded-2xl px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-ink-900">Bought on credit</p>
              <p className="shrink-0 text-sm font-bold tabular-nums text-ink-900">
                {formatRupees(data.originalDue)}
              </p>
            </div>
            <p className="mt-0.5 text-xs text-ink-400">
              {formatDate(data.billDate)}
              {productSummary ? ` · ${productSummary}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-ink-400">
              Bill total{" "}
              <span className="font-semibold tabular-nums text-ink-500">
                {formatRupees(data.billTotal)}
              </span>
            </p>
          </div>
        </li>
      </ol>

      {showPayBar ? (
        <>
          {/* Room so the last rows aren't hidden behind the fixed bar. */}
          <div aria-hidden style={{ height: bar.height + 8 }} />
          {/* On <body> so "fixed" means the screen, not a page wrapper. */}
          {createPortal(
            <div
              ref={barRef}
              className={clsx(
                "fixed z-30 flex gap-2",
                // Hidden (not unmounted) under the pay sheet so its size stays measured.
                paying && "invisible",
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
                className="due-btn-dark inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-bold transition"
                onClick={() => setPaying(true)}
              >
                <Wallet className="h-[18px] w-[18px]" />
                Mark paid
              </button>
              <a
                href={`tel:${data.customerPhone}`}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-400"
                aria-label={`Call ${data.customerName}`}
              >
                <Phone className="h-[18px] w-[18px]" />
              </a>
            </div>,
            document.body,
          )}
        </>
      ) : null}

      <AnimatePresence>
        {paying && isAdmin ? (
          <PayDueSheet
            due={data}
            onClose={() => setPaying(false)}
            onPaid={async () => {
              setPaying(false);
              await load();
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {undoing && isAdmin ? (
          <UndoPaymentSheet
            due={data}
            payment={undoing}
            onClose={() => setUndoing(null)}
            onUndone={(updated) => {
              setUndoing(null);
              setData(updated);
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {viewingBill ? (
          <BillPdfViewer
            billId={data.id}
            invoiceNumber={data.invoiceNumber}
            onClose={() => setViewingBill(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** "Undo this payment?" — the amount goes back to the pending due. */
function UndoPaymentSheet({
  due,
  payment,
  onClose,
  onUndone,
}: {
  due: CustomerDueDetail;
  payment: CustomerDueDetail["payments"][number];
  onClose: () => void;
  onUndone: (updated: CustomerDueDetail) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingAfter = round2(due.pending + payment.amount);

  async function undo() {
    setSaving(true);
    setError(null);
    try {
      const { data: updated } = await api.undoDuePayment(due.id, payment.id);
      onUndone(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo the payment");
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !saving && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="undo-payment-title"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-5 shadow-lift dark:border-white/10 dark:bg-surface-elevated"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <Undo2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 id="undo-payment-title" className="font-display text-lg font-bold text-ink-900">
              Undo this payment?
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">
              {formatRupees(payment.amount)}{" "}
              {payment.method === "na" ? "payment" : payment.methodLabel.toLowerCase()} on{" "}
              {formatDate(payment.paidAt)} from {due.customerName}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-ink-900/[0.04] px-3.5 py-2.5 text-sm dark:bg-white/5">
          <p className="flex items-center justify-between gap-2">
            <span className="text-ink-500">Pending now</span>
            <span className="font-semibold tabular-nums text-ink-900">{formatRupees(due.pending)}</span>
          </p>
          <p className="mt-1 flex items-center justify-between gap-2">
            <span className="text-ink-500">Pending after undo</span>
            <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">
              {formatRupees(pendingAfter)}
            </span>
          </p>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          The payment is removed from the history and its amount comes off the bill's{" "}
          {payment.method === "na" ? "payments" : `${payment.methodLabel.toLowerCase()} total`}.
        </p>

        {error ? (
          <p className="mt-3 rounded-2xl bg-orange-50 px-4 py-3 text-sm text-ember-500 dark:bg-orange-500/10">
            {error}
          </p>
        ) : null}

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
            {saving ? "Undoing…" : "Undo payment"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

type PayMethod = "cash" | "online" | "na";

const METHODS: Array<{ value: PayMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online" },
  { value: "na", label: "N/A" },
];

/** Amount + Cash / Online / N/A. The amount can't be more than what's pending. */
function PayDueSheet({
  due,
  onClose,
  onPaid,
}: {
  due: CustomerDueDetail;
  onClose: () => void;
  onPaid: () => void | Promise<void>;
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
      setError("Enter the amount received");
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
      await onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save payment");
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !saving && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-due-title"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-5 shadow-lift dark:border-white/10 dark:bg-surface-elevated sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-tide-600">Mark paid</p>
            <h2 id="pay-due-title" className="mt-1 font-display text-xl font-semibold text-ink-900">
              {due.customerName}
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">
              Pending <span className="font-semibold text-ember-500">{formatINR(due.pending)}</span>
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-ink-500 hover:bg-ink-50"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="label required" htmlFor="pay-due-amount">
          Amount received
        </label>
        <input
          id="pay-due-amount"
          className={clsx("field", tooMuch && "!border-rose-500")}
          type="number"
          inputMode="decimal"
          min={0.01}
          step="0.01"
          max={due.pending}
          value={amount}
          autoFocus
          placeholder={`Up to ${formatINR(due.pending)}`}
          onChange={(event) => {
            setAmount(event.target.value);
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

        <p className="label required mb-2 mt-3">Received via</p>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={clsx(
                "rounded-2xl border px-3 py-2.5 text-sm font-semibold transition",
                method === option.value
                  ? "border-tide-500 bg-tide-100/70 text-ink-900 dark:bg-tide-100/30"
                  : "border-ink-100 bg-white text-ink-700 hover:border-ink-300 dark:bg-surface-elevated",
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

        {error ? (
          <p className="mt-4 rounded-2xl bg-orange-50 px-4 py-3 text-sm text-ember-500 dark:bg-orange-500/10">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="btn-primary mt-5 w-full"
          disabled={saving || tooMuch}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Confirm payment"}
        </button>
      </motion.div>
    </motion.div>
  );
}
