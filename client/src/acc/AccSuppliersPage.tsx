import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Check, ChevronRight, FileDown, Info, Loader2, Plus, Search, Share2, Trash2 } from "lucide-react";
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
  Empty,
  PdfButton,
  Segmented,
  Sheet,
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
          <PdfButton onDownload={() => accApi.pdf.suppliers()} onShare={() => accApi.sharePdf.suppliers()} />
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
                <th className="is-icon" aria-label="Download or share"><FileDown /></th>
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
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const run = async (action: "download" | "share") => {
    setBusy(action);
    try {
      await (action === "download" ? accApi.pdf.supplier(id) : accApi.sharePdf.supplier(id));
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="acc-pdf-actions">
      <button type="button" className="acc-icon-btn is-small" aria-label={`Download ${name} statement`} title="Download" disabled={Boolean(busy)} onClick={() => void run("download")}>
        {busy === "download" ? <Loader2 className="acc-spin" /> : <FileDown />}
      </button>
      <button type="button" className="acc-icon-btn is-small" aria-label={`Share ${name} statement`} title="Share" disabled={Boolean(busy)} onClick={() => void run("share")}>
        {busy === "share" ? <Loader2 className="acc-spin" /> : <Share2 />}
      </button>
    </div>
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
          <input data-stock-supplier-name value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="Business / dealer name" autoFocus />
        </label>
        <label className="acc-field">
          <span>Mobile *</span>
          <input
            data-stock-supplier-phone
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
              data-stock-supplier-search
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
  draft: { categoryId: string; categoryName: string; name: string; brand: string } | null;
  qty: string;
  cost: string;
  sell: string;
  wholesale: string;
};

let stockSheetLineId = 0;

function emptyStockSheetLine(): InLine {
  stockSheetLineId += 1;
  return {
    key: `stock-sheet-${stockSheetLineId}`,
    product: null,
    draft: { categoryId: "", categoryName: "", name: "", brand: "" },
    qty: "",
    cost: "",
    sell: "",
    wholesale: "",
  };
}

function productStockSheetLine(product: AccProduct): InLine {
  return {
    key: `stock-sheet-${product.id}-${++stockSheetLineId}`,
    product,
    draft: null,
    qty: "",
    cost: "",
    sell: "",
    wholesale: "",
  };
}

const lineAmount = (l: InLine) => (Math.floor(Number(l.qty)) || 0) * (Number(l.cost) || 0);
const isStockSheetLineActive = (line: InLine) =>
  Boolean(
    line.product ||
      line.draft?.name.trim() ||
      line.draft?.categoryId ||
      (line.draft?.brand.trim() && line.draft.brand.trim().toLowerCase() !== "local") ||
      line.wholesale ||
      line.qty ||
      line.cost ||
      line.sell,
  );

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
  const [lines, setLines] = useState<InLine[]>(() => Array.from({ length: 5 }, emptyStockSheetLine));
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
    if (p)
      setLines((current) => {
        if (current.some((line) => line.product?.id === p.id)) return current;
        const blankIndex = current.findIndex((line) => !line.product && !line.draft?.name.trim());
        if (blankIndex < 0) return [...current, productStockSheetLine(p), emptyStockSheetLine()];
        return current.map((line, index) => (index === blankIndex ? productStockSheetLine(p) : line));
      });
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect, catalog]);

  const enteredLines = lines.filter(isStockSheetLineActive);
  const total = enteredLines.reduce((a, l) => a + lineAmount(l), 0);
  const pieces = enteredLines.reduce((a, l) => a + (Math.floor(Number(l.qty)) || 0), 0);
  const paidNow = Math.min(Number(paid) || 0, total);
  const hasSupplier = supplierMode === "NEW" || Boolean(supplierId);

  function choosePayment(nextMethod: "CASH" | "UPI" | "BANK") {
    setMethod(nextMethod);
    if (!(Number(paid) > 0)) setPaid(total > 0 ? String(total) : "");
  }

  function focusInvalid(selector: string, message: string) {
    toast(message, { tone: "error" });
    requestAnimationFrame(() => {
      document.querySelectorAll("[data-stock-invalid]").forEach((element) => element.removeAttribute("data-stock-invalid"));
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) return;
      target.setAttribute("data-stock-invalid", "true");
      const clear = () => target.removeAttribute("data-stock-invalid");
      target.addEventListener("input", clear, { once: true });
      target.addEventListener("change", clear, { once: true });
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    });
  }

  async function save() {
    if (busy) return;
    const problem =
      supplierMode === "NEW" ? supplierProblem(newSupplier, suppliers) : supplierId ? "" : "Choose the supplier this stock came from";
    if (problem) {
      const selector =
        supplierMode === "NEW"
          ? problem.toLowerCase().includes("name")
            ? "[data-stock-supplier-name]"
            : "[data-stock-supplier-phone]"
          : "[data-stock-supplier-search]";
      focusInvalid(selector, problem);
      return;
    }
    if (!enteredLines.length) {
      focusInvalid('[data-stock-cell="0-1"]', "Add at least one product");
      return;
    }
    const linesForSave = enteredLines.map((line) => {
      const rowIndex = lines.indexOf(line);
      if (line.product) return { line, rowIndex };
      const sameName = products.filter((product) => product.name.trim().toLowerCase() === line.draft!.name.trim().toLowerCase());
      const lineBrand = line.draft!.brand.trim().toLowerCase() || "local";
      const exactExisting =
        sameName.find((product) => (product.brand.trim().toLowerCase() || "local") === lineBrand) ||
        (sameName.length === 1 ? sameName[0] : undefined);
      return { line: exactExisting ? { ...line, product: exactExisting, draft: null } : line, rowIndex };
    });
    for (const { line, rowIndex } of linesForSave) {
      if (!line.product && (line.draft?.name.trim().length || 0) < 2) {
        focusInvalid(`[data-stock-cell="${rowIndex}-1"]`, `Enter the product name in row ${rowIndex + 1}`);
        return;
      }
      if (!line.product && !line.draft?.categoryId) {
        focusInvalid(`[data-stock-cell="${rowIndex}-2"]`, `Choose a category in row ${rowIndex + 1}`);
        return;
      }
      if (!(Math.floor(Number(line.qty)) >= 1)) {
        focusInvalid(`[data-stock-cell="${rowIndex}-3"]`, `Enter the quantity in row ${rowIndex + 1}`);
        return;
      }
      if (!(Number(line.cost) > 0)) {
        focusInvalid(`[data-stock-cell="${rowIndex}-4"]`, `Enter the cost price in row ${rowIndex + 1}`);
        return;
      }
      if (!(Number(line.sell) > 0)) {
        focusInvalid(`[data-stock-cell="${rowIndex}-5"]`, `Enter the selling price in row ${rowIndex + 1}`);
        return;
      }
    }
    const existingIds = linesForSave.flatMap(({ line }) => (line.product ? [line.product.id] : []));
    if (new Set(existingIds).size !== existingIds.length) {
      toast("The same existing product is entered more than once", { tone: "error" });
      return;
    }
    if ((Number(paid) || 0) > total) {
      toast("Paid amount cannot be more than the purchase total", { tone: "error" });
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
        items: linesForSave.map(({ line: l }) => ({
          ...(l.product
            ? { productId: l.product.id }
            : {
                newProduct: {
                  categoryId: l.draft!.categoryId,
                  name: l.draft!.name,
                  brand: l.draft!.brand.trim() || "Local",
                  wholesalePrice: Number(l.wholesale) || 0,
                },
              }),
          qty: Math.floor(Number(l.qty)),
          unitCost: Number(l.cost) || 0,
          sellingPrice: Number(l.sell) || undefined,
          ...(l.product && Number(l.wholesale) > 0 ? { wholesalePrice: Number(l.wholesale) } : {}),
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
      <div className="acc-stock-header">
        <div>
          <h1 className="acc-h1">Add stock</h1>
          <p>Choose a supplier, add products, and record the payment.</p>
        </div>
        <div className="acc-stock-header-total">
          <span>Purchase total</span>
          <b>{inr(total)}</b>
          <small>{plural(pieces, "piece")}</small>
        </div>
      </div>

      <div className="acc-stock-workspace">
        <div className="acc-stock-main">
          <section className="acc-card acc-stock-step">
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

          <section className="acc-card acc-stock-step">
            <StepTitle n={2} done={enteredLines.length > 0} title="Products" hint="Enter stock quickly, one row at a time" />
            <BulkStockSheet products={products} categories={categories} lines={lines} onLines={setLines} />
          </section>
        </div>

        <aside className="acc-stock-payment">
          <section className="acc-card acc-pay-card">
            <StepTitle n={3} done={total > 0} title="Payment" hint="Record what you paid the supplier" />
            <div className="acc-stock-summary">
              <span>
                <small>Items</small>
                <b>{enteredLines.length}</b>
              </span>
              <span>
                <small>Pieces</small>
                <b>{pieces}</b>
              </span>
              <span className="is-total">
                <small>Total</small>
                <b>{inr(total)}</b>
              </span>
            </div>
            <div className="acc-payment-options is-stock">
              <StockPaymentOption
                label="Pay later"
                hint="Keep the full amount due"
                tone="due"
                checked={!paidNow}
                onSelect={() => setPaid("")}
              />
              <StockPaymentOption
                label="Cash"
                hint="Paid from the cash counter"
                tone="cash"
                checked={paidNow > 0 && method === "CASH"}
                onSelect={() => choosePayment("CASH")}
                amount={paid}
                total={total}
                onAmount={setPaid}
              />
              <StockPaymentOption
                label="UPI"
                hint="Paid using a UPI app"
                tone="online"
                checked={paidNow > 0 && method === "UPI"}
                onSelect={() => choosePayment("UPI")}
                amount={paid}
                total={total}
                onAmount={setPaid}
              />
              <StockPaymentOption
                label="Bank"
                hint="Paid by bank transfer"
                tone="online"
                checked={paidNow > 0 && method === "BANK"}
                onSelect={() => choosePayment("BANK")}
                amount={paid}
                total={total}
                onAmount={setPaid}
              />
            </div>
            <div className={clsx("acc-payment-result", total - paidNow > 0 ? "is-due" : "is-paid")}>
              <span>{total - paidNow > 0 ? "Amount due to supplier" : "Fully paid"}</span>
              <b>{inr(Math.max(total - paidNow, 0))}</b>
            </div>
            <button type="button" className="acc-btn is-primary is-big is-block" onClick={() => void save()} disabled={busy || !enteredLines.length}>
              {busy ? <Loader2 className="acc-spin" /> : <Check />} Save stock · {inr(total)}
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

const STOCK_SHEET_COLUMNS = 7;

function BulkStockSheet({
  products,
  categories,
  lines,
  onLines,
}: {
  products: AccProduct[];
  categories: AccCategory[];
  lines: InLine[];
  onLines: React.Dispatch<React.SetStateAction<InLine[]>>;
}) {
  const [suggestions, setSuggestions] = useState<{ row: number; kind: "brand" | "product" } | null>(null);
  const [deleteLineKey, setDeleteLineKey] = useState<string | null>(null);
  const brands = useMemo(
    () => [...new Set(["Local", ...products.map((product) => product.brand.trim()).filter(Boolean)])].sort((a, b) => a.localeCompare(b)),
    [products],
  );

  function draftFor(line: InLine) {
    if (line.draft) return line.draft;
    return {
      categoryId: line.product?.categoryId || "",
      categoryName: line.product?.categoryName || "",
      name: line.product?.name || "",
      brand: line.product?.brand || "",
    };
  }

  function changeLine(rowIndex: number, change: (line: InLine) => InLine, addTrailingRow = false) {
    onLines((current) => {
      const next = current.map((line, index) => (index === rowIndex ? change(line) : line));
      if (addTrailingRow && rowIndex === next.length - 1) next.push(emptyStockSheetLine());
      return next;
    });
  }

  function changeDraft(rowIndex: number, patch: Partial<NonNullable<InLine["draft"]>>, addTrailingRow = false) {
    changeLine(
      rowIndex,
      (line) => ({ ...line, product: null, draft: { ...draftFor(line), ...patch } }),
      addTrailingRow,
    );
  }

  function chooseProduct(rowIndex: number, product: AccProduct) {
    onLines((current) => {
      if (current.some((line, index) => index !== rowIndex && line.product?.id === product.id)) {
        toast(`${product.name} is already in the sheet`);
        return current;
      }
      const currentLine = current[rowIndex];
      return current.map((line, index) =>
        index === rowIndex
          ? {
              ...productStockSheetLine(product),
              key: currentLine.key,
              qty: currentLine.qty,
              cost: currentLine.cost,
            }
          : line,
      );
    });
    setSuggestions(null);
    requestAnimationFrame(() => focusCell(rowIndex, 3));
  }

  function removeLine(key: string) {
    onLines((current) => {
      const remaining = current.filter((line) => line.key !== key);
      return remaining.length ? remaining : [emptyStockSheetLine()];
    });
    setSuggestions(null);
    setDeleteLineKey(null);
  }

  function focusCell(rowIndex: number, columnIndex: number) {
    let nextRow = rowIndex;
    let nextColumn = columnIndex;
    if (nextColumn >= STOCK_SHEET_COLUMNS) {
      nextRow += 1;
      nextColumn = 0;
      if (nextRow >= lines.length) onLines((current) => [...current, emptyStockSheetLine()]);
    }
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-stock-cell="${nextRow}-${nextColumn}"]`);
      if (target instanceof HTMLSelectElement && target.disabled) {
        focusCell(nextRow, nextColumn + 1);
        return;
      }
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
  }

  function nextButton(rowIndex: number, columnIndex: number) {
    return (
      <button
        type="button"
        className="acc-sheet-next"
        tabIndex={-1}
        aria-label="Go to next field"
        onPointerDown={(event) => {
          event.preventDefault();
          focusCell(rowIndex, columnIndex + 1);
        }}
      >
        <ChevronRight />
      </button>
    );
  }

  return (
    <div className="acc-bulk-stock">
      <div className="acc-bulk-stock-note">
        <span>Type a product and select a suggestion. If no match exists, it will be saved as a new product.</span>
        <b>{lines.filter(isStockSheetLineActive).length} filled</b>
      </div>
      <div className="acc-stock-sheet-scroll">
        <div className="acc-stock-sheet">
          <div className="acc-stock-sheet-head" aria-hidden>
            <span>Brand</span>
            <span>Product name *</span>
            <span>Category *</span>
            <span>Qty *</span>
            <span>Cost / pc ₹ *</span>
            <span>Selling ₹ *</span>
            <span>Wholesale ₹</span>
            <span />
          </div>
          {lines.map((line, rowIndex) => {
            const draft = draftFor(line);
            const brandQuery = draft.brand.trim().toLowerCase();
            const brandMatches = brands.filter((brand) => brand.toLowerCase().includes(brandQuery) && brand.toLowerCase() !== brandQuery).slice(0, 6);
            const productQuery = (line.product?.name || draft.name).trim().toLowerCase();
            const productMatches = productQuery
              ? products
                  .filter((product) => `${product.brand} ${product.name} ${product.model}`.toLowerCase().includes(productQuery))
                  .sort((a, b) => Number(b.brand.toLowerCase() === brandQuery) - Number(a.brand.toLowerCase() === brandQuery))
                  .slice(0, 7)
              : [];
            return (
              <div className="acc-stock-sheet-row" key={line.key}>
                <div className={clsx("acc-stock-sheet-cell", suggestions?.row === rowIndex && suggestions.kind === "brand" && "is-open")}>
                  <input
                    data-stock-cell={`${rowIndex}-0`}
                    value={draft.brand}
                    placeholder="Local"
                    autoComplete="off"
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      changeDraft(rowIndex, { brand: event.target.value }, true);
                      setSuggestions({ row: rowIndex, kind: "brand" });
                    }}
                    onBlur={() => setSuggestions(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        focusCell(rowIndex, 1);
                      }
                    }}
                    aria-label={`Row ${rowIndex + 1} brand`}
                  />
                  {suggestions?.row === rowIndex && suggestions.kind === "brand" && brandMatches.length ? (
                    <ul className="acc-sheet-suggestions">
                      {brandMatches.map((brand) => (
                        <li key={brand}>
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              changeDraft(rowIndex, { brand }, true);
                              setSuggestions(null);
                              focusCell(rowIndex, 1);
                            }}
                          >
                            {brand}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {nextButton(rowIndex, 0)}
                </div>
                <div className={clsx("acc-stock-sheet-cell is-product", suggestions?.row === rowIndex && suggestions.kind === "product" && "is-open")}>
                  <input
                    data-stock-cell={`${rowIndex}-1`}
                    value={line.product?.name || draft.name}
                    placeholder="Type product name"
                    autoComplete="off"
                    onChange={(event) => {
                      changeDraft(rowIndex, { name: event.target.value }, true);
                      setSuggestions({ row: rowIndex, kind: "product" });
                    }}
                    onFocus={() => productQuery && setSuggestions({ row: rowIndex, kind: "product" })}
                    onBlur={() => setSuggestions(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (productMatches.length) chooseProduct(rowIndex, productMatches[0]);
                        else focusCell(rowIndex, 2);
                      }
                    }}
                    aria-label={`Row ${rowIndex + 1} product name`}
                  />
                  {line.product ? <small className="acc-sheet-status is-existing">Existing · {line.product.stockQty} in stock</small> : draft.name.trim() ? <small className="acc-sheet-status">New product</small> : null}
                  {suggestions?.row === rowIndex && suggestions.kind === "product" && productMatches.length ? (
                    <ul className="acc-sheet-suggestions">
                      {productMatches.map((product) => (
                        <li key={product.id}>
                          <button type="button" onPointerDown={(event) => { event.preventDefault(); chooseProduct(rowIndex, product); }}>
                            <span><b>{product.name}</b><small>{product.brand || "Local"} · {product.categoryName}</small></span>
                            <StockBadge qty={product.stockQty} low={product.lowStockAt} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {nextButton(rowIndex, 1)}
                </div>
                <div className="acc-stock-sheet-cell">
                  <select
                    data-stock-cell={`${rowIndex}-2`}
                    value={line.product?.categoryId || draft.categoryId}
                    disabled={Boolean(line.product)}
                    onChange={(event) => {
                      const category = categories.find((item) => item.id === event.target.value);
                      changeDraft(rowIndex, { categoryId: event.target.value, categoryName: category?.name || "" });
                    }}
                    aria-label={`Row ${rowIndex + 1} category`}
                  >
                    <option value="">Choose</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                  {nextButton(rowIndex, 2)}
                </div>
                {[
                  { value: line.qty, patch: "qty" as const, type: "numeric" as const, placeholder: "0" },
                  { value: line.cost, patch: "cost" as const, type: "decimal" as const, placeholder: "0" },
                  { value: line.sell, patch: "sell" as const, type: "decimal" as const, placeholder: "0" },
                ].map((field, fieldIndex) => {
                  const columnIndex = fieldIndex + 3;
                  return (
                    <div className="acc-stock-sheet-cell is-number" key={field.patch}>
                      <input
                        data-stock-cell={`${rowIndex}-${columnIndex}`}
                        type="number"
                        inputMode={field.type}
                        min="0"
                        value={field.value}
                        placeholder={field.placeholder}
                        onChange={(event) => changeLine(rowIndex, (current) => ({ ...current, [field.patch]: event.target.value }), true)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            focusCell(rowIndex, columnIndex + 1);
                          }
                        }}
                        aria-label={`Row ${rowIndex + 1} ${field.patch}`}
                      />
                      {nextButton(rowIndex, columnIndex)}
                    </div>
                  );
                })}
                <div className="acc-stock-sheet-cell is-number">
                  <input
                    data-stock-cell={`${rowIndex}-6`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={line.wholesale}
                    placeholder="0"
                    onChange={(event) => changeLine(rowIndex, (current) => ({ ...current, wholesale: event.target.value }), true)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        focusCell(rowIndex, 7);
                      }
                    }}
                    aria-label={`Row ${rowIndex + 1} wholesale price`}
                  />
                  {nextButton(rowIndex, 6)}
                </div>
                <div className="acc-stock-sheet-action">
                  <b>{lineAmount(line) ? inr(lineAmount(line)) : `#${rowIndex + 1}`}</b>
                  <button
                    type="button"
                    aria-label={`Delete row ${rowIndex + 1}`}
                    onClick={() => {
                      if (isStockSheetLineActive(line)) setDeleteLineKey(line.key);
                      else removeLine(line.key);
                    }}
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <button type="button" className="acc-btn is-ghost acc-sheet-add-rows" onClick={() => onLines((current) => [...current, ...Array.from({ length: 5 }, emptyStockSheetLine)])}>
        <Plus /> Add 5 rows
      </button>
      <Sheet
        open={Boolean(deleteLineKey)}
        onClose={() => setDeleteLineKey(null)}
        title="Delete this row?"
        subtitle="This row has information entered in it."
      >
        <div className="acc-confirm-actions">
          <button type="button" className="acc-btn is-ghost" onClick={() => setDeleteLineKey(null)}>
            Keep row
          </button>
          <button type="button" className="acc-btn is-danger" onClick={() => deleteLineKey && removeLine(deleteLineKey)}>
            <Trash2 /> Delete row
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function StockPaymentOption({
  label,
  hint,
  tone,
  checked,
  onSelect,
  amount,
  total,
  onAmount,
}: {
  label: string;
  hint: string;
  tone: "cash" | "online" | "due";
  checked: boolean;
  onSelect: () => void;
  amount?: string;
  total?: number;
  onAmount?: (amount: string) => void;
}) {
  return (
    <div className={clsx("acc-payment-option", `is-${tone}`, checked && "is-on")}>
      <label>
        <input type="radio" name="stock-payment" checked={checked} onChange={onSelect} />
        <span>
          <b>{label}</b>
          <small>{hint}</small>
        </span>
      </label>
      {checked && onAmount ? (
        <div className="acc-payment-amount">
          <span>Amount paid now</span>
          <label>
            <b>₹</b>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max={total}
              step="0.01"
              value={amount || ""}
              onChange={(event) => onAmount(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder="0"
              aria-label={`${label} amount`}
            />
          </label>
        </div>
      ) : null}
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
