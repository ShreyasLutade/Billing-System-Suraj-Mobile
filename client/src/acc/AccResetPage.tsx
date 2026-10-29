import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Eraser, Loader2 } from "lucide-react";
import { BackLink } from "../components/ui";
import { accApi, type AccResetCounts } from "./accApi";
import { errorText, plural, refreshCatalog, toast } from "./shared";

/**
 * Admin: clear the accessories shop to start with real data. Only the
 * accessories shop; the mobile shop and repair desk are not touched.
 */
export function AccResetPage() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<(AccResetCounts & { confirmWord: string }) | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<AccResetCounts | null>(null);

  useEffect(() => {
    accApi
      .resetSummary()
      .then(({ data }) => setCounts(data))
      .catch((err) => toast(errorText(err), { tone: "error" }));
  }, []);

  const word = counts?.confirmWord || "DELETE";
  const ready = typed.trim().toUpperCase() === word;

  async function clearAll() {
    if (!ready || busy) return;
    if (!window.confirm("Clear ALL accessories shop data? This can't be undone from the app.")) return;
    setBusy(true);
    try {
      const { data } = await accApi.resetAll(typed);
      // This phone's unsaved cart / wholesale draft point at deleted products.
      try {
        for (const key of Object.keys(sessionStorage)) if (key.startsWith("acc.")) sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      await refreshCatalog();
      setDone(data.cleared);
      toast("Accessories data cleared");
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<[string, number]> = counts
    ? [
        ["Products (with stock & history)", counts.products],
        ["Counter sales & wholesale bills", counts.sales],
        ["Wholesale customers & groups", counts.customers],
        ["Payments received", counts.payments],
        ["Suppliers", counts.suppliers],
        ["Stock purchases", counts.purchases],
      ]
    : [];

  return (
    <div className="acc-page acc-reset-page">
      <BackLink to="/acc" historyBack>
        Counter
      </BackLink>
      <h1 className="acc-h1">Clear accessories data</h1>

      {done ? (
        <section className="acc-bv-card">
          <div className="acc-bv-result is-paid">
            <span>
              <CheckCircle2 />
              <span>
                <strong>The accessories shop is empty and ready</strong>
                <small>
                  Cleared {plural(done.products, "product")}, {plural(done.sales, "bill")}, {plural(done.customers, "customer")} and{" "}
                  {plural(done.suppliers, "supplier")}. Next bills start at AR-0001 / AW-0001.
                </small>
              </span>
            </span>
          </div>
          <button type="button" className="acc-btn is-primary is-block" onClick={() => navigate("/acc/stock/in")}>
            Add your first stock
          </button>
        </section>
      ) : (
        <>
          <section className="acc-bv-card acc-reset-warn">
            <AlertTriangle />
            <div>
              <strong>This deletes everything in the accessories shop</strong>
              <p>
                Use it once, to remove test entries before you start with real data. The <b>mobile shop</b>, the{" "}
                <b>repair desk</b> and all logins are <b>not</b> touched. Categories (Cover, Glass, Neckband…) are kept.
              </p>
            </div>
          </section>

          <section className="acc-bv-card">
            <header className="acc-bv-card-head">
              <h2>
                <Eraser /> Will be cleared
              </h2>
            </header>
            {counts ? (
              <ul className="acc-bv-pay">
                {rows.map(([label, n]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <b>{n}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="acc-loading">
                <Loader2 className="acc-spin" />
              </div>
            )}
            <p className="acc-hint">Bill numbers restart at AR-0001 / AW-0001. A backup copy is kept on the server.</p>
          </section>

          <section className="acc-bv-card">
            <label className="acc-field">
              <span>
                Type <b>{word}</b> to confirm
              </span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={word} autoCapitalize="characters" />
            </label>
            <button type="button" className="acc-btn is-danger is-big is-block" onClick={() => void clearAll()} disabled={!ready || busy}>
              {busy ? <Loader2 className="acc-spin" /> : <Eraser />} Clear all accessories data
            </button>
          </section>
        </>
      )}
    </div>
  );
}
