import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { format } from "date-fns";
import {
  COLORS,
  FONT,
  drawBabuLogo,
  drawWordmarkText,
  money,
  registerFonts,
  shop,
} from "./pdf";

/**
 * The customer's bill, laid out as an invoice rather than as a report.
 *
 * accPdf.ts renders every accessories PDF through one table-report shape,
 * which suits stock and dues listings but leaves a bill looking like a
 * spreadsheet: totals in a full-width table, no amount in words, no
 * signature, and the page empty below the halfway mark. This file owns the
 * bill alone, so it can use invoice conventions — a bill-to block, a
 * right-aligned totals stack, and a closing block pinned to the foot of the
 * page so a three-line bill still fills an A4 sheet.
 */

const PAGE = { width: 595.28, height: 841.89 };
const M = 42;
const W = PAGE.width - M * 2;
const PAD = 9;

/** Height reserved on every page for the generated / page-number strip. */
const FOOT_H = 30;
/** Height of the terms + signature block pinned above the footer. */
const CLOSE_H = 116;

const LINE = "#E4EAF3";
const LINE_SOFT = "#EEF2F7";
const TABLE_HEAD = "#EFF4FB";
const TINT = "#F5F8FC";
const BLUE = "#2358B9";
const RED = "#C43E4C";
const RED_TINT = "#FFF2F2";
const GREEN = "#168263";

export type AccBillItem = {
  name: string;
  categoryName?: string;
  qty: number;
  rate: number;
  amount: number;
};

export type AccBillPdfInput = {
  number: string;
  kind: "RETAIL" | "WHOLESALE";
  saleDate: Date | string;
  dueDate?: Date | string | null;
  voidedAt?: Date | string | null;
  customer: {
    name: string;
    phone?: string;
    shopName?: string;
    address?: string;
    city?: string;
    gstin?: string;
  };
  items: AccBillItem[];
  subtotal: number;
  discount: number;
  total: number;
  transportCharge: number;
  cashAmount: number;
  onlineAmount: number;
  dueAmount: number;
  note?: string;
};

const COLS = [
  { key: "n", label: "#", w: 30, align: "left" as const },
  { key: "name", label: "Product description", w: 0, align: "left" as const },
  { key: "qty", label: "Qty", w: 50, align: "right" as const },
  { key: "rate", label: "Rate (Rs.)", w: 76, align: "right" as const },
  { key: "amount", label: "Amount (Rs.)", w: 92, align: "right" as const },
];
// The item column takes whatever the fixed columns leave.
COLS[1].w = W - COLS.reduce((sum, c) => sum + c.w, 0);

function day(value: Date | string | null | undefined) {
  if (!value) return "";
  return format(new Date(value), "dd MMM yyyy");
}

/* ---------------------------------------------------------------- *
 * Amount in words — expected on an Indian invoice, and the quickest
 * check that a printed figure hasn't been altered.
 * ---------------------------------------------------------------- */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? ` ${ONES[o]}` : "");
}

function underThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [
    h ? `${ONES[h]} Hundred` : "",
    rest ? underHundred(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Indian grouping: crore, lakh, thousand, hundred. */
export function amountInWords(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const whole = Math.floor(rounded);
  const paise = Math.round((rounded - whole) * 100);

  if (whole === 0 && paise === 0) return "Zero Rupees Only";

  const parts: string[] = [];
  const crore = Math.floor(whole / 10000000);
  const lakh = Math.floor((whole % 10000000) / 100000);
  const thousand = Math.floor((whole % 100000) / 1000);
  const rest = whole % 1000;

  if (crore) parts.push(`${underThousand(crore)} Crore`);
  if (lakh) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest) parts.push(underThousand(rest));

  const rupees = parts.join(" ");
  const sign = amount < 0 ? "Minus " : "";

  if (paise) {
    return `${sign}${rupees} Rupees and ${underHundred(paise)} Paise Only`.trim();
  }
  return `${sign}${rupees} Rupees Only`.trim();
}

/* ---------------------------------------------------------------- *
 * Drawing
 * ---------------------------------------------------------------- */

function drawHeader(doc: PDFKit.PDFDocument, bill: AccBillPdfInput) {
  const logo = 46;
  drawBabuLogo(doc, M, 28, logo);
  const x = M + logo + 14;

  drawWordmarkText(doc, shop.name.toUpperCase(), x, 27, 16.5);
  doc
    .font(FONT.bold)
    .fontSize(7.5)
    .fillColor(BLUE)
    .text("MOBILE ACCESSORIES", x, 48, {
      characterSpacing: 1.1,
      lineBreak: false,
    });

  doc
    .font(FONT.regular)
    .fontSize(7.8)
    .fillColor(COLORS.muted)
    .text(shop.address, x, 62, { width: 270, lineBreak: false, ellipsis: true })
    .text(`Phone: ${shop.phone}`, x, 74, { lineBreak: false });

  const rightW = 190;
  const rx = M + W - rightW;
  doc
    .font(FONT.bold)
    .fontSize(7.5)
    .fillColor(BLUE)
    .text(bill.kind === "WHOLESALE" ? "WHOLESALE BILL" : "RETAIL BILL", rx, 27, {
      width: rightW,
      align: "right",
      characterSpacing: 1.4,
    });
  doc
    .font(FONT.bold)
    .fontSize(22)
    .fillColor(COLORS.ink)
    .text(bill.number, rx, 40, { width: rightW, align: "right", lineBreak: false });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(`Issued ${day(bill.saleDate)}`, rx, 66, { width: rightW, align: "right" });

  const statusText = bill.voidedAt ? "CANCELLED" : bill.dueAmount > 0 ? "BALANCE DUE" : "PAID IN FULL";
  const statusColor = bill.voidedAt || bill.dueAmount > 0 ? RED : GREEN;
  const statusFill = bill.voidedAt || bill.dueAmount > 0 ? RED_TINT : "#EAF8F2";
  const statusW = bill.dueAmount > 0 ? 78 : 72;
  const statusX = M + W - statusW;
  doc.roundedRect(statusX, 81, statusW, 18, 9).fill(statusFill);
  doc.circle(statusX + 10, 90, 2.5).fill(statusColor);
  doc
    .font(FONT.bold)
    .fontSize(7)
    .fillColor(statusColor)
    .text(statusText, statusX + 16, 86.5, {
      width: statusW - 21,
      align: "center",
      characterSpacing: 0.35,
      lineBreak: false,
    });

  doc
    .moveTo(M, 112)
    .lineTo(PAGE.width - M, 112)
    .strokeColor(COLORS.ink)
    .lineWidth(1.2)
    .stroke();
  return 133;
}

/** Bill-to on the left, bill details on the right. */
function drawParties(doc: PDFKit.PDFDocument, y: number, bill: AccBillPdfInput) {
  const gap = 34;
  const leftW = W * 0.52 - gap / 2;
  const rightW = W - leftW - gap;
  const rx = M + leftW + gap;

  const c = bill.customer;
  const place = [c.address, c.city].filter(Boolean).join(", ");

  const rightLines: Array<[string, string]> = [
    ["Bill number", bill.number],
    ["Bill date", day(bill.saleDate)],
  ];
  if (bill.dueDate) rightLines.push(["Payment due", day(bill.dueDate)]);
  rightLines.push(["Bill type", bill.kind === "WHOLESALE" ? "Wholesale" : "Retail"]);

  const h = Math.max(94, 20 + rightLines.length * 17);

  const kicker = (label: string, x: number, w: number) =>
    doc.font(FONT.bold).fontSize(7).fillColor("#8A98AC").text(label, x, y, {
      width: w,
      characterSpacing: 1.25,
      lineBreak: false,
    });

  kicker("BILL TO", M, leftW);
  kicker("BILL DETAILS", rx, rightW);

  doc
    .font(FONT.bold)
    .fontSize(13.5)
    .fillColor(COLORS.ink)
    .text(c.name || "Walk-in customer", M, y + 18, {
      width: leftW,
      lineBreak: false,
      ellipsis: true,
    });
  let cy = y + 39;
  const customerLines = [
    c.shopName && c.shopName !== c.name ? c.shopName : "",
    place,
    c.phone ? `+91 ${c.phone.replace(/^\+?91/, "")}` : "",
    c.gstin ? `GSTIN: ${c.gstin}` : "",
  ].filter(Boolean);
  customerLines.forEach((line, index) => {
    doc
      .font(index === 0 ? FONT.semibold : FONT.regular)
      .fontSize(index === 0 ? 9 : 8.2)
      .fillColor(index === 0 ? COLORS.ink : COLORS.muted)
      .text(line, M, cy, { width: leftW, lineBreak: false, ellipsis: true });
    cy += 13;
  });

  doc.roundedRect(rx, y + 15, rightW, h - 15, 9).fill(TINT).strokeColor(LINE).lineWidth(0.5).stroke();
  let my = y + 28;
  rightLines.forEach(([label, value]) => {
    doc.font(FONT.regular).fontSize(8).fillColor(COLORS.muted).text(label, rx + 14, my, {
      width: rightW * 0.45,
      lineBreak: false,
    });
    doc.font(FONT.semibold).fontSize(8.2).fillColor(COLORS.ink).text(value, rx + rightW * 0.45, my, {
      width: rightW * 0.55 - 14,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });
    my += 17;
  });

  return y + h + 24;
}

function drawItemsTitle(doc: PDFKit.PDFDocument, y: number, bill: AccBillPdfInput) {
  const pieces = bill.items.reduce((sum, item) => sum + item.qty, 0);
  doc.font(FONT.bold).fontSize(10.5).fillColor(COLORS.ink).text("Items purchased", M, y, {
    width: W / 2,
    lineBreak: false,
  });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(`${bill.items.length} product${bill.items.length === 1 ? "" : "s"}  ·  ${pieces} pieces`, M + W / 2, y + 1, {
      width: W / 2,
      align: "right",
      lineBreak: false,
    });
  return y + 18;
}

function drawTableHead(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(M, y, W, 26).fill(TABLE_HEAD);
  let x = M;
  doc.font(FONT.bold).fontSize(7).fillColor("#657994");
  for (const col of COLS) {
    doc.text(col.label.toUpperCase(), x + PAD, y + 9, {
      width: col.w - PAD * 2,
      align: col.align,
      characterSpacing: 0.45,
      lineBreak: false,
    });
    x += col.w;
  }
  return y + 26;
}

/** Tall enough for the item name plus its category line. */
const ROW_H = 34;

function drawItem(
  doc: PDFKit.PDFDocument,
  y: number,
  item: AccBillItem,
  index: number,
) {
  const hasSub = Boolean(item.categoryName);
  const top = hasSub ? y + 7 : y + 12;
  let x = M;

  const put = (
    col: (typeof COLS)[number],
    text: string,
    font: string = FONT.medium,
    size = 8.8,
  ) => {
    doc
      .font(font)
      .fontSize(size)
      .fillColor(COLORS.ink)
      .text(text, x + PAD, top, {
        width: col.w - PAD * 2,
        align: col.align,
        lineBreak: false,
        ellipsis: true,
      });
    x += col.w;
  };

  put(COLS[0], String(index + 1).padStart(2, "0"), FONT.regular, 8);

  // Item name, with its category as a quiet second line.
  doc
    .font(FONT.semibold)
    .fontSize(9.2)
    .fillColor(COLORS.ink)
    .text(item.name, x + PAD, top, {
      width: COLS[1].w - PAD * 2,
      lineBreak: false,
      ellipsis: true,
    });
  if (hasSub) {
    doc
      .font(FONT.regular)
      .fontSize(7.4)
      .fillColor(COLORS.muted)
      .text(item.categoryName!, x + PAD, top + 11, {
        width: COLS[1].w - PAD * 2,
        lineBreak: false,
        ellipsis: true,
      });
  }
  x += COLS[1].w;

  put(COLS[2], String(item.qty), FONT.medium, 8.8);
  put(COLS[3], money(item.rate), FONT.regular, 8.8);
  put(COLS[4], money(item.amount), FONT.semibold, 8.8);

  doc
    .moveTo(M, y + ROW_H)
    .lineTo(M + W, y + ROW_H)
    .strokeColor(LINE_SOFT)
    .lineWidth(0.5)
    .stroke();

  return y + ROW_H;
}

function drawItemsTotal(doc: PDFKit.PDFDocument, y: number, bill: AccBillPdfInput) {
  const h = 28;
  const pcs = bill.items.reduce((sum, i) => sum + i.qty, 0);
  doc.rect(M, y, W, h).fill("#FAFBFD");

  doc
    .font(FONT.semibold)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      `Quantity:  ${pcs} pieces`,
      M + PAD,
      y + 10,
      { width: COLS[1].w, lineBreak: false },
    );

  doc
    .font(FONT.bold)
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(`Items total   ${money(bill.subtotal)}`, M + W / 2, y + 9.5, {
      width: W / 2 - PAD,
      align: "right",
      lineBreak: false,
    });

  doc.moveTo(M, y + h).lineTo(M + W, y + h).strokeColor(LINE).lineWidth(0.5).stroke();

  return y + h;
}

