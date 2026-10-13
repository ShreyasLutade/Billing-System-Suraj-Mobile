import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { api } from "../lib/api";

type Props = {
  billId: string;
  invoiceNumber: string;
  onClose: () => void;
};

/**
 * Bill PDF in a popup. Pages are drawn with pdf.js onto canvases because
 * phone browsers (Android Chrome, iOS Safari) won't show a PDF in an iframe.
 */
export function BillPdfViewer({ billId, invoiceNumber, onClose }: Props) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;

    (async () => {
      try {
        // Loaded on demand so pdf.js isn't in the main bundle.
        const [pdfjs, worker] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

        const response = await fetch(api.pdfUrl(billId));
        if (!response.ok) throw new Error("Could not load the bill PDF");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;

        const task = pdfjs.getDocument({ data: bytes });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        const host = pagesRef.current;
        if (cancelled || !host) return;

        host.replaceChildren();
        const cssWidth = host.clientWidth || 360;
        // Extra pixels so text stays sharp when the phone is pinch-zoomed.
        const pixelRatio = Math.min((window.devicePixelRatio || 1) * 1.5, 4);

        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: (cssWidth / base.width) * pixelRatio,
          });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className =
            "block h-auto w-full rounded-md bg-white shadow-[0_2px_10px_rgba(16,25,40,.12)]";
          canvas.setAttribute("aria-label", `Bill ${invoiceNumber}, page ${n}`);
          host.appendChild(canvas);
          const context = canvas.getContext("2d");
          if (!context) continue;
          await page.render({ canvasContext: context, viewport }).promise;
        }
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the bill PDF");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [billId, invoiceNumber]);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-ink-950/60 sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Bill ${invoiceNumber}`}
    >
      <motion.div
        className="flex h-full w-full flex-col overflow-hidden bg-[#EEF0F3] sm:h-[90vh] sm:max-w-3xl sm:rounded-2xl dark:bg-surface-elevated"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-100 bg-white px-4 py-3 dark:bg-surface-elevated">
          <p className="min-w-0 truncate text-sm font-semibold text-ink-900">
            Bill{" "}
            <span className="font-mono font-medium text-tide-600">
              {invoiceNumber}
            </span>
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bill"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-5">
          {status === "loading" ? (
            <div className="flex h-full min-h-[200px] items-center justify-center gap-2 text-sm text-ink-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading bill…
            </div>
          ) : null}
          {status === "error" ? (
            <div className="mx-auto mt-10 max-w-sm rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-center text-sm text-ember-500">
              {error}
            </div>
          ) : null}
          <div
            ref={pagesRef}
            className={status === "ready" ? "mx-auto max-w-[800px] space-y-3" : "mx-auto max-w-[800px] space-y-3 h-0 overflow-hidden"}
          />
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
