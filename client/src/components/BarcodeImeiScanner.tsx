import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  BrowserMultiFormatOneDReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { ScanBarcode, X, Flashlight } from "lucide-react";
import clsx from "clsx";

/* ------------------------------------------------------------------ */
/*  Config — MobileII / IMEI on phone boxes is typically Code 128      */
/* ------------------------------------------------------------------ */

const DEV = import.meta.env.DEV;

/** Primary format for IMEI labels; extend only if you confirm other formats. */
export const IMEI_BARCODE_FORMATS = {
  native: ["code_128"] as const,
  zxing: [BarcodeFormat.CODE_128] as const,
};

/** ~18 detect attempts/sec — fast enough without saturating mobile CPU. */
const NATIVE_DETECT_INTERVAL_MS = 55;
const ZXING_SCAN_OPTIONS = {
  delayBetweenScanAttempts: NATIVE_DETECT_INTERVAL_MS,
  delayBetweenScanSuccess: 200,
} as const;

/* ------------------------------------------------------------------ */
/*  IMEI helpers                                                       */
/* ------------------------------------------------------------------ */

/** Extract a 15-digit IMEI run from a barcode payload. */
export function normalizeScannedImei(raw: string) {
  const trimmed = raw.replace(/\s+/g, "").trim();
  const digits = trimmed.replace(/\D/g, "");
  const embedded = digits.match(/\d{15}/);
  if (embedded) return embedded[0];
  if (digits.length >= 15) return digits.slice(0, 15);
  return digits;
}

/** 15 digits + Luhn checksum (GSMA IMEI). */
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

type ScanEngine = "native" | "zxing";

type DevDiagnostics = {
  engine: ScanEngine | "starting";
  barcodeDetectorAvailable: boolean;
  barcodeDetectorNote: string;
  supportedFormats: string[];
  cameraResolution: string;
  frameRate: string;
  lastDetected: boolean;
  lastValidImei: boolean;
  rejectReason: string | null;
};

function logDev(...args: unknown[]) {
  if (DEV) console.log("[ImeiScanner]", ...args);
}

/** Why BarcodeDetector may be missing — helps avoid false alarms during dev. */
function describeBarcodeDetectorSupport() {
  if ("BarcodeDetector" in window) return "available";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) {
    return "unavailable on Windows Chrome/Edge (platform has no native API — ZXing is expected)";
  }
  if (/Linux/i.test(ua)) {
    return "unavailable on Linux Chrome (platform has no native API — ZXing is expected)";
  }
  if (/Firefox/i.test(ua)) {
    return "unavailable in Firefox (ZXing is expected)";
  }
  if (/iPhone|iPad/i.test(ua)) {
    return "unavailable — requires iOS 17.4+ Safari for native path; otherwise ZXing";
  }
  return "unavailable on this browser/platform — using ZXing fallback";
}

/* ------------------------------------------------------------------ */
/*  BarcodeDetector typing (not in all TS libs)                        */
/* ------------------------------------------------------------------ */

type NativeDetector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
type NativeDetectorCtor = {
  new (opts?: { formats?: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};

function getBarcodeDetectorCtor(): NativeDetectorCtor | null {
  return (
    (window as unknown as { BarcodeDetector?: NativeDetectorCtor })
      .BarcodeDetector ?? null
  );
}

async function resolveNativeFormats(
  Detector: NativeDetectorCtor,
): Promise<string[]> {
  const preferred = [...IMEI_BARCODE_FORMATS.native];
  if (!Detector.getSupportedFormats) return preferred;
  try {
    const supported = await Detector.getSupportedFormats();
    logDev("BarcodeDetector formats:", supported);
    const overlap = preferred.filter((f) => supported.includes(f));
    if (overlap.length) return overlap;
    if (supported.includes("code_128")) return ["code_128"];
    return supported.length ? supported : preferred;
  } catch {
    return preferred;
  }
}

const zxingHints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [...IMEI_BARCODE_FORMATS.zxing]],
]);

/* ------------------------------------------------------------------ */
/*  Camera                                                             */
/* ------------------------------------------------------------------ */

async function openRearCamera(): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
    },
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    },
    {
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    },
    { audio: false, video: true },
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not open camera");
}

