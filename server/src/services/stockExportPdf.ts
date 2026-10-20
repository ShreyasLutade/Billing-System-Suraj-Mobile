import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { format } from "date-fns";
import { prisma } from "../lib/prisma";
import { COLORS, FONT, drawShopLogo, money, registerFonts, shop } from "./pdf";

/**
 * Everything currently in stock for one condition (new / old mobiles) as an
 * A4 portrait PDF — one row per unit with its IMEI, supplier and age, plus
 * per-model subtotals. Portrait so it reads well on a phone after sharing.
 *
 * Cost and total value are admin-only: `withCost` comes from the caller's
 * role, matching how the Stock page hides prices from staff.
 */

export type StockExportCondition = "NEW" | "USED";

const PAGE = { width: 595.28, height: 841.89 };
const M = 28;
const W = PAGE.width - M * 2;
const FOOTER_H = 30;
const PAD = 5;
const GREEN = "#0B7A5B";
const AMBER = "#B45309";

type Col = {
  key: string;
  label: string;
  width: number;
  align: "left" | "right";
};

/** Column set depends on whether costs are shown (admin) or not (staff). */
function columns(withCost: boolean): Col[] {
  return withCost
    ? [
        { key: "n", label: "#", width: 22, align: "right" },
        { key: "mobile", label: "Mobile", width: 168, align: "left" },
        { key: "ids", label: "IMEI / Serial", width: 108, align: "left" },
        { key: "supplier", label: "Supplier", width: 94, align: "left" },
        { key: "added", label: "In stock", width: 60, align: "left" },
        { key: "cost", label: "Cost", width: W - 22 - 168 - 108 - 94 - 60, align: "right" },
      ]
    : [
        { key: "n", label: "#", width: 22, align: "right" },
        { key: "mobile", label: "Mobile", width: 200, align: "left" },
        { key: "ids", label: "IMEI / Serial", width: 125, align: "left" },
        { key: "supplier", label: "Supplier", width: 130, align: "left" },
        { key: "added", label: "In stock", width: W - 22 - 200 - 125 - 130, align: "left" },
      ];
}

type Row = {
  name: string;
  specs: string;
  imei: string;
  serial: string;
  supplier: string;
  addedAt: Date;
  ageDays: number;
  cost: number;
};

