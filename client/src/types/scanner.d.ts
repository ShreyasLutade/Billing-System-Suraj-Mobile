/**
 * Ambient DOM type augmentations for the IMEI barcode scanner.
 * Runtime usage is always feature-detected; these keep tsc --strict happy.
 */

interface VideoFrameCallbackMetadata {
  presentationTime: DOMHighResTimeStamp;
  expectedDisplayTime: DOMHighResTimeStamp;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
  processingDuration?: number;
}

interface HTMLVideoElement {
  requestVideoFrameCallback?(
    callback: (
      now: DOMHighResTimeStamp,
      metadata: VideoFrameCallbackMetadata,
    ) => void,
  ): number;
  cancelVideoFrameCallback?(handle: number): void;
}

interface NativeDetectedBarcode {
  rawValue: string;
  format: string;
  cornerPoints: { x: number; y: number }[];
  boundingBox: DOMRectReadOnly;
}

interface NativeBarcodeDetector {
  detect(image: ImageBitmapSource): Promise<NativeDetectedBarcode[]>;
}

interface NativeBarcodeDetectorConstructor {
  new (options?: { formats: string[] }): NativeBarcodeDetector;
  getSupportedFormats?(): Promise<string[]>;
}

interface Window {
  BarcodeDetector?: NativeBarcodeDetectorConstructor;
}

interface MediaTrackCapabilities {
  torch?: boolean;
  focusMode?: string[];
  zoom?: { min: number; max: number; step: number };
}

interface MediaTrackConstraintSet {
  torch?: boolean;
  focusMode?: string;
  zoom?: number;
}
