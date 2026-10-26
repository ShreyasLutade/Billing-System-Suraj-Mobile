import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Ban, Banknote, ChevronDown, Filter, Loader2, Search, Smartphone } from "lucide-react";
import { SearchClearButton } from "../components/ui";
import { accApi, type AccSale, type AccSaleKind, type AccSaleSearchScope, type PeriodQuery } from "./accApi";
import { Empty, PdfButton, PeriodChips, Segmented, Sheet, dateTime, errorText, inr, plural, refreshCatalog, toast } from "./shared";

/**
 * Wholesale bills and counter sales by day. Wholesale bills open their own
 * page; counter sales are combined per day by product (Silicone cover × 10).
 */
export function AccSalesPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodQuery>({ period: "all" });
  const [kind, setKind] = useState<AccSaleKind | "">("");
  const [q, setQ] = useState("");
  const [searchScope, setSearchScope] = useState<AccSaleSearchScope>("all");
  const [showVoid, setShowVoid] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [data, setData] = useState<{ sales: AccSale[] } | null>(null);
  const [open, setOpen] = useState<AccSale | null>(null);
  const [loading, setLoading] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoading(true);
    return accApi
      .listSales({ ...period, kind, q: q.trim(), scope: searchScope, void: showVoid })
      .then(({ data }) => setData({ sales: data.sales }))
      .catch((err) => toast(errorText(err), { tone: "error" }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, kind, q, searchScope, showVoid]);

  useEffect(() => {
    if (!filterOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [filterOpen]);

  const days = useMemo(() => {
    const map = new Map<string, AccSale[]>();
    for (const s of data?.sales || []) {
      const key = new Date(s.saleDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
      map.set(key, [...(map.get(key) || []), s]);
    }
    return [...map.entries()];
  }, [data]);

  const filtersActive = period.period !== "all" || searchScope !== "all" || showVoid;
  const periodLabel =
    period.period === "custom"
      ? [period.from, period.to].filter(Boolean).join(" to ") || "Custom"
      : ({ today: "Today", yesterday: "Yesterday", week: "This week", month: "This month", last30: "30 days", all: "All time" } as const)[period.period];
  const searchPlaceholder =
    searchScope === "customer"
      ? "Search customer name or phone…"
      : searchScope === "product"
        ? "Search product name…"
        : searchScope === "bill"
          ? "Search bill number…"
          : "Bill no., customer, phone or product…";
  const resultNoun = kind === "RETAIL" ? "sale" : kind === "WHOLESALE" ? "bill" : "entry";

  function resetFilters() {
    setPeriod({ period: "all" });
    setSearchScope("all");
    setShowVoid(false);
  }

  return (
    <div className="acc-page">
      <div className="acc-title-row">
        <h1>Bills</h1>
        <PdfButton
          onDownload={() => accApi.pdf.sales({ ...period, kind, items: true, q: q.trim(), scope: searchScope, void: showVoid })}
          onShare={() => accApi.sharePdf.sales({ ...period, kind, items: true, q: q.trim(), scope: searchScope, void: showVoid })}
        />
      </div>
      <div className="acc-stock-controls acc-bills-controls">
        <div className="acc-stock-search-row">
          <label className="acc-search">
            <Search aria-hidden />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} />
            <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
          </label>
          <div className="acc-stock-filter-wrap" ref={filterRef}>
            <button
              type="button"
              className={clsx("acc-stock-filter-button", filtersActive && "is-active")}
              onClick={() => setFilterOpen((current) => !current)}
              aria-expanded={filterOpen}
              aria-label="Filter bills"
            >
              <Filter />
              <span>Filter</span>
              {filtersActive ? <i /> : null}
            </button>
            {filterOpen ? (
              <div className="acc-stock-filter-menu acc-bills-filter-menu" role="dialog" aria-label="Bill filters">
                <div className="acc-stock-filter-menu-head">
                  <span>Filter bills</span>
                  {filtersActive ? <button type="button" onClick={resetFilters}>Reset</button> : null}
                </div>
                <div className="acc-bills-filter-section">
                  <b>Match search on</b>
                  <div className="acc-bills-filter-chips">
                    {([
                      ["all", "Everything"],
                      ["customer", "Customer"],
                      ["product", "Product"],
                      ["bill", "Bill no."],
                    ] as Array<[AccSaleSearchScope, string]>)
                      .filter(([value]) => value !== "bill" || kind !== "RETAIL")
                      .map(([value, label]) => (
                      <button key={value} type="button" className={clsx(searchScope === value && "is-on")} onClick={() => setSearchScope(value)}>
                        {label}
                      </button>
                      ))}
                  </div>
                </div>
                <div className="acc-bills-filter-section">
                  <b>Period</b>
                  <PeriodChips value={period} onChange={setPeriod} />
                </div>
                <label className="acc-bills-cancelled-filter">
                  <input type="checkbox" checked={showVoid} onChange={(event) => setShowVoid(event.target.checked)} />
                  <span>Include cancelled bills</span>
                </label>
              </div>
            ) : null}
          </div>
        </div>
        <Segmented
          className="acc-bills-kind-tabs"
          value={kind}
          onChange={(nextKind) => {
            setKind(nextKind);
            if (nextKind === "RETAIL" && searchScope === "bill") setSearchScope("all");
          }}
          options={[
            { value: "", label: "All" },
            { value: "RETAIL", label: "Counter sales" },
            { value: "WHOLESALE", label: "Wholesale" },
          ]}
        />
      </div>
      <div className="acc-bills-result-bar">
        <span><b>{plural(data?.sales.length ?? 0, resultNoun)}</b> · {periodLabel}</span>
        {loading ? <Loader2 className="acc-spin" /> : null}
      </div>

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
                  <b>{plural(list.length, kind === "RETAIL" ? "sale" : kind === "WHOLESALE" ? "bill" : "entry")}</b>
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
                              {sale.transportCharge ? ` · transport ${inr(sale.transportCharge)}` : ""}
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
        <Empty title={kind === "RETAIL" ? "No counter sales in this period" : kind === "WHOLESALE" ? "No bills in this period" : "No activity in this period"} />
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
  const [showSales, setShowSales] = useState(false);
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
            {plural(live.length, "sale")} · {rows.reduce((a, r) => a + r.qty, 0)} pcs
          </small>
        </span>
        <b>{inr(total)}</b>
      </div>
      <div className="acc-cd-pay">
        <span className="is-cash">
          <Banknote /> Cash <b>{inr(cash)}</b>
        </span>
        <span className="is-upi">
          <Smartphone /> UPI <b>{inr(online)}</b>
        </span>
      </div>
      <ul className="acc-cd-items">
        {rows.map((r) => (
          <li key={r.name}>
            <span>{r.name}</span>
            <em>{r.qty === 1 ? "1 pc" : `${r.qty} pcs`}</em>
            <b>{inr(r.amount)}</b>
          </li>
        ))}
      </ul>
      <button type="button" className={clsx("acc-counter-day-toggle", showSales && "is-open")} onClick={() => setShowSales(!showSales)}>
        {showSales ? "Hide" : "Show"} the {plural(sales.length, "sale")} <ChevronDown aria-hidden />
      </button>
      {showSales ? (
        <ul className="acc-mini-bills">
          {sales.map((sale) => (
            <li key={sale.id} className={clsx(sale.voidedAt && "is-void")}>
              <button type="button" onClick={() => onOpen(sale)}>
                <span>
                  {new Date(sale.saleDate).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
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
    const reason = window.prompt(
      sale!.kind === "WHOLESALE" ? `Cancel ${sale!.number}? Stock goes back. Reason:` : "Cancel this counter sale? Stock goes back. Reason:",
      "",
    );
    if (reason === null) return;
    setBusy(true);
    try {
      const { data } = await accApi.voidSale(sale!.id, reason);
      toast(data.kind === "WHOLESALE" ? `${data.number} cancelled` : "Counter sale cancelled");
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
      title={`${sale.kind === "WHOLESALE" ? sale.number : "Counter sale"}${sale.voidedAt ? " · Cancelled" : ""}`}
      subtitle={`${sale.kind === "WHOLESALE" ? "Wholesale bill" : "Sale"} · ${dateTime(sale.saleDate)}${sale.createdByName ? ` · ${sale.createdByName}` : ""}`}
      footer={
        <div className="acc-btn-row">
          {sale.kind === "WHOLESALE" ? (
            <PdfButton label="Bill" onDownload={() => accApi.pdf.bill(sale.id)} onShare={() => accApi.sharePdf.bill(sale.id)} />
          ) : null}
          {!sale.voidedAt ? (
            <button type="button" className="acc-btn is-danger" onClick={() => void cancelBill()} disabled={busy}>
              <Ban /> Cancel {sale.kind === "WHOLESALE" ? "bill" : "sale"}
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
        {sale.transportCharge ? (
          <>
            <span>Transport charges</span>
            <b>{inr(sale.transportCharge, true)}</b>
          </>
        ) : null}
        <span>{sale.transportCharge ? "Amount payable" : "Total"}</span>
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
