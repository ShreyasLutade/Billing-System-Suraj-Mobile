import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AlertTriangle, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { accApi, type AccAnalytics, type PeriodQuery } from "./accApi";
import { AgingBar } from "./AccDuesPage";
import { Empty, PdfButton, PeriodChips, inr, errorText, toast } from "./shared";

/** Accessories business at a glance: sales, profit, what sells, who owes. */
export function AccAnalyticsPage() {
  const [period, setPeriod] = useState<PeriodQuery>({ period: "month" });
  const [data, setData] = useState<AccAnalytics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (period.period === "custom" && (!period.from || !period.to)) return;
    setLoading(true);
    accApi
      .analytics(period)
      .then(({ data }) => setData(data))
      .catch((err) => toast(errorText(err), { tone: "error" }))
      .finally(() => setLoading(false));
  }, [period]);

  const t = data?.totals;
  const growth = data?.previous && data.previous.revenue > 0 ? ((t!.revenue - data.previous.revenue) / data.previous.revenue) * 100 : null;

  return (
    <div className="acc-page acc-analytics">
      <div className="acc-title-row">
        <h1>Analytics</h1>
        <PdfButton label="Report" onDownload={() => accApi.pdf.analytics(period)} />
      </div>
      <PeriodChips value={period} onChange={setPeriod} />

      {!data || !t ? (
        <div className="acc-loading">
          <Loader2 className="acc-spin" />
        </div>
      ) : (
        <div className={clsx(loading && "is-stale")}>
          <div className="acc-kpis">
            <div className="is-main">
              <small>Total sales</small>
              <b>{inr(t.revenue)}</b>
              <em>
                {growth !== null ? (
                  <span className={clsx("acc-growth", growth >= 0 ? "is-up" : "is-down")}>
                    {growth >= 0 ? <TrendingUp /> : <TrendingDown />}
                    {Math.abs(Math.round(growth))}% vs previous
                  </span>
                ) : (
                  `${t.bills} bills`
                )}
              </em>
            </div>
            <div>
              <small>Profit</small>
              <b className="is-green">{inr(t.profit)}</b>
              <em>{t.margin}% margin</em>
            </div>
            <div>
              <small>Bills</small>
              <b>{t.bills}</b>
              <em>avg {inr(t.avgBill)}</em>
            </div>
            <div>
              <small>Pieces sold</small>
              <b>{t.pieces}</b>
            </div>
            <div>
              <small>Collected</small>
              <b className="is-green">{inr(t.cash + t.online + t.collected)}</b>
              <em>
                cash {inr(t.cash)} · UPI {inr(t.online)}
              </em>
            </div>
            <div>
              <small>Credit given</small>
              <b className="is-red">{inr(t.creditGiven)}</b>
              <em>dues received {inr(t.collected)}</em>
            </div>
          </div>

          <section className="acc-card">
            <h3 className="acc-card-title">Retail vs wholesale</h3>
            <SplitBar retail={t.retail} wholesale={t.wholesale} />
            <div className="acc-split-legend">
              <span>
                <i className="acc-sw is-retail" /> Retail <b>{inr(t.retail)}</b> · {t.retailBills} bills · profit {inr(t.retailProfit)}
              </span>
              <span>
                <i className="acc-sw is-wholesale" /> Wholesale <b>{inr(t.wholesale)}</b> · {t.wholesaleBills} bills · profit{" "}
                {inr(t.wholesaleProfit)}
              </span>
            </div>
          </section>

          <section className="acc-card">
            <h3 className="acc-card-title">Sales {data.trend.byMonth ? "by month" : "by day"}</h3>
            <TrendChart rows={data.trend.rows} byMonth={data.trend.byMonth} />
          </section>

          <div className="acc-two-col">
            <section className="acc-card">
              <h3 className="acc-card-title">By category</h3>
              {data.categories.length ? (
                <HBars
                  rows={data.categories.map((c) => ({ key: c.name, label: c.name, value: c.revenue, note: `${c.qty} pcs · profit ${inr(c.profit)}` }))}
                />
              ) : (
                <Empty title="No sales yet" />
              )}
            </section>

            <section className="acc-card">
              <h3 className="acc-card-title">Top products</h3>
              {data.topProducts.length ? (
                <ol className="acc-rank">
                  {data.topProducts.map((p) => (
                    <li key={p.name}>
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.category || "Custom"} · {p.qty} pcs · profit {inr(p.profit)}
                        </small>
                      </span>
                      <b>{inr(p.revenue)}</b>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty title="No sales yet" />
              )}
            </section>
          </div>

          <section className="acc-card">
            <h3 className="acc-card-title">Busy hours (retail bills)</h3>
            <HourChart hours={data.hours} />
          </section>

          <div className="acc-two-col">
            <section className="acc-card">
              <h3 className="acc-card-title">Dues today</h3>
              <div className="acc-stat-strip is-2">
                <div>
                  <small>Outstanding</small>
                  <b className="is-red">{inr(data.dues.outstanding)}</b>
                </div>
                <div>
                  <small>Overdue</small>
                  <b className="is-red">{inr(data.dues.overdue)}</b>
                </div>
              </div>
              <AgingBar aging={data.dues.aging} />
              <Link to="/acc/dues" className="acc-link-btn">
                Open dues →
              </Link>
            </section>

            <section className="acc-card">
              <h3 className="acc-card-title">Wholesale by group</h3>
              {data.groups.length ? (
                <HBars
                  rows={data.groups.map((g) => ({ key: g.id, label: g.name, value: g.revenue, note: `${g.bills} bills · credit ${inr(g.credit)}` }))}
                />
              ) : (
                <Empty title="No wholesale bills" />
              )}
            </section>
          </div>

          <div className="acc-two-col">
            <section className="acc-card">
              <h3 className="acc-card-title">Top wholesale customers</h3>
              {data.topCustomers.length ? (
                <ol className="acc-rank">
                  {data.topCustomers.map((c) => (
                    <li key={c.id}>
                      <Link to={`/acc/dues/${c.id}`}>
                        <span>
                          <strong>{c.name}</strong>
                          <small>
                            {c.shopName ? `${c.shopName} · ` : ""}
                            {c.bills} bills · {c.pieces} pcs
                          </small>
                        </span>
                        <b>{inr(c.revenue)}</b>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty title="No wholesale bills" />
              )}
            </section>

            <section className="acc-card">
              <h3 className="acc-card-title">Stock health</h3>
              <div className="acc-stat-strip is-2">
                <div>
                  <small>Stock at cost</small>
                  <b>{inr(data.stock.costValue)}</b>
                </div>
                <div>
                  <small>At selling price</small>
                  <b>{inr(data.stock.retailValue)}</b>
                </div>
                <div>
                  <small>Units</small>
                  <b>{data.stock.units}</b>
                </div>
                <div>
                  <small>Low / out</small>
                  <b className={clsx((data.stock.low || data.stock.out) && "is-red")}>
                    {data.stock.low} / {data.stock.out}
                  </b>
                </div>
              </div>
              {data.stock.lowList.length ? (
                <>
                  <p className="acc-sub-title">
                    <AlertTriangle /> Reorder
                  </p>
                  <ul className="acc-mini-list">
                    {data.stock.lowList.map((p) => (
                      <li key={p.id}>
                        <span>{p.name}</span>
                        <b className={p.stockQty <= 0 ? "is-red" : "is-amber"}>{p.stockQty}</b>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {data.stock.slow.length ? (
                <>
                  <p className="acc-sub-title">Not sold in this period</p>
                  <ul className="acc-mini-list">
                    {data.stock.slow.map((p) => (
                      <li key={p.id}>
                        <span>
                          {p.name} <small>· {p.stockQty} pcs</small>
                        </span>
                        <b>{inr(p.value)}</b>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          </div>

          {data.staff.length > 1 ? (
            <section className="acc-card">
              <h3 className="acc-card-title">By staff</h3>
              <HBars rows={data.staff.map((s) => ({ key: s.name, label: s.name, value: s.revenue, note: `${s.bills} bills` }))} />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SplitBar({ retail, wholesale }: { retail: number; wholesale: number }) {
  const total = retail + wholesale;
  if (!total) return <div className="acc-split is-empty" />;
  return (
    <div className="acc-split" role="img" aria-label={`Retail ${inr(retail)}, wholesale ${inr(wholesale)}`}>
      {retail > 0 ? (
        <span className="is-retail" style={{ flexGrow: retail }} title={`Retail ${inr(retail)}`}>
          {Math.round((retail / total) * 100)}%
        </span>
      ) : null}
      {wholesale > 0 ? (
        <span className="is-wholesale" style={{ flexGrow: wholesale }} title={`Wholesale ${inr(wholesale)}`}>
          {Math.round((wholesale / total) * 100)}%
        </span>
      ) : null}
    </div>
  );
}

function label(key: string, byMonth: boolean) {
  const d = new Date(byMonth ? `${key}-01T00:00:00` : `${key}T00:00:00`);
  return byMonth
    ? d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Stacked bars: retail (bottom) + wholesale, one per day or month. Tap/hover shows the numbers. */
function TrendChart({ rows, byMonth }: { rows: AccAnalytics["trend"]["rows"]; byMonth: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  if (!rows.length || rows.every((r) => r.retail + r.wholesale === 0)) return <Empty title="No sales in this period" />;
  const max = Math.max(...rows.map((r) => r.retail + r.wholesale), 1);
  const shown = active !== null ? rows[active] : null;
  const every = Math.ceil(rows.length / 7);
  return (
    <div className="acc-trend">
      <div className="acc-legend">
        <span>
          <i className="acc-sw is-retail" /> Retail
        </span>
        <span>
          <i className="acc-sw is-wholesale" /> Wholesale
        </span>
        <span className="acc-legend-max">max {inr(max)}</span>
      </div>
      <div className="acc-trend-tip" aria-live="polite">
        {shown ? (
          <>
            <b>{label(shown.key, byMonth)}</b> · Retail {inr(shown.retail)} · Wholesale {inr(shown.wholesale)} · Total{" "}
            <b>{inr(shown.retail + shown.wholesale)}</b>
          </>
        ) : (
          <span>Tap a bar for details</span>
        )}
      </div>
      <div className="acc-trend-plot" onMouseLeave={() => setActive(null)}>
        {rows.map((r, i) => {
          const total = r.retail + r.wholesale;
          return (
            <button
              key={r.key}
              type="button"
              className={clsx("acc-trend-col", active === i && "is-on")}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={`${label(r.key, byMonth)}: ${inr(total)}`}
            >
              <span className="acc-trend-stack" style={{ height: `${(total / max) * 100}%` }}>
                {r.wholesale > 0 ? <i className="is-wholesale" style={{ flexGrow: r.wholesale }} /> : null}
                {r.retail > 0 ? <i className="is-retail" style={{ flexGrow: r.retail }} /> : null}
              </span>
              <small>{i % every === 0 ? label(r.key, byMonth) : ""}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HBars({ rows }: { rows: Array<{ key: string; label: string; value: number; note?: string }> }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="acc-hbars">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${inr(r.value)}`}>
          <div className="acc-hbar-text">
            <span>{r.label}</span>
            <b>{inr(r.value)}</b>
          </div>
          <div className="acc-hbar-track">
            <span style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%` }} />
          </div>
          {r.note ? <small>{r.note}</small> : null}
        </li>
      ))}
    </ul>
  );
}

function HourChart({ hours }: { hours: AccAnalytics["hours"] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...hours.map((h) => h.bills), 1);
  if (!hours.some((h) => h.bills)) return <Empty title="No retail bills yet" />;
  const peak = hours.reduce((a, h) => (h.bills > a.bills ? h : a), hours[0]);
  const fmt = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
  const shown = active !== null ? hours[active] : null;
  return (
    <div className="acc-hours">
      <p className="acc-trend-tip">
        {shown ? (
          <>
            <b>{fmt(shown.hour)}</b> · {shown.bills} bills · {inr(shown.revenue)}
          </>
        ) : (
          <>
            Busiest at <b>{fmt(peak.hour)}</b> ({peak.bills} bills)
          </>
        )}
      </p>
      <div className="acc-hours-plot" onMouseLeave={() => setActive(null)}>
        {hours.map((h, i) => (
          <button
            key={h.hour}
            type="button"
            className={clsx("acc-trend-col", active === i && "is-on")}
            onMouseEnter={() => setActive(i)}
            onClick={() => setActive(i)}
            aria-label={`${fmt(h.hour)}: ${h.bills} bills`}
          >
            <span className="acc-trend-stack" style={{ height: `${(h.bills / max) * 100}%` }}>
              {h.bills ? <i className="is-retail" style={{ flexGrow: 1 }} /> : null}
            </span>
            <small>{h.hour % 3 === 0 ? fmt(h.hour) : ""}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
