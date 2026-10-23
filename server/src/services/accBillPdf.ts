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
const M = 28;
const W = PAGE.width - M * 2;
const PAD = 7;

/** Height reserved on every page for the generated / page-number strip. */
const FOOT_H = 26;
/** Height of the terms + signature block pinned above the footer. */
const CLOSE_H = 104;

const LINE = "#DFE4EF";
const LINE_SOFT = "#EDF0F6";
const ZEBRA = "#F7F9FC";
const TINT = "#F4F6FB";
const RED = "#B42318";
const RED_TINT = "#FDECEC";
const GREEN = "#0B7A5B";

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
  cashAmount: number;
  onlineAmount: number;
  dueAmount: number;
  /** Customer's balance across every bill, when known. */
  outstanding?: number | null;
  note?: string;
};

const COLS = [
  { key: "n", label: "#", w: 26, align: "right" as const },
  { key: "name", label: "Item", w: 0, align: "left" as const },
  { key: "qty", label: "Qty", w: 52, align: "right" as const },
  { key: "rate", label: "Rate", w: 78, align: "right" as const },
  { key: "amount", label: "Amount", w: 90, align: "right" as const },
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
  const logo = 38;
  drawBabuLogo(doc, M, 20, logo);
  const x = M + logo + 12;

  const nameW = drawWordmarkText(doc, shop.name.toUpperCase(), x, 17, 17);
  doc
    .font(FONT.bold)
    .fontSize(7.5)
    .fillColor(COLORS.accent)
    .text("ACCESSORIES", x + nameW + 6, 25, { lineBreak: false });

  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(shop.address, x, 41, { width: 260, lineBreak: false })
    .text(`Ph: ${shop.phone}`, x, 51, { lineBreak: false });

  const rightW = 230;
  const rx = M + W - rightW;
  doc
    .font(FONT.bold)
    .fontSize(15)
    .fillColor(COLORS.ink)
    .text(bill.kind === "WHOLESALE" ? "WHOLESALE BILL" : "BILL", rx, 19, {
      width: rightW,
      align: "right",
      characterSpacing: 0.4,
    });

  // Bill number is what a customer quotes on the phone — give it weight.
  doc
    .font(FONT.semibold)
    .fontSize(10)
    .fillColor(COLORS.slate)
    .text(bill.number, rx, 39, { width: rightW, align: "right" });
  doc
    .font(FONT.regular)
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(day(bill.saleDate), rx, 52, { width: rightW, align: "right" });

  doc
    .moveTo(M, 70)
    .lineTo(PAGE.width - M, 70)
    .strokeColor(COLORS.slate)
    .lineWidth(1)
    .stroke();

  if (bill.voidedAt) {
    doc
      .roundedRect(M, 76, 74, 17, 5)
      .fill(RED_TINT)
      .font(FONT.bold)
      .fontSize(8.5)
      .fillColor(RED)
      .text("CANCELLED", M, 81, {
        width: 74,
        align: "center",
        characterSpacing: 0.6,
      });
    return 100;
  }
  return 82;
}

