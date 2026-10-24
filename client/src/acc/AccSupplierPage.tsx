import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import clsx from "clsx";
import { ChevronDown, Loader2, PackagePlus, Phone, Wallet } from "lucide-react";
import { BackLink } from "../components/ui";
import { accApi, type AccSupplierDetail } from "./accApi";
import { Empty, PdfButton, Segmented, Sheet, errorText, inr, plural, shortDate, toast, todayInput } from "./shared";

type Tab = "statement" | "purchases" | "payments";
type Method = "CASH" | "UPI" | "BANK" | "CHEQUE";

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK: "Bank transfer", CHEQUE: "Cheque" };

/**
 * One supplier: what we bought, what we paid and what we still owe, with
 * a statement (running balance) to match against the bank statement.
 */
export function AccSupplierPage() {
  const { id } = useParams();
  const [data, setData] = useState<AccSupplierDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("statement");
  const [paying, setPaying] = useState(false);
  const [openPurchase, setOpenPurchase] = useState<string | null>(null);

  const load = () =>
    id
      ? accApi
          .supplier(id)
          .then(({ data }) => setData(data))
          .catch(() => setMissing(true))
      : undefined;

  useEffect(() => {
    setData(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (missing) {
    return (
      <div className="acc-page">
        <BackLink to="/acc/suppliers">Suppliers</BackLink>
        <Empty title="Supplier not found" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="acc-page">
        <div className="acc-loading">
          <Loader2 className="acc-spin" /> Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="acc-page acc-supplier-page">
      <BackLink to="/acc/suppliers">Suppliers</BackLink>

      <section className="acc-card acc-bill-head">
        <div>
          <small>Supplier{data.group ? ` · ${data.group.name}` : ""}</small>
          <h1 className="acc-h1">{data.name}</h1>
          <span className="acc-bill-meta">{[data.city, data.address, data.phone].filter(Boolean).join(" · ")}</span>
        </div>
        <PdfButton label="Statement" onDownload={() => accApi.pdf.supplier(data.id)} onShare={() => accApi.sharePdf.supplier(data.id)} />
      </section>

      <div className="acc-stat-strip">
        <div>
          <small>Bought</small>
          <b>{inr(data.purchased)}</b>
        </div>
        <div>
          <small>Paid</small>
          <b className="is-green">{inr(data.paid)}</b>
        </div>
        <div>
          <small>To pay</small>
          <b className={clsx(data.balance > 0 && "is-red")}>{inr(data.balance)}</b>
        </div>
        <div>
          <small>Purchases</small>
          <b>
            {data.purchases.length} <span className="acc-stat-sub">· {data.pieces} pcs</span>
          </b>
        </div>
      </div>

      <div className="acc-btn-row is-stretch">
        <button type="button" className="acc-btn is-primary is-big" onClick={() => setPaying(true)}>
          <Wallet /> Pay supplier
        </button>
        <Link className="acc-btn is-big" to="/acc/stock/in" state={{ supplierId: data.id }}>
          <PackagePlus /> Add stock
        </Link>
        {data.phone ? (
          <a className="acc-btn is-big" href={`tel:${data.phone}`}>
            <Phone /> Call
          </a>
        ) : null}
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "statement", label: "Statement" },
          { value: "purchases", label: `Purchases (${data.purchases.length})` },
          { value: "payments", label: `Payments (${data.payments.length})` },
        ]}
      />

      {tab === "statement" ? (
        data.statement.length ? (
          <div className="acc-table-wrap">
            <table className="acc-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th className="is-num">Amount</th>
                  <th className="is-num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.statement.map((e) => (
                  <tr key={`${e.kind}-${e.id}`}>
                    <td className="is-nowrap">{shortDate(e.date)}</td>
                    <td>
                      <strong>{e.kind === "PURCHASE" ? "Purchase" : "Payment"}</strong>
                      <small>
                        {e.detail}
                        {e.reference ? ` · Ref ${e.reference}` : ""}
                      </small>
                    </td>
                    <td className={clsx("is-num", e.credit > 0 && "is-green")}>{e.debit ? inr(e.debit) : `−${inr(e.credit)}`}</td>
                    <td className={clsx("is-num", e.balance > 0 && "is-red")}>
                      <b>{inr(e.balance)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>Closing balance</td>
                  <td />
                  <td className="is-num">{inr(data.balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Empty title="Nothing bought or paid yet" />
        )
      ) : tab === "purchases" ? (
        data.purchases.length ? (
          <ul className="acc-purchase-list">
            {data.purchases.map((p) => {
              const expanded = openPurchase === p.id;
              return (
                <li key={p.id} className={clsx(expanded && "is-open")}>
                  <button type="button" onClick={() => setOpenPurchase(expanded ? null : p.id)}>
                    <span>
                      <strong>{shortDate(p.purchaseDate)}</strong>
                      <small>
                        {plural(p.items.length, "product")} · {p.pieces} pcs
                        {p.billNo ? ` · Bill ${p.billNo}` : ""}
                        {p.createdByName ? ` · ${p.createdByName}` : ""}
                      </small>
                    </span>
                    <b>{inr(p.total)}</b>
                    <ChevronDown aria-hidden />
                  </button>
                  {expanded ? (
                    <table className="acc-table is-inner">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="is-num">Qty</th>
                          <th className="is-num">Cost</th>
                          <th className="is-num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.items.map((i, n) => (
                          <tr key={n}>
                            <td>{i.name}</td>
                            <td className="is-num">{i.qty}</td>
                            <td className="is-num">{inr(i.unitCost, true)}</td>
                            <td className="is-num">{inr(i.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="No purchases yet" />
        )
      ) : data.payments.length ? (
        <div className="acc-table-wrap">
          <table className="acc-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th>Reference</th>
                <th className="is-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td className="is-nowrap">{shortDate(p.paidAt)}</td>
                  <td>
                    {METHOD_LABEL[p.method] || p.method}
                    {p.note ? <small>{p.note}</small> : null}
                  </td>
                  <td className="is-mono">{p.reference || "—"}</td>
                  <td className="is-num is-green">
                    <b>{inr(p.amount)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No payments yet" />
      )}

      <PaySupplierSheet
        open={paying}
        supplier={data}
        onClose={() => setPaying(false)}
        onPaid={() => {
          setPaying(false);
          setTab("payments");
          void load();
        }}
      />
    </div>
  );
}

/** Pay the whole outstanding or part of it; the reference ties it to the bank statement. */
function PaySupplierSheet({
  open,
  supplier,
  onClose,
  onPaid,
}: {
  open: boolean;
  supplier: AccSupplierDetail;
  onClose: () => void;
  onPaid: () => void;
}) {
  const outstanding = Math.max(supplier.balance, 0);
  const [mode, setMode] = useState<"FULL" | "PART">("FULL");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("UPI");
  const [paidAt, setPaidAt] = useState(todayInput());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(outstanding > 0 ? "FULL" : "PART");
    setAmount("");
    setMethod("UPI");
    setPaidAt(todayInput());
    setReference("");
    setNote("");
  }, [open, outstanding]);

  const value = mode === "FULL" ? outstanding : Number(amount) || 0;
  const left = Math.round((outstanding - value) * 100) / 100;

  async function save() {
    if (busy) return;
    if (!(value > 0)) return toast("Enter the amount paid", { tone: "error" });
    if (value > outstanding && !window.confirm(`That is ${inr(value - outstanding)} more than you owe. Save as an advance?`)) return;
    setBusy(true);
    try {
      await accApi.paySupplier(supplier.id, { amount: value, method, paidAt, reference: reference.trim(), note: note.trim() });
      toast(`Paid ${inr(value)} to ${supplier.name}`);
      onPaid();
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pay supplier"
      subtitle={`${supplier.name} · you owe ${inr(outstanding)}`}
      footer={
        <button type="button" className="acc-btn is-primary is-big is-block" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="acc-spin" /> : <Wallet />} Pay {inr(value)}
        </button>
      }
    >
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "FULL", label: `Full ${inr(outstanding)}` },
          { value: "PART", label: "Partial amount" },
        ]}
      />
      {mode === "PART" ? (
        <label className="acc-field">
          <span>Amount ₹ *</span>
          <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
        </label>
      ) : null}
      <div className="acc-field">
        <span>Paid by</span>
        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { value: "UPI", label: "UPI" },
            { value: "BANK", label: "Bank" },
            { value: "CHEQUE", label: "Cheque" },
            { value: "CASH", label: "Cash" },
          ]}
        />
      </div>
      <div className="acc-form-grid">
        <label className="acc-field">
          <span>Date</span>
          <input type="date" value={paidAt} max={todayInput()} onChange={(e) => setPaidAt(e.target.value)} />
        </label>
        {method !== "CASH" ? (
          <label className="acc-field">
            <span>{method === "CHEQUE" ? "Cheque no." : "UTR / reference no."}</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="As on the bank statement" />
          </label>
        ) : null}
      </div>
      <label className="acc-field">
        <span>Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </label>
      {value > 0 ? (
        <p className={clsx("acc-hint", left < 0 && "is-red")}>
          {left > 0 ? `After this you will still owe ${inr(left)}.` : left === 0 ? "This clears the full balance." : `Advance of ${inr(-left)}.`}
        </p>
      ) : null}
    </Sheet>
  );
}
