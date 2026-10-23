import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Check, FileDown, Info, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { BackLink, SearchClearButton } from "../components/ui";
import {
  accApi,
  type AccCategory,
  type AccProduct,
  type AccSupplier,
  type AccSupplierGroup,
  type AccSupplierInput,
} from "./accApi";
import {
  CategoryIcon,
  Empty,
  PdfButton,
  Segmented,
  StockBadge,
  completePhone,
  errorText,
  inr,
  plural,
  refreshCatalog,
  shortDate,
  toast,
  useAccCatalog,
} from "./shared";

const EMPTY_SUPPLIER: AccSupplierInput = { name: "", phone: "", city: "", address: "", groupId: null, groupName: "" };

/** What stops a new supplier from being saved, or "" when it can be. */
function supplierProblem(input: AccSupplierInput, suppliers: AccSupplier[]) {
  if (input.name.trim().length < 2) return "Enter the supplier name";
  const phone = completePhone(input.phone);
  if (!phone) return "Enter the supplier's 10-digit mobile number";
  const same = suppliers.find((x) => x.phone === phone);
  if (same) return `${phone} is already saved as ${same.name}`;
  return "";
}


type SortKey = "name" | "city" | "group" | "purchaseCount" | "purchased" | "paid" | "balance" | "lastPurchaseAt";

/** Money first, so "to pay" is on screen without scrolling sideways. */
const SUPPLIER_COLUMNS: Array<{ key: SortKey; label: string; num?: boolean }> = [
  { key: "name", label: "Supplier" },
  { key: "balance", label: "To pay", num: true },
  { key: "purchased", label: "Bought", num: true },
  { key: "paid", label: "Paid", num: true },
  { key: "purchaseCount", label: "Bills", num: true },
  { key: "lastPurchaseAt", label: "Last bought" },
  { key: "city", label: "City" },
  { key: "group", label: "Group" },
];

function sortValue(s: AccSupplier, key: SortKey): string | number {
  if (key === "group") return s.group?.name || "";
  if (key === "lastPurchaseAt") return s.lastPurchaseAt ? new Date(s.lastPurchaseAt).getTime() : 0;
  return s[key];
}

/**
 * Suppliers as a sheet: one row each, sortable columns, search and group
 * filter, totals at the bottom. Tap a row for the supplier's page; the PDF
 * icon gives their statement.
 */
