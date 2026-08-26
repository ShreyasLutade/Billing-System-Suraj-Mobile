/**
 * Native BarcodeDetector when available; lazily loads barcode-detector
 * (ZXing-C++ WASM) only when needed (iOS Safari/Chrome, Windows, etc.).
 */

export interface DetectedBarcode {
  rawValue: string;
  format: string;
  cornerPoints: { x: number; y: number }[];
}

export interface BarcodeDetectorLike {
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

export type BarcodeDetectorEngine = "native" | "wasm";

let cached: Promise<{
  ctor: new (options: { formats: string[] }) => BarcodeDetectorLike;
  engine: BarcodeDetectorEngine;
}> | null = null;

export function resolveBarcodeDetector() {
  if (cached) return cached;

  cached = (async () => {
    if (typeof window !== "undefined" && window.BarcodeDetector) {
      return {
        ctor: window.BarcodeDetector as unknown as new (options: {
          formats: string[];
        }) => BarcodeDetectorLike,
        engine: "native" as const,
      };
    }

    const { BarcodeDetector } = await import("barcode-detector/pure");
    return {
      ctor: BarcodeDetector as unknown as new (options: {
        formats: string[];
      }) => BarcodeDetectorLike,
      engine: "wasm" as const,
    };
  })();

  return cached;
}
