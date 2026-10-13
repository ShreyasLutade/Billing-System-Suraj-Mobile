import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Boxes, ChevronRight, Loader2, RefreshCw, Smartphone, X } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";

type Scope = "NEW" | "USED" | "ALL";

const OPTIONS: Array<{
  scope: Scope;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { scope: "NEW", label: "New mobiles", hint: "Only new phones in stock", icon: Smartphone },
  { scope: "USED", label: "Old mobiles", hint: "Second-hand & exchange phones", icon: RefreshCw },
  { scope: "ALL", label: "All stock", hint: "New and old together", icon: Boxes },
];

/** Pick which mobiles go in the stock statement PDF, then download it. */
export function StockStatementDialog({ onClose }: { onClose: () => void }) {
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState<Scope | null>(null);
  /** Admin only — cost price column and total. */
  const [includePrice, setIncludePrice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function download(scope: Scope) {
    setBusy(scope);
    setError(null);
    try {
      await api.downloadStockStatement(scope, isAdmin && includePrice);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download stock statement");
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-statement-title"
    >
      <motion.div
        className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-lift dark:bg-surface-elevated"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="stock-statement-title" className="font-display text-base font-semibold text-ink-900">
              Download stock statement
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              PDF of mobiles in the shop, sorted A–Z.
            </p>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
            onClick={onClose}
            disabled={Boolean(busy)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isAdmin ? (
          <label className="mb-3 flex cursor-pointer items-center gap-2.5 rounded-xl bg-ink-50 px-3 py-2.5 dark:bg-white/5">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-tide-500"
              checked={includePrice}
              disabled={Boolean(busy)}
              onChange={(event) => setIncludePrice(event.target.checked)}
            />
            <span className="text-[13px] font-medium text-ink-800">
              Include price
              <span className="block text-[11px] font-normal text-ink-500">
                Adds cost price and total cost to the PDF.
              </span>
            </span>
          </label>
        ) : null}

        <div className="space-y-2">
          {OPTIONS.map(({ scope, label, hint, icon: Icon }) => (
            <button
              key={scope}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void download(scope)}
              className="flex w-full items-center gap-3 rounded-xl border border-ink-100 px-3 py-2.5 text-left transition hover:border-tide-400 hover:bg-tide-100/50 disabled:opacity-60"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-tide-100 text-tide-600 dark:bg-tide-100/30">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900">{label}</span>
                <span className="block text-[11.5px] text-ink-500">{hint}</span>
              </span>
              {busy === scope ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-tide-600" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />
              )}
            </button>
          ))}
        </div>

        {error ? (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </p>
        ) : null}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
