import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { CalendarDays, Check, Info, Loader2, MessageCircle, Plus, Search, Trash2, X } from "lucide-react";
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
import { PdfButton, Sheet, StockBadge, completePhone, errorText, inr, newRef, plural, refreshCatalog, shortDate, toast, todayInput, useAccCatalog } from "./shared";

/**
 * Wholesale bill: a shop buys in bulk, usually on credit. Pick (or add) the
 * customer, add items with big quantities, take what they pay now, and the
 * rest goes to their dues. The draft survives a reload on this device.
 */

type Line = { key: string; productId: string | null; name: string; qty: number; rate: number; stockQty: number | null };

type PayMode = "CREDIT" | "PAY";

type Draft = {
  customer: AccCustomerRow | null;
  customerInput: AccCustomerInput;
  lines: Line[];
  pay: PayMode;
  useCash: boolean;
  useOnline: boolean;
  cashPaid: string;
  onlinePaid: string;
  dueDate: string;
  note: string;
};

const DRAFT_KEY = "acc.wholesale.draft";
const EMPTY_CUSTOMER: AccCustomerInput = {
  name: "",
  phone: "",
  shopName: "",
  city: "",
  address: "",
  gstin: "",
  groupId: null,
  creditLimit: 0,
  note: "",
};
const EMPTY: Draft = {
  customer: null,
  customerInput: EMPTY_CUSTOMER,
  lines: [],
  pay: "CREDIT",
  useCash: false,
  useOnline: false,
  cashPaid: "",
  onlinePaid: "",
  dueDate: "",
  note: "",
};

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY;
    const saved = JSON.parse(raw) as Partial<Draft> & { paid?: string; method?: "CASH" | "ONLINE"; pay?: string };
    const legacyPaid = saved.paid || "";
    const legacyPay = saved.pay;
    return {
      ...EMPTY,
      ...saved,
      customerInput: saved.customerInput
        ? { ...EMPTY_CUSTOMER, ...saved.customerInput }
        : saved.customer
          ? {
              ...EMPTY_CUSTOMER,
              name: saved.customer.name,
              phone: saved.customer.phone,
              shopName: saved.customer.shopName,
              city: saved.customer.city,
              address: saved.customer.address,
              groupId: saved.customer.group?.id || null,
              creditLimit: saved.customer.creditLimit,
            }
          : EMPTY_CUSTOMER,
      pay: legacyPay === "CREDIT" ? "CREDIT" : "PAY",
      useCash: saved.useCash ?? (Boolean(legacyPaid) && saved.method !== "ONLINE"),
      useOnline: saved.useOnline ?? (Boolean(legacyPaid) && saved.method === "ONLINE"),
      cashPaid: saved.cashPaid ?? (saved.method !== "ONLINE" ? legacyPaid : ""),
      onlinePaid: saved.onlinePaid ?? (saved.method === "ONLINE" ? legacyPaid : ""),
    };
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
        if (found) void useExistingCustomer(found);
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
  const cashPaid = draft.pay === "PAY" && draft.useCash ? Math.max(Number(draft.cashPaid) || 0, 0) : 0;
  const onlinePaid = draft.pay === "PAY" && draft.useOnline ? Math.max(Number(draft.onlinePaid) || 0, 0) : 0;
  const paid = Math.min(cashPaid + onlinePaid, total);
  const due = Math.round((total - paid) * 100) / 100;
  const needsDueDate = due > 0;
  const pieces = draft.lines.reduce((a, l) => a + l.qty, 0);
  const newBalance = (draft.customer?.balance || 0) + due;
  const overLimit = draft.customer && draft.customer.creditLimit > 0 && newBalance > draft.customer.creditLimit;

  const useExistingCustomer = useCallback(async (customer: AccCustomerRow | null) => {
    if (!customer) {
      setDraft((current) =>
        current.customer
          ? {
              ...current,
              customer: null,
              customerInput: { ...EMPTY_CUSTOMER, phone: current.customerInput.phone },
            }
          : current,
      );
      return;
    }
    try {
      const { data } = await accApi.customer(customer.id);
      setDraft((current) => {
        if (completePhone(current.customerInput.phone) !== customer.phone) return current;
        return {
          ...current,
          customer,
          customerInput: {
            name: data.name,
            phone: data.phone,
            shopName: data.shopName,
            city: data.city,
            address: data.address,
            gstin: data.gstin,
            groupId: data.groupId,
            creditLimit: data.creditLimit,
            note: data.note,
          },
        };
      });
    } catch {
      setDraft((current) => ({ ...current, customer }));
    }
  }, []);

  function setFullCredit(checked: boolean) {
    if (checked) {
      set({ pay: "CREDIT", useCash: false, useOnline: false, cashPaid: "", onlinePaid: "" });
    } else {
      set({ pay: "PAY" });
    }
  }

  function togglePayment(mode: "CASH" | "ONLINE", checked: boolean) {
    if (!checked) {
      set(mode === "CASH" ? { useCash: false, cashPaid: "" } : { useOnline: false, onlinePaid: "" });
      return;
    }
    const otherPaid = mode === "CASH" ? onlinePaid : cashPaid;
    const amount = String(Math.max(Math.round((total - otherPaid) * 100) / 100, 0) || "");
    set(
      mode === "CASH"
        ? { pay: "PAY", useCash: true, cashPaid: amount }
        : { pay: "PAY", useOnline: true, onlinePaid: amount },
    );
  }

  async function save(allowOutOfStock = false) {
    if (busy) return;
    if (!completePhone(draft.customerInput.phone)) {
      toast("Enter the customer's 10-digit mobile number", { tone: "error" });
      window.scrollTo({ top: 0, behavior: "smooth" });
      customerInput.current?.focus({ preventScroll: true });
      return;
    }
    if ((draft.customerInput.shopName || "").trim().length < 2) {
      toast("Enter the shop name", { tone: "error" });
      return;
    }
    if (draft.customerInput.name.trim().length < 2) {
      toast("Enter the customer name", { tone: "error" });
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
    if (draft.pay === "PAY" && !draft.useCash && !draft.useOnline) {
      toast("Choose Cash, Online, or Full credit", { tone: "error" });
      return;
    }
    if (cashPaid + onlinePaid > total) {
      toast("Payment is more than the bill total", { tone: "error" });
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
        customer: draft.customerInput,
        items: draft.lines.map((l) => (l.productId ? { productId: l.productId, qty: l.qty, rate: l.rate } : { name: l.name, qty: l.qty, rate: l.rate })),
        cashAmount: cashPaid,
        onlineAmount: onlinePaid,
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
        {draft.lines.length || draft.customer || draft.customerInput.phone ? (
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
      <CustomerChooser
        inputRef={customerInput}
        value={draft.customerInput}
        existing={draft.customer}
        onChange={(customerInput) => set({ customerInput })}
        onExistingFound={useExistingCustomer}
      />

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
        <div className="acc-payment-heading">
          <div>
            <h2>Payment</h2>
            <p>Select how much is paid now. The balance becomes due automatically.</p>
          </div>
        </div>
        <div className="acc-sum-row">
          <span>
            {plural(draft.lines.length, "item")} · {pieces} pcs
          </span>
        </div>
        <div className="acc-sum-row is-total">
          <span>Bill total</span>
          <b className="acc-total-big">{inr(total)}</b>
        </div>
        <div className="acc-payment-options">
          <PaymentOption
            label="Full credit"
            hint="Customer will pay the full amount later"
            tone="due"
            checked={draft.pay === "CREDIT"}
            onChecked={setFullCredit}
          />
          <PaymentOption
            label="Cash"
            hint="Amount received in cash"
            tone="cash"
            checked={draft.pay === "PAY" && draft.useCash}
            onChecked={(checked) => togglePayment("CASH", checked)}
            amount={draft.cashPaid}
            onAmount={(cashPaid) => set({ pay: "PAY", cashPaid })}
          />
          <PaymentOption
            label="Online"
            hint="UPI or bank transfer"
            tone="online"
            checked={draft.pay === "PAY" && draft.useOnline}
            onChecked={(checked) => togglePayment("ONLINE", checked)}
            amount={draft.onlinePaid}
            onAmount={(onlinePaid) => set({ pay: "PAY", onlinePaid })}
          />
        </div>
        <div className={clsx("acc-payment-result", due > 0 ? "is-due" : "is-paid")}>
          <span>{due > 0 ? (draft.pay === "CREDIT" ? "Full amount on credit" : "Remaining due") : "Fully paid"}</span>
          <b>{inr(due > 0 ? due : paid)}</b>
        </div>
        {needsDueDate ? (
          <>
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
              <PdfButton label="Bill" onDownload={() => accApi.pdf.bill(saved.id)} onShare={() => accApi.sharePdf.bill(saved.id)} />
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

function PaymentOption({
  label,
  hint,
  tone,
  checked,
  onChecked,
  amount,
  onAmount,
}: {
  label: string;
  hint: string;
  tone: "cash" | "online" | "due";
  checked: boolean;
  onChecked: (checked: boolean) => void;
  amount?: string;
  onAmount?: (amount: string) => void;
}) {
  return (
    <div className={clsx("acc-payment-option", `is-${tone}`, checked && "is-on")}>
      <label>
        <input type="checkbox" checked={checked} onChange={(event) => onChecked(event.target.checked)} />
        <span>
          <b>{label}</b>
          <small>{hint}</small>
        </span>
      </label>
      {checked && onAmount ? (
        <div className="acc-payment-amount">
          <span>Amount</span>
          <label>
            <b>₹</b>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount || ""}
              onChange={(event) => onAmount(event.target.value)}
              placeholder="0"
              aria-label={`${label} amount`}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

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

/** Full customer form; an exact mobile match selects the saved customer automatically. */
function CustomerChooser({
  inputRef,
  value,
  existing,
  onChange,
  onExistingFound,
}: {
  inputRef: React.Ref<HTMLInputElement>;
  value: AccCustomerInput;
  existing: AccCustomerRow | null;
  onChange: (value: AccCustomerInput) => void;
  onExistingFound: (customer: AccCustomerRow | null) => void;
}) {
  return (
    <div className="acc-card">
      <h2 className="acc-card-title">Customer</h2>
      <CustomerForm
        phoneInputRef={inputRef}
        value={value}
        onChange={onChange}
        onExistingFound={onExistingFound}
        hideActions
      />
      {existing ? (
        <div className="acc-existing-customer" role="status">
          <span>Saved customer found</span>
          <b className={clsx(existing.balance > 0 && "is-red")}>Old balance {inr(existing.balance)}</b>
        </div>
      ) : null}
    </div>
  );
}

const GROUP_COLORS = ["#5d73b6", "#0ea5e9", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#db2777", "#0f766e"];

/** Add / edit a wholesale customer, including their group. */
export function CustomerForm({
  id,
  initial,
  phoneInputRef,
  value,
  onChange,
  onExistingFound,
  hideActions = false,
  submitLabel = "Save",
  onSaved,
  onUseExisting,
  onCancel,
}: {
  id?: string;
  initial?: Partial<AccCustomerInput>;
  phoneInputRef?: React.Ref<HTMLInputElement>;
  value?: AccCustomerInput;
  onChange?: (value: AccCustomerInput) => void;
  onExistingFound?: (customer: AccCustomerRow | null) => void;
  hideActions?: boolean;
  submitLabel?: string;
  onSaved?: (id: string) => void | Promise<void>;
  /** Shown as "Use same info" when the typed mobile is already saved. */
  onUseExisting?: (customer: AccCustomerRow) => void;
  onCancel?: () => void;
}) {
  const [internalForm, setInternalForm] = useState<AccCustomerInput>({
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
  const form = value ?? internalForm;
  const [groups, setGroups] = useState<AccGroup[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    accApi
      .groups()
      .then(({ data }) => setGroups(data))
      .catch(() => undefined);
  }, []);

  const set = (patch: Partial<AccCustomerInput>) => {
    if (value && onChange) onChange({ ...value, ...patch });
    else setInternalForm((current) => ({ ...current, ...patch }));
  };

  // Same mobile = same customer; checked once the whole number is typed.
  const phoneDigits = completePhone(form.phone);
  const [match, setMatch] = useState<AccCustomerRow | null>(null);
  useEffect(() => {
    if (phoneDigits.length !== 10) {
      setMatch(null);
      onExistingFound?.(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      accApi
        .customers({ q: phoneDigits, limit: 5 })
        .then(({ data }) => {
          if (!live) return;
          const found = data.find((customer) => customer.phone === phoneDigits && customer.id !== id) ?? null;
          if (onExistingFound) {
            onExistingFound(found);
            return;
          }
          setMatch(found);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [phoneDigits, id, onExistingFound]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body = { ...form, groupName: newGroup.trim() || undefined };
      const { data } = id ? await accApi.updateCustomer(id, body) : await accApi.createCustomer(body);
      toast(id ? "Customer updated" : "Customer added");
      await onSaved?.(data.id);
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="acc-form" onSubmit={hideActions ? (event) => event.preventDefault() : submit}>
      <div className="acc-form-grid">
        <label className="acc-field">
          <span>Mobile *</span>
          <input ref={phoneInputRef} inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={13} required autoFocus />
        </label>
        <label className="acc-field">
          <span>Shop name *</span>
          <input value={form.shopName} onChange={(e) => set({ shopName: e.target.value })} required />
        </label>
        <label className="acc-field">
          <span>Name *</span>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} required />
        </label>
        <label className="acc-field">
          <span>Address</span>
          <input value={form.address} onChange={(e) => set({ address: e.target.value })} />
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
      <div className="acc-field">
        <span>Group</span>
        <div className="acc-chips">
          <button type="button" className={clsx("acc-chip", !form.groupId && !newGroup && "is-on")} onClick={() => { set({ groupId: null, groupName: "" }); setNewGroup(""); }}>
            None
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={clsx("acc-chip", form.groupId === g.id && !newGroup && "is-on")}
              onClick={() => {
                set({ groupId: g.id, groupName: "" });
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
            onChange={(e) => {
              setNewGroup(e.target.value);
              set({ groupId: null, groupName: e.target.value });
            }}
            placeholder="+ New group"
          />
        </div>
      </div>
      {!hideActions ? <div className="acc-btn-row">
        {onCancel ? (
          <button type="button" className="acc-btn is-ghost" onClick={onCancel}>
            <X /> Cancel
          </button>
        ) : null}
        <button type="submit" className="acc-btn is-primary" disabled={busy}>
          {busy ? <Loader2 className="acc-spin" /> : <Check />}
          {submitLabel}
        </button>
      </div> : null}
    </form>
  );
}

export { GROUP_COLORS };
