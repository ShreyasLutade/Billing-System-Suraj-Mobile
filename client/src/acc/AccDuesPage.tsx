import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { AnimatePresence } from "framer-motion";
import { DangerConfirmModal } from "../components/RemoveConfirmModals";
import {
  FileDown,
  CalendarDays,
  FilePlus2,
  Loader2,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Search,
  Settings2,
  Trash2,
  History,
  Wallet,
} from "lucide-react";
import { BackLink, SearchClearButton } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import {
  accApi,
  type AccAging,
  type AccCustomerDetail,
  type AccCustomerRow,
  type AccDues,
} from "./accApi";
import { CustomerForm } from "./AccWholesalePage";
import { GroupChecklist, GroupPicker } from "./AccGroups";
import { Empty, PdfButton, Segmented, Sheet, errorText, inr, plural, shortDate, toast, todayInput } from "./shared";

/** Wholesale dues: who owes what, by group, ageing, and collecting payments. */

/** WhatsApp reminder text, same on the list and the customer page. */
function dueReminder(c: { name: string; balance: number }) {
  return `Namaste ${c.name} ji,\nAapka Babu Mobile Accessories me ₹${c.balance.toLocaleString("en-IN")} baaki hai.\nKripya jaldi bhugtan karein. Dhanyavaad!`;
}

/** New promised date for all of a customer's unpaid bills. */
function DueDateSheet({ customer, onClose, onSaved }: { customer: AccCustomerRow; onClose: () => void; onSaved: () => void }) {
  const current = customer.oldestOpen?.dueDate ? new Date(customer.oldestOpen.dueDate).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";
  const [date, setDate] = useState(current || todayInput(7));
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!date || busy) return;
    setBusy(true);
    try {
      const { data } = await accApi.setDueDate(customer.id, date);
      toast(`Due date set to ${shortDate(date)} · ${plural(data.bills, "bill")}`);
      onSaved();
    } catch (err) {
      toast(errorText(err), { tone: "error" });
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title="Change due date"
      subtitle={`${customer.shopName || customer.name} · ${inr(customer.balance)} due`}
      footer={
        <button type="button" className="acc-btn is-primary is-big is-block" disabled={busy || !date} onClick={() => void save()}>
          {busy ? <Loader2 className="acc-spin" /> : <CalendarDays />} Save · {date ? shortDate(date) : "pick a date"}
        </button>
      }
    >
      <p className="acc-hint">
        Now: <b>{current ? shortDate(current) : "no date set"}</b>. The new date applies to all unpaid bills.
      </p>
      <div className="acc-due-quick">
        {[7, 15, 30].map((d) => (
          <button key={d} type="button" className={clsx(date === todayInput(d) && "is-on")} onClick={() => setDate(todayInput(d))}>
            +{d} days
            <small>{shortDate(todayInput(d))}</small>
          </button>
        ))}
      </div>
      <label className="acc-field">
        <span>Or pick a date</span>
        <input type="date" value={date} min={todayInput()} onChange={(e) => setDate(e.target.value)} />
      </label>
    </Sheet>
  );
}

