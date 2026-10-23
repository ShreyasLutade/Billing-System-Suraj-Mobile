import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { CalendarDays, Check, FileDown, Info, Loader2, MessageCircle, Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { SearchClearButton } from "../components/ui";
import { ApiError } from "../lib/api";
import {
  accApi,
  type AccCustomerInput,
  type AccCustomerRow,
  type AccGroup,
  type AccProduct,
  type AccSale,
} from "./accApi";
import { Segmented, Sheet, StockBadge, completePhone, errorText, inr, newRef, plural, refreshCatalog, shortDate, toast, todayInput, useAccCatalog } from "./shared";

/**
 * Wholesale bill: a shop buys in bulk, usually on credit. Pick (or add) the
 * customer, add items with big quantities, take what they pay now, and the
 * rest goes to their dues. The draft survives a reload on this device.
 */

type Line = { key: string; productId: string | null; name: string; qty: number; rate: number; stockQty: number | null };

/** CREDIT = nothing paid now; PAY = paying, full or partial not chosen yet. */
type PayMode = "CREDIT" | "PAY" | "FULL" | "PARTIAL";

type Draft = {
  customer: AccCustomerRow | null;
  lines: Line[];
  pay: PayMode;
  paid: string;
  method: "CASH" | "ONLINE";
  dueDate: string;
  note: string;
};

const DRAFT_KEY = "acc.wholesale.draft";
const EMPTY: Draft = { customer: null, lines: [], pay: "CREDIT", paid: "", method: "CASH", dueDate: "", note: "" };

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Draft) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function AccWholesalePage() {
  const { catalog } = useAccCatalog();
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<AccSale | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const refId = useRef(newRef());
  const customerInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft]);

  // "New bill" from a customer page preselects them.
  useEffect(() => {
    const id = (location.state as { customerId?: string } | null)?.customerId;
    if (!id) return;
    accApi
      .customers({ limit: 1000 })
      .then(({ data }) => {
        const found = data.find((c) => c.id === id);
        if (found) setDraft((d) => ({ ...d, customer: found }));
      })
      .catch(() => undefined);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const products = catalog?.products ?? [];
  const tokens = itemQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = useMemo(() => {
    if (!tokens.length) return [];
    return products
      .filter((p) => {
        const hay = `${p.name} ${p.type} ${p.brand} ${p.model} ${p.categoryName} ${p.barcode || ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, itemQuery]);

  function addProduct(p: AccProduct) {
    setDraft((d) => {
      const existing = d.lines.find((l) => l.productId === p.id);
      if (existing) {
        return { ...d, lines: d.lines.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l)) };
      }
      return {
        ...d,
        lines: [
          ...d.lines,
          {
            key: newRef(),
            productId: p.id,
            name: p.name,
            qty: 1,
            rate: p.wholesalePrice || p.sellingPrice,
            stockQty: p.stockQty,
          },
        ],
      };
    });
    setItemQuery("");
  }

  function addCustom() {
    const name = itemQuery.trim();
    if (!name) return;
    set({ lines: [...draft.lines, { key: newRef(), productId: null, name, qty: 1, rate: 0, stockQty: null }] });
    setItemQuery("");
  }

  function updateLine(key: string, patch: Partial<Line>) {
    set({ lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  }

  const total = Math.round(draft.lines.reduce((a, l) => a + l.qty * l.rate, 0) * 100) / 100;
  const paid = draft.pay === "FULL" ? total : draft.pay === "PARTIAL" ? Math.min(Number(draft.paid) || 0, total) : 0;
  const due = Math.round((total - paid) * 100) / 100;
  const needsDueDate = draft.pay === "CREDIT" || draft.pay === "PARTIAL";
  const pieces = draft.lines.reduce((a, l) => a + l.qty, 0);
  const newBalance = (draft.customer?.balance || 0) + due;
  const overLimit = draft.customer && draft.customer.creditLimit > 0 && newBalance > draft.customer.creditLimit;

  async function save(allowOutOfStock = false) {
    if (busy) return;
    if (!draft.customer) {
      toast("Choose the customer first", { tone: "error" });
      window.scrollTo({ top: 0, behavior: "smooth" });
      customerInput.current?.focus({ preventScroll: true });
      return;
    }
    if (!draft.lines.length) {
      toast("Add at least one item", { tone: "error" });
      return;
    }
    if (draft.lines.some((l) => l.rate <= 0)) {
      toast("Every item needs a rate", { tone: "error" });
      return;
    }
    if (draft.pay === "PAY") {
      toast("Choose full amount or partial amount", { tone: "error" });
      return;
    }
    if (draft.pay === "PARTIAL" && (paid <= 0 || paid >= total)) {
      toast(paid >= total ? "That is the full amount: choose Full amount" : "Enter the amount paid now", { tone: "error" });
      return;
    }
    if (needsDueDate && !draft.dueDate) {
      toast("Add the due date for the pending amount", { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const { data } = await accApi.createSale({
        kind: "WHOLESALE",
        clientRef: refId.current,
        customerId: draft.customer.id,
        items: draft.lines.map((l) => (l.productId ? { productId: l.productId, qty: l.qty, rate: l.rate } : { name: l.name, qty: l.qty, rate: l.rate })),
        ...(draft.method === "CASH" ? { cashAmount: paid } : { onlineAmount: paid }),
        dueDate: due > 0 ? draft.dueDate : undefined,
        note: draft.note,
        allowOutOfStock,
      });
      setSaved(data);
      setDraft(EMPTY);
      refId.current = newRef();
      void refreshCatalog();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !allowOutOfStock) {
        if (window.confirm(`${err.message}. Save the bill anyway? (stock will go below zero)`)) {
          setBusy(false);
          await save(true);
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
    <div className="acc-page">
      <div className="acc-title-row">
        <h1>Wholesale bill</h1>
        {draft.lines.length || draft.customer ? (
          <button
            type="button"
            className="acc-link-btn"
            onClick={() => {
              if (window.confirm("Clear this bill?")) setDraft(EMPTY);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Customer */}
      {draft.customer ? (
        <div className="acc-card acc-cust-card">
          <div>
            <strong>{draft.customer.name}</strong>
            <small>
              {[draft.customer.shopName, draft.customer.city, draft.customer.phone].filter(Boolean).join(" · ")}
            </small>
            {draft.customer.group ? (
              <span className="acc-group-tag" style={{ ["--g" as string]: draft.customer.group.color }}>
                {draft.customer.group.name}
              </span>
            ) : null}
          </div>
          <div className="acc-cust-bal">
            <small>Old balance</small>
            <b className={clsx(draft.customer.balance > 0 && "is-red")}>{inr(draft.customer.balance)}</b>
            <button type="button" className="acc-link-btn" onClick={() => set({ customer: null })}>
              Change
            </button>
          </div>
        </div>
      ) : (
        <CustomerChooser inputRef={customerInput} onPick={(customer) => set({ customer })} />
      )}

      {/* Items */}
      <div className="acc-card">
        <label className="acc-search is-in-card">
          <Search aria-hidden />
          <input
            type="search"
            value={itemQuery}
            onChange={(e) => setItemQuery(e.target.value)}
            placeholder="Add item: search product…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length) addProduct(results[0]);
            }}
          />
          <SearchClearButton visible={Boolean(itemQuery)} onClear={() => setItemQuery("")} />
        </label>
        {tokens.length ? (
          <ul className="acc-results">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => addProduct(p)}>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.categoryName} · W {inr(p.wholesalePrice || p.sellingPrice)}
                    </small>
                  </span>
                  <StockBadge qty={p.stockQty} low={p.lowStockAt} />
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="is-custom" onClick={addCustom}>
                <Plus /> Add “{itemQuery.trim()}” as a custom item
              </button>
            </li>
          </ul>
        ) : null}

        {draft.lines.length ? (
          <ul className="acc-lines">
            {draft.lines.map((line) => (
              <li key={line.key}>
                <div className="acc-line-head">
                  <strong>{line.name}</strong>
                  {line.stockQty !== null && line.qty > line.stockQty ? (
                    <span className="acc-badge is-red">Stock {line.stockQty}</span>
                  ) : null}
                  <button
                    type="button"
                    className="acc-icon-btn is-small"
                    onClick={() => set({ lines: draft.lines.filter((l) => l.key !== line.key) })}
                    aria-label="Remove"
                  >
                    <Trash2 />
                  </button>
                </div>
                <div className="acc-line-edit">
                  <label className="acc-field is-qty">
                    <span>Qty</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={line.qty || ""}
                      onChange={(e) => updateLine(line.key, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                      onBlur={() => line.qty < 1 && updateLine(line.key, { qty: 1 })}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <div className="acc-qty-chips">
                    {[10, 50, 100].map((n) => (
                      <button key={n} type="button" onClick={() => updateLine(line.key, { qty: line.qty === 1 ? n : line.qty + n })}>
                        +{n}
                      </button>
                    ))}
                  </div>
                  <label className="acc-field is-rate">
                    <span>Rate ₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={line.rate || ""}
                      onChange={(e) => updateLine(line.key, { rate: Number(e.target.value) || 0 })}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <b className="acc-line-amt">{inr(line.qty * line.rate)}</b>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="acc-hint">Search above to add items. Use +10 / +50 / +100 for bulk quantities.</p>
        )}
      </div>

      {/* Payment */}
      <div className="acc-card acc-pay-card">
        <div className="acc-sum-row">
          <span>
            {plural(draft.lines.length, "item")} · {pieces} pcs
          </span>
        </div>
        <div className="acc-sum-row is-total">
          <span>Bill total</span>
          <b className="acc-total-big">{inr(total)}</b>
        </div>
        <Segmented
          value={draft.pay === "CREDIT" ? "CREDIT" : "PAY"}
          onChange={(mode) => {
            if (mode === "CREDIT") set({ pay: "CREDIT" });
            else if (draft.pay === "CREDIT") set({ pay: "PAY" });
          }}
          options={[
            { value: "CREDIT", label: "Full credit" },
            { value: "PAY", label: "Partial / full pay" },
          ]}
        />
        {draft.pay !== "CREDIT" ? (
          <>
            <div className="acc-chips">
              <button type="button" className={clsx("acc-chip", draft.pay === "FULL" && "is-on")} onClick={() => set({ pay: "FULL" })}>
                Full amount {inr(total)}
              </button>
              <button type="button" className={clsx("acc-chip", draft.pay === "PARTIAL" && "is-on")} onClick={() => set({ pay: "PARTIAL" })}>
                Partial amount
              </button>
            </div>
            {draft.pay === "FULL" || draft.pay === "PARTIAL" ? (
              <div className="acc-form-grid">
                {draft.pay === "PARTIAL" ? (
                  <label className="acc-field">
                    <span>Paid now ₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={draft.paid}
                      onChange={(e) => set({ paid: e.target.value })}
                      placeholder="0"
                      autoFocus
                    />
                  </label>
                ) : null}
                <div className="acc-field">
                  <span>Paid by</span>
                  <Segmented
                    value={draft.method}
                    onChange={(method) => set({ method })}
                    options={[
                      { value: "CASH", label: "Cash" },
                      { value: "ONLINE", label: "UPI" },
                    ]}
                  />
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        {needsDueDate ? (
          <>
            <div className="acc-due-line">
              <span>{draft.pay === "CREDIT" ? "Full amount on credit" : "Pending on this bill"}</span>
              <b>{inr(due)}</b>
            </div>
            <DueDatePicker value={draft.dueDate} onChange={(dueDate) => set({ dueDate })} />
            {draft.customer ? (
              <p className={clsx("acc-hint", overLimit && "is-red")}>
                Customer's balance after this bill: <b>{inr(newBalance)}</b>
                {overLimit ? ` (over credit limit ${inr(draft.customer.creditLimit)})` : ""}
              </p>
            ) : null}
          </>
        ) : null}
        <label className="acc-field">
          <span>Note</span>
          <input value={draft.note} onChange={(e) => set({ note: e.target.value })} placeholder="Transport, bundle no., etc." />
        </label>
        <button type="button" className="acc-btn is-primary is-big is-block" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="acc-spin" /> : <Check />}
          Save bill {inr(total)}
        </button>
      </div>

      <Sheet
        open={Boolean(saved)}
        onClose={() => setSaved(null)}
        title={`Saved ${saved?.number || ""}`}
        subtitle={saved ? `${saved.customerName} · ${inr(saved.total)}` : ""}
        footer={
          <button type="button" className="acc-btn is-primary is-block" onClick={() => setSaved(null)}>
            <Plus /> New bill
          </button>
        }
      >
        {saved ? (
          <div className="acc-saved">
            <div className="acc-kv">
              <span>Bill total</span>
              <b>{inr(saved.total)}</b>
              <span>Paid now</span>
              <b>{inr(saved.cashAmount + saved.onlineAmount)}</b>
              <span>Due on bill</span>
              <b className="is-red">{inr(saved.dueAmount)}</b>
              {saved.dueDate ? (
                <>
                  <span>Pay by</span>
                  <b>{shortDate(saved.dueDate)}</b>
                </>
              ) : null}
            </div>
            <div className="acc-btn-row">
              <button
                type="button"
                className="acc-btn is-ghost"
                onClick={() => accApi.pdf.bill(saved.id).catch((e) => toast(errorText(e), { tone: "error" }))}
              >
                <FileDown /> Bill PDF
              </button>
              <a
                className="acc-btn is-ghost"
                target="_blank"
                rel="noreferrer"
                href={`https://wa.me/91${saved.customerPhone}?text=${encodeURIComponent(
                  `Bill ${saved.number}\n${saved.items.map((i) => `${i.qty} × ${i.name} @ ${i.rate}`).join("\n")}\nTotal: ₹${saved.total}\nPaid: ₹${
                    saved.cashAmount + saved.onlineAmount
                  }\nDue: ₹${saved.dueAmount}`,
                )}`}
              >
                <MessageCircle /> WhatsApp
              </a>
              {saved.customerId ? (
                <Link className="acc-btn is-ghost" to={`/acc/dues/${saved.customerId}`}>
                  Customer
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

const DUE_PRESETS = [7, 15, 30];

/** Quick 7 / 15 / 30 days or any date, with the chosen day spelled out below. */
function DueDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const dateInput = useRef<HTMLInputElement>(null);
  const preset = DUE_PRESETS.find((d) => todayInput(d) === value);
  const custom = Boolean(value) && !preset;
  const days = value ? Math.round((new Date(value).getTime() - new Date(todayInput()).getTime()) / 86400000) : 0;

  function openCalendar() {
    const input = dateInput.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  }

  return (
    <div className="acc-field">
      <span>Due date *</span>
      <div className="acc-due-pick">
        {DUE_PRESETS.map((d) => (
          <button key={d} type="button" className={clsx(preset === d && "is-on")} onClick={() => onChange(todayInput(d))}>
            <b>{d} days</b>
            <small>{shortDate(todayInput(d))}</small>
          </button>
        ))}
        <button type="button" className={clsx(custom && "is-on")} onClick={openCalendar}>
          <CalendarDays aria-hidden />
          <small>{custom ? shortDate(value) : "Pick date"}</small>
          <input
            ref={dateInput}
            type="date"
            tabIndex={-1}
            aria-label="Pick due date"
            value={value}
            min={todayInput()}
            onChange={(e) => onChange(e.target.value)}
          />
        </button>
      </div>
      <p className={clsx("acc-due-when", !value && "is-empty")}>
        {value ? (
          <>
            We receive it by{" "}
            <b>
              {new Date(value).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            </b>
            {" · "}
            {days <= 0 ? "today" : `in ${plural(days, "day")}`}
          </>
        ) : (
          "Choose when we will receive the pending amount"
        )}
      </p>
    </div>
  );
}

/** First thing on the bill: search existing wholesale customers, or add a new one right below. */
function CustomerChooser({
  inputRef,
  onPick,
}: {
  inputRef: React.Ref<HTMLInputElement>;
  onPick: (customer: AccCustomerRow) => void;
}) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<AccCustomerRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setList(null);
      return;
    }
    const timer = setTimeout(() => {
      accApi
        .customers({ q: query, limit: 8 })
        .then(({ data }) => setList(data))
        .catch(() => setList([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="acc-card">
      <h2 className="acc-card-title">{adding ? "New customer" : "Customer"}</h2>
      {adding ? (
        <CustomerForm
          initial={{ name: /\d{5,}/.test(q) ? "" : q.trim(), phone: /^\d+$/.test(q.trim()) ? q.trim() : "" }}
          submitLabel="Save & use"
          onSaved={async (id) => {
            const { data } = await accApi.customers({ limit: 1000 });
            const c = data.find((x) => x.id === id);
            if (c) onPick(c);
          }}
          onUseExisting={onPick}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <>
          <label className="acc-search is-in-card">
            <Search aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Customer name, phone, shop, city…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && list?.length) onPick(list[0]);
              }}
            />
            <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
          </label>
          {list ? (
            <ul className="acc-results">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onPick(c)}>
                    <span>
                      <strong>{c.name}</strong>
                      <small>{[c.shopName, c.city, c.phone, c.group?.name].filter(Boolean).join(" · ")}</small>
                    </span>
                    {c.balance > 0 ? <b className="is-red">{inr(c.balance)}</b> : <small>Clear</small>}
                  </button>
                </li>
              ))}
              {!list.length ? <li className="acc-hint">No customer found.</li> : null}
            </ul>
          ) : null}
          <button type="button" className="acc-btn is-ghost is-block" onClick={() => setAdding(true)}>
            <UserPlus /> Add new customer
          </button>
        </>
      )}
    </div>
  );
}

const GROUP_COLORS = ["#5d73b6", "#0ea5e9", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#db2777", "#0f766e"];

/** Add / edit a wholesale customer, including their group. */
export function CustomerForm({
  id,
  initial,
  submitLabel = "Save",
  onSaved,
  onUseExisting,
  onCancel,
}: {
  id?: string;
  initial?: Partial<AccCustomerInput>;
  submitLabel?: string;
  onSaved: (id: string) => void | Promise<void>;
  /** Shown as "Use same info" when the typed mobile is already saved. */
  onUseExisting?: (customer: AccCustomerRow) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<AccCustomerInput>({
    name: "",
    phone: "",
    shopName: "",
    city: "",
    address: "",
    gstin: "",
    groupId: null,
    creditLimit: 0,
    note: "",
    ...initial,
  });
  const [groups, setGroups] = useState<AccGroup[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    accApi
      .groups()
      .then(({ data }) => setGroups(data))
      .catch(() => undefined);
  }, []);

  const set = (patch: Partial<AccCustomerInput>) => setForm((f) => ({ ...f, ...patch }));

  // Same mobile = same customer; checked once the whole number is typed.
  const phoneDigits = completePhone(form.phone);
  const [match, setMatch] = useState<AccCustomerRow | null>(null);
  useEffect(() => {
    if (phoneDigits.length !== 10) {
      setMatch(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      accApi
        .customers({ q: phoneDigits, limit: 5 })
        .then(({ data }) => {
          if (live) setMatch(data.find((c) => c.phone === phoneDigits && c.id !== id) ?? null);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [phoneDigits, id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body = { ...form, groupName: newGroup.trim() || undefined };
      const { data } = id ? await accApi.updateCustomer(id, body) : await accApi.createCustomer(body);
      toast(id ? "Customer updated" : "Customer added");
      await onSaved(data.id);
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="acc-form" onSubmit={submit}>
      <div className="acc-form-grid">
        <label className="acc-field">
          <span>Name *</span>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} required autoFocus />
        </label>
        <label className="acc-field">
          <span>Mobile *</span>
          <input inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={13} required />
        </label>
        <label className="acc-field">
          <span>Shop name</span>
          <input value={form.shopName} onChange={(e) => set({ shopName: e.target.value })} />
        </label>
        <label className="acc-field">
          <span>City / area</span>
          <input value={form.city} onChange={(e) => set({ city: e.target.value })} />
        </label>
      </div>
      {match ? (
        <div className="acc-phone-match" role="status">
          <Info aria-hidden />
          <span>
            This number is already saved as <b>{match.name}</b>
            {match.shopName ? ` (${match.shopName})` : ""}
          </span>
          {onUseExisting ? (
            <button type="button" className="acc-btn is-small" onClick={() => onUseExisting(match)}>
              Use same info
            </button>
          ) : null}
        </div>
      ) : null}
      <label className="acc-field">
        <span>Address</span>
        <input value={form.address} onChange={(e) => set({ address: e.target.value })} />
      </label>
      <div className="acc-field">
        <span>Group</span>
        <div className="acc-chips">
          <button type="button" className={clsx("acc-chip", !form.groupId && !newGroup && "is-on")} onClick={() => { set({ groupId: null }); setNewGroup(""); }}>
            None
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={clsx("acc-chip", form.groupId === g.id && !newGroup && "is-on")}
              onClick={() => {
                set({ groupId: g.id });
                setNewGroup("");
              }}
            >
              <i className="acc-dot" style={{ background: g.color }} />
              {g.name}
            </button>
          ))}
          <input
            className="acc-chip-input"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            placeholder="+ New group"
          />
        </div>
      </div>
      <details className="acc-more">
        <summary>More (GSTIN, credit limit, note)</summary>
        <div className="acc-form-grid">
          <label className="acc-field">
            <span>GSTIN</span>
            <input value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} />
          </label>
          <label className="acc-field">
            <span>Credit limit ₹</span>
            <input
              type="number"
              inputMode="decimal"
              value={form.creditLimit || ""}
              onChange={(e) => set({ creditLimit: Number(e.target.value) || 0 })}
              placeholder="No limit"
            />
          </label>
        </div>
        <label className="acc-field">
          <span>Note</span>
          <input value={form.note} onChange={(e) => set({ note: e.target.value })} />
        </label>
      </details>
      <div className="acc-btn-row">
        {onCancel ? (
          <button type="button" className="acc-btn is-ghost" onClick={onCancel}>
            <X /> Cancel
          </button>
        ) : null}
        <button type="submit" className="acc-btn is-primary" disabled={busy}>
          {busy ? <Loader2 className="acc-spin" /> : <Check />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export { GROUP_COLORS };
