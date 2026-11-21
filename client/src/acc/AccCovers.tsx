import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useAuth } from "../auth/AuthContext";
import { Boxes, Check, FileDown, Grid3x3, Loader2, Minus, PackageOpen, PencilLine, Plus, Search, Share2, Smartphone, SquarePlus, Trash2, X } from "lucide-react";
import { BackLink } from "../components/ui";
import { accApi, type AccBox, type AccProduct } from "./accApi";
import { COMMON_PHONE_BRANDS, Sheet, errorText, patchCatalogProduct, plural, toast, useAccCatalog } from "./shared";

/*
 * Covers: segregate a cover product by phone model (stored as the
 * product's model split), keep track of which box each cover sits in, and
 * find covers for a phone at the counter.
 */

export const isCover = (p: Pick<AccProduct, "categoryName">) => /cover/i.test(p.categoryName);
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/* ---------------- shared data: boxes + phone names ---------------- */

let boxCache: AccBox[] | null = null;
let boxLoading: Promise<void> | null = null;
const boxListeners = new Set<() => void>();
/** Run a PDF download/share and show a toast if it fails. */
async function pdfRun(job: () => Promise<void>) {
  try {
    await job();
  } catch (err) {
    toast(errorText(err), { tone: "error" });
  }
}

function setBoxes(next: AccBox[]) {
  boxCache = next;
  boxListeners.forEach((l) => l());
}
export function refreshBoxes() {
  boxLoading = accApi
    .boxes()
    .then(({ data }) => setBoxes(data))
    .catch(() => undefined)
    .finally(() => {
      boxLoading = null;
    });
  return boxLoading;
}
export function useBoxes() {
  const boxes = useSyncExternalStore(
    (l) => {
      boxListeners.add(l);
      return () => boxListeners.delete(l);
    },
    () => boxCache,
  );
  useEffect(() => {
    if (!boxCache && !boxLoading) void refreshBoxes();
  }, []);
  return boxes;
}

let phoneNames: string[] | null = null;
function usePhoneNames() {
  const [names, setNames] = useState<string[]>(phoneNames ?? []);
  useEffect(() => {
    if (phoneNames) return;
    accApi
      .phoneNames()
      .then(({ data }) => {
        phoneNames = [...new Set(data.map((d) => d.name.trim()).filter(Boolean))];
        setNames(phoneNames);
      })
      .catch(() => undefined);
  }, []);
  return names;
}

/** Where each cover (product + model) sits: "productId|model" → box codes. */
function locationMap(boxes: AccBox[] | null) {
  const map = new Map<string, string[]>();
  for (const b of boxes ?? []) for (const i of b.items) {
    const key = `${i.productId}|${i.model}`;
    map.set(key, [...(map.get(key) ?? []), b.code]);
  }
  return map;
}

/** Cover stock as piles: one per segregated model, plus the not-segregated rest. */
type Pile = { key: string; product: AccProduct; model: string; qty: number };
function coverPiles(products: AccProduct[]): Pile[] {
  const piles: Pile[] = [];
  for (const p of products) {
    if (!isCover(p)) continue;
    let sorted = 0;
    for (const m of p.models) {
      sorted += m.qty;
      piles.push({ key: `${p.id}|${m.model}`, product: p, model: m.model, qty: m.qty });
    }
    const rest = Math.max(p.stockQty, 0) - sorted;
    if (rest > 0 || !p.models.length) piles.push({ key: `${p.id}|`, product: p, model: "", qty: Math.max(rest, 0) });
  }
  return piles;
}

/* ---------------- Segregate one cover product ---------------- */

type Row = { id: string; model: string; qty: number };

