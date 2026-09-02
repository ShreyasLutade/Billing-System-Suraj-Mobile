import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import type { Bill, BillItem } from "@prisma/client";
import { format } from "date-fns";
import {
  exchangeItemsFromInput,
  parseExchangeItemsJson,
  type BillExchangeItem,
} from "../lib/exchangeItems";

type BillWithItems = Bill & { items: BillItem[] };

/** Logo palette: charcoal + gold (exact Suraj Mobile wordmark colors) */
const COLORS = {
  charcoal: "#494D53",
  gold: "#C49333",
  goldSoft: "#F5EDD8",
  ink: "#1A1A1A",
  muted: "#555555",
  white: "#FFFFFF",
};

const shop = {
  name: process.env.SHOP_NAME || "Suraj Mobile",
  tagline:
    process.env.SHOP_TAGLINE || "Deals In - All New & Second Hand Phones",
  address:
    process.env.SHOP_ADDRESS ||
    "Near Jain Mandir, Beside Arihant Institute Main Road Balaghat (M.P) 481001",
  phone: process.env.SHOP_PHONE || "9516533556",
  instagram: process.env.SHOP_INSTAGRAM || "@surajmobileofficial",
  gstin: process.env.SHOP_GSTIN || "23FAAPB2709A1ZP",
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 28;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const LOGO_PATH = path.join(__dirname, "../../assets/suraj_mobile_logo.png");
const ICON_PATH = path.join(__dirname, "../../assets/suraj_mobile_icon.png");
const FONTS_DIR = path.join(__dirname, "../../assets/fonts");
const FONT = {
  regular: "Manrope",
  medium: "Manrope-Medium",
  semibold: "Manrope-SemiBold",
  bold: "Manrope-Bold",
} as const;
const FOOTER_BLOCK_H = 78;

function registerFonts(doc: PDFKit.PDFDocument) {
  doc.registerFont(FONT.regular, path.join(FONTS_DIR, "Manrope-Regular.ttf"));
  doc.registerFont(FONT.medium, path.join(FONTS_DIR, "Manrope-Medium.ttf"));
  doc.registerFont(FONT.semibold, path.join(FONTS_DIR, "Manrope-SemiBold.ttf"));
  doc.registerFont(FONT.bold, path.join(FONTS_DIR, "Manrope-Bold.ttf"));
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

function money(amount: number) {
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
  doc.rect(x, y, w, h).strokeColor(COLORS.charcoal).lineWidth(0.9).stroke();
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

function drawHeader(doc: PDFKit.PDFDocument) {
  const logoFile = fs.existsSync(LOGO_PATH)
    ? LOGO_PATH
    : fs.existsSync(ICON_PATH)
      ? ICON_PATH
      : null;

  const logoW = 58;
  const logoH = 72;
  const logoY = 10;
  if (logoFile) {
    doc.image(logoFile, MARGIN, logoY, {
      fit: [logoW, logoH],
      align: "center",
      valign: "center",
    });
  }

  const textX = MARGIN + logoW + 14;
  const textW = CONTENT_WIDTH - logoW - 14;

  // Distinct display font — match logo: SURAJ charcoal, MOBILE gold
  const title = shop.name.toUpperCase();
  const parts = title.split(/\s+/);
  const first = parts[0] || title;
  const rest = parts.slice(1).join(" ");
  doc.font(FONT.bold).fontSize(24);
  const firstW = doc.widthOfString(first + (rest ? " " : ""));
  doc
    .fillColor(COLORS.charcoal)
    .text(first + (rest ? " " : ""), textX, 16, {
      lineBreak: false,
    });
  if (rest) {
    doc
      .fillColor(COLORS.gold)
      .text(rest, textX + firstW, 16, {
        lineBreak: false,
      });
  }

  doc
    .fillColor(COLORS.ink)
    .font(FONT.regular)
    .fontSize(8)
    .text(shop.address, textX, 44, {
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
    .strokeColor(COLORS.charcoal)
    .lineWidth(1.1)
    .stroke();

  y += 5;
  doc
    .fillColor(COLORS.gold)
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
    .strokeColor(COLORS.charcoal)
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
  doc.rect(MARGIN, y, CONTENT_WIDTH, h).fill(COLORS.goldSoft);
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
    .fillColor(COLORS.gold)
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
    .strokeColor(COLORS.charcoal)
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
      .strokeColor(COLORS.charcoal)
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
  // Non-GST: payment modes + total payable side-by-side in one band
  const paymentBoxH = withGst
    ? 0
    : payCustomerAmountValue > 0 && hasDiscount
      ? 126
      : payCustomerAmountValue > 0 || hasDiscount
        ? 102
        : 78;
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
  const tableBodyBottom =
    PAGE.height - MARGIN - FOOTER_BLOCK_H - 8 - totalsBlockH - footH;

  const headerH = 20;
  let x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_WIDTH, headerH).fill(COLORS.goldSoft);
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

  doc.rect(MARGIN, y, CONTENT_WIDTH, footH).fill(COLORS.goldSoft);
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
  doc.rect(MARGIN, y, CONTENT_WIDTH, headerH).fill(COLORS.goldSoft);
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
        `Fixed return to client ${money(cashReturn)} · Bill credit ${money(credit)}`,
        MARGIN + 8,
        noteY,
        { width: CONTENT_WIDTH - 16, lineBreak: false },
      );
  }

  return y + h + 6;
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
  const bandH =
    payCustomerAmount > 0 && discountAmount > 0
      ? 126
      : payCustomerAmount > 0 || discountAmount > 0
        ? 102
        : 78;
  const payW = Math.round(CONTENT_WIDTH * 0.68);
  const totalW = CONTENT_WIDTH - payW;

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

  // Left: selected payment modes only · Right: total payable
  strokeBox(doc, MARGIN, y, payW, bandH);
  strokeBox(doc, MARGIN + payW, y, totalW, bandH);
  doc
    .moveTo(MARGIN + payW, y)
    .lineTo(MARGIN + payW, y + bandH)
    .strokeColor(COLORS.charcoal)
    .lineWidth(0.9)
    .stroke();

  doc.rect(MARGIN, y, payW, 18).fill(COLORS.goldSoft);
  strokeBox(doc, MARGIN, y, payW, 18);
  doc
    .fillColor(COLORS.ink)
    .font(FONT.bold)
    .fontSize(8)
    .text("Payment details", MARGIN + 8, y + 5, { lineBreak: false });

  const financeAmount2 = bill.financeAmount2 || 0;
  const finance1 =
    financeAmount2 > 0
      ? Math.max(bill.financeAmount - financeAmount2, 0)
      : bill.financeAmount;

  const rows: Array<[string, string]> = [];
  if (bill.cashAmount > 0) rows.push(["Cash", money(bill.cashAmount)]);
  if (bill.onlineAmount > 0) rows.push(["Online", money(bill.onlineAmount)]);
  if (bill.cardAmount > 0) rows.push(["Card", money(bill.cardAmount)]);
  if (finance1 > 0) {
    rows.push([
      bill.financeCompanyName
        ? `Finance (${bill.financeCompanyName})`
        : "Finance",
      money(finance1),
    ]);
  }
  if (financeAmount2 > 0) {
    rows.push([
      bill.financeCompanyName2
        ? `Finance (${bill.financeCompanyName2})`
        : "Finance 2",
      money(financeAmount2),
    ]);
  }
  if (bill.dueAmount > 0) {
    rows.push([
      bill.dueDate
        ? `Due (by ${format(bill.dueDate, "dd MMM yyyy")})`
        : "Due",
      money(bill.dueAmount),
    ]);
  }

  if (!rows.length) {
    doc
      .fillColor(COLORS.muted)
      .font(FONT.regular)
      .fontSize(8)
      .text("No payment modes selected", MARGIN + 8, y + 40, {
        width: payW - 16,
        align: "center",
      });
  } else {
    const colW = payW / rows.length;
    rows.forEach((row, i) => {
      const cx = MARGIN + i * colW;
      doc
        .fillColor(COLORS.muted)
        .font(FONT.regular)
        .fontSize(7)
        .text(row[0], cx + 4, y + 28, {
          width: colW - 8,
          align: "center",
        });
      doc
        .fillColor(COLORS.ink)
        .font(FONT.bold)
        .fontSize(9)
        .text(row[1], cx + 4, y + 48, {
          width: colW - 8,
          align: "center",
          lineBreak: false,
        });
    });
  }

  const totalX = MARGIN + payW;
  doc.rect(totalX, y, totalW, bandH).fill(COLORS.goldSoft);
  strokeBox(doc, totalX, y, totalW, bandH);

  let ty = y + (payCustomerAmount > 0 || discountAmount > 0 ? 10 : 22);
  if (discountAmount > 0) {
    doc
      .fillColor(COLORS.ink)
      .font(FONT.bold)
      .fontSize(7)
      .text("Discount amount", totalX + 8, ty, {
        width: totalW - 16,
        align: "center",
        lineBreak: false,
      });
    doc
      .fontSize(10)
      .text(inr(discountAmount), totalX + 8, ty + 14, {
        width: totalW - 16,
        align: "center",
        lineBreak: false,
      });
    ty += 36;
  }

  if (payCustomerAmount > 0) {
    doc
      .fillColor(COLORS.gold)
      .font(FONT.bold)
      .fontSize(7)
      .text("Total Payable", totalX + 8, ty, {
        width: totalW - 16,
        align: "center",
        lineBreak: false,
      });
    doc
      .fontSize(11)
      .text(inr(payable), totalX + 8, ty + 14, {
        width: totalW - 16,
        align: "center",
        lineBreak: false,
      });
    doc
      .fillColor(COLORS.ink)
      .font(FONT.bold)
      .fontSize(7)
      .text("Payable to customer", totalX + 8, ty + 36, {
        width: totalW - 16,
        align: "center",
        lineBreak: false,
      });
    doc
      .fontSize(11)
      .text(inr(payCustomerAmount), totalX + 8, ty + 50, {
        width: totalW - 16,
        align: "center",
        lineBreak: false,
      });
  } else {
    doc
      .fillColor(COLORS.gold)
      .font(FONT.bold)
      .fontSize(8)
      .text("Total Payable", totalX + 8, ty, {
        width: totalW - 16,
        align: "center",
        lineBreak: false,
      });
    doc
      .fontSize(11)
      .text(inr(payable), totalX + 8, ty + 16, {
        width: totalW - 16,
        align: "center",
        lineBreak: false,
      });
  }

  const declY = y + bandH + 8;
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
    .strokeColor(COLORS.charcoal)
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
  doc.rect(MARGIN, barY, CONTENT_WIDTH, totalBarH).fill(COLORS.goldSoft);
  strokeBox(doc, MARGIN, barY, CONTENT_WIDTH, totalBarH);
  doc
    .fillColor(COLORS.gold)
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
    .strokeColor(COLORS.charcoal)
    .lineWidth(0.8)
    .stroke();

  doc
    .fillColor(COLORS.ink)
    .font(FONT.bold)
    .fontSize(8)
    .text("Terms and Conditions", MARGIN, y, { lineBreak: false });

  const terms = [
    "1. Goods once sold will not be taken back, exchanged or refunded.",
    "2. Warranty & insurance terms are as provided by the company / service centre.",
    "3. Customer has inspected the device at purchase; shop is not responsible thereafter.",
    "4. Subject to Balaghat jurisdiction.",
  ];
  let ty = y + 12;
  doc.fillColor(COLORS.muted).font(FONT.regular).fontSize(6.5);
  for (const term of terms) {
    doc.text(term, MARGIN, ty, {
      width: CONTENT_WIDTH,
      lineBreak: false,
    });
    ty += 9;
  }

  doc
    .fillColor(COLORS.gold)
    .font(FONT.regular)
    .fontSize(11)
    .text(`Thank you for shopping with ${shop.name}`, MARGIN, PAGE.height - 20, {
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