/** Apply continuous autofocus / zoom only when the browser exposes them. */
async function applyCameraEnhancements(track: MediaStreamTrack) {
  const caps = track.getCapabilities?.() as
    | {
        focusMode?: string[];
        torch?: boolean;
        zoom?: { min?: number; max?: number };
      }
    | undefined;
  if (!caps) return;

  const advanced: MediaTrackConstraintSet[] = [];
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
    advanced.push({ focusMode: "continuous" } as MediaTrackConstraintSet);
  }
  if (advanced.length) {
    try {
      await track.applyConstraints({ advanced });
      logDev("Applied focus constraints");
    } catch {
      /* optional */
    }
  }
}

function logCameraTrack(track: MediaStreamTrack) {
  if (!DEV) return;
  logDev("Camera settings:", track.getSettings?.());
  logDev("Camera capabilities:", track.getCapabilities?.());
}

function formatTrackSettings(track: MediaStreamTrack | undefined) {
  const s = track?.getSettings?.();
  if (!s?.width || !s?.height) return "—";
  return `${s.width}×${s.height}`;
}

function formatTrackFrameRate(track: MediaStreamTrack | undefined) {
  const fps = track?.getSettings?.().frameRate;
  return fps ? `${Math.round(fps)} fps` : "—";
}

/* ------------------------------------------------------------------ */
/*  Modal                                                              */
/* ------------------------------------------------------------------ */

