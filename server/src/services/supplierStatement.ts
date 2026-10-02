import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { format } from "date-fns";
import { prisma } from "../lib/prisma";
import { COLORS, FONT, drawShopLogo, money, registerFonts, shop } from "./pdf";

/**
 * Supplier statement (account ledger) as an A4 PDF.
 *
 * Purchases are credits to the supplier's account (what we owe goes up);
 * payments are debits (what we owe goes down). The running balance is what
 * we still owe, and the closing balance matches the supplier's outstanding.
 */

type Entry = {
  date: Date;
  kind: "purchase" | "payment";
  particulars: string;
  detail: string;
  qty: number | null;
  credit: number;
  debit: number;
  /** Purchase entries: the purchase id. */
  purchaseId?: string;
  /** Payment made at purchase: the purchase it belongs under. */
  paidFor?: string;
};

const PAGE = { width: 595.28, height: 841.89 };
const M = 32;
const W = PAGE.width - M * 2;
const FOOTER_H = 34;

/** Column layout (widths add up to W). */
const COLS = [
  { key: "date", label: "Date", width: 64, align: "left" },
  { key: "particulars", label: "Particulars", width: 205, align: "left" },
  { key: "qty", label: "Qty", width: 34, align: "right" },
  { key: "credit", label: "Purchased (Cr)", width: 80, align: "right" },
  { key: "debit", label: "Paid (Dr)", width: 76, align: "right" },
  { key: "balance", label: "Balance due", width: W - 64 - 205 - 34 - 80 - 76, align: "right" },
] as const;
const PAD = 5;
const GREEN = "#0B7A5B";
const RED = "#BE123C";
const SHADE = "#FAF7F0";

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rupees(amount: number) {
  return `Rs. ${money(amount)}`;
}

function day(date: Date) {
  return format(date, "dd MMM yyyy");
}

function purchaseKind(note: string | null, condition: string) {
  if (note?.startsWith("RETURN_INVOICE:")) return "Return";
  if (note?.startsWith("EXCHANGE_INVOICE:")) return "Exchange";
  if (note === "ACCESSORIES") return "Accessories";
  return condition === "USED" ? "Second hand" : "New";
}

/** "iPhone 15 128 GB × 2, Redmi 13C" — what came in on a purchase. */
function itemsSummary(
  items: Array<{ mobileName: string; storage: string | null }>,
) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = [item.mobileName, item.storage].filter(Boolean).join(" ").trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => (count > 1 ? `${label} × ${count}` : label))
    .join(", ");
}

