import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { useVisualViewportStyle } from "../hooks/useVisualViewport";
import { api } from "../lib/api";
import type { Supplier } from "../types";

type Form = { name: string; phone: string; address: string; notes: string };

/**
 * Change a supplier's name, phone, address or notes. Purchases, payments
 * and stock stay linked to the same supplier.
 */
export function EditSupplierModal({
  open,
  supplier,
  onClose,
  onSaved,
}: {
  open: boolean;
  supplier: Pick<Supplier, "id" | "name" | "phone" | "address" | "notes">;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>({ name: "", phone: "", address: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const viewportStyle = useVisualViewportStyle(open);

  // Fresh copy of the saved details every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setForm({
      name: supplier.name,
      phone: supplier.phone || "",
      address: supplier.address || "",
      notes: supplier.notes || "",
    });
    setError(null);
    setSaving(false);
  }, [open, supplier]);

  const set = (patch: Partial<Form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };

  function close() {
    if (!saving) onClose();
  }

  async function save() {
    const name = form.name.trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      setError("Enter the supplier name");
      return;
    }
    const phone = form.phone.replace(/[^\d+]/g, "");
    if (phone && phone.replace(/\D/g, "").length < 10) {
      setError("Enter a 10-digit phone number, or leave it empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateSupplier(supplier.id, {
        name,
        phone: phone || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the supplier");
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/45 p-4"
          style={viewportStyle}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <motion.form
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-supplier-title"
            className="w-full max-w-md rounded-3xl border border-white/70 bg-white shadow-lift dark:border-ink-100 dark:bg-surface-elevated"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div className="min-w-0">
                <h2 id="edit-supplier-title" className="mt-0.5 font-display text-xl font-semibold text-ink-900">
                  Edit supplier
                </h2>
                <p className="mt-0.5 truncate text-sm text-ink-500">{supplier.name}</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
                onClick={close}
                aria-label="Close"
                disabled={saving}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4 text-sm text-ink-600">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-ink-500">Supplier name *</span>
                  <input
                    className="field w-full"
                    value={form.name}
                    onChange={(event) => set({ name: event.target.value })}
                    disabled={saving}
                    autoComplete="off"
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-ink-500">Phone</span>
                  <input
                    className="field w-full"
                    inputMode="tel"
                    maxLength={15}
                    value={form.phone}
                    onChange={(event) => set({ phone: event.target.value })}
                    disabled={saving}
                    autoComplete="off"
                    placeholder="10-digit mobile"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-500">Address</span>
                <input
                  className="field w-full"
                  value={form.address}
                  onChange={(event) => set({ address: event.target.value })}
                  disabled={saving}
                  autoComplete="off"
                  maxLength={300}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-ink-500">Notes</span>
                <input
                  className="field w-full"
                  value={form.notes}
                  onChange={(event) => set({ notes: event.target.value })}
                  disabled={saving}
                  autoComplete="off"
                  maxLength={500}
                />
              </label>
            </div>

            {error ? (
              <p className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={close} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                <Check className="h-4 w-4" />
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
