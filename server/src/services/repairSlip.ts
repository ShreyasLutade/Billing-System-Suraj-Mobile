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
  ram: string | null;
  storage: string | null;
  condition: string;
  conditionNotes: string | null;
  problemDescription: string;
  estimatedCost: number | null;
  imei: string | null;
  expectedDeliveryAt: Date | null;
  accessories: string | null;
  finalCharge: number | null;
  status: string;
  outcome: string | null;
  repairNotes: string | null;
  workDone: string | null;
  paymentMethod: string | null;
  pickupName: string | null;
  pickupPhone: string | null;
  repairedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
};

const PAGE = { width: 595.28, height: 841.89 };
const M = 32;
const W = PAGE.width - M * 2;
const PAYMENT_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI / Online", CARD: "Card" };
const CONDITION_LABEL: Record<string, string> = {
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  DAMAGED: "Damaged",
  DEAD: "Dead",
};
const STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Received",
  IN_REPAIR: "In repair",
  REPAIRED: "Repaired",
  DELIVERED: "Delivered",
};

const when = (date: Date) => format(date, "d MMM yyyy, h:mm a");
const dateLabel = (date: Date) =>
  date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const rupees = (amount: number) => `Rs. ${money(amount)}`;

function drawHeader(doc: PDFKit.PDFDocument, job: RepairSlipJob) {
  const top = doc.linearGradient(0, 0, PAGE.width, 0);
  top.stop(0, COLORS.logoStart).stop(1, COLORS.accent);
  doc.rect(0, 0, PAGE.width, 8).fill(top);

  drawBabuLogo(doc, M, 25, 54);
  const x = M + 68;
  const nameY = 27;
  const size = 20;
  const nameW = drawWordmarkText(doc, shop.name.toUpperCase(), x, nameY, size);
  if (shop.nameSuffix) {
    const small = 8;
    doc.font(FONT.display).fontSize(size);
    const baseline = nameY + ascenderOf(doc, size);
    doc.font(FONT.bold).fontSize(small).fillColor(COLORS.accent);
    doc.text(shop.nameSuffix.toUpperCase(), x + nameW + 4, baseline - ascenderOf(doc, small), {
      lineBreak: false,
    });
  }

  doc.font(FONT.regular).fontSize(8.5).fillColor(COLORS.muted);
  doc.text(shop.address, x, 57, { width: 255, lineBreak: false, ellipsis: true });
  doc.text(
    [`Ph: ${shop.phone}`, shop.instagram].filter(Boolean).join("   ·   "),
    x,
    70,
    { width: 255, lineBreak: false, ellipsis: true },
  );

  const ticketX = 365;
  doc.font(FONT.bold).fontSize(8).fillColor(COLORS.muted);
  doc.text("REPAIR JOB SHEET", ticketX, 31, {
    width: PAGE.width - M - ticketX,
    align: "right",
    characterSpacing: 1.2,
    lineBreak: false,
  });
  doc.font(FONT.bold).fontSize(19).fillColor(COLORS.accent);
  doc.text(job.jobNumber, ticketX, 45, {
    width: PAGE.width - M - ticketX,
    align: "right",
    lineBreak: false,
  });
  doc.font(FONT.regular).fontSize(8.5).fillColor(COLORS.muted);
  doc.text(`Received: ${when(job.createdAt)}`, ticketX, 70, {
    width: PAGE.width - M - ticketX,
    align: "right",
    lineBreak: false,
  });
  doc.moveTo(M, 94).lineTo(PAGE.width - M, 94).strokeColor("#DCE6F0").lineWidth(0.8).stroke();
  return 110;
}

function statusLabel(job: RepairSlipJob) {
  const label = STATUS_LABEL[job.status] ?? job.status;
  return job.outcome ? `${label} · ${job.outcome === "FIXED" ? "Fixed" : "Not fixed"}` : label;
}

function drawHero(doc: PDFKit.PDFDocument, job: RepairSlipJob, y: number) {
  doc.roundedRect(M, y, W, 62, 14).fill("#EFFAFF");
  doc.roundedRect(M, y, W, 62, 14).lineWidth(0.8).strokeColor("#CFE8F5").stroke();
  doc.font(FONT.bold).fontSize(11).fillColor(COLORS.logoStart);
  doc.text("MOBILE REPAIR SERVICE", M + 18, y + 16, { characterSpacing: 1, lineBreak: false });
  doc.font(FONT.regular).fontSize(9).fillColor(COLORS.muted);
  doc.text("Thank you for trusting us with your device.", M + 18, y + 34, { lineBreak: false });

  const status = statusLabel(job);
  doc.font(FONT.bold).fontSize(8.5);
  const pillW = Math.min(150, Math.max(80, doc.widthOfString(status) + 26));
  const pillX = PAGE.width - M - pillW - 14;
  doc.roundedRect(pillX, y + 17, pillW, 28, 14).fill("#E8F7ED");
  doc.circle(pillX + 12, y + 31, 3).fill("#159447");
  doc.font(FONT.bold).fontSize(8.5).fillColor("#159447");
  doc.text(status, pillX + 21, y + 26, { width: pillW - 28, lineBreak: false, ellipsis: true });
  return y + 80;
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
  doc.roundedRect(M, y + 1, 4, 14, 2).fill(COLORS.accent);
  doc.font(FONT.bold).fontSize(9).fillColor(COLORS.logoStart);
  doc.text(title.toUpperCase(), M + 12, y, { characterSpacing: 1.2, lineBreak: false });
  return y + 21;
}

function drawFieldsCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  fields: Array<[string, string]>,
  rowHeight = 20,
) {
  const height = 14 + fields.length * rowHeight;
  doc.roundedRect(x, y, width, height, 10).fill(COLORS.white);
  doc.roundedRect(x, y, width, height, 10).lineWidth(0.8).strokeColor("#DCE6F0").stroke();
  fields.forEach(([label, value], index) => {
    const rowY = y + 8 + index * rowHeight;
    if (index > 0) {
      doc.moveTo(x + 10, rowY - 3).lineTo(x + width - 10, rowY - 3)
        .strokeColor("#EDF1F5").lineWidth(0.5).stroke();
    }
    doc.font(FONT.regular).fontSize(8).fillColor(COLORS.muted);
    doc.text(label, x + 12, rowY, { width: width * 0.38, lineBreak: false, ellipsis: true });
    doc.font(FONT.bold).fontSize(8.5).fillColor(COLORS.ink);
    doc.text(value || "—", x + width * 0.4, rowY - 0.5, {
      width: width * 0.6 - 12,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });
  });
  return height;
}

function drawTextCard(
  doc: PDFKit.PDFDocument,
  title: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  doc.roundedRect(x, y, width, height, 11).fill("#FFF8EF");
  doc.roundedRect(x, y, width, height, 11).lineWidth(0.8).strokeColor("#FFE0BB").stroke();
  doc.font(FONT.bold).fontSize(11).fillColor(COLORS.ink);
  doc.text(text || "—", x + 15, y + 13, {
    width: width - 62,
    height: height - 26,
    ellipsis: true,
  });
  doc.font(FONT.regular).fontSize(8).fillColor("#9A6A37");
  doc.text(title, x + 15, y + height - 17, { lineBreak: false });
  const iconX = x + width - 34;
  doc.roundedRect(iconX, y + 15, 17, 27, 3).lineWidth(1.4).strokeColor(COLORS.accent).stroke();
  doc.moveTo(iconX + 5, y + 19).lineTo(iconX + 12, y + 19)
    .lineWidth(0.8).strokeColor(COLORS.accent).stroke();
  doc.circle(iconX + 8.5, y + 37, 1).fill(COLORS.accent);
}

function drawCharges(doc: PDFKit.PDFDocument, job: RepairSlipJob, y: number) {
  const height = job.finalCharge != null || job.outcome ? 66 : 58;
  doc.roundedRect(M, y, W, height, 12).fill(COLORS.logoStart);
  doc.font(FONT.bold).fontSize(8).fillColor("#BFD4F3");
  doc.text("ESTIMATED REPAIR COST", M + 16, y + 12, { characterSpacing: 0.8, lineBreak: false });
  doc.font(FONT.bold).fontSize(20).fillColor(COLORS.white);
  doc.text(job.estimatedCost != null ? rupees(job.estimatedCost) : "To be confirmed", M + 16, y + 26, {
    lineBreak: false,
  });

  const detail = job.finalCharge != null
    ? `Final: ${rupees(job.finalCharge)}`
    : job.outcome
      ? (job.outcome === "FIXED" ? "Repaired" : "Could not be fixed")
      : "Final amount may vary after inspection.";
  doc.font(FONT.regular).fontSize(8.5).fillColor("#E1ECFA");
  doc.text(detail, M + W * 0.58, y + (height - 10) / 2, {
    width: W * 0.38,
    align: "right",
    lineBreak: false,
    ellipsis: true,
  });
  return height;
}

