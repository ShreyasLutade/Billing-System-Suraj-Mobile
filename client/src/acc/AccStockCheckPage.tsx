import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Check, ChevronDown, ClipboardCheck, Loader2, Search } from "lucide-react";
import { BackLink, SearchClearButton } from "../components/ui";
import { accApi, type AccProduct, type AccStockCheckItem } from "./accApi";
import {
  CategoryIcon,
  Empty,
  checkedLabel,
  errorText,
  needsCheck,
  patchCatalogProduct,
  plural,
  sortedQty,
  toast,
  useAccCatalog,
} from "./shared";

/**
 * Weekly stock check: walk the shelf category by category and type what's
 * there. Sorted products are counted per phone brand plus the unsorted pile.
 * Only products you touch are saved; each one is marked counted today. A
 * count can only lower stock; extra pieces come in from a supplier.
 */

type Entry = { total: string; models: Record<string, string>; loose: string };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function countedOf(p: AccProduct, e: Entry) {
  if (!p.models.length) return Math.max(0, Math.floor(Number(e.total)) || 0);
  return p.models.reduce((a, m) => a + (Math.floor(Number(e.models[m.model])) || 0), 0) + (Math.floor(Number(e.loose)) || 0);
}

function startEntry(p: AccProduct): Entry {
  return {
    total: String(Math.max(p.stockQty, 0)),
    models: Object.fromEntries(p.models.map((m) => [m.model, String(m.qty)])),
    loose: String(Math.max(sortedQty(p).unsorted, 0)),
  };
}

