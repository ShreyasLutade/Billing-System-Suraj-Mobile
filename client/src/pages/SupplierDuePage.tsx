import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { ArrowLeft, Boxes, ChevronRight, Download, Phone, Truck, Undo2, X } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { useFixedBottomBar } from "../hooks/useFixedBottomBar";
import { BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { EntryDateIcon, todayIST } from "../components/EntryDateIcon";
import { api, round2 } from "../lib/api";
import { formatRupees } from "../lib/dueStatus";
import { backLabel, fromState, readFromState } from "../lib/navMemory";
import type { SupplierLedger } from "../types";
import { AmountField, ErrorNote, Sheet, formatDate, shortDate } from "./DueDetailPage";

type Entry = SupplierLedger["entries"][number];
type Method = "cash" | "online" | "na";

const METHODS: Array<{ value: Method; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online" },
  { value: "na", label: "N/A" },
];

const METHOD_LABEL: Record<string, string> = { cash: "Cash", online: "Online", card: "Card" };

/** "₹4,000" you owe, or "Advance ₹2,000" when you paid extra. */
function balanceText(balance: number) {
  return balance < -0.005 ? `Advance ${formatRupees(-balance)}` : formatRupees(balance);
}

/**
 * Dues → Supplier → one supplier: what you owe, every purchase (you got) and
 * payment / returned unit (you gave). Only YOU GAVE: stock you add raises
 * the balance on its own. Paying more than pending is kept as advance.
 */
export function SupplierDuePage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const from = readFromState(location.state) ?? "/dues?tab=supplier";
  const { isAdmin } = useAuth();
  const [data, setData] = useState<SupplierLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [undoing, setUndoing] = useState<Entry | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const showBar = Boolean(isAdmin && data);
  const bar = useFixedBottomBar(rootRef, barRef, showBar);

  useEffect(() => {
    if (!showBar) return;
    document.body.classList.add("has-fab");
    return () => document.body.classList.remove("has-fab");
  }, [showBar]);

  async function load() {
    if (!id) return;
    try {
      const { data: ledger } = await api.getSupplierLedger(id);
      setData(ledger);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load supplier");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!isAdmin) return <Navigate to="/dues" replace />;
  if (loading) return <LoadingBlock label="Loading supplier…" />;
  if (!data) {
    return (
      <div className="space-y-3">
        <BackLink to={from} className="mb-4">
          {backLabel(from)}
        </BackLink>
        <EmptyState title="Supplier not found" description={error || "This supplier does not exist."} />
      </div>
    );
  }

  const owe = data.outstanding > 0.005;
  const advance = data.outstanding < -0.005 ? round2(-data.outstanding) : 0;
  const newestFirst = [...data.entries].reverse();
  const purchases = data.entries.filter((e) => e.kind === "purchase").length;
  const paymentsCount = data.entries.filter((e) => e.kind === "payment").length;
  const returns = data.entries.filter((e) => e.kind === "return").length;
  const accent = owe ? "#E5484D" : advance > 0 ? "#34D399" : "#C9D0DB";

  async function downloadStatement() {
    if (!id) return;
    setDownloading(true);
    try {
      await api.downloadSupplierStatement(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download statement");
    } finally {
      setDownloading(false);
    }
  }

  const actionClass =
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-ink-900/[0.045] text-[12px] font-bold text-ink-700 transition hover:bg-ink-900/[0.08] dark:bg-white/[0.06] dark:text-ink-800 dark:hover:bg-white/10";

  return (
    <div ref={rootRef} className="mx-auto max-w-2xl pb-4">
      <div className="mb-2.5 flex items-center gap-2.5">
        <Link
          to={from}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#E7EAF0] bg-white text-ink-900 shadow-sm transition hover:border-ink-300 dark:border-[rgb(var(--color-line))] dark:bg-surface"
          aria-label={backLabel(from)}
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </Link>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0B1F33] text-[#FFA800] dark:ring-1 dark:ring-white/10">
          <Truck className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[17px] font-bold leading-tight tracking-tight text-ink-900">
            {data.name}
          </h1>
          <p className="mt-px flex items-center gap-1.5 text-[12.5px] text-ink-400">
            {data.phone ? <span className="tabular-nums">{data.phone}</span> : null}
            <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Supplier
            </span>
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="due-card px-3.5 pb-3 pt-3.5">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} aria-hidden />
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-400">
          {owe ? "To pay" : advance > 0 ? "Advance · you paid extra" : "All clear"}
        </p>
        <p
          className={clsx(
            "mt-px font-display text-[26px] font-bold leading-tight tracking-tight tabular-nums",
            owe ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {owe ? formatRupees(data.outstanding) : advance > 0 ? formatRupees(advance) : "₹0"}
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          {advance > 0
            ? "Used on the next stock from this supplier"
            : `${data.purchaseCount} purchase${data.purchaseCount === 1 ? "" : "s"} · ${formatRupees(data.totalPurchased)} bought in all`}
        </p>
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          {data.phone ? (
            <a href={`tel:${data.phone}`} className={actionClass}>
              <Phone className="h-[15px] w-[15px]" />
              Call
            </a>
          ) : (
            <span className={clsx(actionClass, "pointer-events-none opacity-40")}>
              <Phone className="h-[15px] w-[15px]" />
              Call
            </span>
          )}
          <Link to={`/suppliers/${data.id}`} state={fromState(location)} className={actionClass}>
            <Boxes className="h-[15px] w-[15px]" />
            Stock
          </Link>
          <button
            type="button"
            className={actionClass}
            disabled={downloading}
            onClick={() => void downloadStatement()}
          >
            {downloading ? (
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-tide-500" />
            ) : (
              <Download className="h-[15px] w-[15px]" />
            )}
            PDF
          </button>
        </div>
      </section>

      <div className="mb-1.5 mt-4 flex items-center justify-between gap-3 px-1">
        <h2 className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-400">Entries</h2>
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">
          {[
            `${purchases} purchase${purchases === 1 ? "" : "s"}`,
            `${paymentsCount} payment${paymentsCount === 1 ? "" : "s"}`,
            returns ? `${returns} returned` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {newestFirst.length === 0 ? (
        <p className="px-1 text-[13px] text-ink-500">No purchases or payments yet.</p>
      ) : (
        <div className="due-card overflow-hidden !p-0">
          <div className="grid grid-cols-[minmax(0,1fr)_84px_84px] border-b border-[#EEF1F5] bg-ink-900/[0.025] text-[10px] font-bold uppercase tracking-[0.08em] text-ink-400 dark:border-[rgb(var(--color-line))] dark:bg-white/[0.03]">
            <span className="px-3 py-2">Entry</span>
            <span className="px-3 py-2 text-right">Paid</span>
            <span className="px-3 py-2 text-right">Purchased</span>
          </div>
          <ol>
            {newestFirst.map((entry) => (
              <SupplierEntryRow
                key={entry.key}
                entry={entry}
                link={
                  entry.kind === "purchase" ? (
                    <Link
                      to={`/suppliers/${data.id}`}
                      state={fromState(location)}
                      className="absolute inset-0 z-[1]"
                      aria-label={`Open ${data.name}'s purchases`}
                    />
                  ) : null
                }
                onUndo={
                  entry.paymentId && entry.paymentId === data.undoPaymentId
                    ? () => setUndoing(entry)
                    : undefined
                }
              />
            ))}
          </ol>
        </div>
      )}

      {showBar ? (
        <>
          <div aria-hidden style={{ height: bar.height + 8 }} />
          {createPortal(
            <div
              ref={barRef}
              className={clsx(
                "fixed z-30",
                (paying || undoing) && "invisible",
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
                className="h-11 w-full rounded-xl bg-[#D93A3F] text-[14.5px] font-bold tracking-wide text-white shadow-[0_8px_18px_-10px_rgba(217,58,63,0.9)] transition hover:bg-[#C5333A]"
                onClick={() => setPaying(true)}
              >
                PAY ₹
              </button>
            </div>,
            document.body,
          )}
        </>
      ) : null}

      <AnimatePresence>
        {paying ? (
          <PaySupplierSheet
            ledger={data}
            onClose={() => setPaying(false)}
            onSaved={async () => {
              setPaying(false);
              await load();
            }}
          />
        ) : null}
        {undoing ? (
          <UndoSupplierPaymentSheet
            ledger={data}
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

function SupplierEntryRow({
  entry,
  link,
  onUndo,
}: {
  entry: Entry;
  link: ReactNode;
  onUndo?: () => void;
}) {
  const purchase = entry.kind === "purchase";
  // Returned unit: "Returned · iPhone 12 128GB" (detail: name · IMEI, bill…).
  const returnedName = entry.kind === "return" ? entry.detail.split("\n")[0].split(" · ")[0] : "";
  const title = purchase
    ? entry.particulars
    : entry.kind === "payment"
      ? entry.particulars === "Paid at purchase"
        ? "Paid at purchase"
        : `Payment${entry.method && METHOD_LABEL[entry.method] ? ` · ${METHOD_LABEL[entry.method]}` : ""}`
      : `${entry.particulars.startsWith("Replaced") ? "Replaced" : "Returned"}${returnedName ? ` · ${returnedName}` : ""}`;
  const detail =
    entry.kind === "return"
      ? entry.detail.split("\n").slice(1).join(" · ") || entry.detail.split("\n")[0].split(" · ").slice(1).join(" · ")
      : [
          purchase && entry.qty ? `${entry.qty} item${entry.qty === 1 ? "" : "s"}` : null,
          entry.detail.split("\n")[0] || null,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <li
      className={clsx(
        "relative grid grid-cols-[minmax(0,1fr)_84px_84px] border-b border-[#EEF1F5] last:border-b-0 dark:border-[rgb(var(--color-line))]",
        purchase && "transition hover:bg-tide-500/[0.04] active:bg-tide-500/[0.07]",
      )}
    >
      {link}
      <div className="min-w-0 px-3 py-2">
        <p className="flex items-center gap-1 text-[12.5px] font-semibold text-ink-900">
          <span className="shrink-0 text-ink-500">{shortDate(entry.date)} ·</span>
          <span className={clsx("truncate", purchase && "font-bold")}>{title}</span>
          {purchase ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-tide-600 dark:text-tide-400" strokeWidth={2.6} />
          ) : null}
        </p>
        {detail ? <p className="truncate text-[11px] text-ink-500">{detail}</p> : null}
        {entry.paidNote ? (
          <p className="truncate text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            {entry.paidNote}
          </p>
        ) : null}
        <p className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-ink-400">
          <span>
            Bal{" "}
            <span
              className={clsx(
                "font-semibold tabular-nums",
                entry.balanceAfter < -0.005
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-ink-500",
              )}
            >
              {balanceText(entry.balanceAfter)}
            </span>
          </span>
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
          entry.gave > 0 && "bg-rose-500/[0.05] text-rose-600 dark:bg-rose-500/[0.08] dark:text-rose-400",
        )}
      >
        {entry.gave > 0 ? formatRupees(entry.gave) : ""}
      </div>
      <div
        className={clsx(
          "px-3 py-2 text-right text-[13px] font-bold tabular-nums",
          entry.got > 0 &&
            "bg-emerald-500/[0.06] text-emerald-600 dark:bg-emerald-500/[0.08] dark:text-emerald-400",
        )}
      >
        {entry.got > 0 ? formatRupees(entry.got) : ""}
      </div>
    </li>
  );
}

/** Pay the supplier: any amount, extra is kept as advance. */
function PaySupplierSheet({
  ledger,
  onClose,
  onSaved,
}: {
  ledger: SupplierLedger;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method | null>(null);
  const [note, setNote] = useState("");
  const [paidOn, setPaidOn] = useState(todayIST);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = amount.trim() === "" ? null : Number(amount);
  const left = value !== null && value > 0 ? round2(ledger.outstanding - value) : null;

  async function save() {
    if (value === null || !Number.isFinite(value) || value <= 0) {
      setError("Enter the amount you paid");
      return;
    }
    if (!method) {
      setError("Select Cash, Online or N/A");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.paySupplier(ledger.id, round2(value), {
        method,
        paidAt: paidOn,
        note: note.trim() || null,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the payment");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="pay-supplier-title" busy={saving} onClose={onClose} place="top">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-rose-600 dark:text-rose-400">
            Payment
          </p>
          <h2 id="pay-supplier-title" className="truncate font-display text-[17px] font-bold leading-tight text-ink-900">
            Pay {ledger.name}
            <span className="ml-1.5 text-[13px] font-semibold text-ink-400">
              · To pay{" "}
              <span className="tabular-nums text-ink-700 dark:text-ink-800">
                {balanceText(ledger.outstanding)}
              </span>
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
        id="pay-supplier-amount"
        value={amount}
        tone="gave"
        placeholder={ledger.outstanding > 0 ? String(round2(ledger.outstanding)) : "0"}
        trailing={<EntryDateIcon value={paidOn} onChange={setPaidOn} prefix="Paid on" tone="gave" />}
        onChange={(next) => {
          setAmount(next);
          setError(null);
        }}
      />
      <p
        className={clsx(
          "mt-1.5 min-h-[18px] text-xs font-medium",
          left !== null && left < -0.005 ? "text-emerald-600 dark:text-emerald-400" : "text-ink-500",
        )}
      >
        {left === null
          ? ""
          : left > 0.005
            ? `${formatRupees(left)} will still be pending`
            : left < -0.005
              ? `${formatRupees(-left)} extra kept as advance (used on the next stock)`
              : "Supplier will be fully paid"}
      </p>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {METHODS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={clsx(
              "rounded-xl border px-3 py-2.5 text-sm font-bold transition",
              method === option.value
                ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400"
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
      <input
        className="field sheet-field mt-2"
        autoComplete="off"
        maxLength={200}
        placeholder="Note (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <ErrorNote error={error} />
      <button
        type="button"
        className="mt-3 h-12 w-full rounded-2xl bg-[#D93A3F] text-[15px] font-bold text-white transition hover:bg-[#C5333A] disabled:opacity-60"
        disabled={saving}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : value && value > 0 ? `Save ${formatRupees(value)}` : "Save"}
      </button>
    </Sheet>
  );
}

function UndoSupplierPaymentSheet({
  ledger,
  entry,
  onClose,
  onUndone,
}: {
  ledger: SupplierLedger;
  entry: Entry;
  onClose: () => void;
  onUndone: (updated: SupplierLedger) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const after = round2(ledger.outstanding + entry.gave);

  async function undo() {
    if (!entry.paymentId) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.undoSupplierPayment(ledger.id, entry.paymentId);
      onUndone(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo");
      setSaving(false);
    }
  }

  return (
    <Sheet labelledBy="undo-supplier-title" busy={saving} onClose={onClose}>
      <div className="mb-3 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
          <Undo2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 id="undo-supplier-title" className="font-display text-lg font-bold text-ink-900">
            Undo this payment?
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {formatRupees(entry.gave)} paid to {ledger.name} on {formatDate(entry.date)}
          </p>
        </div>
      </div>
      <div className="rounded-2xl bg-ink-900/[0.04] px-3.5 py-2.5 text-sm dark:bg-white/5">
        <p className="flex items-center justify-between gap-2">
          <span className="text-ink-500">Balance now</span>
          <span className="font-semibold tabular-nums text-ink-900">{balanceText(ledger.outstanding)}</span>
        </p>
        <p className="mt-1 flex items-center justify-between gap-2">
          <span className="text-ink-500">Balance after undo</span>
          <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">{balanceText(after)}</span>
        </p>
      </div>
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