export function AccSegregatePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { catalog } = useAccCatalog();
  const product = catalog?.products.find((p) => p.id === id) ?? null;
  const names = usePhoneNames();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState("");
  const [draftQty, setDraftQty] = useState(1);
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (product && !rows) setRows(product.models.map((m) => ({ id: m.model, model: m.model, qty: m.qty })));
  }, [product, rows]);

  const total = Math.max(product?.stockQty ?? 0, 0);
  const sorted = (rows ?? []).reduce((a, r) => a + r.qty, 0);
  const left = total - sorted;

  const suggestions = useMemo(() => {
    const used = new Set((rows ?? []).map((r) => r.model.toLowerCase()));
    const fromShop = new Set<string>();
    for (const p of catalog?.products ?? []) for (const m of p.models) fromShop.add(m.model);
    const all = [...fromShop, ...names, ...COMMON_PHONE_BRANDS].filter((n, i, a) => a.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i);
    const q = draft.trim().toLowerCase();
    return all.filter((n) => !used.has(n.toLowerCase()) && (!q || n.toLowerCase().includes(q))).slice(0, 8);
  }, [catalog, names, rows, draft]);

  function add(name = draft) {
    const model = name.trim().replace(/\s+/g, " ");
    if (!model || !rows) return;
    const qty = Math.min(Math.max(draftQty, 1), Math.max(left, 0));
    if (qty < 1) return void toast("All pieces are split", { tone: "error" });
    const existing = rows.find((r) => r.model.toLowerCase() === model.toLowerCase());
    setRows(existing ? rows.map((r) => (r === existing ? { ...r, qty: r.qty + qty } : r)) : [{ id: `${model}-${Date.now()}`, model, qty }, ...rows]);
    setDraft("");
    setDraftQty(1);
  }

  /** Row being renamed and the name being typed. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  function startRename(r: Row) {
    setRenaming(r.id);
    setNewName(r.model);
  }

  function finishRename() {
    if (!renaming || !rows) return;
    const name = newName.trim().replace(/\s+/g, " ");
    if (name) {
      const clash = rows.find((r) => r.id !== renaming && r.model.toLowerCase() === name.toLowerCase());
      if (clash) {
        toast(`${clash.model} is already in the list`, { tone: "error" });
        return;
      }
      setRows(rows.map((r) => (r.id === renaming ? { ...r, model: name } : r)));
    }
    setRenaming(null);
  }

  const setQty = (rid: string, qty: number) =>
    setRows((cur) => (cur ?? []).map((r) => (r.id === rid ? { ...r, qty: Math.max(0, Math.min(qty, r.qty + Math.max(left, 0))) } : r)));

  async function save() {
    if (!product || !rows || busy) return;
    if (left < 0) return void toast(`Only ${total} pieces in stock`, { tone: "error" });
    setBusy(true);
    try {
      const saved = new Set(product.models.map((m) => m.model));
      const renames = rows.filter((r) => saved.has(r.id) && r.id !== r.model).map((r) => ({ from: r.id, to: r.model }));
      const { data } = await accApi.setProductModels(
        product.id,
        rows.filter((r) => r.qty > 0).map((r) => ({ model: r.model, qty: r.qty })),
        renames,
      );
      patchCatalogProduct(data);
      toast(`Saved · ${sorted} split, ${left} left as ${product.name}`);
      navigate(-1);
    } catch (err) {
      toast(errorText(err), { tone: "error" });
      setBusy(false);
    }
  }

  if (!product || !rows) {
    return (
      <div className="acc-page">
        <BackLink to="/acc/stock" historyBack>Back</BackLink>
        <div className="acc-loading">
          <Loader2 className="acc-spin" /> Loading…
        </div>
      </div>
    );
  }

  const pct = total ? Math.min(100, (sorted / total) * 100) : 0;
  return (
    <div className="acc-page acc-seg-page">
      <BackLink to={`/acc/stock/${product.id}`} historyBack>{product.name}</BackLink>

      <section className="acc-seg-hero">
        <div>
          <small>Split by model</small>
          <h1>{product.name}</h1>
        </div>
        <div className="acc-seg-stats">
          <span>
            <b>{total}</b>
            <small>Total</small>
          </span>
          <span className="is-sorted">
            <b>{sorted}</b>
            <small>Split</small>
          </span>
          <span className={clsx("is-left", left < 0 && "is-over")}>
            <b>{left}</b>
            <small>Left</small>
          </span>
        </div>
        <div className="acc-seg-bar">
          <motion.i animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 260, damping: 30 }} />
        </div>
      </section>

      {/* Add a phone model */}
      <section className="acc-seg-add">
        <div className="acc-seg-input">
          <Smartphone aria-hidden />
          <input
            data-keep-case
            className="bg-transparent"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setFocus(true); }}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 150)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Phone model, e.g. iPhone 15 Pro"
            disabled={left <= 0}
          />
          {draft ? (
            <button type="button" onClick={() => setDraft("")} aria-label="Clear">
              <X />
            </button>
          ) : null}
        </div>
        <AnimatePresence>
          {focus && suggestions.length ? (
            <motion.ul className="acc-seg-suggest" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {suggestions.map((n) => (
                <li key={n}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraft(n); setFocus(false); (document.activeElement as HTMLElement | null)?.blur(); }}>
                    {n}
                  </button>
                </li>
              ))}
              {draft.trim() && !suggestions.some((n) => n.toLowerCase() === draft.trim().toLowerCase()) ? (
                <li>
                  <button type="button" className="is-new" onMouseDown={(e) => e.preventDefault()} onClick={() => add()}>
                    <Plus /> Add “{draft.trim()}” (saved for next time)
                  </button>
                </li>
              ) : null}
            </motion.ul>
          ) : null}
        </AnimatePresence>
        <div className="acc-seg-addrow">
          <Stepper value={draftQty} onChange={setDraftQty} max={Math.max(left, 1)} />
          <div className="acc-seg-quick">
            {[5, 10, 20].filter((n) => n < left).map((n) => (
              <button key={n} type="button" onClick={() => setDraftQty(n)} className={clsx(draftQty === n && "is-on")}>
                {n}
              </button>
            ))}
            {left > 0 ? (
              <button type="button" onClick={() => setDraftQty(left)} className={clsx(draftQty === left && "is-on")}>
                All {left}
              </button>
            ) : null}
          </div>
          <button type="button" className="acc-btn is-primary" onClick={() => add()} disabled={!draft.trim() || left <= 0}>
            <Plus /> Add
          </button>
        </div>
      </section>

      <ul className="acc-seg-list is-compact">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.li key={r.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40 }}>
              {renaming === r.id ? (
                <span className="acc-seg-rename">
                  <input
                    data-keep-case
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        finishRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRenaming(null);
                      }
                    }}
                    aria-label={`New name for ${r.model}`}
                  />
                  <button type="button" className="acc-seg-ok" onClick={finishRename} aria-label="Save name">
                    <Check />
                  </button>
                </span>
              ) : (
                <span className="acc-seg-model">
                  <strong>{r.model}</strong>
                </span>
              )}
              {renaming === r.id ? null : (
                <>
                  <Stepper value={r.qty} onChange={(v) => setQty(r.id, v)} max={r.qty + Math.max(left, 0)} min={0} />
                  <span className="acc-seg-acts">
                    <button type="button" className="acc-seg-edit" onClick={() => startRename(r)} aria-label={`Rename ${r.model}`}>
                      <PencilLine />
                    </button>
                    <button type="button" className="acc-seg-del" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.model}`}>
                      <Trash2 />
                    </button>
                  </span>
                </>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
        {left > 0 ? (
          <li className="is-rest">
            <span className="acc-seg-model">
              <PackageOpen aria-hidden />
              <strong>Not split</strong>
              <small>stays as {product.name}</small>
            </span>
            <b>{left}</b>
          </li>
        ) : null}
      </ul>

      <div className="acc-seg-save">
        <button type="button" className="acc-btn is-primary is-big is-block" onClick={() => void save()} disabled={busy || left < 0}>
          {busy ? <Loader2 className="acc-spin" /> : <Check />} Save · {sorted} split{left > 0 ? `, ${left} left` : ""}
        </button>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, max, min = 1 }: { value: number; onChange: (v: number) => void; max: number; min?: number }) {
  const clamp = (v: number) => Math.min(Math.max(Math.floor(v) || 0, min), max);
  return (
    <span className="acc-stepper">
      <button type="button" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label="Less">
        <Minus />
      </button>
      <input
        className="bg-transparent"
        type="number"
        inputMode="numeric"
        value={value || ""}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label="More">
        <Plus />
      </button>
    </span>
  );
}

/* ---------------- Cover boxes (seat-map style) ---------------- */

export function AccCoverBoxesPage() {
  const { catalog } = useAccCatalog();
  const boxes = useBoxes();
  const [q, setQ] = useState("");
  /** "Where is it?": find covers already in boxes. */
  const [findQ, setFindQ] = useState("");
  /** B: the cover whose box picker is open. */
  const [pickerFor, setPickerFor] = useState<Pile | null>(null);
  const [dragging, setDragging] = useState<Pile | null>(null);
  const [openBox, setOpenBox] = useState<AccBox | null>(null);
  const [adding, setAdding] = useState<"grid" | "box" | null>(null);
  const [trayOpen, setTrayOpen] = useState(true);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const piles = useMemo(() => coverPiles(catalog?.products ?? []), [catalog]);
  const where = useMemo(() => locationMap(boxes), [boxes]);
  const pileByKey = useMemo(() => new Map(piles.map((p) => [p.key, p])), [piles]);
  const totals = useMemo(() => {
    let all = 0;
    let seg = 0;
    let unplaced = 0;
    for (const p of piles) {
      all += p.qty;
      if (p.model) seg += p.qty;
      if (p.qty > 0 && !where.get(p.key)) unplaced += 1;
    }
    return { all, seg, rest: all - seg, unplaced };
  }, [piles, where]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // Covers already in a box leave this list (find them with "Where is it?").
    return piles
      .filter((p) => p.qty > 0 && !where.get(p.key))
      .filter((p) => t.every((x) => `${p.model} ${p.product.name}`.toLowerCase().includes(x)))
      .sort((a, b) => collator.compare(a.model || "~", b.model || "~") || collator.compare(a.product.name, b.product.name));
  }, [piles, q, where]);

  const found = useMemo(() => {
    const t = findQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!t.length) return [];
    return piles
      .filter((p) => where.get(p.key) && t.every((x) => `${p.model} ${p.product.name}`.toLowerCase().includes(x)))
      .map((p) => ({ pile: p, codes: where.get(p.key)! }));
  }, [piles, findQ, where]);
  const foundBoxes = useMemo(() => new Set(found.flatMap((f) => f.codes)), [found]);

  const grids = useMemo(() => {
    const out = new Map<string, AccBox[]>();
    for (const b of boxes ?? []) out.set(b.grid, [...(out.get(b.grid) ?? []), b]);
    return [...out.entries()];
  }, [boxes]);

  async function place(box: AccBox, pile: Pile) {
    if (box.items.some((i) => i.productId === pile.product.id && i.model === pile.model)) {
      toast(`Already in ${box.code}`);
      return;
    }
    try {
      const { data } = await accApi.placeInBox(box.id, pile.product.id, pile.model);
      setBoxes(data);
      toast(`${pile.model || "Not split"} · ${pile.product.name} → ${box.code}`);
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    }
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(pileByKey.get(String(e.active.id)) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    const pile = pileByKey.get(String(e.active.id));
    const box = boxes?.find((b) => b.id === e.over?.id);
    setDragging(null);
    if (pile && box) void place(box, pile);
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="acc-page acc-boxes-page">
        <div className="acc-boxes-head">
          <div>
            <h1 className="acc-h1">Cover boxes</h1>
            <p>
              {plural(boxes?.length ?? 0, "box", "boxes")} · {plural(totals.all, "cover")}
            </p>
          </div>
          <div className="acc-boxes-actions">
            <button type="button" onClick={() => void pdfRun(() => accApi.pdf.boxes())} title="Download PDF of all boxes">
              <FileDown /> PDF
            </button>
            <button type="button" onClick={() => setAdding("grid")}>
              <Grid3x3 /> Grid
            </button>
            <button type="button" onClick={() => setAdding("box")}>
              <SquarePlus /> Box
            </button>
          </div>
        </div>

        {/* Where is it? */}
        <div className="acc-where">
          <label className="acc-tray-search">
            <Search aria-hidden />
            <input data-keep-case className="bg-transparent" value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder="Where is it? Search phone or cover in boxes…" />
            {findQ ? (
              <button type="button" className="acc-where-clear" onClick={() => setFindQ("")} aria-label="Clear">
                <X />
              </button>
            ) : null}
          </label>
          {findQ.trim() ? (
            found.length ? (
              <ul className="acc-where-list">
                {found.map(({ pile, codes }) => (
                  <li key={pile.key}>
                    <span>
                      <strong>{pile.model || "Not split"}</strong>
                      <small>
                        {pile.product.name} · {pile.qty} pcs
                      </small>
                    </span>
                    <span className="acc-finder-boxes">
                      {codes.map((c) => (
                        <em key={c}>{c}</em>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="acc-hint">Not in any box.</p>
            )
          ) : null}
        </div>

        <div className="acc-boxes-layout">
          {/* Cover stock tray */}
          <section className={clsx("acc-tray", !trayOpen && "is-closed")}>
            <button type="button" className="acc-tray-head" onClick={() => setTrayOpen((v) => !v)} aria-expanded={trayOpen}>
              <span>
                <strong>Not in a box · {shown.length}</strong>
                <small>
                  Cover stock {totals.all} pcs · {totals.seg} split · {totals.rest} not
                </small>
              </span>
              <em>{trayOpen ? "Hide" : "Show"}</em>
            </button>
            {trayOpen ? (
              <>
                <label className="acc-tray-search">
                  <Search aria-hidden />
                  <input data-keep-case className="bg-transparent" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search phone or cover…" />
                </label>
                <p className="acc-tray-hint">Tap a cover to choose its box, or tap a box to fill it with many covers.</p>
                <ul className="acc-tray-list">
                  {shown.map((p) => (
                    <TrayPile key={p.key} pile={p} codes={where.get(p.key) ?? []} picked={pickerFor?.key === p.key} onPick={() => setPickerFor(p)} />
                  ))}
                  {!shown.length ? (
                    <li className="acc-tray-empty">{q.trim() ? "Nothing matches." : piles.length ? "Every cover is in a box 🎉" : "No cover stock yet."}</li>
                  ) : null}
                </ul>
              </>
            ) : null}
          </section>

          {/* Grids */}
          <section className="acc-grids">
            {!boxes ? (
              <div className="acc-loading">
                <Loader2 className="acc-spin" /> Loading…
              </div>
            ) : (
              grids.map(([name, list]) => {
                const cols = name === "Single" ? 4 : Math.max(...list.map((b) => b.col)) + 1;
                return (
                  <div key={name} className="acc-grid-block">
                    <h2>
                      <Boxes /> {name === "Single" ? "Single boxes" : name}
                      <small>{plural(list.length, "box", "boxes")}</small>
                    </h2>
                    <div className="acc-seatmap" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                      {list.map((b) => (
                        <BoxTile
                          key={b.id}
                          box={b}
                          pileByKey={pileByKey}
                          armed={Boolean(dragging)}
                          found={foundBoxes.has(b.code)}
                          onTap={() => setOpenBox(b)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>

      </div>

      <DragOverlay dropAnimation={{ duration: 180 }}>
        {dragging ? (
          <div className="acc-drag-ghost">
            <strong>{dragging.model || "Not split"}</strong>
            <small>
              {dragging.product.name} · {dragging.qty}
            </small>
          </div>
        ) : null}
      </DragOverlay>

      <FillBoxSheet
        box={openBox ? boxes?.find((b) => b.id === openBox.id) ?? null : null}
        piles={piles}
        where={where}
        pileByKey={pileByKey}
        onClose={() => setOpenBox(null)}
      />
      <BoxPickerSheet pile={pickerFor} boxes={boxes ?? []} where={where} onClose={() => setPickerFor(null)} />
      <AddBoxesSheet mode={adding} onClose={() => setAdding(null)} />
    </DndContext>
  );
}

function TrayPile({ pile, codes, picked, onPick }: { pile: Pile; codes: string[]; picked: boolean; onPick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: pile.key });
  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        className={clsx("acc-pile", picked && "is-picked", isDragging && "is-dragging", !pile.model && "is-rest")}
        onClick={onPick}
        {...listeners}
        {...attributes}
      >
        <span className="acc-pile-text">
          <strong>{pile.model || "Not split"}</strong>
          <small>{pile.product.name}</small>
        </span>
        <span className="acc-pile-side">
          <b>{pile.qty}</b>
          {codes.length ? <em>{codes.join(" · ")}</em> : <em className="is-none">No box</em>}
        </span>
      </button>
    </li>
  );
}

function BoxTile({
  box,
  pileByKey,
  armed,
  found,
  onTap,
}: {
  box: AccBox;
  pileByKey: Map<string, Pile>;
  armed: boolean;
  found: boolean;
  onTap: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: box.id });
  const items = box.items.map((i) => ({ item: i, pile: pileByKey.get(`${i.productId}|${i.model}`) }));
  const pcs = items.reduce((a, x) => a + (x.pile?.qty ?? 0), 0);
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onTap}
      className={clsx("acc-box", !items.length && "is-empty", armed && "is-armed", isOver && "is-over", found && "is-found")}
    >
      <span className="acc-box-code">{box.code}</span>
      {items.length ? (
        <>
          <span className="acc-box-items">
            {items.slice(0, 2).map(({ item, pile }) => (
              <i key={item.id}>{item.model || pile?.product.name || "Cover"}</i>
            ))}
            {items.length > 2 ? <i className="is-more">+{items.length - 2} more</i> : null}
          </span>
          <span className="acc-box-pcs">{pcs} pcs</span>
        </>
      ) : (
        <span className="acc-box-free">Empty</span>
      )}
    </button>
  );
}

/** A: open a box: what's in it, and tick many covers to put in at once. */
function FillBoxSheet({
  box,
  piles,
  where,
  pileByKey,
  onClose,
}: {
  box: AccBox | null;
  piles: Pile[];
  where: Map<string, string[]>;
  pileByKey: Map<string, Pile>;
  onClose: () => void;
}) {
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  useEffect(() => {
    setTicked([]);
    setQ("");
  }, [box?.id]);

  const inBox = new Set(box?.items.map((i) => `${i.productId}|${i.model}`) ?? []);
  const t = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const choices = piles
    .filter((p) => p.qty > 0 && !inBox.has(p.key))
    .filter((p) => t.every((x) => `${p.model} ${p.product.name}`.toLowerCase().includes(x)))
    .sort((a, b) => Number(Boolean(where.get(a.key))) - Number(Boolean(where.get(b.key))) || collator.compare(a.model || "~", b.model || "~"));

  async function run(work: () => Promise<{ data: AccBox[] }>, done?: string) {
    setBusy(true);
    try {
      const { data } = await work();
      setBoxes(data);
      if (done) toast(done);
      return true;
    } catch (err) {
      toast(errorText(err), { tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function fill() {
    if (!box || !ticked.length) return;
    const items = ticked.map((k) => pileByKey.get(k)).filter(Boolean).map((p) => ({ productId: p!.product.id, model: p!.model }));
    if (await run(() => accApi.fillBox(box.id, items), `${plural(items.length, "cover")} put in ${box.code}`)) setTicked([]);
  }

  return (
    <Sheet
      open={Boolean(box)}
      onClose={onClose}
      title={box ? `Box ${box.code}` : ""}
      subtitle={box ? `${box.grid === "Single" ? "Single box" : box.grid} · ${plural(box.items.length, "cover")} inside` : ""}
      footer={
        ticked.length ? (
          <button type="button" className="acc-btn is-primary is-big is-block" disabled={busy} onClick={() => void fill()}>
            {busy ? <Loader2 className="acc-spin" /> : <Check />} Put {plural(ticked.length, "cover")} in {box?.code}
          </button>
        ) : undefined
      }
    >
      {box ? (
        <div className="acc-fill">
          {box.items.length ? (
            <>
              <div className="acc-fill-labelrow">
                <p className="acc-fill-label">In this box</p>
                <span className="acc-box-pdf">
                  <button type="button" onClick={() => void pdfRun(() => accApi.pdf.boxes(box.id))} title={`Download PDF of box ${box.code}`}>
                    <FileDown /> PDF
                  </button>
                  <button type="button" onClick={() => void pdfRun(() => accApi.sharePdf.boxes(box.id))} aria-label={`Share PDF of box ${box.code}`}>
                    <Share2 />
                  </button>
                </span>
              </div>
              <ul className="acc-fill-in">
                {box.items.map((i) => {
                  const pile = pileByKey.get(`${i.productId}|${i.model}`);
                  return (
                    <li key={i.id}>
                      <span>
                        <strong>{i.model || "Not split"}</strong>
                        <small>{pile?.product.name ?? "Removed product"}</small>
                      </span>
                      <b>{pile?.qty ?? 0}</b>
                      <button type="button" disabled={busy} onClick={() => void run(() => accApi.removeFromBox(i.id), `Taken out of ${box.code}`)} aria-label="Take out of box">
                        <X />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          <p className="acc-fill-label">Add covers{ticked.length ? ` · ${ticked.length} ticked` : ""}</p>
          <label className="acc-tray-search">
            <Search aria-hidden />
            <input data-keep-case className="bg-transparent" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search phone or cover…" />
          </label>
          <ul className="acc-fill-list">
            {choices.map((p) => {
              const on = ticked.includes(p.key);
              const codes = where.get(p.key) ?? [];
              return (
                <li key={p.key}>
                  <button type="button" className={clsx("acc-fill-row", on && "is-on")} onClick={() => setTicked(on ? ticked.filter((k) => k !== p.key) : [...ticked, p.key])}>
                    <i className="acc-tick">{on ? <Check /> : null}</i>
                    <span className="acc-pile-text">
                      <strong>{p.model || "Not split"}</strong>
                      <small>{p.product.name}</small>
                    </span>
                    <span className="acc-pile-side">
                      <b>{p.qty}</b>
                      {codes.length ? <em>{codes.join(" · ")}</em> : <em className="is-none">No box</em>}
                    </span>
                  </button>
                </li>
              );
            })}
            {!choices.length ? <li className="acc-tray-empty">{t.length ? "Nothing matches." : "Every cover is already here."}</li> : null}
          </ul>
          {isAdmin && !box.items.length && !ticked.length ? (
              <button type="button" className="acc-link-btn is-red" disabled={busy} onClick={() => void run(() => accApi.deleteBox(box.id), `Box ${box.code} removed`).then((ok) => ok && onClose())}>
                <Trash2 /> Remove this box
              </button>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** B: tap a cover → small seat map; tap a box to put it in (tap again to take it out). */
function BoxPickerSheet({ pile, boxes, where, onClose }: { pile: Pile | null; boxes: AccBox[]; where: Map<string, string[]>; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const codes = pile ? where.get(pile.key) ?? [] : [];
  const grids = useMemo(() => {
    const out = new Map<string, AccBox[]>();
    for (const b of boxes) out.set(b.grid, [...(out.get(b.grid) ?? []), b]);
    return [...out.entries()];
  }, [boxes]);

  async function toggle(b: AccBox) {
    if (!pile || busy) return;
    setBusy(b.id);
    try {
      const existing = b.items.find((i) => i.productId === pile.product.id && i.model === pile.model);
      const { data } = existing ? await accApi.removeFromBox(existing.id) : await accApi.placeInBox(b.id, pile.product.id, pile.model);
      setBoxes(data);
      toast(existing ? `Taken out of ${b.code}` : `${pile.model || "Not split"} → ${b.code}`);
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      open={Boolean(pile)}
      onClose={onClose}
      title={pile ? pile.model || "Not split" : ""}
      subtitle={pile ? `${pile.product.name} · ${pile.qty} pcs · ${codes.length ? `in ${codes.join(", ")}` : "not in a box"}` : ""}
      footer={
        <button type="button" className="acc-btn is-big is-block" onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="acc-tray-hint">Tap a box to put it there · tap a blue box to take it out.</p>
      {grids.map(([name, list]) => {
        const cols = name === "Single" ? 5 : Math.max(...list.map((b) => b.col)) + 1;
        return (
          <div key={name} className="acc-mini-grid-block">
            {grids.length > 1 ? <p className="acc-fill-label">{name === "Single" ? "Single boxes" : name}</p> : null}
            <div className="acc-mini-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {list.map((b) => {
                const here = codes.includes(b.code);
                return (
                  <button key={b.id} type="button" className={clsx("acc-mini-box", here && "is-here", b.items.length && "has-items")} onClick={() => void toggle(b)} disabled={Boolean(busy)}>
                    {busy === b.id ? <Loader2 className="acc-spin" /> : b.code}
                    {b.items.length && !here ? <i>{b.items.length}</i> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}

function AddBoxesSheet({ mode, onClose }: { mode: "grid" | "box" | null; onClose: () => void }) {
  const [rows, setRows] = useState(7);
  const [cols, setCols] = useState(4);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const { data } = mode === "grid" ? await accApi.addBoxGrid(rows, cols) : await accApi.addSingleBox(code.trim() || undefined);
      setBoxes(data);
      toast(mode === "grid" ? `${rows * cols} boxes added` : "Box added");
      setCode("");
      onClose();
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={Boolean(mode)}
      onClose={onClose}
      title={mode === "grid" ? "Add a grid" : "Add a single box"}
      subtitle={mode === "grid" ? "Rows get the next letters (H, I…), columns 1, 2, 3…" : "Leave empty for S1, S2…"}
      footer={
        <button type="button" className="acc-btn is-primary is-big is-block" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="acc-spin" /> : <Plus />} {mode === "grid" ? `Add ${rows * cols} boxes` : "Add box"}
        </button>
      }
    >
      {mode === "grid" ? (
        <div className="acc-form-grid">
          <label className="acc-field">
            <span>Rows</span>
            <Stepper value={rows} onChange={setRows} max={12} />
          </label>
          <label className="acc-field">
            <span>Columns</span>
            <Stepper value={cols} onChange={setCols} max={8} />
          </label>
        </div>
      ) : (
        <label className="acc-field">
          <span>Box name (optional)</span>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. TABLE-1" maxLength={12} />
        </label>
      )}
    </Sheet>
  );
}

/* ---------------- Counter: find covers for a phone ---------------- */

export function CoverFinder({
  products,
  query,
  onQuery,
  onSell,
}: {
  products: AccProduct[];
  /** The counter's own search text (one search bar). */
  query: string;
  onQuery: (q: string) => void;
  onSell: (p: AccProduct) => void;
}) {
  const boxes = useBoxes();
  const q = query;
  const where = useMemo(() => locationMap(boxes), [boxes]);
  const models = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (isCover(p)) for (const m of p.models) if (m.qty > 0) set.add(m.model);
    return [...set].sort(collator.compare);
  }, [products]);
  const term = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!term) return [];
    const out: Array<{ product: AccProduct; model: string; qty: number; codes: string[] }> = [];
    for (const p of products) {
      if (!isCover(p)) continue;
      for (const m of p.models) {
        if (m.qty > 0 && m.model.toLowerCase().includes(term)) out.push({ product: p, model: m.model, qty: m.qty, codes: where.get(`${p.id}|${m.model}`) ?? [] });
      }
    }
    return out.sort((a, b) => collator.compare(a.model, b.model) || collator.compare(a.product.name, b.product.name));
  }, [products, term, where]);
  const quick = models.filter((m) => !term || m.toLowerCase().includes(term)).slice(0, 10);

  return (
    <section className="acc-finder">
      {!hits.length || !term ? (
        term ? null : (
          <div className="acc-finder-chips">
            {quick.map((m) => (
              <button key={m} type="button" onClick={() => onQuery(m)}>
                <Smartphone /> {m}
              </button>
            ))}
          </div>
        )
      ) : (
        <ul className="acc-finder-list">
          {hits.map((h) => (
            <li key={`${h.product.id}|${h.model}`}>
              <button type="button" onClick={() => onSell(h.product)}>
                <span>
                  <strong>{h.product.name}</strong>
                  <small>
                    {h.model} · {h.qty} pcs
                  </small>
                </span>
                <span className="acc-finder-boxes">
                  {h.codes.length ? h.codes.map((c) => <em key={c}>{c}</em>) : <em className="is-none">No box</em>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Segregate covers" link for cover products (product page, purchases). */
export function SegregateLink({ product, className }: { product: Pick<AccProduct, "id" | "categoryName">; className?: string }) {
  if (!isCover(product)) return null;
  return (
    <Link to={`/acc/stock/${product.id}/segregate`} className={clsx("acc-btn is-small", className)}>
      <Smartphone /> Split by model
    </Link>
  );
}
