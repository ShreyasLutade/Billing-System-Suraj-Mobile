import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import { format } from "date-fns";
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

/** Fields the slip needs (matches the repairs route select). */
export type RepairSlipJob = {
  jobNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  deviceName: string;
  platform: string;
  color: string | null;
  ram: string | null;
  storage: string | null;
  condition: string;
  conditionNotes: string | null;
  problemDescription: string;
  estimatedCost: number | null;
  finalCharge: number | null;
  status: string;
  outcome: string | null;
  repairNotes: string | null;
  repairedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
};

/** A5 portrait — half an A4 sheet, a common size for counter slips. */
const PAGE = { width: 419.53, height: 595.28 };
const M = 24;
const W = PAGE.width - M * 2;

const CONDITION_LABEL: Record<string, string> = {
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  DAMAGED: "Damaged",
  DEAD: "Dead",
};

const STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Received",
  REPAIRED: "Repaired",
  DELIVERED: "Delivered",
};

function rupees(amount: number) {
  return `Rs. ${money(amount)}`;
}

function when(date: Date) {
  return format(date, "d MMM yyyy, h:mm a");
}

function drawHeader(doc: PDFKit.PDFDocument) {
  const logo = 42;
  drawBabuLogo(doc, M, 20, logo);
  const x = M + logo + 10;

  // Same wordmark as the invoice: chubby dark name, NX on the baseline.
  const size = 18;
  const nameY = 17;
  const nameW = drawWordmarkText(doc, shop.name.toUpperCase(), x, nameY, size);
  if (shop.nameSuffix) {
    const small = 7.5;
    doc.font(FONT.display).fontSize(size);
    const baseline = nameY + ascenderOf(doc, size);
    doc.font(FONT.bold).fontSize(small).fillColor(COLORS.accent);
    doc.text(shop.nameSuffix.toUpperCase(), x + nameW + 4, baseline - ascenderOf(doc, small), {
      lineBreak: false,
    });
  }

  doc
    .font(FONT.regular)
    .fontSize(7.2)
    .fillColor(COLORS.ink)
    .text(shop.address, x, 44, { width: W - logo - 10, lineBreak: false });
  doc
    .font(FONT.bold)
    .fontSize(7.2)
    .text(
      [`Ph: ${shop.phone}`, shop.instagram].filter(Boolean).join("   ·   "),
      x,
      54,
      { lineBreak: false },
    );

  doc.moveTo(M, 72).lineTo(PAGE.width - M, 72).strokeColor(COLORS.slate).lineWidth(0.9).stroke();
  return 80;
}

function drawTitleBar(doc: PDFKit.PDFDocument, job: RepairSlipJob, y: number) {
  const h = 30;
  doc.roundedRect(M, y, W, h, 6).fill(COLORS.accentSoft);
  doc
    .fillColor(COLORS.slate)
    .font(FONT.bold)
    .fontSize(11)
    .text("REPAIR SLIP", M + 12, y + 9, { lineBreak: false, characterSpacing: 1.5 });
  doc
    .fillColor(COLORS.accent)
    .font(FONT.bold)
    .fontSize(13)
    .text(job.jobNumber, M, y + 8, { width: W - 12, align: "right", lineBreak: false });

  y += h + 6;
  doc.font(FONT.regular).fontSize(7.8).fillColor(COLORS.muted);
  doc.text(`Received: ${when(job.createdAt)}`, M, y, { lineBreak: false });
  const status =
    STATUS_LABEL[job.status] +
    (job.outcome ? ` · ${job.outcome === "FIXED" ? "Fixed" : "Not fixed"}` : "");
  doc
    .font(FONT.bold)
    .fillColor(COLORS.ink)
    .text(`Status: ${status}`, M, y, { width: W, align: "right", lineBreak: false });
  return y + 16;
}

/** Heading plus a bordered two-column box of label/value rows. */
function drawSection(
  doc: PDFKit.PDFDocument,
  title: string,
  rows: Array<[string, string]>,
  y: number,
) {
  doc.font(FONT.bold).fontSize(8).fillColor(COLORS.slate).text(title.toUpperCase(), M, y, {
    lineBreak: false,
    characterSpacing: 1,
  });
  y += 12;
  const labelW = 92;
  const rowH = 17;
  const top = y;
  rows.forEach(([label, value], index) => {
    const ry = top + index * rowH;
    if (index > 0) {
      doc.moveTo(M, ry).lineTo(M + W, ry).strokeColor("#DCE6F2").lineWidth(0.6).stroke();
    }
    doc.font(FONT.regular).fontSize(8).fillColor(COLORS.muted).text(label, M + 10, ry + 5, {
      width: labelW - 14,
      lineBreak: false,
      ellipsis: true,
    });
    doc.font(FONT.semibold).fontSize(8.4).fillColor(COLORS.ink).text(value || "—", M + labelW, ry + 4.5, {
      width: W - labelW - 10,
      lineBreak: false,
      ellipsis: true,
    });
  });
  const h = rows.length * rowH;
  doc.roundedRect(M, top, W, h, 6).strokeColor(COLORS.slate).lineWidth(0.8).stroke();
  return top + h + 12;
}

