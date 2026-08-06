import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Plus, Smartphone, X } from "lucide-react";
import { api } from "../lib/api";
import type { MobileCatalog } from "../types";

export function AddMobileModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (mobile: MobileCatalog) => void;
}) {
  const [condition, setCondition] = useState<"NEW" | "USED">("NEW");
  const [platform, setPlatform] = useState<"IOS" | "ANDROID">("IOS");
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [storage, setStorage] = useState("");
  const [ram, setRam] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.createMobile({
        name,
        platform,
        condition,
        color,
        storage,
        ram: platform === "ANDROID" ? ram : "",
      });
      onCreated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add mobile");
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !saving && onClose()}
    >
      <motion.form
        onSubmit={(event) => void submit(event)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-mobile-title"
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-tide-100 p-2 text-tide-600">
              <Smartphone className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
                Mobile catalog
              </p>
              <h2
                id="add-mobile-title"
                className="mt-1 font-display text-xl font-semibold text-ink-900"
              >
                Add new mobile
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <span className="label required">Condition</span>
            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-ink-100 bg-ink-50/70 p-1">
              {(
                [
                  { value: "NEW", label: "New Mobile" },
                  { value: "USED", label: "Second Hand" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    condition === option.value
                      ? "rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white shadow-soft"
                      : "rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-500 transition hover:bg-white"
                  }
                  aria-pressed={condition === option.value}
                  onClick={() => setCondition(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label required">Operating system</span>
            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-ink-100 bg-ink-50/70 p-1">
              {(["IOS", "ANDROID"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={
                    platform === option
                      ? "rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white shadow-soft"
                      : "rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-500 transition hover:bg-white"
                  }
                  aria-pressed={platform === option}
                  onClick={() => {
                    setPlatform(option);
                    if (option === "IOS") setRam("");
                  }}
                >
                  {option === "IOS" ? "iOS" : "Android"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label required" htmlFor="mobileName">
              Phone name
            </label>
            <input
              id="mobileName"
              className="field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                platform === "IOS" ? "e.g. iPhone 15" : "e.g. Samsung S24"
              }
              required
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label required" htmlFor="mobileColor">
                Color
              </label>
              <input
                id="mobileColor"
                className="field"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                placeholder="e.g. Black"
                required
              />
            </div>
            <div>
              <label className="label required" htmlFor="mobileStorage">
                Storage
              </label>
              <input
                id="mobileStorage"
                className="field"
                value={storage}
                onChange={(event) => setStorage(event.target.value)}
                placeholder="e.g. 128 GB"
                required
              />
            </div>
          </div>

          {platform === "ANDROID" ? (
            <div>
              <label className="label required" htmlFor="mobileRam">
                RAM
              </label>
              <input
                id="mobileRam"
                className="field"
                value={ram}
                onChange={(event) => setRam(event.target.value)}
                placeholder="e.g. 8 GB"
                required
              />
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            <Plus className="h-4 w-4" />
            {saving ? "Adding…" : "Add mobile"}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
