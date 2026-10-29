import { useState } from "react";
import clsx from "clsx";
import { Loader2, PackageCheck, Trash2 } from "lucide-react";
import { accApi, type AccSale } from "./accApi";
import { Sheet, errorText, plural, refreshCatalog, toast } from "./shared";

/**
 * Cancel bill: two clear choices. Both delete the bill (it leaves sales and
 * the customer's dues); the first also puts its pieces back in stock.
 */
export function CancelBillSheet({
  sale,
  onClose,
  onDeleted,
}: {
  sale: AccSale | null;
  onClose: () => void;
  onDeleted: (stockReturned: boolean) => void;
}) {
  const [busy, setBusy] = useState<"return" | "delete" | null>(null);
  if (!sale) return null;
  const wholesale = sale.kind === "WHOLESALE";
  const pieces = sale.items.reduce((a, i) => a + i.qty, 0);
  const already = Boolean(sale.voidedAt);

  async function run(returnStock: boolean) {
    if (busy || !sale) return;
    setBusy(returnStock ? "return" : "delete");
    try {
      const { data } = await accApi.deleteSale(sale.id, returnStock);
      toast(
        `${wholesale ? sale.number : "Counter sale"} deleted${data.stockReturned ? ` · ${plural(pieces, "pc", "pcs")} back in stock` : ""}`,
      );
      void refreshCatalog();
      onDeleted(data.stockReturned);
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      open
      onClose={() => !busy && onClose()}
      title={`Cancel ${wholesale ? `bill ${sale.number}` : "this sale"}?`}
      subtitle={`${sale.customerName || "Counter sale"} · ${plural(sale.items.length, "item")} · ${pieces} pcs`}
    >
      <div className="acc-cancel-options">
        {!already ? (
          <button type="button" className="acc-cancel-option is-return" onClick={() => void run(true)} disabled={Boolean(busy)}>
            <span className="acc-cancel-icon">{busy === "return" ? <Loader2 className="acc-spin" /> : <PackageCheck />}</span>
            <span>
              <strong>Return to stock</strong>
              <small>
                The bill is deleted and the {pieces} pcs go back in stock, as if never sold.
              </small>
            </span>
          </button>
        ) : null}
        <button type="button" className="acc-cancel-option is-delete" onClick={() => void run(false)} disabled={Boolean(busy)}>
          <span className="acc-cancel-icon">{busy === "delete" ? <Loader2 className="acc-spin" /> : <Trash2 />}</span>
          <span>
            <strong>Delete bill</strong>
            <small>
              {already
                ? "This bill was cancelled earlier and its stock already went back. Remove it for good."
                : "The bill is deleted but the stock is not added back (items damaged, lost or not returned)."}
            </small>
          </span>
        </button>
        <button type="button" className={clsx("acc-btn is-ghost is-block")} onClick={onClose} disabled={Boolean(busy)}>
          Keep the bill
        </button>
      </div>
    </Sheet>
  );
}