export async function buildSupplierStatement(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      purchases: {
        include: {
          items: {
            select: {
              stockItem: { select: { mobileName: true, storage: true } },
            },
          },
        },
        orderBy: [{ purchaseDate: "asc" }, { createdAt: "asc" }],
      },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  if (!supplier) return null;

  const entries: Entry[] = [];
  let paidOnPurchases = 0;
  for (const p of supplier.purchases) {
    const total = p.totalAmount || 0;
    paidOnPurchases += p.paidAt ? total : Math.min(p.paidAmount || 0, total);
    entries.push({
      date: p.purchaseDate,
      kind: "purchase",
      particulars: `Purchase · ${purchaseKind(p.note, p.condition)}`,
      detail: itemsSummary(p.items.map((i) => i.stockItem)),
      qty: p.items.length,
      credit: total,
      debit: 0,
      purchaseId: p.id,
    });
  }

  let recorded = 0;
  for (const pay of supplier.payments) {
    recorded += pay.amount;
    // Paid while entering the purchase (Fully paid / Custom paid).
    const atPurchase = Boolean(pay.purchaseId);
    entries.push({
      date: pay.paidAt,
      kind: "payment",
      particulars: atPurchase ? "Paid at purchase" : "Payment",
      detail: atPurchase
        ? (pay.note || "").replace(/ at purchase$/, "")
        : pay.note || "",
      qty: null,
      credit: 0,
      debit: pay.amount,
      paidFor: pay.purchaseId ?? undefined,
    });
  }

  // Payments made with the per-purchase "Mark paid" only exist on the
  // purchases themselves. Show that part against the purchase it cleared,
  // dated when it was paid.
  let unrecorded = round2(paidOnPurchases - recorded);
  if (unrecorded > 0.005) {
    // Earliest-paid purchases first: those are the ones paid before payments
    // were recorded (later ones were cleared by recorded payments).
    const byPaidDate = [...supplier.purchases].sort(
      (a, b) =>
        (a.paidAt ?? a.updatedAt).getTime() - (b.paidAt ?? b.updatedAt).getTime(),
    );
    for (const p of byPaidDate) {
      if (unrecorded <= 0.005) break;
      const total = p.totalAmount || 0;
      const paid = p.paidAt ? total : Math.min(p.paidAmount || 0, total);
      if (paid <= 0) continue;
      const amount = round2(Math.min(paid, unrecorded));
      unrecorded = round2(unrecorded - amount);
      entries.push({
        date: p.paidAt ?? p.updatedAt,
        kind: "payment",
        particulars: "Payment",
        detail: `Against purchase of ${day(p.purchaseDate)}`,
        qty: null,
        credit: 0,
        debit: amount,
      });
    }
  }

  // Oldest first; on the same moment a purchase comes before its payment.
  entries.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      (a.kind === b.kind ? 0 : a.kind === "purchase" ? -1 : 1),
  );
  // A payment made at purchase goes right under its own purchase.
  const tied = entries.filter((e) => e.paidFor);
  const ordered = entries.flatMap((e) => {
    if (e.paidFor) return [];
    return e.purchaseId ? [e, ...tied.filter((t) => t.paidFor === e.purchaseId)] : [e];
  });
  entries.splice(0, entries.length, ...ordered);

  const totalCredit = round2(entries.reduce((s, e) => s + e.credit, 0));
  const totalDebit = round2(entries.reduce((s, e) => s + e.debit, 0));
  const pdf = await renderStatement({
    name: supplier.name,
    phone: supplier.phone,
    entries,
    totalCredit,
    totalDebit,
  });
  const safeName = supplier.name.replace(/[^\w.-]+/g, "_").slice(0, 40) || "supplier";
  return {
    pdf,
    filename: `Statement-${safeName}-${format(new Date(), "yyyy-MM-dd")}.pdf`,
  };
}

function drawHeader(doc: PDFKit.PDFDocument) {
  const logoW = 44;
  drawShopLogo(doc, M, 18, logoW, 54);
  const x = M + logoW + 12;

  // Shop name like the invoice: first word charcoal, the rest gold.
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
    .text("SUPPLIER STATEMENT", M, 28, { width: W, align: "right", characterSpacing: 0.6 });
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(`As of ${day(new Date())}`, M, 47, { width: W, align: "right" });

  doc.moveTo(M, 82).lineTo(PAGE.width - M, 82).strokeColor(COLORS.charcoal).lineWidth(1).stroke();
  return 94;
}

