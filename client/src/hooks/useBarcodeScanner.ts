import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveBarcodeDetector,
  type BarcodeDetectorEngine,
  type BarcodeDetectorLike,
} from "../utils/getBarcodeDetector";
import { isValidImei, normalizeImei } from "../utils/imei";
import { playScanBeep, vibrateOnDetect } from "../utils/beep";

/** Formats for IMEI/device-box scanning. Trim to code_128 only if desired. */
export const DEFAULT_FORMATS = [
  "code_128",
  "code_39",
  "ean_13",
  "upc_a",
  "qr_code",
];

export type ScannerStatus =
  | "idle"
  | "requesting-permission"
  | "scanning"
  | "paused"
  | "denied"
  | "unsupported"
  | "error";

export interface ScanResult {
  rawValue: string;
  digitsOnly: string;
  format: string;
  isValidImei: boolean;
  engine: BarcodeDetectorEngine;
  timestamp: number;
}

export interface UseBarcodeScannerOptions {
  active: boolean;
  onDetect: (result: ScanResult) => void;
  formats?: string[];
  facingMode?: "environment" | "user";
  roi?: { widthPct: number; heightPct: number };
  /** Cap for downscaled frame width before detect (higher = denser barcodes). */
  maxProcessWidth?: number;
  minScanIntervalMs?: number;
  consensusReads?: number;
  duplicateSuppressMs?: number;
  vibrateOnDetect?: boolean;
  beepOnDetect?: boolean;
  /** Return false to ignore a barcode (e.g. skip product UPC while scanning serial). */
  acceptResult?: (result: {
    rawValue: string;
    format: string;
  }) => boolean;
}

export interface UseBarcodeScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: ScannerStatus;
  errorMessage: string | null;
  engine: BarcodeDetectorEngine | null;
  torchSupported: boolean;
  torchOn: boolean;
  toggleTorch: () => Promise<void>;
  devices: MediaDeviceInfo[];
  activeDeviceId: string | null;
  switchCamera: () => void;
  pause: () => void;
  resume: () => void;
}

const DEFAULT_ROI = { widthPct: 0.85, heightPct: 0.35 };
const MAX_PROCESS_WIDTH = 900;

