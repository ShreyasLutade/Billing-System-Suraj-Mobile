import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Turns a generated PDF into an image-only ("scanned") PDF for printing.
 *
 * Printer apps such as Canon PRINT have limited PDF readers: they show a
 * blank preview for our pdfkit PDFs, then "the file cannot be used". A PDF
 * holding just one picture per page (like a scanner's) has no fonts or
 * drawing features for them to trip on. Print and Share use this copy (the
 * share sheet is how phones reach the printer app); Download PDF stays vector.
 *
 * Uses Ghostscript (installed in the Docker image). Where it's missing
 * (local Windows dev) or fails, the original PDF is returned unchanged.
 */
export async function printSafePdf(pdf: Buffer): Promise<Buffer> {
  try {
    return await runGhostscript(pdf);
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn(
        "[pdf] Ghostscript unavailable, sending the print PDF as generated:",
        error instanceof Error ? error.message : error,
      );
    }
    return pdf;
  }
}

let warned = false;

/** PDF in and out need random access, so Ghostscript works on temp files. */
async function runGhostscript(pdf: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "print-pdf-"));
  const input = path.join(dir, "in.pdf");
  const output = path.join(dir, "out.pdf");
  try {
    await writeFile(input, pdf);
    await ghostscript(input, output);
    const out = await readFile(output);
    if (!out.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("Ghostscript output is not a PDF");
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function ghostscript(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const gs = spawn(
      process.platform === "win32" ? "gswin64c" : "gs",
      [
        "-q",
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        // One colour JPEG per page at 200 dpi: sharp on paper, ~300 KB.
        "-sDEVICE=pdfimage24",
        "-r200",
        "-sCompression=JPEG",
        "-dJPEGQ=85",
        `-sOutputFile=${output}`,
        input,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    let stderr = "";
    const timer = setTimeout(() => {
      gs.kill("SIGKILL");
      reject(new Error("Ghostscript timed out"));
    }, 20_000);

    gs.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    gs.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    gs.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Ghostscript exited ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      resolve();
    });
  });
}
