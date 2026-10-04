import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ImageUp, Loader2, SwitchCamera, X } from "lucide-react";

/**
 * Full-screen live camera for repair photos. Opens the back camera, shows a
 * live preview filling the screen and captures exactly what the preview shows.
 * Rendered on <body> so it sits above the page's fixed bars. Falls back to the phone's own camera app
 * (file input with `capture`) where live camera access isn't available —
 * browsers only allow it on https (or localhost).
 */
export function CameraCapture({
  title,
  onCapture,
  onClose,
}: {
  title: string;
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSwitch, setCanSwitch] = useState(false);
  const [busy, setBusy] = useState(false);

  const liveSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    window.isSecureContext;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!liveSupported) {
      setError("Live camera isn't available here. Use your phone's camera instead.");
      return;
    }
    let cancelled = false;
    setReady(false);
    setError(null);
    stop();
    // Ask for frames shaped like the screen (portrait on a phone held upright).
    const portrait = window.innerHeight >= window.innerWidth;
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: portrait ? 1080 : 1920 },
          height: { ideal: portrait ? 1920 : 1080 },
        },
      })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setReady(true);
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) {
          setCanSwitch(devices.filter((device) => device.kind === "videoinput").length > 1);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera permission was blocked. Allow the camera for this site, or use your phone's camera instead."
            : name === "NotFoundError"
              ? "No camera found on this device. Upload a photo instead."
              : "Couldn't start the camera. Use your phone's camera or upload a photo.",
        );
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, liveSupported, stop]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function finish(file: File) {
    stop();
    onCapture(file);
  }

  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true);
    // The preview fills the screen (object-fit: cover), so crop the frame to
    // the part that was on screen: the photo matches what the user saw.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = video.clientWidth || vw;
    const ch = video.clientHeight || vh;
    const scale = Math.max(cw / vw, ch / vh);
    const sw = Math.min(vw, Math.round(cw / scale));
    const sh = Math.min(vh, Math.round(ch / scale));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas
      .getContext("2d")
      ?.drawImage(video, Math.round((vw - sw) / 2), Math.round((vh - sh) / 2), sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    setBusy(false);
    if (blob) finish(new File([blob], "photo.jpg", { type: "image/jpeg" }));
  }

  function pickFrom(input: HTMLInputElement | null) {
    input?.click();
  }

  return createPortal(
    <div className="cam" role="dialog" aria-modal="true" aria-label={title}>
      {/* Fallbacks: phone camera app, and gallery. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="rp-visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) finish(file);
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="rp-visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) finish(file);
        }}
      />

      <div className="cam-top">
        <strong>{title}</strong>
        <button type="button" className="cam-icon-btn" onClick={onClose} aria-label="Close camera">
          <X aria-hidden />
        </button>
      </div>

      <div className="cam-stage">
        {error ? (
          <div className="cam-message">
            <Camera aria-hidden />
            <p>{error}</p>
            <button type="button" className="rp-btn rp-btn-primary" onClick={() => pickFrom(cameraInputRef.current)}>
              <Camera aria-hidden /> Open phone camera
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              className={facing === "user" ? "is-mirrored" : undefined}
              playsInline
              muted
              autoPlay
            />
            {/* Framing guide for a phone held upright */}
            <div className="cam-guide" aria-hidden />
            {!ready ? (
              <div className="cam-message">
                <Loader2 className="rp-spin" aria-hidden />
                <p>Starting camera…</p>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="cam-bar">
        <button
          type="button"
          className="cam-side-btn"
          onClick={() => pickFrom(galleryInputRef.current)}
          aria-label="Upload from gallery"
        >
          <ImageUp aria-hidden />
          <span>Gallery</span>
        </button>
        <button
          type="button"
          className="cam-shutter"
          onClick={() => void shoot()}
          disabled={!ready || busy || Boolean(error)}
          aria-label="Take photo"
        >
          <span />
        </button>
        <button
          type="button"
          className="cam-side-btn"
          onClick={() => setFacing((current) => (current === "environment" ? "user" : "environment"))}
          disabled={!canSwitch || Boolean(error)}
          aria-label="Switch camera"
        >
          <SwitchCamera aria-hidden />
          <span>Flip</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
