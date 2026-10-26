import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import {
  AlertCircle,
  BadgePercent,
  Ban,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MessageCircle,
  Package,
  Phone,
  Smartphone,
  StickyNote,
  Truck,
  UserRound,
  Wallet,
} from "lucide-react";
import { BackLink } from "../components/ui";
import { accApi, type AccCustomerDetail, type AccSale } from "./accApi";
import { CategoryIcon, Empty, PdfButton, dateTime, errorText, inr, plural, refreshCatalog, shortDate, toast, useAccCatalog } from "./shared";

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
  const { catalog } = useAccCatalog();
  const iconFor = (categoryName: string) =>
    catalog?.categories.find((c) => c.name === categoryName)?.icon || "package";

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
              <UserRound /> Customer
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

      {sale.voidedAt ? (
        <div className="acc-bv-void">
          <Ban />
          <span>
            <strong>This {wholesale ? "bill" : "sale"} was cancelled</strong>
            <small>
              {shortDate(sale.voidedAt)}
              {sale.voidReason ? ` · ${sale.voidReason}` : ""} · stock was put back
            </small>
          </span>
        </div>
      ) : null}

      {/* Summary: what the bill is, how much, and how much of it is paid. */}
      <section className={clsx("acc-bv-hero", sale.voidedAt && "is-void")}>
        <div className="acc-bv-hero-top">
          <span className="acc-bv-kind">{wholesale ? "Wholesale bill" : "Retail"}</span>
          <span className={clsx("acc-status", status.tone)}>{status.label}</span>
        </div>
        <div className="acc-bv-hero-main">
          <div>
            <h1>{wholesale ? sale.number : "Counter sale"}</h1>
            <p>
              <CalendarDays /> {dateTime(sale.saleDate)}
              {sale.createdByName ? ` · ${sale.createdByName}` : ""}
            </p>
          </div>
          <div className="acc-bv-total">
            <small>{sale.transportCharge > 0 ? "Amount payable" : "Bill total"}</small>
            <b>{inr(sale.total, true)}</b>
          </div>
        </div>
        {wholesale && !sale.voidedAt && sale.total > 0 ? (
          <div className="acc-bv-progress">
            <div className="acc-bv-bar" role="img" aria-label={`Paid ${inr(sale.total - stillDue)} of ${inr(sale.total)}`}>
              <span style={{ width: `${Math.min(100, ((sale.total - stillDue) / sale.total) * 100)}%` }} />
            </div>
            <div className="acc-bv-progress-text">
              <span className="is-green">
                <CheckCircle2 /> Paid {inr(sale.total - stillDue, true)}
              </span>
              {stillDue > 0 ? (
                <span className="is-red">Due {inr(stillDue, true)}</span>
              ) : (
                <span className="is-green">Fully paid</span>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {sale.customerName ? (
        <Link
          to={sale.customerId ? `/acc/dues/${sale.customerId}` : "#"}
          className={clsx("acc-bv-card acc-bv-customer", !sale.customerId && "is-static")}
          onClick={(e) => {
            if (!sale.customerId) e.preventDefault();
          }}
        >
          <span className="acc-avatar is-big" style={{ ["--g" as string]: "#5d73b6" }}>
            {sale.customerName.slice(0, 1).toUpperCase()}
          </span>
          <span className="acc-bv-customer-text">
            <small>Customer</small>
            <strong>{sale.customerName}</strong>
            <span>{[sale.customerShop, customer?.city, phone].filter(Boolean).join(" · ")}</span>
            {sale.groupName ? <em className="acc-bv-group">{sale.groupName}</em> : null}
          </span>
          {customer ? (
            <span className={clsx("acc-bv-balance", customer.balance > 0 ? "is-due" : customer.balance < 0 ? "is-adv" : "is-clear")}>
              <small>{customer.balance > 0 ? "Owes in total" : customer.balance < 0 ? "Advance" : "Account"}</small>
              <b>{customer.balance === 0 ? "Clear" : inr(Math.abs(customer.balance))}</b>
            </span>
          ) : null}
          {sale.customerId ? <ChevronRight className="acc-bv-chevron" /> : null}
        </Link>
      ) : null}

      <section className="acc-bv-card">
        <header className="acc-bv-card-head">
          <h2>
            <Package /> Items
          </h2>
          <span>
            {plural(sale.items.length, "item")} · {pieces} pcs
          </span>
        </header>
        <ul className="acc-bv-items">
          {sale.items.map((item) => (
            <li key={item.id}>
              <CategoryIcon icon={iconFor(item.categoryName)} variant="3d" size="sm" />
              <span className="acc-bv-item-text">
                <strong>{item.name}</strong>
                <small>
                  <b>{item.qty}</b> {item.qty === 1 ? "pc" : "pcs"} × {inr(item.rate, true)}
                  {item.categoryName ? ` · ${item.categoryName}` : ""}
                </small>
              </span>
              <b className="acc-bv-amount">{inr(item.amount, true)}</b>
            </li>
          ))}
        </ul>
        <div className="acc-bv-subtotal">
          <span>Items total</span>
          <b>{inr(sale.subtotal, true)}</b>
        </div>
      </section>

      <section className="acc-bv-card">
        <header className="acc-bv-card-head">
          <h2>
            <Wallet /> Payment
          </h2>
        </header>
        <ul className="acc-bv-pay">
          {sale.discount || sale.transportCharge > 0 ? (
            <li>
              <span>Items total</span>
              <b>{inr(sale.subtotal, true)}</b>
            </li>
          ) : null}
          {sale.discount ? (
            <li>
              <span>
                <BadgePercent /> Discount
              </span>
              <b className="is-green">−{inr(sale.discount, true)}</b>
            </li>
          ) : null}
          {sale.transportCharge > 0 ? (
            <li>
              <span>
                <Truck /> Transport charges
              </span>
              <b>+{inr(sale.transportCharge, true)}</b>
            </li>
          ) : null}
          <li className="is-total">
            <span>{sale.transportCharge > 0 ? "Amount payable" : "Bill total"}</span>
            <b>{inr(sale.total, true)}</b>
          </li>
          {sale.cashAmount ? (
            <li className="is-paid">
              <span>
                <Banknote /> Paid in cash
              </span>
              <b>{inr(sale.cashAmount, true)}</b>
            </li>
          ) : null}
          {sale.onlineAmount ? (
            <li className="is-paid">
              <span>
                <Smartphone /> Paid by UPI / online
              </span>
              <b>{inr(sale.onlineAmount, true)}</b>
            </li>
          ) : null}
          {wholesale && sale.dueAmount > 0 ? (
            <li>
              <span>
                <Clock /> Left on credit when billed
              </span>
              <b>{inr(sale.dueAmount, true)}</b>
            </li>
          ) : null}
          {sale.dueDate && sale.dueAmount > 0 ? (
            <li className={clsx(open && open.daysOverdue > 0 && "is-late")}>
              <span>
                <CalendarDays /> Promised by
              </span>
              <b>
                {shortDate(sale.dueDate)}
                {open && open.daysOverdue > 0 ? ` · ${plural(open.daysOverdue, "day")} late` : ""}
              </b>
            </li>
          ) : null}
        </ul>
        {wholesale && !sale.voidedAt ? (
          stillDue > 0 ? (
            <div className="acc-bv-result is-due">
              <span>
                <AlertCircle />
                <span>
                  <strong>Still due on this bill</strong>
                  <small>Later payments clear the oldest bills first</small>
                </span>
              </span>
              <b>{inr(stillDue, true)}</b>
            </div>
          ) : (
            <div className="acc-bv-result is-paid">
              <span>
                <CheckCircle2 />
                <strong>This bill is fully paid</strong>
              </span>
            </div>
          )
        ) : null}
      </section>

      {sale.note ? (
        <section className="acc-bv-card acc-bv-note">
          <StickyNote />
          <span>
            <small>Note</small>
            {sale.note}
          </span>
        </section>
      ) : null}
    </div>
  );
}
