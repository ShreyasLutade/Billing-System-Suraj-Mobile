import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Plus, X } from "lucide-react";
import { PurchaseEntryModal } from "../components/PurchaseEntryModal";
import { EmptyState, LoadingBlock } from "../components/ui";
import { api, formatINR } from "../lib/api";
import type { Purchase, SupplierDetail } from "../types";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"purchases" | "stock">("purchases");
  const [showPurchase, setShowPurchase] = useState(false);
  const [purchaseCondition, setPurchaseCondition] = useState<"NEW" | "USED">(
    "NEW",
  );
  const [confirmPurchase, setConfirmPurchase] = useState<Purchase | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const { data: detail } = await api.getSupplier(id);
      setData(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load supplier");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function confirmMarkPaid() {
    if (!confirmPurchase) return;
    setMarkingPaid(true);
    setError(null);
    try {
      await api.markPurchasePaid(confirmPurchase.id);
      setConfirmPurchase(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark as paid");
    } finally {
      setMarkingPaid(false);
    }
  }

  if (loading) return <LoadingBlock label="Loading ledger…" />;
  if (!data) {
    return (
      <div className="space-y-3">
        <Link to="/suppliers" className="btn-secondary inline-flex">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <EmptyState
          title="Supplier not found"
          description={error || "This supplier ledger does not exist."}
        />
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/suppliers"
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-tide-600 hover:text-tide-700 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to suppliers
      </Link>

      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900">
            {data.name}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {data.phone ? (
              <a
                href={`tel:${data.phone}`}
                className="font-medium text-tide-600 hover:text-tide-700 hover:underline"
              >
                {data.phone}
              </a>
            ) : (
              "No phone"
            )}{" "}
            · {data.stockAvailable} in stock · {data.purchaseCount} purchase
            {data.purchaseCount === 1 ? "" : "s"}
          </p>
          <p className="mt-2 text-sm">
            <span className="rounded border border-ink-200 bg-ink-50 px-2 py-0.5 font-semibold text-ink-900">
              Outstanding {formatINR(data.outstanding)}
            </span>
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowPurchase(true)}
        >
          <Plus className="h-4 w-4" />
          New purchase
        </button>
      </div>

      {error ? (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-0.5 rounded-lg border border-ink-200 bg-ink-50 p-0.5">
        {(
          [
            { id: "purchases", label: "Purchases" },
            { id: "stock", label: "Stock" },
          ] as const
        ).map((option) => (
          <button
            key={option.id}
            type="button"
            className={
              tab === option.id
                ? "rounded-md bg-ink-900 px-2 py-2 text-xs font-semibold text-white sm:text-sm"
                : "rounded-md px-2 py-2 text-xs font-medium text-ink-600 sm:text-sm"
            }
            onClick={() => setTab(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === "purchases" ? (
        data.purchases.length === 0 ? (
          <EmptyState
            title="No purchases"
            description="Record a purchase to add mobiles from this supplier."
          />
        ) : (
          <div className="overflow-x-auto border border-ink-300 bg-white">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="bg-ink-100 text-ink-700">
                  <th className="border-b border-r border-ink-300 px-2 py-1.5 text-left font-semibold">
                    Date
                  </th>
                  <th className="border-b border-r border-ink-300 px-2 py-1.5 text-left font-semibold">
                    Items
                  </th>
                  <th className="border-b border-r border-ink-300 px-2 py-1.5 text-right font-semibold">
                    Qty
                  </th>
                  <th className="border-b border-r border-ink-300 px-2 py-1.5 text-right font-semibold">
                    Amount
                  </th>
                  <th className="border-b border-ink-300 px-2 py-1.5 text-right font-semibold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.purchases.map((p) => {
                  const paid = Boolean(p.paidAt);
                  return (
                    <tr key={p.id} className="odd:bg-white even:bg-ink-50/60">
                      <td className="border-b border-r border-ink-200 px-2 py-1.5">
                        {formatDate(p.purchaseDate)}
                        <span className="mt-0.5 block text-[11px] uppercase text-ink-400">
                          {p.condition === "USED" ? "Second hand" : "New"}
                        </span>
                      </td>
                      <td className="border-b border-r border-ink-200 px-2 py-1.5">
                        {p.items
                          .slice(0, 3)
                          .map((i) => i.stockItem.mobileName)
                          .join(", ")}
                        {p.items.length > 3 ? ` +${p.items.length - 3}` : ""}
                      </td>
                      <td className="border-b border-r border-ink-200 px-2 py-1.5 text-right tabular-nums">
                        {p.items.length}
                      </td>
                      <td className="border-b border-r border-ink-200 px-2 py-1.5 text-right tabular-nums font-medium">
                        {formatINR(p.totalAmount)}
                      </td>
                      <td className="border-b border-ink-200 px-2 py-1.5 text-right">
                        {paid ? (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50/80 px-2 py-1 text-xs font-semibold text-emerald-600 opacity-60">
                            <Check className="h-3.5 w-3.5" />
                            Paid
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="inline-flex items-center rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 hover:text-rose-700"
                            onClick={() => setConfirmPurchase(p)}
                          >
                            Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "stock" ? (
        data.stockItems.length === 0 ? (
          <EmptyState
            title="No available stock"
            description="All units from this supplier are sold, or none purchased yet."
          />
        ) : (
          <div className="overflow-x-auto border border-ink-300 bg-white">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="bg-ink-100 text-ink-700">
                  <th className="border-b border-r border-ink-300 px-2 py-1.5 text-left font-semibold">
                    Product
                  </th>
                  <th className="border-b border-r border-ink-300 px-2 py-1.5 text-left font-semibold">
                    IMEI
                  </th>
                  <th className="border-b border-ink-300 px-2 py-1.5 text-right font-semibold">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.stockItems.map((item) => (
                  <tr key={item.id} className="odd:bg-white even:bg-ink-50/60">
                    <td className="border-b border-r border-ink-200 px-2 py-1.5">
                      {[
                        item.mobileName,
                        item.color,
                        item.storage,
                        item.ram || null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    <td className="border-b border-r border-ink-200 px-2 py-1.5 font-mono">
                      {item.imei}
                    </td>
                    <td className="border-b border-ink-200 px-2 py-1.5 text-right tabular-nums">
                      {formatINR(item.purchasePrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      <AnimatePresence>
        {showPurchase ? (
          <PurchaseEntryModal
            condition={purchaseCondition}
            fixedSupplier={data}
            onClose={() => setShowPurchase(false)}
            onCreated={async () => {
              setShowPurchase(false);
              await load();
            }}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {confirmPurchase ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !markingPaid && setConfirmPurchase(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="mark-paid-title"
              className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
                    Confirm
                  </p>
                  <h2
                    id="mark-paid-title"
                    className="mt-1 font-display text-xl font-semibold text-ink-900"
                  >
                    Mark this purchase as paid?
                  </h2>
                </div>
                <button
                  type="button"
                  className="rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
                  onClick={() => setConfirmPurchase(null)}
                  disabled={markingPaid}
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-2 px-5 py-4 text-sm text-ink-600">
                <p>
                  <span className="text-ink-500">Date · </span>
                  {formatDate(confirmPurchase.purchaseDate)}
                </p>
                <p>
                  <span className="text-ink-500">Items · </span>
                  {confirmPurchase.items
                    .map((i) => i.stockItem.mobileName)
                    .join(", ")}
                </p>
                <p className="text-base font-semibold text-ink-900">
                  Amount {formatINR(confirmPurchase.totalAmount)}
                </p>
                <p className="text-ink-500">
                  This will reduce outstanding for {data.name}.
                </p>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmPurchase(null)}
                  disabled={markingPaid}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void confirmMarkPaid()}
                  disabled={markingPaid}
                >
                  <Check className="h-4 w-4" />
                  {markingPaid ? "Saving…" : "Confirm paid"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {showPurchase ? (
        <div className="fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 gap-1 rounded-lg border border-ink-200 bg-white p-0.5 shadow-lift md:bottom-6">
          {(["NEW", "USED"] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={
                purchaseCondition === c
                  ? "rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white"
                  : "rounded-md px-3 py-1.5 text-xs font-medium text-ink-600"
              }
              onClick={() => setPurchaseCondition(c)}
            >
              {c === "NEW" ? "New" : "Second hand"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