function ImeiScannerModal({
  onClose,
  onScan,
}: {
  onClose: () => void;
  onScan: (imei: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const zxingControls = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectTimerRef = useRef<number | null>(null);
  const isDetectingRef = useRef(false);
  const handledRef = useRef(false);

  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;

  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [engine, setEngine] = useState<ScanEngine | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchable, setTorchable] = useState(false);
  const [canCloseOnBackdrop, setCanCloseOnBackdrop] = useState(false);
  const [devInfo, setDevInfo] = useState<DevDiagnostics>({
    engine: "starting",
    barcodeDetectorAvailable: false,
    barcodeDetectorNote: "—",
    supportedFormats: [],
    cameraResolution: "—",
    frameRate: "—",
    lastDetected: false,
    lastValidImei: false,
    rejectReason: null,
  });

  useEffect(() => {
    const t = window.setTimeout(() => setCanCloseOnBackdrop(true), 400);
    return () => window.clearTimeout(t);
  }, []);

  const stopAll = () => {
    if (detectTimerRef.current != null) {
      window.clearTimeout(detectTimerRef.current);
      detectTimerRef.current = null;
    }
    zxingControls.current?.stop();
    zxingControls.current = null;

    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
      video.removeAttribute("src");
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    isDetectingRef.current = false;
  };

  /** Step 2: barcode detected → normalize → Luhn → accept or continue. */
  const onBarcodeRaw = (raw: string) => {
    if (handledRef.current) return;

    const trimmed = raw?.trim();
    if (!trimmed) return;

    logDev("Barcode detected (raw length):", trimmed.length);

    const normalized = normalizeScannedImei(trimmed);
    const valid = isValidImei(normalized);

    logDev("Normalized digit length:", normalized.length);
    logDev("IMEI valid:", valid);

    if (DEV) {
      setDevInfo((prev) => ({
        ...prev,
        lastDetected: true,
        lastValidImei: valid,
        rejectReason: valid ? null : "IMEI Luhn check failed",
      }));
    }

    if (!valid) {
      return; // keep scanning — barcode was read but not a valid IMEI
    }

    handledRef.current = true;
    navigator.vibrate?.(40);
    stopAll();
    onScanRef.current(normalized);
    onCloseRef.current();
  };

  useEffect(() => {
    handledRef.current = false;
    let cancelled = false;

    const barcodeDetectorAvailable = "BarcodeDetector" in window;
    const barcodeDetectorNote = describeBarcodeDetectorSupport();
    logDev("BarcodeDetector available:", barcodeDetectorAvailable);
    logDev("BarcodeDetector note:", barcodeDetectorNote);
    logDev("Secure context:", window.isSecureContext);

    (async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (cancelled || !videoRef.current) return;
      const video = videoRef.current;

      try {
        const DetectorCtor = getBarcodeDetectorCtor();
        let nativeFormats: string[] = [];
        let useNative = Boolean(DetectorCtor);

        if (DetectorCtor) {
          nativeFormats = await resolveNativeFormats(DetectorCtor);
          if (!nativeFormats.includes("code_128") && nativeFormats.length) {
            logDev("code_128 not in supported list; using:", nativeFormats);
          }
        } else {
          useNative = false;
        }

        if (DEV) {
          setDevInfo((prev) => ({
            ...prev,
            barcodeDetectorAvailable,
            barcodeDetectorNote,
            supportedFormats: nativeFormats,
          }));
        }

        const stream = await openRearCamera();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        await video.play().catch(() => {});

        const track = stream.getVideoTracks()[0];
        logCameraTrack(track);
        await applyCameraEnhancements(track);

        const caps = track?.getCapabilities?.() as
          | { torch?: boolean }
          | undefined;
        if (caps && "torch" in caps) setTorchable(true);

        if (DEV) {
          setDevInfo((prev) => ({
            ...prev,
            cameraResolution: formatTrackSettings(track),
            frameRate: formatTrackFrameRate(track),
          }));
        }

        // ---- Native BarcodeDetector (fast path — iOS 17.4+ Safari, Android/macOS Chrome) ----
        if (useNative && DetectorCtor) {
          const detector = new DetectorCtor({ formats: nativeFormats });
          setEngine("native");
          logDev("Scanner engine: BarcodeDetector");
          if (DEV) {
            setDevInfo((prev) => ({ ...prev, engine: "native" }));
          }
          setStarting(false);

          const scheduleNext = () => {
            if (cancelled || handledRef.current) return;
            detectTimerRef.current = window.setTimeout(
              tick,
              NATIVE_DETECT_INTERVAL_MS,
            );
          };

          const tick = () => {
            if (cancelled || handledRef.current) return;
            if (isDetectingRef.current) {
              scheduleNext();
              return;
            }
            if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
              scheduleNext();
              return;
            }

            isDetectingRef.current = true;
            detector
              .detect(video)
              .then((codes) => {
                if (cancelled || handledRef.current) return;
                const hit = codes.find((c) => c.rawValue?.trim());
                if (hit) onBarcodeRaw(hit.rawValue);
              })
              .catch(() => {})
              .finally(() => {
                isDetectingRef.current = false;
                if (!cancelled && !handledRef.current) scheduleNext();
              });
          };

          scheduleNext();
          return;
        }

        // ---- ZXing fallback (Windows/Linux desktop Chrome, Firefox, older iOS) ----
        setEngine("zxing");
        logDev("Scanner engine: ZXing (Code 128 / 1D reader)");
        if (DEV) {
          setDevInfo((prev) => ({ ...prev, engine: "zxing" }));
        }

        // Use 1D-only reader — avoids MultiFormatReader console spam on every
        // NotFoundException and skips QR/PDF417 decoders we don't need.
        // Call scan() directly; video is already playing (decodeFromVideoElement
        // would call play() again and warn "already playing").
        const reader = new BrowserMultiFormatOneDReader(
          zxingHints,
          ZXING_SCAN_OPTIONS,
        );
        const controls = reader.scan(video, (result) => {
          if (result) onBarcodeRaw(result.getText());
        });
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
        logDev("Camera error:", msg);
        if (/NotAllowedError|Permission/i.test(msg)) {
          setError("Camera permission denied. Allow camera access to scan.");
        } else if (/NotFoundError|DevicesNotFound|No camera/i.test(msg)) {
          setError("No camera found on this device.");
        } else {
          setError(msg);
        }
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
              Scanner
              {engine === "native"
                ? " · native"
                : engine === "zxing"
                  ? " · fallback"
                  : ""}
            </p>
            <h2
              id="imei-scanner-title"
              className="mt-1 font-display text-xl font-semibold text-ink-900"
            >
              Scan IMEI barcode
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              Align the barcode inside the frame on the red line. Scanning starts
              automatically.
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
            className="pointer-events-none absolute inset-[14%] z-10 border border-white/25"
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
          {DEV && !starting && !error ? (
            <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-30 rounded-lg bg-black/70 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-white/90">
              <div>
                engine: {devInfo.engine} · BD:{" "}
                {devInfo.barcodeDetectorAvailable ? "yes" : "no"}
              </div>
              {!devInfo.barcodeDetectorAvailable ? (
                <div className="text-white/70">{devInfo.barcodeDetectorNote}</div>
              ) : null}
              <div>
                cam: {devInfo.cameraResolution} @ {devInfo.frameRate}
              </div>
              <div>
                detected: {devInfo.lastDetected ? "yes" : "no"} · valid IMEI:{" "}
                {devInfo.lastValidImei ? "yes" : "no"}
                {devInfo.rejectReason ? ` · ${devInfo.rejectReason}` : ""}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ink-100 px-5 py-4">
          {torchable ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-ink-100 px-3 py-2 text-sm font-semibold text-ink-600 transition hover:bg-ink-50"
              onClick={() => void toggleTorch()}
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