/** Heading plus a bordered box of wrapped text, capped so the slip stays one page. */
function drawTextBox(
  doc: PDFKit.PDFDocument,
  title: string,
  text: string,
  y: number,
  maxH: number,
) {
  doc.font(FONT.bold).fontSize(8).fillColor(COLORS.slate).text(title.toUpperCase(), M, y, {
    lineBreak: false,
    characterSpacing: 1,
  });
  y += 12;
  doc.font(FONT.regular).fontSize(8.6);
  const textH = Math.min(doc.heightOfString(text, { width: W - 20 }), maxH);
  const h = textH + 14;
  doc.roundedRect(M, y, W, h, 6).strokeColor(COLORS.slate).lineWidth(0.8).stroke();
  doc.fillColor(COLORS.ink).text(text, M + 10, y + 7, {
    width: W - 20,
    height: textH,
    ellipsis: true,
  });
  return y + h + 12;
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const lineY = PAGE.height - 48;
  doc
    .font(FONT.regular)
    .fontSize(7.6)
    .fillColor(COLORS.muted)
    .text("Please bring this slip when you collect your phone.", M, lineY - 26, {
      width: W,
      align: "center",
      lineBreak: false,
    });

  const sigW = 130;
  doc.moveTo(M, lineY).lineTo(M + sigW, lineY).strokeColor(COLORS.slate).lineWidth(0.7).stroke();
  doc
    .moveTo(PAGE.width - M - sigW, lineY)
    .lineTo(PAGE.width - M, lineY)
    .stroke();
  doc.font(FONT.regular).fontSize(7.4).fillColor(COLORS.muted);
  doc.text("Customer's signature", M, lineY + 4, { width: sigW, align: "center", lineBreak: false });
  doc.text(
    `For ${[shop.name, shop.nameSuffix].filter(Boolean).join(" ")}`,
    PAGE.width - M - sigW,
    lineY + 4,
    { width: sigW, align: "center", lineBreak: false },
  );
}

export function buildRepairSlipPdf(job: RepairSlipJob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      info: {
        Title: `Repair slip ${job.jobNumber}`,
        Author: shop.name,
        Subject: "Repair slip",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    let y = drawHeader(doc);
    y = drawTitleBar(doc, job, y);

    y = drawSection(
      doc,
      "Customer",
      [
        ["Name", job.customerName],
        ["Mobile", job.customerPhone],
        ["Location", job.customerAddress || ""],
      ],
      y,
    );

    const phoneRows: Array<[string, string]> = [
      ["Model", job.deviceName],
      ["System", job.platform === "IOS" ? "iOS" : "Android"],
      ["Colour", job.color || ""],
    ];
    // Older jobs recorded RAM / storage.
    if (job.ram || job.storage) {
      phoneRows.push(["RAM / Storage", [job.ram, job.storage].filter(Boolean).join(" / ")]);
    }
    // Older jobs recorded a condition; new intake no longer asks for it.
    if (job.condition) {
      phoneRows.push([
        "Condition",
        [CONDITION_LABEL[job.condition] || job.condition, job.conditionNotes]
          .filter(Boolean)
          .join(" — "),
      ]);
    }
    y = drawSection(doc, "Phone", phoneRows, y);

    y = drawTextBox(doc, "Problem", job.problemDescription || "—", y, 44);

    const charges: Array<[string, string]> = [
      [
        "Estimate",
        job.estimatedCost != null ? rupees(job.estimatedCost) : "To be confirmed",
      ],
    ];
    if (job.outcome) {
      charges.push(["Result", job.outcome === "FIXED" ? "Fixed" : "Could not be fixed"]);
    }
    if (job.finalCharge != null) charges.push(["Final charge", rupees(job.finalCharge)]);
    if (job.deliveredAt) charges.push(["Delivered", when(job.deliveredAt)]);
    y = drawSection(doc, job.outcome ? "Charges & result" : "Charges", charges, y);

    if (job.repairNotes) {
      drawTextBox(doc, "Work done", job.repairNotes, y, 30);
    }

    drawFooter(doc);
    doc.end();
  });
}
