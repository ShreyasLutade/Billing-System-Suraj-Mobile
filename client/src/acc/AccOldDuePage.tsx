import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import { BackLink } from "../components/ui";
import { accApi } from "./accApi";
import { GroupPicker } from "./AccGroups";
import { errorText, inr, toast } from "./shared";

/**
 * Old dues from Tally: name, mobile, pending amount and (optionally) the
 * date it is due. Saved as an opening balance on the customer, so it shows
 * in Dues and is cleared by Receive like any bill. Stays open for the next.
 */
export function AccOldDuePage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [shopName, setShopName] = useState("");
  const [address, setAddress] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Array<{ id: string; customerId: string; name: string; amount: number }>>([]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const value = Number(amount);
      const { data } = await accApi.addOldDue({
        name: name.trim(),
        phone,
        amount: value,
        dueDate: dueDate || undefined,
        shopName: shopName.trim(),
        address: address.trim(),
        groupId,
      });
      toast(`Saved ${inr(value)} due for ${name.trim()}`);
      setAdded((list) => [{ id: data.id, customerId: data.customerId, name: name.trim(), amount: value }, ...list]);
      setName("");
      setPhone("");
      setAmount("");
      setDueDate("");
      setShopName("");
      setAddress("");
      // Group stays picked: old dues are usually typed in one area at a time.
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acc-page acc-reset-page">
      <BackLink to="/acc/dues" historyBack>
        Dues
      </BackLink>
      <h1 className="acc-h1">Old dues</h1>
      <p className="acc-hint">
        Enter pending amounts from Tally. Same mobile number = same customer (an existing customer's due is added to theirs).
      </p>

      <form className="acc-card acc-form" onSubmit={save}>
        <label className="acc-field">
          <span>Name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label className="acc-field">
          <span>Mobile number *</span>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={13} required />
        </label>
        <label className="acc-field">
          <span>Shop name</span>
          <input value={shopName} onChange={(e) => setShopName(e.target.value)} />
        </label>
        <label className="acc-field">
          <span>Address</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <div className="acc-field">
          <span>Group</span>
          <GroupPicker value={groupId} onChange={setGroupId} />
        </div>
        <div className="acc-form-grid">
          <label className="acc-field">
            <span>Total due ₹ *</span>
            <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label className="acc-field">
            <span>Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>
        <button type="submit" className="acc-btn is-primary is-big is-block" disabled={busy || !(Number(amount) > 0)}>
          {busy ? <Loader2 className="acc-spin" /> : <Check />} Save old due
        </button>
      </form>

      {added.length ? (
        <section className="acc-bv-card">
          <ul className="acc-bv-pay">
            {added.map((row) => (
              <li key={row.id}>
                <Link to={`/acc/dues/${row.customerId}`}>{row.name}</Link>
                <b className="is-red">{inr(row.amount)}</b>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
