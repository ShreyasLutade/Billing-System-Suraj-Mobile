import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import type { Bill, BillItem } from "@prisma/client";
import { format } from "date-fns";

type BillWithItems = Bill & { items: BillItem[] };

const COLORS = {
  navy: "#0C2A4A",
  navyDeep: "#081E36",
  gold: "#E8A317",
  goldSoft: "#F2C14E",
  ink: "#1A2433",
  muted: "#5B6B7C",
  line: "#C9D2DE",
  soft: "#F5F7FA",
  white: "#FFFFFF",
  danger: "#B91C1C",
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
  gstin: process.env.SHOP_GSTIN || "",
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 28;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const ICON_PATH = path.join(__dirname, "../../assets/suraj_mobile_icon.png");
const LOGO_PATH = path.join(__dirname, "../../assets/suraj_mobile_logo.png");

/** Helvetica has no ₹ glyph — use ASCII-safe Rs. prefix */
function inr(amount: number) {
  return `Rs. ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amount)}`;
}

function inrSlash(amount: number) {
  return `Rs. ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(Math.round(amount))}/-`;
}

function drawCheckbox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  checked: boolean,
) {
  doc
    .roundedRect(x, y, 9, 9, 1.5)
    .strokeColor(COLORS.navy)
    .lineWidth(1)
    .stroke();
  if (checked) {
    doc
      .moveTo(x + 2, y + 4.5)
      .lineTo(x + 3.8, y + 6.5)
      .lineTo(x + 7, y + 2.5)
      .strokeColor(COLORS.navy)
      .lineWidth(1.3)
      .stroke();
  }
}

