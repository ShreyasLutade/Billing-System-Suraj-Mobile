import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { ChevronRight, Loader2, Minus, Plus, Search, ShoppingCart, Star, Trash2, X } from "lucide-react";
import { SearchClearButton } from "../components/ui";
import { ApiError } from "../lib/api";
import { accApi, type AccCategory, type AccProduct, type AccSalesSummary } from "./accApi";
import {
  CategoryIcon,
  Empty,
  Segmented,
  Sheet,
  StockBadge,
  Stepper,
  errorText,
  inr,
  newRef,
  plural,
  refreshCatalog,
  suggestPrices,
  toast,
  useAccCatalog,
} from "./shared";

/**
 * Counter: quick retail billing. Favourite products sit in tiles by
 * category → type/brand → product. Tap a product, tap a price, Sell.
 * Several can go in a cart for one customer.
 */

type PayMode = "CASH" | "ONLINE";
type CartLine = { productId: string; name: string; qty: number; rate: number; stockQty: number; cost: number };

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

function groupKey(product: AccProduct, category: AccCategory) {
  return (category.drillBy === "BRAND" ? product.brand : product.type).trim();
}

/** What the tile shows as its main line inside a type/brand group. */
function tileTitle(product: AccProduct, inGroup: boolean) {
  if (inGroup && product.model) return product.model;
  return product.name;
}

