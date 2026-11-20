import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, FolderTree, Loader2, PencilLine, Plus, RotateCcw, Shapes, Trash2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { BackLink } from "../components/ui";
import { GroupTreeManager } from "./AccGroups";
import { accApi, type AccCategory } from "./accApi";
import { CategorySheet } from "./AccProductFormPage";
import { refreshBoxes } from "./AccCovers";
import { CategoryIcon, Sheet, errorText, plural, refreshCatalog, toast, useAccCatalog } from "./shared";

/** Accessories settings: a menu of settings pages. */
export function AccSettingsPage() {
  const { isAdmin } = useAuth();
  const { catalog } = useAccCatalog();
  const [resetOpen, setResetOpen] = useState(false);
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

      {isAdmin ? (
        <section className="acc-card acc-reset-card">
          <span className="acc-reset-icon">
            <RotateCcw />
          </span>
          <span className="acc-reset-text">
            <strong>Start fresh</strong>
            <small>Clear all products, stock, purchases and suppliers. Dues and groups stay.</small>
          </span>
          <button type="button" className="acc-btn is-danger is-small" onClick={() => setResetOpen(true)}>
            Clear
          </button>
        </section>
      ) : null}

      <ResetSheet open={resetOpen} onClose={() => setResetOpen(false)} />
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

function ResetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [word, setWord] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = word.trim().toUpperCase() === "CLEAR" && password.length > 0;

  function close() {
    if (busy) return;
    setWord("");
    setPassword("");
    onClose();
  }

  async function run() {
    if (!ready) return;
    setBusy(true);
    try {
      const { data } = await accApi.resetShop(password);
      await Promise.allSettled([refreshCatalog(), refreshBoxes()]);
      toast(`Cleared · ${data.products ?? 0} products, ${data.purchases ?? 0} purchases, ${data.suppliers ?? 0} suppliers`);
      setBusy(false);
      close();
      navigate("/acc");
    } catch (err) {
      toast(errorText(err), { tone: "error" });
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Start fresh"
      subtitle="Accessories shop only · cannot be undone"
      footer={
        <button type="button" className="acc-btn is-danger-solid is-big is-block" disabled={!ready || busy} onClick={() => void run()}>
          {busy ? <Loader2 className="acc-spin" /> : <RotateCcw />} Clear everything
        </button>
      }
    >
      <div className="acc-reset-body">
        <div className="acc-reset-warn">
          <AlertTriangle />
          <span>This permanently deletes accessories stock, purchases and suppliers. Dues are kept. The mobile shop is not touched.</span>
        </div>
        <div className="acc-reset-lists">
          <div>
            <p className="is-red">Deleted</p>
            <ul>
              <li>Products & stock</li>
              <li>Cover splits & box contents</li>
              <li>Suppliers, purchases & payments</li>
            </ul>
          </div>
          <div>
            <p className="is-green">Kept</p>
            <ul>
              <li>Customers & dues</li>
              <li>Bills & payments</li>
              <li>Customer groups</li>
              <li>Supplier groups</li>
              <li>Categories</li>
              <li>Empty boxes A1–G4</li>
            </ul>
          </div>
        </div>
        <label className="acc-reset-field">
          <span>
            Type <b>CLEAR</b> to confirm
          </span>
          <input data-keep-case value={word} onChange={(e) => setWord(e.target.value)} placeholder="CLEAR" autoComplete="off" />
        </label>
        <label className="acc-reset-field">
          <span>Your password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
      </div>
    </Sheet>
  );
}
