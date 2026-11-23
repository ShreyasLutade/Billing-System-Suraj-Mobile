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

const MAX_PAGE_WIDTH = 800;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** Canvas pixel width cap — keeps phones from running out of memory. */
const MAX_CANVAS_WIDTH = 3200;

/**
 * Bill PDF in a popup. Pages are drawn with pdf.js onto canvases because
 * phone browsers (Android Chrome, iOS Safari) won't show a PDF in an iframe.
 *
 * Zoom happens inside the scroll area only (pinch, trackpad pinch,
 * Ctrl+scroll) — the browser's page zoom is blocked there, so the header
 * and its close button never scale or drift off screen.
 */
export function BillPdfViewer({ billId, invoiceNumber, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
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

  // Pinch / Ctrl+wheel zoom around the fingers (or cursor).
  useEffect(() => {
    const scroller = scrollRef.current;
    const pages = pagesRef.current;
    if (!scroller || !pages) return;

    function applyZoom(next: number, focusX: number, focusY: number) {
      const prev = zoomRef.current;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      if (zoom === prev || !scroller || !pages) return;
      const rect = scroller.getBoundingClientRect();
      const mx = focusX - rect.left;
      const my = focusY - rect.top;
      // Point under the focus, in unzoomed page coordinates.
      const contentX = (scroller.scrollLeft + mx - pages.offsetLeft) / prev;
      const contentY = (scroller.scrollTop + my - pages.offsetTop) / prev;

      zoomRef.current = zoom;
      pages.style.width = `${zoom * 100}%`;
      pages.style.maxWidth = `${MAX_PAGE_WIDTH * zoom}px`;

      scroller.scrollLeft = contentX * zoom + pages.offsetLeft - mx;
      scroller.scrollTop = contentY * zoom + pages.offsetTop - my;
    }

    let pinch: { distance: number; zoom: number } | null = null;
    const distance = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length === 2) {
        pinch = { distance: distance(event.touches), zoom: zoomRef.current };
      }
    }
    function onTouchMove(event: TouchEvent) {
      if (event.touches.length !== 2 || !pinch) return;
      event.preventDefault(); // stop the browser zooming the whole page
      const t = event.touches;
      applyZoom(
        pinch.zoom * (distance(t) / pinch.distance),
        (t[0].clientX + t[1].clientX) / 2,
        (t[0].clientY + t[1].clientY) / 2,
      );
    }
    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) pinch = null;
    }
    function onWheel(event: WheelEvent) {
      // Trackpad pinch and Ctrl+scroll both arrive as ctrl+wheel.
      if (!event.ctrlKey) return;
      event.preventDefault();
      applyZoom(
        zoomRef.current * Math.exp(-event.deltaY * 0.01),
        event.clientX,
        event.clientY,
      );
    }
    // iOS Safari fires its own gesture events for page zoom.
    const blockGesture = (event: Event) => event.preventDefault();

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("gesturestart", blockGesture);
    scroller.addEventListener("gesturechange", blockGesture);
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("gesturestart", blockGesture);
      scroller.removeEventListener("gesturechange", blockGesture);
    };
  }, []);

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
        const cssWidth = Math.min(host.clientWidth || 360, MAX_PAGE_WIDTH);
        // Drawn larger than shown so text stays sharp when zoomed in.
        const targetWidth = Math.min(
          cssWidth * (window.devicePixelRatio || 1) * 2.5,
          MAX_CANVAS_WIDTH,
        );

        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: targetWidth / base.width });
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
        <div className="flex shrink-0 touch-none items-center justify-between gap-3 border-b border-ink-100 bg-white px-4 py-3 dark:bg-surface-elevated">
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

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-5"
          // Browser keeps one-finger scrolling; pinch is ours.
          style={{ touchAction: "pan-x pan-y" }}
        >
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
            className={
              status === "ready"
                ? "mx-auto space-y-3"
                : "mx-auto h-0 space-y-3 overflow-hidden"
            }
            style={{ width: "100%", maxWidth: MAX_PAGE_WIDTH }}
          />
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
