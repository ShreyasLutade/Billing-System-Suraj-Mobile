import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Package,
  Plus,
  Smartphone,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { FieldPicker } from "./FieldPicker";
import { SavePurchaseConfirmModal } from "./SavePurchaseConfirmModal";
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

type DraftMobile = {
  id: string;
  platform: "IOS" | "ANDROID";
  mobileName: string;
  storage: string;
  ram: string;
  color: string;
  imei: string;
  purchasePrice: string;
};

function blankDraft(prefill?: PurchasePrefill | null): DraftMobile {
  return {
    id: crypto.randomUUID(),
    platform: prefill?.platform || "IOS",
    mobileName: prefill?.mobileName || "",
    storage: prefill?.storage || "",
    ram: prefill?.platform === "IOS" ? "" : prefill?.ram || "",
    color: prefill?.color || "",
    imei: "",
    purchasePrice: "",
  };
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
  const imei = draft.imei.trim();
  return { product, imei };
}

function validateDraft(draft: DraftMobile): string | null {
  if (!draft.mobileName.trim()) return "Mobile name is required";
  if (!draft.storage.trim()) return "Storage is required";
  if (!draft.color.trim()) return "Color is required";
  if (draft.platform === "ANDROID" && !draft.ram.trim()) {
    return "RAM is required for Android mobiles";
  }
  if (!draft.imei.trim() || draft.imei.trim().length < 8) {
    return "Enter a valid IMEI number";
  }
  const price = Number(draft.purchasePrice);
  if (!Number.isFinite(price) || price <= 0) {
    return "Enter a valid purchase price";
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

  function updateDraft(patch: Partial<DraftMobile>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateQueued(id: string, patch: Partial<DraftMobile>) {
    setQueued((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function addAnother() {
    setError(null);
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
    if (issue) {
      setError(issue);
      return;
    }
    const imei = draft.imei.replace(/\s+/g, "");
    if (queued.some((item) => item.imei.replace(/\s+/g, "") === imei)) {
      setError("This IMEI is already in the list above");
      return;
    }
    setQueued((current) => [...current, { ...draft, imei }]);
    setExpandedId(null);
    setDraft(blankDraft());
  }

  function removeCurrentMobile() {
    if (queued.length === 0) return;
    setError(null);
    const previous = queued[queued.length - 1];
    setQueued((current) => current.slice(0, -1));
    setDraft(previous);
    setExpandedId(null);
  }

  function requestConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);

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
    if (issue) {
      setError(issue);
      return;
    }

    const currentImei = draft.imei.replace(/\s+/g, "");
    if (queued.some((item) => item.imei.replace(/\s+/g, "") === currentImei)) {
      setError("This IMEI is already in the list above");
      return;
    }

    for (const item of queued) {
      const queuedIssue = validateDraft(item);
      if (queuedIssue) {
        setError(`Queued mobile: ${queuedIssue}`);
        setExpandedId(item.id);
        return;
      }
    }

    setConfirmOpen(true);
  }

  async function savePurchase() {
    const currentImei = draft.imei.replace(/\s+/g, "");
    const allDrafts = [...queued, { ...draft, imei: currentImei }];
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
        items: allDrafts.map((item) => ({
          platform: item.platform,
          mobileName: item.mobileName,
          storage: item.storage,
          ram: item.platform === "ANDROID" ? item.ram : "",
          color: item.color,
          imei: item.imei,
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
      allMobiles.map((item) => {
        const parts = draftSummaryParts(item);
        return {
          product: parts.product,
          imei: parts.imei.replace(/\s+/g, ""),
          price: Number(item.purchasePrice) || 0,
        };
      }),
    [allMobiles],
  );
  const purchaseTotal = useMemo(
    () =>
      allMobiles.reduce((sum, item) => {
        const price = Number(item.purchasePrice);
        return sum + (Number.isFinite(price) ? price : 0);
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
            <section className="overflow-visible rounded-[16px] border border-ink-100 bg-white p-5 shadow-soft">
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
                              IMEI {summary.imei}
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
                      wide
                    />
                  ) : null}
                </section>
              );
            })}

            {/* Current mobile */}
            <section className="rounded-[16px] border border-ink-100 bg-[#FCFDFE] p-4 shadow-soft sm:p-5">
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
                autoFocusTarget={prefill?.mobileName ? "imei" : "name"}
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
                    const label =
                      item.mobileName.trim() || `Mobile ${index + 1}`;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2.5 py-1.5 text-[13px] text-ink-500"
                      >
                        <span className="min-w-0 truncate">{label}</span>
                        <span className="shrink-0 tabular-nums font-semibold text-ink-900">
                          {Number.isFinite(price) && price > 0
                            ? formatINR(price)
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
                  {allMobiles.length} unit{allMobiles.length === 1 ? "" : "s"}
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
                      ? `Save ${queued.length + 1} mobiles`
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
            <div className="space-y-2">
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
                            IMEI {summary.imei}
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
              autoFocusTarget={prefill?.mobileName ? "imei" : "name"}
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
                  ? `Save ${queued.length + 1} mobiles`
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

function DraftFields({
  draft,
  disabled,
  idPrefix,
  onChange,
  autoFocusTarget = null,
  wide = false,
}: {
  draft: DraftMobile;
  disabled?: boolean;
  idPrefix: string;
  onChange: (patch: Partial<DraftMobile>) => void;
  autoFocusTarget?: "name" | "imei" | null;
  wide?: boolean;
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
          <div>
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

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label required" htmlFor={`${idPrefix}-imei`}>
              IMEI
            </label>
            <input
              id={`${idPrefix}-imei`}
              className="field font-mono"
              value={draft.imei}
              onChange={(e) => onChange({ imei: e.target.value })}
              required
              autoFocus={autoFocusTarget === "imei"}
              disabled={disabled}
            />
          </div>
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
          </div>
        </div>
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
      <div>
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label required" htmlFor={`${idPrefix}-imei`}>
            IMEI
          </label>
          <input
            id={`${idPrefix}-imei`}
            className="field font-mono"
            value={draft.imei}
            onChange={(e) => onChange({ imei: e.target.value })}
            required
            autoFocus={autoFocusTarget === "imei"}
            disabled={disabled}
          />
        </div>
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
        </div>
      </div>
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
