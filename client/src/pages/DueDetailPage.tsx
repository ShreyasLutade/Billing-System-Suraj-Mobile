import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  Check,
  Download,
  Phone,
  ReceiptText,
  Wallet,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { useFixedBottomBar } from "../hooks/useFixedBottomBar";
import { BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { api, formatINR, round2 } from "../lib/api";
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

/** "07 Oct" over "2026": keeps the statement's date column narrow on phones. */
function StatementDate({ value }: { value: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <>—</>;
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...options }).format(date);
  return (
    <>
      <span className="block font-medium text-ink-800">{part({ day: "2-digit", month: "short" })}</span>
      <span className="block text-[10.5px] text-ink-400">{part({ year: "numeric" })}</span>
    </>
  );
}

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
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        late
          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
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

  return (
    <div ref={rootRef} className="mx-auto max-w-2xl pb-4">
      {back}

      {/* Customer + statement */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold text-ink-900">
            {data.customerName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-500">
            <Link
              to={`/bills/${data.id}`}
              state={fromState(location)}
              className="font-mono text-tide-600 hover:underline"
            >
              {data.invoiceNumber}
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={`tel:${data.customerPhone}`}
            className="grid h-[38px] w-[38px] place-items-center rounded-[11px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-400"
            aria-label={`Call ${data.customerName}`}
            title={`Call ${data.customerPhone}`}
          >
            <Phone className="h-4 w-4" />
          </a>
          <button
            type="button"
            className="btn-secondary !gap-1.5 !px-3 !py-2 text-xs sm:text-sm"
            disabled={downloading}
            onClick={() => void downloadStatement()}
          >
            <Download className="h-4 w-4" />
            {downloading ? "Preparing…" : "Statement"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {/* Pending / settled */}
      <section
        className={clsx(
          "mb-3 rounded-2xl px-4 py-4 ring-1",
          data.settled
            ? "bg-gradient-to-r from-emerald-500/10 to-transparent ring-emerald-500/20"
            : "bg-gradient-to-r from-ember-500/10 to-transparent ring-ember-500/15",
        )}
      >
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {data.settled ? "Settled" : "Pending due"}
            </p>
            <p
              className={clsx(
                "mt-1 font-display text-3xl font-semibold tabular-nums",
                data.settled ? "text-emerald-600 dark:text-emerald-400" : "text-ember-500",
              )}
            >
              {data.settled ? (
                <span className="inline-flex items-center gap-2">
                  <Check className="h-7 w-7" /> Paid
                </span>
              ) : (
                formatINR(data.pending)
              )}
            </p>
          </div>
          {/* Promised date + how late */}
          <div className="text-right">
            <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              <CalendarClock className="h-3.5 w-3.5" /> Promised by
            </p>
            <p className="text-sm font-semibold text-ink-900">
              {data.dueDate ? formatDate(data.dueDate) : "No date given"}
            </p>
            {data.delayDays !== null ? (
              <p
                className={clsx(
                  "mt-0.5 text-xs font-semibold",
                  late ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400",
                )}
              >
                {late
                  ? `${delayLabel(data.delayDays)}${data.settled ? "" : " so far"}`
                  : data.settled
                    ? "Cleared on time"
                    : data.delayDays === 0
                      ? "Due today"
                      : `${-data.delayDays} day${data.delayDays === -1 ? "" : "s"} left`}
              </p>
            ) : null}
            {data.settled && data.settledAt ? (
              <p className="mt-0.5 text-[11px] text-ink-500">Cleared {formatDate(data.settledAt)}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: "Due amount", value: formatINR(data.originalDue), tone: "text-ink-900" },
            {
              label: "Paid",
              value: formatINR(data.paidTotal),
              tone: "text-emerald-600 dark:text-emerald-400",
            },
            {
              label: "Pending",
              value: formatINR(data.pending),
              tone: data.pending > 0 ? "text-ember-500" : "text-emerald-600 dark:text-emerald-400",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-ink-100/80 bg-white/80 px-2.5 py-2 dark:bg-surface-elevated"
            >
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
                {stat.label}
              </p>
              <p className={clsx("mt-0.5 text-sm font-semibold tabular-nums", stat.tone)}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Statement, passbook style: Due added, Paid, running Balance */}
      <section className="mb-4 overflow-hidden rounded-2xl border border-ink-100/80 bg-white/90 shadow-sm dark:bg-surface-elevated">
        <p className="flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          <ReceiptText className="h-3.5 w-3.5" /> Statement
        </p>
        <table className="w-full table-fixed border-collapse text-[12px] leading-tight">
          <colgroup>
            <col className="w-[17%]" />
            <col />
            <col className="w-[20%]" />
            <col className="w-[20%]" />
            <col className="w-[21%]" />
          </colgroup>
          <thead>
            <tr className="bg-ink-900 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-ink-100/40">
              <th className="py-2 pl-2.5 pr-1 text-left">Date</th>
              <th className="px-1 py-2 text-left">Details</th>
              <th className="px-1 py-2 text-right">Due</th>
              <th className="px-1 py-2 text-right">Paid</th>
              <th className="py-2 pl-1 pr-2.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-b border-ink-100/80 align-top">
              <td className="py-2.5 pl-2.5 pr-1">
                <StatementDate value={data.billDate} />
              </td>
              <td className="px-1 py-2.5 font-semibold text-ink-900">Purchase</td>
              <td className="break-words px-1 py-2.5 text-right font-semibold text-ember-500">
                {formatINR(data.originalDue)}
              </td>
              <td className="px-1 py-2.5" />
              <td className="break-words py-2.5 pl-1 pr-2.5 text-right font-semibold text-ink-900">
                {formatINR(data.originalDue)}
              </td>
            </tr>
            {data.payments.map((payment, index) => (
              <tr
                key={payment.id}
                className={clsx(
                  "border-b border-ink-100/80 align-top",
                  index % 2 === 0 && "bg-ink-50/40 dark:bg-white/[0.02]",
                )}
              >
                <td className="py-2.5 pl-2.5 pr-1">
                  <StatementDate value={payment.paidAt} />
                </td>
                <td className="px-1 py-2.5">
                  <span className="block font-semibold text-emerald-700 dark:text-emerald-400">
                    {payment.methodLabel}
                  </span>
                  <DelayPill days={payment.delayDays} className="mt-1 !px-1.5 !py-px !text-[9.5px]" />
                </td>
                <td className="px-1 py-2.5" />
                <td className="break-words px-1 py-2.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatINR(payment.amount)}
                </td>
                <td
                  className={clsx(
                    "break-words py-2.5 pl-1 pr-2.5 text-right font-semibold",
                    payment.balanceAfter > 0 ? "text-ink-900" : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {formatINR(payment.balanceAfter)}
                </td>
              </tr>
            ))}
            {data.payments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-sm text-ink-500">
                  No payments yet.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="tabular-nums">
            <tr className="bg-amber-50 font-semibold dark:bg-amber-500/10">
              <td className="py-2.5 pl-2.5 pr-1 text-ink-900" colSpan={2}>
                Total
              </td>
              <td className="break-words px-1 py-2.5 text-right text-ink-900">{formatINR(data.originalDue)}</td>
              <td className="break-words px-1 py-2.5 text-right text-emerald-600 dark:text-emerald-400">
                {formatINR(data.paidTotal)}
              </td>
              <td
                className={clsx(
                  "break-words py-2.5 pl-1 pr-2.5 text-right",
                  data.pending > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {formatINR(data.pending)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {showPayBar ? (
        <>
          {/* Room so the last rows aren't hidden behind the fixed bar. */}
          <div aria-hidden style={{ height: bar.height + 8 }} />
          {/* On <body> so "fixed" means the screen, not a page wrapper. */}
          {createPortal(
            <div
              ref={barRef}
              className={clsx(
                "fixed z-30",
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
                className="btn-primary w-full shadow-lift"
                onClick={() => setPaying(true)}
              >
                <Wallet className="h-4 w-4" />
                Mark paid
              </button>
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
    </div>
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