export function AccStockCheckPage() {
  const { catalog, error } = useAccCatalog();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyDue, setOnlyDue] = useState(true);
  const [busy, setBusy] = useState(false);

  const products = catalog?.products ?? [];
  const categories = catalog?.categories ?? [];
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const dueCount = products.filter((p) => needsCheck(p.countedAt)).length;
  const doneThisWeek = products.length - dueCount;

  const sections = useMemo(() => {
    const visible = products
      .filter((p) => !onlyDue || needsCheck(p.countedAt) || entries[p.id])
      .filter((p) => !tokens.length || tokens.every((t) => `${p.name} ${p.categoryName}`.toLowerCase().includes(t)))
      .sort((a, b) => collator.compare(a.name, b.name));
    return categories
      .map((c) => ({ category: c, items: visible.filter((p) => p.categoryId === c.id) }))
      .filter((s) => s.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, categories, onlyDue, q, entries]);

  const touched = Object.keys(entries);
  const changes = touched.filter((id) => {
    const p = products.find((x) => x.id === id);
    return p ? countedOf(p, entries[id]) !== p.stockQty : false;
  }).length;
  // Counting more than the system would add stock without a supplier.
  const overCounted = touched
    .map((id) => products.find((x) => x.id === id))
    .filter((p): p is AccProduct => Boolean(p) && countedOf(p!, entries[p!.id]) > p!.stockQty);

  const setEntry = (p: AccProduct, patch: Partial<Entry>) =>
    setEntries((all) => ({ ...all, [p.id]: { ...(all[p.id] || startEntry(p)), ...patch } }));

  function matches(p: AccProduct) {
    setEntries((all) => ({ ...all, [p.id]: startEntry(p) }));
    if (open === p.id) setOpen(null);
  }

  async function save() {
    if (!touched.length || busy) return;
    if (overCounted.length) {
      toast(`${overCounted[0].name}: counted more than in stock. Add extra pieces from the supplier on Add stock.`, { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const items: AccStockCheckItem[] = touched
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is AccProduct => Boolean(p))
        .map((p) => {
          const e = entries[p.id];
          return {
            productId: p.id,
            qty: countedOf(p, e),
            ...(p.models.length
              ? { models: p.models.map((m) => ({ model: m.model, qty: Math.max(0, Math.floor(Number(e.models[m.model])) || 0) })) }
              : {}),
          };
        });
      const { data } = await accApi.stockCheck(items, "Weekly stock check");
      data.products.forEach(patchCatalogProduct);
      setEntries({});
      toast(`Saved ${plural(data.checked, "product")} · ${data.changed} changed`);
      if (dueCount - data.checked <= 0) navigate("/acc/stock");
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const pct = products.length ? Math.round(((doneThisWeek + touched.filter((id) => needsCheck(products.find((p) => p.id === id)?.countedAt)).length) / products.length) * 100) : 0;

  return (
    <div className="acc-page acc-check-page">
      <BackLink to="/acc/stock">Stock</BackLink>
      <div className="acc-title-row">
        <h1>Stock check</h1>
      </div>

      <section className="acc-card acc-check-progress">
        <div>
          <strong>{pct}% counted this week</strong>
          <small>
            {dueCount ? `${plural(dueCount, "product")} left to count` : "All products counted this week"}
            {touched.length ? ` · ${touched.length} entered now` : ""}
          </small>
        </div>
        <div className="acc-sort-meter">
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="acc-hint">
          Count what's on the shelf. Tap ✓ if it matches, or type the real number. Sorted products are counted per phone
          brand. Found extra pieces? Add them from the supplier on <Link to="/acc/stock/in">Add stock</Link>.
        </p>
      </section>

      <label className="acc-search">
        <Search aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product…" />
        <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
      </label>
      <div className="acc-filter-tabs">
        <button type="button" className={clsx(onlyDue && "is-on")} onClick={() => setOnlyDue(true)}>
          To count <small>{dueCount}</small>
        </button>
        <button type="button" className={clsx(!onlyDue && "is-on")} onClick={() => setOnlyDue(false)}>
          All products <small>{products.length}</small>
        </button>
      </div>

      {!catalog ? (
        error ? (
          <Empty title="Could not load stock">{error}</Empty>
        ) : (
          <div className="acc-loading">
            <Loader2 className="acc-spin" /> Loading…
          </div>
        )
      ) : sections.length ? (
        <div className="acc-stock-sections">
          {sections.map(({ category, items }) => (
            <section key={category.id} className="acc-stock-section">
              <header>
                <CategoryIcon icon={category.icon} variant="3d" size="sm" />
                <span className="acc-section-text">
                  <strong>{category.name}</strong>
                  <small>{plural(items.length, "product")}</small>
                </span>
              </header>
              <ul className="acc-check-list">
                {items.map((p) => {
                  const e = entries[p.id];
                  const counted = e ? countedOf(p, e) : null;
                  const diff = counted === null ? 0 : counted - p.stockQty;
                  const expanded = open === p.id;
                  return (
                    <li key={p.id} className={clsx(e && "is-entered", diff !== 0 && "is-diff")}>
                      <div className="acc-check-row">
                        <button
                          type="button"
                          className="acc-check-name"
                          onClick={() => (p.models.length ? setOpen(expanded ? null : p.id) : undefined)}
                        >
                          <strong>{p.name}</strong>
                          <small>
                            System {p.stockQty}
                            {p.models.length ? ` · ${plural(p.models.length, "brand")}` : ""} · {checkedLabel(p.countedAt)}
                          </small>
                        </button>
                        {p.models.length ? (
                          <button
                            type="button"
                            className={clsx("acc-check-total", expanded && "is-open")}
                            onClick={() => setOpen(expanded ? null : p.id)}
                          >
                            {counted ?? "Count"}
                            <ChevronDown />
                          </button>
                        ) : (
                          <input
                            className="acc-count-input"
                            type="number"
                            inputMode="numeric"
                            value={e ? e.total : ""}
                            placeholder={String(p.stockQty)}
                            onChange={(ev) => setEntry(p, { total: ev.target.value })}
                            aria-label={`${p.name} counted`}
                          />
                        )}
                        <button
                          type="button"
                          className={clsx("acc-check-ok", e && diff === 0 && "is-on")}
                          onClick={() => matches(p)}
                          aria-label="Matches the system"
                          title="Matches the system"
                        >
                          <Check />
                        </button>
                      </div>
                      {e && diff !== 0 ? (
                        <p className={clsx("acc-check-diff", diff > 0 ? "is-green" : "is-red")}>
                          {diff > 0 ? `${diff} more than stock: add them on Add stock with the supplier` : `${-diff} missing`}
                        </p>
                      ) : null}
                      {expanded ? (
                        <ul className="acc-sort-rows is-inline">
                          {p.models.map((m) => (
                            <li key={m.model}>
                              <span className="acc-model-name">{m.model}</span>
                              <input
                                className="acc-count-input"
                                type="number"
                                inputMode="numeric"
                                value={e ? e.models[m.model] ?? "" : ""}
                                placeholder={String(m.qty)}
                                onChange={(ev) => setEntry(p, { models: { ...(e || startEntry(p)).models, [m.model]: ev.target.value } })}
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
                              value={e ? e.loose : ""}
                              placeholder={String(Math.max(sortedQty(p).unsorted, 0))}
                              onChange={(ev) => setEntry(p, { loose: ev.target.value })}
                              aria-label="Not sorted counted"
                            />
                          </li>
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <Empty title={onlyDue ? "Everything is counted this week" : "No products"}>
          {onlyDue ? (
            <button type="button" className="acc-btn is-ghost" onClick={() => setOnlyDue(false)}>
              Count again anyway
            </button>
          ) : null}
        </Empty>
      )}

      {touched.length ? (
        <div className="acc-cartbar">
          <button type="button" className="acc-cartbar-btn" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="acc-spin" /> : <ClipboardCheck />}
            <span>
              {plural(touched.length, "product")} · {changes} changed
            </span>
            <em>Save</em>
          </button>
        </div>
      ) : null}
    </div>
  );
}
