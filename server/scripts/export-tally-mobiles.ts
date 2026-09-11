/**
 * One-off: export mobiles for a supplier (default: Tally)
 * with cost price and selling price (if sold).
 *
 * Run from server/:
 *   npx tsx scripts/export-tally-mobiles.ts
 *   npx tsx scripts/export-tally-mobiles.ts "Divya"
 */
import "dotenv/config";
import path from "path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const queryName = (process.argv[2] || "Tally").trim();

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function istDate(value: Date | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

function istDateTime(value: Date | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

function safeFilePart(value: string) {
  return (
    value.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") ||
    "supplier"
  );
}

async function main() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true },
  });

  const needle = queryName.toLowerCase();
  const matched = suppliers.filter((s) =>
    s.name.trim().toLowerCase().includes(needle),
  );

  if (!matched.length) {
    console.error(`No supplier matching '${queryName}' found.`);
    console.error(
      "Suppliers in this database:",
      suppliers.map((s) => s.name).join(" | ") || "(none)",
    );
    process.exit(1);
  }

  console.log(
    "Matched suppliers:",
    matched.map((s) => `${s.name} (${s.id})`).join(", "),
  );

  const supplierIds = matched.map((s) => s.id);

  const items = await prisma.stockItem.findMany({
    where: {
      NOT: { kind: "ACCESSORY" },
      OR: [
        { supplierId: { in: supplierIds } },
        {
          purchaseItem: {
            purchase: { supplierId: { in: supplierIds } },
          },
        },
      ],
    },
    include: {
      supplier: { select: { name: true, phone: true } },
      purchaseItem: {
        include: {
          purchase: {
            select: {
              id: true,
              purchaseDate: true,
              note: true,
              condition: true,
              totalAmount: true,
              paidAt: true,
              createdByName: true,
            },
          },
        },
      },
      billItems: {
        include: {
          bill: {
            select: {
              id: true,
              invoiceNumber: true,
              billDate: true,
              customerName: true,
              customerPhone: true,
              withGst: true,
              createdByName: true,
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [{ createdAt: "asc" }, { mobileName: "asc" }],
  });

  console.log(`Found ${items.length} mobile unit(s).`);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Suraj Mobile Billing";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Mobiles");
  sheet.columns = [
    { header: "Purchase date", key: "purchaseDate", width: 14 },
    { header: "Supplier", key: "supplier", width: 16 },
    { header: "Condition", key: "condition", width: 10 },
    { header: "Platform", key: "platform", width: 10 },
    { header: "Model", key: "model", width: 22 },
    { header: "Color", key: "color", width: 12 },
    { header: "Storage", key: "storage", width: 10 },
    { header: "RAM", key: "ram", width: 10 },
    { header: "IMEI", key: "imei", width: 18 },
    { header: "Serial", key: "serial", width: 18 },
    { header: "Cost price", key: "costPrice", width: 12 },
    { header: "Status", key: "status", width: 12 },
    { header: "Selling price", key: "sellingPrice", width: 12 },
    { header: "Sale qty", key: "saleQty", width: 10 },
    { header: "Sale amount", key: "saleAmount", width: 12 },
    { header: "GST %", key: "gstPercent", width: 8 },
    { header: "Invoice", key: "invoice", width: 16 },
    { header: "Bill date", key: "billDate", width: 14 },
    { header: "Customer", key: "customer", width: 18 },
    { header: "Customer phone", key: "customerPhone", width: 14 },
    { header: "GST bill", key: "gstBill", width: 10 },
    { header: "Purchase note", key: "purchaseNote", width: 20 },
    { header: "Purchase paid", key: "purchasePaid", width: 14 },
    { header: "Added by", key: "addedBy", width: 14 },
    { header: "Sold by", key: "soldBy", width: 14 },
    { header: "Stock created", key: "stockCreated", width: 18 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8EEF5" },
  };

  let soldCount = 0;
  let totalCost = 0;
  let totalSale = 0;

  for (const item of items) {
    const sale = item.billItems[0] || null;
    const bill = sale?.bill || null;
    const purchase = item.purchaseItem?.purchase || null;
    const cost = money(item.purchasePrice) ?? 0;
    const selling = sale ? money(sale.rate) : null;
    const saleAmount = sale ? money(sale.amount) : null;

    totalCost += cost;
    if (item.status === "SOLD") soldCount += 1;
    if (saleAmount != null) totalSale += saleAmount;

    sheet.addRow({
      purchaseDate: istDate(purchase?.purchaseDate || item.createdAt),
      supplier: item.supplier?.name || matched[0]?.name || queryName,
      condition: item.condition,
      platform: item.platform,
      model: item.mobileName,
      color: item.color,
      storage: item.storage,
      ram: item.ram || "",
      imei: item.imei || "",
      serial: item.serialNumber || "",
      costPrice: cost,
      status: item.status,
      sellingPrice: selling ?? "",
      saleQty: sale?.quantity ?? "",
      saleAmount: saleAmount ?? "",
      gstPercent: sale?.gstPercent ?? "",
      invoice: bill?.invoiceNumber || "",
      billDate: istDate(bill?.billDate),
      customer: bill?.customerName || "",
      customerPhone: bill?.customerPhone || "",
      gstBill: bill ? (bill.withGst ? "Yes" : "No") : "",
      purchaseNote: purchase?.note || "",
      purchasePaid: purchase?.paidAt ? istDate(purchase.paidAt) : "",
      addedBy: item.createdByName || purchase?.createdByName || "",
      soldBy: bill?.createdByName || "",
      stockCreated: istDateTime(item.createdAt),
    });
  }

  for (const col of ["costPrice", "sellingPrice", "saleAmount"] as const) {
    sheet.getColumn(col).numFmt = "#,##0.00";
  }

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 18 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRow({
    metric: "Supplier match",
    value: matched.map((s) => s.name).join(", "),
  });
  summary.addRow({ metric: "Total mobiles", value: items.length });
  summary.addRow({ metric: "Sold", value: soldCount });
  summary.addRow({ metric: "In stock", value: items.length - soldCount });
  summary.addRow({ metric: "Total cost price", value: money(totalCost) });
  summary.addRow({
    metric: "Total sale amount (sold)",
    value: money(totalSale),
  });
  summary.getColumn("value").numFmt = "#,##0.00";

  const fs = await import("fs");
  const outDir = path.resolve(process.cwd(), "exports");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  const outPath = path.join(
    outDir,
    `${safeFilePart(matched[0]?.name || queryName)}-mobiles-${stamp}.xlsx`,
  );
  await wb.xlsx.writeFile(outPath);

  console.log(`Wrote ${outPath}`);
  console.log(
    `Summary: ${items.length} units · ${soldCount} sold · cost ${money(totalCost)} · sales ${money(totalSale)}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