export function AccSuppliersPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<AccSupplier[] | null>(null);
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [onlyOwed, setOnlyOwed] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "balance", dir: -1 });

  useEffect(() => {
    accApi
      .suppliers()
      .then(({ data }) => setList(data))
      .catch((err) => toast(errorText(err), { tone: "error" }));
  }, []);

  const all = list || [];
  const groups = [...new Map(all.filter((s) => s.group).map((s) => [s.group!.id, s.group!])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = all
    .filter((s) => !groupFilter || (groupFilter === "-" ? !s.group : s.group?.id === groupFilter))
    .filter((s) => !onlyOwed || s.balance > 0)
    .filter((s) => tokens.every((t) => `${s.name} ${s.phone} ${s.city} ${s.group?.name || ""}`.toLowerCase().includes(t)))
    .sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c * sort.dir || a.name.localeCompare(b.name);
    });
  const sum = (k: "purchased" | "paid" | "balance") => rows.reduce((a, s) => a + s[k], 0);
  const owed = all.reduce((a, s) => a + Math.max(s.balance, 0), 0);

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" || key === "city" || key === "group" ? 1 : -1 }));
  }

  return (
    <div className="acc-page acc-suppliers-page">
      <BackLink to="/acc/stock">Stock</BackLink>
      <div className="acc-title-row">
        <h1>Suppliers</h1>
        <div className="acc-head-actions">
          <PdfButton onDownload={() => accApi.pdf.suppliers()} />
        </div>
      </div>
      <div className="acc-stat-strip">
        <div>
          <small>Suppliers</small>
          <b>{list?.length ?? "…"}</b>
        </div>
        <div>
          <small>Bought</small>
          <b>{inr(all.reduce((a, s) => a + s.purchased, 0))}</b>
        </div>
        <div>
          <small>Paid</small>
          <b className="is-green">{inr(all.reduce((a, s) => a + s.paid, 0))}</b>
        </div>
        <div>
          <small>To pay</small>
          <b className="is-red">{inr(owed)}</b>
        </div>
      </div>

      <label className="acc-search">
        <Search aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search supplier, city, phone…" />
        <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
      </label>
      <div className="acc-chips is-scroll">
        <button type="button" className={clsx("acc-chip", !groupFilter && "is-on")} onClick={() => setGroupFilter("")}>
          All groups
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className={clsx("acc-chip", groupFilter === g.id && "is-on")}
            onClick={() => setGroupFilter(groupFilter === g.id ? "" : g.id)}
          >
            <i className="acc-dot" style={{ background: g.color }} />
            {g.name}
          </button>
        ))}
        {all.some((s) => !s.group) ? (
          <button type="button" className={clsx("acc-chip", groupFilter === "-" && "is-on")} onClick={() => setGroupFilter(groupFilter === "-" ? "" : "-")}>
            No group
          </button>
        ) : null}
        <button type="button" className={clsx("acc-chip", onlyOwed && "is-on")} onClick={() => setOnlyOwed(!onlyOwed)}>
          Only to pay
        </button>
      </div>

      {!list ? (
        <div className="acc-loading">
          <Loader2 className="acc-spin" />
        </div>
      ) : rows.length ? (
        <div className="acc-table-wrap is-sheet">
          <table className="acc-table is-clickable">
            <thead>
              <tr>
                {SUPPLIER_COLUMNS.map((c) => (
                  <th key={c.key} className={clsx(c.num && "is-num", c.key === "name" && "is-sticky")}>
                    <button type="button" onClick={() => sortBy(c.key)} aria-label={`Sort by ${c.label}`}>
                      {c.label}
                      <span className="acc-sort-mark">{sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
                    </button>
                  </th>
                ))}
                <th className="is-icon">PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} onClick={() => navigate(`/acc/suppliers/${s.id}`)}>
                  <td className="is-sticky">
                    <Link to={`/acc/suppliers/${s.id}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{s.name}</strong>
                    </Link>
                    <small>{s.phone}</small>
                  </td>
                  <td className={clsx("is-num", s.balance > 0 && "is-red")}>
                    <b>{inr(s.balance)}</b>
                  </td>
                  <td className="is-num">{inr(s.purchased)}</td>
                  <td className="is-num is-green">{inr(s.paid)}</td>
                  <td className="is-num">{s.purchaseCount}</td>
                  <td className="is-nowrap">{s.lastPurchaseAt ? shortDate(s.lastPurchaseAt) : "—"}</td>
                  <td>{s.city || "—"}</td>
                  <td className="is-nowrap">
                    {s.group ? (
                      <>
                        <i className="acc-dot" style={{ background: s.group.color }} /> {s.group.name}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="is-icon" onClick={(e) => e.stopPropagation()}>
                    <SupplierPdfIcon id={s.id} name={s.name} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="is-sticky">{plural(rows.length, "supplier")}</td>
                <td className="is-num is-red">{inr(sum("balance"))}</td>
                <td className="is-num">{inr(sum("purchased"))}</td>
                <td className="is-num">{inr(sum("paid"))}</td>
                <td className="is-num">{rows.reduce((a, s) => a + s.purchaseCount, 0)}</td>
                <td />
                <td />
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <Empty title={all.length ? "No supplier matches" : "No suppliers yet"}>
          {all.length ? null : "Suppliers are added on Add stock, with their first purchase."}
        </Empty>
      )}
    </div>
  );
}

/** Statement PDF for one supplier, straight from the list. */
function SupplierPdfIcon({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="acc-icon-btn is-small"
      aria-label={`${name} statement PDF`}
      title="Statement PDF"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await accApi.pdf.supplier(id);
        } catch (err) {
          toast(errorText(err), { tone: "error" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="acc-spin" /> : <FileDown />}
    </button>
  );
}

/**
 * New supplier details: name, mobile (checked against saved suppliers once
 * all 10 digits are in), city, address and group.
 */
function SupplierFields({
  value,
  onChange,
  suppliers,
  onUseExisting,
}: {
  value: AccSupplierInput;
  onChange: (value: AccSupplierInput) => void;
  suppliers: AccSupplier[];
  onUseExisting: (supplier: AccSupplier) => void;
}) {
  const [groups, setGroups] = useState<AccSupplierGroup[]>([]);
  useEffect(() => {
    accApi
      .supplierGroups()
      .then(({ data }) => setGroups(data))
      .catch(() => undefined);
  }, []);
  const set = (patch: Partial<AccSupplierInput>) => onChange({ ...value, ...patch });
  const phone = completePhone(value.phone);
  const match = phone ? suppliers.find((x) => x.phone === phone) : undefined;

  return (
    <div className="acc-form">
      <div className="acc-form-grid">
        <label className="acc-field">
          <span>Supplier name *</span>
          <input value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="Business / dealer name" autoFocus />
        </label>
        <label className="acc-field">
          <span>Mobile *</span>
          <input
            inputMode="tel"
            value={value.phone}
            onChange={(e) => set({ phone: e.target.value })}
            maxLength={14}
            placeholder="10-digit mobile"
          />
        </label>
      </div>
      {match ? (
        <div className="acc-phone-match" role="status">
          <Info aria-hidden />
          <span>
            This number is already saved as <b>{match.name}</b>
            {match.city ? ` (${match.city})` : ""}
          </span>
          <button type="button" className="acc-btn is-small" onClick={() => onUseExisting(match)}>
            Use same info
          </button>
        </div>
      ) : null}
      <div className="acc-form-grid">
        <label className="acc-field">
          <span>City / area</span>
          <input value={value.city} onChange={(e) => set({ city: e.target.value })} placeholder="e.g. Delhi, Nagpur" />
        </label>
        <label className="acc-field">
          <span>Address</span>
          <input value={value.address} onChange={(e) => set({ address: e.target.value })} placeholder="Market, shop no." />
        </label>
      </div>
      <div className="acc-field">
        <span>Group</span>
        <div className="acc-chips">
          <button
            type="button"
            className={clsx("acc-chip", !value.groupId && !value.groupName && "is-on")}
            onClick={() => set({ groupId: null, groupName: "" })}
          >
            None
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={clsx("acc-chip", value.groupId === g.id && !value.groupName && "is-on")}
              onClick={() => set({ groupId: g.id, groupName: "" })}
            >
              <i className="acc-dot" style={{ background: g.color }} />
              {g.name}
            </button>
          ))}
          <input
            className="acc-chip-input"
            value={value.groupName}
            onChange={(e) => set({ groupName: e.target.value, groupId: null })}
            placeholder="+ New group"
          />
        </div>
      </div>
    </div>
  );
}

/** Existing supplier (search the saved list) or a new one, as on the mobile shop. */
function SupplierChooser({
  suppliers,
  mode,
  onMode,
  supplierId,
  onPick,
  draft,
  onDraft,
}: {
  suppliers: AccSupplier[];
  mode: "EXISTING" | "NEW";
  onMode: (mode: "EXISTING" | "NEW") => void;
  supplierId: string;
  onPick: (id: string) => void;
  draft: AccSupplierInput;
  onDraft: (value: AccSupplierInput) => void;
}) {
  const [q, setQ] = useState("");
  const picked = suppliers.find((x) => x.id === supplierId);
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Nothing is listed until something is typed; then the best few drop down.
  const shown = tokens.length
    ? suppliers
        .filter((x) => tokens.every((t) => `${x.name} ${x.phone} ${x.city} ${x.group?.name || ""}`.toLowerCase().includes(t)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 8)
    : [];

  return (
    <>
      <div className="acc-card-head">
        <h3 className="acc-card-title">Supplier *</h3>
        <Segmented
          value={mode}
          onChange={onMode}
          options={[
            { value: "EXISTING", label: "Existing" },
            { value: "NEW", label: "New supplier" },
          ]}
        />
      </div>
      {mode === "NEW" ? (
        <SupplierFields
          value={draft}
          onChange={onDraft}
          suppliers={suppliers}
          onUseExisting={(x) => {
            onPick(x.id);
            onMode("EXISTING");
          }}
        />
      ) : picked ? (
        <div className="acc-picked-supplier">
          <span>
            <strong>{picked.name}</strong>
            <small>{[picked.city, picked.phone, picked.group?.name].filter(Boolean).join(" · ")}</small>
          </span>
          {picked.balance > 0 ? <b className="is-red">To pay {inr(picked.balance)}</b> : null}
          <button type="button" className="acc-link-btn" onClick={() => onPick("")}>
            Change
          </button>
        </div>
      ) : (
        <div className="acc-dropdown-wrap">
          <label className="acc-search is-in-card">
            <Search aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={suppliers.length ? "Type supplier name, city or phone…" : "No suppliers yet: use New supplier"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown.length) onPick(shown[0].id);
              }}
            />
            <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
          </label>
          {tokens.length ? (
            <ul className="acc-results acc-dropdown">
              {shown.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(x.id);
                      setQ("");
                    }}
                  >
                    <span>
                      <strong>{x.name}</strong>
                      <small>{[x.city, x.phone, x.group?.name].filter(Boolean).join(" · ")}</small>
                    </span>
                    {x.balance > 0 ? <b className="is-red">{inr(x.balance)}</b> : null}
                  </button>
                </li>
              ))}
              {!shown.length ? (
                <li>
                  <button
                    type="button"
                    className="is-custom"
                    onClick={() => {
                      // Carry what was typed into the new supplier form.
                      const typed = q.trim();
                      onDraft(/^[\d\s+]+$/.test(typed) ? { ...draft, phone: typed } : { ...draft, name: typed });
                      onMode("NEW");
                      setQ("");
                    }}
                  >
                    <Plus /> No supplier found: add as new supplier
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}
    </>
  );
}

/* ---------------- Add stock ---------------- */

/** A product on this purchase: one already in the shop, or a new one. */
type InLine = {
  key: string;
  product: AccProduct | null;
  /** Set for a product bought for the first time. */
  draft: { categoryId: string; categoryName: string; name: string; wholesale: string } | null;
  qty: string;
  cost: string;
  sell: string;
};

type NewProductForm = { categoryId: string; name: string; qty: string; cost: string; sell: string; wholesale: string };

const EMPTY_NEW_PRODUCT: NewProductForm = { categoryId: "", name: "", qty: "", cost: "", sell: "", wholesale: "" };

const lineAmount = (l: InLine) => (Math.floor(Number(l.qty)) || 0) * (Number(l.cost) || 0);

/**
 * The only way stock comes in, so every piece is tracked to a supplier:
 * 1. who it came from, 2. what came (products already in the shop, or new
 * ones created right here), 3. what was paid. Cost averages on save.
 */
export function AccStockInPage() {
  const { catalog } = useAccCatalog();
  const navigate = useNavigate();
  const location = useLocation();
  const [suppliers, setSuppliers] = useState<AccSupplier[]>([]);
  const [supplierMode, setSupplierMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState<AccSupplierInput>(EMPTY_SUPPLIER);
  const [itemMode, setItemMode] = useState<"EXISTING" | "NEW">("EXISTING");
  /** What was typed in the product search, carried into New product. */
  const [typedName, setTypedName] = useState("");
  const [lines, setLines] = useState<InLine[]>([]);
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
  const categories = catalog?.categories ?? [];

  function addExisting(p: AccProduct) {
    if (lines.some((l) => l.product?.id === p.id)) {
      toast(`${p.name} is already on the list`);
      return;
    }
    setLines((ls) => [
      ...ls,
      { key: p.id, product: p, draft: null, qty: "", cost: p.purchasePrice ? String(p.purchasePrice) : "", sell: "" },
    ]);
  }

  // "Add stock" on a supplier's page arrives with that supplier chosen.
  const presetSupplier = (location.state as { supplierId?: string } | null)?.supplierId;
  useEffect(() => {
    if (presetSupplier) setSupplierId(presetSupplier);
  }, [presetSupplier]);

  // "Add stock" on a product page arrives with that product on the list.
  const preselect = (location.state as { productId?: string } | null)?.productId;
  useEffect(() => {
    if (!preselect || !catalog) return;
    const p = catalog.products.find((x) => x.id === preselect);
    if (p) setLines((ls) => (ls.some((l) => l.product?.id === p.id) ? ls : [...ls, { key: p.id, product: p, draft: null, qty: "", cost: p.purchasePrice ? String(p.purchasePrice) : "", sell: "" }]));
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect, catalog]);

  const setLine = (key: string, patch: Partial<InLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const total = lines.reduce((a, l) => a + lineAmount(l), 0);
  const pieces = lines.reduce((a, l) => a + (Math.floor(Number(l.qty)) || 0), 0);
  const paidNow = Math.min(Number(paid) || 0, total);
  const hasSupplier = supplierMode === "NEW" || Boolean(supplierId);

  async function save() {
    if (busy) return;
    const problem =
      supplierMode === "NEW" ? supplierProblem(newSupplier, suppliers) : supplierId ? "" : "Choose the supplier this stock came from";
    if (problem) {
      toast(problem, { tone: "error" });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!lines.length) {
      toast("Add at least one product", { tone: "error" });
      return;
    }
    const noQty = lines.find((l) => !(Math.floor(Number(l.qty)) >= 1));
    if (noQty) {
      toast(`Enter the quantity for ${noQty.product?.name || noQty.draft?.name}`, { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      await accApi.createPurchase({
        ...(supplierMode === "NEW"
          ? { supplier: { ...newSupplier, name: newSupplier.name.trim(), groupName: newSupplier.groupName?.trim() || undefined } }
          : { supplierId }),
        paidNow,
        paidMethod: method,
        items: lines.map((l) => ({
          ...(l.product
            ? { productId: l.product.id }
            : { newProduct: { categoryId: l.draft!.categoryId, name: l.draft!.name, wholesalePrice: Number(l.draft!.wholesale) || 0 } }),
          qty: Math.floor(Number(l.qty)),
          unitCost: Number(l.cost) || 0,
          sellingPrice: Number(l.sell) || undefined,
        })),
      });
      toast(`Stock added: ${plural(pieces, "piece")}`);
      void refreshCatalog();
      navigate("/acc/stock");
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acc-page acc-add-stock">
      <BackLink to="/acc/stock">Stock</BackLink>
      <h1 className="acc-h1">Add stock</h1>

      <section className="acc-card">
        <StepTitle n={1} done={hasSupplier} title="Supplier" hint="Who did this stock come from?" />
        <SupplierChooser
          suppliers={suppliers}
          mode={supplierMode}
          onMode={setSupplierMode}
          supplierId={supplierId}
          onPick={setSupplierId}
          draft={newSupplier}
          onDraft={setNewSupplier}
        />
      </section>

      <section className="acc-card">
        <StepTitle n={2} done={lines.length > 0} title="Products" hint="Products already in the shop, or new ones" />
        <Segmented
          value={itemMode}
          onChange={setItemMode}
          options={[
            { value: "EXISTING", label: "Existing product" },
            { value: "NEW", label: "New product" },
          ]}
        />
        {itemMode === "EXISTING" ? (
          <ProductSearch
            products={products}
            onPick={addExisting}
            onNotFound={(typed) => {
              setTypedName(typed);
              setItemMode("NEW");
            }}
          />
        ) : (
          <NewProductCard
            initialName={typedName}
            categories={categories}
            products={products}
            onAdd={(f) => {
              const category = categories.find((c) => c.id === f.categoryId);
              setLines((ls) => [
                ...ls,
                {
                  key: `new-${Date.now()}`,
                  product: null,
                  draft: { categoryId: f.categoryId, categoryName: category?.name || "", name: f.name.trim(), wholesale: f.wholesale },
                  qty: f.qty,
                  cost: f.cost,
                  sell: f.sell,
                },
              ]);
              toast(`${f.name.trim()} added to the list`);
            }}
            onUseExisting={(p) => {
              addExisting(p);
              setItemMode("EXISTING");
            }}
          />
        )}

        {lines.length ? (
          <ul className="acc-in-lines">
            {lines.map((l) => (
              <li key={l.key}>
                <div className="acc-in-line-head">
                  <span>
                    <strong>{l.product?.name || l.draft?.name}</strong>
                    <small>
                      {l.product ? (
                        <>
                          {l.product.categoryName} · now {l.product.stockQty} pcs
                        </>
                      ) : (
                        <>
                          <em className="acc-new-tag">New</em> {l.draft?.categoryName}
                        </>
                      )}
                    </small>
                  </span>
                  <b>{inr(lineAmount(l))}</b>
                  <button
                    type="button"
                    className="acc-icon-btn is-small"
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    aria-label={`Remove ${l.product?.name || l.draft?.name}`}
                  >
                    <Trash2 />
                  </button>
                </div>
                <div className="acc-form-grid is-3">
                  <label className="acc-field">
                    <span>Qty *</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={l.qty}
                      placeholder="0"
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      autoFocus={!l.qty}
                    />
                  </label>
                  <label className="acc-field">
                    <span>Cost ₹</span>
                    <input type="number" inputMode="decimal" value={l.cost} onChange={(e) => setLine(l.key, { cost: e.target.value })} />
                  </label>
                  <label className="acc-field">
                    <span>{l.product ? "New MRP ₹" : "Selling ₹"}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.sell}
                      placeholder={l.product ? String(l.product.sellingPrice) : ""}
                      onChange={(e) => setLine(l.key, { sell: e.target.value })}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="acc-hint">Nothing added yet. Search a product above, or switch to New product.</p>
        )}
      </section>

      <section className="acc-card acc-pay-card">
        <StepTitle n={3} done={false} title="Payment" hint="What did you pay the supplier now?" />
        <div className="acc-kv">
          <span>Products</span>
          <b>
            {lines.length} · {plural(pieces, "pc")}
          </b>
          <span>Bill total</span>
          <b>{inr(total)}</b>
        </div>
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
        <div className="acc-chips">
          <button type="button" className={clsx("acc-chip", !paidNow && "is-on")} onClick={() => setPaid("")}>
            Pay later
          </button>
          <button type="button" className={clsx("acc-chip", total > 0 && paidNow === total && "is-on")} onClick={() => setPaid(String(total))}>
            Paid in full
          </button>
        </div>
        {total - paidNow > 0 ? (
          <div className="acc-due-line">
            <span>Still to pay supplier</span>
            <b>{inr(total - paidNow)}</b>
          </div>
        ) : null}
        <button type="button" className="acc-btn is-primary is-big is-block" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="acc-spin" /> : <Check />} Add {plural(pieces, "piece")} to stock
        </button>
      </section>
    </div>
  );
}

function StepTitle({ n, done, title, hint }: { n: number; done: boolean; title: string; hint: string }) {
  return (
    <div className="acc-step-title">
      <i className={clsx(done && "is-done")}>{done ? <Check /> : n}</i>
      <span>
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
    </div>
  );
}

/** Type to find a product already in the shop; matches drop down. Low stock shows as quick picks. */
function ProductSearch({
  products,
  onPick,
  onNotFound,
}: {
  products: AccProduct[];
  onPick: (p: AccProduct) => void;
  onNotFound: (typed: string) => void;
}) {
  const [q, setQ] = useState("");
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = tokens.length
    ? products.filter((p) => tokens.every((t) => `${p.name} ${p.categoryName} ${p.barcode || ""}`.toLowerCase().includes(t))).slice(0, 8)
    : [];
  const low = products.filter((p) => p.stockQty <= 0 || (p.lowStockAt > 0 && p.stockQty <= p.lowStockAt)).slice(0, 12);
  const pick = (p: AccProduct) => {
    onPick(p);
    setQ("");
  };

  return (
    <>
      <div className="acc-dropdown-wrap">
        <label className="acc-search is-in-card">
          <Search aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type product name…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length) pick(results[0]);
            }}
          />
          <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
        </label>
        {tokens.length ? (
          <ul className="acc-results acc-dropdown">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => pick(p)}>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.categoryName}</small>
                  </span>
                  <StockBadge qty={p.stockQty} low={p.lowStockAt} />
                </button>
              </li>
            ))}
            {!results.length ? (
              <li>
                <button type="button" className="is-custom" onClick={() => onNotFound(q.trim())}>
                  <Plus /> Not in the shop yet: add as new product
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      {!tokens.length && low.length ? (
        <div className="acc-field">
          <span>Running low: tap to add</span>
          <div className="acc-chips">
            {low.map((p) => (
              <button key={p.id} type="button" className="acc-chip" onClick={() => pick(p)}>
                {p.name} <small>({p.stockQty})</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** A product bought for the first time: category, name, quantity and prices. */
function NewProductCard({
  initialName,
  categories,
  products,
  onAdd,
  onUseExisting,
}: {
  initialName: string;
  categories: AccCategory[];
  products: AccProduct[];
  onAdd: (form: NewProductForm) => void;
  onUseExisting: (p: AccProduct) => void;
}) {
  const [form, setForm] = useState<NewProductForm>({ ...EMPTY_NEW_PRODUCT, name: initialName });
  const set = (patch: Partial<NewProductForm>) => setForm((f) => ({ ...f, ...patch }));
  const name = form.name.trim().toLowerCase();
  // Same name already in the shop: add stock to it instead of a duplicate.
  const existing = name.length >= 3 ? products.find((p) => p.name.trim().toLowerCase() === name) : undefined;

  function add() {
    if (!form.categoryId) return toast("Choose a category", { tone: "error" });
    if (form.name.trim().length < 2) return toast("Enter the product name", { tone: "error" });
    if (existing) return toast(`${existing.name} is already in the shop`, { tone: "error" });
    if (!(Math.floor(Number(form.qty)) >= 1)) return toast("Enter the quantity", { tone: "error" });
    if (!(Number(form.sell) > 0)) return toast("Enter the selling price", { tone: "error" });
    onAdd(form);
    setForm({ ...EMPTY_NEW_PRODUCT, categoryId: form.categoryId });
  }

  return (
    <div className="acc-new-product">
      <div className="acc-field">
        <span>Category *</span>
        <div className="acc-chips">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={clsx("acc-chip", form.categoryId === c.id && "is-on")}
              onClick={() => set({ categoryId: c.id })}
            >
              <CategoryIcon icon={c.icon} variant="3d" size="xs" />
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <label className="acc-field">
        <span>Product name *</span>
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Silicone cover, Boat Type-C cable" />
      </label>
      {existing ? (
        <div className="acc-phone-match" role="status">
          <Info aria-hidden />
          <span>
            <b>{existing.name}</b> is already in the shop ({existing.stockQty} pcs)
          </span>
          <button type="button" className="acc-btn is-small" onClick={() => onUseExisting(existing)}>
            Add stock to it
          </button>
        </div>
      ) : null}
      <div className="acc-form-grid is-4">
        <label className="acc-field">
          <span>Qty *</span>
          <input type="number" inputMode="numeric" value={form.qty} onChange={(e) => set({ qty: e.target.value })} placeholder="0" />
        </label>
        <label className="acc-field">
          <span>Cost ₹</span>
          <input type="number" inputMode="decimal" value={form.cost} onChange={(e) => set({ cost: e.target.value })} />
        </label>
        <label className="acc-field">
          <span>Selling ₹ *</span>
          <input type="number" inputMode="decimal" value={form.sell} onChange={(e) => set({ sell: e.target.value })} />
        </label>
        <label className="acc-field">
          <span>Wholesale ₹</span>
          <input type="number" inputMode="decimal" value={form.wholesale} onChange={(e) => set({ wholesale: e.target.value })} />
        </label>
      </div>
      <button type="button" className="acc-btn is-block" onClick={add}>
        <Plus /> Add to list
      </button>
    </div>
  );
}
