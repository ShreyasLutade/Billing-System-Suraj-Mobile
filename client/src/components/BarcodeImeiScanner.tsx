import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { ScanBarcode, X, Flashlight } from "lucide-react";
import clsx from "clsx";

/* ------------------------------------------------------------------ */
/*  IMEI helpers                                                       */
/* ------------------------------------------------------------------ */

export function normalizeScannedImei(raw: string) {
  const trimmed = raw.replace(/\s+/g, "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 15) return digits.slice(0, 15);
  if (digits.length >= 8) return digits;
  return trimmed;
}

/** 15 digits + Luhn check. Rejects misreads and the serial-number
 *  barcode that also sits on the box, so we lock onto the real IMEI. */
export function isValidImei(value: string) {
  const s = value.replace(/\D/g, "");
  if (!/^\d{15}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(s[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Only the 1D formats phone boxes actually use — massively faster. */
const ZXING_HINTS = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13],
  ],
]);
const NATIVE_FORMATS = ["code_128", "code_39", "ean_13"] as const;

/* Minimal typing for the native BarcodeDetector (not in TS lib yet). */
type NativeDetector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
type NativeDetectorCtor = {
  new (opts?: { formats?: readonly string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

/* ------------------------------------------------------------------ */
/*  Modal                                                              */
/* ------------------------------------------------------------------ */

function ImeiScannerModal({
  onClose,
  onScan,
  /** If your labels are noisy, require a valid 15-digit IMEI before accepting.
   *  Set false to accept any 8+ digit code. */
  requireValidImei = true,
}: {
  onClose: () => void;
  onScan: (imei: string) => void;
  requireValidImei?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const zxingControls = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const handledRef = useRef(false);

  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchable, setTorchable] = useState(false);
  const [canCloseOnBackdrop, setCanCloseOnBackdrop] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setCanCloseOnBackdrop(true), 400);
    return () => window.clearTimeout(t);
  }, []);

  const accept = (raw: string) => {
    if (handledRef.current) return;
    const value = normalizeScannedImei(raw);
    if (requireValidImei ? !isValidImei(value) : value.length < 8) return; // keep scanning
    handledRef.current = true;
    navigator.vibrate?.(60);
    stopAll();
    onScanRef.current(value);
    onCloseRef.current();
  };

  const stopAll = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    zxingControls.current?.stop();
    zxingControls.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    handledRef.current = false;
    let cancelled = false;

    (async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (cancelled || !videoRef.current) return;
      const video = videoRef.current;

      try {
        const Detector = (window as unknown as {
          BarcodeDetector?: NativeDetectorCtor;
        }).BarcodeDetector;

        // ---------- Path A: native BarcodeDetector (fast) ----------
        let useNative = false;
        if (Detector) {
          try {
            const supported = (await Detector.getSupportedFormats?.()) ?? [];
            useNative =
              supported.length === 0 ||
              supported.some((f) => NATIVE_FORMATS.includes(f as never));
          } catch {
            useNative = true; // assume ok if query fails
          }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play().catch(() => {});

        // torch capability
        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as
          | { torch?: boolean }
          | undefined;
        if (caps && "torch" in caps) setTorchable(true);

        if (useNative && Detector) {
          const detector = new Detector({ formats: NATIVE_FORMATS });
          setEngine("native");
          setStarting(false);
          const loop = async () => {
            if (cancelled || handledRef.current) return;
            try {
              const codes = await detector.detect(video);
              if (codes[0]) accept(codes[0].rawValue);
            } catch {
              /* transient frame errors — ignore */
            }
            if (!cancelled && !handledRef.current)
              rafRef.current = requestAnimationFrame(loop);
          };
          rafRef.current = requestAnimationFrame(loop);
          return;
        }

        // ---------- Path B: ZXing fallback (hinted) ----------
        setEngine("zxing");
        const reader = new BrowserMultiFormatReader(ZXING_HINTS);
        const controls = await reader.decodeFromVideoElement(
          video,
          (result) => {
            if (result) accept(result.getText());
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        zxingControls.current = controls;
        setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        const msg =
          err instanceof Error ? err.message : "Could not open camera";
        if (/NotAllowedError|Permission/i.test(msg))
          setError("Camera permission denied. Allow camera access to scan.");
        else if (/NotFoundError|DevicesNotFound|No camera/i.test(msg))
          setError("No camera found on this device.");
        else setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    try {
      await track?.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet],
      });
      setTorchOn((v) => !v);
    } catch {
      /* unsupported */
    }
  };

  const requestClose = () => {
    stopAll();
    onCloseRef.current();
  };

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-ink-950/55 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => canCloseOnBackdrop && requestClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="imei-scanner-title"
        className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              Scanner {engine === "native" ? "· fast" : ""}
            </p>
            <h2
              id="imei-scanner-title"
              className="mt-1 font-display text-xl font-semibold text-ink-900"
            >
              Scan IMEI barcode
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              Align the barcode with the red line in the center.
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            onClick={requestClose}
            aria-label="Close scanner"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative aspect-[3/4] overflow-hidden bg-ink-950 sm:aspect-[4/3]">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
            autoPlay
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2"
          >
            <div className="mx-5 h-[3px] rounded-full bg-red-500 shadow-[0_0_12px_2px_rgba(239,68,68,.9)]" />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[16%] z-10 border border-white/20"
          >
            <span className="absolute -left-0.5 -top-0.5 h-7 w-7 border-l-[3px] border-t-[3px] border-red-500" />
            <span className="absolute -right-0.5 -top-0.5 h-7 w-7 border-r-[3px] border-t-[3px] border-red-500" />
            <span className="absolute -bottom-0.5 -left-0.5 h-7 w-7 border-b-[3px] border-l-[3px] border-red-500" />
            <span className="absolute -bottom-0.5 -right-0.5 h-7 w-7 border-b-[3px] border-r-[3px] border-red-500" />
          </div>
          {starting && !error ? (
            <div className="absolute inset-0 z-20 grid place-items-center bg-ink-950/70 text-sm font-medium text-white">
              Starting camera…
            </div>
          ) : null}
          {error ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink-950/80 p-6 text-center text-sm font-medium text-white">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ink-100 px-5 py-4">
          {torchable ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-ink-100 px-3 py-2 text-sm font-semibold text-ink-600 transition hover:bg-ink-50"
              onClick={toggleTorch}
            >
              <Flashlight className="h-4 w-4" />
              {torchOn ? "Torch off" : "Torch on"}
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="btn-secondary" onClick={requestClose}>
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function ImeiScanFieldButton({
  onScan,
  disabled,
  className,
}: {
  onScan: (imei: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();

  return (
    <>
      <button
        type="button"
        id={labelId}
        className={clsx(
          "grid min-h-[46px] w-11 shrink-0 place-items-center self-stretch rounded-2xl border border-ink-100 bg-white text-ink-600 transition hover:border-tide-400 hover:bg-tide-50 hover:text-tide-700 disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        aria-label="Scan IMEI barcode"
        title="Scan IMEI barcode"
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <ScanBarcode className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </button>
      {open ? (
        <ImeiScannerModal onClose={() => setOpen(false)} onScan={onScan} />
      ) : null}
    </>
  );
}