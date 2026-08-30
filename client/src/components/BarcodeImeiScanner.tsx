import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ScanBarcode, X, Flashlight } from "lucide-react";
import clsx from "clsx";
import {
  useBarcodeScanner,
  type ScanResult,
} from "../hooks/useBarcodeScanner";
import { isValidImei, normalizeImei } from "../utils/imei";
import "./IMEIScanner.css";

export { isValidImei, normalizeImei as normalizeScannedImei };

/** Prefer Code 128 for MobileII / IMEI box labels; keep a few common 1D formats. */
const IMEI_SCAN_FORMATS = ["code_128", "code_39", "ean_13"];

/** Apple/device serial labels are usually Code 128 — skip UPC/EAN product barcodes. */
const SERIAL_SCAN_FORMATS = ["code_128", "code_39", "data_matrix", "qr_code"];

type ScanKind = "imei" | "serial";

function normalizeSerial(raw: string) {
  let value = raw.replace(/\s+/g, "").trim();
  if (!value) return "";

  // Strip common label / GS1 prefixes: (S), S], S>, AI 21, etc.
  value = value.replace(/^\(S\)/i, "");
  value = value.replace(/^S(?:erial)?(?:No\.?|#)?[:\-]?/i, "");
  value = value.replace(/^\]C1/i, ""); // Code 128 FNC1 / GS1 prefix noise
  value = value.replace(/^21/, (match, _offset, full) =>
    /[A-Za-z]/.test(full.slice(2)) ? "" : match,
  );

  // Keep letters + digits only for device serials.
  value = value.replace(/[^A-Za-z0-9]/g, "");
  return value.toUpperCase();
}

function isLikelyProductBarcode(raw: string, format?: string) {
  const digits = raw.replace(/\D/g, "");
  const fmt = (format || "").toLowerCase();
  if (fmt.includes("ean") || fmt.includes("upc")) return true;
  // Pure 8–14 digit codes are almost always product barcodes on the same box.
  if (/^\d{8,14}$/.test(digits) && digits === raw.replace(/\s+/g, "")) {
    return true;
  }
  return false;
}

function isPlausibleSerial(raw: string) {
  const serial = normalizeSerial(raw);
  if (serial.length < 6 || serial.length > 40) return false;
  // Prefer codes with at least one letter (Apple SN like HHY61970BHX263MAN).
  if (!/[A-Z]/.test(serial)) return false;
  if (!/\d/.test(serial)) return false;
  return true;
}

function BarcodeScannerModal({
  kind,
  onClose,
  onScan,
}: {
  kind: ScanKind;
  onClose: () => void;
  onScan: (value: string) => void;
}) {
  const handledRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;

  const [canCloseOnBackdrop, setCanCloseOnBackdrop] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setCanCloseOnBackdrop(true), 400);
    return () => window.clearTimeout(t);
  }, []);

  const handleDetect = useCallback(
    (result: ScanResult) => {
      if (handledRef.current) return;

      if (kind === "imei") {
        // Billing fields require a Luhn-valid 15-digit IMEI.
        if (!result.isValidImei) return;

        const imei =
          result.digitsOnly.length === 15
            ? result.digitsOnly
            : normalizeImei(result.rawValue).slice(0, 15);
        if (!isValidImei(imei)) return;

        handledRef.current = true;
        onScanRef.current(imei);
        onCloseRef.current();
        return;
      }

      if (isLikelyProductBarcode(result.rawValue, result.format)) return;
      const serial = normalizeSerial(result.rawValue);
      if (!isPlausibleSerial(serial)) return;

      handledRef.current = true;
      onScanRef.current(serial);
      onCloseRef.current();
    },
    [kind],
  );

  const {
    videoRef,
    status,
    errorMessage,
    engine,
    torchSupported,
    torchOn,
    toggleTorch,
    devices,
    switchCamera,
  } = useBarcodeScanner({
    active: true,
    onDetect: handleDetect,
    formats: kind === "imei" ? IMEI_SCAN_FORMATS : SERIAL_SCAN_FORMATS,
    facingMode: "environment",
    // Serial codes are long/dense — use a wider frame and higher resolution.
    ...(kind === "serial"
      ? {
          roi: { widthPct: 0.94, heightPct: 0.42 },
          maxProcessWidth: 1400,
          consensusReads: 1,
          minScanIntervalMs: 50,
          acceptResult: ({ rawValue, format }) =>
            !isLikelyProductBarcode(rawValue, format) &&
            isPlausibleSerial(rawValue),
        }
      : {}),
  });

  const requestClose = () => {
    onCloseRef.current();
  };

  const starting =
    status === "idle" || status === "requesting-permission";
  const error =
    status === "denied" || status === "unsupported" || status === "error"
      ? errorMessage
      : null;

  const title = kind === "imei" ? "Scan IMEI barcode" : "Scan serial barcode";
  const titleId =
    kind === "imei" ? "imei-scanner-title" : "serial-scanner-title";

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
        aria-labelledby={titleId}
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
                : engine === "wasm"
                  ? " · WASM"
                  : ""}
            </p>
            <h2
              id={titleId}
              className="mt-1 font-display text-xl font-semibold text-ink-900"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              {kind === "serial"
                ? "Point at the Serial No. barcode (not the product barcode)."
                : "Center the barcode in the box. Scanning starts automatically."}
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

        <div className="imei-scanner-viewport">
          <video
            ref={videoRef}
            className="imei-scanner-viewport__video"
            muted
            playsInline
            autoPlay
          />

          <div className="imei-scanner-viewport__overlay" aria-hidden>
            <div className="imei-scanner-viewport__frame">
              <span className="imei-scanner-viewport__corner imei-scanner-viewport__corner--tl" />
              <span className="imei-scanner-viewport__corner imei-scanner-viewport__corner--tr" />
              <span className="imei-scanner-viewport__corner imei-scanner-viewport__corner--bl" />
              <span className="imei-scanner-viewport__corner imei-scanner-viewport__corner--br" />
              {status === "scanning" ? (
                <span className="imei-scanner-viewport__scanline" />
              ) : null}
            </div>
          </div>

          <div className="imei-scanner-viewport__controls">
            {torchSupported ? (
              <button
                type="button"
                className={clsx(
                  "imei-scanner-viewport__iconbtn",
                  torchOn && "is-on",
                )}
                onClick={() => void toggleTorch()}
                aria-label="Toggle flashlight"
              >
                <span className="inline-flex items-center gap-1">
                  <Flashlight className="h-3.5 w-3.5" />
                  {torchOn ? "Flash on" : "Flash"}
                </span>
              </button>
            ) : null}
            {devices.length > 1 ? (
              <button
                type="button"
                className="imei-scanner-viewport__iconbtn"
                onClick={switchCamera}
                aria-label="Switch camera"
              >
                Switch camera
              </button>
            ) : null}
          </div>

          {starting && !error ? (
            <p className="imei-scanner-viewport__status">
              Requesting camera access…
            </p>
          ) : null}
          {error ? (
            <p className="imei-scanner-viewport__status imei-scanner-viewport__status--error">
              {error}
            </p>
          ) : null}
          {status === "scanning" ? (
            <p className="imei-scanner-viewport__hint">
              {kind === "serial"
                ? "Aim at the long Serial No. barcode under the SN text"
                : `Center the barcode in the box${
                    engine === "wasm" ? ", hold steady" : " — scans instantly"
                  }`}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-100 px-5 py-4">
          <button type="button" className="btn-secondary" onClick={requestClose}>
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function ScanFieldButton({
  kind,
  onScan,
  disabled,
  className,
}: {
  kind: ScanKind;
  onScan: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const label =
    kind === "imei" ? "Scan IMEI barcode" : "Scan serial barcode";

  return (
    <>
      <span
        className="mx-0.5 h-5 w-px shrink-0 self-center bg-ink-100"
        aria-hidden
      />
      <button
        type="button"
        id={labelId}
        className={clsx(
          "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-500 transition hover:bg-tide-50 hover:text-tide-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-tide-100/25",
          className,
        )}
        aria-label={label}
        title={label}
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
        <BarcodeScannerModal
          kind={kind}
          onClose={() => setOpen(false)}
          onScan={onScan}
        />
      ) : null}
    </>
  );
}

/** One bordered box: text input + scan icon on the right. */
export function ScanFieldShell({
  children,
  className,
  compact,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex w-full items-center gap-0.5 border border-ink-100 bg-white/90 pr-1 transition focus-within:border-tide-500 focus-within:ring-4 focus-within:ring-tide-400/20 dark:border-ink-100 dark:bg-surface-elevated",
        compact ? "min-h-[40px] rounded-xl" : "min-h-[46px] rounded-2xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const scanFieldInputClass =
  "min-w-0 flex-1 bg-transparent px-3.5 py-2.5 font-mono text-base text-ink-900 outline-none placeholder:text-[#9AA6B6] disabled:cursor-not-allowed disabled:opacity-55 sm:text-sm";

export function ImeiScanFieldButton({
  onScan,
  disabled,
  className,
}: {
  onScan: (imei: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ScanFieldButton
      kind="imei"
      onScan={onScan}
      disabled={disabled}
      className={className}
    />
  );
}

export function SerialScanFieldButton({
  onScan,
  disabled,
  className,
}: {
  onScan: (serial: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ScanFieldButton
      kind="serial"
      onScan={onScan}
      disabled={disabled}
      className={className}
    />
  );
}
