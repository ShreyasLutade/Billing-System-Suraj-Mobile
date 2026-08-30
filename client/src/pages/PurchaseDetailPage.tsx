import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { BackButton, BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { api, formatINR, formatStockUnitId } from "../lib/api";
import type { Purchase } from "../types";
import { fromState, readFromState, readOriginState } from "../lib/navMemory";

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

const COLS =
  "grid grid-cols-[minmax(7rem,1.3fr)_4.5rem_4rem_5rem_minmax(7rem,1.1fr)_6.5rem_minmax(9rem,11rem)] sm:grid-cols-[minmax(9rem,1.4fr)_5rem_4.5rem_6rem_minmax(9rem,1.2fr)_7rem_minmax(10rem,12rem)]";

export function PurchaseDetailPage() {
  const { id: supplierId, purchaseId } = useParams<{
    id: string;
    purchaseId: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from = readFromState(location.state);
  const origin = readOriginState(location.state);
  const supplierState = origin ? { from: origin } : undefined;
  const { isAdmin } = useAuth();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!purchaseId) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.getPurchase(purchaseId);
        if (!active) return;
        if (supplierId && data.supplierId !== supplierId) {
          setError("This purchase does not belong to this supplier");
          setPurchase(null);
        } else {
          setPurchase(data);
          setError(null);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load purchase");
        setPurchase(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [purchaseId, supplierId]);

  if (loading) return <LoadingBlock label="Loading purchase…" />;

  if (!purchase) {
    return (
      <div className="space-y-3">
        <BackLink
          to={from ?? (supplierId ? `/suppliers/${supplierId}` : "/suppliers")}
          state={supplierState}
        >
          Back
        </BackLink>
        <EmptyState
          title="Purchase not found"
          description={error || "This purchase does not exist."}
        />
      </div>
    );
  }

  const backTo = from ?? `/suppliers/${purchase.supplierId}`;

  return (
    <div>
      <BackButton
        className="mb-4"
        onClick={() => navigate(backTo, { state: supplierState })}
      >
        Back to {purchase.supplier?.name || "supplier"}
      </BackButton>

      <div className="mb-3">
        <h1 className="font-display text-2xl font-semibold text-ink-900">
          Purchase · {formatDate(purchase.purchaseDate)}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {purchase.condition === "USED" ? "Second hand" : "New"} ·{" "}
          {purchase.items.length} unit{purchase.items.length === 1 ? "" : "s"} ·{" "}
          {formatINR(purchase.totalAmount)}
          {purchase.paidAt ? " · Paid" : " · Unpaid"}
        </p>
      </div>

      {error ? (
        <div className="mb-2 border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {purchase.items.length === 0 ? (
        <EmptyState
          title="No mobiles in this purchase"
          description="This purchase has no stock units linked."
        />
      ) : (
        <div className="ledger-card">
          <div className="ledger-scroll">
            <div className="min-w-[52rem]">
              <div
                className={clsx(
                  COLS,
                  "border-b-2 border-[#DCE2EA] bg-[#F1F4F8] text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500",
                )}
              >
                <div className="border-r border-[#EEF1F5] px-3 py-2">Product</div>
                <div className="border-r border-[#EEF1F5] px-3 py-2">Storage</div>
                <div className="border-r border-[#EEF1F5] px-3 py-2">RAM</div>
                <div className="border-r border-[#EEF1F5] px-3 py-2">Color</div>
                <div className="border-r border-[#EEF1F5] px-3 py-2">IMEI / Serial</div>
                <div className="border-r border-[#EEF1F5] px-3 py-2 text-right">
                  Purchase price
                </div>
                <div className="px-3 py-2">Status</div>
              </div>

              {purchase.items.map((row, index) => {
                const item = row.stockItem;
                const sold = item.status === "SOLD";
                const billId = item.soldBillId;
                const openBill = () => {
                  if (sold && billId) {
                    navigate(`/bills/${billId}`, { state: fromState(location) });
                  }
                };

                return (
                  <div
                    key={row.id}
                    role={sold && billId ? "link" : undefined}
                    tabIndex={sold && billId ? 0 : undefined}
                    onClick={openBill}
                    onKeyDown={(event) => {
                      if (
                        sold &&
                        billId &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        openBill();
                      }
                    }}
                    className={clsx(
                      COLS,
                      "relative isolate overflow-hidden border-b border-[#EEF1F5] text-[13px]",
                      !sold && (index % 2 === 0 ? "bg-white" : "bg-[#FAFBFC]"),
                      sold && "bg-rose-50/70",
                      sold && billId && "cursor-pointer hover:bg-rose-50",
                    )}
                    title={
                      sold && billId
                        ? `Sold to ${item.soldCustomerName || "customer"} · open bill`
                        : undefined
                    }
                  >
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1 font-semibold",
                        sold ? "text-ink-400" : "text-ink-900",
                      )}
                    >
                      {item.mobileName}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1 tabular-nums",
                        sold ? "text-ink-400" : "text-ink-500",
                      )}
                    >
                      {item.storage || "—"}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1 tabular-nums",
                        sold ? "text-ink-400" : "text-ink-500",
                      )}
                    >
                      {item.platform === "ANDROID" && item.ram ? item.ram : "—"}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1",
                        sold ? "text-ink-400" : "text-ink-500",
                      )}
                    >
                      {item.color || "—"}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1 font-mono text-xs sm:text-[13px]",
                        sold ? "text-ink-400" : "text-ink-500",
                      )}
                    >
                      {formatStockUnitId(item)}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1 text-right tabular-nums",
                        sold ? "text-ink-400" : "text-ink-500",
                      )}
                    >
                      {formatINR(item.purchasePrice)}
                    </div>
                    <div className="relative z-20 min-w-0 px-3 py-1">
                      {sold ? (
                        <div className="relative z-20 space-y-0.5">
                          {billId ? (
                            <button
                              type="button"
                              className="block max-w-full truncate whitespace-nowrap text-left text-xs font-semibold text-rose-600 underline decoration-rose-400/80 underline-offset-2 hover:text-rose-700"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`/bills/${billId}`, {
                                  state: fromState(location),
                                });
                              }}
                            >
                              Sold
                              {item.soldInvoiceNumber
                                ? ` · ${item.soldInvoiceNumber}`
                                : ""}
                            </button>
                          ) : (
                            <span className="block truncate whitespace-nowrap text-xs font-semibold text-rose-600">
                              Sold
                            </span>
                          )}
                          {isAdmin &&
                          item.soldPrice != null &&
                          Number.isFinite(item.soldPrice) ? (
                            <p className="truncate text-xs font-semibold tabular-nums text-ink-700">
                              @ {formatINR(item.soldPrice)}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="inline-flex whitespace-nowrap rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-400">
                          In stock
                        </span>
                      )}
                    </div>

                    {sold ? (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                      >
                        <span
                          className="select-none whitespace-nowrap rounded border border-rose-500/45 bg-white/55 px-4 py-0.5 text-[11px] font-black uppercase tracking-[0.35em] text-rose-500/75 shadow-sm sm:text-xs"
                          style={{ transform: "rotate(-12deg)" }}
                        >
                          Sold
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="ledger-note">
            Tap a sold row or the bill link to open the customer bill.
          </p>
        </div>
      )}
    </div>
  );
}
