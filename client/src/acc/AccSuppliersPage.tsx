import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Check, Loader2, PackagePlus, Phone, Plus, Search, Trash2, Wallet } from "lucide-react";
import { BackLink, SearchClearButton } from "../components/ui";
import { accApi, type AccProduct, type AccSupplier, type AccSupplierDetail } from "./accApi";
import { Empty, PdfButton, Segmented, Sheet, StockBadge, errorText, inr, refreshCatalog, shortDate, toast, useAccCatalog } from "./shared";

/** Suppliers: who we buy from, what we bought, what we still owe. */
export function AccSuppliersPage() {
  const [list, setList] = useState<AccSupplier[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = () =>
    accApi
      .suppliers()
      .then(({ data }) => setList(data))
      .catch((err) => toast(errorText(err), { tone: "error" }));
  useEffect(() => {
    void load();
  }, []);

  const owed = (list || []).reduce((a, s) => a + Math.max(s.balance, 0), 0);

  return (
    <div className="acc-page">
      <BackLink to="/acc/stock">Stock</BackLink>
      <div className="acc-title-row">
        <h1>Suppliers</h1>
        <div className="acc-head-actions">
          <PdfButton onDownload={() => accApi.pdf.suppliers()} />
          <button type="button" className="acc-btn is-primary" onClick={() => setAdding(true)}>
            <Plus /> Add
          </button>
        </div>
      </div>
      <div className="acc-stat-strip is-2">
        <div>
          <small>Suppliers</small>
          <b>{list?.length ?? "…"}</b>
        </div>
        <div>
          <small>To pay</small>
          <b className="is-red">{inr(owed)}</b>
        </div>
      </div>
      <Link to="/acc/stock/in" className="acc-btn is-block">
        <PackagePlus /> Stock in from supplier
      </Link>
      {!list ? (
        <div className="acc-loading">
          <Loader2 className="acc-spin" />
        </div>
      ) : list.length ? (
        <ul className="acc-list">
          {list.map((s) => (
            <li key={s.id} className="acc-row">
              <button type="button" className="acc-row-main" onClick={() => setOpen(s.id)}>
                <span className="acc-row-text">
                  <strong>{s.name}</strong>
                  <small>
                    {[s.phone, s.purchaseCount ? `${s.purchaseCount} purchases` : "", s.lastPurchaseAt ? `last ${shortDate(s.lastPurchaseAt)}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <span className="acc-row-amt">
                  <b className={clsx(s.balance > 0 && "is-red")}>{inr(s.balance)}</b>
                  <small>of {inr(s.purchased)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No suppliers yet" />
      )}

      <SupplierSheet id={open} onClose={() => setOpen(null)} onChanged={load} />
      <SupplierForm
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          void load();
        }}
      />
    </div>
  );
}

function SupplierForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setPhone("");
      setAddress("");
    }
  }, [open]);
  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await accApi.createSupplier({ name: name.trim(), phone, address });
      toast("Supplier added");
      onSaved();
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
      title="New supplier"
      footer={
        <button type="button" className="acc-btn is-primary is-block" disabled={busy || !name.trim()} onClick={() => void save()}>
          Save
        </button>
      }
    >
      <label className="acc-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="acc-field">
        <span>Phone</span>
        <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="acc-field">
        <span>Address</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
    </Sheet>
  );
}

function SupplierSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<AccSupplierDetail | null>(null);
  const [tab, setTab] = useState<"purchases" | "payments">("purchases");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "UPI" | "BANK">("CASH");
  const [busy, setBusy] = useState(false);

  const load = (sid: string) =>
    accApi
      .supplier(sid)
      .then(({ data }) => setData(data))
      .catch((err) => toast(errorText(err), { tone: "error" }));

  useEffect(() => {
    setData(null);
    setAmount("");
    if (id) void load(id);
  }, [id]);

  async function pay() {
    const n = Number(amount);
    if (!id || !(n > 0) || busy) return;
    setBusy(true);
    try {
      await accApi.paySupplier(id, { amount: n, method });
      toast(`Paid ${inr(n)}`);
      setAmount("");
      await load(id);
      onChanged();
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={Boolean(id)} onClose={onClose} title={data?.name || "Supplier"} subtitle={data?.phone} wide>
      {!data ? (
        <div className="acc-loading">
          <Loader2 className="acc-spin" />
        </div>
      ) : (
        <>
          <div className="acc-stat-strip is-3">
            <div>
              <small>Purchased</small>
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
          </div>
          <div className="acc-pay-inline">
            <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Pay amount ₹" />
            <Segmented
              value={method}
              onChange={setMethod}
              options={[
                { value: "CASH", label: "Cash" },
                { value: "UPI", label: "UPI" },
                { value: "BANK", label: "Bank" },
              ]}
            />
            <button type="button" className="acc-btn is-primary" onClick={() => void pay()} disabled={busy || !(Number(amount) > 0)}>
              <Wallet /> Pay
            </button>
          </div>
          {data.phone ? (
            <a className="acc-link-btn" href={`tel:${data.phone}`}>
              <Phone /> Call {data.phone}
            </a>
          ) : null}
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "purchases", label: `Purchases (${data.purchases.length})` },
              { value: "payments", label: `Payments (${data.payments.length})` },
            ]}
          />
          {tab === "purchases" ? (
            <ul className="acc-moves">
              {data.purchases.map((p) => (
                <li key={p.id}>
                  <span>
                    <strong>
                      {shortDate(p.purchaseDate)} {p.billNo ? `· Bill ${p.billNo}` : ""} · {p.pieces} pcs
                    </strong>
                    <small>{p.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</small>
                  </span>
                  <b>{inr(p.total)}</b>
                </li>
              ))}
              {!data.purchases.length ? <li className="acc-hint">No purchases yet.</li> : null}
            </ul>
          ) : (
            <ul className="acc-moves">
              {data.payments.map((p) => (
                <li key={p.id}>
                  <span>
                    <strong>{shortDate(p.paidAt)} · {p.method.toLowerCase()}</strong>
                    <small>{p.note}</small>
                  </span>
                  <b className="is-green">{inr(p.amount)}</b>
                </li>
              ))}
              {!data.payments.length ? <li className="acc-hint">No payments yet.</li> : null}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}

/* ---------------- Stock in ---------------- */

type InLine = { product: AccProduct; qty: string; cost: string; sell: string };

/** Supplier bill → many products in at once; cost averages, stock goes up. */
export function AccStockInPage() {
  const { catalog } = useAccCatalog();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<AccSupplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [billNo, setBillNo] = useState("");
  const [lines, setLines] = useState<InLine[]>([]);
  const [q, setQ] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<"CASH" | "UPI" | "BANK">("CASH");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    accApi
      .suppliers()
      .then(({ data }) => setSuppliers(data))
      .catch(() => undefined);
  }, []);

  const products = catalog?.products ?? [];
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = useMemo(
    () =>
      tokens.length
        ? products
            .filter((p) => tokens.every((t) => `${p.name} ${p.categoryName} ${p.barcode || ""}`.toLowerCase().includes(t)))
            .slice(0, 10)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, q],
  );
  const lowList = useMemo(
    () => products.filter((p) => p.stockQty <= 0 || (p.lowStockAt > 0 && p.stockQty <= p.lowStockAt)).slice(0, 30),
    [products],
  );

  function add(p: AccProduct) {
    if (lines.some((l) => l.product.id === p.id)) {
      toast("Already on the list");
    } else {
      setLines([...lines, { product: p, qty: "", cost: p.purchasePrice ? String(p.purchasePrice) : "", sell: "" }]);
    }
    setQ("");
  }

  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
  const pieces = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);

  async function save() {
    const items = lines
      .filter((l) => Number(l.qty) >= 1)
      .map((l) => ({
        productId: l.product.id,
        qty: Math.floor(Number(l.qty)),
        unitCost: Number(l.cost) || 0,
        sellingPrice: Number(l.sell) || undefined,
      }));
    if (!items.length) {
      toast("Enter quantity for at least one item", { tone: "error" });
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await accApi.createPurchase({
        supplierId: supplierId || null,
        supplierName: !supplierId && supplierName.trim() ? supplierName.trim() : undefined,
        billNo,
        paidNow: Number(paid) || 0,
        paidMethod: method,
        items,
      });
      toast(`Stock added: ${pieces} pcs`);
      void refreshCatalog();
      navigate("/acc/stock");
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acc-page">
      <BackLink to="/acc/stock">Stock</BackLink>
      <h1 className="acc-h1">Stock in</h1>
      <section className="acc-card">
        <div className="acc-form-grid">
          <label className="acc-field">
            <span>Supplier</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— New / none —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {supplierId ? (
            <label className="acc-field">
              <span>Their bill no.</span>
              <input value={billNo} onChange={(e) => setBillNo(e.target.value)} />
            </label>
          ) : (
            <label className="acc-field">
              <span>New supplier name</span>
              <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Optional" />
            </label>
          )}
        </div>
      </section>

      <section className="acc-card">
        <label className="acc-search is-in-card">
          <Search aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product to add…" />
          <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
        </label>
        {tokens.length ? (
          <ul className="acc-results">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => add(p)}>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.categoryName}</small>
                  </span>
                  <StockBadge qty={p.stockQty} low={p.lowStockAt} />
                </button>
              </li>
            ))}
            <li>
              <Link className="is-custom" to="/acc/stock/new">
                <Plus /> New product
              </Link>
            </li>
          </ul>
        ) : !lines.length && lowList.length ? (
          <div className="acc-field">
            <span>Low & out of stock — tap to add</span>
            <div className="acc-chips">
              {lowList.map((p) => (
                <button key={p.id} type="button" className="acc-chip" onClick={() => add(p)}>
                  {p.name} <small>({p.stockQty})</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {lines.length ? (
          <ul className="acc-lines">
            {lines.map((l, i) => (
              <li key={l.product.id}>
                <div className="acc-line-head">
                  <strong>{l.product.name}</strong>
                  <small>now {l.product.stockQty}</small>
                  <button type="button" className="acc-icon-btn is-small" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove">
                    <Trash2 />
                  </button>
                </div>
                <div className="acc-form-grid is-3">
                  <label className="acc-field">
                    <span>Qty</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                    />
                  </label>
                  <label className="acc-field">
                    <span>Cost ₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.cost}
                      onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))}
                    />
                  </label>
                  <label className="acc-field">
                    <span>New MRP ₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.sell}
                      placeholder={String(l.product.sellingPrice)}
                      onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, sell: e.target.value } : x)))}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="acc-card acc-pay-card">
        <div className="acc-sum-row">
          <span>
            {lines.length} items · {pieces} pcs
          </span>
          <b>{inr(total)}</b>
        </div>
        {supplierId || supplierName.trim() ? (
          <div className="acc-form-grid">
            <label className="acc-field">
              <span>Paid now ₹</span>
              <input type="number" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" />
            </label>
            <div className="acc-field">
              <span>Paid by</span>
              <Segmented
                value={method}
                onChange={setMethod}
                options={[
                  { value: "CASH", label: "Cash" },
                  { value: "UPI", label: "UPI" },
                  { value: "BANK", label: "Bank" },
                ]}
              />
            </div>
          </div>
        ) : null}
        <button type="button" className="acc-btn is-primary is-big is-block" onClick={() => void save()} disabled={busy || !lines.length}>
          {busy ? <Loader2 className="acc-spin" /> : <Check />} Add to stock
        </button>
      </section>
    </div>
  );
}