type Totals = {
  count: number;
  models: number;
  cost: number;
  oldestDays: number;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function day(date: Date) {
  return format(date, "dd MMM yyyy");
}

function daysSince(date: Date) {
  const ms = Date.now() - date.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Red past 60 days, amber past 30 — the "money sitting still" signal. */
function ageColor(days: number) {
  if (days >= 60) return "#BE123C";
  if (days >= 30) return AMBER;
  return COLORS.muted;
}

function safeFilePart(value: string) {
  return (
    value
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "stock"
  );
}

function modelKey(row: Row) {
  return `${row.name.trim().toLowerCase()}|${row.specs.trim().toLowerCase()}`;
}

export async function buildStockExportPdf(
  condition: StockExportCondition,
  withCost: boolean,
) {
  const items = await prisma.stockItem.findMany({
    where: {
      condition,
      status: "AVAILABLE",
      NOT: { kind: "ACCESSORY" },
    },
    include: {
      supplier: { select: { name: true } },
      purchaseItem: {
        select: { purchase: { select: { purchaseDate: true } } },
      },
    },
    orderBy: [{ mobileName: "asc" }, { createdAt: "asc" }],
  });

  let totalCost = 0;
  let oldestDays = 0;

  const rows: Row[] = items.map((item) => {
    const addedAt = item.purchaseItem?.purchase.purchaseDate ?? item.createdAt;
    const ageDays = daysSince(addedAt);
    const cost = round2(item.purchasePrice || 0);
    totalCost += cost;
    if (ageDays > oldestDays) oldestDays = ageDays;

    return {
      name: item.mobileName,
      specs: [
        item.color,
        item.storage,
        item.platform === "ANDROID" ? item.ram : null,
      ]
        .filter(Boolean)
        .join(" · "),
      imei: item.imei ? item.imei.split("~")[0] : "",
      serial: item.serialNumber ? item.serialNumber.split("~")[0] : "",
      supplier: item.supplier?.name ?? "",
      addedAt,
      ageDays,
      cost,
    };
  });

  // Group by model + variant so each band covers one contiguous block;
  // the DB sort is by name only, which interleaves colours.
  rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.specs.localeCompare(b.specs) ||
      a.addedAt.getTime() - b.addedAt.getTime(),
  );

  const totals: Totals = {
    count: rows.length,
    models: new Set(rows.map(modelKey)).size,
    cost: round2(totalCost),
    oldestDays,
  };

  const pdf = await render({ condition, rows, totals, withCost });
  const conditionPart = condition === "USED" ? "old" : "new";

  return {
    pdf,
    filename: `${safeFilePart(shop.name)}-${conditionPart}-mobiles-${format(
      new Date(),
      "yyyy-MM-dd",
    )}.pdf`,
    unitCount: totals.count,
    modelCount: totals.models,
  };
}

function drawHeader(doc: PDFKit.PDFDocument, condition: StockExportCondition) {
  const logoW = 38;
  drawShopLogo(doc, M, 14, logoW, 48);
  const x = M + logoW + 12;

  // Shop name like the invoice: first word charcoal, the rest gold.
  const parts = shop.name.toUpperCase().split(/\s+/);
  const first = parts[0] || shop.name.toUpperCase();
  const rest = parts.slice(1).join(" ");
  doc.font(FONT.bold).fontSize(17);
  const firstW = doc.widthOfString(first + (rest ? " " : ""));
  doc
    .fillColor(COLORS.charcoal)
    .text(first + (rest ? " " : ""), x, 16, { lineBreak: false });
  if (rest) {
    doc.fillColor(COLORS.gold).text(rest, x + firstW, 16, { lineBreak: false });
  }

  doc
    .font(FONT.regular)
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text(shop.address, x, 38, {
      width: 330,
      lineBreak: false,
      ellipsis: true,
    })
    .text(`Ph: ${shop.phone}`, x, 49, { lineBreak: false });

  doc
    .font(FONT.bold)
    .fontSize(12.5)
    .fillColor(COLORS.charcoal)
    .text(condition === "USED" ? "OLD MOBILES" : "NEW MOBILES", M, 20, {
      width: W,
      align: "right",
      characterSpacing: 0.6,
    });
  doc
    .font(FONT.regular)
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text(`Stock in hand · as of ${day(new Date())}`, M, 36, {
      width: W,
      align: "right",
    });

  doc
    .moveTo(M, 68)
    .lineTo(PAGE.width - M, 68)
    .strokeColor(COLORS.charcoal)
    .lineWidth(1)
    .stroke();
  return 78;
}

function drawSummary(
  doc: PDFKit.PDFDocument,
  y: number,
  totals: Totals,
  withCost: boolean,
) {
  const boxes = [
    { label: "Mobiles", value: String(totals.count), fill: "#F4F6FB", color: COLORS.ink },
    { label: "Models", value: String(totals.models), fill: "#F4F6FB", color: COLORS.ink },
    ...(withCost
      ? [
          {
            label: "Stock value",
            value: `Rs. ${money(totals.cost)}`,
            fill: "#E7F8F1",
            color: GREEN,
          },
        ]
      : []),
    {
      label: "Oldest unit",
      value: totals.count ? `${totals.oldestDays} days` : "—",
      fill: "#FFF7E6",
      color: ageColor(totals.oldestDays),
    },
  ];

  const gap = 8;
  const bw = (W - gap * (boxes.length - 1)) / boxes.length;
  let bx = M;
  for (const box of boxes) {
    doc.roundedRect(bx, y, bw, 40, 8).fill(box.fill);
    doc
      .font(FONT.medium)
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(box.label.toUpperCase(), bx + 10, y + 8, {
        width: bw - 20,
        characterSpacing: 0.5,
        lineBreak: false,
      });
    doc
      .font(FONT.bold)
      .fontSize(11)
      .fillColor(box.color)
      .text(box.value, bx + 10, y + 21, { width: bw - 20, lineBreak: false });
    bx += bw + gap;
  }
  return y + 40 + 12;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number, cols: Col[]) {
  doc.rect(M, y, W, 19).fill(COLORS.charcoal);
  let x = M;
  doc.font(FONT.semibold).fontSize(7.5).fillColor(COLORS.white);
  for (const col of cols) {
    doc.text(col.label, x + PAD, y + 6, {
      width: col.width - PAD * 2,
      align: col.align,
      lineBreak: false,
    });
    x += col.width;
  }
  return y + 19;
}

const ROW_H = 28;

function drawRow(
  doc: PDFKit.PDFDocument,
  y: number,
  row: Row,
  index: number,
  cols: Col[],
  withCost: boolean,
) {
  if (index % 2 === 1) doc.rect(M, y, W, ROW_H).fill("#F8FAFD");
  const top = y + 5;
  let x = M;

  const cell = (
    i: number,
    first: string,
    second: string,
    color = COLORS.ink,
    firstFont: string = FONT.medium,
    secondColor = COLORS.muted,
  ) => {
    const col = cols[i];
    const w = col.width - PAD * 2;
    doc
      .font(firstFont)
      .fontSize(8)
      .fillColor(color)
      .text(first || "—", x + PAD, top, {
        width: w,
        align: col.align,
        lineBreak: false,
        ellipsis: true,
      });
    if (second) {
      doc
        .font(FONT.regular)
        .fontSize(6.8)
        .fillColor(secondColor)
        .text(second, x + PAD, top + 11, {
          width: w,
          align: col.align,
          lineBreak: false,
          ellipsis: true,
        });
    }
    x += col.width;
  };

  cell(0, String(index + 1), "", COLORS.muted, FONT.regular);
  cell(1, row.name, row.specs, COLORS.ink, FONT.semibold);
  cell(
    2,
    row.imei || (row.serial ? `SN ${row.serial}` : ""),
    row.imei && row.serial ? `SN ${row.serial}` : "",
    COLORS.ink,
    FONT.regular,
  );
  cell(3, row.supplier, "", COLORS.ink, FONT.regular);
  cell(
    4,
    day(row.addedAt),
    `${row.ageDays}d`,
    COLORS.ink,
    FONT.regular,
    ageColor(row.ageDays),
  );
  if (withCost) cell(5, money(row.cost), "");

  doc
    .moveTo(M, y + ROW_H)
    .lineTo(M + W, y + ROW_H)
    .strokeColor("#E6EAF1")
    .lineWidth(0.5)
    .stroke();
  return y + ROW_H;
}

/** Thin band between models so a long list stays readable. */
function drawModelBand(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  count: number,
  value: number,
  withCost: boolean,
) {
  const h = 16;
  doc.rect(M, y, W, h).fill("#EEF1F5");
  doc
    .font(FONT.semibold)
    .fontSize(7.5)
    .fillColor("#475569")
    .text(label.toUpperCase(), M + PAD, y + 5, {
      width: W - 160,
      characterSpacing: 0.5,
      lineBreak: false,
      ellipsis: true,
    });
  doc
    .font(FONT.medium)
    .fontSize(7.5)
    .fillColor("#7A8699")
    .text(
      withCost
        ? `${count} pc${count === 1 ? "" : "s"} · Rs. ${money(value)}`
        : `${count} pc${count === 1 ? "" : "s"}`,
      M,
      y + 5,
      { width: W - PAD, align: "right", lineBreak: false },
    );
  return y + h;
}

function drawTotals(
  doc: PDFKit.PDFDocument,
  y: number,
  totals: Totals,
  cols: Col[],
  withCost: boolean,
) {
  const h = 22;
  doc.rect(M, y, W, h).fill(COLORS.goldSoft);
  doc
    .font(FONT.bold)
    .fontSize(8.5)
    .fillColor(COLORS.ink)
    .text(
      `Total · ${totals.count} mobile${totals.count === 1 ? "" : "s"} in stock`,
      M + PAD,
      y + 7,
      { lineBreak: false },
    );
  if (withCost) {
    const last = cols[cols.length - 1];
    doc.text(money(totals.cost), M + W - last.width + PAD, y + 7, {
      width: last.width - PAD * 2,
      align: "right",
      lineBreak: false,
    });
  }
  return y + h;
}

function drawFooters(doc: PDFKit.PDFDocument, withCost: boolean) {
  const range = doc.bufferedPageRange();
  const generated = format(new Date(), "dd MMM yyyy, h:mm a");
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = PAGE.height - FOOTER_H + 8;
    doc
      .moveTo(M, y - 6)
      .lineTo(PAGE.width - M, y - 6)
      .strokeColor("#E6EAF1")
      .lineWidth(0.5)
      .stroke();
    doc
      .font(FONT.regular)
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(
        withCost
          ? "Units available for sale. Cost is the purchase price."
          : "Units available for sale.",
        M,
        y,
        { width: W - 190, lineBreak: false },
      )
      .text(
        `Generated ${generated}  ·  Page ${i - range.start + 1} of ${range.count}`,
        M,
        y,
        { width: W, align: "right", lineBreak: false },
      );
  }
}

