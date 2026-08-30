import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { api, formatStockUnitId } from "../lib/api";
import type { StockItem, Supplier } from "../types";
import { FieldPicker } from "./FieldPicker";
import { MobileNameSearch } from "./MobileNameSearch";

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
  const [mobileName, setMobileName] = useState(unit.mobileName);
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
      (s) => s.name.trim().toLowerCase() === unit.supplierName?.trim().toLowerCase(),
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

  async function save() {
    const name = mobileName.trim();
    const price = Number(purchasePrice);
    const nextImei = imei.replace(/\s+/g, "").trim();
    const nextSerial = serialNumber.replace(/\s+/g, "").trim();

    if (name.length < 2) {
      setError("Enter the mobile name");
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
        purchasePrice: price,
        imei: nextImei,
        serialNumber: nextSerial,
        supplierId,
      });
      onSaved(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
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
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/70 bg-white p-5 shadow-lift dark:border-ink-100 dark:bg-surface-elevated sm:p-6"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-tide-600">
                Edit unit
              </p>
              <h2
                id="edit-stock-title"
                className="mt-1 font-display text-xl font-semibold text-ink-900"
              >
                {unit.mobileName}
              </h2>
              <p className="mt-1 font-mono text-xs text-ink-500">
                {formatStockUnitId(unit)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-xl p-2 text-ink-500 hover:bg-ink-50 dark:hover:bg-surface-muted"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="label required" htmlFor="edit-stock-name">
                Mobile name
              </label>
              <MobileNameSearch
                id="edit-stock-name"
                platform={unit.platform}
                value={mobileName}
                disabled={saving}
                required
                onChange={setMobileName}
                onSelectModel={(model) => setMobileName(model.name)}
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

            <div>
              <label className="label required" htmlFor="edit-stock-imei">
                IMEI
              </label>
              <input
                id="edit-stock-imei"
                className="field font-mono"
                value={imei}
                onChange={(event) => setImei(event.target.value)}
                disabled={saving}
                placeholder="Enter IMEI"
              />
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
            <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
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
