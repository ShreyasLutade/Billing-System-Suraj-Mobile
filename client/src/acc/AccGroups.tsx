import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
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

/** Searchable group dropdown: main groups in capitals, sub groups under them. */
export function GroupPicker({ value, onChange }: { value: string | null | undefined; onChange: (id: string | null) => void }) {
  const groups = useGroups();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const tree = useMemo(() => groupTree(groups), [groups]);
  const selected = groups.find((g) => g.id === value) || null;
  const color = selected ? (selected.parentId ? groups.find((g) => g.id === selected.parentId)?.color : selected.color) : undefined;

  const needle = q.trim().toLowerCase();
  const shown = tree
    .map((m) => {
      const mainHit = m.name.toLowerCase().includes(needle);
      const subs = needle ? m.subs.filter((s) => mainHit || s.name.toLowerCase().includes(needle)) : m.subs;
      return mainHit || subs.length ? { ...m, subs } : null;
    })
    .filter(Boolean) as GroupNode[];

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
    setQ("");
  }

  return (
    <>
      <button type="button" className={clsx("acc-gp-trigger", selected && "has-value")} onClick={() => setOpen(true)}>
        {selected ? <i className="acc-dot" style={{ background: color }} /> : <FolderTree />}
        <span>{selected ? groupLabel(groups, selected.id) : "Choose group"}</span>
        <ChevronDown />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Choose group">
        <label className="acc-search is-in-card">
          <Search aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search groups…" autoFocus />
        </label>
        <ul className="acc-gp-list">
          {!needle ? (
            <li>
              <button type="button" className={clsx("acc-gp-none", !value && "is-on")} onClick={() => pick(null)}>
                No group {!value ? <Check /> : null}
              </button>
            </li>
          ) : null}
          {shown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={clsx("acc-gp-main", value === m.id && "is-on")}
                style={{ ["--g" as string]: m.color }}
                onClick={() => pick(m.id)}
              >
                <i className="acc-dot" />
                <span>{m.name}</span>
                {m.subs.length ? <em>{plural(m.subs.length, "sub group")}</em> : null}
                {value === m.id ? <Check /> : null}
              </button>
              {m.subs.length ? (
                <ul className="acc-gp-subs" style={{ ["--g" as string]: m.color }}>
                  {m.subs.map((s) => (
                    <li key={s.id}>
                      <button type="button" className={clsx(value === s.id && "is-on")} onClick={() => pick(s.id)}>
                        <span>{s.name}</span>
                        {value === s.id ? <Check /> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
          {!shown.length ? <li className="acc-hint">No group matches “{q}”.</li> : null}
        </ul>
        <Link to="/acc/settings" className="acc-link-btn" onClick={() => setOpen(false)}>
          <Plus /> Add or edit groups in Settings
        </Link>
      </Sheet>
    </>
  );
}

/** Settings: the group tree, with add / rename / delete at both levels. */
export function GroupTreeManager() {
  const groups = useGroups();
  const tree = useMemo(() => groupTree(groups), [groups]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newMain, setNewMain] = useState("");
  const [newColor, setNewColor] = useState(GROUP_COLORS[1]);
  const [subDraft, setSubDraft] = useState("");
  const [editing, setEditing] = useState<AccGroup | null>(null);
  const [busy, setBusy] = useState(false);

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
      id = (await accApi.createGroup({ name, color: newColor })).data.id;
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

  async function remove(g: AccGroup, subs = 0) {
    const msg = subs
      ? `Delete main group ${g.name} and its ${plural(subs, "sub group")}? Customers stay, without a group.`
      : `Delete group ${g.name}? Customers stay, without a group.`;
    if (!window.confirm(msg)) return;
    await run(() => accApi.deleteGroup(g.id), `${g.name} deleted`);
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
        <span className="acc-gt-new-dot" style={{ background: newColor }} />
        <input className="bg-transparent" value={newMain} onChange={(e) => setNewMain(e.target.value)} placeholder="New main group, e.g. Balaghat city" />
        <button type="submit" className="acc-btn is-primary" disabled={busy || !newMain.trim()}>
          <Plus /> Add
        </button>
      </form>
      <div className="acc-color-pick">
        {GROUP_COLORS.map((c) => (
          <button key={c} type="button" className={clsx(newColor === c && "is-on")} style={{ background: c }} onClick={() => setNewColor(c)} aria-label={c} />
        ))}
      </div>

      {tree.length ? (
        <ul className="acc-gt-mains">
          {tree.map((m) => {
            const open = openId === m.id;
            return (
              <li key={m.id} className={clsx("acc-gt-main", open && "is-open")} style={{ ["--g" as string]: m.color }}>
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

                {open ? (
                  <div className="acc-gt-body">
                    <ul className="acc-gt-tree">
                      {m.subs.map((s) => (
                        <li key={s.id}>
                          <span className="acc-gt-node">
                            <strong>{s.name}</strong>
                            <small>{plural(s.customerCount, "customer")}</small>
                          </span>
                          <button type="button" className="acc-icon-btn is-small" onClick={() => setEditing(s)} aria-label={`Rename ${s.name}`}>
                            <Pencil />
                          </button>
                          <button type="button" className="acc-icon-btn is-small" onClick={() => void remove(s)} aria-label={`Delete ${s.name}`}>
                            <Trash2 />
                          </button>
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
                    <div className="acc-gt-actions">
                      <button type="button" className="acc-link-btn" onClick={() => setEditing(m)}>
                        <Pencil /> Rename / colour
                      </button>
                      <button type="button" className="acc-link-btn is-red" onClick={() => void remove(m, m.subs.length)}>
                        <Trash2 /> Delete main group
                      </button>
                    </div>
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
    </div>
  );
}

function GroupEditSheet({ group, onClose, onSaved }: { group: AccGroup | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(GROUP_COLORS[0]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (group) {
      setName(group.name);
      setColor(group.color);
    }
  }, [group]);
  if (!group) return null;

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await accApi.updateGroup(group!.id, { name: name.trim(), color });
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
      title={group.parentId ? "Rename sub group" : "Edit main group"}
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
      {!group.parentId ? (
        <div className="acc-field">
          <span>Colour</span>
          <div className="acc-color-pick">
            {GROUP_COLORS.map((c) => (
              <button key={c} type="button" className={clsx(color === c && "is-on")} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