/** Bill-to on the left, bill details on the right. */
function drawParties(doc: PDFKit.PDFDocument, y: number, bill: AccBillPdfInput) {
  const gap = 12;
  const leftW = W * 0.56 - gap / 2;
  const rightW = W - leftW - gap;
  const rx = M + leftW + gap;

  const c = bill.customer;
  const place = [c.address, c.city].filter(Boolean).join(", ");

  const leftLines: Array<[string, string]> = [];
  if (c.shopName && c.shopName !== c.name) leftLines.push(["Shop", c.shopName]);
  if (place) leftLines.push(["Address", place]);
  if (c.phone) leftLines.push(["Phone", c.phone]);
  if (c.gstin) leftLines.push(["GSTIN", c.gstin]);

  const rightLines: Array<[string, string]> = [
    ["Bill no.", bill.number],
    ["Date", day(bill.saleDate)],
  ];
  if (bill.dueDate) rightLines.push(["Pay by", day(bill.dueDate)]);

  const rows = Math.max(leftLines.length, rightLines.length);
  const h = 34 + rows * 13 + 10;

  doc.roundedRect(M, y, leftW, h, 8).fill(TINT);
  doc.roundedRect(rx, y, rightW, h, 8).fill(TINT);

  const title = (label: string, x: number, w: number) =>
    doc
      .font(FONT.semibold)
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(label, x + 11, y + 10, {
        width: w - 22,
        characterSpacing: 0.9,
        lineBreak: false,
      });

  title("BILL TO", M, leftW);
  title("BILL DETAILS", rx, rightW);

  doc
    .font(FONT.bold)
    .fontSize(12)
    .fillColor(COLORS.ink)
    .text(c.name || "Walk-in customer", M + 11, y + 22, {
      width: leftW - 22,
      lineBreak: false,
      ellipsis: true,
    });

  const pair = (
    lines: Array<[string, string]>,
    x: number,
    w: number,
    startY: number,
  ) => {
    let ly = startY;
    for (const [label, value] of lines) {
      doc
        .font(FONT.regular)
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(label, x + 11, ly, { width: 52, lineBreak: false });
      doc
        .font(FONT.medium)
        .fontSize(8.5)
        .fillColor(COLORS.ink)
        .text(value, x + 11 + 54, ly, {
          width: w - 22 - 54,
          lineBreak: false,
          ellipsis: true,
        });
      ly += 13;
    }
  };

  pair(leftLines, M, leftW, y + 40);
  pair(rightLines, rx, rightW, y + 24);

  return y + h + 14;
}

function drawTableHead(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(M, y, W, 22).fill(COLORS.slate);
  let x = M;
  doc.font(FONT.semibold).fontSize(8).fillColor(COLORS.white);
  for (const col of COLS) {
    doc.text(col.label, x + PAD, y + 7.5, {
      width: col.w - PAD * 2,
      align: col.align,
      lineBreak: false,
    });
    x += col.w;
  }
  return y + 22;
}

/** Tall enough for the item name plus its category line. */
const ROW_H = 29;

