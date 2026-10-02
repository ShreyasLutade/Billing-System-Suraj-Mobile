import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { format } from "date-fns";
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
import type { SupplierMobileExportCondition } from "./supplierStockExport";

/**
 * Supplier's new / old mobiles as an A4 landscape PDF: every unit bought from
 * the supplier with its cost, where it is now (in stock, sold, returned) and
 * the sale it went out on, plus totals.
 */

const PAGE = { width: 841.89, height: 595.28 };
const M = 28;
const W = PAGE.width - M * 2;
const FOOTER_H = 30;
const PAD = 5;
const GREEN = "#0B7A5B";
const RED = "#BE123C";
const AMBER = "#B45309";

const COLS = [
  { key: "n", label: "#", width: 22, align: "right" },
  { key: "date", label: "Purchased", width: 58, align: "left" },
  { key: "mobile", label: "Mobile", width: 168, align: "left" },
  { key: "ids", label: "IMEI / Serial", width: 104, align: "left" },
  { key: "cost", label: "Cost", width: 62, align: "right" },
  { key: "status", label: "Status", width: 66, align: "left" },
  { key: "bill", label: "Sold on", width: 88, align: "left" },
  { key: "customer", label: "Customer", width: 104, align: "left" },
  { key: "sale", label: "Sale price", width: 60, align: "right" },
  { key: "margin", label: "Margin", width: W - 22 - 58 - 168 - 104 - 62 - 66 - 88 - 104 - 60, align: "right" },
] as const;