function drawInstagramIcon(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size = 8,
  color = "#B8C9DB",
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

function drawPhoneIcon(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  size = 8,
  color = "#B8C9DB",
) {
  // Simple upright phone outline
  doc
    .roundedRect(x + size * 0.22, y, size * 0.56, size, size * 0.12)
    .strokeColor(color)
    .lineWidth(0.9)
    .stroke();
  doc
    .moveTo(x + size * 0.38, y + size * 0.12)
    .lineTo(x + size * 0.62, y + size * 0.12)
    .strokeColor(color)
    .lineWidth(0.85)
    .stroke();
  doc
    .circle(x + size / 2, y + size * 0.82, size * 0.07)
    .fillColor(color)
    .fill();
}

function drawHeader(doc: PDFKit.PDFDocument) {
  const headerH = 92;
  const logoBox = 72;
  const logoY = (headerH - logoBox) / 2;

  doc.rect(0, 0, PAGE.width, headerH).fill(COLORS.navy);
  doc
    .save()
    .opacity(0.08)
    .circle(PAGE.width - 30, 10, 60)
    .fill(COLORS.white)
    .restore();

  const logoFile = fs.existsSync(ICON_PATH)
    ? ICON_PATH
    : fs.existsSync(LOGO_PATH)
      ? LOGO_PATH
      : null;

  if (logoFile) {
    doc.image(logoFile, MARGIN, logoY, {
      fit: [logoBox, logoBox],
      align: "center",
      valign: "center",
    });
  }

  const textX = MARGIN + logoBox + 12;
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(20)
    .text(shop.name.toUpperCase(), textX, 16, {
      width: PAGE.width - textX - MARGIN,
    });

  doc
    .fillColor(COLORS.goldSoft)
    .font("Helvetica")
    .fontSize(8.5)
    .text(shop.tagline, textX, 40, {
      width: PAGE.width - textX - MARGIN,
    });

  doc
    .fillColor("#D7E3F0")
    .fontSize(7.5)
    .text(shop.address, textX, 54, {
      width: PAGE.width - textX - MARGIN,
    });

  // Contact row with Instagram + phone icons
  let cx = textX;
  const cy = 69;
  const iconColor = "#B8C9DB";
  doc.fillColor(iconColor).font("Helvetica").fontSize(7.5);

  if (shop.instagram) {
    drawInstagramIcon(doc, cx, cy, 8, iconColor);
    cx += 11;
    doc.text(shop.instagram, cx, cy, { lineBreak: false });
    cx += doc.widthOfString(shop.instagram) + 10;
  }

  if (shop.phone) {
    if (shop.instagram) {
      doc
        .fillColor(iconColor)
        .fontSize(7.5)
        .text("·", cx, cy, { lineBreak: false });
      cx += 8;
    }
    drawPhoneIcon(doc, cx, cy, 8, iconColor);
    cx += 11;
    doc
      .fillColor(iconColor)
      .font("Helvetica")
      .fontSize(7.5)
      .text(shop.phone, cx, cy, { lineBreak: false });
    cx += doc.widthOfString(shop.phone) + 10;
  }

  if (shop.gstin) {
    if (shop.instagram || shop.phone) {
      doc.text("·", cx, cy, { lineBreak: false });
      cx += 8;
    }
    doc.text(`GSTIN ${shop.gstin}`, cx, cy, { lineBreak: false });
  }

  doc.rect(0, headerH, PAGE.width, 3).fill(COLORS.gold);
  return headerH + 3;
}

function drawFooter(doc: PDFKit.PDFDocument, y: number) {
  doc
    .moveTo(MARGIN, y)
    .lineTo(PAGE.width - MARGIN, y)
    .strokeColor(COLORS.gold)
    .lineWidth(2)
    .stroke();

  y += 8;

  doc
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text("Terms & Conditions", MARGIN, y);

  const terms = [
    "1. Goods Once Sold Shall Not be taken back, Exchanged or Refunded.",
    "2. Term & Condition of Warranty & Insurance will be provided to you by the company.",
    "3. To Get Warranty Cover, Customer will have to take the Mobile to Service Center.",
    "4. The Customer has inspected the mobile device at the time of purchase. The shopkeeper will not be held responsible for any issues thereafter.",
  ];

  y += 10;
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(6.5);
  for (const term of terms) {
    doc.text(term, MARGIN, y, { width: CONTENT_WIDTH, lineBreak: false });
    y += 9;
  }

  const barY = PAGE.height - 16;
  doc.rect(0, barY, PAGE.width, 16).fill(COLORS.navyDeep);
  doc.rect(0, barY - 2, PAGE.width, 2).fill(COLORS.gold);
  doc
    .fillColor("#D7E3F0")
    .fontSize(6.5)
    .text("Thank you for shopping with Suraj Mobile", 0, barY + 4, {
      width: PAGE.width,
      align: "center",
      lineBreak: false,
    });
}

function drawDetailTable(
  doc: PDFKit.PDFDocument,
  y: number,
  title: string,
  rows: Array<{ label: string; value: string }>,
  qty: string,
  amount: string,
) {
  const colQty = MARGIN + 350;
  const colAmt = MARGIN + 415;
  const tableW = CONTENT_WIDTH;
  const detailW = 350;
  const qtyW = 65;
  const amtW = tableW - detailW - qtyW;
  const headerH = 18;
  const rowH = 15;

  doc.rect(MARGIN, y, tableW, headerH).fill(COLORS.navy);
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(title, MARGIN + 6, y + 5, {
      width: detailW - 10,
      lineBreak: false,
    })
    .text("Qty", colQty, y + 5, {
      width: qtyW,
      align: "center",
      lineBreak: false,
    })
    .text("Amount", colAmt, y + 5, {
      width: amtW - 6,
      align: "right",
      lineBreak: false,
    });

  y += headerH;
  const bodyH = rows.length * rowH;

  doc
    .rect(MARGIN, y, tableW, bodyH)
    .strokeColor(COLORS.line)
    .lineWidth(0.8)
    .stroke();
  doc
    .moveTo(colQty, y)
    .lineTo(colQty, y + bodyH)
    .moveTo(colAmt, y)
    .lineTo(colAmt, y + bodyH)
    .stroke();

  rows.forEach((row, index) => {
    const rowY = y + index * rowH;
    if (index > 0) {
      doc
        .moveTo(MARGIN, rowY)
        .lineTo(MARGIN + tableW, rowY)
        .strokeColor(COLORS.line)
        .stroke();
    }

    doc
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(row.label, MARGIN + 6, rowY + 4, {
        width: 72,
        lineBreak: false,
      });

    doc
      .fillColor(COLORS.ink)
      .font("Helvetica")
      .fontSize(8)
      .text(row.value || "—", MARGIN + 80, rowY + 3.5, {
        width: detailW - 88,
        lineBreak: false,
      });

    if (index === 0) {
      doc
        .font("Helvetica-Bold")
        .text(qty, colQty, rowY + 3.5, {
          width: qtyW,
          align: "center",
          lineBreak: false,
        })
        .text(amount, colAmt, rowY + 3.5, {
          width: amtW - 6,
          align: "right",
          lineBreak: false,
        });
    }
  });

  return y + bodyH + 8;
}

export function buildInvoicePdf(bill: BillWithItems): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      autoFirstPage: true,
      info: {
        Title: `Invoice ${bill.invoiceNumber}`,
        Author: shop.name,
        Subject: "Tax Invoice",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = drawHeader(doc) + 10;

    const metaW = 124;
    const metaX = PAGE.width - MARGIN - metaW;
    const customerW = CONTENT_WIDTH - metaW - 12;

    doc
      .roundedRect(metaX, y, metaW, 46, 5)
      .strokeColor(COLORS.navy)
      .lineWidth(1)
      .stroke();

    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(7)
      .text("Sr. No.", metaX + 6, y + 4, { lineBreak: false });

    doc
      .fillColor(COLORS.danger)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(bill.invoiceNumber, metaX + 6, y + 14, {
        width: metaW - 12,
        lineBreak: false,
      });

    doc
      .moveTo(metaX, y + 26)
      .lineTo(metaX + metaW, y + 26)
      .strokeColor(COLORS.line)
      .lineWidth(0.8)
      .stroke();

    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(7)
      .text("Date", metaX + 6, y + 29, { lineBreak: false });

    doc
      .fillColor(COLORS.ink)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(format(bill.billDate, "dd MMM yyyy"), metaX + 6, y + 37, {
        width: metaW - 12,
        lineBreak: false,
      });

    const field = (label: string, value: string, fy: number) => {
      doc
        .fillColor(COLORS.muted)
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(label, MARGIN, fy, { width: 68, lineBreak: false });
      doc
        .fillColor(COLORS.ink)
        .font("Helvetica")
        .fontSize(9)
        .text(value, MARGIN + 70, fy - 1, {
          width: customerW - 70,
          lineBreak: false,
        });
      doc
        .moveTo(MARGIN + 70, fy + 10)
        .lineTo(MARGIN + customerW, fy + 10)
        .strokeColor(COLORS.line)
        .lineWidth(0.7)
        .stroke();
    };

    field("Name", bill.customerName, y + 1);
    field("Contact No.", bill.customerPhone, y + 18);
    field("Address", bill.customerAddress || "—", y + 35);

    y += 56;

    for (const item of bill.items) {
      const rows = [
        {
          label: "Model",
          value: [item.productName, item.color, item.storage, item.ram]
            .filter(Boolean)
            .join(" · "),
        },
        {
          label: "IMEI Number",
          value: item.imei1 || "—",
        },
      ];
      if (item.serialNumber) {
        rows.push({ label: "Serial", value: item.serialNumber });
      }
      if (item.gstPercent > 0) {
        rows.push({
          label: "GST",
          value: `${item.gstPercent}% (incl.)`,
        });
      }

      y = drawDetailTable(
        doc,
        y,
        "Phone Detail (Sale)",
        rows,
        String(item.quantity),
        inrSlash(item.amount),
      );
    }

    if (bill.isExchange) {
      const exchangeRows = [
        { label: "Model", value: bill.exchangeModel || "—" },
        {
          label: "IMEI Number",
          value: bill.exchangeImei1 || "—",
        },
      ];
      if (bill.exchangeSerial) {
        exchangeRows.push({ label: "Serial", value: bill.exchangeSerial });
      }

      y = drawDetailTable(
        doc,
        y,
        "Exchange",
        exchangeRows,
        bill.exchangeModel ? "1" : "—",
        bill.exchangeValue != null ? `− ${inrSlash(bill.exchangeValue)}` : "—",
      );
    }

    const payY = y;
    const payW = 290;
    const totalBoxX = MARGIN + payW + 14;
    const totalBoxW = CONTENT_WIDTH - payW - 14;

    const payments: Array<{ label: string; amount: number; note?: string }> = [
      { label: "Cash Amount", amount: bill.cashAmount },
      { label: "Online Amount", amount: bill.onlineAmount },
    ];

    if (bill.financeAmount2 && bill.financeAmount2 > 0) {
      payments.push({
        label: "Finance Amount",
        amount: Math.max(bill.financeAmount - bill.financeAmount2, 0),
        note: bill.financeCompanyName || undefined,
      });
      payments.push({
        label: "Finance Amount",
        amount: bill.financeAmount2,
        note: bill.financeCompanyName2 || undefined,
      });
    } else {
      payments.push({
        label: "Finance Amount",
        amount: bill.financeAmount,
        note: bill.financeCompanyName || undefined,
      });
    }

    payments.push({ label: "Pending Amount", amount: bill.dueAmount });

    payments.forEach((p, i) => {
      const rowY = payY + i * 15;
      drawCheckbox(doc, MARGIN, rowY + 1, p.amount > 0);
      doc
        .fillColor(COLORS.ink)
        .font("Helvetica")
        .fontSize(8)
        .text(p.label, MARGIN + 14, rowY, { width: 100, lineBreak: false });

      const detail =
        p.amount > 0
          ? `${inr(p.amount)}${p.note ? ` (${p.note})` : ""}`
          : "—";
      doc
        .fillColor(p.amount > 0 ? COLORS.ink : COLORS.muted)
        .font(p.amount > 0 ? "Helvetica-Bold" : "Helvetica")
        .text(detail, MARGIN + 116, rowY, {
          width: payW - 116,
          lineBreak: false,
        });
    });

    let afterPayY = payY + payments.length * 15;
    if (bill.dueAmount > 0 && bill.dueDate) {
      doc
        .fillColor(COLORS.muted)
        .font("Helvetica")
        .fontSize(7)
        .text(
          `Expected by ${format(bill.dueDate, "dd MMM yyyy")}`,
          MARGIN + 14,
          afterPayY + 1,
          { lineBreak: false },
        );
      afterPayY += 12;
    }

    doc.rect(totalBoxX, payY, totalBoxW, 18).fill(COLORS.navy);
    doc
      .fillColor(COLORS.white)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("Total Amount In Rupees", totalBoxX, payY + 5, {
        width: totalBoxW,
        align: "center",
        lineBreak: false,
      });

    doc
      .rect(totalBoxX, payY + 18, totalBoxW, 40)
      .strokeColor(COLORS.navy)
      .lineWidth(1)
      .stroke();

    const payable = bill.payableAmount ?? bill.grandTotal;
    doc
      .fillColor(COLORS.navy)
      .font("Helvetica-Bold")
      .fontSize(15)
      .text(inr(payable), totalBoxX + 6, payY + 28, {
        width: totalBoxW - 12,
        align: "center",
        lineBreak: false,
      });

    let summaryY = Math.max(afterPayY, payY + 64) + 6;
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7);
    doc.text(
      `Taxable ${inr(bill.subtotal)}  ·  GST ${inr(bill.gstAmount)}  ·  Gross ${inr(bill.grandTotal)}`,
      MARGIN,
      summaryY,
      { width: CONTENT_WIDTH, align: "left", lineBreak: false },
    );
    summaryY += 12;

    if (bill.notes) {
      doc
        .fillColor(COLORS.ink)
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(`Notes: `, MARGIN, summaryY, { continued: true, lineBreak: false });
      doc
        .fillColor(COLORS.muted)
        .font("Helvetica")
        .text(bill.notes, { width: CONTENT_WIDTH - 40, lineBreak: false });
      summaryY += 12;
    }

    drawFooter(doc, summaryY + 6);

    doc.end();
  });
}
