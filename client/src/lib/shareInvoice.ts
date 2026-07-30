import { api } from "./api";

/** Opens the native share sheet with the invoice PDF (WhatsApp, etc.). */
export async function shareInvoicePdf(
  billId: string,
  invoiceNumber: string,
): Promise<void> {
  const response = await fetch(api.pdfUrl(billId));
  if (!response.ok) {
    throw new Error("Could not load invoice PDF");
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
    text: `Invoice ${label} — Suraj Mobile`,
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

export function isShareAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
