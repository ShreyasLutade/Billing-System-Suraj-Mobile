import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { format } from "date-fns";
import { prisma } from "../lib/prisma";
import type { toDateFilter } from "../lib/period";
import { COLORS, FONT, drawShopLogo, money, registerFonts, shop } from "./pdf";

/**
 * Money the shop gave back to customers in a period:
 *  - Exchange cash return: the "return money to customer" toggle on a bill.
 *  - Extra exchange value: the exchange phone was worth more than the bill.
 *  - Return refund: a sold item taken back for money (Replace / Return).
 * Same scope as the rest of Analytics: shop bills, not GST invoices.
 */

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type PayoutReason = "EXCHANGE" | "RETURN";

export type CustomerPayout = {
  id: string;
  billId: string | null;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  date: string;
  reason: PayoutReason;
  /** Exchange: fixed cash return from the "return money" toggle. */
  cashReturn: number;
  /** Exchange: exchange value above the bill total, owed back. */
  extraExchange: number;
  amount: number;
  /** RETURN only; exchange payouts don't record how they were paid. */
  method: "cash" | "online" | null;
  detail: string;
};

export async function loadCustomerPayouts(
  dateFilter: ReturnType<typeof toDateFilter>,
) {
  const [bills, returns] = await Promise.all([
    prisma.bill.findMany({
      where: {
        withGst: false,
        isExchange: true,
        exchangeValue: { gt: 0 },
        ...(dateFilter ? { billDate: dateFilter } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        customerPhone: true,
        billDate: true,
        grandTotal: true,
        exchangeValue: true,
        exchangeCashReturn: true,
        exchangeModel: true,
      },
    }),
    prisma.productReturn.findMany({
      where: {
        kind: "RETURN",
        refundAmount: { gt: 0 },
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      select: {
        id: true,
        billId: true,
        invoiceNumber: true,
        customerName: true,
        refundAmount: true,
        refundMethod: true,
        createdAt: true,
        stockItem: { select: { mobileName: true } },
      },
    }),
  ]);

  const items: CustomerPayout[] = [];

  // Same maths as the bill page's "Pay customer" box.
  for (const bill of bills) {
    const gross = Number(bill.exchangeValue || 0);
    const cashReturn = round2(
      Math.min(Math.max(Number(bill.exchangeCashReturn || 0), 0), gross),
    );
    const credit = Math.max(gross - cashReturn, 0);
    const extraExchange = round2(Math.max(credit - bill.grandTotal, 0));
    const amount = round2(cashReturn + extraExchange);
    if (amount <= 0) continue;
    items.push({
      id: bill.id,
      billId: bill.id,
      invoiceNumber: bill.invoiceNumber,
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      date: bill.billDate.toISOString(),
      reason: "EXCHANGE",
      cashReturn,
      extraExchange,
      amount,
      method: null,
      detail: bill.exchangeModel ? `Exchange: ${bill.exchangeModel}` : "Exchange",
    });
  }

  const billIds = [
    ...new Set(returns.map((r) => r.billId).filter((id): id is string => Boolean(id))),
  ];
  const returnBills = new Map(
    (
      await prisma.bill.findMany({
        where: { id: { in: billIds } },
        select: { id: true, withGst: true, customerPhone: true },
      })
    ).map((b) => [b.id, b]),
  );
  for (const r of returns) {
    const bill = r.billId ? returnBills.get(r.billId) : undefined;
    if (bill?.withGst) continue;
    items.push({
      id: r.id,
      // Link only to bills that still exist.
      billId: bill ? bill.id : null,
      invoiceNumber: r.invoiceNumber ?? "—",
      customerName: r.customerName ?? "—",
      customerPhone: bill?.customerPhone ?? "",
      date: r.createdAt.toISOString(),
      reason: "RETURN",
      cashReturn: 0,
      extraExchange: 0,
      amount: round2(Number(r.refundAmount || 0)),
      method: r.refundMethod === "online" ? "online" : "cash",
      detail: `Returned: ${r.stockItem.mobileName}`,
    });
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  return {
    count: items.length,
    totalAmount: round2(items.reduce((sum, item) => sum + item.amount, 0)),
    items,
  };
}

export function payoutReasonLabel(item: CustomerPayout) {
  if (item.reason === "RETURN") return "Return refund";
  if (item.cashReturn > 0 && item.extraExchange > 0) {
    return "Exchange cash return + extra value";
  }
  return item.cashReturn > 0 ? "Exchange cash return" : "Extra exchange value";
}

/* ------------------------------------------------------------------ PDF -- */

const PAGE = { width: 595.28, height: 841.89 };
const M = 32;
const W = PAGE.width - M * 2;
const FOOTER_H = 34;
const PAD = 5;
const AMBER = "#B45309";
const SHADE = "#FAF7F0";

const COLS = [
  { label: "Date", width: 64, align: "left" },
  { label: "Customer", width: 130, align: "left" },
  { label: "Bill", width: 70, align: "left" },
  { label: "Reason", width: 150, align: "left" },
  { label: "Amount", width: W - 64 - 130 - 70 - 150, align: "right" },
] as const;

type Payouts = Awaited<ReturnType<typeof loadCustomerPayouts>>;

function day(date: Date) {
  return format(date, "dd MMM yyyy");
}

function rupees(amount: number) {
  return `Rs. ${money(amount)}`;
}

function reasonDetail(item: CustomerPayout) {
  const parts = [item.detail];
  if (item.reason === "RETURN" && item.method) {
    parts.push(item.method === "online" ? "Paid online" : "Paid in cash");
  }
  if (item.cashReturn > 0 && item.extraExchange > 0) {
    parts.push(`Cash return ${money(item.cashReturn)} + extra ${money(item.extraExchange)}`);
  }
  return parts.join("\n");
}

export async function buildCustomerPayoutsPdf(
  payouts: Payouts,
  periodLabel: string,
) {
  const pdf = await renderPayouts(payouts, periodLabel);
  return {
    pdf,
    filename: `Money-given-to-customers-${format(new Date(), "yyyy-MM-dd")}.pdf`,
  };
}

function drawHeader(doc: PDFKit.PDFDocument, periodLabel: string) {
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
    .text("MONEY GIVEN TO CUSTOMERS", M, 28, { width: W, align: "right", characterSpacing: 0.6 });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(periodLabel, M, 47, { width: W, align: "right" });

  doc.moveTo(M, 82).lineTo(PAGE.width - M, 82).strokeColor(COLORS.charcoal).lineWidth(1).stroke();
  return 94;
}

function drawSummary(doc: PDFKit.PDFDocument, y: number, payouts: Payouts) {
  const exchange = payouts.items.filter((i) => i.reason === "EXCHANGE");
  const returns = payouts.items.filter((i) => i.reason === "RETURN");
  const sum = (rows: CustomerPayout[]) => rows.reduce((s, r) => s + r.amount, 0);
  const boxes = [
    {
      label: `Total given · ${payouts.count}`,
      value: rupees(payouts.totalAmount),
      fill: "#FEF3E2",
      color: AMBER,
    },
    {
      label: `Exchange · ${exchange.length}`,
      value: rupees(sum(exchange)),
      fill: "#F4F4F5",
      color: COLORS.ink,
    },
    {
      label: `Return refunds · ${returns.length}`,
      value: rupees(sum(returns)),
      fill: "#F4F4F5",
      color: COLORS.ink,
    },
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

function rowHeight(doc: PDFKit.PDFDocument, item: CustomerPayout) {
  const customerW = COLS[1].width - PAD * 2;
  const reasonW = COLS[3].width - PAD * 2;
  doc.font(FONT.semibold).fontSize(8.5);
  const customer = doc.heightOfString(item.customerName, { width: customerW });
  const reason = doc.heightOfString(payoutReasonLabel(item), { width: reasonW });
  doc.font(FONT.regular).fontSize(7.5);
  const phone = item.customerPhone
    ? 2 + doc.heightOfString(item.customerPhone, { width: customerW })
    : 0;
  const detail = 2 + doc.heightOfString(reasonDetail(item), { width: reasonW });
  return Math.max(customer + phone, reason + detail, 10) + 12;
}

function drawRow(doc: PDFKit.PDFDocument, y: number, item: CustomerPayout, shaded: boolean) {
  const h = rowHeight(doc, item);
  if (shaded) doc.rect(M, y, W, h).fill(SHADE);
  const top = y + 6;
  const offset = (i: number) => M + COLS.slice(0, i).reduce((s, c) => s + c.width, 0);
  const cellW = (i: number) => COLS[i].width - PAD * 2;

  doc.font(FONT.regular).fontSize(8.5).fillColor(COLORS.ink)
    .text(day(new Date(item.date)), offset(0) + PAD, top, { width: cellW(0), lineBreak: false });

  doc.font(FONT.semibold).fontSize(8.5).fillColor(COLORS.ink)
    .text(item.customerName, offset(1) + PAD, top, { width: cellW(1) });
  if (item.customerPhone) {
    doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.muted)
      .text(item.customerPhone, offset(1) + PAD, doc.y + 2, { width: cellW(1) });
  }

  doc.font(FONT.medium).fontSize(8.5).fillColor(COLORS.ink)
    .text(item.invoiceNumber, offset(2) + PAD, top, { width: cellW(2), lineBreak: false });

  doc.font(FONT.semibold).fontSize(8.5).fillColor(COLORS.ink)
    .text(payoutReasonLabel(item), offset(3) + PAD, top, { width: cellW(3) });
  doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.muted)
    .text(reasonDetail(item), offset(3) + PAD, doc.y + 2, { width: cellW(3) });

  doc.font(FONT.bold).fontSize(8.5).fillColor(AMBER)
    .text(money(item.amount), offset(4) + PAD, top, { width: cellW(4), align: "right", lineBreak: false });

  doc.moveTo(M, y + h).lineTo(M + W, y + h).strokeColor("#E7E2D6").lineWidth(0.5).stroke();
  return y + h;
}

function drawTotals(doc: PDFKit.PDFDocument, y: number, payouts: Payouts) {
  const h = 24;
  doc.rect(M, y, W, h).fill(COLORS.goldSoft);
  doc.font(FONT.bold).fontSize(9).fillColor(COLORS.ink);
  doc.text(`Total (${payouts.count})`, M + PAD, y + 8, { lineBreak: false });
  doc.fillColor(AMBER).text(money(payouts.totalAmount), M + PAD, y + 8, {
    width: W - PAD * 2,
    align: "right",
    lineBreak: false,
  });
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
      .text("Shop bills only (GST invoices not included)", M, y, { width: W - 120, lineBreak: false })
      .text(`Generated ${generated}  ·  Page ${i - range.start + 1} of ${range.count}`, M, y, {
        width: W,
        align: "right",
        lineBreak: false,
      });
  }
}

function renderPayouts(payouts: Payouts, periodLabel: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      bufferPages: true,
      info: {
        Title: `Money given to customers — ${periodLabel}`,
        Author: shop.name,
        Subject: "Money given to customers",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    let y = drawHeader(doc, periodLabel);
    y = drawSummary(doc, y, payouts);

    const bottom = PAGE.height - FOOTER_H - 8;
    y = drawTableHeader(doc, y);
    if (payouts.items.length === 0) {
      doc.font(FONT.regular).fontSize(9).fillColor(COLORS.muted)
        .text("No money was given to customers in this period.", M, y + 14, { width: W, align: "center" });
      y += 40;
    }
    payouts.items.forEach((item, index) => {
      if (y + rowHeight(doc, item) > bottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = drawTableHeader(doc, M);
      }
      y = drawRow(doc, y, item, index % 2 === 1);
    });
    if (y + 24 > bottom) {
      doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      y = M;
    }
    drawTotals(doc, y, payouts);

    drawFooters(doc);
    doc.end();
  });
}
