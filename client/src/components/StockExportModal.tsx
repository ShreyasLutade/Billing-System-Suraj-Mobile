import { useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Download,
  RefreshCw,
  Share2,
  Smartphone,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { canSharePdf, savePdfBlob, sharePdfBlob } from "../lib/sharePdf";
import { isShareAbort } from "../lib/shareInvoice";

type Condition = "NEW" | "USED";

type Done = {
  condition: Condition;
  filename: string;
  unitCount: number;
  blob: Blob;
};

/**
 * Stock page → download icon. Pick new or old mobiles, we build the PDF,
 * save it, then offer the share sheet (WhatsApp etc.) with the same file.
 */
export function StockExportModal({ onClose }: { onClose: () => void }) {
  const [working, setWorking] = useState<Condition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  async function build(condition: Condition) {
    setWorking(condition);
    setError(null);
    setNote(null);
    try {
      const result = await api.fetchStockExportPdf(condition);
      savePdfBlob(result.blob, result.filename);
      setDone({
        condition,
        filename: result.filename,
        unitCount: result.unitCount,
        blob: result.blob,
      });

      // Go straight to the share sheet — that's the point of the export.
      if (canSharePdf(result.blob, result.filename)) {
        await share(result.blob, result.filename, condition);
      } else {
        setNote(
          "Saved to your downloads. This browser can’t open the share sheet — send it from WhatsApp.",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not build the stock PDF",
      );
    } finally {
      setWorking(null);
    }
  }

  async function share(blob: Blob, filename: string, condition: Condition) {
    const label = condition === "USED" ? "Old mobiles" : "New mobiles";
    try {
      await sharePdfBlob(
        blob,
        filename,
        `${label} in stock`,
        `${label} in stock — Suraj Mobile`,
      );
    } catch (err) {
      // Dismissing the share sheet isn't a failure.
      if (isShareAbort(err)) return;
      setNote(
        err instanceof Error
          ? err.message
          : "Couldn’t open the share sheet. The PDF is in your downloads.",
      );
    }
  }

  const busy = working !== null;

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !busy && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-export-title"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              Download
            </p>
            <h2
              id="stock-export-title"
              className="mt-1 font-display text-xl font-semibold text-ink-900"
            >
              Stock PDF
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              Which list do you want to share?
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2.5 px-5 py-4">
          <ExportChoice
            icon={<Smartphone className="h-5 w-5" />}
            title="New mobiles"
            subtitle="Every new phone currently in stock"
            working={working === "NEW"}
            disabled={busy}
            onClick={() => build("NEW")}
          />
          <ExportChoice
            icon={<RefreshCw className="h-5 w-5" />}
            title="Old mobiles"
            subtitle="Every second-hand phone currently in stock"
            working={working === "USED"}
            disabled={busy}
            onClick={() => build("USED")}
          />

          {done && !working ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <p className="flex items-center gap-2 font-semibold">
                <Check className="h-4 w-4 shrink-0" />
                {done.unitCount} mobile{done.unitCount === 1 ? "" : "s"} saved
              </p>
              <p className="mt-1 break-all text-[12.5px] text-emerald-700">
                {done.filename}
              </p>
              <button
                type="button"
                className="btn-secondary mt-3 w-full"
                onClick={() => share(done.blob, done.filename, done.condition)}
              >
                <Share2 className="h-4 w-4" />
                Share again
              </button>
            </div>
          ) : null}

          {note ? (
            <p className="rounded-2xl bg-ink-50 px-4 py-3 text-[12.5px] text-ink-600">
              {note}
            </p>
          ) : null}

          {error ? (
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="border-t border-ink-100 px-5 py-4">
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={onClose}
            disabled={busy}
          >
            {done ? "Done" : "Cancel"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ExportChoice({
  icon,
  title,
  subtitle,
  working,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  working: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-3.5 text-left transition hover:border-tide-300 hover:bg-tide-50/60 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tide-100 text-tide-600 dark:bg-tide-100/30 dark:text-tide-400">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink-900">{title}</span>
        <span className="block text-[12.5px] text-ink-500">{subtitle}</span>
      </span>
      {working ? (
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-tide-500" />
      ) : (
        <Download className="h-4 w-4 shrink-0 text-ink-400" />
      )}
    </button>
  );
}
