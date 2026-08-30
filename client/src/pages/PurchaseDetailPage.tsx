import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { SquarePen } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { BackButton, BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { EditStockUnitModal } from "../components/EditStockUnitModal";
import { api, formatINR, formatStockUnitId } from "../lib/api";
import type { Purchase, PurchaseStockRef, StockItem } from "../types";
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

const COL_TEMPLATE =
  "grid-cols-[minmax(7rem,1.3fr)_4.5rem_4rem_5rem_minmax(7rem,1.1fr)_6.5rem_max-content_max-content] sm:grid-cols-[minmax(9rem,1.4fr)_5rem_4.5rem_6rem_minmax(9rem,1.2fr)_7rem_max-content_max-content]";

const ROW_GRID = "col-span-full grid grid-cols-subgrid items-center";

function toEditUnit(item: PurchaseStockRef, purchase: Purchase): StockItem {
  return {
    id: item.id,
    condition:
      item.condition === "USED" || item.condition === "NEW"
        ? item.condition
        : purchase.condition === "USED"
          ? "USED"
          : "NEW",
    platform: item.platform === "ANDROID" ? "ANDROID" : "IOS",
    mobileName: item.mobileName,
    storage: item.storage || "",
    ram: item.ram || "",
    color: item.color || "",
    imei: item.imei,
    serialNumber: item.serialNumber,
    purchasePrice: item.purchasePrice,
    suppliers: purchase.supplier?.name ? [purchase.supplier.name] : [],
    supplierId: purchase.supplierId,
    supplierName: purchase.supplier?.name || null,
    status: item.status,
    createdAt: purchase.createdAt,
    updatedAt: purchase.createdAt,
  };
}

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
  const [editingItem, setEditingItem] = useState<PurchaseStockRef | null>(null);

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
            <div className={clsx("min-w-[52rem] grid", COL_TEMPLATE)}>
              <div
                className={clsx(
                  ROW_GRID,
                  "border-b-2 border-[#DCE2EA] bg-[#F1F4F8] text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 dark:border-[rgb(var(--color-line))] dark:bg-surface-muted",
                )}
              >
                <div className="border-r border-[#EEF1F5] px-3 py-2 dark:border-[rgb(var(--color-line))]">
                  Product
                </div>
                <div className="border-r border-[#EEF1F5] px-3 py-2 dark:border-[rgb(var(--color-line))]">
                  Storage
                </div>
                <div className="border-r border-[#EEF1F5] px-3 py-2 dark:border-[rgb(var(--color-line))]">
                  RAM
                </div>
                <div className="border-r border-[#EEF1F5] px-3 py-2 dark:border-[rgb(var(--color-line))]">
                  Color
                </div>
                <div className="border-r border-[#EEF1F5] px-3 py-2 dark:border-[rgb(var(--color-line))]">
                  IMEI / Serial
                </div>
                <div className="border-r border-[#EEF1F5] px-3 py-2 text-right dark:border-[rgb(var(--color-line))]">
                  Purchase price
                </div>
                <div className="border-r border-[#EEF1F5] px-2 py-2 dark:border-[rgb(var(--color-line))]">
                  Status
                </div>
                <div className="px-2 py-2 text-right">Action</div>
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
                      ROW_GRID,
                      "relative isolate overflow-hidden border-b border-[#EEF1F5] text-[13px] dark:border-[rgb(var(--color-line))]",
                      !sold && (index % 2 === 0 ? "bg-white" : "bg-[#FAFBFC]"),
                      sold &&
                        "bg-rose-50/70 dark:!bg-rose-950/45 dark:hover:!bg-rose-950/60",
                      sold &&
                        billId &&
                        "cursor-pointer hover:bg-rose-50 dark:hover:!bg-rose-950/60",
                    )}
                    title={
                      sold && billId
                        ? `Sold to ${item.soldCustomerName || "customer"} · open bill`
                        : undefined
                    }
                  >
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1.5 font-semibold dark:border-[rgb(var(--color-line))]",
                        sold ? "text-ink-500 dark:!text-rose-200/80" : "text-ink-900",
                      )}
                    >
                      {item.mobileName}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1.5 tabular-nums dark:border-[rgb(var(--color-line))]",
                        sold ? "text-ink-400 dark:!text-ink-500" : "text-ink-500",
                      )}
                    >
                      {item.storage || "—"}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1.5 tabular-nums dark:border-[rgb(var(--color-line))]",
                        sold ? "text-ink-400 dark:!text-ink-500" : "text-ink-500",
                      )}
                    >
                      {item.platform === "ANDROID" && item.ram ? item.ram : "—"}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1.5 dark:border-[rgb(var(--color-line))]",
                        sold ? "text-ink-400 dark:!text-ink-500" : "text-ink-500",
                      )}
                    >
                      {item.color || "—"}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1.5 font-mono text-xs sm:text-[13px] dark:border-[rgb(var(--color-line))]",
                        sold ? "text-ink-400 dark:!text-ink-500" : "text-ink-500",
                      )}
                    >
                      {formatStockUnitId(item)}
                    </div>
                    <div
                      className={clsx(
                        "border-r border-[#EEF1F5] px-3 py-1.5 text-right tabular-nums dark:border-[rgb(var(--color-line))]",
                        sold ? "text-ink-400 dark:!text-ink-500" : "text-ink-500",
                      )}
                    >
                      {formatINR(item.purchasePrice)}
                    </div>
                    <div className="relative z-20 whitespace-nowrap border-r border-[#EEF1F5] px-2 py-1.5 dark:border-[rgb(var(--color-line))]">
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

                    <div className="relative z-20 whitespace-nowrap px-2 py-1.5 text-right">
                      {isAdmin ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded border border-tide-200 bg-tide-50 px-2 py-0.5 text-xs font-semibold text-tide-700 hover:bg-tide-100 dark:border-tide-400/35 dark:bg-tide-100/20 dark:text-tide-400 dark:hover:bg-tide-100/35"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingItem(item);
                          }}
                        >
                          <SquarePen className="h-3 w-3" />
                          Edit
                        </button>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </div>

                    {sold ? (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                      >
                        <span
                          className="select-none whitespace-nowrap rounded border border-rose-500/45 bg-white/55 px-4 py-0.5 text-[11px] font-black uppercase tracking-[0.35em] text-rose-500/75 shadow-sm dark:border-rose-400/40 dark:!bg-rose-500/15 dark:!text-rose-300/80 sm:text-xs"
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

      {editingItem && isAdmin ? (
        <EditStockUnitModal
          unit={toEditUnit(editingItem, purchase)}
          allowSupplierEdit={false}
          onClose={() => setEditingItem(null)}
          onSaved={async (updated) => {
            if (!purchaseId) return;
            try {
              const { data } = await api.getPurchase(purchaseId);
              setPurchase(data);
              setError(null);
              if (supplierId && data.supplierId !== supplierId) {
                navigate(
                  `/suppliers/${data.supplierId}/purchases/${purchaseId}`,
                  { replace: true, state: location.state },
                );
              }
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Failed to refresh purchase",
              );
              setPurchase((current) =>
                current
                  ? {
                      ...current,
                      totalAmount: updated.purchasePrice,
                      items: current.items.map((row) =>
                        row.stockItem.id === updated.id
                          ? {
                              ...row,
                              stockItem: {
                                ...row.stockItem,
                                mobileName: updated.mobileName,
                                purchasePrice: updated.purchasePrice,
                                imei: updated.imei,
                                serialNumber: updated.serialNumber,
                              },
                            }
                          : row,
                      ),
                    }
                  : current,
              );
            }
          }}
        />
      ) : null}
    </div>
  );
}
