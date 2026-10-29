import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Download, Loader2, PackagePlus, Phone, Undo2, Wallet } from "lucide-react";
import clsx from "clsx";
import { BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { api, formatINR, type SupplierStatementView } from "../lib/api";
import { backLabel, readFromState } from "../lib/navMemory";

/**
 * Supplier statement on screen: the same ledger as the downloaded PDF.
 * Purchases raise what we owe, payments and returned units lower it; the
 * last column is the running balance due.
 */

function day(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function signed(amount: number) {
  return amount < -0.005 ? `−${formatINR(-amount)}` : formatINR(amount);
}

const KIND = {
  purchase: { icon: PackagePlus, tone: "bg-tide-100 text-tide-600 dark:bg-tide-400/15 dark:text-tide-400" },
  payment: { icon: Wallet, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  return: { icon: Undo2, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
} as const;

export function SupplierStatementPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const from = readFromState(location.state);
  const [data, setData] = useState<SupplierStatementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .viewSupplierStatement(id)
      .then(({ data }) => setData(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the statement"));
  }, [id]);

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

  const back = (
    <BackLink to={from ?? "/suppliers"}>{from ? backLabel(from) : "Back to suppliers"}</BackLink>
  );

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
  const boxes = [
    { label: "Total purchased", value: formatINR(data.totalCredit), tone: "text-ink-900" },
    { label: "Total paid", value: formatINR(paid), tone: "text-emerald-600 dark:text-emerald-400" },
    ...(data.totalReturned > 0.005
      ? [{ label: "Returned", value: formatINR(data.totalReturned), tone: "text-amber-600 dark:text-amber-400" }]
      : []),
    {
      label: data.balance > 0.005 ? "Balance due" : data.balance < -0.005 ? "Advance paid" : "Settled",
      value: formatINR(Math.abs(data.balance)),
      tone: data.balance > 0.005 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-6">
      {back}

      <section className="rounded-3xl border border-ink-100 bg-white/90 p-4 shadow-sm dark:bg-surface-elevated">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tide-600">Supplier statement</p>
            <h1 className="mt-1 truncate font-display text-2xl font-bold text-ink-900">{data.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
              {data.phone ? (
                <a href={`tel:${data.phone}`} className="inline-flex items-center gap-1 text-tide-600">
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

        <div className={clsx("mt-3 grid gap-2", boxes.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
          {boxes.map((box) => (
            <div key={box.label} className="rounded-2xl bg-ink-50/70 px-3 py-2 dark:bg-white/5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">{box.label}</p>
              <p className={clsx("mt-0.5 font-display text-[15px] font-bold tabular-nums", box.tone)}>{box.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-ink-100 bg-white/90 shadow-sm dark:bg-surface-elevated">
        <div className="hidden grid-cols-[92px_minmax(0,1fr)_96px_96px_104px] gap-2 border-b border-ink-100 bg-ink-50/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500 sm:grid dark:bg-white/5">
          <span>Date</span>
          <span>Particulars</span>
          <span className="text-right">Purchased</span>
          <span className="text-right">Paid</span>
          <span className="text-right">Balance due</span>
        </div>

        {data.rows.length ? (
          <ul>
            {data.rows.map((row, index) => {
              const kind = KIND[row.kind];
              const Icon = kind.icon;
              const open = row.kind === "purchase" && row.purchaseId;
              return (
                <li
                  key={`${row.kind}-${index}`}
                  className={clsx(
                    "border-b border-ink-100/80 px-4 py-3 last:border-b-0",
                    open && "cursor-pointer transition hover:bg-tide-100/40",
                  )}
                  onClick={() => (open ? navigate(`/suppliers/${data.id}/purchases/${row.purchaseId}`) : undefined)}
                >
                  {/* Phone: what happened on the left, money on the right. */}
                  <div className="flex items-start gap-3 sm:hidden">
                    <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", kind.tone)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-900">{row.particulars}</p>
                      <p className="text-[11.5px] text-ink-500">
                        {day(row.date)}
                        {row.qty ? ` · ${row.qty} pcs` : ""}
                      </p>
                      {row.detail ? <p className="mt-0.5 whitespace-pre-line text-xs text-ink-600">{row.detail}</p> : null}
                      {row.paidNote ? <p className="mt-0.5 text-[11.5px] font-medium text-emerald-600">{row.paidNote}</p> : null}
                    </div>
                    <div className="shrink-0 text-right">
                      {row.credit > 0 ? (
                        <p className="text-sm font-bold tabular-nums text-ink-900">+{formatINR(row.credit)}</p>
                      ) : null}
                      {row.debit > 0 ? (
                        <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">−{formatINR(row.debit)}</p>
                      ) : null}
                      <p className="mt-0.5 rounded-full bg-ink-50 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-ink-500 dark:bg-white/5">
                        Due {signed(row.balance)}
                      </p>
                    </div>
                  </div>

                  {/* Tablet / laptop: the PDF's columns. */}
                  <div className="hidden grid-cols-[92px_minmax(0,1fr)_96px_96px_104px] items-start gap-2 text-sm sm:grid">
                    <span className="text-xs tabular-nums text-ink-500">{day(row.date)}</span>
                    <span className="min-w-0">
                      <span className="font-semibold text-ink-900">{row.particulars}</span>
                      {row.qty ? <span className="text-ink-400"> · {row.qty} pcs</span> : null}
                      {row.detail ? <span className="block whitespace-pre-line text-xs text-ink-500">{row.detail}</span> : null}
                      {row.paidNote ? <span className="block text-xs font-medium text-emerald-600">{row.paidNote}</span> : null}
                    </span>
                    <span className="text-right tabular-nums text-ink-900">{row.credit ? formatINR(row.credit) : "—"}</span>
                    <span className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {row.debit ? formatINR(row.debit) : "—"}
                    </span>
                    <span className={clsx("text-right font-semibold tabular-nums", row.balance > 0.005 ? "text-rose-600" : "text-ink-700")}>
                      {signed(row.balance)}
                    </span>
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
              data.balance > 0.005 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {data.balance > 0.005 ? formatINR(data.balance) : data.balance < -0.005 ? `${formatINR(-data.balance)} advance` : "Settled"}
          </span>
        </div>
      </section>
    </div>
  );
}