function render(data: {
  condition: StockExportCondition;
  rows: Row[];
  totals: Totals;
  withCost: boolean;
}): Promise<Buffer> {
  const { condition, rows, totals, withCost } = data;
  const cols = columns(withCost);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      bufferPages: true,
      info: {
        Title: `${condition === "USED" ? "Old" : "New"} mobiles in stock — ${shop.name}`,
        Author: shop.name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    let y = drawHeader(doc, condition);
    y = drawSummary(doc, y, totals, withCost);
    const bottom = PAGE.height - FOOTER_H - 6;
    y = drawTableHeader(doc, y, cols);

    if (!rows.length) {
      doc
        .font(FONT.regular)
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text(
          `No ${condition === "USED" ? "old" : "new"} mobiles in stock right now.`,
          M,
          y + 16,
          { width: W, align: "center" },
        );
      y += 44;
    }

    // Per-model count and value, computed once rather than per row.
    const groups = new Map<string, { count: number; cost: number }>();
    for (const row of rows) {
      const key = modelKey(row);
      const group = groups.get(key) ?? { count: 0, cost: 0 };
      group.count += 1;
      group.cost = round2(group.cost + row.cost);
      groups.set(key, group);
    }

    let lastModel = "";
    rows.forEach((row, index) => {
      const key = modelKey(row);
      const isNewModel = key !== lastModel;

      // Keep a model band with at least one row under it.
      const needed = isNewModel ? 16 + ROW_H : ROW_H;
      if (y + needed > bottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = drawTableHeader(doc, M, cols);
      }

      if (isNewModel) {
        const group = groups.get(key) ?? { count: 1, cost: row.cost };
        y = drawModelBand(
          doc,
          y,
          [row.name, row.specs].filter(Boolean).join(" · "),
          group.count,
          group.cost,
          withCost,
        );
        lastModel = key;
      }

      y = drawRow(doc, y, row, index, cols, withCost);
    });

    if (rows.length) {
      if (y + 22 > bottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = M;
      }
      y = drawTotals(doc, y, totals, cols, withCost);
    }

    drawFooters(doc, withCost);
    doc.end();
  });
}
