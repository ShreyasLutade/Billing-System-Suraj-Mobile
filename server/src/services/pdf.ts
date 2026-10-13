import path from "path";
import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import type { Bill, BillItem } from "@prisma/client";
import { format } from "date-fns";
import {
  exchangeItemsFromInput,
  includedAccessoriesLabel,
  parseExchangeItemsJson,
  type BillExchangeItem,
} from "../lib/exchangeItems";

type BillWithItems = Bill & { items: BillItem[] };

/** App theme palette: slate blue + bright sky (matches the web UI). */
export const COLORS = {
  slate: "#3E4F8A",
  accent: "#0A9FE0",
  accentSoft: "#E3F3FF",
  ink: "#15203A",
  muted: "#5B6780",
  white: "#FFFFFF",
  gradStart: "#1ABAFF",
  gradEnd: "#5D73B6",
  /** BM logo square: dark so it prints black, not grey, in B&W. */
  logoStart: "#123E80",
  logoEnd: "#0B1B3F",
};

export const shop = {
  name: process.env.SHOP_NAME || "Babu Mobile",
  /** Small mark drawn after the shop name in the invoice header. */
  nameSuffix: (process.env.SHOP_NAME_SUFFIX ?? "NX").trim(),
  tagline:
    process.env.SHOP_TAGLINE || "Deals In - All New & Second Hand Phones",
  address:
    process.env.SHOP_ADDRESS ||
    "Novelty House Road, Balaghat (M.P.) 481001",
  phone: process.env.SHOP_PHONE || "7581817575",
  instagram: process.env.SHOP_INSTAGRAM || "@babumobile_nx_balaghat",
  gstin: process.env.SHOP_GSTIN || "23FAAPB2709A1ZP",
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 28;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FONTS_DIR = path.join(__dirname, "../../assets/fonts");
export const FONT = {
  regular: "Manrope",
  medium: "Manrope-Medium",
  semibold: "Manrope-SemiBold",
  bold: "Manrope-Bold",
  /** Chubby display face for the shop name wordmark. */
  display: "LilitaOne",
  /** Noto Sans Devanagari — Manrope has no Hindi glyphs. */
  hindi: "NotoSansDevanagari",
  hindiBold: "NotoSansDevanagari-SemiBold",
} as const;
const FOOTER_BLOCK_H = 92;

export function registerFonts(doc: PDFKit.PDFDocument) {
  doc.registerFont(FONT.regular, path.join(FONTS_DIR, "Manrope-Regular.ttf"));
  doc.registerFont(FONT.medium, path.join(FONTS_DIR, "Manrope-Medium.ttf"));
  doc.registerFont(FONT.semibold, path.join(FONTS_DIR, "Manrope-SemiBold.ttf"));
  doc.registerFont(FONT.bold, path.join(FONTS_DIR, "Manrope-Bold.ttf"));
  doc.registerFont(FONT.display, path.join(FONTS_DIR, "LilitaOne-Regular.ttf"));
  doc.registerFont(
    FONT.hindi,
    path.join(FONTS_DIR, "NotoSansDevanagari-Regular.ttf"),
  );
  doc.registerFont(
    FONT.hindiBold,
    path.join(FONTS_DIR, "NotoSansDevanagari-SemiBold.ttf"),
  );
}

/** Distance from a text box's top to its baseline, for the current font. */
export function ascenderOf(doc: PDFKit.PDFDocument, fontSize: number) {
  return (
    ((doc as unknown as { _font: { ascender: number } })._font.ascender / 1000) *
    fontSize
  );
}

/**
 * Shop-name wordmark: chubby display face in solid dark ink. Returns the
 * text width.
 */
export function drawWordmarkText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  size: number,
  tracking = 0.5,
) {
  doc.font(FONT.display).fontSize(size);
  const width = doc.widthOfString(text, { characterSpacing: tracking });
  doc
    .fillColor(COLORS.ink)
    .text(text, x, y, { lineBreak: false, characterSpacing: tracking });
  return width;
}

function exchangeItemsForPdf(bill: BillWithItems): BillExchangeItem[] {
  const fromJson = parseExchangeItemsJson(bill.exchangeItemsJson);
  if (fromJson.length) return fromJson;
  return exchangeItemsFromInput({
    isExchange: bill.isExchange,
    exchangeModel: bill.exchangeModel,
    exchangePlatform: bill.exchangePlatform,
    exchangeColor: bill.exchangeColor,
    exchangeStorage: bill.exchangeStorage,
    exchangeRam: bill.exchangeRam,
    exchangeImei1: bill.exchangeImei1,
    exchangeValue: bill.exchangeValue,
    exchangeNotes: bill.exchangeNotes,
  });
}

function exchangeLineText(item: BillExchangeItem, index: number) {
  const parts = [
    `${index + 1}. ${item.model}`,
    item.color,
    item.storage,
    item.platform === "ANDROID" && item.ram ? item.ram : null,
    `IMEI: ${item.imei1}`,
  ].filter(Boolean);
  return parts.join("  ·  ");
}

