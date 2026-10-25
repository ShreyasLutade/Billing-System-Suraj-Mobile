import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import {
  ClipboardCheck,
  Loader2,
  Minus,
  PackagePlus,
  Pencil,
  Plus,
  Smartphone,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { BackLink } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { accApi, type AccModelQty, type AccProduct, type AccStockMove } from "./accApi";
import {
  COMMON_PHONE_BRANDS,
  CategoryIcon,
  Empty,
  Sheet,
  StockBadge,
  checkedLabel,
  dateTime,
  errorText,
  inr,
  needsCheck,
  patchCatalogProduct,
  plural,
  refreshCatalog,
  sortedQty,
  toast,
  useAccCatalog,
} from "./shared";

/**
 * One product: stock, the split by phone brand (a record only), weekly count
 * and history. Covers / glass are bought as one product and sorted here
 * later, e.g. Silicone Cover 100 → Vivo 30, Samsung 25, Redmi… Stock only
 * comes in from a supplier on Add stock; nothing here raises it.
 */

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export const MOVE_LABEL: Record<AccStockMove["kind"], string> = {
  OPENING: "Opening stock",
  PURCHASE: "Stock added",
  SALE: "Sold",
  VOID: "Bill cancelled",
  ADJUST: "Count corrected",
  COUNT: "Stock check",
};

export function AccProductPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { catalog } = useAccCatalog();
  const product = catalog?.products.find((p) => p.id === id) || null;
  const category = catalog?.categories.find((c) => c.id === product?.categoryId);
  const [sorting, setSorting] = useState(false);
  const [counting, setCounting] = useState(false);
  const [moves, setMoves] = useState<AccStockMove[] | null>(null);

  const loadHistory = () =>
    id
      ? accApi
          .productHistory(id)
          .then(({ data }) => setMoves(data))
          .catch(() => setMoves([]))
      : undefined;

  useEffect(() => {
    setMoves(null);
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, product?.stockQty]);

  if (!catalog) {
    return (
      <div className="acc-page">
        <div className="acc-loading">
          <Loader2 className="acc-spin" /> Loading…
        </div>
      </div>
    );
  }
  if (!product) {
    return (
      <div className="acc-page">
        <BackLink to="/acc/stock" historyBack>Stock</BackLink>
        <Empty title="Product not found">It may have been removed.</Empty>
      </div>
    );
  }

  const { sorted, unsorted } = sortedQty(product);
  const total = Math.max(product.stockQty, 0);
  const overSorted = unsorted < 0;

  async function toggleFav() {
    const p = product!;
    patchCatalogProduct({ ...p, isFavourite: !p.isFavourite });
    try {
      const { data } = await accApi.setFavourite(p.id, !p.isFavourite);
      patchCatalogProduct(data);
    } catch (err) {
      patchCatalogProduct(p);
      toast(errorText(err), { tone: "error" });
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${product!.name}? Past bills keep it.`)) return;
    try {
      await accApi.deleteProduct(product!.id);
      toast("Product removed");
      void refreshCatalog();
      navigate("/acc/stock", { replace: true });
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    }
  }

  const models = [...product.models].sort((a, b) => b.qty - a.qty || collator.compare(a.model, b.model));
  const maxModel = Math.max(1, ...models.map((m) => m.qty));

  return (
    <div className="acc-page acc-product-page">
      <BackLink to="/acc/stock" historyBack>Stock</BackLink>

      <section className="acc-card acc-product-hero">
        <CategoryIcon icon={category?.icon || "package"} variant="3d" size="lg" />
        <div className="acc-product-hero-text">
          <small>{[product.categoryName, product.type, product.brand].filter(Boolean).join(" · ")}</small>
          <h1 className="acc-h1">{product.name}</h1>
          <div className="acc-price-tags">
            <span>
              Sell <b>{inr(product.sellingPrice)}</b>
            </span>
            {product.wholesalePrice ? (
              <span>
                Wholesale <b>{inr(product.wholesalePrice)}</b>
              </span>
            ) : null}
            {isAdmin && product.purchasePrice ? (
              <span>
                Cost <b>{inr(product.purchasePrice, true)}</b>
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className={clsx("acc-star is-big", product.isFavourite && "is-on")}
          onClick={() => void toggleFav()}
          aria-label={product.isFavourite ? "Remove from counter" : "Show on counter"}
          title={product.isFavourite ? "On the counter" : "Show on counter"}
        >
          <Star />
        </button>
      </section>

      <section className="acc-card acc-stock-card">
        <div className="acc-stock-card-top">
          <div>
            <small>In stock</small>
            <b>
              {product.stockQty} <span>pcs</span>
            </b>
          </div>
          <StockBadge qty={product.stockQty} low={product.lowStockAt} long />
        </div>
        <div className="acc-split-bar" role="img" aria-label={`${sorted} sorted, ${Math.max(unsorted, 0)} not sorted`}>
          <i style={{ flexGrow: Math.min(sorted, total) }} />
          <span style={{ flexGrow: Math.max(unsorted, 0) }} />
        </div>
        <div className="acc-split-legend">
          <span>
            <i className="is-sorted" /> Sorted by brand <b>{sorted}</b>
          </span>
          <span>
            <i className="is-unsorted" /> Not sorted <b className={clsx(overSorted && "is-red")}>{Math.max(unsorted, 0)}</b>
          </span>
          <span className={clsx("acc-checked", needsCheck(product.countedAt) && "is-stale")}>{checkedLabel(product.countedAt)}</span>
        </div>
        {overSorted ? (
          <p className="acc-warn-text">
            Brands add up to {sorted} but stock is {product.stockQty}. Update the brands or do a count to fix it.
          </p>
        ) : null}
        <div className="acc-action-tiles">
          <Link to="/acc/stock/in" state={{ productId: product.id }}>
            <PackagePlus /> Add stock
          </Link>
          <button type="button" onClick={() => setCounting(true)}>
            <ClipboardCheck /> Count
          </button>
          <Link to={`/acc/stock/${product.id}/edit`}>
            <Pencil /> Edit
          </Link>
          <button type="button" className="is-danger" onClick={() => void remove()}>
            <Trash2 /> Remove
          </button>
        </div>
      </section>

      <section className="acc-card">
        <div className="acc-card-head">
          <h3 className="acc-card-title">
            <Smartphone /> By phone brand
          </h3>
          {models.length ? (
            <button type="button" className="acc-btn is-small" onClick={() => setSorting(true)}>
              <Pencil /> Update
            </button>
          ) : null}
        </div>
        {models.length ? (
          <ul className="acc-model-list">
            {models.map((m) => (
              <li key={m.model} className={clsx(m.qty <= 0 && "is-zero")}>
                <span className="acc-model-name">{m.model}</span>
                <span className="acc-model-bar">
                  <i style={{ width: `${(m.qty / maxModel) * 100}%` }} />
                </span>
                <b>{m.qty}</b>
              </li>
            ))}
            {unsorted > 0 ? (
              <li className="is-unsorted">
                <span className="acc-model-name">Not sorted</span>
                <span className="acc-model-bar">
                  <i style={{ width: `${Math.min(100, (unsorted / maxModel) * 100)}%` }} />
                </span>
                <b>{unsorted}</b>
              </li>
            ) : null}
          </ul>
        ) : (
          <div className="acc-sort-empty">
            <p>
              <strong>Not sorted yet.</strong> When you have time, split these {plural(total, "piece")} by phone brand (e.g.
              30 Vivo, 25 Samsung, 20 Redmi). It's only for your record; check and update it each week. The counter still
              sells <b>{product.name}</b>.
            </p>
            <button type="button" className="acc-btn is-primary" onClick={() => setSorting(true)} disabled={total <= 0}>
              <Smartphone /> Sort by phone brand
            </button>
          </div>
        )}
      </section>

      <section className="acc-card">
        <h3 className="acc-card-title">History</h3>
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
      </section>

      <SortSheet open={sorting} product={product} onClose={() => setSorting(false)} />
      <CountSheet open={counting} product={product} onClose={() => setCounting(false)} />
    </div>
  );
}

/** Model rows being edited; qty kept as text so the field can be cleared. */
type Row = { model: string; qty: string };

/** Brands already used in the shop first (most used on top), then popular phone brands. */
function modelSuggestions(products: AccProduct[], taken: string[]) {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const seen = new Map<string, number>();
  for (const p of products) for (const m of p.models) seen.set(m.model, (seen.get(m.model) || 0) + 1);
  const inShop = [...seen.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).map(([m]) => m);
  const out: string[] = [];
  for (const m of [...inShop, ...COMMON_PHONE_BRANDS]) {
    if (!used.has(m.toLowerCase()) && !out.some((x) => x.toLowerCase() === m.toLowerCase())) out.push(m);
  }
  return out;
}

/** Split / update the stock by phone brand. */
export function SortSheet({ open, product, onClose }: { open: boolean; product: AccProduct; onClose: () => void }) {
  const { catalog } = useAccCatalog();
  const [rows, setRows] = useState<Row[]>([]);
  const [newModel, setNewModel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(product.models.map((m) => ({ model: m.model, qty: String(m.qty) })));
    setNewModel("");
  }, [open, product]);

  const total = Math.max(product.stockQty, 0);
  const sorted = rows.reduce((a, r) => a + (Math.floor(Number(r.qty)) || 0), 0);
  const left = total - sorted;
  const suggestions = useMemo(
    () => modelSuggestions(catalog?.products ?? [], rows.map((r) => r.model)),
    [catalog, rows],
  );
  const quick = suggestions.filter((m) => !newModel || m.toLowerCase().includes(newModel.toLowerCase())).slice(0, 12);

  function add(model: string) {
    const name = model.replace(/\s+/g, " ").trim();
    if (!name) return;
    if (rows.some((r) => r.model.toLowerCase() === name.toLowerCase())) {
      toast(`${name} is already in the list`);
      return;
    }
    setRows([...rows, { model: name, qty: "" }]);
    setNewModel("");
  }

  const bump = (i: number, by: number) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, qty: String(Math.max(0, (Math.floor(Number(r.qty)) || 0) + by)) } : r)));

  async function save() {
    if (busy) return;
    if (left < 0) {
      toast(`That's ${-left} more than the ${total} in stock`, { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const models: AccModelQty[] = rows
        .map((r) => ({ model: r.model, qty: Math.max(0, Math.floor(Number(r.qty)) || 0) }))
        .filter((r) => r.model);
      const { data } = await accApi.setProductModels(product.id, models);
      patchCatalogProduct(data);
      toast("Brands saved");
      onClose();
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
      title="Sort by phone brand"
      subtitle={`${product.name} · ${total} in stock`}
      footer={
        <div className="acc-sort-foot">
          <span className={clsx(left < 0 && "is-red")}>
            {left >= 0 ? (
              <>
                <b>{sorted}</b> sorted · <b>{left}</b> not sorted
              </>
            ) : (
              <>
                <b>{-left}</b> too many
              </>
            )}
          </span>
          <button type="button" className="acc-btn is-primary" onClick={() => void save()} disabled={busy || left < 0}>
            {busy ? <Loader2 className="acc-spin" /> : null} Save
          </button>
        </div>
      }
    >
      <div className="acc-sort-meter">
        <i style={{ width: `${total ? Math.min(100, (sorted / total) * 100) : 0}%` }} className={clsx(left < 0 && "is-over")} />
      </div>

      {rows.length ? (
        <ul className="acc-sort-rows">
          {rows.map((r, i) => (
            <li key={r.model}>
              <span className="acc-model-name">{r.model}</span>
              <div className="acc-mini-stepper">
                <button type="button" onClick={() => bump(i, -1)} aria-label="Less">
                  <Minus />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  value={r.qty}
                  placeholder="0"
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                  onFocus={(e) => e.target.select()}
                  aria-label={`${r.model} pieces`}
                />
                <button type="button" onClick={() => bump(i, 1)} aria-label="More">
                  <Plus />
                </button>
              </div>
              <button
                type="button"
                className="acc-icon-btn is-small"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                aria-label={`Remove ${r.model}`}
              >
                <X />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="acc-hint">Add the phone brands you have this product for, then enter how many of each.</p>
      )}

      <div className="acc-field">
        <span>Add phone brand</span>
        <div className="acc-add-model">
          <input
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(newModel);
              }
            }}
            placeholder="e.g. Vivo"
          />
          <button type="button" className="acc-btn" onClick={() => add(newModel)} disabled={!newModel.trim()}>
            <Plus /> Add
          </button>
        </div>
        <div className="acc-chips">
          {quick.map((m) => (
            <button key={m} type="button" className="acc-chip is-small is-ghost" onClick={() => add(m)}>
              + {m}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Count one product on the shelf. Sorted products are counted per brand
 * (plus the unsorted pile); the total follows. A count can only find the
 * same or fewer pieces; extra stock comes in from a supplier.
 */
export function CountSheet({ open, product, onClose }: { open: boolean; product: AccProduct; onClose: () => void }) {
  const [total, setTotal] = useState("");
  const [models, setModels] = useState<Row[]>([]);
  const [loose, setLoose] = useState("");
  const [busy, setBusy] = useState(false);
  const byModel = product.models.length > 0;

  useEffect(() => {
    if (!open) return;
    setTotal(String(Math.max(product.stockQty, 0)));
    setModels(product.models.map((m) => ({ model: m.model, qty: String(m.qty) })));
    setLoose(String(Math.max(sortedQty(product).unsorted, 0)));
  }, [open, product]);

  const counted = byModel
    ? models.reduce((a, m) => a + (Math.floor(Number(m.qty)) || 0), 0) + (Math.floor(Number(loose)) || 0)
    : Math.max(0, Math.floor(Number(total)) || 0);
  const diff = counted - product.stockQty;
  const tooMany = diff > 0;

  async function save() {
    if (busy || tooMany) return;
    setBusy(true);
    try {
      const { data } = await accApi.stockCheck([
        {
          productId: product.id,
          qty: counted,
          ...(byModel
            ? { models: models.map((m) => ({ model: m.model, qty: Math.max(0, Math.floor(Number(m.qty)) || 0) })) }
            : {}),
        },
      ]);
      data.products.forEach(patchCatalogProduct);
      toast(diff === 0 ? "Counted — matches the system" : `Counted · ${diff > 0 ? "+" : ""}${diff} pcs`);
      onClose();
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
      title="Count stock"
      subtitle={`${product.name} · system says ${product.stockQty}`}
      footer={
        <div className="acc-sort-foot">
          <span className={clsx(diff > 0 && "is-green", diff < 0 && "is-red")}>
            Counted <b>{counted}</b>
            {diff !== 0 ? ` (${diff > 0 ? "+" : ""}${diff})` : " · matches"}
          </span>
          <button type="button" className="acc-btn is-primary" onClick={() => void save()} disabled={busy || tooMany}>
            {busy ? <Loader2 className="acc-spin" /> : <ClipboardCheck />} Save count
          </button>
        </div>
      }
    >
      {byModel ? (
        <ul className="acc-sort-rows">
          {models.map((m, i) => (
            <li key={m.model}>
              <span className="acc-model-name">{m.model}</span>
              <input
                className="acc-count-input"
                type="number"
                inputMode="numeric"
                value={m.qty}
                onChange={(e) => setModels(models.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                onFocus={(e) => e.target.select()}
                aria-label={`${m.model} counted`}
              />
            </li>
          ))}
          <li className="is-unsorted">
            <span className="acc-model-name">Not sorted</span>
            <input
              className="acc-count-input"
              type="number"
              inputMode="numeric"
              value={loose}
              onChange={(e) => setLoose(e.target.value)}
              onFocus={(e) => e.target.select()}
              aria-label="Not sorted counted"
            />
          </li>
        </ul>
      ) : (
        <label className="acc-field">
          <span>Pieces on the shelf</span>
          <input
            className="acc-count-big"
            type="number"
            inputMode="numeric"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            onFocus={(e) => e.target.select()}
            autoFocus
          />
        </label>
      )}
      {tooMany ? (
        <p className="acc-warn-text">
          That's {diff} more than in stock. Extra pieces must come in from the supplier on{" "}
          <Link to="/acc/stock/in" state={{ productId: product.id }}>
            Add stock
          </Link>
          .
        </p>
      ) : null}
    </Sheet>
  );
}