export function useBarcodeScanner(
  options: UseBarcodeScannerOptions,
): UseBarcodeScannerReturn {
  const {
    active,
    onDetect,
    formats = DEFAULT_FORMATS,
    facingMode = "environment",
    roi = DEFAULT_ROI,
    maxProcessWidth = MAX_PROCESS_WIDTH,
    minScanIntervalMs = 80,
    consensusReads = 2,
    duplicateSuppressMs = 2000,
    vibrateOnDetect: doVibrate = true,
    beepOnDetect: doBeep = true,
    acceptResult,
  } = options;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const engineRef = useRef<BarcodeDetectorEngine | null>(null);
  const rafHandleRef = useRef<number | null>(null);
  const usingRvfcRef = useRef(false);
  const inFlightRef = useRef(false);
  const lastRunRef = useRef(0);
  const pausedRef = useRef(false);
  const lastFiredRef = useRef<{ value: string; at: number } | null>(null);
  const consensusRef = useRef<{ value: string; count: number } | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [engine, setEngine] = useState<BarcodeDetectorEngine | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);

  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const acceptResultRef = useRef(acceptResult);
  acceptResultRef.current = acceptResult;
  const formatsKey = useMemo(() => formats.join(","), [formats]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setStatus((s) => (s === "scanning" ? "paused" : s));
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setStatus((s) => (s === "paused" ? "scanning" : s));
  }, []);

  const stopStream = useCallback(() => {
    const video = videoRef.current;
    if (
      usingRvfcRef.current &&
      video?.cancelVideoFrameCallback &&
      rafHandleRef.current != null
    ) {
      video.cancelVideoFrameCallback(rafHandleRef.current);
    } else if (rafHandleRef.current != null) {
      cancelAnimationFrame(rafHandleRef.current);
    }
    rafHandleRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (video) video.srcObject = null;
  }, []);

  const runDetection = useCallback(
    async (video: HTMLVideoElement) => {
      const detector = detectorRef.current;
      if (!detector || inFlightRef.current) return;

      const now = performance.now();
      if (now - lastRunRef.current < minScanIntervalMs) return;
      lastRunRef.current = now;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      const cropW = vw * roi.widthPct;
      const cropH = vh * roi.heightPct;
      const cropX = (vw - cropW) / 2;
      const cropY = (vh - cropH) / 2;

      const scale = Math.min(1, maxProcessWidth / cropW);
      const outW = Math.max(1, Math.round(cropW * scale));
      const outH = Math.max(1, Math.round(cropH * scale));

      let canvas = canvasRef.current;
      if (!canvas || canvas.width !== outW || canvas.height !== outH) {
        canvas =
          typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(outW, outH)
            : Object.assign(document.createElement("canvas"), {
                width: outW,
                height: outH,
              });
        canvasRef.current = canvas;
      }

      const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) return;

      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

      inFlightRef.current = true;
      try {
        const results = await detector.detect(
          canvas as unknown as ImageBitmapSource,
        );
        if (!mountedRef.current || pausedRef.current || results.length === 0) {
          return;
        }

        const accept = acceptResultRef.current;
        const ranked = [...results].sort((a, b) => {
          const score = (raw: string) => {
            const hasLetter = /[A-Za-z]/.test(raw);
            const len = raw.replace(/\s+/g, "").length;
            return (hasLetter ? 1000 : 0) + len;
          };
          return score(b.rawValue) - score(a.rawValue);
        });
        const hit =
          ranked.find((row) =>
            accept
              ? accept({ rawValue: row.rawValue, format: row.format })
              : true,
          ) ?? null;
        if (!hit) return;

        const digits = normalizeImei(hit.rawValue);
        const validImei = isValidImei(hit.rawValue);

        const suppressed =
          lastFiredRef.current &&
          lastFiredRef.current.value === hit.rawValue &&
          now - lastFiredRef.current.at < duplicateSuppressMs;
        if (suppressed) return;

        let confirmed = validImei;
        if (!confirmed) {
          if (consensusRef.current?.value === hit.rawValue) {
            consensusRef.current.count += 1;
          } else {
            consensusRef.current = { value: hit.rawValue, count: 1 };
          }
          confirmed = consensusRef.current.count >= consensusReads;
        }
        if (!confirmed) return;

        consensusRef.current = null;
        lastFiredRef.current = { value: hit.rawValue, at: now };

        if (doVibrate) vibrateOnDetect();
        if (doBeep) playScanBeep();

        onDetectRef.current({
          rawValue: hit.rawValue,
          digitsOnly: digits,
          format: hit.format,
          isValidImei: validImei,
          engine: engineRef.current ?? "wasm",
          timestamp: Date.now(),
        });
      } catch {
        /* keep scanning */
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      roi.widthPct,
      roi.heightPct,
      maxProcessWidth,
      minScanIntervalMs,
      consensusReads,
      duplicateSuppressMs,
      doVibrate,
      doBeep,
    ],
  );

  const scheduleNext = useCallback(
    (video: HTMLVideoElement) => {
      if (!mountedRef.current) return;
      const step = () => {
        if (!mountedRef.current) return;
        if (!pausedRef.current) void runDetection(video);
        scheduleNext(video);
      };
      if (video.requestVideoFrameCallback) {
        usingRvfcRef.current = true;
        rafHandleRef.current = video.requestVideoFrameCallback(step);
      } else {
        usingRvfcRef.current = false;
        rafHandleRef.current = requestAnimationFrame(step);
      }
    },
    [runDetection],
  );

  const applyContinuousFocus = useCallback((track: MediaStreamTrack) => {
    const caps = track.getCapabilities?.();
    if (caps?.focusMode?.includes("continuous")) {
      void track.applyConstraints({
        advanced: [{ focusMode: "continuous" }],
      });
    }
  }, []);

  const start = useCallback(
    async (deviceId?: string) => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setStatus("unsupported");
        setErrorMessage("Camera access isn't available in this browser.");
        return;
      }
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setStatus("unsupported");
        setErrorMessage("Camera access requires HTTPS (or localhost).");
        return;
      }

      setStatus("requesting-permission");
      setErrorMessage(null);
      setTorchOn(false);
      setTorchSupported(false);

      try {
        const [{ ctor, engine: resolvedEngine }, stream] = await Promise.all([
          resolveBarcodeDetector(),
          navigator.mediaDevices.getUserMedia({
            video: deviceId
              ? { deviceId: { exact: deviceId } }
              : {
                  facingMode: { ideal: facingMode },
                  width: { ideal: 1920 },
                  height: { ideal: 1080 },
                  frameRate: { ideal: 30 },
                },
            audio: false,
          }),
        ]);

        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        try {
          detectorRef.current = new ctor({ formats });
        } catch {
          // Some browsers reject unsupported formats — fall back to Code 128.
          detectorRef.current = new ctor({
            formats: formats.includes("code_128")
              ? ["code_128"]
              : formats.slice(0, 1),
          });
        }
        engineRef.current = resolvedEngine;
        setEngine(resolvedEngine);

        streamRef.current = stream;
        const [track] = stream.getVideoTracks();
        applyContinuousFocus(track);

        const caps = track.getCapabilities?.();
        setTorchSupported(Boolean(caps?.torch));
        setActiveDeviceId(track.getSettings?.().deviceId ?? null);

        void navigator.mediaDevices.enumerateDevices().then((all) => {
          if (mountedRef.current) {
            setDevices(all.filter((d) => d.kind === "videoinput"));
          }
        });

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();

        pausedRef.current = false;
        setStatus("scanning");
        scheduleNext(video);
      } catch (err) {
        if (!mountedRef.current) return;
        const name = (err as DOMException)?.name;
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setStatus("denied");
          setErrorMessage("Camera permission was denied.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setStatus("error");
          setErrorMessage("No matching camera was found on this device.");
        } else {
          setStatus("error");
          setErrorMessage(
            (err as Error)?.message ?? "Couldn't start the camera.",
          );
        }
      }
    },
    [facingMode, formats, applyContinuousFocus, scheduleNext],
  );

  const switchCamera = useCallback(() => {
    if (devices.length < 2) return;
    const currentIndex = devices.findIndex(
      (d) => d.deviceId === activeDeviceId,
    );
    const next = devices[(currentIndex + 1) % devices.length];
    stopStream();
    void start(next.deviceId);
  }, [devices, activeDeviceId, stopStream, start]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      /* unsupported at runtime */
    }
  }, [torchOn, torchSupported]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (active) {
      void start();
    } else {
      stopStream();
      setStatus("idle");
      setTorchOn(false);
    }
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, formatsKey]);

  return {
    videoRef,
    status,
    errorMessage,
    engine,
    torchSupported,
    torchOn,
    toggleTorch,
    devices,
    activeDeviceId,
    switchCamera,
    pause,
    resume,
  };
}
