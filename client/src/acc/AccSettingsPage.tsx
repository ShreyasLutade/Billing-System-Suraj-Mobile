import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, ChevronUp, FolderTree, Loader2, PencilLine, Plus, Shapes, Trash2 } from "lucide-react";
import { BackLink } from "../components/ui";
import { GroupTreeManager } from "./AccGroups";
import { accApi, type AccCategory } from "./accApi";
import { CategorySheet } from "./AccProductFormPage";
import { CategoryIcon, Sheet, errorText, plural, refreshCatalog, toast, useAccCatalog } from "./shared";

/** Accessories settings: a menu of settings pages. */
export function AccSettingsPage() {
  const { catalog } = useAccCatalog();
  const categories = catalog?.categories.length ?? 0;
  return (
    <div className="acc-page acc-settings-page">
      <BackLink to="/acc" historyBack>
        Back
      </BackLink>
      <h1 className="acc-h1">Settings</h1>

      <nav className="acc-settings-menu">
        <Link to="/acc/settings/groups" className="acc-settings-item">
          <span className="acc-settings-icon">
            <FolderTree />
          </span>
          <span className="acc-settings-item-text">
            <strong>Customer groups</strong>
            <small>Main groups and sub groups, e.g. Balaghat city › Hanuman chowk</small>
          </span>
          <ChevronRight className="acc-settings-chev" />
        </Link>
        <Link to="/acc/settings/categories" className="acc-settings-item">
          <span className="acc-settings-icon is-violet">
            <Shapes />
          </span>
          <span className="acc-settings-item-text">
            <strong>Categories</strong>
            <small>{categories ? `${categories} categories · ` : ""}Add or edit Cover, Charger, Earphone…</small>
          </span>
          <ChevronRight className="acc-settings-chev" />
        </Link>
      </nav>

    </div>
  );
}

/** Settings › Customer groups. */
export function AccGroupsSettingsPage() {
  return (
    <div className="acc-page acc-settings-page">
      <BackLink to="/acc/settings" historyBack>
        Settings
      </BackLink>
      <h1 className="acc-h1">Customer groups</h1>
      <section className="acc-card acc-settings-card">
        <header className="acc-settings-head">
          <span className="acc-settings-icon">
            <FolderTree />
          </span>
          <span>
            <strong>Customer groups</strong>
            <small>Main groups with sub groups, e.g. Balaghat city › Hanuman chowk. Tap a main group to see its tree.</small>
          </span>
        </header>
        <GroupTreeManager />
      </section>
    </div>
  );
}

/** Settings › Categories: add, rename, reorder and remove product categories. */
export function AccCategoriesPage() {
  const { catalog } = useAccCatalog();
  const [editing, setEditing] = useState<AccCategory | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AccCategory | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(
    () => [...(catalog?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [catalog],
  );
  const counts = useMemo(() => {
    const m = new Map<string, { products: number; pieces: number }>();
    for (const p of catalog?.products ?? []) {
      const c = m.get(p.categoryId) ?? { products: 0, pieces: 0 };
      c.products += 1;
      c.pieces += Math.max(0, p.stockQty);
      m.set(p.categoryId, c);
    }
    return m;
  }, [catalog]);

  async function move(index: number, by: -1 | 1) {
    const a = categories[index];
    const b = categories[index + by];
    if (!a || !b || busy) return;
    setBusy(true);
    try {
      // Give every category a clean order, then swap the two.
      const order = categories.map((c) => c.id);
      [order[index], order[index + by]] = [order[index + by], order[index]];
      await Promise.all(
        order.map((id, i) => {
          const c = categories.find((x) => x.id === id)!;
          return c.sortOrder === i + 1 ? null : accApi.updateCategory(c.id, { name: c.name, drillBy: c.drillBy, icon: c.icon, sortOrder: i + 1 });
        }),
      );
      await refreshCatalog();
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await accApi.deleteCategory(removing.id);
      await refreshCatalog();
      toast(`Removed ${removing.name}`);
      setRemoving(null);
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acc-page acc-settings-page">
      <BackLink to="/acc/settings" historyBack>
        Settings
      </BackLink>
      <div className="acc-title-row">
        <h1 className="acc-h1">Categories</h1>
        <button type="button" className="acc-btn is-primary is-small" onClick={() => setAdding(true)}>
          <Plus /> Add category
        </button>
      </div>
      <p className="acc-cat-hint">These show in every category list: counter, add stock, products and filters.</p>

      {catalog ? (
        <ul className="acc-cat-list">
          {categories.map((c, i) => {
            const n = counts.get(c.id);
            return (
              <li key={c.id} className="acc-cat-row">
                <CategoryIcon icon={c.icon} variant="3d" size="sm" />
                <span className="acc-cat-text">
                  <strong>{c.name}</strong>
                  <small>
                    {n ? `${plural(n.products, "product")} · ${n.pieces} pcs` : "No products yet"}
                  </small>
                </span>
                <span className="acc-cat-actions">
                  <button type="button" onClick={() => void move(i, -1)} disabled={busy || i === 0} aria-label={`Move ${c.name} up`}>
                    <ChevronUp />
                  </button>
                  <button type="button" onClick={() => void move(i, 1)} disabled={busy || i === categories.length - 1} aria-label={`Move ${c.name} down`}>
                    <ChevronDown />
                  </button>
                  <button type="button" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                    <PencilLine />
                  </button>
                  <button type="button" className="is-red" onClick={() => setRemoving(c)} aria-label={`Remove ${c.name}`}>
                    <Trash2 />
                  </button>
                </span>
              </li>
            );
          })}
          {!categories.length ? <li className="acc-cat-empty">No categories yet. Tap “Add category”.</li> : null}
        </ul>
      ) : (
        <div className="acc-cat-loading">
          <Loader2 className="acc-spin" />
        </div>
      )}

      <CategorySheet open={adding} onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />
      <CategorySheet open={Boolean(editing)} category={editing ?? undefined} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
      <Sheet
        open={Boolean(removing)}
        onClose={() => !busy && setRemoving(null)}
        title={`Remove ${removing?.name ?? ""}?`}
        subtitle="Only possible when it has no products"
        footer={
          <div className="acc-btn-row is-stretch">
            <button type="button" className="acc-btn" onClick={() => setRemoving(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="acc-btn is-danger-solid" onClick={() => void remove()} disabled={busy}>
              {busy ? <Loader2 className="acc-spin" /> : <Trash2 />} Remove
            </button>
          </div>
        }
      >
        <p className="acc-cat-hint">
          {removing && counts.get(removing.id)
            ? `${removing.name} still has ${plural(counts.get(removing.id)!.products, "product")}. Move them to another category first.`
            : "It will disappear from all category lists."}
        </p>
      </Sheet>
    </div>
  );
}