/** One chip that says where this customer stands: overdue, promised or how old. */
function DueStatus({ c }: { c: AccCustomerRow }) {
  if (c.balance <= 0) {
    return <span className="acc-due-chip is-ok">{c.balance < 0 ? "Advance paid" : "Settled"}</span>;
  }
  const open = c.oldestOpen;
  if (c.overdue > 0 && open && open.daysOverdue > 0) {
    return (
      <span className="acc-due-chip is-red">
        Overdue {plural(open.daysOverdue, "day")} · {inr(c.overdue)}
      </span>
    );
  }
  if (open?.dueDate) {
    const days = Math.ceil((new Date(open.dueDate).getTime() - Date.now()) / 86400000);
    return (
      <span className={clsx("acc-due-chip", days <= 1 ? "is-amber" : "is-blue")}>
        {days <= 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due on ${shortDate(open.dueDate)}`}
      </span>
    );
  }
  if (open) {
    return <span className={clsx("acc-due-chip", open.ageDays > 30 && "is-amber")}>{open.ageDays ? `${plural(open.ageDays, "day")} old` : "Billed today"}</span>;
  }
  return null;
}

type Status = "due" | "overdue" | "all";
type Sort = "balance" | "oldest" | "name" | "recent";

export function AccDuesPage() {
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [sort, setSort] = useState<Sort>("balance");
  const [q, setQ] = useState("");
  const [data, setData] = useState<AccDues | null>(null);
  const [paying, setPaying] = useState<AccCustomerRow | null>(null);
  const [dating, setDating] = useState<AccCustomerRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const navigate = useNavigate();

  const load = () =>
    accApi
      .dues({ groupId, status, sort, q: q.trim() })
      .then(({ data }) => setData(data))
      .catch((err) => toast(errorText(err), { tone: "error" }));

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, status, sort, q]);

  const t = data?.totals;

  return (
    <div className="acc-page">
      <div className="acc-title-row">
        <h1>Dues</h1>
        <div className="acc-head-actions">
          <button type="button" className="acc-icon-btn" onClick={() => setPdfOpen(true)} aria-label="Download or share dues" title="Download or share">
            <FileDown />
          </button>
          <button type="button" className="acc-btn is-primary" onClick={() => navigate("/acc/dues/old")}>
            <History /> Old dues
          </button>
        </div>
      </div>

      <div className="acc-kpis is-dues">
        <div className="is-main">
          <small>Outstanding</small>
          <b>{t ? inr(t.outstanding) : "…"}</b>
          <em>{plural(t?.customers ?? 0, "customer")}</em>
        </div>
        <div>
          <small>Overdue</small>
          <b className="is-red">{t ? inr(t.overdue) : "…"}</b>
          <em>past promised date</em>
        </div>
      </div>
      {t ? <AgingBar aging={t.aging} /> : null}

      <div className="acc-group-filter">
        <GroupPicker
          mode="filter"
          value={groupId || null}
          onChange={(id) => setGroupId(id || "")}
        />
        <button type="button" className="acc-icon-btn" onClick={() => navigate("/acc/settings")} aria-label="Manage groups" title="Manage groups">
          <Settings2 />
        </button>
      </div>

      <label className="acc-search">
        <Search aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, shop, city…" />
        <SearchClearButton visible={Boolean(q)} onClear={() => setQ("")} />
      </label>
      <div className="acc-filter-row">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All" },
            { value: "due", label: "Due" },
            { value: "overdue", label: "Overdue" },
          ]}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="balance">Highest due</option>
          <option value="oldest">Oldest bill</option>
          <option value="recent">Recent bill</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      {!data ? (
        <div className="acc-loading">
          <Loader2 className="acc-spin" />
        </div>
      ) : data.customers.length ? (
        <ul className="acc-due-list">
          {/* Overdue customers first, then the rest (sort order kept within each). */}
          {[...data.customers]
            // "Due" = has a balance but not yet overdue; overdue ones are under "Overdue".
            .filter((c) => status !== "due" || c.overdue <= 0)
            .sort((a, b) => Number(b.overdue > 0) - Number(a.overdue > 0))
            .map((c) => {
            const limitPct = c.creditLimit > 0 ? Math.round((Math.max(c.balance, 0) / c.creditLimit) * 100) : 0;
            return (
              <li key={c.id} className={clsx("acc-due-card", c.overdue > 0 && "is-overdue")}>
                <button type="button" className="acc-due-main" onClick={() => navigate(`/acc/dues/${c.id}`)}>
                  <span className="acc-avatar" style={{ ["--g" as string]: c.group?.color || "#94a3b8" }}>
                    {(c.shopName || c.name).slice(0, 1).toUpperCase()}
                  </span>
                  {/* Shop name big and bold; the person's name small under it. */}
                  <span className="acc-row-text acc-due-who">
                    <strong>{c.shopName || c.name}</strong>
                    <small>{[c.shopName ? c.name : "", c.city].filter(Boolean).join(" · ") || c.phone}</small>
                  </span>
                  <span className="acc-row-amt">
                    <b className={clsx(c.balance > 0 ? "is-red" : c.balance < 0 && "is-green")}>
                      {c.balance < 0 ? inr(-c.balance) : inr(c.balance)}
                    </b>
                    <small>{c.openBillCount ? plural(c.openBillCount, "open bill") : plural(c.billCount, "bill")}</small>
                  </span>
                </button>
                <div className="acc-due-status">
                  {c.balance > 0 ? (
                    <button type="button" className="acc-due-chip-btn" onClick={() => setDating(c)} title="Change due date">
                      <DueStatus c={c} />
                      <CalendarDays aria-hidden />
                    </button>
                  ) : (
                    <DueStatus c={c} />
                  )}
                  {c.group ? (
                    <span className="acc-due-group" style={{ ["--g" as string]: c.group.color }}>
                      <i className="acc-dot" /> {c.group.name}
                    </span>
                  ) : null}
                  {c.creditLimit > 0 ? (
                    <span className={clsx("acc-credit", limitPct >= 100 && "is-over")} title={`Credit limit ${inr(c.creditLimit)}`}>
                      <span>
                        <i style={{ width: `${Math.min(100, limitPct)}%` }} />
                      </span>
                      <em>{limitPct}% of limit</em>
                    </span>
                  ) : null}
                </div>
                {c.balance > 0 ? (
                  <div className="acc-due-actions">
                    <a href={`tel:${c.phone}`}>
                      <Phone /> Call
                    </a>
                    <a href={`https://wa.me/91${c.phone}?text=${encodeURIComponent(dueReminder(c))}`} target="_blank" rel="noreferrer">
                      <MessageCircle /> Remind
                    </a>
                    <button type="button" className="is-primary" onClick={() => setPaying(c)}>
                      <Wallet /> Receive
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty title={status === "all" ? "No customers yet" : "No dues here"}>
          <Link to="/acc/wholesale" className="acc-btn is-ghost">
            <FilePlus2 /> New wholesale bill
          </Link>
        </Empty>
      )}

      <PaymentSheet
        customer={paying}
        onClose={() => setPaying(null)}
        onSaved={() => {
          setPaying(null);
          void load();
        }}
      />

      {dating ? (
        <DueDateSheet
          customer={dating}
          onClose={() => setDating(null)}
          onSaved={() => {
            setDating(null);
            void load();
          }}
        />
      ) : null}

      <Sheet open={adding} onClose={() => setAdding(false)} title="New customer">
        <CustomerForm
          onSaved={(id) => {
            setAdding(false);
            navigate(`/acc/dues/${id}`);
          }}
          onUseExisting={(c) => {
            setAdding(false);
            navigate(`/acc/dues/${c.id}`);
          }}
          onCancel={() => setAdding(false)}
        />
      </Sheet>


      <DuesPdfSheet open={pdfOpen} onClose={() => setPdfOpen(false)} initialGroup={groupId} initialStatus={status} sort={sort} />
    </div>
  );
}

