import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { History, Loader2, PackagePlus, Pencil, Plus, Search, SlidersHorizontal, Star, Trash2, Truck } from "lucide-react";
import { SearchClearButton } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { accApi, type AccProduct, type AccStockMove } from "./accApi";
import {
  CategoryIcon,
  Empty,
  PdfButton,
  Sheet,
  StockBadge,
  errorText,
  dateTime,
  inr,
  patchCatalogProduct,
  refreshCatalog,
  toast,
  useAccCatalog,
} from "./shared";

/** Stock: every product with qty, prices and the ★ that puts it on the counter. */

type Filter = "all" | "fav" | "low" | "out";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function AccStockPage() {
  const { catalog, error } = useAccCatalog();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState<AccProduct | null>(null);
  const [restock, setRestock] = useState<AccProduct | null>(null);
  const [adjust, setAdjust] = useState<AccProduct | null>(null);
  const [history, setHistory] = useState<AccProduct | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  const products = catalog?.products ?? [];
  const categories = catalog?.categories ?? [];
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const isLow = (p: AccProduct) => p.lowStockAt > 0 && p.stockQty > 0 && p.stockQty <= p.lowStockAt;

  const list = useMemo(() => {
    return products
      .filter((p) => !categoryId || p.categoryId === categoryId)
      .filter((p) =>
        filter === "fav" ? p.isFavourite : filter === "low" ? isLow(p) || p.stockQty <= 0 : filter === "out" ? p.stockQty <= 0 : true,
      )
      .filter((p) => {
        if (!tokens.length) return true;
        const hay = `${p.name} ${p.type} ${p.brand} ${p.model} ${p.color} ${p.barcode || ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .sort((a, b) => collator.compare(a.name, b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, categoryId, filter, q]);

  const units = list.reduce((a, p) => a + Math.max(p.stockQty, 0), 0);
  const value = list.reduce((a, p) => a + Math.max(p.stockQty, 0) * p.sellingPrice, 0);
  const lowCount = products.filter((p) => isLow(p) || p.stockQty <= 0).length;

  async function toggleFav(p: AccProduct) {
    patchCatalogProduct({ ...p, isFavourite: !p.isFavourite });
    try {
      const { data } = await accApi.setFavourite(p.id, !p.isFavourite);
      patchCatalogProduct(data);
    } catch (err) {
      patchCatalogProduct(p);
      toast(errorText(err), { tone: "error" });
    }
  }

  return (
    <div className="acc-page">
      <div className="acc-title-row">
        <h1>Stock</h1>
        <div className="acc-head-actions">
          <button type="button" className="acc-btn is-ghost" onClick={() => setPdfOpen(true)}>
            PDF
          </button>
          <Link to="/acc/suppliers" className="acc-btn is-ghost">
            <Truck /> Suppliers
          </Link>
        </div>
      </div>

      <div className="acc-quick-actions">
        <Link to="/acc/stock/new" className="acc-btn is-primary">
          <Plus /> New product
        </Link>
        <Link to="/acc/stock/in" className="acc-btn">
          <PackagePlus /> Stock in
        </Link>
      </div>

      <div className="acc-stat-strip">
        <div>
          <small>Products</small>
          <b>{list.length}</b>
        </div>
        <div>
          <small>Units</small>
          <b>{units}</b>
        </div>
        <div>
          <small>Value (MRP)</small>
          <b>{inr(value)}</b>
        </div>
        <button type="button" className={clsx(lowCount && "is-warn")} onClick={() => setFilter("low")}>
          <small>Low / out</small>
          <b>{lowCount}</b>
        </button>
      </div>

      <label className="acc-search">
        <Search aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, model, brand, barcode…" />
        <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
      </label>

      <div className="acc-chips is-scroll">
        <button type="button" className={clsx("acc-chip", !categoryId && "is-on")} onClick={() => setCategoryId("")}>
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={clsx("acc-chip", categoryId === c.id && "is-on")}
            onClick={() => setCategoryId(c.id === categoryId ? "" : c.id)}
          >
            <CategoryIcon icon={c.icon} />
            {c.name}
          </button>
        ))}
      </div>
      <div className="acc-chips">
        {(
          [
            ["all", "All"],
            ["fav", "★ Counter"],
            ["low", "Low & out"],
            ["out", "Out of stock"],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button key={key} type="button" className={clsx("acc-chip is-small", filter === key && "is-on")} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {!catalog ? (
        error ? (
          <Empty title="Could not load stock">{error}</Empty>
        ) : (
          <div className="acc-loading">
            <Loader2 className="acc-spin" /> Loading…
          </div>
        )
      ) : list.length ? (
        <ul className="acc-list">
          {list.map((p) => (
            <li key={p.id} className="acc-row">
              <button type="button" className="acc-row-main" onClick={() => setActive(p)}>
                <span className="acc-row-text">
                  <strong>{p.name}</strong>
                  <small>
                    {p.categoryName}
                    {p.type || p.brand ? ` · ${[p.type, p.brand].filter(Boolean).join(" · ")}` : ""} · {inr(p.sellingPrice)}
                    {p.wholesalePrice ? ` · W ${inr(p.wholesalePrice)}` : ""}
                  </small>
                </span>
                <StockBadge qty={p.stockQty} low={p.lowStockAt} />
              </button>
              <button
                type="button"
                className={clsx("acc-star", p.isFavourite && "is-on")}
                onClick={() => void toggleFav(p)}
                aria-label={p.isFavourite ? "Remove from counter" : "Show on counter"}
                title={p.isFavourite ? "On the counter" : "Show on counter"}
              >
                <Star />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={products.length ? "No products match" : "No products yet"}>
          <Link to="/acc/stock/new" className="acc-btn">
            <Plus /> Add product
          </Link>
        </Empty>
      )}

      {/* Row actions */}
      <Sheet
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={active?.name || ""}
        subtitle={
          active ? (
            <>
              <StockBadge qty={active.stockQty} low={active.lowStockAt} /> in stock · Sell {inr(active.sellingPrice)}
              {isAdmin ? ` · Cost ${inr(active.purchasePrice, true)}` : ""}
            </>
          ) : null
        }
      >
        {active ? (
          <div className="acc-action-grid">
            <button type="button" onClick={() => { setRestock(active); setActive(null); }}>
              <PackagePlus /> Add stock
            </button>
            <button type="button" onClick={() => navigate(`/acc/stock/${active.id}/edit`)}>
              <Pencil /> Edit
            </button>
            <button type="button" onClick={() => { setAdjust(active); setActive(null); }}>
              <SlidersHorizontal /> Correct count
            </button>
            <button type="button" onClick={() => { setHistory(active); setActive(null); }}>
              <History /> History
            </button>
            <button type="button" onClick={() => { void toggleFav(active); setActive(null); }}>
              <Star /> {active.isFavourite ? "Remove from counter" : "Show on counter"}
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={async () => {
                if (!window.confirm(`Remove ${active.name}? Past bills keep it.`)) return;
                try {
                  await accApi.deleteProduct(active.id);
                  toast("Product removed");
                  setActive(null);
                  void refreshCatalog();
                } catch (err) {
                  toast(errorText(err), { tone: "error" });
                }
              }}
            >
              <Trash2 /> Remove
            </button>
          </div>
        ) : null}
      </Sheet>

      <RestockSheet product={restock} onClose={() => setRestock(null)} />
      <AdjustSheet product={adjust} onClose={() => setAdjust(null)} />
      <HistorySheet product={history} onClose={() => setHistory(null)} />

      <Sheet open={pdfOpen} onClose={() => setPdfOpen(false)} title="Stock PDF" subtitle="Download the stock list">
        <div className="acc-pdf-options">
          <PdfButton label="All products" onDownload={() => accApi.pdf.stock({ categoryId, cost: isAdmin })} />
          <PdfButton label="Low & out of stock (to order)" onDownload={() => accApi.pdf.stock({ filter: "low", categoryId, cost: isAdmin })} />
          <PdfButton label="Only in stock" onDownload={() => accApi.pdf.stock({ filter: "instock", categoryId, cost: isAdmin })} />
          <PdfButton label="Counter favourites" onDownload={() => accApi.pdf.stock({ filter: "fav", categoryId, cost: isAdmin })} />
          <p className="acc-hint">
            {categoryId ? `Only ${categories.find((c) => c.id === categoryId)?.name}. ` : ""}
            {isAdmin ? "Includes cost price." : ""}
          </p>
        </div>
      </Sheet>
    </div>
  );
}

function RestockSheet({ product, onClose }: { product: AccProduct | null; onClose: () => void }) {
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (product) {
      setQty("");
      setCost(product.purchasePrice ? String(product.purchasePrice) : "");
    }
  }, [product]);
  if (!product) return null;

  async function save() {
    const n = Math.floor(Number(qty) || 0);
    if (n < 1 || busy) return;
    setBusy(true);
    try {
      await accApi.createPurchase({ items: [{ productId: product!.id, qty: n, unitCost: Number(cost) || 0 }], note: "Quick add" });
      toast(`+${n} ${product!.name}`);
      void refreshCatalog();
      onClose();
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
      title="Add stock"
      subtitle={`${product.name} · now ${product.stockQty}`}
      footer={
        <button type="button" className="acc-btn is-primary is-block" onClick={() => void save()} disabled={busy || !(Number(qty) >= 1)}>
          {busy ? <Loader2 className="acc-spin" /> : null} Add {qty || 0} pcs
        </button>
      }
    >
      <div className="acc-form-grid">
        <label className="acc-field">
          <span>Quantity</span>
          <input type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </label>
        <label className="acc-field">
          <span>Cost per piece ₹</span>
          <input type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
      </div>
      <div className="acc-chips">
        {[5, 10, 20, 50, 100].map((n) => (
          <button key={n} type="button" className="acc-chip" onClick={() => setQty(String((Number(qty) || 0) + n))}>
            +{n}
          </button>
        ))}
      </div>
      <p className="acc-hint">
        For a supplier bill with many items use <Link to="/acc/stock/in">Stock in</Link>.
      </p>
    </Sheet>
  );
}

function AdjustSheet({ product, onClose }: { product: AccProduct | null; onClose: () => void }) {
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (product) {
      setCount(String(product.stockQty));
      setNote("");
    }
  }, [product]);
  if (!product) return null;

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await accApi.adjustStock(product!.id, Math.max(0, Math.floor(Number(count) || 0)), note);
      patchCatalogProduct(data);
      toast("Stock count updated");
      onClose();
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
      title="Correct stock count"
      subtitle={`${product.name} · system says ${product.stockQty}`}
      footer={
        <button type="button" className="acc-btn is-primary is-block" onClick={() => void save()} disabled={busy}>
          Save count
        </button>
      }
    >
      <label className="acc-field">
        <span>Actual pieces in shop</span>
        <input type="number" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} autoFocus />
      </label>
      <label className="acc-field">
        <span>Reason</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Damaged, counted, lost…" />
      </label>
    </Sheet>
  );
}

const MOVE_LABEL: Record<AccStockMove["kind"], string> = {
  OPENING: "Opening stock",
  PURCHASE: "Stock in",
  SALE: "Sold",
  VOID: "Bill cancelled",
  ADJUST: "Count corrected",
};

function HistorySheet({ product, onClose }: { product: AccProduct | null; onClose: () => void }) {
  const [moves, setMoves] = useState<AccStockMove[] | null>(null);
  useEffect(() => {
    if (!product) return;
    setMoves(null);
    accApi
      .productHistory(product.id)
      .then(({ data }) => setMoves(data))
      .catch((err) => {
        toast(errorText(err), { tone: "error" });
        setMoves([]);
      });
  }, [product]);
  if (!product) return null;
  return (
    <Sheet open onClose={onClose} title="Stock history" subtitle={product.name}>
      {!moves ? (
        <div className="acc-loading">
          <Loader2 className="acc-spin" />
        </div>
      ) : moves.length ? (
        <ul className="acc-moves">
          {moves.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{MOVE_LABEL[m.kind]}</strong>
                <small>
                  {dateTime(m.createdAt)}
                  {m.sale ? ` · ${m.sale.number}${m.sale.customerName ? ` · ${m.sale.customerName}` : ""}` : ""}
                  {m.note ? ` · ${m.note}` : ""}
                  {m.createdByName ? ` · ${m.createdByName}` : ""}
                </small>
              </span>
              <b className={m.qty > 0 ? "is-green" : "is-red"}>
                {m.qty > 0 ? "+" : ""}
                {m.qty}
              </b>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No stock changes yet" />
      )}
    </Sheet>
  );
}