type TotalLine = {
  label: string;
  value: string;
  tone?: "muted" | "due";
  rule?: boolean;
};

const TOTAL_ROW_H = 17;

function totalLines(bill: AccBillPdfInput) {
  const lines: TotalLine[] = [];

  // Subtotal only says something when a discount sits between it and the total.
  if (bill.discount) {
    lines.push({ label: "Subtotal", value: money(bill.subtotal), tone: "muted" });
    lines.push({
      label: "Discount",
      value: `- ${money(bill.discount)}`,
      tone: "muted",
    });
  }
  if (bill.transportCharge > 0) {
    lines.push({ label: "Transport charges", value: money(bill.transportCharge), tone: "muted" });
  }
  lines.push({ label: bill.transportCharge > 0 ? "Amount payable" : "Bill total", value: money(bill.total), rule: true });
  if (bill.cashAmount) {
    lines.push({ label: "Paid in cash", value: `- ${money(bill.cashAmount)}`, tone: "muted" });
  }
  if (bill.onlineAmount) {
    lines.push({ label: "Paid by UPI", value: `- ${money(bill.onlineAmount)}`, tone: "muted" });
  }
  return lines;
}

/** Exact height drawTotals will use, so the block can sit at the foot of the page. */
function totalsHeight(bill: AccBillPdfInput) {
  const lines = totalLines(bill);
  let h = lines.length * TOTAL_ROW_H + lines.filter((l) => l.rule).length * 4;
  h += bill.dueAmount > 0 ? 44 : 38;
  return Math.max(58, h) + 10;
}

