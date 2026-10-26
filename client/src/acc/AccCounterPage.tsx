import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { ChevronRight, Loader2, Minus, Plus, Search, ShoppingCart, Star, Trash2, X } from "lucide-react";
import { SearchClearButton } from "../components/ui";
import { ApiError } from "../lib/api";
import { accApi, type AccProduct, type AccSalesSummary } from "./accApi";
import {
  CategoryIcon,
  Empty,
  Segmented,
  Sheet,
  StockBadge,
  errorText,
  inr,
  newRef,
  plural,
  refreshCatalog,
  toast,
  useAccCatalog,
} from "./shared";

/**
 * Counter: quick retail billing. Favourite products sit in tiles by
 * category → type or brand → product (e.g. Cable → boAt → …). Tap a product, tap a
 * price, Sell. The phone brand is optional and only keeps the stock
 * breakdown in step. Several items can go in a cart for one customer.
 */

type PayMode = "CASH" | "ONLINE";
type CartLine = {
  productId: string;
  name: string;
  model?: string;
  qty: number;
  rate: number;
  stockQty: number;
  cost: number;
};

const SHOW_ALL_KEY = "acc.counter.showAll";
const PAY_KEY = "acc.counter.pay";
const CART_KEY = "acc.counter.cart";

function readLocal<T>(key: string, fallback: T, storage: Storage = localStorage): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown, storage: Storage = localStorage) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

