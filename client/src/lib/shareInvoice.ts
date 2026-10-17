import { ApiError, api, fetchBackend } from "./api";

/**
 * Opens the native share sheet with the invoice PDF (WhatsApp, printer, etc.).
 * Shares the image-only print copy: the share sheet is also how the shop
 * reaches the Canon printer app, which can't open the vector PDF.
 */
export async function shareInvoicePdf(
  billId: string,
  invoiceNumber: string,
): Promise<void> {
  const response = await fetchBackend(api.printPdfUrl(billId));
  if (!response.ok) {
    throw new ApiError("Could not load invoice PDF", response.status);
  }

  const blob = await response.blob();
  const label = invoiceNumber || "Invoice";
  const file = new File([blob], `${label}.pdf`, {
    type: "application/pdf",
  });

  if (typeof navigator.share !== "function") {
    throw new Error(
      "Sharing isn’t supported in this browser. Use Download PDF instead.",
    );
  }

  const withFile: ShareData = {
    title: `Invoice ${label}`,
    text: `Invoice ${label} — Babu Mobile NX`,
    files: [file],
  };

  if (
    typeof navigator.canShare === "function" &&
    !navigator.canShare(withFile)
  ) {
    throw new Error(
      "This device can’t share PDF files from the browser. Download the PDF, then share it from WhatsApp.",
    );
  }

  await navigator.share(withFile);
}

/** Phones/tablets: Print goes through the share sheet to the printer app. */
function sharesToPrinterApp() {
  return (
    typeof navigator.share === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/**
 * Print the bill. On a phone this opens the share sheet with the image-only
 * print copy (`?print=1`), which printer apps like Canon PRINT can open; on a
 * computer it opens that PDF in a new tab to print from the browser.
 */
export async function printInvoicePdf(
  billId: string,
  invoiceNumber: string,
): Promise<void> {
  const url = api.printPdfUrl(billId);
  if (!sharesToPrinterApp()) {
    window.open(url, "_blank", "noopener");
    return;
  }

  const response = await fetchBackend(url);
  if (!response.ok) {
    throw new ApiError("Could not load the bill for printing", response.status);
  }
  const label = invoiceNumber || "Invoice";
  const file = new File([await response.blob()], `${label}.pdf`, {
    type: "application/pdf",
  });
  const data: ShareData = { title: `Print ${label}`, files: [file] };
  if (typeof navigator.canShare === "function" && !navigator.canShare(data)) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await navigator.share(data);
}

export function isShareAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
