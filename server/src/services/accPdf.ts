import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { format } from "date-fns";
import { COLORS, FONT, drawBabuLogo, drawWordmarkText, money, registerFonts, shop } from "./pdf";

/**
 * One table-report renderer for every accessories-shop PDF (stock, sales,
 * dues, statements, suppliers, analytics, wholesale bill). Callers describe
 * the report; this file owns the look: shop header, summary boxes, tables
 * with group headings and subtotals, page breaks and footers.
 */

export type PdfCol = {
  key: string;
  label: string;
  /** Relative width; columns are stretched to the page. */
  width: number;
  align?: "left" | "right" | "center";
};

export type PdfRow = {
  cells: Record<string, string>;
  /** Small grey second line under a cell. */
  sub?: Record<string, string>;
  /** Text colour per cell. */
  color?: Record<string, string>;
  /** group: a heading row across the table; subtotal: bold tinted row. */
  kind?: "row" | "group" | "subtotal";
};

export type PdfSection = {
  heading?: string;
  columns: PdfCol[];
  rows: PdfRow[];
  /** Bold footer row of the table. */
  total?: Record<string, string>;
  empty?: string;
};

export type PdfReport = {
  title: string;
  subtitle?: string;
  landscape?: boolean;
  /** Label/value pairs in a box under the header (customer details…). */
  info?: Array<{ label: string; value: string }>;
  summary?: Array<{ label: string; value: string; tone?: "green" | "red" | "amber" | "blue" }>;
  sections: PdfSection[];
  /** Lines under the last table (terms, notes, signature…). */
  notes?: string[];
  footNote?: string;
};

export const PDF_TONE = {
  green: "#0B7A5B",
  red: "#B42318",
  amber: "#B45309",
  blue: "#1D4ED8",
} as const;

const TONE_FILL: Record<string, string> = {
  green: "#E7F8F1",
  red: "#FDECEC",
  amber: "#FFF7E6",
  blue: "#EAF2FF",
};

const M = 28;
const PAD = 5;
const ROW_H = 26;
const FOOTER_H = 30;

export function rs(amount: number) {
  return `Rs. ${money(amount)}`;
}

export function pdfDay(date: Date | string | null | undefined) {
  if (!date) return "";
  return format(new Date(date), "dd MMM yyyy");
}

export function renderAccPdf(report: PdfReport): Promise<Buffer> {
  const page = report.landscape ? { width: 841.89, height: 595.28 } : { width: 595.28, height: 841.89 };
  const W = page.width - M * 2;
  const bottom = page.height - FOOTER_H - 6;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [page.width, page.height],
      margin: 0,
      bufferPages: true,
      info: { Title: report.title, Author: shop.name },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    registerFonts(doc);

    const newPage = () => {
      doc.addPage({ size: [page.width, page.height], margin: 0 });
      return M;
    };

    let y = drawHeader(doc, report, page.width, W);

    if (report.info?.length) y = drawInfo(doc, y, report.info, W);
    if (report.summary?.length) y = drawSummary(doc, y, report.summary, W);

    for (const section of report.sections) {
      const cols = fitColumns(section.columns, W);
      if (y + 60 > bottom) y = newPage();
      if (section.heading) {
        doc.font(FONT.bold).fontSize(10).fillColor(COLORS.ink).text(section.heading, M, y + 2, { lineBreak: false });
        y += 18;
      }
      y = drawTableHeader(doc, y, cols, W);
      if (!section.rows.length) {
        doc
          .font(FONT.regular)
          .fontSize(9)
          .fillColor(COLORS.muted)
          .text(section.empty || "Nothing to show.", M, y + 10, { width: W, align: "center" });
        y += 32;
      }
      let stripe = 0;
      for (const row of section.rows) {
        if (y + ROW_H > bottom) {
          y = newPage();
          y = drawTableHeader(doc, y, cols, W);
        }
        y = drawRow(doc, y, row, cols, W, stripe);
        stripe = row.kind === "group" ? 0 : stripe + 1;
      }
      if (section.total) {
        if (y + 22 > bottom) y = newPage();
        y = drawTotal(doc, y, section.total, cols, W);
      }
      y += 14;
    }

    if (report.notes?.length) {
      for (const note of report.notes) {
        doc.font(FONT.regular).fontSize(8.5);
        const h = doc.heightOfString(note, { width: W });
        if (y + h > bottom) y = newPage();
        doc.fillColor(COLORS.muted).text(note, M, y, { width: W });
        y += h + 4;
      }
    }

    drawFooters(doc, page, W, report.footNote);
    doc.end();
  });
}