function exchangeBoxHeight(bill: BillWithItems, withGst: boolean) {
  if (withGst || !bill.isExchange || !bill.exchangeValue) return 0;
  const items = exchangeItemsForPdf(bill);
  const count = Math.max(items.length, 1);
  const cashReturn = Number(bill.exchangeCashReturn || 0);
  // Extra line when fixed return is recorded
  return 18 + count * 14 + 10 + 6 + (cashReturn > 0 ? 14 : 0);
}

function exchangeGrossValue(bill: BillWithItems) {
  return Number(bill.exchangeValue || 0) || 0;
}

function exchangeCashReturnAmount(bill: BillWithItems) {
  const gross = exchangeGrossValue(bill);
  const raw = Math.max(0, Number(bill.exchangeCashReturn || 0) || 0);
  return Math.min(raw, gross);
}

/** Amount credited against the new bill after any fixed return. */
function exchangeCreditAmount(bill: BillWithItems) {
  return round2(exchangeGrossValue(bill) - exchangeCashReturnAmount(bill));
}

/** Cash the shop pays the customer (fixed return + excess credit). */
function computePayCustomerAmount(bill: BillWithItems, withGst: boolean) {
  if (withGst || !bill.isExchange || !bill.exchangeValue) return 0;
  const credit = exchangeCreditAmount(bill);
  const excess = Math.max(credit - Number(bill.grandTotal || 0), 0);
  return round2(exchangeCashReturnAmount(bill) + excess);
}

