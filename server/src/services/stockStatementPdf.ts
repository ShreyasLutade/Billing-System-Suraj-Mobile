import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { differenceInCalendarDays, format } from "date-fns";
import { prisma } from "../lib/prisma";
import {
  COLORS,
  FONT,
  ascenderOf,
  drawBabuLogo,
  drawWordmarkText,
  money,
  registerFonts,
  shop,
} from "./pdf";
import { intakeKindFromNote } from "./stockSync";

/**
 * Mobiles in the shop right now (new, old or both) as an A4 landscape PDF,
 * A→Z by model: storage, RAM, IMEI, supplier, whether it came in on an
 * exchange, and how long it has been in stock. Cost is shown to admins only.
 */

export type StockStatementScope = "NEW" | "USED" | "ALL";

const PAGE = { width: 841.89, height: 595.28 };
const M = 28;
const W = PAGE.width - M * 2;
const FOOTER_H = 30;
const PAD = 5;
const ROW_H = 30;
const GREEN = "#0B7A5B";
const AMBER = "#B45309";
const BLUE = "#1D4ED8";

type Align = "left" | "right" | "center";
type Col = { key: string; label: string; width: number; align: Align };

type Row = {
  name: string;
  specs: string;
  storage: string;
  ram: string;
  imei: string;
  serial: string;
  condition: "NEW" | "USED";
  exchange: boolean;
  supplier: string;
  since: Date;
  days: number;
  cost: number;
};

function day(date: Date) {
  return format(date, "dd MMM yyyy");
}

function rupees(amount: number) {
  return `Rs. ${money(amount)}`;
}

function scopeTitle(scope: StockStatementScope) {
  return scope === "NEW" ? "NEW MOBILES" : scope === "USED" ? "OLD MOBILES" : "ALL STOCK";
}

function legacySupplierName(raw: string) {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : "";
  } catch {
    return "";
  }
}

function columns(scope: StockStatementScope, showCost: boolean): Col[] {
  const cols: Col[] = [
    { key: "n", label: "#", width: 24, align: "right" },
    { key: "mobile", label: "Mobile", width: 140, align: "left" },
    { key: "storage", label: "Storage", width: 54, align: "left" },
    { key: "ram", label: "RAM", width: 44, align: "left" },
    { key: "ids", label: "IMEI / Serial", width: 112, align: "left" },
  ];
  if (scope === "ALL") cols.push({ key: "type", label: "Type", width: 42, align: "left" });
  cols.push(
    { key: "exchange", label: "Exchange", width: 54, align: "left" },
    { key: "supplier", label: "Supplier / from", width: 118, align: "left" },
    { key: "since", label: "In stock since", width: 82, align: "left" },
  );
  if (showCost) cols.push({ key: "cost", label: "Cost", width: 66, align: "right" });
  // Share any spare width across all columns (not just Mobile) so there are
  // no wide empty gaps between the model name and the rest.
  const used = cols.reduce((sum, col) => sum + col.width, 0);
  const growable = cols.filter((col) => col.key !== "n");
  const growBase = growable.reduce((sum, col) => sum + col.width, 0);
  for (const col of growable) col.width += ((W - used) * col.width) / growBase;
  return cols;
}