function fitColumns(cols: PdfCol[], W: number) {
  const total = cols.reduce((sum, col) => sum + col.width, 0) || 1;
  return cols.map((col) => ({ ...col, width: (col.width / total) * W }));
}

function drawHeader(doc: PDFKit.PDFDocument, report: PdfReport, pageWidth: number, W: number) {
  const logo = 36;
  drawBabuLogo(doc, M, 22, logo);
  const x = M + logo + 12;
  const nameW = drawWordmarkText(doc, shop.name.toUpperCase(), x, 19, 17);
  doc
    .font(FONT.bold)
    .fontSize(7.5)
    .fillColor(COLORS.accent)
    .text("ACCESSORIES", x + nameW + 6, 27, { lineBreak: false });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(shop.address, x, 42, { lineBreak: false })
    .text(`Ph: ${shop.phone}`, x, 52, { lineBreak: false });

  const rightW = Math.min(W * 0.48, 300);
  doc
    .font(FONT.bold)
    .fontSize(13)
    .fillColor(COLORS.ink)
    .text(report.title.toUpperCase(), M + W - rightW, 22, { width: rightW, align: "right", characterSpacing: 0.4 });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(report.subtitle || `As of ${pdfDay(new Date())}`, M + W - rightW, 42, { width: rightW, align: "right" });

  doc.moveTo(M, 70).lineTo(pageWidth - M, 70).strokeColor(COLORS.slate).lineWidth(1).stroke();
  return 82;
}

function drawInfo(doc: PDFKit.PDFDocument, y: number, info: Array<{ label: string; value: string }>, W: number) {
  const perRow = 3;
  const rows = Math.ceil(info.length / perRow);
  const h = rows * 26 + 10;
  doc.roundedRect(M, y, W, h, 8).fill("#F4F6FB");
  const cw = W / perRow;
  info.forEach((item, i) => {
    const cx = M + (i % perRow) * cw + 10;
    const cy = y + 6 + Math.floor(i / perRow) * 26;
    doc.font(FONT.medium).fontSize(7).fillColor(COLORS.muted).text(item.label.toUpperCase(), cx, cy, {
      width: cw - 20,
      lineBreak: false,
      characterSpacing: 0.4,
    });
    doc.font(FONT.semibold).fontSize(9).fillColor(COLORS.ink).text(item.value || "—", cx, cy + 10, {
      width: cw - 20,
      lineBreak: false,
      ellipsis: true,
    });
  });
  return y + h + 10;
}

function drawSummary(doc: PDFKit.PDFDocument, y: number, boxes: NonNullable<PdfReport["summary"]>, W: number) {
  const perRow = Math.min(boxes.length, 5);
  const gap = 8;
  const bw = (W - gap * (perRow - 1)) / perRow;
  boxes.forEach((box, i) => {
    const bx = M + (i % perRow) * (bw + gap);
    const by = y + Math.floor(i / perRow) * 50;
    doc.roundedRect(bx, by, bw, 42, 8).fill(box.tone ? TONE_FILL[box.tone] : "#F4F6FB");
    doc.font(FONT.medium).fontSize(7).fillColor(COLORS.muted).text(box.label.toUpperCase(), bx + 9, by + 8, {
      width: bw - 18,
      characterSpacing: 0.4,
      lineBreak: false,
      ellipsis: true,
    });
    // Shrink long values to fit the box instead of wrapping.
    let size = 11.5;
    doc.font(FONT.bold).fontSize(size);
    while (size > 7 && doc.widthOfString(box.value) > bw - 18) {
      size -= 0.5;
      doc.fontSize(size);
    }
    doc
      .fillColor(box.tone ? PDF_TONE[box.tone] : COLORS.ink)
      .text(box.value, bx + 9, by + 21, { width: bw - 18, lineBreak: false });
  });
  return y + Math.ceil(boxes.length / perRow) * 50 + 6;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number, cols: PdfCol[], W: number) {
  doc.rect(M, y, W, 20).fill(COLORS.slate);
  let x = M;
  doc.font(FONT.semibold).fontSize(7.5).fillColor(COLORS.white);
  for (const col of cols) {
    doc.text(col.label, x + PAD, y + 6.5, { width: col.width - PAD * 2, align: col.align || "left", lineBreak: false });
    x += col.width;
  }
  return y + 20;
}