function drawSupplierAndSummary(
  doc: PDFKit.PDFDocument,
  y: number,
  data: {
    name: string;
    phone: string | null;
    entries: Entry[];
    totalCredit: number;
    totalDebit: number;
  },
) {
  const first = data.entries[0]?.date;
  const period = first ? `${day(first)} – ${day(new Date())}` : "No transactions yet";

  doc.font(FONT.medium).fontSize(8).fillColor(COLORS.muted).text("SUPPLIER", M, y, { characterSpacing: 0.8 });
  doc.font(FONT.bold).fontSize(14).fillColor(COLORS.ink).text(data.name, M, y + 11, { width: W / 2 });
  doc
    .font(FONT.regular)
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(
      [data.phone ? `Ph: ${data.phone}` : null, `Period: ${period}`].filter(Boolean).join("   ·   "),
      M,
      doc.y + 2,
      { width: W / 2 + 60 },
    );
  y = Math.max(doc.y, y + 40) + 12;

  const balance = round2(data.totalCredit - data.totalDebit);
  const boxes = [
    { label: "Total purchased", value: data.totalCredit, fill: "#F4F4F5", color: COLORS.ink },
    { label: "Total paid", value: data.totalDebit, fill: "#E7F8F1", color: GREEN },
    balance > 0.005
      ? { label: "Balance due", value: balance, fill: "#FFF1F2", color: RED }
      : balance < -0.005
        ? { label: "Paid in advance", value: -balance, fill: COLORS.goldSoft, color: COLORS.gold }
        : { label: "Settled", value: 0, fill: "#E7F8F1", color: GREEN },
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
    doc.font(FONT.bold).fontSize(12).fillColor(box.color).text(rupees(box.value), bx + 12, y + 24, {
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

function rowHeight(doc: PDFKit.PDFDocument, entry: Entry) {
  const width = COLS[1].width - PAD * 2;
  doc.font(FONT.semibold).fontSize(8.5);
  let h = doc.heightOfString(entry.particulars, { width });
  if (entry.detail) {
    doc.font(FONT.regular).fontSize(7.5);
    h += 2 + doc.heightOfString(entry.detail, { width });
  }
  return Math.max(h, 10) + 12;
}

function drawRow(
  doc: PDFKit.PDFDocument,
  y: number,
  entry: Entry,
  balance: number,
  shaded: boolean,
) {
  const h = rowHeight(doc, entry);
  if (shaded) doc.rect(M, y, W, h).fill(SHADE);
  const top = y + 6;
  let x = M;
  const cell = (index: number, text: string, font: string, size: number, color: string) => {
    const col = COLS[index];
    doc.font(font).fontSize(size).fillColor(color).text(text, x + PAD, top, {
      width: col.width - PAD * 2,
      align: col.align,
      lineBreak: false,
    });
  };

  cell(0, day(entry.date), FONT.regular, 8.5, COLORS.ink);
  x += COLS[0].width;

  const pw = COLS[1].width - PAD * 2;
  doc
    .font(FONT.semibold)
    .fontSize(8.5)
    .fillColor(entry.kind === "payment" ? GREEN : COLORS.ink);
  doc.text(entry.particulars, x + PAD, top, { width: pw });
  if (entry.detail) {
    doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.muted).text(entry.detail, x + PAD, doc.y + 2, { width: pw });
  }
  x += COLS[1].width;

  cell(2, entry.qty === null ? "" : String(entry.qty), FONT.regular, 8.5, COLORS.ink);
  x += COLS[2].width;
  cell(3, entry.credit ? money(entry.credit) : "", FONT.medium, 8.5, COLORS.ink);
  x += COLS[3].width;
  cell(4, entry.debit ? money(entry.debit) : "", FONT.medium, 8.5, GREEN);
  x += COLS[4].width;
  cell(
    5,
    balance < -0.005 ? `${money(-balance)} Cr` : money(balance),
    FONT.bold,
    8.5,
    balance > 0.005 ? COLORS.ink : balance < -0.005 ? COLORS.gold : GREEN,
  );

  doc.moveTo(M, y + h).lineTo(M + W, y + h).strokeColor("#E7E2D6").lineWidth(0.5).stroke();
  return y + h;
}

function drawTotals(doc: PDFKit.PDFDocument, y: number, credit: number, debit: number) {
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
  const balance = round2(credit - debit);
  put(3, money(credit), COLORS.ink);
  put(4, money(debit), GREEN);
  put(
    5,
    balance < -0.005 ? `${money(-balance)} Cr` : money(balance),
    balance > 0.005 ? RED : balance < -0.005 ? COLORS.gold : GREEN,
  );
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
      .text(
        "Cr = stock received (adds to what we owe).  Dr = payment made to the supplier.",
        M,
        y,
        { width: W - 120, lineBreak: false },
      )
      .text(`Generated ${generated}  ·  Page ${i - range.start + 1} of ${range.count}`, M, y, {
        width: W,
        align: "right",
        lineBreak: false,
      });
  }
}

function renderStatement(data: {
  name: string;
  phone: string | null;
  entries: Entry[];
  totalCredit: number;
  totalDebit: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      bufferPages: true,
      info: {
        Title: `Supplier statement — ${data.name}`,
        Author: shop.name,
        Subject: "Supplier statement",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    let y = drawHeader(doc);
    y = drawSupplierAndSummary(doc, y, data);

    const bottom = PAGE.height - FOOTER_H - 8;
    y = drawTableHeader(doc, y);
    if (!data.entries.length) {
      doc
        .font(FONT.regular)
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text("No purchases or payments with this supplier yet.", M, y + 14, { width: W, align: "center" });
      y += 40;
    }

    let balance = 0;
    data.entries.forEach((entry, index) => {
      balance = round2(balance + entry.credit - entry.debit);
      if (y + rowHeight(doc, entry) > bottom) {
        doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
        y = drawTableHeader(doc, M);
      }
      y = drawRow(doc, y, entry, balance, index % 2 === 1);
    });

    if (y + 24 > bottom) {
      doc.addPage({ size: [PAGE.width, PAGE.height], margin: 0 });
      y = M;
    }
    drawTotals(doc, y, data.totalCredit, data.totalDebit);

    drawFooters(doc);
    doc.end();
  });
}