function drawFooter(doc: PDFKit.PDFDocument, y: number) {
  const footerTop = Math.max(y + 17, 746);
  doc.moveTo(M, footerTop).lineTo(PAGE.width - M, footerTop).strokeColor("#DCE6F0").lineWidth(0.8).stroke();
  doc.font(FONT.bold).fontSize(8.5).fillColor(COLORS.ink);
  doc.text("CUSTOMER NOTE", M, footerTop + 13, { characterSpacing: 0.6, lineBreak: false });
  doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.muted);
  doc.text(
    "Please keep this job sheet for collection. Delivery time is an estimate and may change depending on parts availability and repair complexity.",
    M,
    footerTop + 27,
    { width: W * 0.64, height: 36, lineGap: 2, ellipsis: true },
  );
  const signX = PAGE.width - M - 160;
  doc.moveTo(signX, footerTop + 46).lineTo(PAGE.width - M, footerTop + 46)
    .strokeColor("#9AA8B8").lineWidth(0.8).stroke();
  doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.muted);
  doc.text("Customer Signature", signX, footerTop + 51, {
    width: 160,
    align: "right",
    lineBreak: false,
  });

  doc.rect(0, PAGE.height - 24, PAGE.width, 24).fill("#F4F8FC");
  doc.font(FONT.bold).fontSize(7).fillColor(COLORS.muted);
  doc.text(`${shop.name.toUpperCase()}${shop.nameSuffix ? ` ${shop.nameSuffix.toUpperCase()}` : ""}  ·  BALAGHAT`, M, PAGE.height - 15, {
    lineBreak: false,
  });
  doc.font(FONT.regular).fontSize(7).fillColor(COLORS.muted);
  doc.text("Thank you for choosing us.", M, PAGE.height - 15, {
    width: W,
    align: "right",
    lineBreak: false,
  });
}

export function buildRepairSlipPdf(job: RepairSlipJob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margin: 0,
      info: {
        Title: `Repair job sheet ${job.jobNumber}`,
        Author: shop.name,
        Subject: "Repair job sheet",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    let y = drawHero(doc, job, drawHeader(doc, job));

    y = drawSectionTitle(doc, "Customer", y);
    const half = (W - 10) / 2;
    const delivery = job.expectedDeliveryAt ? dateLabel(job.expectedDeliveryAt) : "To be confirmed";
    const customerHeight = Math.max(
      drawFieldsCard(doc, M, y, half, [
        ["Name", job.customerName],
        ["Mobile", job.customerPhone],
        ["Location", job.customerAddress || "—"],
      ]),
      drawFieldsCard(doc, M + half + 10, y, half, [
        ["Estimated delivery", delivery],
        ["Service type", "Mobile repair"],
        ["Current status", statusLabel(job)],
      ]),
    );
    y += customerHeight + 16;

    y = drawSectionTitle(doc, "Device details", y);
    const deviceFields: Array<[string, string]> = [
      ["Model", job.deviceName],
      ["System", job.platform === "IOS" ? "iOS" : "Android"],
      ...(job.imei ? [["IMEI / Serial", job.imei] as [string, string]] : []),
      ...(job.accessories ? [["Received with", job.accessories] as [string, string]] : []),
      ...(job.ram || job.storage
        ? [["RAM / Storage", [job.ram, job.storage].filter(Boolean).join(" / ")] as [string, string]]
        : []),
      ...(job.condition
        ? [[
            "Condition",
            [CONDITION_LABEL[job.condition] || job.condition, job.conditionNotes].filter(Boolean).join(" — "),
          ] as [string, string]]
        : []),
    ];
    const leftFields = deviceFields.filter((_, index) => index % 2 === 0);
    const rightFields = deviceFields.filter((_, index) => index % 2 === 1);
    const deviceHeight = Math.max(
      drawFieldsCard(doc, M, y, half, leftFields),
      drawFieldsCard(doc, M + half + 10, y, half, rightFields),
    );
    y += deviceHeight + 16;

    y = drawSectionTitle(doc, "Reported problem", y);
    drawTextCard(doc, "Issue reported by customer at intake", job.problemDescription, M, y, W, 58);
    y += 74;

    y = drawSectionTitle(doc, "Service & charges", y);
    y += drawCharges(doc, job, y) + 16;

    y = drawSectionTitle(doc, "Repair timeline", y);
    const timelineHeight = Math.max(
      drawFieldsCard(doc, M, y, half, [["Received", when(job.createdAt)]]),
      drawFieldsCard(doc, M + half + 10, y, half, [["Expected ready", delivery]]),
    );
    y += timelineHeight;

    if (job.outcome || job.workDone || job.repairNotes || job.paymentMethod || job.pickupName) {
      y += 12;
      const details = [
        job.outcome ? (job.outcome === "FIXED" ? "Repaired" : "Could not be fixed") : null,
        job.workDone,
        job.repairNotes,
        job.paymentMethod ? `Paid by ${PAYMENT_LABEL[job.paymentMethod] ?? job.paymentMethod}` : null,
        job.pickupName ? `Collected by ${job.pickupName}${job.pickupPhone ? ` (${job.pickupPhone})` : ""}` : null,
      ].filter(Boolean).join(" · ");
      if (details) {
        doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.muted);
        doc.text(details, M, y, { width: W, height: 28, ellipsis: true });
        y += 28;
      }
    }

    drawFooter(doc, y);
    doc.end();
  });
}