function drawRow(doc: PDFKit.PDFDocument, y: number, row: PdfRow, cols: PdfCol[], W: number, stripe: number) {
  if (row.kind === "group") {
    const h = 22;
    doc.rect(M, y, W, h).fill(COLORS.accentSoft);
    const text = Object.values(row.cells).filter(Boolean).join("   ·   ");
    doc.font(FONT.bold).fontSize(8.5).fillColor(COLORS.slate).text(text, M + PAD, y + 7, {
      width: W - PAD * 2,
      lineBreak: false,
      ellipsis: true,
    });
    return y + h;
  }
  if (row.kind === "subtotal") return drawTotal(doc, y, row.cells, cols, W, "#EEF2F8");

  const hasSub = Boolean(row.sub && Object.values(row.sub).some(Boolean));
  const h = hasSub ? ROW_H + 2 : 20;
  if (stripe % 2 === 1) doc.rect(M, y, W, h).fill("#F8FAFD");
  let x = M;
  for (const col of cols) {
    const w = col.width - PAD * 2;
    const text = row.cells[col.key] ?? "";
    doc
      .font(col === cols[0] || col.key === "name" ? FONT.semibold : FONT.regular)
      .fontSize(8)
      .fillColor(row.color?.[col.key] || COLORS.ink)
      .text(text || "—", x + PAD, y + 6, { width: w, align: col.align || "left", lineBreak: false, ellipsis: true });
    const sub = row.sub?.[col.key];
    if (sub) {
      doc.font(FONT.regular).fontSize(6.8).fillColor(COLORS.muted).text(sub, x + PAD, y + 16, {
        width: w,
        align: col.align || "left",
        lineBreak: false,
        ellipsis: true,
      });
    }
    x += col.width;
  }
  doc.moveTo(M, y + h).lineTo(M + W, y + h).strokeColor("#E6EAF1").lineWidth(0.5).stroke();
  return y + h;
}

function drawTotal(
  doc: PDFKit.PDFDocument,
  y: number,
  cells: Record<string, string>,
  cols: PdfCol[],
  W: number,
  fill: string = COLORS.accentSoft,
) {
  const h = 22;
  doc.rect(M, y, W, h).fill(fill);
  let x = M;
  doc.font(FONT.bold).fontSize(8.2).fillColor(COLORS.ink);
  for (const col of cols) {
    const text = cells[col.key];
    if (text) {
      doc.text(text, x + PAD, y + 7, { width: col.width - PAD * 2, align: col.align || "left", lineBreak: false, ellipsis: true });
    }
    x += col.width;
  }
  return y + h;
}

function drawFooters(doc: PDFKit.PDFDocument, page: { width: number; height: number }, W: number, note?: string) {
  const range = doc.bufferedPageRange();
  const generated = format(new Date(), "dd MMM yyyy, h:mm a");
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = page.height - FOOTER_H + 8;
    doc.moveTo(M, y - 6).lineTo(page.width - M, y - 6).strokeColor("#E6EAF1").lineWidth(0.5).stroke();
    doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.muted);
    if (note) doc.text(note, M, y, { width: W - 190, lineBreak: false, ellipsis: true });
    doc.text(`Generated ${generated}  ·  Page ${i - range.start + 1} of ${range.count}`, M, y, {
      width: W,
      align: "right",
      lineBreak: false,
    });
  }
}

export function sendPdf(res: import("express").Response, pdf: Buffer, filename: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(pdf);
}