/** Words on the left, the money stack on the right — invoice convention. */
function drawTotals(doc: PDFKit.PDFDocument, y: number, bill: AccBillPdfInput) {
  const stackW = 226;
  const sx = M + W - stackW;
  const wordsW = W - stackW - 14;
  const lines = totalLines(bill);
  const rowH = TOTAL_ROW_H;

  // ---- amount in words ----
  doc.roundedRect(M, y, wordsW, 58, 9).fill(TINT);
  doc
    .font(FONT.semibold)
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text("AMOUNT IN WORDS", M + 14, y + 12, {
      characterSpacing: 0.9,
      lineBreak: false,
    });
  doc
    .font(FONT.medium)
    .fontSize(8.7)
    .fillColor(COLORS.ink)
    .text(amountInWords(bill.total), M + 14, y + 27, { width: wordsW - 28, lineGap: 2 });

  // ---- money stack ----
  let sy = y;
  for (const line of lines) {
    doc
      .font(line.tone === "muted" ? FONT.regular : FONT.semibold)
      .fontSize(line.tone === "muted" ? 8.5 : 9.5)
      .fillColor(line.tone === "muted" ? COLORS.muted : COLORS.ink)
      .text(line.label, sx, sy + 4, { width: stackW - 104, lineBreak: false });
    doc
      .font(line.tone === "muted" ? FONT.medium : FONT.bold)
      .fontSize(line.tone === "muted" ? 8.5 : 9.5)
      .fillColor(COLORS.ink)
      .text(line.value, sx + stackW - 104, sy + 4, {
        width: 104,
        align: "right",
        lineBreak: false,
      });
    sy += rowH;
    if (line.rule) {
      // Below the text's descenders, not through them.
      doc
        .moveTo(sx, sy + 1)
        .lineTo(sx + stackW, sy + 1)
        .strokeColor(LINE)
        .lineWidth(0.5)
        .stroke();
      sy += 4;
    }
  }

  // The due is the one number a wholesale customer must not miss.
  if (bill.dueAmount > 0) {
    doc.roundedRect(sx, sy + 3, stackW, 36, 8).fill(RED_TINT).strokeColor("#FFDFDF").lineWidth(0.5).stroke();
    doc
      .font(FONT.semibold)
      .fontSize(8.8)
      .fillColor(RED)
      .text("Due on this bill", sx + 12, sy + 16, {
        width: stackW - 120,
        lineBreak: false,
      });
    doc
      .font(FONT.bold)
      .fontSize(13.5)
      .fillColor(RED)
      .text(`Rs. ${money(bill.dueAmount)}`, sx + stackW - 126, sy + 12, {
        width: 114,
        align: "right",
        lineBreak: false,
      });
    sy += 44;
  } else {
    doc.roundedRect(sx, sy + 3, stackW, 31, 8).fill("#E7F8F1");
    doc
      .font(FONT.bold)
      .fontSize(9.5)
      .fillColor(GREEN)
      .text("PAID IN FULL", sx, sy + 13, {
        width: stackW,
        align: "center",
        characterSpacing: 0.8,
        lineBreak: false,
      });
    sy += 38;
  }

  return Math.max(y + 58, sy) + 10;
}

