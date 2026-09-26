import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cable, Minus, Plus, Search, Store, Trash2 } from "lucide-react";
import clsx from "clsx";
import {
  SerialScanFieldButton,
  ScanFieldShell,
  scanFieldInputClass,
} from "../components/BarcodeImeiScanner";
import { FieldPicker } from "../components/FieldPicker";
import { BackButton, SearchClearButton } from "../components/ui";
import { api, formatINR } from "../lib/api";
import { subscribeOutsideDismiss } from "../lib/floatingMenu";
import type { Supplier } from "../types";

/** An accessory already filled in and waiting to be saved with the rest. */
type QueuedAccessory = {
  key: string;
  name: string;
  purchasePrice: number;
  serials: string[];
};

function insertAt<T>(list: T[], index: number, item: T) {
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
  return next;
}

function cleanSerial(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function clampQty(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(50, Math.max(1, Math.round(value)));
}

function QuantityStepper({
  id,
  value,
  disabled,
  onChange,
}: {
  id?: string;
  value: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const qty = clampQty(value);
  return (
    <div className="inline-flex h-12 min-h-[48px] w-[7.25rem] shrink-0 items-stretch overflow-hidden rounded-[13px] border-[1.5px] border-ink-100 bg-white dark:border-ink-100 dark:bg-surface-elevated">
      <button
        type="button"
        className="grid w-9 shrink-0 place-items-center text-ink-700 transition hover:bg-[#F4F7FA] disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-surface-muted"
        aria-label="Decrease quantity"
        disabled={disabled || qty <= 1}
        onClick={() => onChange(qty - 1)}
      >
        <Minus className="h-4 w-4" strokeWidth={2.2} />
      </button>
      <input
        id={id}
        className="min-w-0 flex-1 bg-transparent text-center text-base font-semibold tabular-nums text-ink-900 outline-none"
        type="number"
        inputMode="numeric"
        min={1}
        max={50}
        value={qty}
        disabled={disabled}
        onChange={(e) => onChange(clampQty(Number(e.target.value) || 1))}
      />
      <button
        type="button"
        className="grid w-9 shrink-0 place-items-center text-ink-700 transition hover:bg-[#F4F7FA] disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-surface-muted"
        aria-label="Increase quantity"
        disabled={disabled || qty >= 50}
        onClick={() => onChange(qty + 1)}
      >
        <Plus className="h-4 w-4" strokeWidth={2.2} />
      </button>
    </div>
  );
}

function AccessoryNameSearch({
  id,
  value,
  suggestions,
  disabled,
  required = true,
  onChange,
}: {
  id?: string;
  value: string;
  suggestions: string[];
  disabled?: boolean;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 8);
    return suggestions
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [suggestions, value]);

  const showList = open && matches.length > 0;

  useEffect(() => {
    setHighlight(0);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    return subscribeOutsideDismiss((target) => {
      const node = target as Node | null;
      if (rootRef.current?.contains(node)) return true;
      if (menuRef.current?.contains(node)) return true;
      return false;
    }, () => setOpen(false));
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={clsx("relative", showList && "z-50")}
    >
      <div
        className={clsx(
          "flex min-h-[48px] cursor-text items-center gap-2.5 rounded-[13px] border-[1.5px] border-ink-100 bg-white px-3 transition dark:bg-surface-elevated",
          open &&
            "border-[var(--accent)] shadow-[0_0_0_4px_rgba(var(--accent-rgb),.16)]",
          disabled && "cursor-not-allowed opacity-55",
        )}
        onMouseDown={(event) => {
          if (disabled) return;
          if (event.target === inputRef.current) return;
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <Search
          className="pointer-events-none h-[18px] w-[18px] shrink-0 text-ink-500"
          aria-hidden
        />
        <input
          ref={inputRef}
          id={id}
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-ink-900 outline-none placeholder:text-[#9AA6B6] sm:text-[14.5px]"
          value={value}
          disabled={disabled}
          required={required}
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. 20W USB-C Adapter, Cover…"
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (!showList) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((i) => (i + 1) % matches.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((i) => (i - 1 + matches.length) % matches.length);
            } else if (event.key === "Enter" && matches[highlight]) {
              event.preventDefault();
              onChange(matches[highlight]);
              setOpen(false);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <SearchClearButton
          visible={Boolean(value.trim()) && !disabled}
          label="Clear name"
          onClear={() => {
            onChange("");
            setOpen(true);
            inputRef.current?.focus();
          }}
        />
      </div>
      {showList ? (
        <div
          ref={menuRef}
          className="absolute left-0 right-0 top-full z-30 mt-1.5"
        >
          <ul
            id={listId}
            role="listbox"
            className="max-h-[min(240px,40dvh)] overflow-auto rounded-2xl border border-ink-100 bg-white p-1.5 shadow-[0_10px_24px_rgba(16,25,40,.10)] dark:border-ink-100 dark:bg-surface-elevated"
          >
            {matches.map((name, index) => {
              const active = index === highlight;
              return (
                <li key={name} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={
                      active
                        ? "flex w-full rounded-[11px] px-2.5 py-2.5 text-left text-sm font-semibold text-ink-900 bg-tide-100 dark:bg-tide-100/40"
                        : "flex w-full rounded-[11px] px-2.5 py-2.5 text-left text-sm font-semibold text-ink-900 hover:bg-[#F4F7FA] dark:hover:bg-surface-muted"
                    }
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                  >
                    {name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function AddAccessoriesPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const [serials, setSerials] = useState<string[]>([""]);
  const [purchasePrice, setPurchasePrice] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [useNewSupplier, setUseNewSupplier] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<QueuedAccessory[]>([]);
  /** A queued accessory currently loaded back into the form, and where it came from. */
  const [editing, setEditing] = useState<{
    index: number;
    original: QueuedAccessory;
  } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [{ data: names }, { data: supplierList }] = await Promise.all([
          api.listAccessoryNames(),
          api.listSuppliers(),
        ]);
        if (!active) return;
        setSuggestions(names);
        setSuppliers(supplierList);
      } catch {
        // Suggestions / supplier list are optional for first paint.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const next = clampQty(qty);
    setSerials((prev) => {
      if (prev.length === next) return prev;
      if (prev.length < next) {
        return [...prev, ...Array.from({ length: next - prev.length }, () => "")];
      }
      return prev.slice(0, next);
    });
  }, [qty]);

  const supplierOptions = useMemo(
    () =>
      suppliers.map((s) => ({
        value: s.id,
        label: s.name,
        description: s.phone || undefined,
      })),
    [suppliers],
  );

  function goBack() {
    navigate("/stock?condition=ACCESSORY", {
      replace: true,
      state: { condition: "ACCESSORY" },
    });
  }

  function supplierError(): string | null {
    if (useNewSupplier) {
      if (!supplierName.trim()) return "Enter the supplier name";
      if (supplierPhone.replace(/\D/g, "").length < 10) {
        return "Enter a valid 10-digit supplier phone";
      }
      return null;
    }
    return supplierId ? null : "Select a supplier";
  }

  const currentIsBlank =
    !name.trim() &&
    !purchasePrice.trim() &&
    serials.every((serial) => !serial.trim());

  /** Validates the accessory in the form, including serial clashes with queued ones. */
  function readCurrent(
    others: QueuedAccessory[] = queued,
  ): { line: QueuedAccessory } | { error: string } {
    const trimmedName = name.trim();
    const price = Number(purchasePrice);
    const cleaned = serials.map(cleanSerial);

    if (trimmedName.length < 2) return { error: "Enter the accessory name" };
    if (!purchasePrice.trim() || !Number.isFinite(price) || price < 0) {
      return { error: "Enter a valid purchase price" };
    }
    if (cleaned.some((s) => s.length < 3)) {
      return { error: "Enter a serial number for each unit (min 3 characters)" };
    }
    const taken = new Set(
      others.flatMap((line) => line.serials.map((s) => s.toLowerCase())),
    );
    const seen = new Set<string>();
    for (const serial of cleaned) {
      const key = serial.toLowerCase();
      if (seen.has(key)) return { error: "Serial numbers must be unique" };
      if (taken.has(key)) {
        return { error: `Serial ${serial} is already added above` };
      }
      seen.add(key);
    }

    return {
      line: {
        key:
          editing?.original.key ??
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: trimmedName,
        purchasePrice: price,
        serials: cleaned,
      },
    };
  }

  function resetCurrent() {
    setName("");
    setQty(1);
    setSerials([""]);
    setPurchasePrice("");
  }

  function addAnother() {
    const supplierIssue = supplierError();
    if (supplierIssue) {
      setError(supplierIssue);
      return;
    }
    const result = readCurrent();
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setQueued((current) =>
      editing
        ? insertAt(current, editing.index, result.line)
        : [...current, result.line],
    );
    setEditing(null);
    resetCurrent();
    requestAnimationFrame(() => document.getElementById("acc-name")?.focus());
  }

  function removeQueued(key: string) {
    const removedIndex = queued.findIndex((line) => line.key === key);
    setQueued((current) => current.filter((line) => line.key !== key));
    if (editing && removedIndex >= 0 && removedIndex < editing.index) {
      setEditing({ ...editing, index: editing.index - 1 });
    }
  }

  /** Load a queued accessory back into the form. A filled-in form is queued first. */
  function openQueued(key: string) {
    if (saving) return;
    let list = queued;

    if (!currentIsBlank) {
      const result = readCurrent(queued.filter((line) => line.key !== key));
      if ("error" in result) {
        setError(`Finish or clear the accessory below first — ${result.error}`);
        return;
      }
      list = editing
        ? insertAt(list, editing.index, result.line)
        : [...list, result.line];
    } else if (editing) {
      // Untouched edit: put the original back before switching.
      list = insertAt(list, editing.index, editing.original);
    }

    const index = list.findIndex((line) => line.key === key);
    if (index < 0) return;
    const line = list[index]!;
    setQueued(list.filter((item) => item.key !== key));
    setEditing({ index, original: line });
    setError(null);
    setName(line.name);
    setPurchasePrice(String(line.purchasePrice));
    setSerials(line.serials);
    setQty(line.serials.length);
    requestAnimationFrame(() => document.getElementById("acc-name")?.focus());
  }

  function cancelEdit() {
    if (!editing) return;
    setQueued((current) => insertAt(current, editing.index, editing.original));
    setEditing(null);
    setError(null);
    resetCurrent();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const supplierIssue = supplierError();
    if (supplierIssue) {
      setError(supplierIssue);
      return;
    }

    // An empty form is fine once something is queued — save just the queue.
    let lines = queued;
    if (currentIsBlank && editing) {
      lines = insertAt(queued, editing.index, editing.original);
    } else if (!(queued.length > 0 && currentIsBlank)) {
      const result = readCurrent();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      lines = editing
        ? insertAt(queued, editing.index, result.line)
        : [...queued, result.line];
    }

    setSaving(true);
    setError(null);
    try {
      await api.createAccessories({
        items: lines.map(({ name: lineName, purchasePrice: linePrice, serials: lineSerials }) => ({
          name: lineName,
          purchasePrice: linePrice,
          serials: lineSerials,
        })),
        supplierId: useNewSupplier ? null : supplierId,
        supplierName: useNewSupplier ? supplierName.trim() : null,
        supplierPhone: useNewSupplier
          ? supplierPhone.replace(/\D/g, "")
          : null,
      });
      goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add accessories");
    } finally {
      setSaving(false);
    }
  }

  const unitCount = clampQty(qty);
  const priceNum = Number(purchasePrice) || 0;
  const queuedUnits = queued.reduce((sum, line) => sum + line.serials.length, 0);
  // Once something is queued, an untouched form is optional (saves just the queue).
  const currentOptional = (queued.length > 0 || editing !== null) && currentIsBlank;
  const totalUnits =
    queuedUnits +
    (currentOptional
      ? editing && currentIsBlank
        ? editing.original.serials.length
        : 0
      : unitCount);

  return (
    <div className="mx-auto max-w-lg">
      <BackButton className="mb-4" onClick={goBack} disabled={saving}>
        Back to stock
      </BackButton>

      <div className="mb-5 flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#e3f3ff] text-[#4a62a8] dark:bg-tide-100/30 dark:text-tide-400">
          <Cable className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-tide-600">
            Inventory
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink-900">
            Add accessories
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Supplier, name, quantity, and one serial number per unit.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => void save(e)}
        className="space-y-4 rounded-3xl border border-white/70 bg-white/90 p-5 shadow-soft dark:border-ink-100 dark:bg-surface-elevated sm:p-6"
      >
        <section className="relative z-10 overflow-visible rounded-[16px] border border-ink-100 bg-[#FBFCFD] p-4 dark:border-ink-100 dark:bg-surface-muted sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 font-display text-base font-semibold text-ink-900">
              <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-[#EEF2F8] text-ink-500 dark:bg-surface">
                <Store className="h-[15px] w-[15px]" />
              </span>
              Supplier
            </h2>
            <div className="inline-flex gap-0.5 rounded-[11px] bg-[#EBEDF1] p-1 dark:bg-surface">
              <button
                type="button"
                className={clsx(
                  "rounded-lg px-4 py-2 text-[13px] transition",
                  !useNewSupplier ? "segment-on" : "segment-off",
                )}
                onClick={() => setUseNewSupplier(false)}
                disabled={saving}
              >
                Existing
              </button>
              <button
                type="button"
                className={clsx(
                  "rounded-lg px-4 py-2 text-[13px] transition",
                  useNewSupplier ? "segment-on" : "segment-off",
                )}
                onClick={() => setUseNewSupplier(true)}
                disabled={saving}
              >
                New supplier
              </button>
            </div>
          </div>

          {useNewSupplier ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label required" htmlFor="acc-supplier-name">
                  Supplier name
                </label>
                <input
                  id="acc-supplier-name"
                  className="field"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Business / dealer name"
                  required
                  disabled={saving}
                />
              </div>
              <div>
                <label className="label required" htmlFor="acc-supplier-phone">
                  Phone
                </label>
                <input
                  id="acc-supplier-phone"
                  className="field"
                  type="tel"
                  inputMode="numeric"
                  value={supplierPhone}
                  onChange={(e) => setSupplierPhone(e.target.value)}
                  placeholder="10-digit mobile"
                  required
                  disabled={saving}
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="label required">Supplier</label>
              <FieldPicker
                value={supplierId}
                onChange={setSupplierId}
                placeholder={
                  suppliers.length
                    ? "Select supplier…"
                    : "No suppliers yet — add a new one"
                }
                searchable
                searchPlaceholder="Search supplier name…"
                required
                disabled={saving}
                options={supplierOptions}
              />
            </div>
          )}
        </section>

        {queued.length > 0 || editing ? (
          <div className="space-y-2">
            {queued.map((line, index) => {
              const position =
                editing && index >= editing.index ? index + 2 : index + 1;
              return (
              <div
                key={line.key}
                role="button"
                tabIndex={saving ? -1 : 0}
                aria-label={`Edit accessory ${position}: ${line.name}`}
                onClick={() => openQueued(line.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openQueued(line.key);
                  }
                }}
                className="cursor-pointer rounded-[14px] border border-ink-100 bg-[#FBFCFD] px-4 py-3 transition hover:border-tide-500 focus-visible:border-tide-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-tide-400/20 dark:border-ink-100 dark:bg-surface-muted"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                      Accessory {position}
                    </p>
                    <p className="mt-0.5 truncate font-semibold text-ink-900">
                      {line.name}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-500">
                      {line.serials.length} × {formatINR(line.purchasePrice)}
                      {line.serials.length > 1
                        ? ` = ${formatINR(line.purchasePrice * line.serials.length)}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeQueued(line.key);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    disabled={saving}
                    aria-label={`Remove ${line.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </button>
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="min-w-0 break-all font-mono text-[12px] text-ink-500">
                    {line.serials.join(" · ")}
                  </p>
                  <span className="shrink-0 text-[11.5px] font-semibold text-tide-600 dark:text-tide-400">
                    Tap to edit
                  </span>
                </div>
              </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 px-1 pt-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                {editing
                  ? `Editing accessory ${editing.index + 1}`
                  : `Accessory ${queued.length + 1}${currentIsBlank ? " · optional" : ""}`}
              </p>
              {editing ? (
                <button
                  type="button"
                  className="text-[12px] font-semibold text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
                  onClick={cancelEdit}
                  disabled={saving}
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div>
          <label className="label required" htmlFor="acc-name">
            Accessory name
          </label>
          <AccessoryNameSearch
            id="acc-name"
            value={name}
            suggestions={suggestions}
            disabled={saving}
            required={!currentOptional}
            onChange={setName}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label required" htmlFor="acc-qty">
              Quantity
            </label>
            <QuantityStepper
              id="acc-qty"
              value={unitCount}
              disabled={saving}
              onChange={setQty}
            />
          </div>
          <div>
            <label className="label required" htmlFor="acc-price">
              Purchase price
            </label>
            <input
              id="acc-price"
              className="field"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={purchasePrice}
              disabled={saving}
              required={!currentOptional}
              placeholder="Per unit"
              onChange={(e) => setPurchasePrice(e.target.value)}
            />
            {unitCount > 1 && priceNum > 0 ? (
              <p className="mt-1 text-[11.5px] text-ink-400">
                Total {formatINR(priceNum * unitCount)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          {serials.map((serial, index) => (
            <div key={`serial-${index}`}>
              <label
                className="label required"
                htmlFor={`acc-serial-${index}`}
              >
                {unitCount > 1 ? `Serial number · unit ${index + 1}` : "Serial number"}
              </label>
              <ScanFieldShell>
                <input
                  id={`acc-serial-${index}`}
                  className={scanFieldInputClass}
                  value={serial}
                  disabled={saving}
                  placeholder="Scan or type serial"
                  required={!currentOptional}
                  onChange={(e) => {
                    const next = [...serials];
                    next[index] = e.target.value;
                    setSerials(next);
                  }}
                />
                <SerialScanFieldButton
                  disabled={saving}
                  onScan={(value) => {
                    const next = [...serials];
                    next[index] = value;
                    setSerials(next);
                  }}
                />
              </ScanFieldShell>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#C6CEDA] bg-transparent px-3 py-3.5 text-sm font-semibold text-ink-500 transition hover:border-tide-500 hover:bg-tide-100 hover:text-tide-600 dark:border-ink-300 dark:hover:border-tide-400 dark:hover:bg-tide-100/40 dark:hover:text-tide-400"
          onClick={addAnother}
          disabled={saving}
        >
          <Plus className="h-[17px] w-[17px]" strokeWidth={2.2} />
          {editing ? "Done editing · add another" : "Add another accessory"}
        </button>

        {error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className="btn-secondary flex-1"
            onClick={goBack}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving
              ? "Saving…"
              : totalUnits > 1
                ? `Add ${totalUnits} accessories`
                : "Add accessory"}
          </button>
        </div>
      </form>
    </div>
  );
}
