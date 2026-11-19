import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, FolderTree, Loader2, RotateCcw } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { BackLink } from "../components/ui";
import { GroupTreeManager } from "./AccGroups";
import { accApi } from "./accApi";
import { refreshBoxes } from "./AccCovers";
import { Sheet, errorText, refreshCatalog, toast } from "./shared";

/** Accessories settings. Customer groups: main groups and their sub groups. */
export function AccSettingsPage() {
  const { isAdmin } = useAuth();
  const [resetOpen, setResetOpen] = useState(false);
  return (
    <div className="acc-page acc-settings-page">
      <BackLink to="/acc" historyBack>
        Back
      </BackLink>
      <h1 className="acc-h1">Settings</h1>
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