type Row = {
  date: Date;
  name: string;
  specs: string;
  imei: string;
  serial: string;
  cost: number;
  status: string;
  statusColor: string;
  invoice: string;
  billDate: string;
  customer: string;
  phone: string;
  sale: number | null;
  margin: number | null;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function day(date: Date) {
  return format(date, "dd MMM yyyy");
}

function rupees(amount: number) {
  return amount < -0.005 ? `-Rs. ${money(-amount)}` : `Rs. ${money(amount)}`;
}

function safeFilePart(value: string) {
  return value.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "supplier";
}

export async function buildSupplierMobilesPdf(
  supplierId: string,
  condition: SupplierMobileExportCondition,
) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, phone: true },
  });
  if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

  const items = await prisma.stockItem.findMany({
    where: {
      condition,
      NOT: { kind: "ACCESSORY" },
      OR: [{ supplierId: supplier.id }, { purchaseItem: { purchase: { supplierId: supplier.id } } }],
    },
    include: {
      purchaseItem: { select: { purchase: { select: { purchaseDate: true } } } },
      billItems: {
        orderBy: { bill: { billDate: "desc" } },
        take: 1,
        select: {
          rate: true,
          amount: true,
          bill: {
            select: { invoiceNumber: true, billDate: true, customerName: true, customerPhone: true },
          },
        },
      },
      productReturn: { select: { kind: true } },
      replacementFor: { select: { billId: true, invoiceNumber: true, customerName: true, createdAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { mobileName: "asc" }],
  });

  // Units given as replacements have no bill line; show the bill they replaced on.
  const swapBillIds = items
    .map((i) => (i.billItems[0] ? null : i.replacementFor?.billId))
    .filter((id): id is string => Boolean(id));
  const swapBills = new Map(
    (
      await prisma.bill.findMany({
        where: { id: { in: swapBillIds } },
        select: { id: true, customerPhone: true },
      })
    ).map((b) => [b.id, b]),
  );

  let soldCount = 0;
  let inStock = 0;
  let returnedCount = 0;
  let totalCost = 0;
  let totalSale = 0;
  let totalMargin = 0;

  const rows: Row[] = items.map((item) => {
    const line = item.billItems[0] ?? null;
    const swap = !line ? item.replacementFor : null;
    const cost = round2(item.purchasePrice || 0);
    const sale = line ? round2(line.amount ?? line.rate) : null;
    totalCost += cost;

    let status = "In stock";
    let statusColor = GREEN;
    if (item.productReturn) {
      status = item.productReturn.kind === "REPLACE" ? "Replaced" : "Returned";
      statusColor = AMBER;
      returnedCount += 1;
    } else if (item.status === "SOLD") {
      status = swap ? "Given instead" : "Sold";
      statusColor = RED;
      soldCount += 1;
    } else {
      inStock += 1;
    }

    const margin = sale != null && !item.productReturn ? round2(sale - cost) : null;
    if (sale != null && !item.productReturn) {
      totalSale += sale;
      totalMargin += margin ?? 0;
    }

    return {
      date: item.purchaseItem?.purchase.purchaseDate ?? item.createdAt,
      name: item.mobileName,
      specs: [
        item.color,
        item.storage,
        item.platform === "ANDROID" ? item.ram : null,
        item.platform === "IOS" ? "iOS" : item.platform === "ANDROID" ? "Android" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      imei: item.imei ? item.imei.split("~")[0] : "",
      serial: item.serialNumber ? item.serialNumber.split("~")[0] : "",
      cost,
      status,
      statusColor,
      invoice: line?.bill.invoiceNumber ?? swap?.invoiceNumber ?? "",
      billDate: line ? day(line.bill.billDate) : swap ? day(swap.createdAt) : "",
      customer: line?.bill.customerName ?? swap?.customerName ?? "",
      phone: line?.bill.customerPhone ?? (swap?.billId ? swapBills.get(swap.billId)?.customerPhone ?? "" : ""),
      sale,
      margin,
    };
  });

  const pdf = await render({
    supplierName: supplier.name,
    supplierPhone: supplier.phone,
    condition,
    rows,
    totals: {
      count: rows.length,
      inStock,
      sold: soldCount,
      returned: returnedCount,
      cost: round2(totalCost),
      sale: round2(totalSale),
      margin: round2(totalMargin),
    },
  });

  const conditionPart = condition === "USED" ? "old" : "new";
  return {
    pdf,
    filename: `${safeFilePart(supplier.name)}-${conditionPart}-mobiles-${format(new Date(), "yyyy-MM-dd")}.pdf`,
    unitCount: rows.length,
    soldCount,
  };
}

type Totals = {
  count: number;
  inStock: number;
  sold: number;
  returned: number;
  cost: number;
  sale: number;
  margin: number;
};

function drawHeader(doc: PDFKit.PDFDocument, condition: SupplierMobileExportCondition) {
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
    .text(condition === "USED" ? "OLD MOBILES" : "NEW MOBILES", M, 24, {
      width: W,
      align: "right",
      characterSpacing: 0.6,
    });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(`Supplier stock & sales · as of ${day(new Date())}`, M, 42, { width: W, align: "right" });

  doc.moveTo(M, 72).lineTo(PAGE.width - M, 72).strokeColor(COLORS.slate).lineWidth(1).stroke();
  return 82;
}

function drawSummary(
  doc: PDFKit.PDFDocument,
  y: number,
  data: { supplierName: string; supplierPhone: string | null; totals: Totals },
) {
  doc.font(FONT.medium).fontSize(8).fillColor(COLORS.muted).text("SUPPLIER", M, y, { characterSpacing: 0.8 });
  doc.font(FONT.bold).fontSize(14).fillColor(COLORS.ink).text(data.supplierName, M, y + 11, { width: W / 2 });
  if (data.supplierPhone) {
    doc.font(FONT.regular).fontSize(9).fillColor(COLORS.muted).text(`Ph: ${data.supplierPhone}`, M, doc.y + 1);
  }
  y = Math.max(doc.y, y + 34) + 10;

  const t = data.totals;
  const boxes = [
    { label: "Mobiles", value: String(t.count), fill: "#F4F6FB", color: COLORS.ink },
    { label: "In stock", value: String(t.inStock), fill: "#E7F8F1", color: GREEN },
    { label: "Sold", value: String(t.sold), fill: "#FFF1F2", color: RED },
    { label: "Returned", value: String(t.returned), fill: "#FFF7E6", color: AMBER },
    { label: "Total cost", value: rupees(t.cost), fill: "#F4F6FB", color: COLORS.ink },
    { label: "Sales · margin", value: `${rupees(t.sale)} · ${rupees(t.margin)}`, fill: "#E7F8F1", color: GREEN },
  ];
  const gap = 8;
  const widths = [70, 70, 70, 100, 130];
  const last = W - widths.reduce((s, w) => s + w, 0) - gap * (boxes.length - 1);
  let bx = M;
  boxes.forEach((box, i) => {
    const bw = i < widths.length ? widths[i] : last;
    doc.roundedRect(bx, y, bw, 42, 8).fill(box.fill);
    doc.font(FONT.medium).fontSize(7.5).fillColor(COLORS.muted).text(box.label.toUpperCase(), bx + 10, y + 8, {
      width: bw - 20,
      characterSpacing: 0.5,
      lineBreak: false,
    });
    doc.font(FONT.bold).fontSize(11).fillColor(box.color).text(box.value, bx + 10, y + 21, {
      width: bw - 20,
      lineBreak: false,
    });
    bx += bw + gap;
  });
  return y + 42 + 12;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(M, y, W, 20).fill(COLORS.slate);
  let x = M;
  doc.font(FONT.semibold).fontSize(7.5).fillColor(COLORS.white);
  for (const col of COLS) {
    doc.text(col.label, x + PAD, y + 6.5, { width: col.width - PAD * 2, align: col.align, lineBreak: false });
    x += col.width;
  }
  return y + 20;
}

const ROW_H = 30;

function drawRow(doc: PDFKit.PDFDocument, y: number, row: Row, index: number) {
  if (index % 2 === 1) doc.rect(M, y, W, ROW_H).fill("#F8FAFD");
  const top = y + 6;
  let x = M;
  const two = (i: number, first: string, second: string, color = COLORS.ink, firstFont: string = FONT.medium) => {
    const col = COLS[i];
    const w = col.width - PAD * 2;
    doc.font(firstFont).fontSize(8).fillColor(color).text(first || "—", x + PAD, top, {
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
    x += col.width;
  };

  two(0, String(index + 1), "", COLORS.muted, FONT.regular);
  two(1, day(row.date), "", COLORS.ink, FONT.regular);
  two(2, row.name, row.specs, COLORS.ink, FONT.semibold);
  two(3, row.imei || (row.serial ? `SN ${row.serial}` : ""), row.imei && row.serial ? `SN ${row.serial}` : "", COLORS.ink, FONT.regular);
  two(4, money(row.cost), "");
  two(5, row.status, "", row.statusColor, FONT.semibold);
  two(6, row.invoice, row.billDate);
  two(7, row.customer, row.phone);
  two(8, row.sale != null ? money(row.sale) : "", "");
  two(
    9,
    row.margin != null ? money(row.margin) : "",
    "",
    row.margin == null ? COLORS.muted : row.margin >= 0 ? GREEN : RED,
    FONT.semibold,
  );

  doc.moveTo(M, y + ROW_H).lineTo(M + W, y + ROW_H).strokeColor("#E6EAF1").lineWidth(0.5).stroke();
  return y + ROW_H;
}

function drawTotals(doc: PDFKit.PDFDocument, y: number, t: Totals) {
  const h = 22;
  doc.rect(M, y, W, h).fill(COLORS.accentSoft);
  const offset = (i: number) => M + COLS.slice(0, i).reduce((s, c) => s + c.width, 0);
  const put = (i: number, text: string, color: string) =>
    doc.fillColor(color).text(text, offset(i) + PAD, y + 7, {
      width: COLS[i].width - PAD * 2,
      align: COLS[i].align,
      lineBreak: false,
    });
  doc.font(FONT.bold).fontSize(8.5);
  doc.fillColor(COLORS.ink).text(`Total · ${t.count} mobile${t.count === 1 ? "" : "s"}`, M + PAD, y + 7, {
    lineBreak: false,
  });
  put(4, money(t.cost), COLORS.ink);
  put(8, money(t.sale), COLORS.ink);
  put(9, money(t.margin), t.margin >= 0 ? GREEN : RED);
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
      .text("Margin = sale price − cost (sold units only; returned / replaced units are not counted).", M, y, {
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
  supplierName: string;
  supplierPhone: string | null;
  condition: SupplierMobileExportCondition;
  rows: Row[];
  totals: Totals;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      bufferPages: true,
      info: {
        Title: `${data.condition === "USED" ? "Old" : "New"} mobiles — ${data.supplierName}`,
        Author: shop.name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    let y = drawHeader(doc, data.condition);
    y = drawSummary(doc, y, data);
    const bottom = PAGE.height - FOOTER_H - 6;
    y = drawTableHeader(doc, y);

    if (!data.rows.length) {
      doc
        .font(FONT.regular)
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text(
          `No ${data.condition === "USED" ? "old" : "new"} mobiles from this supplier yet.`,
          M,
          y + 14,
          { width: W, align: "center" },
        );
      y += 40;
    }

    data.rows.forEach((row, index) => {
      if (y + ROW_H > bottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = drawTableHeader(doc, M);
      }
      y = drawRow(doc, y, row, index);
    });

    if (y + 22 > bottom) {
      doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      y = M;
    }
    drawTotals(doc, y, data.totals);
    drawFooters(doc);
    doc.end();
  });
}
