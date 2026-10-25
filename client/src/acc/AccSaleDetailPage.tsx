import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { Ban, Loader2, MessageCircle, Phone, UserRound } from "lucide-react";
import { BackLink } from "../components/ui";
import { accApi, type AccCustomerDetail, type AccSale } from "./accApi";
import { Empty, PdfButton, dateTime, errorText, inr, plural, refreshCatalog, shortDate, toast } from "./shared";

/**
 * One wholesale bill on its own page: who bought, what, how it was paid and
 * what is still due on it. Counter records may also open here from old links.
 */
export function AccSaleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sale, setSale] = useState<AccSale | null>(null);
  const [customer, setCustomer] = useState<AccCustomerDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!id) return;
    try {
      const { data } = await accApi.getSale(id);
      setSale(data);
      if (data.customerId) {
        accApi
          .customer(data.customerId)
          .then(({ data: c }) => setCustomer(c))
          .catch(() => undefined);
      }
    } catch {
      setMissing(true);
    }
  };

  useEffect(() => {
    setSale(null);
    setCustomer(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (missing) {
    return (
      <div className="acc-page">
        <BackLink to="/acc/sales" historyBack>Bills</BackLink>
        <Empty title="Bill not found">It may have been removed.</Empty>
      </div>
    );
  }
  if (!sale) {
    return (
      <div className="acc-page">
        <div className="acc-loading">
          <Loader2 className="acc-spin" /> Loading…
        </div>
      </div>
    );
  }

  const wholesale = sale.kind === "WHOLESALE";
  const paid = sale.cashAmount + sale.onlineAmount;
  // What is still open on this bill after later payments (oldest bills are cleared first).
  const open = customer?.openBills.find((b) => b.saleId === sale.id);
  const stillDue = sale.voidedAt ? 0 : customer ? open?.open ?? 0 : sale.dueAmount;
  const status = sale.voidedAt
    ? { label: "Cancelled", tone: "is-grey" }
    : stillDue <= 0
      ? { label: "Paid in full", tone: "is-green" }
      : paid > 0 || stillDue < sale.dueAmount
        ? { label: "Partly paid", tone: "is-amber" }
        : { label: "On credit", tone: "is-red" };
  const pieces = sale.items.reduce((a, i) => a + i.qty, 0);
  const phone = customer?.phone || sale.customerPhone;
  const message = [
    wholesale ? `Bill ${sale.number} · ${shortDate(sale.saleDate)}` : `Counter sale · ${shortDate(sale.saleDate)}`,
    ...sale.items.map((i) => `${i.qty} × ${i.name} @ ${i.rate}`),
    sale.transportCharge > 0 ? `Transport charges: ₹${sale.transportCharge}` : "",
    `Total: ₹${sale.total}`,
    `Paid: ₹${paid}`,
    stillDue > 0 ? `Due: ₹${stillDue}${sale.dueDate ? ` by ${shortDate(sale.dueDate)}` : ""}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  async function cancelBill() {
    const reason = window.prompt(
      sale!.kind === "WHOLESALE" ? `Cancel ${sale!.number}? Stock goes back. Reason:` : "Cancel this counter sale? Stock goes back. Reason:",
      "",
    );
    if (reason === null) return;
    setBusy(true);
    try {
      const { data } = await accApi.voidSale(sale!.id, reason);
      toast(data.kind === "WHOLESALE" ? `${data.number} cancelled` : "Counter sale cancelled");
      void refreshCatalog();
      await load();
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acc-page acc-bill-page">
      <div className="acc-bill-topbar">
        <BackLink to="/acc/sales" historyBack>Bills</BackLink>
        <div className="acc-bill-top-actions">
          {wholesale ? (
            <PdfButton
              actionLabels
              className="has-action-labels"
              onDownload={() => accApi.pdf.bill(sale.id)}
              onShare={() => accApi.sharePdf.bill(sale.id)}
            />
          ) : null}
          {sale.customerId ? (
            <button type="button" className="acc-btn is-ghost" onClick={() => navigate(`/acc/dues/${sale.customerId}`)}>
              <UserRound /> Customer account
            </button>
          ) : null}
          {phone ? (
            <>
              <a className="acc-btn is-ghost" href={`tel:${phone}`}>
                <Phone /> Call
              </a>
              <a className="acc-btn is-ghost" target="_blank" rel="noreferrer" href={`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`}>
                <MessageCircle /> WhatsApp
              </a>
            </>
          ) : null}
          {!sale.voidedAt ? (
            <button type="button" className="acc-btn is-danger" onClick={() => void cancelBill()} disabled={busy}>
              {busy ? <Loader2 className="acc-spin" /> : <Ban />} Cancel {wholesale ? "bill" : "sale"}
            </button>
          ) : null}
        </div>
      </div>

      <article className="acc-bill-document">
        <header className="acc-bill-head">
          <div>
            <small>{wholesale ? "Wholesale bill" : "Counter sale"}</small>
            <h1 className="acc-h1">{wholesale ? sale.number : "Sale details"}</h1>
            <span className="acc-bill-meta">
              {dateTime(sale.saleDate)}
              {sale.createdByName ? ` · by ${sale.createdByName}` : ""}
            </span>
          </div>
          <span className={clsx("acc-status", status.tone)}>{status.label}</span>
        </header>

        {sale.voidReason ? <p className="acc-warn-text acc-bill-cancel-note">Cancelled: {sale.voidReason}</p> : null}

        {sale.customerName ? (
          <section className="acc-bill-section acc-bill-customer-section">
            <span className="acc-bill-section-label">Customer</span>
            <div className="acc-bill-customer">
              <span>
                <strong>
                  {sale.customerId ? <Link to={`/acc/dues/${sale.customerId}`}>{sale.customerName}</Link> : sale.customerName}
                </strong>
                <small>{[sale.customerShop, customer?.city, phone, sale.groupName].filter(Boolean).join(" · ")}</small>
              </span>
              {customer ? (
                <span className="acc-bill-balance">
                  <small>Total balance</small>
                  <b className={clsx(customer.balance > 0 && "is-red")}>{inr(customer.balance)}</b>
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="acc-bill-section acc-bill-items-section">
          <div className="acc-bill-section-heading">
            <span className="acc-bill-section-label">Items</span>
            <small>{plural(sale.items.length, "item")} · {pieces} pcs</small>
          </div>
          <div className="acc-table-wrap acc-bill-items-table">
          <table className="acc-table">
            <thead>
              <tr>
                <th className="is-num">#</th>
                <th>Item</th>
                <th className="is-num">Qty</th>
                <th className="is-num">Rate</th>
                <th className="is-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item, i) => (
                <tr key={item.id}>
                  <td className="is-num is-muted">{i + 1}</td>
                  <td>
                    <strong>{item.name}</strong>
                    {item.categoryName ? <small>{item.categoryName}</small> : null}
                  </td>
                  <td className="is-num">{item.qty}</td>
                  <td className="is-num">{inr(item.rate, true)}</td>
                  <td className="is-num">
                    <b>{inr(item.amount, true)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Total</td>
                <td className="is-num">{pieces}</td>
                <td />
                <td className="is-num">{inr(sale.subtotal, true)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </section>

        <section className="acc-bill-section acc-bill-payment-section">
          <span className="acc-bill-section-label">Payment summary</span>
          <div className="acc-kv acc-bill-payment-kv">
          {sale.discount ? (
            <>
              <span>Discount</span>
              <b>−{inr(sale.discount, true)}</b>
            </>
          ) : null}
          {sale.transportCharge > 0 ? (
            <>
              <span>Items after discount</span>
              <b>{inr(sale.total - sale.transportCharge, true)}</b>
              <span>Transport charges</span>
              <b>{inr(sale.transportCharge, true)}</b>
            </>
          ) : null}
          <span>{sale.transportCharge > 0 ? "Amount payable" : "Bill total"}</span>
          <b>{inr(sale.total, true)}</b>
          {sale.cashAmount ? (
            <>
              <span>Paid in cash</span>
              <b className="is-green">{inr(sale.cashAmount, true)}</b>
            </>
          ) : null}
          {sale.onlineAmount ? (
            <>
              <span>Paid by UPI / online</span>
              <b className="is-green">{inr(sale.onlineAmount, true)}</b>
            </>
          ) : null}
          {wholesale ? (
            <>
              <span>Due when billed</span>
              <b>{inr(sale.dueAmount, true)}</b>
            </>
          ) : null}
          {sale.dueDate && sale.dueAmount > 0 ? (
            <>
              <span>Pay by</span>
              <b className={clsx(open && open.daysOverdue > 0 && "is-red")}>
                {shortDate(sale.dueDate)}
                {open && open.daysOverdue > 0 ? ` · ${plural(open.daysOverdue, "day")} late` : ""}
              </b>
            </>
          ) : null}
          </div>
          {wholesale && !sale.voidedAt ? (
            stillDue > 0 ? (
              <div className="acc-due-line">
                <span>Still due on this bill</span>
                <b>{inr(stillDue, true)}</b>
              </div>
            ) : (
              <p className="acc-paid-line">This bill is fully paid</p>
            )
          ) : null}
          {sale.note ? <p className="acc-hint acc-bill-note">Note: {sale.note}</p> : null}
        </section>
      </article>
    </div>
  );
}
