import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { format } from "date-fns";
import { prisma } from "../lib/prisma";
import { istDateString } from "../lib/ist";
import { COLORS, FONT, drawShopLogo, money, registerFonts, shop } from "./pdf";

/**
 * One customer due (a bill sold on credit): when it was bought, what was left
 * to pay, every payment against it, the promised due date and how late each
 * payment (or the pending balance) is. Used by the due page and its PDF.
 */

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Whole IST calendar days from `from` to `to` (negative = before). */
function daysBetween(from: Date, to: Date) {
  const a = Date.parse(`${istDateString(from)}T00:00:00Z`);
  const b = Date.parse(`${istDateString(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  na: "N/A",
};

export function methodLabel(method: string) {
  return METHOD_LABEL[method] || method;
}

export async function getCustomerDue(billId: string) {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      items: {
        select: {
          productName: true,
          color: true,
          storage: true,
          ram: true,
          imei1: true,
          imei2: true,
          serialNumber: true,
        },
      },
      duePayments: { orderBy: { paidAt: "asc" } },
      dueCharges: { orderBy: { givenAt: "asc" } },
    },
  });
  if (!bill) return null;

  const pending = bill.dueSettled ? 0 : round2(Math.max(bill.dueAmount, 0));
  const paidTotal = round2(bill.duePayments.reduce((sum, p) => sum + p.amount, 0));
  const givenTotal = round2(bill.dueCharges.reduce((sum, c) => sum + c.amount, 0));
  /** Everything the customer ever owed on this due (bill credit + "You gave"). */
  const originalDue = round2(pending + paidTotal);
  /** Left unpaid when the bill was made. */
  const creditAtSale = round2(Math.max(originalDue - givenTotal, 0));
  const settled = originalDue > 0 && pending <= 0.005;
  const now = new Date();

  const products = bill.items.map((item) => ({
    label: [item.productName, item.color, item.storage, item.ram]
      .filter(Boolean)
      .join(" "),
    ids: [item.imei1, item.imei2, item.serialNumber].filter(
      (value): value is string => Boolean(value),
    ),
  }));

  // One ledger, oldest first: the bill, then "You gave" / "You got" by date.
  type Entry = {
    id: string;
    kind: "bill" | "gave" | "got";
    date: Date;
    amount: number;
    note: string | null;
    method: string | null;
    methodLabel: string | null;
    delayDays: number | null;
  };
  const moves: Entry[] = [
    ...bill.dueCharges.map((c) => ({
      id: c.id,
      kind: "gave" as const,
      date: c.givenAt,
      amount: round2(c.amount),
      note: c.note,
      method: null,
      methodLabel: null,
      delayDays: null,
    })),
    ...bill.duePayments.map((p) => ({
      id: p.id,
      kind: "got" as const,
      date: p.paidAt,
      amount: round2(p.amount),
      note: p.note,
      method: p.method,
      methodLabel: methodLabel(p.method),
      /** Days after the promised due date (0 or less = on time). */
      delayDays: bill.dueDate ? daysBetween(bill.dueDate, p.paidAt) : null,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  let balance = creditAtSale;
  const entries = [
    {
      id: bill.id,
      kind: "bill" as const,
      date: bill.billDate.toISOString(),
      amount: creditAtSale,
      note: null,
      method: null,
      methodLabel: null,
      delayDays: null,
      balanceAfter: creditAtSale,
    },
    ...moves.map((entry) => {
      balance = round2(balance + (entry.kind === "gave" ? entry.amount : -entry.amount));
      return { ...entry, date: entry.date.toISOString(), balanceAfter: Math.max(balance, 0) };
    }),
  ];

  const payments = entries
    .filter((e) => e.kind === "got")
    .map((e) => ({
      id: e.id,
      paidAt: e.date,
      amount: e.amount,
      method: e.method ?? "na",
      methodLabel: e.methodLabel ?? "",
      kind: bill.duePayments.find((p) => p.id === e.id)?.kind ?? "partial",
      note: e.note,
      balanceAfter: e.balanceAfter,
      delayDays: e.delayDays,
    }));

  const lastPaidAt = bill.duePayments.at(-1)?.paidAt ?? null;
  // Still pending: late by today. Cleared: late by the day it was cleared.
  const delayDays = bill.dueDate
    ? daysBetween(bill.dueDate, settled && lastPaidAt ? lastPaidAt : now)
    : null;

  return {
    id: bill.id,
    duePrivate: bill.duePrivate,
    invoiceNumber: bill.invoiceNumber,
    customerName: bill.customerName,
    customerPhone: bill.customerPhone,
    customerAddress: bill.customerAddress,
    billDate: bill.billDate.toISOString(),
    billTotal: round2(bill.payableAmount || bill.grandTotal),
    products,
    originalDue,
    creditAtSale,
    givenTotal,
    paidTotal,
    pending,
    settled,
    dueDate: bill.dueDate?.toISOString() ?? null,
    settledAt: settled && lastPaidAt ? lastPaidAt.toISOString() : null,
    delayDays,
    payments,
    entries,
  };
}

export type CustomerDue = NonNullable<Awaited<ReturnType<typeof getCustomerDue>>>;

/* ------------------------------------------------------------------ PDF -- */

const PAGE = { width: 595.28, height: 841.89 };
const M = 32;
const W = PAGE.width - M * 2;
const FOOTER_H = 34;
const PAD = 5;
const GREEN = "#0B7A5B";
const RED = "#BE123C";
const AMBER = "#B45309";
const SHADE = "#FAF7F0";

const COLS = [
  { label: "Date", width: 64, align: "left" },
  { label: "Particulars", width: 180, align: "left" },
  { label: "Due", width: 66, align: "right" },
  { label: "Paid", width: 66, align: "right" },
  { label: "Balance", width: 70, align: "right" },
  { label: "Delay", width: W - 64 - 180 - 66 - 66 - 70, align: "right" },
] as const;

type Row = {
  date: Date;
  particulars: string;
  detail: string;
  due: number;
  paid: number;
  balance: number;
  delay: string;
  delayColor: string;
};

function day(date: Date) {
  return format(date, "dd MMM yyyy");
}

function rupees(amount: number) {
  return `Rs. ${money(amount)}`;
}

export function delayText(days: number | null) {
  if (days === null) return "";
  if (days <= 0) return "On time";
  return `${days} day${days === 1 ? "" : "s"} late`;
}

export async function buildDueStatement(billId: string) {
  const due = await getCustomerDue(billId);
  if (!due) return null;

  const rows: Row[] = due.entries.map((entry) => {
    if (entry.kind === "bill") {
      return {
        date: new Date(entry.date),
        particulars: `Purchase · Bill ${due.invoiceNumber}`,
        detail: [
          due.products.map((p) => p.label).join(", "),
          `Bill total ${rupees(due.billTotal)}`,
        ]
          .filter(Boolean)
          .join("\n"),
        due: entry.amount,
        paid: 0,
        balance: entry.balanceAfter,
        delay: "",
        delayColor: COLORS.muted,
      };
    }
    if (entry.kind === "gave") {
      return {
        date: new Date(entry.date),
        particulars: "Given / added",
        detail: entry.note || "",
        due: entry.amount,
        paid: 0,
        balance: entry.balanceAfter,
        delay: "",
        delayColor: COLORS.muted,
      };
    }
    return {
      date: new Date(entry.date),
      particulars: `${entry.balanceAfter <= 0 ? "Paid in full" : "Part payment"} · ${entry.methodLabel}`,
      detail: entry.note || "",
      due: 0,
      paid: entry.amount,
      balance: entry.balanceAfter,
      delay: delayText(entry.delayDays),
      delayColor: entry.delayDays !== null && entry.delayDays > 0 ? RED : GREEN,
    };
  });

  const pdf = await renderStatement(due, rows);
  const safeName = due.customerName.replace(/[^\w.-]+/g, "_").slice(0, 40) || "customer";
  return {
    pdf,
    filename: `Due-${safeName}-${due.invoiceNumber}-${format(new Date(), "yyyy-MM-dd")}.pdf`,
  };
}

function drawHeader(doc: PDFKit.PDFDocument) {
  const logoW = 44;
  drawShopLogo(doc, M, 18, logoW, 54);
  const x = M + logoW + 12;

  const parts = shop.name.toUpperCase().split(/\s+/);
  const first = parts[0] || shop.name.toUpperCase();
  const rest = parts.slice(1).join(" ");
  doc.font(FONT.bold).fontSize(19);
  const firstW = doc.widthOfString(first + (rest ? " " : ""));
  doc.fillColor(COLORS.charcoal).text(first + (rest ? " " : ""), x, 20, { lineBreak: false });
  if (rest) doc.fillColor(COLORS.gold).text(rest, x + firstW, 20, { lineBreak: false });

  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(shop.address, x, 46, { width: 260 })
    .text(`Ph: ${shop.phone}`, x, doc.y + 1, { lineBreak: false });

  doc
    .font(FONT.bold)
    .fontSize(13)
    .fillColor(COLORS.charcoal)
    .text("CUSTOMER DUE STATEMENT", M, 28, { width: W, align: "right", characterSpacing: 0.6 });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(`As of ${day(new Date())}`, M, 47, { width: W, align: "right" });

  doc.moveTo(M, 82).lineTo(PAGE.width - M, 82).strokeColor(COLORS.charcoal).lineWidth(1).stroke();
  return 94;
}

function drawCustomerAndSummary(doc: PDFKit.PDFDocument, y: number, due: CustomerDue) {
  doc.font(FONT.medium).fontSize(8).fillColor(COLORS.muted).text("CUSTOMER", M, y, { characterSpacing: 0.8 });
  doc.font(FONT.bold).fontSize(14).fillColor(COLORS.ink).text(due.customerName, M, y + 11, { width: W / 2 });
  doc
    .font(FONT.regular)
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(
      [
        `Ph: ${due.customerPhone}`,
        `Bill ${due.invoiceNumber}`,
        `Purchased ${day(new Date(due.billDate))}`,
      ].join("   ·   "),
      M,
      doc.y + 2,
      { width: W },
    );
  if (due.customerAddress) {
    doc.text(due.customerAddress, M, doc.y + 1, { width: W });
  }

  // Promised date and delay, right side.
  const promised = due.dueDate ? day(new Date(due.dueDate)) : "Not set";
  const late = due.delayDays !== null && due.delayDays > 0;
  doc
    .font(FONT.medium)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text("PROMISED DUE DATE", M, y, { width: W, align: "right", characterSpacing: 0.8 });
  doc.font(FONT.bold).fontSize(12).fillColor(COLORS.ink).text(promised, M, y + 11, { width: W, align: "right" });
  if (due.delayDays !== null) {
    doc
      .font(FONT.semibold)
      .fontSize(9)
      .fillColor(late ? RED : GREEN)
      .text(
        late
          ? `${delayText(due.delayDays)}${due.settled ? " (when cleared)" : " so far"}`
          : due.settled
            ? "Cleared on time"
            : "Not late yet",
        M,
        y + 27,
        { width: W, align: "right" },
      );
  }
  y = Math.max(doc.y, y + 44) + 12;

  const boxes = [
    { label: "Due amount", value: rupees(due.originalDue), fill: "#F4F4F5", color: COLORS.ink },
    { label: "Paid", value: rupees(due.paidTotal), fill: "#E7F8F1", color: GREEN },
    due.settled
      ? { label: "Status", value: "Settled", fill: "#E7F8F1", color: GREEN }
      : { label: "Pending", value: rupees(due.pending), fill: "#FFF1F2", color: RED },
  ];
  const gap = 8;
  const bw = (W - gap * (boxes.length - 1)) / boxes.length;
  boxes.forEach((box, i) => {
    const bx = M + i * (bw + gap);
    doc.roundedRect(bx, y, bw, 48, 8).fill(box.fill);
    doc.font(FONT.medium).fontSize(8).fillColor(COLORS.muted).text(box.label.toUpperCase(), bx + 12, y + 10, {
      width: bw - 24,
      characterSpacing: 0.6,
    });
    doc.font(FONT.bold).fontSize(12).fillColor(box.color).text(box.value, bx + 12, y + 24, {
      width: bw - 24,
      lineBreak: false,
    });
  });
  return y + 48 + 16;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(M, y, W, 22).fill(COLORS.charcoal);
  let x = M;
  doc.font(FONT.semibold).fontSize(8).fillColor(COLORS.white);
  for (const col of COLS) {
    doc.text(col.label, x + PAD, y + 7, { width: col.width - PAD * 2, align: col.align, lineBreak: false });
    x += col.width;
  }
  return y + 22;
}

function rowHeight(doc: PDFKit.PDFDocument, row: Row) {
  const width = COLS[1].width - PAD * 2;
  doc.font(FONT.semibold).fontSize(8.5);
  let h = doc.heightOfString(row.particulars, { width });
  if (row.detail) {
    doc.font(FONT.regular).fontSize(7.5);
    h += 2 + doc.heightOfString(row.detail, { width });
  }
  return Math.max(h, 10) + 12;
}

function drawRow(doc: PDFKit.PDFDocument, y: number, row: Row, shaded: boolean) {
  const h = rowHeight(doc, row);
  if (shaded) doc.rect(M, y, W, h).fill(SHADE);
  const top = y + 6;
  let x = M;
  const cell = (index: number, text: string, font: string, color: string) => {
    const col = COLS[index];
    doc.font(font).fontSize(8.5).fillColor(color).text(text, x + PAD, top, {
      width: col.width - PAD * 2,
      align: col.align,
      lineBreak: false,
    });
    x += col.width;
  };

  cell(0, day(row.date), FONT.regular, COLORS.ink);

  const pw = COLS[1].width - PAD * 2;
  doc
    .font(FONT.semibold)
    .fontSize(8.5)
    .fillColor(row.paid ? GREEN : COLORS.ink)
    .text(row.particulars, x + PAD, top, { width: pw });
  if (row.detail) {
    doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.muted).text(row.detail, x + PAD, doc.y + 2, { width: pw });
  }
  x += COLS[1].width;

  cell(2, row.due ? money(row.due) : "", FONT.medium, COLORS.ink);
  cell(3, row.paid ? money(row.paid) : "", FONT.medium, GREEN);
  cell(4, money(row.balance), FONT.bold, row.balance > 0.005 ? COLORS.ink : GREEN);
  cell(5, row.delay, FONT.semibold, row.delayColor);

  doc.moveTo(M, y + h).lineTo(M + W, y + h).strokeColor("#E7E2D6").lineWidth(0.5).stroke();
  return y + h;
}

function drawTotals(doc: PDFKit.PDFDocument, y: number, due: CustomerDue) {
  const h = 24;
  doc.rect(M, y, W, h).fill(COLORS.goldSoft);
  const offset = (i: number) => M + COLS.slice(0, i).reduce((s, c) => s + c.width, 0);
  doc.font(FONT.bold).fontSize(9).fillColor(COLORS.ink);
  doc.text("Total", M + PAD, y + 8, { lineBreak: false });
  const put = (i: number, text: string, color: string) =>
    doc.fillColor(color).text(text, offset(i) + PAD, y + 8, {
      width: COLS[i].width - PAD * 2,
      align: "right",
      lineBreak: false,
    });
  put(2, money(due.originalDue), COLORS.ink);
  put(3, money(due.paidTotal), GREEN);
  put(4, money(due.pending), due.pending > 0.005 ? RED : GREEN);
  return y + h;
}

function drawFooters(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  const generated = format(new Date(), "dd MMM yyyy, h:mm a");
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = PAGE.height - FOOTER_H + 6;
    doc.moveTo(M, y - 6).lineTo(PAGE.width - M, y - 6).strokeColor("#E7E2D6").lineWidth(0.5).stroke();
    doc
      .font(FONT.regular)
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .text("Delay = days after the promised due date", M, y, { width: W - 120, lineBreak: false })
      .text(`Generated ${generated}  ·  Page ${i - range.start + 1} of ${range.count}`, M, y, {
        width: W,
        align: "right",
        lineBreak: false,
      });
  }
}

function renderStatement(due: CustomerDue, rows: Row[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      bufferPages: true,
      info: {
        Title: `Due statement — ${due.customerName} (${due.invoiceNumber})`,
        Author: shop.name,
        Subject: "Customer due statement",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    let y = drawHeader(doc);
    y = drawCustomerAndSummary(doc, y, due);

    const bottom = PAGE.height - FOOTER_H - 8;
    y = drawTableHeader(doc, y);
    rows.forEach((row, index) => {
      if (y + rowHeight(doc, row) > bottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = drawTableHeader(doc, M);
      }
      y = drawRow(doc, y, row, index % 2 === 1);
    });
    if (y + 24 > bottom) {
      doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      y = M;
    }
    drawTotals(doc, y, due);

    drawFooters(doc);
    doc.end();
  });
}
