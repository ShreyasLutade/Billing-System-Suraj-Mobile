import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Ban, ChevronDown, Loader2, Search } from "lucide-react";
import { SearchClearButton } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { accApi, type AccSale, type AccSaleKind, type AccSalesSummary, type PeriodQuery } from "./accApi";
import { Empty, PdfButton, PeriodChips, Segmented, Sheet, dateTime, errorText, inr, plural, refreshCatalog, toast } from "./shared";

/**
 * Sales by day. Wholesale bills are listed one by one and open their own
 * page; the counter's retail bills are combined per day by product
 * (Silicone cover × 10), with the single bills one tap away.
 */
export function AccSalesPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodQuery>({ period: "today" });
  const [kind, setKind] = useState<AccSaleKind | "">("");
  const [q, setQ] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [data, setData] = useState<{ sales: AccSale[]; summary: AccSalesSummary } | null>(null);
  const [open, setOpen] = useState<AccSale | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    return accApi
      .listSales({ ...period, kind, q: q.trim(), void: showVoid })
      .then(({ data }) => setData(data))
      .catch((err) => toast(errorText(err), { tone: "error" }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, kind, q, showVoid]);

  const days = useMemo(() => {
    const map = new Map<string, AccSale[]>();
    for (const s of data?.sales || []) {
      const key = new Date(s.saleDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
      map.set(key, [...(map.get(key) || []), s]);
    }
    return [...map.entries()];
  }, [data]);

  const s = data?.summary;

  return (
    <div className="acc-page">
      <div className="acc-title-row">
        <h1>Sales</h1>
        <PdfButton onDownload={() => accApi.pdf.sales({ ...period, kind, items: true, q: q.trim() })} />
      </div>
      <PeriodChips value={period} onChange={setPeriod} />
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "", label: "All" },
          { value: "RETAIL", label: "Retail" },
          { value: "WHOLESALE", label: "Wholesale" },
        ]}
      />

      <div className="acc-kpis">
        <div className="is-main">
          <small>Total sales</small>
          <b>{s ? inr(s.total) : "…"}</b>
          <em>
            {plural(s?.count ?? 0, "bill")} · {s?.items ?? 0} pcs
          </em>
        </div>
        <div>
          <small>Retail</small>
          <b>{s ? inr(s.retailTotal) : "…"}</b>
          <em>{plural(s?.retailCount ?? 0, "bill")}</em>
        </div>
        <div>
          <small>Wholesale</small>
          <b>{s ? inr(s.wholesaleTotal) : "…"}</b>
          <em>{plural(s?.wholesaleCount ?? 0, "bill")}</em>
        </div>
        <div>
          <small>Cash</small>
          <b className="is-green">{s ? inr(s.cash) : "…"}</b>
        </div>
        <div>
          <small>UPI / online</small>
          <b className="is-green">{s ? inr(s.online) : "…"}</b>
        </div>
        <div>
          <small>On credit</small>
          <b className="is-red">{s ? inr(s.due) : "…"}</b>
        </div>
        {isAdmin ? (
          <div>
            <small>Profit</small>
            <b className="is-green">{s ? inr(s.profit) : "…"}</b>
          </div>
        ) : null}
      </div>

      <label className="acc-search">
        <Search aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bill no., customer, item…" />
        <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
      </label>
      <label className="acc-check">
        <input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> Show cancelled bills
      </label>

      {!data ? (
        <div className="acc-loading">
          <Loader2 className="acc-spin" />
        </div>
      ) : data.sales.length ? (
        <div className={clsx("acc-days", loading && "is-stale")}>
          {days.map(([day, list]) => {
            const wholesale = list.filter((x) => x.kind === "WHOLESALE");
            const retail = list.filter((x) => x.kind === "RETAIL");
            return (
              <section key={day}>
                <h3 className="acc-day-head">
                  <span>{day}</span>
                  <b>{inr(list.filter((x) => !x.voidedAt).reduce((a, x) => a + x.total, 0))}</b>
                </h3>
                {wholesale.length ? (
                  <ul className="acc-list">
                    {wholesale.map((sale) => (
                      <li key={sale.id} className={clsx("acc-row", sale.voidedAt && "is-void")}>
                        <button type="button" className="acc-row-main" onClick={() => navigate(`/acc/sales/${sale.id}`)}>
                          <span className="acc-kind is-w">W</span>
                          <span className="acc-row-text">
                            <strong>{sale.customerName}</strong>
                            <small>
                              {sale.number} · {new Date(sale.saleDate).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} ·{" "}
                              {sale.items.reduce((a, i) => a + i.qty, 0)} pcs
                              {sale.voidedAt ? " · CANCELLED" : ""}
                            </small>
                          </span>
                          <span className="acc-row-amt">
                            <b>{inr(sale.total)}</b>
                            <small className={clsx(sale.dueAmount > 0 && "is-red")}>
                              {sale.dueAmount > 0 ? `Due ${inr(sale.dueAmount)}` : "Paid"}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {retail.length ? <CounterDay sales={retail} onOpen={setOpen} /> : null}
              </section>
            );
          })}
        </div>
      ) : (
        <Empty title="No bills in this period" />
      )}

      <SaleSheet
        sale={open}
        onClose={() => setOpen(null)}
        onChanged={(updated) => {
          setOpen(updated);
          void load();
          void refreshCatalog();
        }}
      />
    </div>
  );
}

/** One day's counter (retail) sales, combined by product. */
function CounterDay({ sales, onOpen }: { sales: AccSale[]; onOpen: (sale: AccSale) => void }) {
  const [showBills, setShowBills] = useState(false);
  const live = sales.filter((x) => !x.voidedAt);
  const byProduct = new Map<string, { name: string; qty: number; amount: number }>();
  for (const sale of live) {
    for (const item of sale.items) {
      const key = item.productId || item.name;
      const row = byProduct.get(key) || { name: item.name, qty: 0, amount: 0 };
      row.qty += item.qty;
      row.amount += item.amount;
      byProduct.set(key, row);
    }
  }
  const rows = [...byProduct.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount);
  const total = live.reduce((a, x) => a + x.total, 0);
  const cash = live.reduce((a, x) => a + x.cashAmount, 0);
  const online = live.reduce((a, x) => a + x.onlineAmount, 0);

  return (
    <div className="acc-counter-day">
      <div className="acc-counter-day-head">
        <span className="acc-kind">R</span>
        <span>
          <strong>Counter sales</strong>
          <small>
            {plural(live.length, "bill")} · {rows.reduce((a, r) => a + r.qty, 0)} pcs · Cash {inr(cash)} · UPI {inr(online)}
          </small>
        </span>
        <b>{inr(total)}</b>
      </div>
      <table className="acc-table is-inner">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="is-num is-nowrap">× {r.qty}</td>
              <td className="is-num">{inr(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className={clsx("acc-counter-day-toggle", showBills && "is-open")} onClick={() => setShowBills(!showBills)}>
        {showBills ? "Hide" : "Show"} the {plural(sales.length, "bill")} <ChevronDown aria-hidden />
      </button>
      {showBills ? (
        <ul className="acc-mini-bills">
          {sales.map((sale) => (
            <li key={sale.id} className={clsx(sale.voidedAt && "is-void")}>
              <button type="button" onClick={() => onOpen(sale)}>
                <span>
                  {sale.number} · {new Date(sale.saleDate).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                  <small>
                    {sale.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}
                    {sale.voidedAt ? " · CANCELLED" : ""}
                  </small>
                </span>
                <b>{inr(sale.total)}</b>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SaleSheet({
  sale,
  onClose,
  onChanged,
}: {
  sale: AccSale | null;
  onClose: () => void;
  onChanged: (sale: AccSale) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!sale) return null;

  async function cancelBill() {
    const reason = window.prompt(`Cancel ${sale!.number}? Stock goes back. Reason:`, "");
    if (reason === null) return;
    setBusy(true);
    try {
      const { data } = await accApi.voidSale(sale!.id, reason);
      toast(`${data.number} cancelled`);
      onChanged(data);
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${sale.number}${sale.voidedAt ? " · Cancelled" : ""}`}
      subtitle={`${sale.kind === "WHOLESALE" ? "Wholesale" : "Retail"} · ${dateTime(sale.saleDate)}${sale.createdByName ? ` · ${sale.createdByName}` : ""}`}
      footer={
        <div className="acc-btn-row">
          <PdfButton label="Bill PDF" onDownload={() => accApi.pdf.bill(sale.id)} />
          {!sale.voidedAt ? (
            <button type="button" className="acc-btn is-danger" onClick={() => void cancelBill()} disabled={busy}>
              <Ban /> Cancel bill
            </button>
          ) : null}
        </div>
      }
    >
      {sale.customerName ? (
        <p className="acc-sale-cust">
          {sale.customerId ? <Link to={`/acc/dues/${sale.customerId}`}>{sale.customerName}</Link> : sale.customerName}
          {sale.customerPhone ? ` · ${sale.customerPhone}` : ""}
          {sale.groupName ? ` · ${sale.groupName}` : ""}
        </p>
      ) : null}
      {sale.voidReason ? <p className="acc-hint is-red">Reason: {sale.voidReason}</p> : null}
      <ul className="acc-moves">
        {sale.items.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.qty} × {inr(item.rate, true)}
              </small>
            </span>
            <b>{inr(item.amount, true)}</b>
          </li>
        ))}
      </ul>
      <div className="acc-kv">
        {sale.discount ? (
          <>
            <span>Discount</span>
            <b>−{inr(sale.discount, true)}</b>
          </>
        ) : null}
        <span>Total</span>
        <b>{inr(sale.total, true)}</b>
        {sale.cashAmount ? (
          <>
            <span>Cash</span>
            <b>{inr(sale.cashAmount, true)}</b>
          </>
        ) : null}
        {sale.onlineAmount ? (
          <>
            <span>UPI / online</span>
            <b>{inr(sale.onlineAmount, true)}</b>
          </>
        ) : null}
        {sale.kind === "WHOLESALE" ? (
          <>
            <span>Due on bill</span>
            <b className={clsx(sale.dueAmount > 0 && "is-red")}>{inr(sale.dueAmount, true)}</b>
          </>
        ) : null}
        {sale.note ? (
          <>
            <span>Note</span>
            <b>{sale.note}</b>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
