/**
 * Save / share helpers for a PDF we already hold as a blob.
 *
 * Kept separate from shareInvoice.ts, which fetches the invoice itself — here
 * the caller already has the bytes and may want both actions from one fetch.
 */

/** Saves the blob to the device's downloads folder. */
export function savePdfBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke late: Safari needs the object URL alive while the click settles.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function canSharePdf(blob: Blob, filename: string) {
  if (typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return true;
  const file = new File([blob], filename, { type: "application/pdf" });
  return navigator.canShare({ files: [file] });
}

/**
 * Opens the native share sheet (WhatsApp, Gmail, …) with the PDF attached.
 * Throws when the browser can't share files — callers fall back to the save.
 */
export async function sharePdfBlob(
  blob: Blob,
  filename: string,
  title: string,
  text: string,
): Promise<void> {
  if (typeof navigator.share !== "function") {
    throw new Error(
      "Sharing isn’t supported in this browser. The PDF was downloaded instead.",
    );
  }

  const file = new File([blob], filename, { type: "application/pdf" });
  const payload: ShareData = { title, text, files: [file] };

  if (typeof navigator.canShare === "function" && !navigator.canShare(payload)) {
    throw new Error(
      "This device can’t share PDF files from the browser. The PDF was downloaded — share it from WhatsApp.",
    );
  }

  await navigator.share(payload);
}
