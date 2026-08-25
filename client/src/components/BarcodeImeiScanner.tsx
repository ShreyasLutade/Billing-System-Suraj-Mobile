import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { ScanBarcode, X } from "lucide-react";
import clsx from "clsx";

/** Prefer digits for IMEI barcodes; keep cleaned text as fallback. */
export function normalizeScannedImei(raw: string) {
  const trimmed = raw.replace(/\s+/g, "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 15) return digits.slice(0, 15);
  if (digits.length >= 8) return digits;
  return trimmed;
}

function ImeiScannerModal({
  onClose,
  onScan,
}: {
  onClose: () => void;
  onScan: (imei: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const handledRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  /** Ignore backdrop clicks from the same gesture that opened the modal. */
  const [canCloseOnBackdrop, setCanCloseOnBackdrop] = useState(false);

  onScanRef.current = onScan;
  onCloseRef.current = onClose;

  useEffect(() => {
    const timer = window.setTimeout(() => setCanCloseOnBackdrop(true), 400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    handledRef.current = false;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    const onDecode = (result: { getText: () => string } | undefined) => {
      if (!result || handledRef.current || cancelled) return;
      const value = normalizeScannedImei(result.getText());
      if (value.length < 8) return;
      handledRef.current = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      onScanRef.current(value);
      onCloseRef.current();
    };

    (async () => {
      // Let the video element attach before starting the stream.
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      if (cancelled || !videoRef.current) return;

      try {
        let controls: IScannerControls | null = null;

        // 1) Prefer rear / environment camera (phones).
        try {
          controls = await reader.decodeFromConstraints(
            { video: { facingMode: { exact: "environment" } } },
            videoRef.current,
            onDecode,
          );
        } catch {
          // ignore — try softer preference next
        }

        // 2) Soft preference for environment, then match by device label.
        if (!controls && !cancelled && videoRef.current) {
          try {
            controls = await reader.decodeFromConstraints(
              { video: { facingMode: { ideal: "environment" } } },
              videoRef.current,
              onDecode,
            );
          } catch {
            // ignore
          }
        }

        if (!controls && !cancelled && videoRef.current) {
          try {
            const devices =
              await BrowserMultiFormatReader.listVideoInputDevices();
            const backCam = devices.find((device) =>
              /back|rear|environment|trás|arrière|後|후면/i.test(
                device.label || "",
              ),
            );
            controls = await reader.decodeFromVideoDevice(
              backCam?.deviceId,
              videoRef.current,
              onDecode,
            );
          } catch {
            // ignore
          }
        }

        // 3) Last resort: any available camera (e.g. laptop webcam).
        if (!controls && !cancelled && videoRef.current) {
          controls = await reader.decodeFromVideoDevice(
            undefined,
            videoRef.current,
            onDecode,
          );
        }

        if (!controls) {
          throw new Error("No camera found on this device.");
        }

        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        const message =
          err instanceof Error ? err.message : "Could not open camera";
        if (/NotAllowedError|Permission/i.test(message)) {
          setError("Camera permission denied. Allow camera access to scan.");
        } else if (/NotFoundError|DevicesNotFound|No camera/i.test(message)) {
          setError("No camera found on this device.");
        } else {
          setError(message);
        }
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      // Do not call releaseAllStreams() here — React Strict Mode remounts
      // and that kills the freshly started laptop webcam stream.
    };
  }, []);

  function requestClose() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    onCloseRef.current();
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-ink-950/55 p-4 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => {
        if (!canCloseOnBackdrop) return;
        requestClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="imei-scanner-title"
        className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              Scanner
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

        <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-4">
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
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <ScanBarcode className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </button>
      {open ? (
        <ImeiScannerModal
          onClose={() => setOpen(false)}
          onScan={onScan}
        />
      ) : null}
    </>
  );
}