export function AgingBar({ aging }: { aging: AccAging }) {
  const parts = [
    { key: "d0_30", label: "0–30 d", value: aging.d0_30, tone: "a" },
    { key: "d31_60", label: "31–60 d", value: aging.d31_60, tone: "b" },
    { key: "d61_90", label: "61–90 d", value: aging.d61_90, tone: "c" },
    { key: "d90p", label: "90+ d", value: aging.d90p, tone: "d" },
  ];
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) return null;
  return (
    <div className="acc-aging">
      <div className="acc-aging-bar" role="img" aria-label="Dues by age">
        {parts.map((p) =>
          p.value > 0 ? <span key={p.key} className={`is-${p.tone}`} style={{ flexGrow: p.value }} title={`${p.label}: ${inr(p.value)}`} /> : null,
        )}
      </div>
      <div className="acc-aging-legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i className={`is-${p.tone}`} />
            {p.label} <b>{inr(p.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function DuesPdfSheet({
  open,
  onClose,
  initialGroup,
  initialStatus,
  sort,
}: {
  open: boolean;
  onClose: () => void;
  initialGroup: string;
  initialStatus: Status;
  sort: Sort;
}) {
  const [groupIds, setGroupIds] = useState<string[]>(initialGroup ? [initialGroup] : []);
  useEffect(() => {
    if (open) {
      setGroupIds(initialGroup ? [initialGroup] : []);
    }
  }, [open, initialGroup, initialStatus, sort]);
  const pdfQuery = { groupIds: groupIds.join(","), status: initialStatus, sort };
  return (
    <Sheet open={open} onClose={onClose} title="Dues PDF" subtitle="Create a clear collection list for staff">
      <div className="acc-field">
        <span>Which groups?</span>
        <GroupChecklist values={groupIds} onChange={setGroupIds} />
      </div>
      <p className="acc-hint">The PDF is grouped automatically and shows each customer’s total paid and pending due.</p>
      <PdfButton
        className="is-block has-action-labels"
        actionLabels
        onDownload={() => accApi.pdf.dues(pdfQuery)}
        onShare={() => accApi.sharePdf.dues(pdfQuery)}
      />
    </Sheet>
  );
}

export function PaymentSheet({
  customer,
  onClose,
  onSaved,
}: {
  customer: Pick<AccCustomerRow, "id" | "name" | "balance"> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [date, setDate] = useState(todayInput());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (customer) {
      setAmount("");
      setMethod("CASH");
      setDate(todayInput());
    }
  }, [customer]);

  if (!customer) return null;
  const n = Number(amount) || 0;

  async function save() {
    if (!(n > 0) || busy) return;
    setBusy(true);
    try {
      const { data } = await accApi.receivePayment(customer!.id, { amount: n, method, paidAt: date });
      toast(`Received ${inr(n)} · balance ${inr(data.balance)}`);
      onSaved();
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Receive from ${customer.name}`}
      subtitle={`Balance ${inr(customer.balance)}`}
      footer={
        <button type="button" className="acc-btn is-primary is-big is-block" onClick={() => void save()} disabled={busy || !(n > 0)}>
          {busy ? <Loader2 className="acc-spin" /> : <Wallet />} Receive {inr(n)}
        </button>
      }
    >
      <label className="acc-amount is-wide">
        <span>₹</span>
        <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" autoFocus />
      </label>
      <div className="acc-chips">
        {customer.balance > 0 ? (
          <button type="button" className="acc-chip" onClick={() => setAmount(String(customer.balance))}>
            Full {inr(customer.balance)}
          </button>
        ) : null}
        {[500, 1000, 2000, 5000].filter((v) => v < customer.balance).map((v) => (
          <button key={v} type="button" className="acc-chip" onClick={() => setAmount(String(v))}>
            {inr(v)}
          </button>
        ))}
      </div>
      <Segmented
        value={method}
        onChange={setMethod}
        options={[
          { value: "CASH", label: "Cash" },
          { value: "UPI", label: "UPI" },
        ]}
      />
      <label className="acc-field">
        <span>Date</span>
        <input type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
      </label>
      {n > 0 ? <p className="acc-hint">Balance after: {inr(customer.balance - n)}</p> : null}
    </Sheet>
  );
}


/* ---------------- customer detail ---------------- */

export function AccCustomerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [data, setData] = useState<AccCustomerDetail | null>(null);
  const [tab, setTab] = useState<"ledger" | "open" | "items">("ledger");
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteCustomer() {
    if (!data || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await accApi.deleteCustomer(data.id);
      toast(`${data.name} deleted`);
      navigate("/acc/dues", { replace: true });
    } catch (err) {
      setDeleteError(errorText(err));
      setDeleting(false);
    }
  }

  const load = () =>
    accApi
      .customer(id!)
      .then(({ data }) => setData(data))
      .catch((err) => toast(errorText(err), { tone: "error" }));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!data) {
    return (
      <div className="acc-page">
        <BackLink to="/acc/dues" historyBack>Dues</BackLink>
        <div className="acc-loading">
          <Loader2 className="acc-spin" />
        </div>
      </div>
    );
  }

  const reminder = dueReminder(data);

  // Wholesale bills open on their own page.
  const openSale = (saleId: string) => navigate(`/acc/sales/${saleId}`);

  return (
    <div className="acc-page acc-customer-ledger-page">
      <BackLink to="/acc/dues" historyBack>Dues</BackLink>
      <header className="acc-customer-account-header">
        <div className="acc-customer-account-title">
          <small>Customer account</small>
          <div>
            <h1>{data.name}</h1>
            <span className={clsx("acc-status", data.balance > 0 ? "is-red" : "is-green")}>
              {data.balance > 0 ? `${inr(data.balance)} due` : data.balance < 0 ? `${inr(-data.balance)} advance` : "Account clear"}
            </span>
          </div>
          <p>
            {[data.shopName, data.city].filter(Boolean).join(" · ") || data.phone}
            {data.group ? ` · ${data.group.name}` : ""}
          </p>
        </div>
        <div className="acc-action-row acc-customer-account-actions">
          <button type="button" className="acc-btn is-ghost" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </button>
          <PdfButton actionLabels className="has-action-labels" onDownload={() => accApi.pdf.statement(data.id)} onShare={() => accApi.sharePdf.statement(data.id)} />
          <a className="acc-btn is-ghost" href={`tel:${data.phone}`} aria-label="Call">
            <Phone /> Call
          </a>
          <a
            className="acc-btn is-ghost"
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/91${data.phone}?text=${encodeURIComponent(reminder)}`}
            aria-label="WhatsApp reminder"
          >
            <MessageCircle /> WhatsApp
          </a>
          <button type="button" className="acc-btn is-primary acc-act-main" onClick={() => setPaying(true)}>
            <Wallet /> Receive
          </button>
          {isAdmin ? (
            <button type="button" className="acc-btn is-danger acc-act-main" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete
            </button>
          ) : (
            <button type="button" className="acc-btn acc-act-main" onClick={() => navigate("/acc/wholesale", { state: { customerId: data.id } })}>
              <FilePlus2 /> New bill
            </button>
          )}
        </div>
      </header>

      <div className="acc-customer-account-layout">
        <main className="acc-customer-account-main">
          <section className="acc-customer-contact-section">
            <span className="acc-avatar is-big" style={{ ["--g" as string]: data.group?.color || "#94a3b8" }}>
              {data.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <small>Customer details</small>
              <strong>{data.shopName || data.name}</strong>
              <a href={`tel:${data.phone}`}><Phone /> {data.phone}</a>
              {[data.address, data.city].filter(Boolean).length ? (
                <span><MapPin /> {[data.address, data.city].filter(Boolean).join(", ")}</span>
              ) : null}
            </div>
          </section>

          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "ledger", label: "Ledger" },
              { value: "open", label: `Unpaid (${data.openBills.length})` },
              { value: "items", label: "Top items" },
            ]}
          />

      {tab === "ledger" ? (
        data.ledger.length ? (
          <section className="acc-ledger-panel">
            <div className="acc-ledger-guide">
              <span className="is-debit"><i className="acc-ledger-guide-mark">DR</i> <b>Debit</b> = bill amount added</span>
              <span className="is-credit"><i className="acc-ledger-guide-mark">CR</i> <b>Credit</b> = payment received</span>
            </div>
            <div className="acc-ledger-head" aria-hidden>
              <span>Date</span>
              <span>Details</span>
              <span>Debit</span>
              <span>Credit</span>
              <span>Balance</span>
              <span />
            </div>
            <ul className="acc-ledger acc-ledger-statement">
              {data.ledger.map((line) => (
                <li key={line.id} className={line.kind === "BILL" ? "is-bill" : "is-pay"}>
                  <button
                    type="button"
                    className="acc-ledger-entry"
                    onClick={() => (line.saleId && line.kind === "BILL" ? openSale(line.saleId) : undefined)}
                    disabled={!(line.saleId && line.kind === "BILL")}
                  >
                    <span className="acc-ledger-date">{shortDate(line.date)}</span>
                    <span className="acc-ledger-detail">
                      <span className="acc-ledger-kind-icon">{line.kind === "BILL" ? "BILL" : "PAY"}</span>
                      <span>
                        <strong>{line.kind === "BILL" ? line.ref : line.detail.split(" · ")[0]}</strong>
                        <small>{line.kind === "BILL" ? line.detail : line.detail.split(" · ").slice(1).join(" · ") || line.ref}</small>
                        {line.kind === "BILL" && line.transportCharge ? (
                          <em className="acc-ledger-transport">Transport {inr(line.transportCharge)}</em>
                        ) : null}
                      </span>
                    </span>
                    <span className="acc-ledger-money is-debit">
                      <small>Bill added</small>
                      <b>{line.debit ? inr(line.debit) : "—"}</b>
                    </span>
                    <span className={clsx("acc-ledger-money is-credit", line.credit > 0 && "has-value")}>
                      <small>Payment received</small>
                      <b>{line.credit ? inr(line.credit) : "—"}</b>
                    </span>
                    <span className="acc-ledger-money is-balance">
                      <small>{line.balance < 0 ? "Advance" : "Balance"}</small>
                      <b className={clsx(line.balance > 0 ? "is-red" : "is-green")}>{inr(Math.abs(line.balance))}</b>
                    </span>
                  </button>
                  {isAdmin && line.kind === "PAYMENT" && !line.saleId ? (
                    <button
                      type="button"
                      className="acc-icon-btn is-small acc-ledger-delete"
                      aria-label="Delete payment"
                      onClick={async () => {
                        if (!window.confirm(`Delete this payment of ${inr(line.credit)}?`)) return;
                        try {
                          await accApi.deletePayment(line.id);
                          toast("Payment deleted");
                          void load();
                        } catch (err) {
                          toast(errorText(err), { tone: "error" });
                        }
                      }}
                    >
                      <Trash2 />
                    </button>
                  ) : <span className="acc-ledger-action-space" />}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <Empty title="No bills yet" />
        )
      ) : tab === "open" ? (
        data.openBills.length ? (
          <ul className="acc-list">
            {data.openBills.map((b) => (
              <li key={b.saleId} className="acc-row">
                <button type="button" className="acc-row-main" onClick={() => openSale(b.saleId)}>
                  <span className="acc-row-text">
                    <strong>{b.number}</strong>
                    <small>
                      {shortDate(b.saleDate)} · {b.ageDays} days old
                      {b.dueDate ? ` · pay by ${shortDate(b.dueDate)}` : ""}
                      {b.transportCharge ? ` · transport ${inr(b.transportCharge)}` : ""}
                    </small>
                  </span>
                  <span className="acc-row-amt">
                    <b className="is-red">{inr(b.open)}</b>
                    <small className={clsx(b.daysOverdue > 0 && "is-red")}>
                      {b.daysOverdue > 0 ? `${b.daysOverdue}d overdue` : `of ${inr(b.total)}`}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="All bills are paid" />
        )
      ) : data.topItems.length ? (
        <ul className="acc-moves">
          {data.topItems.map((item) => (
            <li key={item.name}>
              <span>
                <strong>{item.name}</strong>
                <small>{item.qty} pcs</small>
              </span>
              <b>{inr(item.amount)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Nothing bought yet" />
      )}
        </main>

        <aside className="acc-customer-account-summary">
          <div className="acc-customer-account-balance">
            <small>{data.balance < 0 ? "Advance available" : "Current balance"}</small>
            <strong className={clsx(data.balance > 0 ? "is-red" : "is-green")}>
              {data.balance < 0 ? inr(-data.balance) : inr(data.balance)}
            </strong>
            <span>{data.balance > 0 ? "Customer has to pay you" : data.balance < 0 ? "Available for future bills" : "Nothing is pending"}</span>
          </div>
          <div className="acc-customer-account-totals">
            <div><span>Total billed</span><b>{inr(data.billed)}</b></div>
            <div><span>Total received</span><b className="is-green">{inr(data.paid)}</b></div>
            <div><span>Overdue</span><b className={clsx(data.overdue > 0 && "is-red")}>{inr(data.overdue)}</b></div>
            <div><span>Wholesale bills</span><b>{data.billCount}</b></div>
          </div>
          {data.creditLimit > 0 ? (
            <div className={clsx("acc-customer-credit-limit", data.balance > data.creditLimit && "is-over")}>
              <span>Credit limit</span>
              <b>{inr(data.creditLimit)}</b>
              {data.balance > data.creditLimit ? <small>Limit exceeded by {inr(data.balance - data.creditLimit)}</small> : null}
            </div>
          ) : null}
          <button type="button" className="acc-btn is-primary is-block" onClick={() => setPaying(true)}>
            <Wallet /> Receive payment
          </button>
        </aside>
      </div>

      <PaymentSheet
        customer={paying ? data : null}
        onClose={() => setPaying(false)}
        onSaved={() => {
          setPaying(false);
          void load();
        }}
      />

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit customer">
        <CustomerForm
          id={data.id}
          initial={{
            name: data.name,
            phone: data.phone,
            shopName: data.shopName,
            city: data.city,
            address: data.address,
            gstin: data.gstin,
            groupId: data.groupId,
            creditLimit: data.creditLimit,
            note: data.note,
          }}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
          onCancel={() => setEditing(false)}
        />
      </Sheet>


      <AnimatePresence>
        {confirmDelete ? (
          <DangerConfirmModal
            title="Delete customer?"
            subtitle={data.name}
            points={[
              `${plural(data.billCount, "bill")} (including old dues) and all payments of this customer are removed.`,
              ...(data.balance > 0 ? [`Their pending due of ${inr(data.balance)} is removed from Dues.`] : []),
              "Stock is not added back.",
            ]}
            cancelLabel="Keep customer"
            working={deleting}
            error={deleteError}
            onCancel={() => !deleting && setConfirmDelete(false)}
            onConfirm={() => void deleteCustomer()}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
