import { useCallback, useEffect, useId, useRef, useState } from "react";
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

function ImeiScannerModal({
  onClose,
  onScan,
}: {
  onClose: () => void;
  onScan: (imei: string) => void;
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

  const handleDetect = useCallback((result: ScanResult) => {
    if (handledRef.current) return;
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
  }, []);

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
    formats: IMEI_SCAN_FORMATS,
    facingMode: "environment",
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
                : engine === "wasm"
                  ? " · WASM"
                  : ""}
            </p>
            <h2
              id="imei-scanner-title"
              className="mt-1 font-display text-xl font-semibold text-ink-900"
            >
              Scan IMEI barcode
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              Center the barcode in the box. Scanning starts automatically.
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
              Center the barcode in the box
              {engine === "wasm" ? ", hold steady" : " — scans instantly"}
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