export function AccCounterPage() {
  const { catalog, error } = useAccCatalog();
  const [showAll, setShowAll] = useState(() => readLocal(SHOW_ALL_KEY, false));
  const [payMode, setPayMode] = useState<PayMode>(() => readLocal(PAY_KEY, "CASH"));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
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

  const groups = useMemo(() => {
    if (!category) return [];
    const map = new Map<string, number>();
    for (const p of inCategory) {
      const key = groupKey(p, category);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => (a.key ? (b.key ? collator.compare(a.key, b.key) : -1) : 1));
  }, [inCategory, category]);

  // One type/brand only: skip straight to the products.
  const skipGroups = groups.length <= 1;
  const productList = useMemo(() => {
    if (!category) return [];
    const list = skipGroups || group === null ? inCategory : inCategory.filter((p) => groupKey(p, category) === group);
    return [...list].sort((a, b) => collator.compare(a.model || a.name, b.model || b.name));
  }, [category, group, inCategory, skipGroups]);

  function openCategory(id: string) {
    setCategoryId(id);
    setGroup(null);
  }

  function goHome() {
    setCategoryId(null);
    setGroup(null);
  }

  function addToCart(product: AccProduct, qty: number, rate: number) {
    setCart((lines) => {
      const same = lines.find((l) => l.productId === product.id && l.rate === rate);
      if (same) return lines.map((l) => (l === same ? { ...l, qty: l.qty + qty } : l));
      return [
        ...lines,
        { productId: product.id, name: product.name, qty, rate, stockQty: product.stockQty, cost: product.purchasePrice },
      ];
    });
    toast(`Added ${qty} × ${product.name}`);
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
  const level: "home" | "groups" | "products" = !category ? "home" : !skipGroups && group === null ? "groups" : "products";

  return (
    <div className="acc-page acc-counter">
      <header className="acc-counter-head">
        <div className="acc-title-row">
          <h1>Counter</h1>
          <span className="acc-today" title="Today's retail sales">
            Today <b>{today ? inr(today.total) : "…"}</b>
            <small>{today ? plural(today.count, "bill") : ""}</small>
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
                <button
                  type="button"
                  className={clsx(level === "groups" && "is-on")}
                  onClick={() => setGroup(null)}
                >
                  {category.name}
                </button>
              </>
            ) : null}
            {category && group !== null && !skipGroups ? (
              <>
                <ChevronRight aria-hidden />
                <button type="button" className="is-on">
                  {group || "Other"}
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
              <ProductTile key={p.id} product={p} title={p.name} onTap={() => setSelling(p)} />
            ))}
          </div>
        ) : (
          <Empty title={`Nothing matches “${query}”`}>
            <Link to="/acc/stock/new" className="acc-btn is-ghost">
              <Plus /> Add product
            </Link>
          </Empty>
        )
      ) : level === "home" ? (
        categoryTiles.length ? (
          <div className="acc-tiles">
            {categoryTiles.map(({ category: c, count }) => (
              <button key={c.id} type="button" className="acc-tile is-cat" onClick={() => openCategory(c.id)}>
                <span className="acc-tile-icon">
                  <CategoryIcon icon={c.icon} />
                </span>
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
              <Link to="/acc/stock/new" className="acc-btn">
                <Plus /> Add your first product
              </Link>
            )}
          </Empty>
        )
      ) : level === "groups" ? (
        <div className="acc-tiles">
          {groups.map((g) => (
            <button key={g.key || "_other"} type="button" className="acc-tile is-group" onClick={() => setGroup(g.key)}>
              <strong>{g.key || "Other"}</strong>
              <small>{plural(g.count, "item")}</small>
            </button>
          ))}
          <button type="button" className="acc-tile is-group is-muted" onClick={() => setGroup("\u0000all")}>
            <strong>All {category!.name}</strong>
            <small>{plural(inCategory.length, "item")}</small>
          </button>
        </div>
      ) : (
        <div className="acc-tiles is-products">
          {(group === "\u0000all" ? [...inCategory].sort((a, b) => collator.compare(a.name, b.name)) : productList).map(
            (p) => (
              <ProductTile
                key={p.id}
                product={p}
                title={tileTitle(p, !skipGroups && group !== "\u0000all")}
                onTap={() => setSelling(p)}
              />
            ),
          )}
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
        payMode={payMode}
        onPayMode={setPayMode}
        onClose={() => setSelling(null)}
        onAddToCart={(qty, rate) => {
          addToCart(selling!, qty, rate);
          setSelling(null);
        }}
        onSold={() => {
          setSelling(null);
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

function ProductTile({ product, title, onTap }: { product: AccProduct; title: string; onTap: () => void }) {
  // Inside a type/brand group the title is the phone model; elsewhere lead
  // with the model and say what the item is underneath.
  const main = title === product.name && product.model ? product.model : title;
  const sub =
    main === product.model
      ? title === product.name
        ? [[product.brand, product.type, product.categoryName].filter(Boolean).join(" "), product.color].filter(Boolean).join(" · ")
        : product.color
      : "";
  return (
    <button
      type="button"
      className={clsx("acc-tile is-product", product.stockQty <= 0 && "is-out")}
      onClick={onTap}
    >
      <span className="acc-tile-top">
        <StockBadge qty={product.stockQty} low={product.lowStockAt} />
        {product.isFavourite ? <Star className="acc-tile-star" aria-label="Favourite" /> : null}
      </span>
      <strong>{main}</strong>
      {sub ? <small>{sub}</small> : null}
      <b className="acc-tile-price">{inr(product.sellingPrice)}</b>
    </button>
  );
}

/** Sell one product: pick a price chip (or type), qty, Cash/UPI, Sell. */
function SellSheet({
  product,
  payMode,
  onPayMode,
  onClose,
  onAddToCart,
  onSold,
}: {
  product: AccProduct | null;
  payMode: PayMode;
  onPayMode: (mode: PayMode) => void;
  onClose: () => void;
  onAddToCart: (qty: number, rate: number) => void;
  onSold: () => void;
}) {
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const refId = useRef(newRef());

  useEffect(() => {
    if (!product) return;
    setPrice(product.sellingPrice ? String(product.sellingPrice) : "");
    setQty(1);
    refId.current = newRef();
  }, [product]);

  if (!product) return null;
  const rate = Number(price) || 0;
  const chips = suggestPrices(product.sellingPrice, product.quickPrices);
  const belowCost = product.purchasePrice > 0 && rate > 0 && rate < product.purchasePrice;

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
        items: [{ productId: product.id, qty, rate }],
        ...(payMode === "CASH" ? { cashAmount: rate * qty } : { onlineAmount: rate * qty }),
        allowOutOfStock,
      });
      toast(`${data.number} · ${inr(data.total)} · ${payMode === "CASH" ? "Cash" : "UPI"}`, {
        action: { label: "Undo", run: () => void undoSale(data.id, data.number) },
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

  return (
    <Sheet
      open
      onClose={onClose}
      title={product.name}
      subtitle={
        <>
          <StockBadge qty={product.stockQty} low={product.lowStockAt} /> in stock · MRP {inr(product.sellingPrice)}
        </>
      }
      footer={
        <div className="acc-sell-actions">
          <button type="button" className="acc-btn is-ghost" onClick={() => rate > 0 && onAddToCart(qty, rate)} disabled={rate <= 0}>
            <ShoppingCart /> Add more
          </button>
          <button type="button" className="acc-btn is-primary is-big" onClick={() => void sell()} disabled={busy || rate <= 0}>
            {busy ? <Loader2 className="acc-spin" /> : null}
            Sell {inr(rate * qty)}
          </button>
        </div>
      }
    >
      <div className="acc-price-chips">
        {chips.map((amount) => (
          <button
            key={amount}
            type="button"
            className={clsx("acc-price-chip", rate === amount && "is-on")}
            onClick={() => setPrice(String(amount))}
          >
            {inr(amount)}
          </button>
        ))}
      </div>
      <div className="acc-sell-row">
        <label className={clsx("acc-amount", belowCost && "is-warn")}>
          <span>₹</span>
          <input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onFocus={(e) => e.target.select()}
            aria-label="Selling price"
            placeholder="Price"
          />
        </label>
        <Stepper value={qty} onChange={setQty} big />
      </div>
      {belowCost ? <p className="acc-warn-text">Below cost price ({inr(product.purchasePrice)})</p> : null}
      <Segmented
        className="is-pay"
        value={payMode}
        onChange={onPayMode}
        options={[
          { value: "CASH", label: "Cash" },
          { value: "ONLINE", label: "UPI / Online" },
        ]}
      />
    </Sheet>
  );
}

async function undoSale(id: string, number: string) {
  try {
    await accApi.voidSale(id, "Undo at counter");
    toast(`${number} cancelled, stock put back`);
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
        items: lines.map((l) => ({ productId: l.productId, qty: l.qty, rate: l.rate })),
        discount: disc,
        cashAmount: cash,
        onlineAmount: online,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        allowOutOfStock,
      });
      toast(`${data.number} · ${inr(data.total)} saved`, {
        action: { label: "Undo", run: () => void undoSale(data.id, data.number) },
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
          Save bill {inr(total)}
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
