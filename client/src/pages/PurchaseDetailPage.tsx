import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { Plus, SquarePen, Trash2 } from "lucide-react";
import { DangerConfirmModal, RECYCLE_BIN_DAYS } from "../components/RemoveConfirmModals";
import { useAuth } from "../auth/AuthContext";
import { BackButton, BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { EditStockUnitModal } from "../components/EditStockUnitModal";
import { PurchaseEntryOverlay } from "../components/PurchaseEntryModal";
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

/** Same columns without "Purchase price" — staff never see cost. */
const COL_TEMPLATE_STAFF =
  "grid-cols-[minmax(7rem,1.3fr)_4.5rem_4rem_5rem_minmax(7rem,1.1fr)_max-content_max-content] sm:grid-cols-[minmax(9rem,1.4fr)_5rem_4.5rem_6rem_minmax(9rem,1.2fr)_max-content_max-content]";

const ROW_GRID = "col-span-full grid grid-cols-subgrid items-center";

function unitCondition(item: PurchaseStockRef, purchase: Purchase) {
  if (item.condition === "USED" || item.condition === "NEW") return item.condition;
  return purchase.condition === "USED" ? "USED" : "NEW";
}

/** "New", "Second hand", or "New & second hand" once units were switched. */
function purchaseConditionLabel(purchase: Purchase) {
  const conditions = new Set(
    purchase.items.map((row) => unitCondition(row.stockItem, purchase)),
  );
  if (conditions.size > 1) return "New & second hand";
  const only = conditions.values().next().value ?? purchase.condition;
  return only === "USED" ? "Second hand" : "New";
}

function toEditUnit(item: PurchaseStockRef, purchase: Purchase): StockItem {
  return {
    id: item.id,
    condition: unitCondition(item, purchase),
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
  // Set when opened from the Suppliers page model search — mark that unit.
  const highlightStockId =
    location.state && typeof location.state === "object"
      ? ((location.state as { highlightStockId?: unknown }).highlightStockId as
          | string
          | undefined)
      : undefined;
  const { isAdmin } = useAuth();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<PurchaseStockRef | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PurchaseStockRef | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addingMobiles, setAddingMobiles] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  // Bring the highlighted unit into view once, after the purchase loads.
  const scrolledToHighlight = useRef(false);
  useEffect(() => {
    if (!purchase || !highlightStockId || scrolledToHighlight.current) return;
    scrolledToHighlight.current = true;
    document
      .querySelector(`[data-stock-id="${CSS.escape(highlightStockId)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [purchase, highlightStockId]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    setError(null);
    try {
      const { data } = await api.deleteStockItem(pendingDelete.id);
      setPendingDelete(null);
      if (data.purchaseDeleted || !purchaseId) {
        navigate(from ?? `/suppliers/${supplierId || purchase?.supplierId}`, {
          state: supplierState,
          replace: true,
        });
        return;
      }
      const refreshed = await api.getPurchase(purchaseId);
      setPurchase(refreshed.data);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete phone",
      );
    } finally {
      setDeleting(false);
    }
  }

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
      <div className="mb-4 flex items-center justify-between gap-2">
        <BackButton
          className="min-w-0"
          onClick={() => navigate(backTo, { state: supplierState })}
        >
          <span className="truncate">
            Back to {purchase.supplier?.name || "supplier"}
          </span>
        </BackButton>
        <button
          type="button"
          className="btn-primary shrink-0 !px-3 !py-2 text-sm"
          onClick={() => {
            setNotice(null);
            setAddingMobiles(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add mobiles
        </button>
      </div>

      <div className="mb-3">
        <h1 className="font-display text-2xl font-semibold text-ink-900">
          Purchase · {formatDate(purchase.purchaseDate)}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {purchaseConditionLabel(purchase)} ·{" "}
          {purchase.items.length} unit{purchase.items.length === 1 ? "" : "s"}
          {isAdmin ? (
            <>
              {" "}· {formatINR(purchase.totalAmount)}
              {purchase.paidAt
                ? " · Paid"
                : (purchase.paidAmount ?? 0) > 0
                  ? ` · ${formatINR(Math.max(purchase.totalAmount - (purchase.paidAmount ?? 0), 0))} left`
                  : " · Unpaid"}
            </>
          ) : null}
        </p>
      </div>

      {notice ? (
        <div className="mb-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {notice}
        </div>
      ) : null}

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
            <div
              className={clsx(
                "grid",
                isAdmin ? COL_TEMPLATE : COL_TEMPLATE_STAFF,
              )}
            >
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
                {isAdmin ? (
                  <div className="border-r border-[#EEF1F5] px-3 py-2 text-right dark:border-[rgb(var(--color-line))]">
                    Purchase price
                  </div>
                ) : null}
                <div className="border-r border-[#EEF1F5] px-2 py-2 dark:border-[rgb(var(--color-line))]">
                  Status
                </div>
                <div className="px-2 py-2 text-right">Action</div>
              </div>

              {purchase.items.map((row, index) => {
                const item = row.stockItem;
                const sold = item.status === "SOLD";
                // Sold, then sent back to the supplier (replaced / returned): amber, not red.
                const returned = Boolean(item.returned);
                const billId = item.soldBillId ?? item.returned?.billId ?? null;
                const highlighted = item.id === highlightStockId;
                const openBill = () => {
                  if (sold && billId) {
                    navigate(`/bills/${billId}`, { state: fromState(location) });
                  }
                };

                return (
                  <div
                    key={row.id}
                    data-stock-id={item.id}
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
                        !returned &&
                        "bg-rose-50/70 dark:!bg-rose-950/45 dark:hover:!bg-rose-950/60",
                      sold &&
                        !returned &&
                        billId &&
                        "cursor-pointer hover:bg-rose-50 dark:hover:!bg-rose-950/60",
                      returned &&
                        "bg-amber-50/80 dark:!bg-amber-500/10 dark:hover:!bg-amber-500/15",
                      returned && billId && "cursor-pointer hover:bg-amber-50",
                      highlighted &&
                        "shadow-[inset_4px_0_0_rgb(var(--color-tide-500)),inset_0_0_0_2px_rgb(var(--color-tide-500)/0.55)]",
                      highlighted && !sold && "!bg-tide-100",
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
                      {unitCondition(item, purchase) !==
                      (purchase.condition === "USED" ? "USED" : "NEW") ? (
                        <span className="ml-1.5 whitespace-nowrap rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ember-500">
                          {unitCondition(item, purchase) === "USED"
                            ? "Second hand"
                            : "New"}
                        </span>
                      ) : null}
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
                    {isAdmin ? (
                      <div
                        className={clsx(
                          "border-r border-[#EEF1F5] px-3 py-1.5 text-right tabular-nums dark:border-[rgb(var(--color-line))]",
                          sold ? "text-ink-400 dark:!text-ink-500" : "text-ink-500",
                        )}
                      >
                        {formatINR(item.purchasePrice)}
                      </div>
                    ) : null}
                    <div className="relative z-20 whitespace-nowrap border-r border-[#EEF1F5] px-2 py-1.5 dark:border-[rgb(var(--color-line))]">
                      {sold ? (
                        <div className="relative z-20 space-y-0.5">
                          {billId ? (
                            <button
                              type="button"
                              className={clsx(
                                "block max-w-full truncate whitespace-nowrap text-left text-xs font-semibold underline underline-offset-2",
                                returned
                                  ? "text-amber-700 decoration-amber-400/80 hover:text-amber-800 dark:text-amber-300"
                                  : "text-rose-600 decoration-rose-400/80 hover:text-rose-700",
                              )}
                              title={
                                returned && item.returned?.note
                                  ? item.returned.note
                                  : undefined
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`/bills/${billId}`, {
                                  state: fromState(location),
                                });
                              }}
                            >
                              {returned ? "Returned / Replaced" : item.givenAsReplacement ? "Sold as replacement" : "Sold"}
                              {item.soldInvoiceNumber ?? item.returned?.invoiceNumber
                                ? ` · ${item.soldInvoiceNumber ?? item.returned?.invoiceNumber}`
                                : ""}
                            </button>
                          ) : (
                            <span
                              className={clsx(
                                "block truncate whitespace-nowrap text-xs font-semibold",
                                returned ? "text-amber-700 dark:text-amber-300" : "text-rose-600",
                              )}
                            >
                              {returned ? "Returned / Replaced" : item.givenAsReplacement ? "Sold as replacement" : "Sold"}
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
                        <span className="inline-flex whitespace-nowrap rounded border border-tide-500/30 bg-tide-100 px-2 py-0.5 text-xs font-semibold text-bright dark:border-tide-400/40 dark:bg-tide-400/15 dark:text-tide-400">
                          In stock
                        </span>
                      )}
                    </div>

                    <div className="relative z-20 whitespace-nowrap px-2 py-1.5 text-right">
                      {isAdmin ? (
                        <div className="inline-flex items-center justify-end gap-1.5">
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
                          {!sold ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
                              disabled={deleting}
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteError(null);
                                setPendingDelete(item);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </button>
                          ) : null}
                        </div>
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
                          className={clsx(
                            "select-none whitespace-nowrap rounded border bg-white/55 px-4 py-0.5 text-[11px] font-black uppercase shadow-sm sm:text-xs",
                            returned
                              ? "border-amber-500/50 tracking-[0.2em] text-amber-600/80 dark:border-amber-400/40 dark:!bg-amber-500/15 dark:!text-amber-300/80"
                              : "border-rose-500/45 tracking-[0.35em] text-rose-500/75 dark:border-rose-400/40 dark:!bg-rose-500/15 dark:!text-rose-300/80",
                          )}
                          style={{ transform: "rotate(-12deg)" }}
                        >
                          {returned ? "Returned" : "Sold"}
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

      <AnimatePresence>
        {isAdmin && pendingDelete ? (
          <DangerConfirmModal
            undoDays={RECYCLE_BIN_DAYS}
            title="Delete this phone?"
            subtitle={
              <>
                {pendingDelete.mobileName} ·{" "}
                <span className="font-mono">
                  {formatStockUnitId(pendingDelete)}
                </span>
              </>
            }
            points={[
              "The phone is removed from this purchase and from stock.",
              ...(purchase.items.length === 1
                ? ["It's the only phone in the purchase, so the purchase is removed too."]
                : []),
            ]}
            cancelLabel="Keep phone"
            working={deleting}
            error={deleteError}
            onCancel={() => !deleting && setPendingDelete(null)}
            onConfirm={() => void confirmDelete()}
          />
        ) : null}
      </AnimatePresence>

      <PurchaseEntryOverlay
        open={addingMobiles}
        condition={purchase.condition === "USED" ? "USED" : "NEW"}
        fixedSupplier={purchase.supplier ?? null}
        addToPurchaseId={purchase.id}
        onClose={() => setAddingMobiles(false)}
        onCreated={async (updated) => {
          const added = updated.items.length - purchase.items.length;
          setAddingMobiles(false);
          setNotice(
            `Added ${added} mobile${added === 1 ? "" : "s"} to this purchase`,
          );
          try {
            const { data } = await api.getPurchase(purchase.id);
            setPurchase(data);
            setError(null);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Failed to refresh purchase",
            );
          }
        }}
      />

      {editingItem && isAdmin ? (
        <EditStockUnitModal
          unit={toEditUnit(editingItem, purchase)}
          allowSupplierEdit
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
                                condition: updated.condition,
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
          onDeleted={async () => {
            setEditingItem(null);
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
            } catch {
              // Purchase may have been deleted when this was the last unit.
              navigate(`/suppliers/${supplierId}`, {
                replace: true,
                state: supplierState,
              });
            }
          }}
        />
      ) : null}
    </div>
  );
}
