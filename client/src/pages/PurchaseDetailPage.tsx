import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { EmptyState, LoadingBlock } from "../components/ui";
import { api, formatINR } from "../lib/api";
import type { Purchase } from "../types";

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
  "grid grid-cols-[minmax(7rem,1.3fr)_4.5rem_4rem_5rem_minmax(7rem,1.1fr)_6.5rem_minmax(8.5rem,9.5rem)] sm:grid-cols-[minmax(9rem,1.4fr)_5rem_4.5rem_6rem_minmax(9rem,1.2fr)_7rem_minmax(9rem,10.5rem)]";

export function PurchaseDetailPage() {
  const { id: supplierId, purchaseId } = useParams<{
    id: string;
    purchaseId: string;
  }>();
  const navigate = useNavigate();
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
        <Link
          to={supplierId ? `/suppliers/${supplierId}` : "/suppliers"}
          className="btn-secondary inline-flex"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <EmptyState
          title="Purchase not found"
          description={error || "This purchase does not exist."}
        />
      </div>
    );
  }

  const backTo = `/suppliers/${purchase.supplierId}`;

  return (
    <div>
      <button
        type="button"
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-tide-600 hover:text-tide-700 hover:underline"
        onClick={() => navigate(backTo)}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {purchase.supplier?.name || "supplier"}
      </button>

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
        <div className="overflow-x-auto border border-ink-300 bg-white">
          <div className="min-w-[52rem]">
            <div
              className={`${COLS} border-b border-ink-300 bg-ink-100 text-sm font-semibold text-ink-700`}
            >
              <div className="border-r border-ink-300 px-2 py-1.5">Product</div>
              <div className="border-r border-ink-300 px-2 py-1.5">Storage</div>
              <div className="border-r border-ink-300 px-2 py-1.5">RAM</div>
              <div className="border-r border-ink-300 px-2 py-1.5">Color</div>
              <div className="border-r border-ink-300 px-2 py-1.5">IMEI</div>
              <div className="border-r border-ink-300 px-2 py-1.5 text-right">
                Purchase price
              </div>
              <div className="px-2 py-1.5">Status</div>
            </div>

            {purchase.items.map((row, index) => {
              const item = row.stockItem;
              const sold = item.status === "SOLD";
              const billId = item.soldBillId;
              const openBill = () => {
                if (sold && billId) navigate(`/bills/${billId}`);
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
                  className={[
                    COLS,
                    "relative isolate overflow-hidden border-b border-ink-200 text-sm",
                    !sold && (index % 2 === 0 ? "bg-white" : "bg-ink-50/60"),
                    sold ? "bg-rose-50/70" : "",
                    sold && billId ? "cursor-pointer hover:bg-rose-50" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={
                    sold && billId
                      ? `Sold to ${item.soldCustomerName || "customer"} · open bill`
                      : undefined
                  }
                >
                  <div
                    className={[
                      "border-r border-ink-200 px-2 py-2 font-medium",
                      sold ? "text-ink-400" : "text-ink-900",
                    ].join(" ")}
                  >
                    {item.mobileName}
                  </div>
                  <div
                    className={[
                      "border-r border-ink-200 px-2 py-2 tabular-nums",
                      sold ? "text-ink-400" : "text-ink-800",
                    ].join(" ")}
                  >
                    {item.storage || "—"}
                  </div>
                  <div
                    className={[
                      "border-r border-ink-200 px-2 py-2 tabular-nums",
                      sold ? "text-ink-400" : "text-ink-800",
                    ].join(" ")}
                  >
                    {item.platform === "ANDROID" && item.ram ? item.ram : "—"}
                  </div>
                  <div
                    className={[
                      "border-r border-ink-200 px-2 py-2",
                      sold ? "text-ink-400" : "text-ink-800",
                    ].join(" ")}
                  >
                    {item.color || "—"}
                  </div>
                  <div
                    className={[
                      "border-r border-ink-200 px-2 py-2 font-mono text-xs sm:text-sm",
                      sold ? "text-ink-400" : "text-ink-600",
                    ].join(" ")}
                  >
                    {item.imei}
                  </div>
                  <div
                    className={[
                      "border-r border-ink-200 px-2 py-2 text-right tabular-nums",
                      sold ? "text-ink-400" : "text-ink-800",
                    ].join(" ")}
                  >
                    {formatINR(item.purchasePrice)}
                  </div>
                  <div className="relative z-20 min-w-0 px-2 py-2">
                    {sold ? (
                      billId ? (
                        <button
                          type="button"
                          className="relative z-20 block max-w-full truncate whitespace-nowrap text-left text-xs font-semibold text-rose-600 underline decoration-rose-400/80 underline-offset-2 hover:text-rose-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/bills/${billId}`);
                          }}
                        >
                          Sold
                          {item.soldInvoiceNumber
                            ? ` · ${item.soldInvoiceNumber}`
                            : ""}
                        </button>
                      ) : (
                        <span className="relative z-20 block truncate whitespace-nowrap text-xs font-semibold text-rose-600">
                          Sold
                        </span>
                      )
                    ) : (
                      <span className="inline-flex whitespace-nowrap rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
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
          <p className="border-t border-ink-200 px-2 py-1 text-[11px] text-ink-400">
            Tap a sold row or the bill link to open the customer bill.
          </p>
        </div>
      )}
    </div>
  );
}
