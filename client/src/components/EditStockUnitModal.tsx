import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import clsx from "clsx";
import { api, formatStockUnitId } from "../lib/api";
import type { StockItem, Supplier } from "../types";
import { formatCapacityLabel } from "../lib/phoneModelSearch";
import { ImeiScanFieldButton } from "./BarcodeImeiScanner";
import { FieldPicker } from "./FieldPicker";
import { MobileNameSearch } from "./MobileNameSearch";

function mobileNameLabel(
  name: string,
  color: string,
  storage: string,
  ram: string,
  platform: "IOS" | "ANDROID",
) {
  return [
    name.trim(),
    color.trim() || null,
    storage.trim() ? formatCapacityLabel(storage) : "",
    platform === "ANDROID" && ram.trim()
      ? formatCapacityLabel(ram)
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function EditStockUnitModal({
  unit,
  allowSupplierEdit = true,
  onClose,
  onSaved,
}: {
  unit: StockItem;
  allowSupplierEdit?: boolean;
  onClose: () => void;
  onSaved: (item: StockItem) => void;
}) {
  const [platform, setPlatform] = useState<"IOS" | "ANDROID">(
    unit.platform === "ANDROID" ? "ANDROID" : "IOS",
  );
  const [mobileName, setMobileName] = useState(unit.mobileName);
  const [storage, setStorage] = useState(unit.storage || "");
  const [ram, setRam] = useState(unit.ram || "");
  const [color, setColor] = useState(unit.color || "");
  const [purchasePrice, setPurchasePrice] = useState(
    String(unit.purchasePrice ?? ""),
  );
  const [imei, setImei] = useState(unit.imei || "");
  const [serialNumber, setSerialNumber] = useState(unit.serialNumber || "");
  const [supplierId, setSupplierId] = useState(unit.supplierId || "");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowSupplierEdit) return;
    let active = true;
    (async () => {
      try {
        const { data } = await api.listSuppliers();
        if (active) setSuppliers(data);
      } catch {
        // Picker still works with the current supplier id.
      }
    })();
    return () => {
      active = false;
    };
  }, [allowSupplierEdit]);

  useEffect(() => {
    if (!allowSupplierEdit) return;
    if (supplierId || !unit.supplierName) return;
    const match = suppliers.find(
      (s) =>
        s.name.trim().toLowerCase() === unit.supplierName?.trim().toLowerCase(),
    );
    if (match) setSupplierId(match.id);
  }, [allowSupplierEdit, suppliers, supplierId, unit.supplierName]);

  const supplierOptions = useMemo(
    () =>
      suppliers.map((s) => ({
        value: s.id,
        label: s.name,
        description: s.phone || undefined,
      })),
    [suppliers],
  );

  function switchPlatform(next: "IOS" | "ANDROID") {
    if (next === platform) return;
    setPlatform(next);
    setMobileName("");
    setStorage("");
    setRam("");
    setError(null);
  }

  async function save() {
    const name = mobileName.trim();
    const price = Number(purchasePrice);
    const nextImei = imei.replace(/\s+/g, "").trim();
    const nextSerial = serialNumber.replace(/\s+/g, "").trim();
    const nextStorage = storage.trim();
    const nextRam = platform === "ANDROID" ? ram.trim() : "";
    const nextColor = color.trim();

    if (name.length < 2) {
      setError("Enter the mobile name");
      return;
    }
    if (!nextStorage) {
      setError("Select a mobile with storage from the list");
      return;
    }
    if (platform === "ANDROID" && !nextRam) {
      setError("Select a mobile with RAM from the list");
      return;
    }
    if (!nextColor) {
      setError("Enter the color");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError("Enter a purchase price greater than 0");
      return;
    }
    if (!nextImei && !nextSerial) {
      setError("Enter IMEI or serial number");
      return;
    }
    if (nextImei && nextImei.length < 8) {
      setError("IMEI must be at least 8 characters");
      return;
    }
    if (allowSupplierEdit && !supplierId.trim()) {
      setError("Select a supplier");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { data } = await api.updateStockItem(unit.id, {
        mobileName: name,
        platform,
        storage: nextStorage,
        ram: nextRam,
        color: nextColor,
        purchasePrice: price,
        imei: nextImei,
        serialNumber: nextSerial,
        supplierId: allowSupplierEdit
          ? supplierId
          : unit.supplierId || supplierId,
        suppliers:
          !allowSupplierEdit && !unit.supplierId && unit.supplierName
            ? [unit.supplierName]
            : undefined,
      });
      onSaved(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  const unitHeading = mobileNameLabel(
    mobileName || unit.mobileName,
    color || unit.color,
    storage || unit.storage,
    ram || unit.ram,
    platform,
  );
  const capacityHint = [
    storage.trim() ? formatCapacityLabel(storage) : "",
    platform === "ANDROID" && ram.trim()
      ? formatCapacityLabel(ram)
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-3 sm:items-center sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => !saving && onClose()}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-stock-title"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="w-full max-w-lg rounded-2xl border border-white/70 bg-white p-4 shadow-lift dark:border-ink-100 dark:bg-surface-elevated [&_.field]:rounded-xl [&_.field]:px-3 [&_.field]:py-2 [&_.label]:mb-1"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tide-600">
                Edit unit
              </p>
              <h2
                id="edit-stock-title"
                className="mt-0.5 truncate font-display text-lg font-semibold leading-snug text-ink-900"
              >
                {unitHeading}
              </h2>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ink-500">
                {formatStockUnitId(unit)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-50 dark:hover:bg-surface-muted"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            <div>
              <span className="label required">Operating system</span>
              <div className="inline-flex w-full gap-0.5 rounded-[10px] bg-[#EBEDF1] p-0.5 dark:bg-surface-muted">
                {(["IOS", "ANDROID"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={clsx(
                      "inline-flex flex-1 items-center justify-center rounded-lg px-3 py-1.5 text-[13px] transition",
                      platform === option ? "segment-on" : "segment-off",
                    )}
                    onClick={() => switchPlatform(option)}
                    disabled={saving}
                  >
                    {option === "IOS" ? "iOS" : "Android"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label required" htmlFor="edit-stock-name">
                Mobile name
              </label>
              <MobileNameSearch
                id="edit-stock-name"
                platform={platform}
                value={mobileName}
                trailingHint={capacityHint || null}
                compact
                disabled={saving}
                required
                onChange={(next) => {
                  setMobileName(next);
                  if (!next.trim()) {
                    setStorage("");
                    setRam("");
                  }
                }}
                onSelectModel={(model) => {
                  setMobileName(model.name);
                  setStorage(model.storage || "");
                  if (platform === "ANDROID") {
                    setRam(model.ram || "");
                  } else {
                    setRam("");
                  }
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label required" htmlFor="edit-stock-color">
                  Color
                </label>
                <input
                  id="edit-stock-color"
                  className="field"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  disabled={saving}
                  placeholder="e.g. Black"
                  required
                />
              </div>

              <div>
                <label className="label required" htmlFor="edit-stock-price">
                  Purchase price
                </label>
                <input
                  id="edit-stock-price"
                  className="field"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={purchasePrice}
                  onChange={(event) => setPurchasePrice(event.target.value)}
                  disabled={saving}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="label required" htmlFor="edit-stock-imei">
                  IMEI
                </label>
                <div className="flex items-stretch gap-1.5">
                  <input
                    id="edit-stock-imei"
                    className="field min-w-0 flex-1 font-mono"
                    value={imei}
                    onChange={(event) => setImei(event.target.value)}
                    disabled={saving}
                    placeholder="Enter IMEI"
                    inputMode="numeric"
                  />
                  <ImeiScanFieldButton
                    disabled={saving}
                    onScan={setImei}
                    className="min-h-[40px] w-10 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="edit-stock-serial">
                  Serial number
                </label>
                <input
                  id="edit-stock-serial"
                  className="field font-mono"
                  value={serialNumber}
                  onChange={(event) => setSerialNumber(event.target.value)}
                  disabled={saving}
                  placeholder="Optional if IMEI is set"
                />
              </div>
            </div>

            {allowSupplierEdit ? (
              <div>
                <label className="label required">Supplier</label>
                <FieldPicker
                  value={supplierId}
                  onChange={setSupplierId}
                  placeholder={
                    suppliers.length
                      ? "Select supplier…"
                      : "Loading suppliers…"
                  }
                  searchable
                  searchPlaceholder="Search supplier name…"
                  required
                  disabled={saving}
                  options={supplierOptions}
                />
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </p>
          ) : null}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1 !py-2.5"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 !py-2.5"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
