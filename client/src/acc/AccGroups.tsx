import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import clsx from "clsx";
import { DangerConfirmModal } from "../components/RemoveConfirmModals";
import { Check, ChevronDown, ChevronRight, FolderTree, Loader2, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import { accApi, type AccGroup } from "./accApi";
import { Sheet, errorText, plural, toast } from "./shared";

/*
 * Customer groups as a two-level tree: main groups, each with sub groups.
 * One cached list for every screen; a searchable picker for forms and the
 * tree editor used on the Settings page.
 */

export const GROUP_COLORS = ["#5d73b6", "#0ea5e9", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#db2777", "#0f766e"];

let cache: AccGroup[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function refreshGroups() {
  if (loading) return loading;
  loading = accApi
    .groups()
    .then(({ data }) => {
      cache = data;
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
      listeners.forEach((fn) => fn());
    });
  return loading;
}

export function useGroups() {
  const groups = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => cache,
  );
  useEffect(() => {
    void refreshGroups();
  }, []);
  return groups ?? [];
}

export type GroupNode = AccGroup & { subs: AccGroup[] };

/** Colour for a new main group: the palette colour used least so far. */
function nextColor(mains: AccGroup[]) {
  const used = (c: string) => mains.filter((m) => m.color.toLowerCase() === c.toLowerCase()).length;
  const least = Math.min(...GROUP_COLORS.map(used));
  const options = GROUP_COLORS.filter((c) => used(c) === least);
  return options[Math.floor(Math.random() * options.length)];
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Main groups A→Z, each with its sub groups A→Z. */
export function groupTree(groups: AccGroup[]): GroupNode[] {
  const mains = groups.filter((g) => !g.parentId || !groups.some((p) => p.id === g.parentId));
  return mains
    .map((m) => ({ ...m, subs: groups.filter((g) => g.parentId === m.id).sort((a, b) => collator.compare(a.name, b.name)) }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/** "MAIN › Sub" for a picked group. */
export function groupLabel(groups: AccGroup[], id: string | null | undefined) {
  if (!id) return "";
  const g = groups.find((x) => x.id === id);
  if (!g) return "";
  const parent = g.parentId ? groups.find((x) => x.id === g.parentId) : null;
  return parent ? `${parent.name} › ${g.name}` : g.name;
}

/** Tree rows shared by the dropdown and the PDF checklist. */
function GroupRows({
  tree,
  needle,
  isOn,
  onPick,
  check,
}: {
  tree: GroupNode[];
  needle: string;
  isOn: (id: string) => boolean;
  onPick: (id: string) => void;
  check?: boolean;
}) {
  const shown = tree
    .map((m) => {
      const mainHit = m.name.toLowerCase().includes(needle);
      const subs = needle ? m.subs.filter((s) => mainHit || s.name.toLowerCase().includes(needle)) : m.subs;
      return mainHit || subs.length ? { ...m, subs } : null;
    })
    .filter(Boolean) as GroupNode[];
  const mark = <b className={clsx("acc-gp-radio", check && "is-check")} aria-hidden />;
  return (
    <>
      {shown.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            className={clsx("acc-gp-main", isOn(m.id) && "is-on")}
            style={{ ["--g" as string]: m.color }}
            onClick={() => onPick(m.id)}
          >
            <i className="acc-dot" />
            <span>{m.name}</span>
            {m.subs.length ? <em>{m.subs.length} sub</em> : null}
            {mark}
          </button>
          {m.subs.length ? (
            <ul className="acc-gp-subs" style={{ ["--g" as string]: m.color }}>
              {m.subs.map((s) => (
                <li key={s.id}>
                  <button type="button" className={clsx(isOn(s.id) && "is-on")} onClick={() => onPick(s.id)}>
                    <span>{s.name}</span>
                    {mark}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
      {!shown.length ? <li className="acc-hint">No group matches.</li> : null}
    </>
  );
}

/**
 * Searchable group dropdown: main groups in capitals, sub groups under
 * them. "pick" (forms): No group + any group. "filter" (lists): All groups,
 * any group, No group ("none").
 */
export function GroupPicker({
  value,
  onChange,
  mode = "pick",
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  mode?: "pick" | "filter";
}) {
  const groups = useGroups();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const tree = useMemo(() => groupTree(groups), [groups]);
  const selected = value && value !== "none" ? groups.find((g) => g.id === value) || null : null;
  const color = selected ? (selected.parentId ? groups.find((g) => g.id === selected.parentId)?.color : selected.color) : undefined;
  const needle = q.trim().toLowerCase();
  const filter = mode === "filter";

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
    setQ("");
  }

  const label = selected
    ? groupLabel(groups, selected.id)
    : value === "none"
      ? "No group"
      : filter
        ? "All groups"
        : "Choose group";

  return (
    <>
      <button type="button" className={clsx("acc-gp-trigger", (selected || value === "none" || filter) && "has-value")} onClick={() => setOpen(true)}>
        {selected ? <i className="acc-dot" style={{ background: color }} /> : <FolderTree />}
        <span>{label}</span>
        <ChevronDown />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={filter ? "Show group" : "Choose group"}>
        <label className="acc-search is-in-card">
          <Search aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search groups…" autoFocus />
        </label>
        <p className="acc-gp-hint">Pick a main group, or one of its sub groups.</p>
        <ul className="acc-gp-list">
          {!needle ? (
            <li>
              <button type="button" className={clsx("acc-gp-none", !value && "is-on")} onClick={() => pick(null)}>
                <span>{filter ? "All groups" : "No group"}</span>
                <b className="acc-gp-radio" aria-hidden />
              </button>
            </li>
          ) : null}
          {filter && !needle ? (
            <li>
              <button type="button" className={clsx("acc-gp-none", value === "none" && "is-on")} onClick={() => pick("none")}>
                <span>No group</span>
                <b className="acc-gp-radio" aria-hidden />
              </button>
            </li>
          ) : null}
          <GroupRows tree={tree} needle={needle} isOn={(id) => value === id} onPick={pick} />
        </ul>
        <Link to="/acc/settings" className="acc-link-btn" onClick={() => setOpen(false)}>
          <Plus /> Add or edit groups in Settings
        </Link>
      </Sheet>
    </>
  );
}

/** Tick several groups (PDF of dues); none ticked = all groups. */
export function GroupChecklist({
  values,
  onChange,
}: {
  values: string[];
  onChange: (ids: string[]) => void;
}) {
  const groups = useGroups();
  const tree = useMemo(() => groupTree(groups), [groups]);
  const [q, setQ] = useState("");
  const toggle = (id: string) => onChange(values.includes(id) ? values.filter((x) => x !== id) : [...values, id]);
  return (
    <div className="acc-gp-checklist">
      {groups.length > 6 ? (
        <label className="acc-search is-in-card">
          <Search aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search groups…" />
        </label>
      ) : null}
      <ul className="acc-gp-list">
        <li>
          <button type="button" className={clsx("acc-gp-none", !values.length && "is-on")} onClick={() => onChange([])}>
            <span>All groups</span>
            <b className="acc-gp-radio is-check" aria-hidden />
          </button>
        </li>
        {!q.trim() ? (
          <li>
            <button type="button" className={clsx("acc-gp-none", values.includes("none") && "is-on")} onClick={() => toggle("none")}>
              <span>No group</span>
              <b className="acc-gp-radio is-check" aria-hidden />
            </button>
          </li>
        ) : null}
        <GroupRows tree={tree} needle={q.trim().toLowerCase()} isOn={(id) => values.includes(id)} onPick={toggle} check />
      </ul>
    </div>
  );
}

/** Settings: the group tree, with add / rename / delete at both levels. */
export function GroupTreeManager() {
  const groups = useGroups();
  const tree = useMemo(() => groupTree(groups), [groups]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newMain, setNewMain] = useState("");
  const [subDraft, setSubDraft] = useState("");
  const [editing, setEditing] = useState<AccGroup | null>(null);
  const [busy, setBusy] = useState(false);
  /** Group waiting for the delete confirmation (with its sub group count). */
  const [removing, setRemoving] = useState<{ group: AccGroup; subs: number; customers: number } | null>(null);

  useEffect(() => {
    if (!openId && tree.length) setOpenId(tree[0].id);
  }, [openId, tree]);

  async function run(work: () => Promise<unknown>, done: string) {
    if (busy) return false;
    setBusy(true);
    try {
      await work();
      await refreshGroups();
      toast(done);
      return true;
    } catch (err) {
      toast(errorText(err), { tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addMain() {
    const name = newMain.trim();
    if (!name) return;
    let id = "";
    const ok = await run(async () => {
      id = (await accApi.createGroup({ name, color: nextColor(tree) })).data.id;
    }, `Main group “${name}” added`);
    if (ok) {
      setNewMain("");
      setOpenId(id);
    }
  }

  async function addSub(main: GroupNode) {
    const name = subDraft.trim();
    if (!name) return;
    const ok = await run(() => accApi.createGroup({ name, color: main.color, parentId: main.id }), `Sub group “${name}” added`);
    if (ok) setSubDraft("");
  }

  async function confirmRemove() {
    if (!removing) return;
    const ok = await run(() => accApi.deleteGroup(removing.group.id), `${removing.group.name} deleted`);
    if (ok) {
      if (openId === removing.group.id) setOpenId(null);
      setRemoving(null);
    }
  }

  const customersIn = (m: GroupNode) => m.customerCount + m.subs.reduce((a, s) => a + s.customerCount, 0);

  return (
    <div className="acc-gt">
      <form
        className="acc-gt-new"
        onSubmit={(e) => {
          e.preventDefault();
          void addMain();
        }}
      >
        <Plus className="acc-gt-new-icon" />
        <input className="bg-transparent" value={newMain} onChange={(e) => setNewMain(e.target.value)} placeholder="New main group, e.g. Balaghat city" />
        <button type="submit" className="acc-btn is-primary" disabled={busy || !newMain.trim()}>
          <Plus /> Add
        </button>
      </form>

      {tree.length ? (
        <ul className="acc-gt-mains">
          {tree.map((m) => {
            const open = openId === m.id;
            return (
              <li key={m.id} className={clsx("acc-gt-main", open && "is-open")} style={{ ["--g" as string]: m.color }}>
                <div className="acc-gt-row">
                  <button type="button" className="acc-gt-head" onClick={() => setOpenId(open ? null : m.id)} aria-expanded={open}>
                    <span className="acc-gt-badge">{m.name.slice(0, 1).toUpperCase()}</span>
                    <span className="acc-gt-title">
                      <strong>{m.name}</strong>
                      <small>
                        {plural(m.subs.length, "sub group")} · <Users /> {customersIn(m)}
                      </small>
                    </span>
                    <ChevronRight className="acc-gt-chev" />
                  </button>
                  <span className="acc-gt-tools">
                    <button type="button" className="acc-gt-tool" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`} title="Edit name">
                      <Pencil />
                    </button>
                    <button
                      type="button"
                      className="acc-gt-tool is-red"
                      onClick={() => setRemoving({ group: m, subs: m.subs.length, customers: customersIn(m) })}
                      aria-label={`Delete ${m.name}`}
                      title="Delete group"
                    >
                      <Trash2 />
                    </button>
                  </span>
                </div>

                {open ? (
                  <div className="acc-gt-body">
                    <ul className="acc-gt-tree">
                      {m.subs.map((s) => (
                        <li key={s.id}>
                          <span className="acc-gt-node">
                            <strong>{s.name}</strong>
                            <small>{plural(s.customerCount, "customer")}</small>
                          </span>
                          <span className="acc-gt-tools">
                            <button type="button" className="acc-gt-tool" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`} title="Edit name">
                              <Pencil />
                            </button>
                            <button
                              type="button"
                              className="acc-gt-tool is-red"
                              onClick={() => setRemoving({ group: s, subs: 0, customers: s.customerCount })}
                              aria-label={`Delete ${s.name}`}
                              title="Delete group"
                            >
                              <Trash2 />
                            </button>
                          </span>
                        </li>
                      ))}
                      <li className="is-add">
                        <form
                          className="acc-gt-addsub"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void addSub(m);
                          }}
                        >
                          <input className="bg-transparent" value={subDraft} onChange={(e) => setSubDraft(e.target.value)} placeholder={`Add sub group in ${m.name}`} />
                          <button type="submit" className="acc-btn is-small" disabled={busy || !subDraft.trim()}>
                            {busy ? <Loader2 className="acc-spin" /> : <Plus />} Add
                          </button>
                        </form>
                      </li>
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="acc-hint">No groups yet. Add a main group above, then open it to add sub groups.</p>
      )}

      <GroupEditSheet group={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />

      <AnimatePresence>
        {removing ? (
          <DangerConfirmModal
            title={removing.group.parentId ? "Delete sub group?" : "Delete main group?"}
            subtitle={removing.group.name}
            points={[
              ...(removing.subs ? [`Its ${plural(removing.subs, "sub group")} are deleted too.`] : []),
              removing.customers
                ? `${plural(removing.customers, "customer")} ${removing.customers === 1 ? "stays" : "stay"}, just without a group. Bills and dues are not touched.`
                : "No customers are in this group.",
            ]}
            confirmLabel="Delete group"
            cancelLabel="Keep group"
            working={busy}
            onCancel={() => !busy && setRemoving(null)}
            onConfirm={() => void confirmRemove()}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function GroupEditSheet({ group, onClose, onSaved }: { group: AccGroup | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (group) {
      setName(group.name);
    }
  }, [group]);
  if (!group) return null;

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await accApi.updateGroup(group!.id, { name: name.trim(), color: group!.color });
      await refreshGroups();
      toast("Group saved");
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
      title={group.parentId ? "Edit sub group" : "Edit main group"}
      footer={
        <div className="acc-btn-row">
          <button type="button" className="acc-btn is-ghost" onClick={onClose}>
            <X /> Cancel
          </button>
          <button type="button" className="acc-btn is-primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            <Check /> Save
          </button>
        </div>
      }
    >
      <label className="acc-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
    </Sheet>
  );
}
