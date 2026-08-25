import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Info,
  Minus,
  Package,
  Plus,
  Smartphone,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { FieldPicker } from "./FieldPicker";
import { SavePurchaseConfirmModal } from "./SavePurchaseConfirmModal";
import { ImeiScanFieldButton } from "./BarcodeImeiScanner";
import {
  MobileNameSearch,
  invalidatePhoneModelCache,
} from "./MobileNameSearch";
import { BackButton } from "./ui";
import { api, formatINR } from "../lib/api";
import type { PhoneModel, Purchase, Supplier } from "../types";
import clsx from "clsx";
export type PurchasePrefill = Partial<
  Pick<
    {
      platform: "IOS" | "ANDROID";
      mobileName: string;
      storage: string;
      ram: string;
      color: string;
    },
    "platform" | "mobileName" | "storage" | "ram" | "color"
  >
>;

type DraftUnit = {
  imei: string;
  serialNumber: string;
};

type DraftMobile = {
  id: string;
  platform: "IOS" | "ANDROID";
  mobileName: string;
  storage: string;
  ram: string;
  color: string;
  units: DraftUnit[];
  purchasePrice: string;
};

const MAX_QTY = 30;
const blankUnit = (): DraftUnit => ({ imei: "", serialNumber: "" });

function clampQty(value: number) {
  return Math.min(MAX_QTY, Math.max(1, Math.floor(value) || 1));
}

function resizeUnits(units: DraftUnit[], qty: number) {
  const n = clampQty(qty);
  if (n === units.length) return units;
  if (n < units.length) return units.slice(0, n);
  return [
    ...units,
    ...Array.from({ length: n - units.length }, () => blankUnit()),
  ];
}

