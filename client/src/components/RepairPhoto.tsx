import { useEffect, useState } from "react";
import { ImageOff, Smartphone } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";

/** Loads a saved repair photo (needs the auth header) and shows it. */
export function RepairPhoto({
  jobId,
  side,
  available,
  className,
  alt,
  onOpen,
}: {
  jobId: string;
  side: "front" | "back";
  available: boolean;
  className?: string;
  alt: string;
  onOpen?: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!available) return;
    let active = true;
    let objectUrl: string | null = null;
    setFailed(false);
    api
      .loadRepairPhoto(jobId, side)
      .then((next) => {
        objectUrl = next;
        if (active) setUrl(next);
        else URL.revokeObjectURL(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [jobId, side, available]);

  if (!available || failed) {
    return (
      <div className={clsx("rp-photo-empty", className)} aria-label={`${alt}: no photo`}>
        {failed ? <ImageOff aria-hidden /> : <Smartphone aria-hidden />}
        <span>{failed ? "Couldn't load" : "No photo"}</span>
      </div>
    );
  }

  if (!url) {
    return <div className={clsx("rp-photo-empty rp-photo-loading", className)} aria-label={`Loading ${alt}`} />;
  }

  return onOpen ? (
    <button type="button" className={clsx("rp-photo-btn", className)} onClick={() => onOpen(url)} aria-label={`Open ${alt}`}>
      <img src={url} alt={alt} />
    </button>
  ) : (
    <img src={url} alt={alt} className={className} />
  );
}
