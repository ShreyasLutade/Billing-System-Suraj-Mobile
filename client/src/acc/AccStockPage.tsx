import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ClipboardCheck, Loader2, PackagePlus, Plus, Search, Star, Truck } from "lucide-react";
import { SearchClearButton } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { accApi, type AccCategory, type AccProduct } from "./accApi";
import {
  CategoryIcon,
  Empty,
  PdfButton,
  Sheet,
  StockBadge,
  checkedLabel,
  errorText,
  inr,
  needsCheck,
  patchCatalogProduct,
  plural,
  sortedQty,
  toast,
  useAccCatalog,
} from "./shared";

/**
 * Stock: every product grouped by category, with how much is sorted by
 * phone model and when it was last counted. Tap a product for its page
 * (breakdown, stock in, count, history).
 */

type Filter = "all" | "fav" | "low" | "check";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function AccStockPage() {
  const { catalog, error } = useAccCatalog();
  const { isAdmin } = useAuth();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pdfOpen, setPdfOpen] = useState(false);

  const products = catalog?.products ?? [];
  const categories = catalog?.categories ?? [];
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const isLow = (p: AccProduct) => p.stockQty <= 0 || (p.lowStockAt > 0 && p.stockQty <= p.lowStockAt);

  const list = useMemo(() => {
    return products
      .filter((p) => !categoryId || p.categoryId === categoryId)
      .filter((p) =>
        filter === "fav" ? p.isFavourite : filter === "low" ? isLow(p) : filter === "check" ? needsCheck(p.countedAt) : true,
      )
      .filter((p) => {
        if (!tokens.length) return true;
        const hay = `${p.name} ${p.type} ${p.brand} ${p.model} ${p.color} ${p.barcode || ""} ${p.models
          .map((m) => m.model)
          .join(" ")}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .sort((a, b) => collator.compare(a.name, b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, categoryId, filter, q]);

  // Category sections in the counter's order; only categories with matches.
  const sections = useMemo(
    () =>
      categories
        .map((c) => ({ category: c, items: list.filter((p) => p.categoryId === c.id) }))
        .filter((s) => s.items.length),
    [categories, list],
  );

  const units = products.reduce((a, p) => a + Math.max(p.stockQty, 0), 0);
  const value = products.reduce((a, p) => a + Math.max(p.stockQty, 0) * p.sellingPrice, 0);
  const lowCount = products.filter(isLow).length;
  const uncheckedCount = products.filter((p) => needsCheck(p.countedAt)).length;

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

      <Link to="/acc/stock/check" className={clsx("acc-check-banner", uncheckedCount === 0 && "is-done")}>
        <span className="acc-check-banner-icon">
          <ClipboardCheck />
        </span>
        <span className="acc-check-banner-text">
          <strong>Weekly stock check</strong>
          <small>
            {products.length === 0
              ? "Add products to start"
              : uncheckedCount === 0
                ? "Everything counted this week"
                : `${uncheckedCount} of ${plural(products.length, "product")} not counted this week`}
          </small>
        </span>
        <em>{uncheckedCount === 0 ? "View" : "Start"}</em>
      </Link>

      <div className="acc-stat-strip">
        <div>
          <small>Products</small>
          <b>{products.length}</b>
        </div>
        <div>
          <small>Pieces</small>
          <b>{units}</b>
        </div>
        <div>
          <small>Value (MRP)</small>
          <b>{inr(value)}</b>
        </div>
        <button type="button" className={clsx(lowCount && "is-warn")} onClick={() => setFilter(filter === "low" ? "all" : "low")}>
          <small>Low / out</small>
          <b>{lowCount}</b>
        </button>
      </div>

      <label className="acc-search">
        <Search aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product, phone model, brand…" />
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
            <CategoryIcon icon={c.icon} variant="3d" size="xs" />
            {c.name}
          </button>
        ))}
      </div>
      <div className="acc-filter-tabs">
        {(
          [
            ["all", "All", products.length],
            ["fav", "On counter", products.filter((p) => p.isFavourite).length],
            ["low", "Low & out", lowCount],
            ["check", "Not counted", uncheckedCount],
          ] as Array<[Filter, string, number]>
        ).map(([key, label, count]) => (
          <button key={key} type="button" className={clsx(filter === key && "is-on")} onClick={() => setFilter(key)}>
            {label}
            <small>{count}</small>
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
        <div className="acc-stock-sections">
          {sections.map(({ category, items }) => (
            <StockSection key={category.id} category={category} items={items} />
          ))}
        </div>
      ) : (
        <Empty title={products.length ? "No products match" : "No products yet"}>
          <Link to="/acc/stock/new" className="acc-btn">
            <Plus /> Add product
          </Link>
        </Empty>
      )}

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

function StockSection({ category, items }: { category: AccCategory; items: AccProduct[] }) {
  const navigate = useNavigate();
  const pieces = items.reduce((a, p) => a + Math.max(p.stockQty, 0), 0);
  const value = items.reduce((a, p) => a + Math.max(p.stockQty, 0) * p.sellingPrice, 0);

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
    <section className="acc-stock-section">
      <header>
        <CategoryIcon icon={category.icon} variant="3d" size="sm" />
        <span className="acc-section-text">
          <strong>{category.name}</strong>
          <small>
            {plural(items.length, "product")} · {pieces} pcs
          </small>
        </span>
        <b>{inr(value)}</b>
      </header>
      <ul className="acc-list">
        {items.map((p) => {
          const { sorted } = sortedQty(p);
          const total = Math.max(p.stockQty, 0);
          const stale = needsCheck(p.countedAt);
          return (
            <li key={p.id} className="acc-row">
              <button type="button" className="acc-row-main" onClick={() => navigate(`/acc/stock/${p.id}`)}>
                <span className="acc-row-text">
                  <strong>{p.name}</strong>
                  <small>
                    {inr(p.sellingPrice)}
                    {p.wholesalePrice ? ` · wholesale ${inr(p.wholesalePrice)}` : ""}
                  </small>
                  <span className="acc-row-meta">
                    {p.models.length ? (
                      <span className="acc-sortbar" title={`${sorted} of ${total} sorted by phone model`}>
                        <span>
                          <i style={{ width: `${total ? Math.min(100, (sorted / total) * 100) : 0}%` }} />
                        </span>
                        <em>
                          {sorted}/{total} sorted
                        </em>
                      </span>
                    ) : null}
                    <span className={clsx("acc-checked", stale && "is-stale")}>{checkedLabel(p.countedAt)}</span>
                  </span>
                </span>
                <StockBadge qty={p.stockQty} low={p.lowStockAt} long />
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
          );
        })}
      </ul>
    </section>
  );
}
