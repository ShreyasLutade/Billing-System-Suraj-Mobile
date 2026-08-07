import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, X } from "lucide-react";
import clsx from "clsx";
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
  const navigate = useNavigate();
  const [data, setData] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"purchases" | "stock">("purchases");
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
            <span className="inline-flex flex-wrap items-center gap-2">
              {data.name}
              {data.isExchange ? (
                <span className="rounded border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ember-500">
                  Exchange
                </span>
              ) : null}
            </span>
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
      </div>

      {error ? (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="tb-toolbar !mb-4">
        <div
          className="tb-tabs !mb-0"
          role="tablist"
          aria-label="Supplier sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "purchases"}
            className={clsx("tb-tab", tab === "purchases" && "tb-tab-on")}
            onClick={() => setTab("purchases")}
          >
            Purchases
            <span className="tb-cnt">{data.purchases.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "stock"}
            className={clsx("tb-tab", tab === "stock" && "tb-tab-on")}
            onClick={() => setTab("stock")}
          >
            Stock
            <span className="tb-cnt">{data.stockItems.length}</span>
          </button>
        </div>
      </div>

      {tab === "purchases" ? (
        data.purchases.length === 0 ? (
          <EmptyState
            title="No purchases"
            description="Purchases appear here after you add stock from this supplier."
          />
        ) : (
          <div className="ledger-card">
            <div className="ledger-scroll">
              <table className="ledger-table min-w-[28rem]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.purchases.map((p) => {
                    const paid = Boolean(p.paidAt);
                    return (
                      <tr
                        key={p.id}
                        className="ledger-row-click"
                        onClick={() =>
                          navigate(`/suppliers/${data.id}/purchases/${p.id}`)
                        }
                      >
                        <td className="whitespace-normal text-ink-800">
                          {formatDate(p.purchaseDate)}
                          <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-wide text-ink-300">
                            {p.condition === "USED" ? "Second hand" : "New"}
                          </span>
                        </td>
                        <td className="text-right text-base font-semibold tabular-nums text-ink-900">
                          {p.items.length}
                        </td>
                        <td className="text-right tabular-nums font-semibold text-ink-900">
                          {formatINR(p.totalAmount)}
                        </td>
                        <td className="text-right">
                          {paid ? (
                            <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50/80 px-2 py-1 text-xs font-semibold text-emerald-600">
                              <Check className="h-3.5 w-3.5" />
                              Paid
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="inline-flex items-center rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 hover:text-rose-700"
                              onClick={(event) => {
                                event.stopPropagation();
                                setConfirmPurchase(p);
                              }}
                            >
                              Mark paid
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="ledger-note">
              Tap a row to see each mobile in that purchase.
            </p>
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
          <div className="ledger-card">
            <div className="ledger-scroll">
              <table className="ledger-table min-w-[36rem]">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>IMEI</th>
                    <th className="text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stockItems.map((item) => (
                    <tr key={item.id}>
                      <td className="font-semibold whitespace-normal text-ink-900">
                        {[
                          item.mobileName,
                          item.color,
                          item.storage,
                          item.ram || null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                      <td className="font-mono text-ink-500">{item.imei}</td>
                      <td className="text-right tabular-nums font-bold text-ink-900">
                        {formatINR(item.purchasePrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : null}

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
                  <span className="text-ink-500">Qty · </span>
                  {confirmPurchase.items.length}
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
    </div>
  );
}
