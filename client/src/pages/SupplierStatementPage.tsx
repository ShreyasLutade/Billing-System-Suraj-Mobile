import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronRight,
  Download,
  Loader2,
  PackagePlus,
  Phone,
  Trash2,
  Undo2,
  Wallet,
} from "lucide-react";
import clsx from "clsx";
import { BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { DangerConfirmModal } from "../components/RemoveConfirmModals";
import { api, formatINR, type SupplierStatementView } from "../lib/api";
import { backLabel, readFromState } from "../lib/navMemory";

/**
 * Supplier statement on screen: the same ledger as the downloaded PDF.
 * Purchases raise what we owe, payments and returned units lower it; each
 * card shows the balance due after it. Payments can be deleted (with a
 * confirmation), which puts their amount back on the balance.
 */

type Row = SupplierStatementView["rows"][number];

function day(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

/** "jio bharat v4" → "Jio Bharat V4"; words with capitals inside (iPhone) stay. */
function niceWords(text: string) {
  return text.replace(/\b([a-z])([a-z0-9]*)\b/g, (_m, first: string, rest: string) => first.toUpperCase() + rest);
}

function signed(amount: number) {
  return amount < -0.005 ? `−${formatINR(-amount)}` : formatINR(amount);
}

const KIND = {
  purchase: {
    icon: PackagePlus,
    label: "Purchase",
    tone: "bg-tide-100 text-tide-600 dark:bg-tide-400/15 dark:text-tide-400",
    rail: "bg-tide-500",
  },
  payment: {
    icon: Wallet,
    label: "Payment",
    tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    rail: "bg-emerald-500",
  },
  return: {
    icon: Undo2,
    label: "Returned",
    tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    rail: "bg-amber-500",
  },
} as const;

const canDelete = (row: Row) => row.kind === "payment" && Boolean(row.paymentId || row.legacyPurchaseId);

export function SupplierStatementPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const from = readFromState(location.state);
  const [data, setData] = useState<SupplierStatementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.viewSupplierStatement(id);
      setData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the statement");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function download() {
    if (!id || downloading) return;
    setDownloading(true);
    try {
      await api.downloadSupplierStatement(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the statement");
    } finally {
      setDownloading(false);
    }
  }

  function askDelete(row: Row) {
    setDeleteError(null);
    setRemoving(row);
  }

  async function deletePayment() {
    if (!id || !removing || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { data: result } = await api.deleteSupplierPayment(
        id,
        removing.paymentId
          ? { paymentId: removing.paymentId }
          : { purchaseId: removing.legacyPurchaseId!, amount: removing.debit },
      );
      setRemoving(null);
      setNotice(`Payment of ${formatINR(result.removed)} deleted · balance due is now ${formatINR(result.outstanding)}`);
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete the payment");
    } finally {
      setDeleting(false);
    }
  }

  const back = <BackLink to={from ?? "/suppliers"}>{from ? backLabel(from) : "Back to suppliers"}</BackLink>;

  if (error && !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {back}
        <EmptyState title="Statement not available" description={error} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {back}
        <LoadingBlock label="Loading statement…" />
      </div>
    );
  }

  const paid = data.totalDebit - data.totalReturned;
  const due = data.balance > 0.005;
  const advance = data.balance < -0.005;
  const small = [
    { label: "Purchased", value: formatINR(data.totalCredit), tone: "text-ink-900" },
    { label: "Paid", value: formatINR(paid), tone: "text-emerald-600 dark:text-emerald-400" },
    ...(data.totalReturned > 0.005
      ? [{ label: "Returned", value: formatINR(data.totalReturned), tone: "text-amber-600 dark:text-amber-400" }]
      : []),
  ];
  const payments = data.rows.filter((r) => r.kind === "payment").length;
  const purchases = data.rows.filter((r) => r.kind === "purchase").length;

  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-6">
      {back}

      {/* Who, and how much is still to pay. */}
      <section className="rounded-3xl border border-ink-100 bg-white/90 p-4 shadow-sm dark:bg-surface-elevated">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tide-600">Supplier statement</p>
            <h1 className="mt-1 truncate font-display text-2xl font-bold capitalize text-ink-900">{data.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
              {data.phone ? (
                <a href={`tel:${data.phone}`} className="inline-flex items-center gap-1 font-medium text-tide-600">
                  <Phone className="h-3.5 w-3.5" /> {data.phone}
                </a>
              ) : null}
              <span>As of {day(data.generatedAt)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void download()}
            disabled={downloading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-ink-100 bg-white px-3 py-2 text-xs font-semibold text-ink-700 transition hover:border-tide-500 hover:text-tide-600 disabled:opacity-60 dark:bg-surface"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            PDF
          </button>
        </div>

        <div
          className={clsx(
            "mt-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3",
            due
              ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
          )}
        >
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
              {due ? "Balance due" : advance ? "Advance paid" : "All settled"}
            </p>
            <p className="text-[11.5px] opacity-75">
              {due ? "Still to pay this supplier" : advance ? "Paid more than purchased" : "Nothing left to pay"}
            </p>
          </div>
          <p className="shrink-0 font-display text-[22px] font-bold tabular-nums">{formatINR(Math.abs(data.balance))}</p>
        </div>

        <div className={clsx("mt-2 grid gap-2", small.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
          {small.map((box) => (
            <div key={box.label} className="min-w-0 rounded-2xl bg-ink-50/70 px-3 py-2 dark:bg-white/5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">{box.label}</p>
              <p className={clsx("mt-0.5 truncate font-display text-[15px] font-bold tabular-nums", box.tone)}>{box.value}</p>
            </div>
          ))}
        </div>
      </section>

      <AnimatePresence>
        {notice ? (
          <motion.p
            role="status"
            className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>
      ) : null}

      {/* The ledger, oldest first. */}
      <section className="overflow-hidden rounded-3xl border border-ink-100 bg-white/90 shadow-sm dark:bg-surface-elevated">
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-ink-100 px-4 py-3">
          <h2 className="font-display text-[15px] font-semibold text-ink-900">Transactions</h2>
          <p className="text-[11.5px] text-ink-500">
            {purchases} purchase{purchases === 1 ? "" : "s"} · {payments} payment{payments === 1 ? "" : "s"} · oldest first
          </p>
        </header>

        {data.rows.length ? (
          <ul>
            {data.rows.map((row, index) => {
              const kind = KIND[row.kind];
              const Icon = kind.icon;
              const open = row.kind === "purchase" && row.purchaseId;
              const [title, sub] = row.particulars.split(" · ");
              return (
                <li key={`${row.kind}-${index}`} className="relative border-b border-ink-100/80 last:border-b-0">
                  <span aria-hidden className={clsx("absolute inset-y-3 left-0 w-[3px] rounded-r-full opacity-70", kind.rail)} />
                  <div
                    className={clsx(
                      "flex items-start gap-3 py-3 pl-4 pr-3 sm:pr-4",
                      open && "cursor-pointer transition hover:bg-tide-100/40 dark:hover:bg-white/5",
                    )}
                    onClick={() => (open ? navigate(`/suppliers/${data.id}/purchases/${row.purchaseId}`) : undefined)}
                  >
                    <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-2xl", kind.tone)}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold text-ink-900">
                        {title}
                        {sub ? (
                          <span className="rounded-md bg-ink-50 px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-ink-500 dark:bg-white/5">
                            {sub}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-ink-500">
                        {day(row.date)}
                        {row.qty ? ` · ${row.qty} pc${row.qty === 1 ? "" : "s"}` : ""}
                      </p>
                      {row.detail ? (
                        <p className="mt-1 whitespace-pre-line text-[12.5px] leading-snug text-ink-600">
                          {row.kind === "purchase" ? niceWords(row.detail) : row.detail}
                        </p>
                      ) : null}
                      {row.paidNote ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {row.paidNote}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                      {row.credit > 0 ? (
                        <p className="text-[15px] font-bold tabular-nums text-ink-900">+{formatINR(row.credit)}</p>
                      ) : null}
                      {row.debit > 0 ? (
                        <p
                          className={clsx(
                            "font-bold tabular-nums",
                            row.credit > 0 ? "text-xs" : "text-[15px]",
                            row.kind === "return" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {row.credit > 0 ? "Paid " : ""}−{formatINR(row.debit)}
                        </p>
                      ) : null}
                      <p
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums",
                          row.balance > 0.005
                            ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300"
                            : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
                        )}
                      >
                        Due {signed(row.balance)}
                      </p>
                      {canDelete(row) ? (
                        <button
                          type="button"
                          className="mt-0.5 inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11.5px] font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/35 dark:bg-transparent dark:text-rose-400 dark:hover:bg-rose-500/15"
                          onClick={(event) => {
                            event.stopPropagation();
                            askDelete(row);
                          }}
                          aria-label={`Delete payment of ${formatINR(row.debit)} on ${day(row.date)}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      ) : open ? (
                        <ChevronRight className="mt-1 h-4 w-4 text-ink-300" aria-hidden />
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-ink-500">No purchases or payments with this supplier yet.</p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/70 px-4 py-3 text-sm dark:bg-white/5">
          <span className="font-semibold text-ink-700">Closing balance</span>
          <span
            className={clsx(
              "font-display text-lg font-bold tabular-nums",
              due ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {due ? formatINR(data.balance) : advance ? `${formatINR(-data.balance)} advance` : "Settled"}
          </span>
        </div>
      </section>

      <AnimatePresence>
        {removing ? (
          <DangerConfirmModal
            title="Delete this payment?"
            subtitle={`${formatINR(removing.debit)} · ${removing.particulars} · ${day(removing.date)}`}
            points={[
              <>
                The balance due to <b className="capitalize">{data.name}</b> goes up by <b>{formatINR(removing.debit)}</b>
                {" "}(to <b>{signed(data.balance + removing.debit)}</b>).
              </>,
              "The payment is removed from this statement and the PDF.",
            ]}
            confirmLabel="Delete payment"
            cancelLabel="Keep payment"
            working={deleting}
            error={deleteError}
            onCancel={() => !deleting && setRemoving(null)}
            onConfirm={() => void deletePayment()}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
