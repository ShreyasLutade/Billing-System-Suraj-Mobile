import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { Check, Loader2, Plus, Star, X } from "lucide-react";
import { BackLink } from "../components/ui";
import { accApi, type AccCategory, type ProductInput } from "./accApi";
import { CATEGORY_ICONS, CategoryIcon, Sheet, errorText, inr, refreshCatalog, suggestPrices, toast, useAccCatalog } from "./shared";

/**
 * Add / edit an accessory: category, type / brand, prices. A new product
 * starts at 0 pieces; stock only comes in from a supplier on Add stock.
 * Covers and glass are one product (e.g. Silicone Cover); splitting the
 * pieces by phone brand is done later from the product page.
 */

const EMPTY_FORM: ProductInput = {
  categoryId: "",
  type: "",
  brand: "",
  color: "",
  name: "",
  barcode: "",
  purchasePrice: 0,
  sellingPrice: 0,
  wholesalePrice: 0,
  quickPrices: [],
  lowStockAt: 2,
  isFavourite: true,
};

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function distinct(values: string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort(collator.compare);
}

export function AccProductFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { catalog } = useAccCatalog();
  const [form, setForm] = useState<ProductInput>(EMPTY_FORM);
  const [model, setModel] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCategory, setNewCategory] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  const products = catalog?.products ?? [];
  const categories = catalog?.categories ?? [];
  const category = categories.find((c) => c.id === form.categoryId);

  useEffect(() => {
    if (!editing || loaded || !catalog) return;
    const p = catalog.products.find((x) => x.id === id);
    if (!p) {
      toast("Product not found", { tone: "error" });
      navigate("/acc/stock", { replace: true });
      return;
    }
    setForm({
      categoryId: p.categoryId,
      type: p.type,
      brand: p.brand,
      color: p.color,
      name: p.name,
      barcode: p.barcode || "",
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      wholesalePrice: p.wholesalePrice,
      quickPrices: p.quickPrices,
      lowStockAt: p.lowStockAt,
      isFavourite: p.isFavourite,
    });
    setModel(p.model);
    setLoaded(true);
  }, [editing, loaded, catalog, id, navigate]);

  // Suggestions from what's already in this category.
  const inCat = products.filter((p) => p.categoryId === form.categoryId);
  const typeOptions = useMemo(() => distinct(inCat.map((p) => p.type)), [inCat]);
  const brandOptions = useMemo(() => distinct(inCat.map((p) => p.brand)), [inCat]);
  const modelOptions = useMemo(() => distinct(products.map((p) => p.model)), [products]);

  const set = (patch: Partial<ProductInput>) => setForm((f) => ({ ...f, ...patch }));

  const autoName = (m: string) =>
    [[form.brand, form.type, category?.name].filter(Boolean).join(" "), m, form.color].filter(Boolean).join(" · ");

  function addQuickPrice() {
    const n = Number(priceInput);
    if (n > 0 && !form.quickPrices.includes(n) && form.quickPrices.length < 8) {
      set({ quickPrices: [...form.quickPrices, n].sort((a, b) => a - b) });
    }
    setPriceInput("");
  }

  async function submit(addAnother: boolean) {
    if (busy) return;
    if (!form.categoryId) {
      toast("Choose a category", { tone: "error" });
      return;
    }
    if (form.sellingPrice <= 0) {
      toast("Enter the selling price", { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        // Keep a typed name; an empty one is rebuilt from the fields.
        await accApi.updateProduct(id!, { ...form, model });
        toast("Product saved");
        void refreshCatalog();
        navigate("/acc/stock");
        return;
      }
      const { data } = await accApi.createProducts({
        ...form,
        variants: [{ model: "", qty: 0 }],
      });
      toast(`Added ${data[0].name}`);
      void refreshCatalog();
      if (addAnother) {
        // Same category and prices: next type or brand.
        set({ name: "", barcode: "", type: "", brand: "" });
        window.scrollTo({ top: 0 });
      } else {
        navigate(`/acc/stock/${data[0].id}`);
      }
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const margin = form.sellingPrice && form.purchasePrice ? Math.round(((form.sellingPrice - form.purchasePrice) / form.sellingPrice) * 100) : null;
  const chipsPreview = suggestPrices(form.sellingPrice, form.quickPrices);
  const drillBrand = category?.drillBy === "BRAND";

  if (editing && !loaded) {
    return (
      <div className="acc-page">
        <div className="acc-loading">
          <Loader2 className="acc-spin" /> Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="acc-page acc-product-form">
      <BackLink to="/acc/stock" historyBack>Stock</BackLink>
      <h1 className="acc-h1">{editing ? "Edit product" : "New product"}</h1>

      <section className="acc-card">
        <h3 className="acc-card-title">1. Category</h3>
        <div className="acc-cat-pick">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={clsx("acc-cat-chip", form.categoryId === c.id && "is-on")}
              onClick={() => set({ categoryId: c.id })}
            >
              <CategoryIcon icon={c.icon} variant="3d" size="sm" />
              {c.name}
            </button>
          ))}
          <button type="button" className="acc-cat-chip is-add" onClick={() => setNewCategory(true)}>
            <Plus /> New
          </button>
        </div>
      </section>

      {category ? (
        <>
          <section className="acc-card">
            <h3 className="acc-card-title">2. {drillBrand ? "Brand & type" : "Type & brand"}</h3>
            {[drillBrand ? "brand" : "type", drillBrand ? "type" : "brand"].map((field) => {
              const options = field === "type" ? typeOptions : brandOptions;
              const value = field === "type" ? form.type : form.brand;
              const label =
                field === "type"
                  ? `Type${drillBrand ? " (optional)" : ""} — e.g. Silicone, Rubber, 9D, Privacy`
                  : `Brand${drillBrand ? "" : " (optional)"} — e.g. boAt, Realme, Samsung`;
              return (
                <div key={field} className="acc-field">
                  <span>{label}</span>
                  <div className="acc-chips">
                    {options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        className={clsx("acc-chip", value === o && "is-on")}
                        onClick={() => set(field === "type" ? { type: value === o ? "" : o } : { brand: value === o ? "" : o })}
                      >
                        {o}
                      </button>
                    ))}
                    <input
                      className="acc-chip-input"
                      value={options.includes(value) ? "" : value}
                      onChange={(e) => set(field === "type" ? { type: e.target.value } : { brand: e.target.value })}
                      placeholder={options.length ? "+ New" : "Type here"}
                    />
                  </div>
                </div>
              );
            })}
            <label className="acc-field">
              <span>Colour (optional)</span>
              <input value={form.color} onChange={(e) => set({ color: e.target.value })} placeholder="Black, Clear…" />
            </label>
          </section>

          <section className="acc-card">
            <h3 className="acc-card-title">3. Name</h3>
            <datalist id="acc-models">
              {modelOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {editing ? (
              <>
                {model ? (
                  // Older products were added one per phone model.
                  <label className="acc-field">
                    <span>Fits phone / model</span>
                    <input value={model} onChange={(e) => setModel(e.target.value)} list="acc-models" />
                  </label>
                ) : null}
                <label className="acc-field">
                  <span>Name on bills</span>
                  <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={autoName(model)} />
                </label>
              </>
            ) : (
              <>
                <label className="acc-field">
                  <span>Name on bills</span>
                  <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={autoName("") || "e.g. Silicone Cover"} />
                </label>
                <p className="acc-hint">
                  Add covers and glass as one product (e.g. Silicone Cover), not one per phone. It starts at 0 pieces: bring
                  stock in from the supplier on <Link to="/acc/stock/in">Add stock</Link>. Later, open the product to split the
                  pieces by phone brand for your record.
                </p>
              </>
            )}
          </section>

          <section className="acc-card">
            <h3 className="acc-card-title">4. Prices</h3>
            <div className="acc-form-grid is-3">
              <label className="acc-field">
                <span>Cost ₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={form.purchasePrice || ""}
                  onChange={(e) => set({ purchasePrice: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="acc-field">
                <span>Selling ₹ *</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={form.sellingPrice || ""}
                  onChange={(e) => set({ sellingPrice: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="acc-field">
                <span>Wholesale ₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={form.wholesalePrice || ""}
                  onChange={(e) => set({ wholesalePrice: Number(e.target.value) || 0 })}
                />
              </label>
            </div>
            {margin !== null ? (
              <p className={clsx("acc-hint", margin < 0 && "is-red")}>
                Margin {inr(form.sellingPrice - form.purchasePrice)} ({margin}%)
              </p>
            ) : null}
            <div className="acc-field">
              <span>Counter price buttons {form.quickPrices.length ? "" : "(auto)"}</span>
              <div className="acc-chips">
                {form.quickPrices.length
                  ? form.quickPrices.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="acc-chip is-on"
                        onClick={() => set({ quickPrices: form.quickPrices.filter((x) => x !== p) })}
                        title="Remove"
                      >
                        {inr(p)} <X />
                      </button>
                    ))
                  : chipsPreview.map((p) => (
                      <span key={p} className="acc-chip is-ghost">
                        {inr(p)}
                      </span>
                    ))}
                <input
                  className="acc-chip-input"
                  type="number"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addQuickPrice();
                    }
                  }}
                  onBlur={addQuickPrice}
                  placeholder="+ ₹"
                />
              </div>
            </div>
          </section>

          <section className="acc-card">
            <h3 className="acc-card-title">5. Counter & stock</h3>
            <button
              type="button"
              className={clsx("acc-toggle", form.isFavourite && "is-on")}
              onClick={() => set({ isFavourite: !form.isFavourite })}
            >
              <Star />
              <span>
                <strong>Show on counter</strong>
                <small>Favourites appear as tiles for quick billing</small>
              </span>
              <i aria-hidden />
            </button>
            <div className="acc-form-grid">
              <label className="acc-field">
                <span>Low stock alert at</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.lowStockAt}
                  onChange={(e) => set({ lowStockAt: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
              </label>
              <label className="acc-field">
                <span>Barcode (optional)</span>
                <input value={form.barcode || ""} onChange={(e) => set({ barcode: e.target.value })} />
              </label>
            </div>
          </section>

          <div className="acc-form-actions">
            {!editing ? (
              <button type="button" className="acc-btn" onClick={() => void submit(true)} disabled={busy}>
                Save & add more
              </button>
            ) : null}
            <button type="button" className="acc-btn is-primary" onClick={() => void submit(false)} disabled={busy}>
              {busy ? <Loader2 className="acc-spin" /> : <Check />} Save
            </button>
          </div>
        </>
      ) : (
        <p className="acc-hint">Pick a category to continue.</p>
      )}

      <CategorySheet
        open={newCategory}
        onClose={() => setNewCategory(false)}
        onSaved={(c) => {
          set({ categoryId: c.id });
          setNewCategory(false);
        }}
      />
    </div>
  );
}

export function CategorySheet({
  open,
  onClose,
  onSaved,
  category,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (category: AccCategory) => void;
  category?: AccCategory;
}) {
  const [name, setName] = useState("");
  const [drillBy, setDrillBy] = useState<"TYPE" | "BRAND">("TYPE");
  const [icon, setIcon] = useState("package");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(category?.name || "");
    setDrillBy(category?.drillBy || "TYPE");
    setIcon(category?.icon || "package");
  }, [open, category]);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), drillBy, icon };
      const { data } = category ? await accApi.updateCategory(category.id, body) : await accApi.createCategory(body);
      await refreshCatalog();
      toast(category ? "Category saved" : `Added ${data.name}`);
      onSaved(data);
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
      title={category ? "Edit category" : "New category"}
      footer={
        <button type="button" className="acc-btn is-primary is-block" onClick={() => void save()} disabled={busy || !name.trim()}>
          Save
        </button>
      }
    >
      <label className="acc-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car charger" autoFocus />
      </label>
      <div className="acc-field">
        <span>On the counter, after tapping it show</span>
        <div className="acc-chips">
          <button type="button" className={clsx("acc-chip", drillBy === "TYPE" && "is-on")} onClick={() => setDrillBy("TYPE")}>
            Types (Silicone, Rubber…)
          </button>
          <button type="button" className={clsx("acc-chip", drillBy === "BRAND" && "is-on")} onClick={() => setDrillBy("BRAND")}>
            Brands (boAt, JBL…)
          </button>
        </div>
      </div>
      <div className="acc-field">
        <span>Icon</span>
        <div className="acc-icon-pick">
          {Object.keys(CATEGORY_ICONS).map((key) => (
            <button key={key} type="button" className={clsx(icon === key && "is-on")} onClick={() => setIcon(key)} aria-label={key}>
              <CategoryIcon icon={key} variant="3d" size="md" />
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