function matches(product: AccProduct, tokens: string[]) {
  const hay = `${product.name} ${product.type} ${product.brand} ${product.model} ${product.color} ${product.categoryName} ${
    product.barcode || ""
  }`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Empty brand/type bucket on the counter. */
function drillRaw(p: AccProduct, drillBy: "TYPE" | "BRAND") {
  return (drillBy === "BRAND" ? p.brand : p.type).trim();
}

function drillLabel(raw: string, drillBy: "TYPE" | "BRAND") {
  if (raw) return raw;
  return drillBy === "BRAND" ? "Local" : "General";
}

export function AccCounterPage() {
  const { catalog, error } = useAccCatalog();
  const [showAll, setShowAll] = useState(() => readLocal(SHOW_ALL_KEY, false));
  const [payMode, setPayMode] = useState<PayMode>(() => readLocal(PAY_KEY, "CASH"));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  /** Raw type/brand key within the open category ("" = Local / General). */
  const [drillKey, setDrillKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selling, setSelling] = useState<AccProduct | null>(null);
  const [cart, setCart] = useState<CartLine[]>(() => readLocal(CART_KEY, [], sessionStorage));
  const [checkout, setCheckout] = useState(false);
  const [today, setToday] = useState<AccSalesSummary | null>(null);

  useEffect(() => writeLocal(SHOW_ALL_KEY, showAll), [showAll]);
  useEffect(() => writeLocal(PAY_KEY, payMode), [payMode]);
  useEffect(() => writeLocal(CART_KEY, cart, sessionStorage), [cart]);

  const loadToday = () =>
    accApi
      .listSales({ period: "today", kind: "RETAIL" })
      .then(({ data }) => setToday(data.summary))
      .catch(() => undefined);
  useEffect(() => {
    void loadToday();
  }, []);

  const products = catalog?.products ?? [];
  const categories = catalog?.categories ?? [];
  const pool = showAll ? products : products.filter((p) => p.isFavourite);

  const category = categories.find((c) => c.id === categoryId) || null;

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searchResults = useMemo(
    () =>
      tokens.length
        ? products
            .filter((p) => matches(p, tokens))
            .sort((a, b) => Number(b.isFavourite) - Number(a.isFavourite) || collator.compare(a.name, b.name))
            .slice(0, 60)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, query],
  );

  const categoryTiles = useMemo(
    () =>
      categories
        .map((c) => ({ category: c, count: pool.filter((p) => p.categoryId === c.id).length }))
        .filter((t) => t.count > 0),
    [categories, pool],
  );

  const inCategory = useMemo(
    () => (category ? pool.filter((p) => p.categoryId === category.id) : []),
    [pool, category],
  );

  const drillBy = category?.drillBy ?? "TYPE";

  const drillTiles = useMemo(() => {
    if (!category) return [];
    const map = new Map<string, number>();
    for (const p of inCategory) {
      const raw = drillRaw(p, drillBy);
      map.set(raw, (map.get(raw) || 0) + 1);
    }
    return [...map.entries()]
      .map(([raw, count]) => ({ raw, label: drillLabel(raw, drillBy), count }))
      .sort((a, b) => collator.compare(a.label, b.label));
  }, [inCategory, category, drillBy]);

  const productList = useMemo(() => {
    if (!category || drillKey === null) return [];
    return inCategory
      .filter((p) => drillRaw(p, drillBy) === drillKey)
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [inCategory, category, drillKey, drillBy]);

  function openCategory(id: string) {
    setCategoryId(id);
    setDrillKey(null);
  }

  function openDrill(raw: string) {
    setDrillKey(raw);
  }

  function goHome() {
    setCategoryId(null);
    setDrillKey(null);
  }

  function goCategory() {
    setDrillKey(null);
  }

  const cartTotal = cart.reduce((a, l) => a + l.qty * l.rate, 0);
  const cartCount = cart.reduce((a, l) => a + l.qty, 0);

  function onSearchEnter() {
    // Barcode scanners type the code and press Enter.
    const code = query.trim();
    const hit = products.find((p) => p.barcode && p.barcode === code) || (searchResults.length === 1 ? searchResults[0] : null);
    if (hit) {
      setSelling(hit);
      setQuery("");
    }
  }

  const showingSearch = tokens.length > 0;
  const level: "home" | "drill" | "products" = !category ? "home" : drillKey === null ? "drill" : "products";
  const drillCrumb = drillKey === null ? null : drillLabel(drillKey, drillBy);

  return (
    <div className="acc-page acc-counter">
      <header className="acc-counter-head">
        <div className="acc-title-row">
          <h1>Counter</h1>
          <span className="acc-today" title="Today's retail sales">
            Today <b>{today ? inr(today.total) : "…"}</b>
            <small>{today ? plural(today.count, "sale") : ""}</small>
          </span>
        </div>
        <label className="acc-search">
          <Search aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Search cover, model, brand, barcode…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearchEnter();
            }}
            enterKeyHint="search"
          />
          <SearchClearButton visible={Boolean(query)} onClear={() => setQuery("")} />
        </label>
        {!showingSearch ? (
          <div className="acc-crumbs">
            <button type="button" className={clsx(level === "home" && "is-on")} onClick={goHome}>
              {showAll ? "All stock" : "Favourites"}
            </button>
            {category ? (
              <>
                <ChevronRight aria-hidden />
                <button type="button" className={clsx(level === "drill" && "is-on")} onClick={goCategory}>
                  {category.name}
                </button>
              </>
            ) : null}
            {drillCrumb ? (
              <>
                <ChevronRight aria-hidden />
                <button type="button" className="is-on">
                  {drillCrumb}
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={clsx("acc-crumb-toggle", showAll && "is-all")}
              onClick={() => {
                setShowAll((v) => !v);
                goHome();
              }}
            >
              <Star aria-hidden />
              {showAll ? "Showing all" : "Show all"}
            </button>
          </div>
        ) : null}
      </header>

      {!catalog ? (
        error ? (
          <Empty title="Could not load products">{error}</Empty>
        ) : (
          <div className="acc-loading">
            <Loader2 className="acc-spin" /> Loading…
          </div>
        )
      ) : showingSearch ? (
        searchResults.length ? (
          <div className="acc-tiles is-products">
            {searchResults.map((p) => (
              <ProductTile key={p.id} product={p} onTap={() => setSelling(p)} />
            ))}
          </div>
        ) : (
          <Empty title={`Nothing matches “${query}”`}>
            <Link to="/acc/stock/in" className="acc-btn is-ghost">
              <Plus /> Add stock
            </Link>
          </Empty>
        )
      ) : level === "home" ? (
        categoryTiles.length ? (
          <div className="acc-tiles">
            {categoryTiles.map(({ category: c, count }) => (
              <button key={c.id} type="button" className="acc-tile is-cat" onClick={() => openCategory(c.id)}>
                <CategoryIcon icon={c.icon} variant="3d" size="lg" />
                <strong>{c.name}</strong>
                <small>{plural(count, "item")}</small>
              </button>
            ))}
          </div>
        ) : (
          <Empty title={products.length ? "No favourites yet" : "No products yet"}>
            {products.length ? (
              <>
                <p>Tap ★ on products in Stock to show them here.</p>
                <button type="button" className="acc-btn" onClick={() => setShowAll(true)}>
                  Show all stock ({products.length})
                </button>
              </>
            ) : (
              <Link to="/acc/stock/in" className="acc-btn">
                <Plus /> Add your first stock
              </Link>
            )}
          </Empty>
        )
      ) : level === "drill" ? (
        drillTiles.length ? (
          <div className="acc-tiles">
            {drillTiles.map(({ raw, label, count }) => (
              <button key={raw || "__empty"} type="button" className="acc-tile is-group" onClick={() => openDrill(raw)}>
                <strong>{label}</strong>
                <small>{plural(count, "item")}</small>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="Nothing in this category">
            <Link to="/acc/stock/in" className="acc-btn">
              <Plus /> Add stock
            </Link>
          </Empty>
        )
      ) : (
        <div className="acc-tiles is-products">
          {productList.map((p) => (
            <ProductTile key={p.id} product={p} onTap={() => setSelling(p)} />
          ))}
        </div>
      )}

      {cart.length ? (
        <div className="acc-cartbar">
          <button type="button" className="acc-cartbar-btn" onClick={() => setCheckout(true)}>
            <ShoppingCart />
            <span>
              {cartCount} item{cartCount === 1 ? "" : "s"}
            </span>
            <b>{inr(cartTotal)}</b>
            <em>Checkout</em>
          </button>
          <button type="button" className="acc-icon-btn" onClick={() => setCart([])} aria-label="Clear cart">
            <X />
          </button>
        </div>
      ) : null}

      <SellSheet
        product={selling}
        icon={categories.find((c) => c.id === selling?.categoryId)?.icon}
        payMode={payMode}
        onPayMode={setPayMode}
        onClose={() => setSelling(null)}
        onSold={() => {
          setSelling(null);
          setQuery("");
          goHome();
          void refreshCatalog();
          void loadToday();
        }}
      />

      <CheckoutSheet
        open={checkout}
        lines={cart}
        payMode={payMode}
        onPayMode={setPayMode}
        onChange={setCart}
        onClose={() => setCheckout(false)}
        onSold={() => {
          setCart([]);
          setCheckout(false);
          void refreshCatalog();
          void loadToday();
        }}
      />
    </div>
  );
}

function ProductTile({ product, onTap }: { product: AccProduct; onTap: () => void }) {
  // Skip parts the name already says ("9D Glass · Oppo A78" + "Oppo A78").
  const name = product.name.toLowerCase();
  const sub = product.models.length
    ? plural(product.models.length, "phone brand")
    : [product.color, product.model].filter((part) => part && !name.includes(part.toLowerCase())).join(" · ");
  return (
    <button
      type="button"
      className={clsx("acc-tile is-product", product.stockQty <= 0 && "is-out")}
      onClick={onTap}
    >
      <span className="acc-tile-top">
        <StockBadge qty={product.stockQty} low={product.lowStockAt} long />
        {product.isFavourite ? <Star className="acc-tile-star" aria-label="Favourite" /> : null}
      </span>
      <strong>{product.name}</strong>
      {sub ? <small>{sub}</small> : null}
      <b className="acc-tile-price">{inr(product.sellingPrice)}</b>
    </button>
  );
}

/** Sell one product: pick a price chip (or type), qty, Cash/UPI, Sell. */
function SellSheet({
  product,
  icon,
  payMode,
  onPayMode,
  onClose,
  onSold,
}: {
  product: AccProduct | null;
  icon?: string;
  payMode: PayMode;
  onPayMode: (mode: PayMode) => void;
  onClose: () => void;
  onSold: () => void;
}) {
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const refId = useRef(newRef());

  useEffect(() => {
    if (!product) return;
    setPrice(product.sellingPrice ? String(product.sellingPrice) : "");
    setQty(1);
    setModel("");
    refId.current = newRef();
  }, [product]);

  if (!product) return null;
  const rate = Number(price) || 0;
  const belowCost = product.purchasePrice > 0 && rate > 0 && rate < product.purchasePrice;
  const nudge = (by: number) => setPrice(String(Math.max(0, Math.round((rate + by) * 100) / 100)));

  async function sell(allowOutOfStock = false) {
    if (!product || busy) return;
    if (rate <= 0) {
      toast("Pick or type the selling price", { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const { data } = await accApi.createSale({
        kind: "RETAIL",
        clientRef: refId.current,
        items: [{ productId: product.id, qty, rate, ...(model ? { model } : {}) }],
        ...(payMode === "CASH" ? { cashAmount: rate * qty } : { onlineAmount: rate * qty }),
        allowOutOfStock,
      });
      toast(`Sold · ${inr(data.total)} · ${payMode === "CASH" ? "Cash" : "UPI"}`, {
        tone: "success",
        action: { label: "Undo", run: () => void undoSale(data.id) },
      });
      onSold();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !allowOutOfStock) {
        if (window.confirm(`${err.message}. Sell anyway? (stock will go below zero)`)) {
          setBusy(false);
          await sell(true);
          return;
        }
      } else {
        toast(errorText(err), { tone: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  const mrp = product.sellingPrice;
  const diff = rate - mrp;

  return (
    <Sheet
      open
      onClose={onClose}
      className="is-sell"
      leading={<CategoryIcon icon={icon || "package"} variant="3d" size="sm" />}
      title={product.name}
      subtitle={
        <>
          <StockBadge qty={product.stockQty} low={product.lowStockAt} long />
          <span>MRP {inr(mrp)}</span>
        </>
      }
      footer={
        <div className="acc-sell-ft">
          <button type="button" className="acc-sell-go" onClick={() => void sell()} disabled={busy || rate <= 0}>
            {busy ? <Loader2 className="acc-spin" /> : null}
            Sell <span>{inr(rate * qty)}</span>
          </button>
        </div>
      }
    >
      {/* The price is the hero: type into it, or nudge it with the steps. */}
      <div className="acc-sell-price">
        <label className="acc-sell-field">
          <span>₹</span>
          <input
            type="text"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onFocus={(e) => e.target.select()}
            aria-label="Selling price"
            placeholder="0"
            style={{ width: `${Math.max(String(price || "0").length, 1) + 0.4}ch` }}
          />
        </label>
        <div className="acc-sell-note">
          {belowCost ? (
            <b className="is-dn">Below cost ({inr(product.purchasePrice)})</b>
          ) : diff === 0 || !mrp ? (
            "MRP price"
          ) : (
            <>
              <s>{inr(mrp)}</s>
              {diff < 0 ? <b className="is-dn">{inr(-diff)} off</b> : <b className="is-up">{inr(diff)} above MRP</b>}
            </>
          )}
        </div>
      </div>

      <div className="acc-sell-steps">
        {[-10, -5, 5, 10].map((d) => (
          <button key={d} type="button" className={d < 0 ? "is-mn" : "is-pl"} onClick={() => nudge(d)} disabled={rate + d < 0}>
            {d < 0 ? `−${-d}` : `+${d}`}
          </button>
        ))}
      </div>

      {product.models.length ? (
        <div className="acc-sell-quick is-scroll">
          <span className="acc-sell-lb">Brand</span>
          <button type="button" className={clsx(!model && "is-on")} onClick={() => setModel("")}>
            Any
          </button>
          {product.models.map((m) => (
            <button
              key={m.model}
              type="button"
              className={clsx(model === m.model && "is-on", m.qty <= 0 && "is-empty")}
              onClick={() => setModel(model === m.model ? "" : m.model)}
            >
              {m.model} <small>{m.qty}</small>
            </button>
          ))}
        </div>
      ) : null}

      <div className="acc-sell-row">
        <div>
          <div className="acc-sell-lb">QTY</div>
          <div className="acc-sell-qty">
            <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Less" disabled={qty <= 1}>
              −
            </button>
            <span>{qty}</span>
            <button type="button" onClick={() => setQty(qty + 1)} aria-label="More">
              +
            </button>
          </div>
        </div>
        <div>
          <div className="acc-sell-lb">PAID BY</div>
          <div className="acc-sell-pay">
            {(["CASH", "ONLINE"] as const).map((mode) => (
              <button key={mode} type="button" className={clsx(payMode === mode && "is-on")} onClick={() => onPayMode(mode)}>
                {mode === "CASH" ? "Cash" : "UPI"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

async function undoSale(id: string) {
  try {
    await accApi.voidSale(id, "Undo at counter");
    toast("Sale cancelled, stock put back");
    void refreshCatalog();
  } catch (err) {
    toast(errorText(err), { tone: "error" });
  }
}

/** Several items for one customer, with discount and split payment. */
function CheckoutSheet({
  open,
  lines,
  payMode,
  onPayMode,
  onChange,
  onClose,
  onSold,
}: {
  open: boolean;
  lines: CartLine[];
  payMode: PayMode;
  onPayMode: (mode: PayMode) => void;
  onChange: (lines: CartLine[]) => void;
  onClose: () => void;
  onSold: () => void;
}) {
  const [discount, setDiscount] = useState("");
  const [split, setSplit] = useState(false);
  const [cashPart, setCashPart] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const refId = useRef(newRef());

  useEffect(() => {
    if (open) refId.current = newRef();
  }, [open]);

  const subtotal = lines.reduce((a, l) => a + l.qty * l.rate, 0);
  const disc = Math.min(Number(discount) || 0, subtotal);
  const total = Math.round((subtotal - disc) * 100) / 100;
  const cash = split ? Math.min(Number(cashPart) || 0, total) : payMode === "CASH" ? total : 0;
  const online = Math.round((total - cash) * 100) / 100;

  function update(index: number, patch: Partial<CartLine>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit(allowOutOfStock = false) {
    if (busy || !lines.length) return;
    setBusy(true);
    try {
      const { data } = await accApi.createSale({
        kind: "RETAIL",
        clientRef: refId.current,
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty, rate: l.rate, ...(l.model ? { model: l.model } : {}) })),
        discount: disc,
        cashAmount: cash,
        onlineAmount: online,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        allowOutOfStock,
      });
      toast(`Sold · ${inr(data.total)}`, {
        tone: "success",
        action: { label: "Undo", run: () => void undoSale(data.id) },
      });
      setDiscount("");
      setName("");
      setPhone("");
      setSplit(false);
      setCashPart("");
      onSold();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !allowOutOfStock) {
        if (window.confirm(`${err.message}. Sell anyway?`)) {
          setBusy(false);
          await submit(true);
          return;
        }
      } else {
        toast(errorText(err), { tone: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Checkout"
      subtitle={`${lines.length} product${lines.length === 1 ? "" : "s"}`}
      footer={
        <button type="button" className="acc-btn is-primary is-big is-block" onClick={() => void submit()} disabled={busy || !lines.length}>
          {busy ? <Loader2 className="acc-spin" /> : null}
          Complete sale {inr(total)}
        </button>
      }
    >
      <ul className="acc-cart-lines">
        {lines.map((line, i) => (
          <li key={`${line.productId}-${i}`}>
            <div className="acc-cart-name">
              <strong>{line.name}</strong>
              <button type="button" className="acc-icon-btn is-small" onClick={() => onChange(lines.filter((_, x) => x !== i))} aria-label="Remove">
                <Trash2 />
              </button>
            </div>
            <div className="acc-cart-edit">
              <div className="acc-mini-stepper">
                <button type="button" onClick={() => update(i, { qty: Math.max(1, line.qty - 1) })} aria-label="Less">
                  <Minus />
                </button>
                <span>{line.qty}</span>
                <button type="button" onClick={() => update(i, { qty: line.qty + 1 })} aria-label="More">
                  <Plus />
                </button>
              </div>
              <span className="acc-x">×</span>
              <label className="acc-inline-amount">
                ₹
                <input
                  type="number"
                  inputMode="decimal"
                  value={line.rate}
                  onChange={(e) => update(i, { rate: Number(e.target.value) || 0 })}
                  onFocus={(e) => e.target.select()}
                  aria-label="Rate"
                />
              </label>
              <b>{inr(line.qty * line.rate)}</b>
            </div>
          </li>
        ))}
      </ul>
      <div className="acc-form-grid">
        <label className="acc-field">
          <span>Discount ₹</span>
          <input type="number" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
        </label>
        <div className="acc-field">
          <span>Total</span>
          <b className="acc-total-big">{inr(total)}</b>
        </div>
      </div>
      <Segmented
        className="is-pay"
        value={split ? "SPLIT" : payMode}
        onChange={(v) => {
          if (v === "SPLIT") setSplit(true);
          else {
            setSplit(false);
            onPayMode(v as PayMode);
          }
        }}
        options={[
          { value: "CASH", label: "Cash" },
          { value: "ONLINE", label: "UPI" },
          { value: "SPLIT", label: "Split" },
        ]}
      />
      {split ? (
        <div className="acc-form-grid">
          <label className="acc-field">
            <span>Cash ₹</span>
            <input type="number" inputMode="decimal" value={cashPart} onChange={(e) => setCashPart(e.target.value)} />
          </label>
          <div className="acc-field">
            <span>UPI</span>
            <b>{inr(online)}</b>
          </div>
        </div>
      ) : null}
      <details className="acc-more">
        <summary>Customer name / phone (optional)</summary>
        <div className="acc-form-grid">
          <label className="acc-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="acc-field">
            <span>Phone</span>
            <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={10} />
          </label>
        </div>
      </details>
    </Sheet>
  );
}
