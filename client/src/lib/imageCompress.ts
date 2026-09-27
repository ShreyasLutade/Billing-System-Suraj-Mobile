/**
 * Shrinks a camera photo before upload so the database stays small.
 * A 3–5 MB phone photo becomes roughly 80–200 KB: longest side capped at
 * 1280px, re-encoded as WebP (JPEG where WebP encoding isn't supported).
 */

export type CompressedImage = {
  blob: Blob;
  type: string;
  width: number;
  height: number;
};

const MAX_SIDE = 1280;
const QUALITY = 0.72;
/** Server rejects anything above 600 KB; stay comfortably under it. */
const TARGET_MAX_BYTES = 450 * 1024;

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      // Honour the EXIF rotation so portrait photos aren't saved sideways.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall back to <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a photo (JPG, PNG or HEIC from the camera).");
  }

  const source = await decode(file);
  const srcW = "naturalWidth" in source ? source.naturalWidth : source.width;
  const srcH = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!srcW || !srcH) throw new Error("Couldn't read that photo. Try another one.");

  let scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH));
  let quality = QUALITY;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser can't process photos here.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);

    // Some browsers can't encode WebP and quietly return PNG — use JPEG then.
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") {
      blob = await toBlob(canvas, "image/jpeg", quality);
    }
    if (!blob) throw new Error("Couldn't compress that photo. Try another one.");

    if (blob.size <= TARGET_MAX_BYTES || attempt === 3) {
      if ("close" in source) source.close();
      return { blob, type: blob.type, width, height };
    }
    // Still large (very detailed photo) — shrink a bit more and retry.
    scale *= 0.8;
    quality = Math.max(0.55, quality - 0.08);
  }

  throw new Error("Couldn't compress that photo. Try another one.");
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
