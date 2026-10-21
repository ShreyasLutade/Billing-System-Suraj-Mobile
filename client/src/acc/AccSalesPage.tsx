import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { Ban, Loader2, Search } from "lucide-react";
import { SearchClearButton } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { accApi, type AccSale, type AccSaleKind, type AccSalesSummary, type PeriodQuery } from "./accApi";
import { Empty, PdfButton, PeriodChips, Segmented, Sheet, dateTime, errorText, inr, plural, refreshCatalog, toast } from "./shared";

/** Every retail and wholesale bill, with day totals and cancel (void). */
export function AccSalesPage() {
  const { isAdmin } = useAuth();
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
          {days.map(([day, list]) => (
            <section key={day}>
              <h3 className="acc-day-head">
                <span>{day}</span>
                <b>{inr(list.filter((x) => !x.voidedAt).reduce((a, x) => a + x.total, 0))}</b>
              </h3>
              <ul className="acc-list">
                {list.map((sale) => (
                  <li key={sale.id} className={clsx("acc-row", sale.voidedAt && "is-void")}>
                    <button type="button" className="acc-row-main" onClick={() => setOpen(sale)}>
                      <span className={clsx("acc-kind", sale.kind === "WHOLESALE" && "is-w")}>{sale.kind === "WHOLESALE" ? "W" : "R"}</span>
                      <span className="acc-row-text">
                        <strong>
                          {sale.kind === "WHOLESALE" ? sale.customerName : sale.items.map((i) => i.name).join(", ")}
                        </strong>
                        <small>
                          {sale.number} · {new Date(sale.saleDate).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                          {sale.kind === "WHOLESALE" ? ` · ${sale.items.reduce((a, i) => a + i.qty, 0)} pcs` : ""}
                          {sale.createdByName ? ` · ${sale.createdByName}` : ""}
                          {sale.voidedAt ? " · CANCELLED" : ""}
                        </small>
                      </span>
                      <span className="acc-row-amt">
                        <b>{inr(sale.total)}</b>
                        <small className={clsx(sale.dueAmount > 0 && "is-red")}>
                          {sale.dueAmount > 0 ? `Due ${inr(sale.dueAmount)}` : sale.onlineAmount && !sale.cashAmount ? "UPI" : sale.cashAmount && sale.onlineAmount ? "Split" : "Cash"}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
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