/**
 * Terms and signature, pinned to the foot of the page. A three-line bill
 * would otherwise stop halfway down an A4 sheet and look unfinished.
 */
function drawClosing(doc: PDFKit.PDFDocument, bill: AccBillPdfInput) {
  const y = PAGE.height - FOOT_H - CLOSE_H;

  doc
    .moveTo(M, y)
    .lineTo(M + W, y)
    .strokeColor(LINE)
    .lineWidth(0.5)
    .stroke();

  const signW = 180;
  const termsW = W - signW - 20;

  if (bill.note) {
    doc
      .font(FONT.semibold)
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text("NOTE", M, y + 12, { characterSpacing: 0.9, lineBreak: false });
    doc
      .font(FONT.medium)
      .fontSize(8.5)
      .fillColor(COLORS.ink)
      .text(bill.note, M, y + 23, { width: termsW });
  }

  const termsY = bill.note ? y + 46 : y + 12;
  doc
    .font(FONT.semibold)
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text("TERMS", M, termsY, { characterSpacing: 0.9, lineBreak: false });

  const terms = [
    "Goods once sold will not be taken back or exchanged.",
    "Warranty, where it applies, is as given by the brand's service centre.",
    "Subject to Balaghat jurisdiction.",
  ];
  let ty = termsY + 11;
  doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.muted);
  for (const term of terms) {
    doc.text(`•  ${term}`, M, ty, { width: termsW, lineBreak: false, ellipsis: true });
    ty += 10;
  }

  // Signature block
  const sx = M + W - signW;
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(`For ${shop.name}`, sx, y + 14, { width: signW, align: "center", lineBreak: false });
  doc
    .moveTo(sx + 14, y + 70)
    .lineTo(sx + signW - 14, y + 70)
    .strokeColor("#AEB7C8")
    .lineWidth(0.6)
    .stroke();
  doc
    .font(FONT.semibold)
    .fontSize(8)
    .fillColor(COLORS.ink)
    .text("Authorised Signatory", sx, y + 76, {
      width: signW,
      align: "center",
      lineBreak: false,
    });
}

function drawFooters(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  const stamp = format(new Date(), "dd MMM yyyy, h:mm a");
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = PAGE.height - FOOT_H + 6;
    doc
      .moveTo(M, y - 7)
      .lineTo(PAGE.width - M, y - 7)
      .strokeColor(LINE_SOFT)
      .lineWidth(0.5)
      .stroke();
    doc
      .font(FONT.regular)
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(`Thank you for your business  ·  ${shop.name} Accessories`, M, y, {
        width: W - 170,
        lineBreak: false,
      })
      .text(
        `Generated ${stamp}  ·  Page ${i - range.start + 1} of ${range.count}`,
        M,
        y,
        { width: W, align: "right", lineBreak: false },
      );
  }
}

export function renderAccBillPdf(bill: AccBillPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      bufferPages: true,
      info: {
        Title: `${bill.kind === "WHOLESALE" ? "Wholesale bill" : "Bill"} ${bill.number}`,
        Author: shop.name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);

    let y = drawHeader(doc, bill);
    y = drawParties(doc, y, bill);
    y = drawItemsTitle(doc, y, bill);
    y = drawTableHead(doc, y);

    // Totals and the closing block both need room; break before either
    // would collide with the footer.
    const bottom = PAGE.height - FOOT_H - CLOSE_H - 12;

    if (!bill.items.length) {
      doc
        .font(FONT.regular)
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text("No items on this bill.", M, y + 16, { width: W, align: "center" });
      y += 44;
    }

    bill.items.forEach((item, index) => {
      if (y + ROW_H > bottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = drawTableHead(doc, M);
      }
      y = drawItem(doc, y, item, index);
    });

    const totalsH = totalsHeight(bill);

    if (bill.items.length) {
      if (y + 28 > bottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = drawTableHead(doc, M);
      }
      y = drawItemsTotal(doc, y, bill);
    }

    y += 16;
    if (y + totalsH > bottom) {
      doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      y = M;
    }
    // Totals sit at the foot of the page, just above the terms. With few
    // items the gap is plain blank space between the items and the totals,
    // never empty ruled rows.
    drawTotals(doc, Math.max(y, bottom - totalsH), bill);

    drawClosing(doc, bill);
    drawFooters(doc);
    doc.end();
  });
}
