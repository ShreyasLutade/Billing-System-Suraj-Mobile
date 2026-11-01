import { FolderTree } from "lucide-react";
import { BackLink } from "../components/ui";
import { GroupTreeManager } from "./AccGroups";

/** Accessories settings. Customer groups: main groups and their sub groups. */
export function AccSettingsPage() {
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
    </div>
  );
}