function drawItem(
  doc: PDFKit.PDFDocument,
  y: number,
  item: AccBillItem,
  index: number,
) {
  if (index % 2 === 1) doc.rect(M, y, W, ROW_H).fill(ZEBRA);

  const hasSub = Boolean(item.categoryName);
  const top = hasSub ? y + 5 : y + 10;
  let x = M;

  const put = (
    col: (typeof COLS)[number],
    text: string,
    font: string = FONT.medium,
    size = 9,
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

  put(COLS[0], String(index + 1), FONT.regular, 8.5);

  // Item name, with its category as a quiet second line.
  doc
    .font(FONT.semibold)
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(item.name, x + PAD, top, {
      width: COLS[1].w - PAD * 2,
      lineBreak: false,
      ellipsis: true,
    });
  if (hasSub) {
    doc
      .font(FONT.regular)
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .text(item.categoryName!, x + PAD, top + 11, {
        width: COLS[1].w - PAD * 2,
        lineBreak: false,
        ellipsis: true,
      });
  }
  x += COLS[1].w;

  put(COLS[2], String(item.qty), FONT.medium, 9);
  put(COLS[3], money(item.rate), FONT.regular, 9);
  put(COLS[4], money(item.amount), FONT.semibold, 9);

  doc
    .moveTo(M, y + ROW_H)
    .lineTo(M + W, y + ROW_H)
    .strokeColor(LINE_SOFT)
    .lineWidth(0.5)
    .stroke();

  return y + ROW_H;
}

function drawItemsTotal(doc: PDFKit.PDFDocument, y: number, bill: AccBillPdfInput) {
  const h = 24;
  const pcs = bill.items.reduce((sum, i) => sum + i.qty, 0);
  doc.rect(M, y, W, h).fill(COLORS.accentSoft);

  doc
    .font(FONT.semibold)
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(
      `${bill.items.length} item${bill.items.length === 1 ? "" : "s"}  ·  ${pcs} pcs`,
      M + PAD + COLS[0].w,
      y + 8,
      { width: COLS[1].w, lineBreak: false },
    );

  doc
    .font(FONT.bold)
    .fontSize(9.5)
    .fillColor(COLORS.ink)
    .text(money(bill.subtotal), M + W - COLS[4].w + PAD, y + 7.5, {
      width: COLS[4].w - PAD * 2,
      align: "right",
      lineBreak: false,
    });

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
  lines.push({ label: "Bill total", value: money(bill.total), rule: true });
  if (bill.cashAmount) {
    lines.push({ label: "Paid in cash", value: money(bill.cashAmount), tone: "muted" });
  }
  if (bill.onlineAmount) {
    lines.push({ label: "Paid online", value: money(bill.onlineAmount), tone: "muted" });
  }
  return lines;
}

function hasOutstandingLine(bill: AccBillPdfInput) {
  return bill.outstanding != null && Math.abs(bill.outstanding - bill.dueAmount) > 0.005;
}

/** Exact height drawTotals will use, so the block can sit at the foot of the page. */
function totalsHeight(bill: AccBillPdfInput) {
  const lines = totalLines(bill);
  let h = lines.length * TOTAL_ROW_H + lines.filter((l) => l.rule).length * 4;
  h += bill.dueAmount > 0 ? 36 : 32;
  if (hasOutstandingLine(bill)) h += 14;
  return Math.max(46, h) + 10;
}

/** Words on the left, the money stack on the right — invoice convention. */
function drawTotals(doc: PDFKit.PDFDocument, y: number, bill: AccBillPdfInput) {
  const stackW = 238;
  const sx = M + W - stackW;
  const wordsW = W - stackW - 14;
  const lines = totalLines(bill);
  const rowH = TOTAL_ROW_H;

  // ---- amount in words ----
  doc.roundedRect(M, y, wordsW, 46, 8).fill(TINT);
  doc
    .font(FONT.semibold)
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text("AMOUNT IN WORDS", M + 11, y + 9, {
      characterSpacing: 0.9,
      lineBreak: false,
    });
  doc
    .font(FONT.medium)
    .fontSize(8.5)
    .fillColor(COLORS.ink)
    .text(amountInWords(bill.total), M + 11, y + 21, { width: wordsW - 22 });

  // ---- money stack ----
  let sy = y;
  for (const line of lines) {
    doc
      .font(line.tone === "muted" ? FONT.regular : FONT.semibold)
      .fontSize(line.tone === "muted" ? 8.5 : 9.5)
      .fillColor(line.tone === "muted" ? COLORS.muted : COLORS.ink)
      .text(line.label, sx, sy + 4, { width: stackW - 100, lineBreak: false });
    doc
      .font(line.tone === "muted" ? FONT.medium : FONT.bold)
      .fontSize(line.tone === "muted" ? 8.5 : 9.5)
      .fillColor(COLORS.ink)
      .text(line.value, sx + stackW - 100, sy + 4, {
        width: 100,
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
    doc.roundedRect(sx, sy + 2, stackW, 30, 7).fill(RED_TINT);
    doc
      .font(FONT.semibold)
      .fontSize(9)
      .fillColor(RED)
      .text("Due on this bill", sx + 11, sy + 12, {
        width: stackW - 120,
        lineBreak: false,
      });
    doc
      .font(FONT.bold)
      .fontSize(12)
      .fillColor(RED)
      .text(`Rs. ${money(bill.dueAmount)}`, sx + stackW - 120, sy + 9, {
        width: 109,
        align: "right",
        lineBreak: false,
      });
    sy += 36;
  } else {
    doc.roundedRect(sx, sy + 2, stackW, 26, 7).fill("#E7F8F1");
    doc
      .font(FONT.bold)
      .fontSize(9.5)
      .fillColor(GREEN)
      .text("PAID IN FULL", sx, sy + 10, {
        width: stackW,
        align: "center",
        characterSpacing: 0.8,
        lineBreak: false,
      });
    sy += 32;
  }

  // Running balance, only when it differs from this bill's own due.
  if (hasOutstandingLine(bill) && bill.outstanding != null) {
    doc
      .font(FONT.regular)
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text("Total outstanding (all bills)", sx, sy, {
        width: stackW - 100,
        lineBreak: false,
      });
    doc
      .font(FONT.semibold)
      .fontSize(8.5)
      .fillColor(bill.outstanding > 0 ? RED : COLORS.ink)
      .text(money(bill.outstanding), sx + stackW - 100, sy, {
        width: 100,
        align: "right",
        lineBreak: false,
      });
    sy += 14;
  }

  return Math.max(y + 46, sy) + 10;
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
      if (y + 24 > bottom) {
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