export async function buildStockStatementPdf(
  scope: StockStatementScope,
  options: { showCost: boolean },
) {
  const items = await prisma.stockItem.findMany({
    where: {
      status: "AVAILABLE",
      NOT: { kind: "ACCESSORY" },
      productReturn: null,
      ...(scope === "ALL" ? {} : { condition: scope }),
    },
    include: {
      supplier: { select: { name: true, isExchange: true } },
      purchaseItem: {
        select: {
          purchase: {
            select: { note: true, purchaseDate: true, supplier: { select: { name: true } } },
          },
        },
      },
    },
  });

  const today = new Date();
  const rows: Row[] = items.map((item) => {
    const purchase = item.purchaseItem?.purchase;
    const since = purchase?.purchaseDate ?? item.createdAt;
    return {
      name: item.mobileName,
      specs: [
        item.color,
        item.platform === "IOS" ? "iOS" : item.platform === "ANDROID" ? "Android" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      storage: item.storage || "",
      ram: item.platform === "ANDROID" ? item.ram || "" : "",
      imei: item.imei ? item.imei.split("~")[0] : "",
      serial: item.serialNumber ? item.serialNumber.split("~")[0] : "",
      condition: item.condition === "USED" ? "USED" : "NEW",
      exchange:
        intakeKindFromNote(purchase?.note) === "exchange" ||
        Boolean(item.supplier?.isExchange),
      supplier:
        item.supplier?.name ||
        purchase?.supplier?.name ||
        legacySupplierName(item.suppliers),
      since,
      days: Math.max(differenceInCalendarDays(today, since), 0),
      cost: Math.round((item.purchasePrice || 0) * 100) / 100,
    };
  });

  // A→Z by model, then storage, colour, IMEI so identical phones sit together.
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  rows.sort(
    (a, b) =>
      collator.compare(a.name, b.name) ||
      collator.compare(a.storage, b.storage) ||
      collator.compare(a.specs, b.specs) ||
      collator.compare(a.imei || a.serial, b.imei || b.serial),
  );

  const totals = {
    count: rows.length,
    newCount: rows.filter((r) => r.condition === "NEW").length,
    oldCount: rows.filter((r) => r.condition === "USED").length,
    exchangeCount: rows.filter((r) => r.exchange).length,
    cost: Math.round(rows.reduce((sum, r) => sum + r.cost, 0) * 100) / 100,
  };

  const pdf = await render({ scope, rows, totals, showCost: options.showCost });
  const part = scope === "NEW" ? "new-mobiles" : scope === "USED" ? "old-mobiles" : "all-stock";
  return {
    pdf,
    filename: `stock-${part}-${format(today, "yyyy-MM-dd")}.pdf`,
  };
}

type Totals = {
  count: number;
  newCount: number;
  oldCount: number;
  exchangeCount: number;
  cost: number;
};

function drawHeader(doc: PDFKit.PDFDocument, scope: StockStatementScope) {
  const logo = 38;
  drawBabuLogo(doc, M, 22, logo);
  const x = M + logo + 12;
  const nameY = 18;
  const size = 18;
  const nameW = drawWordmarkText(doc, shop.name.toUpperCase(), x, nameY, size);
  if (shop.nameSuffix) {
    doc.font(FONT.display).fontSize(size);
    const baseline = nameY + ascenderOf(doc, size);
    doc.font(FONT.bold).fontSize(7.5);
    doc
      .fillColor(COLORS.accent)
      .text(shop.nameSuffix.toUpperCase(), x + nameW + 4, baseline - ascenderOf(doc, 7.5), {
        lineBreak: false,
      });
  }
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(shop.address, x, 44, { lineBreak: false })
    .text(`Ph: ${shop.phone}`, x, 54, { lineBreak: false });

  doc
    .font(FONT.bold)
    .fontSize(13)
    .fillColor(COLORS.ink)
    .text(`STOCK STATEMENT · ${scopeTitle(scope)}`, M, 24, {
      width: W,
      align: "right",
      characterSpacing: 0.6,
    });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(`Mobiles in shop · as of ${day(new Date())}`, M, 42, { width: W, align: "right" });

  doc.moveTo(M, 72).lineTo(PAGE.width - M, 72).strokeColor(COLORS.slate).lineWidth(1).stroke();
  return 84;
}

function drawSummary(
  doc: PDFKit.PDFDocument,
  y: number,
  scope: StockStatementScope,
  t: Totals,
  showCost: boolean,
) {
  const boxes: Array<{ label: string; value: string; fill: string; color: string }> = [
    { label: "Mobiles in stock", value: String(t.count), fill: "#F4F6FB", color: COLORS.ink },
  ];
  if (scope === "ALL") {
    boxes.push(
      { label: "New", value: String(t.newCount), fill: "#E7F8F1", color: GREEN },
      { label: "Old", value: String(t.oldCount), fill: "#FFF7E6", color: AMBER },
    );
  }
  boxes.push({ label: "From exchange", value: String(t.exchangeCount), fill: "#EAF2FF", color: BLUE });
  if (showCost) {
    boxes.push({ label: "Total cost", value: rupees(t.cost), fill: "#F4F6FB", color: COLORS.ink });
  }

  const gap = 8;
  const bw = (W - gap * (boxes.length - 1)) / boxes.length;
  boxes.forEach((box, i) => {
    const bx = M + i * (bw + gap);
    doc.roundedRect(bx, y, bw, 42, 8).fill(box.fill);
    doc.font(FONT.medium).fontSize(7.5).fillColor(COLORS.muted).text(box.label.toUpperCase(), bx + 10, y + 8, {
      width: bw - 20,
      characterSpacing: 0.5,
      lineBreak: false,
    });
    doc.font(FONT.bold).fontSize(12).fillColor(box.color).text(box.value, bx + 10, y + 21, {
      width: bw - 20,
      lineBreak: false,
    });
  });
  return y + 42 + 12;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number, cols: Col[]) {
  doc.rect(M, y, W, 20).fill(COLORS.slate);
  let x = M;
  doc.font(FONT.semibold).fontSize(7.5).fillColor(COLORS.white);
  for (const col of cols) {
    doc.text(col.label, x + PAD, y + 6.5, { width: col.width - PAD * 2, align: col.align, lineBreak: false });
    x += col.width;
  }
  return y + 20;
}

function drawRow(doc: PDFKit.PDFDocument, y: number, row: Row, index: number, cols: Col[]) {
  if (index % 2 === 1) doc.rect(M, y, W, ROW_H).fill("#F8FAFD");
  const top = y + 6;
  let x = M;

  const cell = (
    col: Col,
    first: string,
    second = "",
    color: string = COLORS.ink,
    font: string = FONT.regular,
  ) => {
    const w = col.width - PAD * 2;
    doc.font(font).fontSize(8).fillColor(color).text(first || "—", x + PAD, top, {
      width: w,
      align: col.align,
      lineBreak: false,
      ellipsis: true,
    });
    if (second) {
      doc.font(FONT.regular).fontSize(7).fillColor(COLORS.muted).text(second, x + PAD, top + 11, {
        width: w,
        align: col.align,
        lineBreak: false,
        ellipsis: true,
      });
    }
  };

  for (const col of cols) {
    switch (col.key) {
      case "n":
        cell(col, String(index + 1), "", COLORS.muted);
        break;
      case "mobile":
        cell(col, row.name, row.specs, COLORS.ink, FONT.semibold);
        break;
      case "storage":
        cell(col, row.storage);
        break;
      case "ram":
        cell(col, row.ram);
        break;
      case "ids":
        cell(
          col,
          row.imei || (row.serial ? `SN ${row.serial}` : ""),
          row.imei && row.serial ? `SN ${row.serial}` : "",
        );
        break;
      case "type":
        cell(col, row.condition === "USED" ? "Old" : "New", "", row.condition === "USED" ? AMBER : GREEN, FONT.semibold);
        break;
      case "exchange":
        cell(col, row.exchange ? "Yes" : "No", "", row.exchange ? BLUE : COLORS.muted, row.exchange ? FONT.semibold : FONT.regular);
        break;
      case "supplier":
        cell(col, row.supplier);
        break;
      case "since":
        cell(col, day(row.since), row.days === 0 ? "Today" : `${row.days} day${row.days === 1 ? "" : "s"}`);
        break;
      case "cost":
        cell(col, money(row.cost), "", COLORS.ink, FONT.medium);
        break;
    }
    x += col.width;
  }

  doc.moveTo(M, y + ROW_H).lineTo(M + W, y + ROW_H).strokeColor("#E6EAF1").lineWidth(0.5).stroke();
  return y + ROW_H;
}

function drawTotals(doc: PDFKit.PDFDocument, y: number, t: Totals, cols: Col[], showCost: boolean) {
  const h = 22;
  doc.rect(M, y, W, h).fill(COLORS.accentSoft);
  doc.font(FONT.bold).fontSize(8.5).fillColor(COLORS.ink);
  doc.text(`Total · ${t.count} mobile${t.count === 1 ? "" : "s"}`, M + PAD, y + 7, { lineBreak: false });
  if (showCost) {
    const costCol = cols[cols.length - 1];
    doc.text(money(t.cost), M + W - costCol.width + PAD, y + 7, {
      width: costCol.width - PAD * 2,
      align: "right",
      lineBreak: false,
    });
  }
  return y + h;
}

function drawFooters(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  const generated = format(new Date(), "dd MMM yyyy, h:mm a");
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = PAGE.height - FOOTER_H + 8;
    doc.moveTo(M, y - 6).lineTo(PAGE.width - M, y - 6).strokeColor("#E6EAF1").lineWidth(0.5).stroke();
    doc
      .font(FONT.regular)
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .text("Only mobiles currently in the shop (sold and returned units are not listed).", M, y, {
        width: W - 200,
        lineBreak: false,
      })
      .text(`Generated ${generated}  ·  Page ${i - range.start + 1} of ${range.count}`, M, y, {
        width: W,
        align: "right",
        lineBreak: false,
      });
  }
}

function render(data: {
  scope: StockStatementScope;
  rows: Row[];
  totals: Totals;
  showCost: boolean;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      bufferPages: true,
      info: { Title: `Stock statement — ${scopeTitle(data.scope)}`, Author: shop.name },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    const cols = columns(data.scope, data.showCost);
    let y = drawHeader(doc, data.scope);
    y = drawSummary(doc, y, data.scope, data.totals, data.showCost);
    const bottom = PAGE.height - FOOTER_H - 6;
    y = drawTableHeader(doc, y, cols);

    if (!data.rows.length) {
      doc
        .font(FONT.regular)
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text("No mobiles in stock for this selection.", M, y + 14, { width: W, align: "center" });
      y += 40;
    }

    data.rows.forEach((row, index) => {
      if (y + ROW_H > bottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = drawTableHeader(doc, M, cols);
      }
      y = drawRow(doc, y, row, index, cols);
    });

    if (y + 22 > bottom) {
      doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      y = M;
    }
    drawTotals(doc, y, data.totals, cols, data.showCost);
    drawFooters(doc);
    doc.end();
  });
}