export function money(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

function inr(amount: number) {
  return `Rs. ${money(amount)}`;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function lineTaxable(item: BillItem) {
  const amount = item.amount || round2(item.rate * item.quantity);
  if (!item.gstPercent) return amount;
  return round2((amount * 100) / (100 + item.gstPercent));
}

function lineGst(item: BillItem) {
  const amount = item.amount || round2(item.rate * item.quantity);
  return round2(amount - lineTaxable(item));
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigits(n: number) {
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return `${TENS[ten]}${one ? ` ${ONES[one]}` : ""}`.trim();
}

function amountInWords(amount: number) {
  const whole = Math.floor(Math.abs(amount));
  if (whole === 0) return "Zero Rupees Only";

  const crore = Math.floor(whole / 1_00_00_000);
  const lakh = Math.floor((whole % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((whole % 1_00_000) / 1000);
  const hundred = Math.floor((whole % 1000) / 100);
  const rest = whole % 100;

  const parts: string[] = [];
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));

  return `${parts.join(" ")} Rupees Only`.toUpperCase();
}

function strokeBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  doc.rect(x, y, w, h).strokeColor(COLORS.slate).lineWidth(0.9).stroke();
}

function drawInstagramIcon(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size = 8,
  color = COLORS.ink,
) {
  const r = size * 0.22;
  doc
    .roundedRect(x, y, size, size, r)
    .strokeColor(color)
    .lineWidth(0.9)
    .stroke();
  doc
    .circle(x + size / 2, y + size / 2, size * 0.22)
    .strokeColor(color)
    .lineWidth(0.85)
    .stroke();
  doc
    .circle(x + size * 0.72, y + size * 0.28, size * 0.08)
    .fillColor(color)
    .fill();
}

/** Babu Mobile "B" mark (client/public/babu_mobile_icon.svg) drawn as vectors in theme colours. */
export function drawBabuLogo(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size: number,
) {
  doc.save();
  doc.translate(x, y).scale(size / 64);

  // Deep navy (not the light app gradient) so the mark prints near-black
  // on black & white printers instead of washed-out grey.
  const grad = doc.linearGradient(8, 4, 58, 60);
  grad.stop(0, COLORS.logoStart).stop(1, COLORS.logoEnd);
  doc.roundedRect(0, 0, 64, 64, 20).fill(grad);

  // "BM" in white strokes over a soft shadow, a yellow dot in the M and
  // signal waves (same mark as the app icon).
  const letters =
    "M13.5 20.5V47.5M13.5 20.5H21a6.5 6.5 0 0 1 0 13H13.5M13.5 33.5H22.5a7 7 0 0 1 0 14H13.5M35 47.5V20.5L43.5 35L52 20.5V47.5";
  doc.save();
  doc.translate(1.2, 1.6);
  doc
    .path(letters)
    .lineWidth(5.4)
    .lineCap("round")
    .lineJoin("round")
    .strokeOpacity(0.25)
    .stroke("#0F2A55");
  doc.restore();
  doc
    .path(letters)
    .lineWidth(5.4)
    .lineCap("round")
    .lineJoin("round")
    .strokeOpacity(1)
    .stroke(COLORS.white);
  doc.circle(43.5, 44.5, 2.4).fill("#FFD23F");

  doc
    .path("M50 8.5a7.5 7.5 0 0 1 6 6M50 4a12 12 0 0 1 10.5 10.5")
    .lineWidth(2.3)
    .lineCap("round")
    .strokeOpacity(0.9)
    .stroke(COLORS.white);

  doc.restore();
}

function drawHeader(doc: PDFKit.PDFDocument) {
  const logoW = 58;
  const logoH = 72;
  const logoY = 10;
  drawBabuLogo(doc, MARGIN, logoY + (logoH - logoW) / 2, logoW);

  const textX = MARGIN + logoW + 14;
  const textW = CONTENT_WIDTH - logoW - 14;

  // Wordmark: chubby display face in solid dark ink, a small NX tag on the
  // baseline and a fading gradient underline.
  // Shrinks to fit if the shop name is long.
  const title = shop.name.toUpperCase();
  const suffix = shop.nameSuffix.toUpperCase();
  const tracking = 0.5;
  const suffixGap = 5;
  let size = 30;
  let titleW = 0;
  let suffixW = 0;
  const suffixSize = () => Math.round(size * 0.4 * 10) / 10;
  for (; size >= 16; size -= 1) {
    doc.font(FONT.display).fontSize(size);
    titleW = doc.widthOfString(title, { characterSpacing: tracking });
    doc.font(FONT.bold).fontSize(suffixSize());
    suffixW = suffix ? doc.widthOfString(suffix, { characterSpacing: 0.6 }) : 0;
    if (titleW + (suffix ? suffixGap + suffixW : 0) <= textW) break;
  }
  const nameY = 12;
  const nameW = titleW + (suffix ? suffixGap + suffixW : 0);

  drawWordmarkText(doc, title, textX, nameY, size, tracking);
  doc.font(FONT.display).fontSize(size);
  const nameBaseline = nameY + ascenderOf(doc, size);
  if (suffix) {
    // Sits on the same baseline as the name, like a small tag after it.
    doc.font(FONT.bold).fontSize(suffixSize());
    doc
      .fillColor(COLORS.accent)
      .text(suffix, textX + titleW + suffixGap, nameBaseline - ascenderOf(doc, suffixSize()), {
        lineBreak: false,
        characterSpacing: 0.6,
      });
  }

  const underlineY = nameBaseline + size * 0.26;
  const underlineGrad = doc.linearGradient(textX, 0, textX + nameW, 0);
  underlineGrad
    .stop(0, COLORS.gradStart)
    .stop(0.55, COLORS.gradEnd)
    .stop(1, COLORS.gradEnd, 0);
  doc.roundedRect(textX, underlineY, nameW, 2.6, 1.3).fill(underlineGrad);

  doc
    .fillColor(COLORS.ink)
    .font(FONT.regular)
    .fontSize(8)
    .text(shop.address, textX, underlineY + 8, {
      width: textW,
      align: "left",
    });

  const afterAddress = doc.y + 4;
  // Phone + Instagram on one left-aligned contact row
  doc.font(FONT.bold).fontSize(8.5);
  const phoneText = `Ph: ${shop.phone}`;
  const instaText = shop.instagram || "";
  const phoneW = doc.widthOfString(phoneText);
  const iconSize = 8;
  const gap = 10;
  let cx = textX;

  doc
    .fillColor(COLORS.ink)
    .text(phoneText, cx, afterAddress, { lineBreak: false });
  cx += phoneW;

  if (instaText) {
    cx += gap;
    drawInstagramIcon(doc, cx, afterAddress + 0.5, iconSize, COLORS.ink);
    cx += iconSize + 4;
    doc
      .fillColor(COLORS.ink)
      .font(FONT.bold)
      .fontSize(8.5)
      .text(instaText, cx, afterAddress, { lineBreak: false });
  }

  // Keep space between logo bottom and the first horizontal rule
  let y = Math.max(logoY + logoH + 10, afterAddress + 16);

  doc
    .moveTo(MARGIN, y)
    .lineTo(PAGE.width - MARGIN, y)
    .strokeColor(COLORS.slate)
    .lineWidth(1.1)
    .stroke();

  y += 5;
  doc
    .fillColor(COLORS.accent)
    .font(FONT.medium)
    .fontSize(8)
    .text(shop.tagline, MARGIN, y, {
      width: CONTENT_WIDTH,
      align: "center",
      lineBreak: false,
    });
  y += 14;

  doc
    .moveTo(MARGIN, y)
    .lineTo(PAGE.width - MARGIN, y)
    .strokeColor(COLORS.slate)
    .lineWidth(1.1)
    .stroke();

  return y + 8;
}

function drawInvoiceBar(
  doc: PDFKit.PDFDocument,
  y: number,
  withGst: boolean,
) {
  const h = 22;
  doc.rect(MARGIN, y, CONTENT_WIDTH, h).fill(COLORS.accentSoft);
  strokeBox(doc, MARGIN, y, CONTENT_WIDTH, h);

  if (withGst) {
    doc
      .fillColor(COLORS.ink)
      .font(FONT.regular)
      .fontSize(8)
      .text(
        shop.gstin ? `GSTIN: ${shop.gstin}` : "GSTIN: —",
        MARGIN + 8,
        y + 7,
        { lineBreak: false },
      );
  }

  doc
    .fillColor(COLORS.accent)
    .font(FONT.bold)
    .fontSize(11)
    .text(withGst ? "TAX INVOICE" : "BILL", MARGIN, y + 5, {
      width: CONTENT_WIDTH,
      align: "center",
      lineBreak: false,
    });

  doc
    .fillColor(COLORS.ink)
    .font(FONT.regular)
    .fontSize(7)
    .text("ORIGINAL FOR RECIPIENT", MARGIN, y + 8, {
      width: CONTENT_WIDTH - 8,
      align: "right",
      lineBreak: false,
    });

  return y + h;
}

function drawCustomerMeta(
  doc: PDFKit.PDFDocument,
  bill: BillWithItems,
  y: number,
) {
  const h = 62;
  const leftW = CONTENT_WIDTH * 0.62;
  const rightW = CONTENT_WIDTH - leftW;
  strokeBox(doc, MARGIN, y, CONTENT_WIDTH, h);
  doc
    .moveTo(MARGIN + leftW, y)
    .lineTo(MARGIN + leftW, y + h)
    .strokeColor(COLORS.slate)
    .lineWidth(0.9)
    .stroke();

  const row = (
    label: string,
    value: string,
    x: number,
    ry: number,
    labelW = 62,
    valueW = leftW - 78,
  ) => {
    doc
      .fillColor(COLORS.ink)
      .font(FONT.bold)
      .fontSize(8)
      .text(label, x, ry, { width: labelW, lineBreak: false });
    doc
      .fillColor(COLORS.ink)
      .font(FONT.regular)
      .fontSize(8)
      .text(value || "—", x + labelW, ry, {
        width: valueW,
        lineBreak: false,
      });
  };

  row("Name", bill.customerName, MARGIN + 8, y + 10);
  row("Address", bill.customerAddress || "—", MARGIN + 8, y + 28);
  row("Phone", bill.customerPhone, MARGIN + 8, y + 46);

  const rx = MARGIN + leftW + 8;
  doc
    .fillColor(COLORS.ink)
    .font(FONT.bold)
    .fontSize(8)
    .text("Invoice No.", rx, y + 16, { lineBreak: false });
  doc.font(FONT.regular).text(bill.invoiceNumber, rx + 70, y + 16, {
    width: rightW - 84,
    lineBreak: false,
  });

  doc.font(FONT.bold).text("Invoice Date", rx, y + 38, {
    lineBreak: false,
  });
  doc
    .font(FONT.regular)
    .text(format(bill.billDate, "dd-MMM-yyyy"), rx + 70, y + 38, {
      width: rightW - 84,
      lineBreak: false,
    });

  return y + h;
}

function drawColumnLines(
  doc: PDFKit.PDFDocument,
  cols: readonly { w: number }[],
  y: number,
  h: number,
) {
  let x = MARGIN;
  for (let i = 0; i < cols.length - 1; i++) {
    x += cols[i].w;
    doc
      .moveTo(x, y)
      .lineTo(x, y + h)
      .strokeColor(COLORS.slate)
      .lineWidth(0.7)
      .stroke();
  }
}

function itemNameMeta(item: BillItem) {
  const specs = [item.color, item.storage, item.ram].filter(Boolean).join(" · ");
  const condition =
    item.condition === "USED" ? "Old" : item.condition === "NEW" ? "New" : "";
  return { specs, condition };
}

function drawItemNameCell(
  doc: PDFKit.PDFDocument,
  item: BillItem,
  x: number,
  y: number,
  width: number,
) {
  const { specs, condition } = itemNameMeta(item);
  let ty = y + 4;
  doc
    .fillColor(COLORS.ink)
    .font(FONT.bold)
    .fontSize(8)
    .text(item.productName, x + 3, ty, {
      width: width - 6,
      lineBreak: false,
    });
  ty += 11;
  if (specs || condition) {
    doc
      .fillColor(COLORS.muted)
      .font(FONT.regular)
      .fontSize(7)
      .text([specs, condition].filter(Boolean).join(" · "), x + 3, ty, {
        width: width - 6,
        lineBreak: false,
      });
    ty += 10;
  }
  if (item.imei1) {
    doc
      .fillColor(COLORS.muted)
      .font(FONT.medium)
      .fontSize(6.5)
      .text(`IMEI: ${item.imei1}`, x + 3, ty, {
        width: width - 6,
        lineBreak: false,
      });
    ty += 9;
  }
  if (item.serialNumber) {
    doc
      .fillColor(COLORS.muted)
      .font(FONT.medium)
      .fontSize(6.5)
      .text(`S/N: ${item.serialNumber}`, x + 3, ty, {
        width: width - 6,
        lineBreak: false,
      });
    ty += 9;
  }
  const included = includedAccessoriesLabel(item.includedAccessories);
  if (included) {
    doc
      .fillColor(COLORS.ink)
      .font(FONT.medium)
      .fontSize(6.5)
      .text(`Included: ${included}`, x + 3, ty, {
        width: width - 6,
        lineBreak: false,
      });
  }
}

function drawItemsTable(
  doc: PDFKit.PDFDocument,
  bill: BillWithItems,
  y: number,
  withGst: boolean,
) {
  const cols = withGst
    ? ([
        { key: "sr", label: "Sr.", w: 28 },
        { key: "name", label: "Name of Product / Service", w: 190 },
        { key: "qty", label: "Qty", w: 32 },
        { key: "rate", label: "Rate", w: 64 },
        { key: "taxable", label: "Taxable Value", w: 78 },
        { key: "gstp", label: "GST %", w: 40 },
        { key: "gsta", label: "GST Amt", w: 52 },
        { key: "total", label: "Total", w: 55 },
      ] as const)
    : ([
        { key: "sr", label: "Sr.", w: 28 },
        { key: "name", label: "Name of Product / Service", w: 280 },
        { key: "qty", label: "Qty", w: 40 },
        { key: "rate", label: "Rate", w: 90 },
        { key: "total", label: "Amount", w: 101 },
      ] as const);

  // Reserve room below the table for totals + declaration + terms footer
  const footH = 18;
  const exchangeBoxH = exchangeBoxHeight(bill, withGst);
  const upperBoxH = withGst ? 58 : 50;
  const payCustomerAmountValue = computePayCustomerAmount(bill, withGst);
  const hasDiscount = !withGst && Number(bill.companyDiscount || 0) > 0;
  // Non-GST: optional discount / pay-customer rows + Total Payable bar
  const paymentBoxH = withGst
    ? 0
    : PLAIN_TOTAL_BAR_H +
      (hasDiscount ? PLAIN_ROW_H : 0) +
      (payCustomerAmountValue > 0 ? PLAIN_ROW_H : 0);
  const totalBarH = withGst ? 26 : 0;
  const declH = 48;
  const totalsBlockH =
    4 +
    exchangeBoxH +
    (exchangeBoxH ? 6 : 0) +
    upperBoxH +
    paymentBoxH +
    totalBarH +
    8 +
    declH;
  // Notes print between the totals and the terms footer — leave room for them.
  const notesH = bill.notes
    ? doc
        .font(FONT.regular)
        .fontSize(7.5)
        .heightOfString(`Notes: ${bill.notes}`, { width: CONTENT_WIDTH - 40 }) + 8
    : 0;
  const tableBodyBottom =
    PAGE.height - MARGIN - FOOTER_BLOCK_H - 8 - totalsBlockH - footH - notesH;

  const headerH = 20;
  let x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_WIDTH, headerH).fill(COLORS.accentSoft);
  strokeBox(doc, MARGIN, y, CONTENT_WIDTH, headerH);

  for (const col of cols) {
    doc
      .fillColor(COLORS.ink)
      .font(FONT.bold)
      .fontSize(7)
      .text(col.label, x + 2, y + 6, {
        width: col.w - 4,
        align: "center",
        lineBreak: false,
      });
    x += col.w;
  }

  drawColumnLines(doc, cols, y, headerH);
  y += headerH;

  let taxableSum = 0;
  let gstSum = 0;
  let qtySum = 0;
  let totalSum = 0;

  bill.items.forEach((item, index) => {
    const amount = item.amount || round2(item.rate * item.quantity);
    const taxable = lineTaxable(item);
    const gst = lineGst(item);
    taxableSum += taxable;
    gstSum += gst;
    qtySum += item.quantity;
    totalSum += amount;

    const { specs, condition } = itemNameMeta(item);
    const nameLines = [item.productName];
    if (specs) nameLines.push(specs);
    if (condition) nameLines.push(condition);
    if (item.imei1) nameLines.push(`IMEI: ${item.imei1}`);
    if (item.serialNumber) nameLines.push(`S/N: ${item.serialNumber}`);
    if (includedAccessoriesLabel(item.includedAccessories)) {
      nameLines.push("Included");
    }
    const rowH = Math.max(28, nameLines.length * 10 + 4);

    strokeBox(doc, MARGIN, y, CONTENT_WIDTH, rowH);
    drawColumnLines(doc, cols, y, rowH);

    x = MARGIN;
    for (const col of cols) {
      if (col.key === "name") {
        drawItemNameCell(doc, item, x, y, col.w);
      } else {
        let value = "";
        if (col.key === "sr") value = String(index + 1);
        else if (col.key === "qty") value = String(item.quantity);
        else if (col.key === "rate") value = money(item.rate);
        else if (col.key === "taxable") value = money(taxable);
        else if (col.key === "gstp")
          value = item.gstPercent ? `${item.gstPercent}%` : "—";
        else if (col.key === "gsta") value = money(gst);
        else if (col.key === "total") value = money(amount);

        const centerKeys = new Set(["sr", "qty", "rate", "total"]);
        doc
          .fillColor(COLORS.ink)
          .font(FONT.regular)
          .fontSize(7.5)
          .text(value, x + 2, y + rowH / 2 - 4, {
            width: col.w - 4,
            align: centerKeys.has(col.key) ? "center" : "right",
            lineBreak: false,
          });
      }
      x += col.w;
    }

    y += rowH;
  });

  // Blank filler so the item grid stretches down the page
  if (y < tableBodyBottom) {
    const fillerH = tableBodyBottom - y;
    strokeBox(doc, MARGIN, y, CONTENT_WIDTH, fillerH);
    drawColumnLines(doc, cols, y, fillerH);
    y = tableBodyBottom;
  }

  doc.rect(MARGIN, y, CONTENT_WIDTH, footH).fill(COLORS.accentSoft);
  strokeBox(doc, MARGIN, y, CONTENT_WIDTH, footH);
  doc
    .fillColor(COLORS.ink)
    .font(FONT.bold)
    .fontSize(8)
    .text("Total", MARGIN + 28, y + 5, { width: 160, lineBreak: false });

  if (withGst) {
    const qtyX = MARGIN + 28 + 190;
    const taxableX = qtyX + 32 + 64;
    const gstAmtX = taxableX + 78 + 40;
    doc
      .text(String(qtySum), qtyX, y + 5, {
        width: 32,
        align: "center",
        lineBreak: false,
      })
      .text(money(taxableSum), taxableX, y + 5, {
        width: 78,
        align: "right",
        lineBreak: false,
      })
      .text(money(gstSum), gstAmtX, y + 5, {
        width: 52,
        align: "right",
        lineBreak: false,
      })
      .text(money(totalSum), MARGIN + CONTENT_WIDTH - 55, y + 5, {
        width: 55,
        align: "center",
        lineBreak: false,
      });
  } else {
    const qtyX = MARGIN + 28 + 280;
    doc
      .text(String(qtySum), qtyX, y + 5, {
        width: 40,
        align: "center",
        lineBreak: false,
      })
      .text(money(totalSum), MARGIN + CONTENT_WIDTH - 101, y + 5, {
        width: 101,
        align: "center",
        lineBreak: false,
      });
  }

  return {
    y: y + footH,
    taxableSum,
    gstSum,
    totalSum,
  };
}

function drawExchangeBox(
  doc: PDFKit.PDFDocument,
  bill: BillWithItems,
  y: number,
) {
  if (!bill.isExchange || !bill.exchangeValue) return y;

  const items = exchangeItemsForPdf(bill);
  const rows =
    items.length > 0
      ? items
      : [
          {
            model: bill.exchangeModel || "Old phone",
            platform:
              bill.exchangePlatform === "ANDROID"
                ? ("ANDROID" as const)
                : ("IOS" as const),
            color: bill.exchangeColor || "",
            storage: bill.exchangeStorage || "",
            ram: bill.exchangeRam,
            imei1: bill.exchangeImei1 || "",
            value: Number(bill.exchangeValue) || 0,
            notes: bill.exchangeNotes,
          },
        ];

  const headerH = 18;
  const rowH = 14;
  const cashReturn = exchangeCashReturnAmount(bill);
  const credit = exchangeCreditAmount(bill);
  const h = headerH + rows.length * rowH + 10 + (cashReturn > 0 ? 14 : 0);

  strokeBox(doc, MARGIN, y, CONTENT_WIDTH, h);
  doc.rect(MARGIN, y, CONTENT_WIDTH, headerH).fill(COLORS.accentSoft);
  strokeBox(doc, MARGIN, y, CONTENT_WIDTH, headerH);
  doc
    .fillColor(COLORS.ink)
    .font(FONT.bold)
    .fontSize(8)
    .text(
      rows.length > 1 ? "Exchange details (old phones)" : "Exchange details",
      MARGIN + 8,
      y + 5,
      { lineBreak: false },
    );
  doc
    .font(FONT.bold)
    .text(`− ${money(credit)}`, MARGIN + 8, y + 5, {
      width: CONTENT_WIDTH - 16,
      align: "right",
      lineBreak: false,
    });

  rows.forEach((item, index) => {
    const rowY = y + headerH + 6 + index * rowH;
    doc
      .fillColor(COLORS.ink)
      .font(FONT.regular)
      .fontSize(7.5)
      .text(exchangeLineText(item, index), MARGIN + 8, rowY, {
        width: CONTENT_WIDTH - 96,
        lineBreak: false,
        ellipsis: true,
      });
    doc
      .font(FONT.bold)
      .text(`− ${money(Number(item.value) || 0)}`, MARGIN + 8, rowY, {
        width: CONTENT_WIDTH - 16,
        align: "right",
        lineBreak: false,
      });
  });

  if (cashReturn > 0) {
    const noteY = y + headerH + 6 + rows.length * rowH;
    doc
      .fillColor(COLORS.muted)
      .font(FONT.regular)
      .fontSize(7)
      .text(
        `Fixed return to customer ${money(cashReturn)} · Bill credit ${money(credit)}`,
        MARGIN + 8,
        noteY,
        { width: CONTENT_WIDTH - 16, lineBreak: false },
      );
  }

  return y + h + 6;
}

const PLAIN_ROW_H = 22;
const PLAIN_TOTAL_BAR_H = 26;

/** Text-box top that puts the current font's capital letters in the middle of a band. */
function middleTextY(
  doc: PDFKit.PDFDocument,
  fontSize: number,
  top: number,
  height: number,
) {
  const font = (doc as unknown as { _font: { capHeight?: number } })._font;
  const capHeight = ((font.capHeight || 700) / 1000) * fontSize;
  return top + height / 2 + capHeight / 2 - ascenderOf(doc, fontSize);
}

function drawPlainTotalsSection(
  doc: PDFKit.PDFDocument,
  bill: BillWithItems,
  y: number,
) {
  const payable = bill.payableAmount ?? bill.grandTotal;
  const discountAmount = Number(bill.companyDiscount || 0);
  const payCustomerAmount = computePayCustomerAmount(bill, false);
  const wordsH = 50;

  strokeBox(doc, MARGIN, y, CONTENT_WIDTH, wordsH);
  doc
    .fillColor(COLORS.ink)
    .font(FONT.bold)
    .fontSize(7)
    .text("Total Amount in Words", MARGIN + 8, y + 8, {
      width: CONTENT_WIDTH - 16,
      align: "center",
      lineBreak: false,
    });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .text(amountInWords(payable), MARGIN + 8, y + 22, {
      width: CONTENT_WIDTH - 16,
      align: "center",
    });

  y += wordsH;

  // Same shape as the GST bill: plain rows, then one full-width total bar.
  // Payment split (cash / online / finance …) is deliberately not printed.
  const plainRow = (label: string, value: string) => {
    strokeBox(doc, MARGIN, y, CONTENT_WIDTH, PLAIN_ROW_H);
    doc
      .fillColor(COLORS.ink)
      .font(FONT.regular)
      .fontSize(8)
      .text(label, MARGIN + 10, middleTextY(doc, 8, y, PLAIN_ROW_H), {
        lineBreak: false,
      });
    doc.font(FONT.bold).text(value, MARGIN + 10, middleTextY(doc, 8, y, PLAIN_ROW_H), {
      width: CONTENT_WIDTH - 20,
      align: "right",
      lineBreak: false,
    });
    y += PLAIN_ROW_H;
  };

  if (discountAmount > 0) plainRow("Discount amount", inr(discountAmount));

  doc.rect(MARGIN, y, CONTENT_WIDTH, PLAIN_TOTAL_BAR_H).fill(COLORS.accentSoft);
  strokeBox(doc, MARGIN, y, CONTENT_WIDTH, PLAIN_TOTAL_BAR_H);
  doc
    .fillColor(COLORS.accent)
    .font(FONT.bold)
    .fontSize(10)
    .text("Total Payable", MARGIN + 10, middleTextY(doc, 10, y, PLAIN_TOTAL_BAR_H), {
      lineBreak: false,
    });
  doc.text(inr(payable), MARGIN + 10, middleTextY(doc, 10, y, PLAIN_TOTAL_BAR_H), {
    width: CONTENT_WIDTH - 20,
    align: "right",
    lineBreak: false,
  });
  y += PLAIN_TOTAL_BAR_H;

  if (payCustomerAmount > 0) {
    plainRow("Payable to customer", inr(payCustomerAmount));
  }

  const declY = y + 8;
  const declH = 48;
  strokeBox(doc, MARGIN, declY, CONTENT_WIDTH, declH);
  doc
    .fillColor(COLORS.ink)
    .font(FONT.regular)
    .fontSize(7)
    .text(
      `Certified that the particulars given above are true and correct. For ${shop.name}`,
      MARGIN + 8,
      declY + 8,
      { width: CONTENT_WIDTH * 0.62 },
    );
  doc
    .font(FONT.bold)
    .fontSize(8)
    .text("Authorised Signatory", MARGIN + 8, declY + declH - 16, {
      width: CONTENT_WIDTH - 16,
      align: "right",
      lineBreak: false,
    });

  return declY + declH;
}

function drawTotalsSection(
  doc: PDFKit.PDFDocument,
  bill: BillWithItems,
  y: number,
  totals: { taxableSum: number; gstSum: number; totalSum: number },
) {
  // GST invoice shows full item total — do not deduct exchange
  const invoiceTotal = totals.totalSum || bill.grandTotal;
  const leftW = Math.round(CONTENT_WIDTH * 0.55);
  const rightW = CONTENT_WIDTH - leftW;
  const upperBoxH = 58;
  const totalBarH = 26;
  const rx = MARGIN + leftW;

  // Upper band: amount in words (left) + tax breakdown (right)
  strokeBox(doc, MARGIN, y, leftW, upperBoxH);
  strokeBox(doc, rx, y, rightW, upperBoxH);
  doc
    .moveTo(rx, y)
    .lineTo(rx, y + upperBoxH)
    .strokeColor(COLORS.slate)
    .lineWidth(0.9)
    .stroke();

  doc
    .fillColor(COLORS.ink)
    .font(FONT.bold)
    .fontSize(7)
    .text("Total Invoice Amount in Words", MARGIN + 8, y + 10, {
      width: leftW - 16,
      align: "center",
      lineBreak: false,
    });
  doc
    .font(FONT.regular)
    .fontSize(7.5)
    .text(amountInWords(invoiceTotal), MARGIN + 8, y + 24, {
      width: leftW - 16,
      align: "center",
    });

  const rows: Array<[string, string]> = [
    ["Taxable Amount", money(totals.taxableSum || bill.subtotal)],
    ["Total Tax", money(totals.gstSum || bill.gstAmount)],
  ];

  let ry = y + 10;
  for (const [label, value] of rows) {
    doc
      .fillColor(COLORS.ink)
      .font(FONT.regular)
      .fontSize(8)
      .text(label, rx + 8, ry, { width: rightW * 0.55, lineBreak: false });
    doc.text(value, rx + 8, ry, {
      width: rightW - 16,
      align: "right",
      lineBreak: false,
    });
    ry += 12;
  }

  // Full-width total after tax
  const barY = y + upperBoxH;
  doc.rect(MARGIN, barY, CONTENT_WIDTH, totalBarH).fill(COLORS.accentSoft);
  strokeBox(doc, MARGIN, barY, CONTENT_WIDTH, totalBarH);
  doc
    .fillColor(COLORS.accent)
    .font(FONT.bold)
    .fontSize(10)
    .text("Total Amount After Tax", MARGIN + 10, barY + 8, {
      lineBreak: false,
    });
  doc.text(inr(invoiceTotal), MARGIN + 10, barY + 8, {
    width: CONTENT_WIDTH - 20,
    align: "right",
    lineBreak: false,
  });

  // Declaration / signatory
  const declY = barY + totalBarH + 8;
  const declH = 48;
  strokeBox(doc, MARGIN, declY, CONTENT_WIDTH, declH);
  doc
    .fillColor(COLORS.ink)
    .font(FONT.regular)
    .fontSize(7)
    .text(
      `Certified that the particulars given above are true and correct. For ${shop.name}`,
      MARGIN + 8,
      declY + 8,
      { width: CONTENT_WIDTH * 0.62 },
    );
  doc
    .font(FONT.bold)
    .fontSize(8)
    .text("Authorised Signatory", MARGIN + 8, declY + declH - 16, {
      width: CONTENT_WIDTH - 16,
      align: "right",
      lineBreak: false,
    });

  return declY + declH;
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const y = PAGE.height - MARGIN - FOOTER_BLOCK_H + 4;

  doc
    .moveTo(MARGIN, y - 6)
    .lineTo(PAGE.width - MARGIN, y - 6)
    .strokeColor(COLORS.slate)
    .lineWidth(0.8)
    .stroke();

  // Same wording as the shop’s printed bill book.
  doc
    .fillColor(COLORS.ink)
    .font(FONT.hindiBold)
    .fontSize(8.5)
    .text("नियम एवं शर्तें", MARGIN, y - 1, { lineBreak: false });

  const terms = [
    "1. बिका हुआ माल वापस नहीं होगा और न बदला जायेगा।",
    "2. वारंटी या गारंटी केवल कंपनी के सर्विस सेंटर द्वारा कंपनी के शर्तों एवं नियमों अनुसार ही होगा।",
    "3. सर्विस सेंटर में लगने वाला समय ग्राहक को देना होगा।",
    "4. किसी भी वाद-विवाद बालाघाट न्यायालय के अंतर्गत होगा।",
    "5. मैंने यह सामान अपनी पसंद से अच्छी तरह से देख कर एवं चेक कर लिया है।",
  ];
  let ty = y + 12;
  doc.fillColor(COLORS.muted).font(FONT.hindi).fontSize(7);
  for (const term of terms) {
    doc.text(term, MARGIN, ty, {
      width: CONTENT_WIDTH,
      lineBreak: false,
    });
    ty += 10;
  }

  ty += 2;
  doc
    .fillColor(COLORS.ink)
    .font(FONT.bold)
    .fontSize(6.8)
    .text("No guarantee / No warranty: ", MARGIN, ty, {
      continued: true,
      lineBreak: false,
    })
    .fillColor(COLORS.muted)
    .font(FONT.regular)
    .text(
      "UV Glass / Display · Water / Liquid Damage · Battery Health · Update Line / Display Green · Physical Damage",
      { lineBreak: false },
    );

  doc
    .fillColor(COLORS.accent)
    .font(FONT.regular)
    .fontSize(11)
    .text(`Thank you for shopping with ${[shop.name, shop.nameSuffix].filter(Boolean).join(" ")}`, MARGIN, PAGE.height - 20, {
      width: CONTENT_WIDTH,
      align: "center",
      lineBreak: false,
    });
}

export function buildInvoicePdf(bill: BillWithItems): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const withGst = Boolean(bill.withGst);
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      autoFirstPage: true,
      info: {
        Title: `${withGst ? "Tax Invoice" : "Bill"} ${bill.invoiceNumber}`,
        Author: shop.name,
        Subject: withGst ? "Tax Invoice" : "Bill",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    let y = drawHeader(doc);
    y = drawInvoiceBar(doc, y, withGst);
    y = drawCustomerMeta(doc, bill, y);

    const table = drawItemsTable(doc, bill, y, withGst);
    if (withGst) {
      y = drawTotalsSection(doc, bill, table.y + 4, table);
    } else {
      y = drawExchangeBox(doc, bill, table.y + 4);
      y = drawPlainTotalsSection(doc, bill, y);
    }

    if (bill.notes) {
      doc
        .fillColor(COLORS.ink)
        .font(FONT.bold)
        .fontSize(7.5)
        .text("Notes: ", MARGIN, y + 6, { continued: true, lineBreak: false });
      doc
        .font(FONT.regular)
        .fillColor(COLORS.muted)
        .text(bill.notes, { width: CONTENT_WIDTH - 40 });
    }

    // Terms stay pinned to the bottom of the page
    drawFooter(doc);
    doc.end();
  });
}