function cleanId(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function draftUnits(draft: DraftMobile) {
  return draft.units.map((unit) => ({
    imei: cleanId(unit.imei),
    serialNumber: cleanId(unit.serialNumber),
  }));
}

function expandDrafts(drafts: DraftMobile[]) {
  return drafts.flatMap((item) =>
    draftUnits(item).map((unit) => ({ ...item, ...unit })),
  );
}

function blankDraft(prefill?: PurchasePrefill | null): DraftMobile {
  return {
    id: crypto.randomUUID(),
    platform: prefill?.platform || "IOS",
    mobileName: prefill?.mobileName || "",
    storage: prefill?.storage || "",
    ram: prefill?.platform === "IOS" ? "" : prefill?.ram || "",
    color: prefill?.color || "",
    units: [blankUnit()],
    purchasePrice: "",
  };
}

function unitLabel(unit: { imei: string; serialNumber: string }) {
  if (unit.imei && unit.serialNumber) {
    return `${unit.imei} · SN ${unit.serialNumber}`;
  }
  return unit.imei || unit.serialNumber || "";
}

function draftSummaryParts(draft: DraftMobile) {
  const product = [
    draft.mobileName.trim() || "Untitled",
    draft.color.trim() || null,
    draft.storage.trim() || null,
    draft.platform === "ANDROID" && draft.ram.trim() ? draft.ram.trim() : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const units = draftUnits(draft);
  const labeled = units.map(unitLabel).filter(Boolean);
  const idLabel =
    labeled.length > 1
      ? `${labeled.length} units`
      : labeled[0] || "";
  return { product, imei: idLabel, qty: draft.units.length };
}

type DraftIssue =
  | { type: "missing_id"; unitIndex: number }
  | { type: "error"; message: string };

function validateDraft(draft: DraftMobile): DraftIssue | null {
  if (!draft.mobileName.trim()) {
    return { type: "error", message: "Mobile name is required" };
  }
  if (!draft.storage.trim()) {
    return { type: "error", message: "Storage is required" };
  }
  if (!draft.color.trim()) {
    return { type: "error", message: "Color is required" };
  }
  if (draft.platform === "ANDROID" && !draft.ram.trim()) {
    return { type: "error", message: "RAM is required for Android mobiles" };
  }
  const units = draftUnits(draft);
  for (let i = 0; i < units.length; i++) {
    const { imei, serialNumber } = units[i];
    if (!imei && !serialNumber) {
      return { type: "missing_id", unitIndex: i };
    }
    if (imei && imei.length < 8) {
      return {
        type: "error",
        message:
          units.length > 1
            ? `IMEI ${i + 1} must be at least 8 characters`
            : "IMEI must be at least 8 characters",
      };
    }
    if (serialNumber && serialNumber.length < 3) {
      return {
        type: "error",
        message:
          units.length > 1
            ? `Serial ${i + 1} looks too short`
            : "Serial number looks too short",
      };
    }
  }
  const imeis = units.map((u) => u.imei).filter(Boolean);
  const serials = units.map((u) => u.serialNumber).filter(Boolean);
  if (new Set(imeis).size !== imeis.length) {
    return { type: "error", message: "Each IMEI on this mobile must be unique" };
  }
  if (new Set(serials).size !== serials.length) {
    return {
      type: "error",
      message: "Each serial on this mobile must be unique",
    };
  }
  const price = Number(draft.purchasePrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { type: "error", message: "Enter a valid purchase price" };
  }
  return null;
}

function collectClash(
  current: DraftMobile,
  others: DraftMobile[],
): string | null {
  const currentUnits = draftUnits(current);
  const otherUnits = others.flatMap((item) => draftUnits(item));
  const otherImeis = new Set(
    otherUnits.map((u) => u.imei).filter(Boolean),
  );
  const otherSerials = new Set(
    otherUnits.map((u) => u.serialNumber).filter(Boolean),
  );
  for (const unit of currentUnits) {
    if (unit.imei && otherImeis.has(unit.imei)) {
      return `IMEI ${unit.imei} is already in the list above`;
    }
    if (unit.serialNumber && otherSerials.has(unit.serialNumber)) {
      return `Serial ${unit.serialNumber} is already in the list above`;
    }
  }
  return null;
}

export function PurchaseEntryModal({
  condition,
  onClose,
  onCreated,
  fixedSupplier = null,
  prefill = null,
  layout = "modal",
}: {
  condition: "NEW" | "USED";
  onClose: () => void;
  onCreated: (purchase: Purchase) => void;
  fixedSupplier?: Supplier | null;
  prefill?: PurchasePrefill | null;
  layout?: "modal" | "page";
}) {
  const isPage = layout === "page";
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState(fixedSupplier?.id || "");
  const [supplierName, setSupplierName] = useState(fixedSupplier?.name || "");
  const [supplierPhone, setSupplierPhone] = useState(fixedSupplier?.phone || "");
  const [useNewSupplier, setUseNewSupplier] = useState(false);
  const [queued, setQueued] = useState<DraftMobile[]>([]);
  const [draft, setDraft] = useState<DraftMobile>(() => blankDraft(prefill));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idHint, setIdHint] = useState<{
    draftKey: string;
    unitIndex: number;
  } | null>(null);

  useEffect(() => {
    if (fixedSupplier) return;
    let active = true;
    (async () => {
      try {
        const { data } = await api.listSuppliers();
        if (active) setSuppliers(data);
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [fixedSupplier]);

  const supplierOptions = useMemo(
    () =>
      suppliers.map((s) => ({
        value: s.id,
        label: s.name,
        description: s.phone || undefined,
      })),
    [suppliers],
  );

  function clearIdHint() {
    setIdHint(null);
  }

  function promptMissingId(draftKey: string, unitIndex: number, idPrefix: string) {
    setError(null);
    setIdHint({ draftKey, unitIndex });
    if (draftKey !== "current") {
      setExpandedId(draftKey);
    }
    window.setTimeout(() => {
      const field = document.getElementById(`${idPrefix}-imei-${unitIndex}`);
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (field instanceof HTMLInputElement) field.focus();
    }, 80);
  }

  function updateDraft(patch: Partial<DraftMobile>) {
    setDraft((current) => ({ ...current, ...patch }));
    if (idHint?.draftKey === "current" && patch.units) {
      const unit = patch.units[idHint.unitIndex];
      if (unit && (cleanId(unit.imei) || cleanId(unit.serialNumber))) {
        clearIdHint();
      }
    }
  }

  function updateQueued(id: string, patch: Partial<DraftMobile>) {
    setQueued((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    if (idHint?.draftKey === id && patch.units) {
      const unit = patch.units[idHint.unitIndex];
      if (unit && (cleanId(unit.imei) || cleanId(unit.serialNumber))) {
        clearIdHint();
      }
    }
  }

  function addAnother() {
    setError(null);
    clearIdHint();
    if (!fixedSupplier && useNewSupplier && !supplierName.trim()) {
      setError("Supplier name is required");
      return;
    }
    if (!fixedSupplier && useNewSupplier) {
      const phone = supplierPhone.replace(/\D/g, "");
      if (phone.length < 10) {
        setError("Enter a valid 10-digit supplier phone");
        return;
      }
    }
    if (!fixedSupplier && !useNewSupplier && !supplierId) {
      setError("Select a supplier");
      return;
    }
    const issue = validateDraft(draft);
    if (issue?.type === "missing_id") {
      promptMissingId("current", issue.unitIndex, "current");
      return;
    }
    if (issue?.type === "error") {
      setError(issue.message);
      return;
    }
    const clash = collectClash(draft, queued);
    if (clash) {
      setError(clash);
      return;
    }
    setQueued((current) => [
      ...current,
      { ...draft, units: draftUnits(draft) },
    ]);
    setExpandedId(null);
    setDraft(blankDraft());
  }

  function removeCurrentMobile() {
    if (queued.length === 0) return;
    setError(null);
    clearIdHint();
    const previous = queued[queued.length - 1];
    setQueued((current) => current.slice(0, -1));
    setDraft(previous);
    setExpandedId(null);
  }

  function requestConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    clearIdHint();

    if (!fixedSupplier && useNewSupplier && !supplierName.trim()) {
      setError("Supplier name is required");
      return;
    }
    if (!fixedSupplier && useNewSupplier) {
      const phone = supplierPhone.replace(/\D/g, "");
      if (phone.length < 10) {
        setError("Enter a valid 10-digit supplier phone");
        return;
      }
    }
    if (!fixedSupplier && !useNewSupplier && !supplierId) {
      setError("Select a supplier");
      return;
    }

    const issue = validateDraft(draft);
    if (issue?.type === "missing_id") {
      promptMissingId("current", issue.unitIndex, "current");
      return;
    }
    if (issue?.type === "error") {
      setError(issue.message);
      return;
    }

    const clash = collectClash(draft, queued);
    if (clash) {
      setError(clash);
      return;
    }

    for (const item of queued) {
      const queuedIssue = validateDraft(item);
      if (queuedIssue?.type === "missing_id") {
        promptMissingId(item.id, queuedIssue.unitIndex, `q-${item.id}`);
        return;
      }
      if (queuedIssue?.type === "error") {
        setError(`Queued mobile: ${queuedIssue.message}`);
        setExpandedId(item.id);
        return;
      }
    }

    setConfirmOpen(true);
  }

  async function savePurchase() {
    const allDrafts = [...queued, { ...draft, units: draftUnits(draft) }];
    const units = expandDrafts(allDrafts);
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.createPurchase({
        supplierId: fixedSupplier?.id || (useNewSupplier ? null : supplierId),
        supplierName: fixedSupplier
          ? null
          : useNewSupplier
            ? supplierName.trim()
            : null,
        supplierPhone: fixedSupplier
          ? null
          : useNewSupplier
            ? supplierPhone.replace(/\D/g, "")
            : null,
        condition,
        items: units.map((item) => ({
          platform: item.platform,
          mobileName: item.mobileName,
          storage: item.storage,
          ram: item.platform === "ANDROID" ? item.ram : "",
          color: item.color,
          imei: item.imei,
          serialNumber: item.serialNumber,
          purchasePrice: Number(item.purchasePrice),
        })),
      });
      invalidatePhoneModelCache();
      onCreated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save purchase");
      setSaving(false);
    }
  }

  const allMobiles = useMemo(
    () => [...queued, draft],
    [queued, draft],
  );
  const confirmItems = useMemo(
    () =>
      expandDrafts(allMobiles).map((item) => {
        const parts = draftSummaryParts(item);
        return {
          product: parts.product,
          imei: unitLabel(item),
          price: Number(item.purchasePrice) || 0,
        };
      }),
    [allMobiles],
  );
  const unitCount = confirmItems.length;
  const purchaseTotal = useMemo(
    () =>
      allMobiles.reduce((sum, item) => {
        const price = Number(item.purchasePrice);
        const qty = item.units.length || 1;
        return sum + (Number.isFinite(price) ? price * qty : 0);
      }, 0),
    [allMobiles],
  );
  const summarySupplierName = useMemo(() => {
    if (fixedSupplier?.name) return fixedSupplier.name;
    if (useNewSupplier) return supplierName.trim() || null;
    return suppliers.find((s) => s.id === supplierId)?.name || null;
  }, [
    fixedSupplier?.name,
    useNewSupplier,
    supplierName,
    suppliers,
    supplierId,
  ]);

  const confirmDialog = confirmOpen ? (
    <SavePurchaseConfirmModal
      supplierName={summarySupplierName || ""}
      condition={condition}
      items={confirmItems}
      total={purchaseTotal}
      saving={saving}
      error={error}
      onCancel={() => {
        if (saving) return;
        setConfirmOpen(false);
      }}
      onConfirm={() => void savePurchase()}
    />
  ) : null;

  if (isPage) {
    return (
      <>
      <form
        onSubmit={requestConfirm}
        className="w-full pb-10"
      >
        <BackButton className="mb-4" onClick={onClose} disabled={saving}>
          Back to stock
        </BackButton>

        <div className="mb-[18px]">
          <h1 className="flex flex-wrap items-center gap-3 font-display text-[30px] font-bold tracking-[-0.02em] text-ink-900">
            Add mobile
            <span
              className={clsx(
                "rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-white",
                condition === "USED" ? "bg-[#B76E00]" : "bg-[#0E9E76]",
              )}
            >
              {condition === "USED" ? "Second hand" : "New"}
            </span>
          </h1>
          <p className="mt-1 max-w-[60ch] text-sm text-ink-300">
            Record a purchase from a supplier. Add one or more phones — the
            total purchase cost tallies on the right.
          </p>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            {/* Supplier */}
            <section className="relative z-10 overflow-visible rounded-[16px] border border-ink-100 bg-white p-5 shadow-soft">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2.5 font-display text-base font-semibold text-ink-900">
                  <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-[#EEF2F8] text-ink-500">
                    <Store className="h-[15px] w-[15px]" />
                  </span>
                  Supplier
                </h2>
                {!fixedSupplier ? (
                  <div className="inline-flex gap-0.5 rounded-[11px] bg-[#EBEDF1] p-1">
                    <button
                      type="button"
                      className={clsx(
                        "rounded-lg px-4 py-2 text-[13px] font-medium transition",
                        !useNewSupplier
                          ? "bg-white font-semibold text-ink-900 shadow-soft"
                          : "text-ink-500 hover:text-ink-700",
                      )}
                      onClick={() => setUseNewSupplier(false)}
                      disabled={saving}
                    >
                      Existing
                    </button>
                    <button
                      type="button"
                      className={clsx(
                        "rounded-lg px-4 py-2 text-[13px] font-medium transition",
                        useNewSupplier
                          ? "bg-white font-semibold text-ink-900 shadow-soft"
                          : "text-ink-500 hover:text-ink-700",
                      )}
                      onClick={() => setUseNewSupplier(true)}
                      disabled={saving}
                    >
                      New supplier
                    </button>
                  </div>
                ) : null}
              </div>

              {fixedSupplier ? (
                <p className="rounded-[10px] border border-ink-100 bg-[#FBFCFD] px-3.5 py-3 text-sm text-ink-700">
                  <span className="font-semibold text-ink-900">
                    {fixedSupplier.name}
                  </span>
                  {fixedSupplier.phone ? (
                    <span className="text-ink-500"> · {fixedSupplier.phone}</span>
                  ) : null}
                </p>
              ) : useNewSupplier ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      className="label required"
                      htmlFor="purchaseSupplierName"
                    >
                      Supplier name
                    </label>
                    <input
                      id="purchaseSupplierName"
                      className="field"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder="Business / dealer name"
                      required
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label
                      className="label required"
                      htmlFor="purchaseSupplierPhone"
                    >
                      Phone
                    </label>
                    <input
                      id="purchaseSupplierPhone"
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

            {/* Queued mobiles */}
            {queued.map((item, index) => {
              const open = expandedId === item.id;
              const summary = draftSummaryParts(item);
              return (
                <section
                  key={item.id}
                  className="rounded-[16px] border border-ink-100 bg-[#FCFDFE] p-4 shadow-soft sm:p-5"
                >
                  <div
                    className={clsx(
                      "flex items-start justify-between gap-3",
                      open ? "mb-3.5" : "mb-0",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() =>
                        setExpandedId((c) => (c === item.id ? null : item.id))
                      }
                    >
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full bg-[#EEF2F8] px-2.5 py-1 text-xs font-semibold text-ink-500">
                          <ChevronDown
                            className={clsx(
                              "h-3.5 w-3.5 shrink-0 transition",
                              open ? "rotate-180" : "",
                            )}
                          />
                          Mobile {index + 1}
                        </span>
                        <ConditionBadge condition={condition} />
                      </span>
                      {!open ? (
                        <span className="mt-2 block rounded-[10px] border border-ink-100 bg-white px-3 py-2">
                          <span className="block text-[13px] font-semibold leading-snug text-ink-900">
                            {summary.product}
                          </span>
                          {summary.imei ? (
                            <span className="mt-1 block break-all font-mono text-[12px] font-medium leading-snug text-ink-500">
                              {summary.imei}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-300 transition hover:bg-[#FEF3E2] hover:text-[#B76E00]"
                      aria-label={`Remove mobile ${index + 1}`}
                      onClick={() =>
                        setQueued((c) => c.filter((row) => row.id !== item.id))
                      }
                      disabled={saving}
                    >
                      <X className="h-[15px] w-[15px]" />
                    </button>
                  </div>
                  {open ? (
                    <DraftFields
                      draft={item}
                      disabled={saving}
                      idPrefix={`q-${item.id}`}
                      onChange={(patch) => updateQueued(item.id, patch)}
                      forceIdHintUnit={
                        idHint?.draftKey === item.id ? idHint.unitIndex : null
                      }
                      wide
                    />
                  ) : null}
                </section>
              );
            })}

            {/* Current mobile */}
            <section className="overflow-visible rounded-[16px] border border-ink-100 bg-[#FCFDFE] p-4 shadow-soft sm:p-5">
              <div className="mb-3.5 flex items-center justify-between gap-3">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#EEF2F8] px-2.5 py-1 text-xs font-semibold text-ink-500">
                    Mobile {queued.length + 1}
                  </span>
                  <ConditionBadge condition={condition} />
                </span>
                {queued.length > 0 ? (
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-lg text-ink-300 transition hover:bg-[#FEF3E2] hover:text-[#B76E00]"
                    aria-label="Remove current mobile"
                    onClick={removeCurrentMobile}
                    disabled={saving}
                  >
                    <X className="h-[15px] w-[15px]" />
                  </button>
                ) : null}
              </div>
              <DraftFields
                draft={draft}
                disabled={saving}
                idPrefix="current"
                onChange={updateDraft}
                forceIdHintUnit={
                  idHint?.draftKey === "current" ? idHint.unitIndex : null
                }
                wide
              />
            </section>

            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#C6CEDA] bg-transparent px-3 py-3.5 text-sm font-semibold text-ink-500 transition hover:border-[#0E9E76] hover:bg-[#E7F8F1] hover:text-[#0E9E76]"
              onClick={addAnother}
              disabled={saving}
            >
              <Plus className="h-[17px] w-[17px]" strokeWidth={2.2} />
              Add another mobile
            </button>

            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </p>
            ) : null}
          </div>

          {/* Purchase summary rail */}
          <aside className="lg:sticky lg:top-24">
            <div className="overflow-hidden rounded-[16px] border border-ink-100 bg-white shadow-[0_2px_6px_rgba(16,25,40,.06),0_16px_40px_rgba(16,25,40,.10)]">
              <div className="p-5">
                <h2 className="font-display text-[17px] font-semibold text-ink-900">
                  Purchase summary
                </h2>
                <p className="mt-1 mb-3.5 text-[13px] text-ink-300">
                  From{" "}
                  <b className="font-semibold text-ink-900">
                    {summarySupplierName || "— no supplier —"}
                  </b>
                </p>

                <div className="space-y-0">
                  {allMobiles.map((item, index) => {
                    const price = Number(item.purchasePrice);
                    const qty = item.units.length || 1;
                    const label =
                      item.mobileName.trim() || `Mobile ${index + 1}`;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2.5 py-1.5 text-[13px] text-ink-500"
                      >
                        <span className="min-w-0 truncate">
                          {label} × {qty}
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold text-ink-900">
                          {Number.isFinite(price) && price > 0
                            ? formatINR(price * qty)
                            : "₹0.00"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t-2 border-ink-900 pt-3">
                  <span className="text-sm font-semibold text-ink-900">
                    Total purchase
                  </span>
                  <span className="font-display text-2xl font-bold tabular-nums tracking-tight text-ink-900">
                    {formatINR(purchaseTotal)}
                  </span>
                </div>

                <span className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-[#E7F8F1] px-2.5 py-1 text-xs font-semibold text-[#0E9E76]">
                  <Smartphone className="h-3.5 w-3.5" />
                  {unitCount} unit{unitCount === 1 ? "" : "s"}
                </span>
              </div>

              <div className="flex flex-col gap-2.5 border-t border-ink-100 bg-[#FAFBFC] px-5 py-4">
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 py-3.5 text-[15px] font-semibold text-white shadow-soft transition hover:-translate-y-px hover:bg-black disabled:opacity-50"
                  disabled={saving}
                >
                  <Check className="h-[17px] w-[17px]" strokeWidth={2.4} />
                  {saving
                    ? "Saving…"
                    : queued.length
                      ? `Save ${unitCount} mobiles`
                      : "Save purchase"}
                </button>
                <button
                  type="button"
                  className="w-full rounded-xl border border-ink-100 bg-white px-4 py-2.5 text-sm font-semibold text-ink-500 transition hover:bg-[#F4F5F7] hover:text-ink-900"
                  onClick={onClose}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </div>
          </aside>
        </div>
      </form>
      {confirmDialog}
      </>
    );
  }

  const formBody = (
    <>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-ink-100 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              {condition === "NEW" ? "New stock" : "Second-hand stock"}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold text-ink-900">
                Purchase entry
              </h2>
              <span
                className={
                  condition === "USED"
                    ? "rounded-full bg-ember-500 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-soft"
                    : "rounded-full bg-tide-600 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-soft"
                }
              >
                {condition === "USED" ? "Second hand" : "New"}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-ink-300 hover:bg-ink-50"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {fixedSupplier ? (
            <div className="rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-sm">
              <span className="text-ink-500">Supplier · </span>
              <span className="font-semibold text-ink-900">
                {fixedSupplier.name}
              </span>
              {fixedSupplier.phone ? (
                <span className="text-ink-600"> · {fixedSupplier.phone}</span>
              ) : null}
            </div>
          ) : (
            <div className="relative z-10 space-y-2">
              <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-ink-200 bg-ink-50 p-0.5">
                <button
                  type="button"
                  className={
                    !useNewSupplier
                      ? "rounded-md bg-ink-900 px-3 py-2 text-sm font-semibold text-white"
                      : "rounded-md px-3 py-2 text-sm font-medium text-ink-600"
                  }
                  onClick={() => setUseNewSupplier(false)}
                  disabled={saving}
                >
                  Existing
                </button>
                <button
                  type="button"
                  className={
                    useNewSupplier
                      ? "rounded-md bg-ink-900 px-3 py-2 text-sm font-semibold text-white"
                      : "rounded-md px-3 py-2 text-sm font-medium text-ink-600"
                  }
                  onClick={() => setUseNewSupplier(true)}
                  disabled={saving}
                >
                  New supplier
                </button>
              </div>
              {useNewSupplier ? (
                <div className="space-y-2">
                  <div>
                    <label className="label required" htmlFor="purchaseSupplierName">
                      Supplier name
                    </label>
                    <input
                      id="purchaseSupplierName"
                      className="field"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      required
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className="label required" htmlFor="purchaseSupplierPhone">
                      Phone number
                    </label>
                    <input
                      id="purchaseSupplierPhone"
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
                        ? "Select supplier"
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
            </div>
          )}

          {queued.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                Queued ({queued.length})
              </p>
              {queued.map((item, index) => {
                const open = expandedId === item.id;
                const summary = draftSummaryParts(item);
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border border-ink-200 bg-white shadow-sm ${
                      open ? "overflow-visible" : "overflow-hidden"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left"
                      onClick={() =>
                        setExpandedId((c) => (c === item.id ? null : item.id))
                      }
                    >
                      <ChevronDown
                        className={`mt-0.5 h-4 w-4 shrink-0 text-ink-300 transition ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-ink-500">
                            Mobile {index + 1}
                          </span>
                          <ConditionBadge condition={condition} />
                        </span>
                        <span className="mt-0.5 block text-sm font-medium text-ink-900">
                          {summary.product}
                        </span>
                        {summary.imei ? (
                          <span className="mt-0.5 block break-all font-mono text-xs text-ink-500">
                            {summary.imei}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {open ? (
                      <div className="space-y-2 border-t border-ink-200 bg-white px-3 py-3">
                        <DraftFields
                          draft={item}
                          disabled={saving}
                          idPrefix={`q-${item.id}`}
                          onChange={(patch) => updateQueued(item.id, patch)}
                          forceIdHintUnit={
                            idHint?.draftKey === item.id
                              ? idHint.unitIndex
                              : null
                          }
                        />
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-sm text-rose-600"
                          onClick={() =>
                            setQueued((c) => c.filter((row) => row.id !== item.id))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="rounded-xl border border-ink-200 bg-white p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                Mobile {queued.length + 1}
              </p>
              <ConditionBadge condition={condition} />
            </div>
            <DraftFields
              draft={draft}
              disabled={saving}
              idPrefix="current"
              onChange={updateDraft}
              forceIdHintUnit={
                idHint?.draftKey === "current" ? idHint.unitIndex : null
              }
            />
            {queued.length > 0 ? (
              <button
                type="button"
                className="mt-3 inline-flex items-center gap-1 text-sm text-rose-600"
                onClick={removeCurrentMobile}
                disabled={saving}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-ink-100 bg-white px-5 py-3">
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={addAnother}
            disabled={saving}
          >
            <Plus className="h-4 w-4" />
            Add another mobile
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              <Package className="h-4 w-4" />
              {saving
                ? "Saving…"
                : queued.length
                  ? `Save ${unitCount} mobiles`
                  : "Save purchase"}
            </button>
          </div>
        </div>
    </>
  );

  return (
    <>
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !saving && onClose()}
    >
      <motion.form
        onSubmit={requestConfirm}
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/70 bg-white shadow-lift"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(event) => event.stopPropagation()}
      >
        {formBody}
      </motion.form>
    </motion.div>
    {confirmDialog}
    </>
  );
}

function ConditionBadge({ condition }: { condition: "NEW" | "USED" }) {
  const used = condition === "USED";
  return (
    <span
      className={clsx(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
        used ? "bg-[#FEF3E2] text-[#B76E00]" : "bg-[#E7F8F1] text-[#0E9E76]",
      )}
    >
      {used ? "Second hand" : "New"}
    </span>
  );
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
    <div className="inline-flex h-12 min-h-[48px] w-[7.25rem] shrink-0 items-stretch overflow-hidden rounded-[13px] border-[1.5px] border-ink-100 bg-white">
      <button
        type="button"
        className="grid w-9 shrink-0 place-items-center text-ink-700 transition hover:bg-[#F4F7FA] disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Decrease quantity"
        disabled={disabled || qty <= 1}
        onClick={() => onChange(clampQty(qty - 1))}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={2.4} />
      </button>
      <input
        id={id}
        className="w-11 min-w-0 [appearance:textfield] bg-transparent text-center font-display text-sm font-semibold tabular-nums text-ink-900 outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        type="number"
        min={1}
        max={MAX_QTY}
        step={1}
        value={qty}
        aria-label="Quantity"
        onChange={(e) => onChange(clampQty(Number(e.target.value)))}
        disabled={disabled}
      />
      <button
        type="button"
        className="grid w-9 shrink-0 place-items-center text-ink-700 transition hover:bg-[#F4F7FA] disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="Increase quantity"
        disabled={disabled || qty >= MAX_QTY}
        onClick={() => onChange(clampQty(qty + 1))}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
      </button>
    </div>
  );
}

function setDraftQty(draft: DraftMobile, qty: number): Partial<DraftMobile> {
  return { units: resizeUnits(draft.units, qty) };
}

function QuantityAndImeiFields({
  draft,
  disabled,
  idPrefix,
  onChange,
  autoFocusTarget,
  forceIdHintUnit = null,
}: {
  draft: DraftMobile;
  disabled?: boolean;
  idPrefix: string;
  onChange: (patch: Partial<DraftMobile>) => void;
  autoFocusTarget?: "name" | "imei" | null;
  forceIdHintUnit?: number | null;
}) {
  return (
    <>
      <div>
        <label className="label required" htmlFor={`${idPrefix}-price`}>
          Purchase price
        </label>
        <input
          id={`${idPrefix}-price`}
          className="field"
          type="number"
          min="1"
          step="0.01"
          value={draft.purchasePrice}
          onChange={(e) => onChange({ purchasePrice: e.target.value })}
          required
          disabled={disabled}
        />
        {draft.units.length > 1 && Number(draft.purchasePrice) > 0 ? (
          <p className="mt-1 text-[11.5px] text-ink-400">
            Per unit · total{" "}
            {formatINR(Number(draft.purchasePrice) * draft.units.length)}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        {draft.units.map((unit, index) => {
          const showIdHint = forceIdHintUnit === index;
          return (
          <div key={`${idPrefix}-unit-${index}`} className="space-y-2">
            {draft.units.length > 1 ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                Unit {index + 1}
              </p>
            ) : null}
            <div className="group/ids relative grid gap-2 sm:grid-cols-2">
              <div
                role="tooltip"
                className={clsx(
                  "pointer-events-none absolute bottom-[calc(100%+6px)] left-0 z-20 max-w-[min(100%,18rem)] transition duration-150",
                  showIdHint
                    ? "translate-y-0 opacity-100"
                    : "-translate-y-0.5 opacity-0 group-hover/ids:translate-y-0 group-hover/ids:opacity-100 group-focus-within/ids:translate-y-0 group-focus-within/ids:opacity-100",
                )}
              >
                <div className="flex items-start gap-2 rounded-xl border border-[#93C5FD] bg-[#E8F0FE] px-3 py-2 text-[12.5px] font-medium leading-snug text-[#1E40AF] shadow-[0_8px_24px_rgba(16,25,40,.14)]">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
                  <span>Enter IMEI or serial number</span>
                </div>
                <span
                  aria-hidden
                  className="ml-4 block h-2.5 w-2.5 -translate-y-1.5 rotate-45 border-b border-r border-[#93C5FD] bg-[#E8F0FE]"
                />
              </div>
              <div>
                <label
                  className="label"
                  htmlFor={`${idPrefix}-imei-${index}`}
                >
                  IMEI
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={`${idPrefix}-imei-${index}`}
                    className={clsx(
                      "field min-w-0 flex-1 font-mono",
                      showIdHint && "border-[#93C5FD] ring-4 ring-[#93C5FD]/25",
                    )}
                    value={unit.imei}
                    onChange={(e) => {
                      const next = draft.units.map((row, i) =>
                        i === index ? { ...row, imei: e.target.value } : row,
                      );
                      onChange({ units: next });
                    }}
                    placeholder="15-digit IMEI"
                    inputMode="numeric"
                    autoFocus={autoFocusTarget === "imei" && index === 0}
                    disabled={disabled}
                  />
                  <ImeiScanFieldButton
                    disabled={disabled}
                    onScan={(imei) => {
                      const next = draft.units.map((row, i) =>
                        i === index ? { ...row, imei } : row,
                      );
                      onChange({ units: next });
                    }}
                  />
                </div>
              </div>
              <div>
                <label
                  className="label"
                  htmlFor={`${idPrefix}-serial-${index}`}
                >
                  Serial number
                </label>
                <input
                  id={`${idPrefix}-serial-${index}`}
                  className={clsx(
                    "field font-mono",
                    showIdHint && "border-[#93C5FD] ring-4 ring-[#93C5FD]/25",
                  )}
                  value={unit.serialNumber}
                  onChange={(e) => {
                    const next = draft.units.map((row, i) =>
                      i === index
                        ? { ...row, serialNumber: e.target.value }
                        : row,
                    );
                    onChange({ units: next });
                  }}
                  placeholder="Serial / S/N"
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </>
  );
}

function DraftFields({
  draft,
  disabled,
  idPrefix,
  onChange,
  autoFocusTarget = null,
  wide = false,
  forceIdHintUnit = null,
}: {
  draft: DraftMobile;
  disabled?: boolean;
  idPrefix: string;
  onChange: (patch: Partial<DraftMobile>) => void;
  autoFocusTarget?: "name" | "imei" | null;
  wide?: boolean;
  forceIdHintUnit?: number | null;
}) {
  if (wide) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div>
            <span className="label required">Operating system</span>
            <div className="inline-flex w-full gap-0.5 rounded-[11px] bg-[#EBEDF1] p-1 sm:w-auto">
              {(["IOS", "ANDROID"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={clsx(
                    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition sm:flex-none",
                    draft.platform === option
                      ? "bg-ink-900 font-semibold text-white shadow-soft"
                      : "text-ink-500 hover:text-ink-700",
                  )}
                  onClick={() =>
                    onChange(
                      draft.platform === option
                        ? {}
                        : {
                            platform: option,
                            mobileName: "",
                            storage: "",
                            ram: "",
                          },
                    )
                  }
                  disabled={disabled}
                >
                  {option === "IOS" ? "iOS" : "Android"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 items-end gap-2.5">
            <div className="relative min-w-0 flex-1">
              <label className="label required" htmlFor={`${idPrefix}-name`}>
                Mobile name
              </label>
              <MobileNameSearch
                id={`${idPrefix}-name`}
                platform={draft.platform}
                value={draft.mobileName}
                required
                autoFocus={autoFocusTarget === "name"}
                disabled={disabled}
                onChange={(mobileName) =>
                  onChange(
                    mobileName.trim()
                      ? { mobileName }
                      : { mobileName: "", storage: "", ram: "" },
                  )
                }
                onSelectModel={(model: PhoneModel) =>
                  onChange({
                    mobileName: model.name,
                    storage: model.storage,
                    ram: draft.platform === "ANDROID" ? model.ram : "",
                  })
                }
              />
            </div>
            {draft.mobileName.trim() ? (
              <div className="shrink-0">
                <label className="label required" htmlFor={`${idPrefix}-qty`}>
                  Qty
                </label>
                <QuantityStepper
                  id={`${idPrefix}-qty`}
                  value={draft.units.length}
                  disabled={disabled}
                  onChange={(qty) => onChange(setDraftQty(draft, qty))}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={
            draft.platform === "ANDROID"
              ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              : "grid gap-3 sm:grid-cols-2"
          }
        >
          <div>
            <label className="label required" htmlFor={`${idPrefix}-storage`}>
              Storage
            </label>
            <input
              id={`${idPrefix}-storage`}
              className="field"
              value={draft.storage}
              onChange={(e) => onChange({ storage: e.target.value })}
              placeholder="e.g. 128"
              required
              disabled={disabled}
            />
          </div>
          <div>
            <label className="label required" htmlFor={`${idPrefix}-color`}>
              Color
            </label>
            <input
              id={`${idPrefix}-color`}
              className="field"
              value={draft.color}
              onChange={(e) => onChange({ color: e.target.value })}
              required
              disabled={disabled}
            />
          </div>
          {draft.platform === "ANDROID" ? (
            <div>
              <label className="label required" htmlFor={`${idPrefix}-ram`}>
                RAM
              </label>
              <input
                id={`${idPrefix}-ram`}
                className="field"
                value={draft.ram}
                onChange={(e) => onChange({ ram: e.target.value })}
                placeholder="e.g. 8"
                required
                disabled={disabled}
              />
            </div>
          ) : null}
        </div>

        <QuantityAndImeiFields
          draft={draft}
          disabled={disabled}
          idPrefix={idPrefix}
          onChange={onChange}
          autoFocusTarget={autoFocusTarget}
          forceIdHintUnit={forceIdHintUnit}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <span className="label required">Operating system</span>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-ink-100 bg-ink-50/70 p-0.5">
          {(["IOS", "ANDROID"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={
                draft.platform === option
                  ? "rounded-lg bg-ink-900 px-3 py-2 text-sm font-semibold text-white"
                  : "rounded-lg px-3 py-2 text-sm font-semibold text-ink-500"
              }
              onClick={() =>
                onChange(
                  draft.platform === option
                    ? {}
                    : {
                        platform: option,
                        mobileName: "",
                        storage: "",
                        ram: "",
                      },
                )
              }
              disabled={disabled}
            >
              {option === "IOS" ? "iOS" : "Android"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 items-end gap-2.5">
        <div className="relative min-w-0 flex-1">
          <label className="label required" htmlFor={`${idPrefix}-name`}>
            Mobile name
          </label>
          <MobileNameSearch
            id={`${idPrefix}-name`}
            platform={draft.platform}
            value={draft.mobileName}
            required
            autoFocus={autoFocusTarget === "name"}
            disabled={disabled}
            onChange={(mobileName) =>
              onChange(
                mobileName.trim()
                  ? { mobileName }
                  : { mobileName: "", storage: "", ram: "" },
              )
            }
            onSelectModel={(model: PhoneModel) =>
              onChange({
                mobileName: model.name,
                storage: model.storage,
                ram: draft.platform === "ANDROID" ? model.ram : "",
              })
            }
          />
        </div>
        {draft.mobileName.trim() ? (
          <div className="shrink-0">
            <label className="label required" htmlFor={`${idPrefix}-qty`}>
              Qty
            </label>
            <QuantityStepper
              id={`${idPrefix}-qty`}
              value={draft.units.length}
              disabled={disabled}
              onChange={(qty) => onChange(setDraftQty(draft, qty))}
            />
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label required" htmlFor={`${idPrefix}-storage`}>
            Storage
          </label>
          <input
            id={`${idPrefix}-storage`}
            className="field"
            value={draft.storage}
            onChange={(e) => onChange({ storage: e.target.value })}
            placeholder="e.g. 128"
            required
            disabled={disabled}
          />
        </div>
        <div>
          <label className="label required" htmlFor={`${idPrefix}-color`}>
            Color
          </label>
          <input
            id={`${idPrefix}-color`}
            className="field"
            value={draft.color}
            onChange={(e) => onChange({ color: e.target.value })}
            required
            disabled={disabled}
          />
        </div>
      </div>
      {draft.platform === "ANDROID" ? (
        <div>
          <label className="label required" htmlFor={`${idPrefix}-ram`}>
            RAM
          </label>
          <input
            id={`${idPrefix}-ram`}
            className="field"
            value={draft.ram}
            onChange={(e) => onChange({ ram: e.target.value })}
            placeholder="e.g. 8"
            required
            disabled={disabled}
          />
        </div>
      ) : null}
      <QuantityAndImeiFields
        draft={draft}
        disabled={disabled}
        idPrefix={idPrefix}
        onChange={onChange}
        autoFocusTarget={autoFocusTarget}
        forceIdHintUnit={forceIdHintUnit}
      />
    </div>
  );
}

export function PurchaseEntryOverlay(
  props: ComponentProps<typeof PurchaseEntryModal> & { open: boolean },
) {
  const { open, ...rest } = props;
  return (
    <AnimatePresence>{open ? <PurchaseEntryModal {...rest} /> : null}</AnimatePresence>
  );
}
