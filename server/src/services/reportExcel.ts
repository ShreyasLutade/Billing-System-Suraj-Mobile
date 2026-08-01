import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { endOfDayIST, formatISTDate, formatISTDateTime, istDateString, startOfDayIST } from "../lib/ist";

export type ReportScope = "today" | "all";

type BillWithItems = Awaited<
  ReturnType<typeof fetchBills>
>[number];

async function fetchBills(scope: ReportScope, now = new Date()) {
  const where =
    scope === "today"
      ? {
          withGst: false,
          billDate: {
            gte: startOfDayIST(now),
            lte: endOfDayIST(now),
          },
        }
      : { withGst: false };

  return prisma.bill.findMany({
    where,
    include: { items: true },
    orderBy: { billDate: "asc" },
  });
}

function money(value: number | null | undefined) {
  return Number(value ?? 0);
}

function addBillsSheet(wb: ExcelJS.Workbook, bills: BillWithItems[]) {
  const sheet = wb.addWorksheet("Bills");
  sheet.columns = [
    { header: "Invoice", key: "invoiceNumber", width: 16 },
    { header: "Bill Date", key: "billDate", width: 12 },
    { header: "Customer", key: "customerName", width: 22 },
    { header: "Phone", key: "customerPhone", width: 14 },
    { header: "Address", key: "customerAddress", width: 28 },
    { header: "Payable", key: "payableAmount", width: 12 },
    { header: "Cash", key: "cashAmount", width: 10 },
    { header: "Online", key: "onlineAmount", width: 10 },
    { header: "Finance", key: "financeAmount", width: 10 },
    { header: "Finance Co.", key: "financeCompanyName", width: 18 },
    { header: "Finance Received", key: "financeReceived", width: 16 },
    { header: "Finance Received At", key: "financeReceivedAt", width: 20 },
    { header: "Due", key: "dueAmount", width: 10 },
    { header: "Due Date", key: "dueDate", width: 12 },
    { header: "Due Settled", key: "dueSettled", width: 12 },
    { header: "Partial Paid", key: "isPartialPaid", width: 12 },
    { header: "Exchange", key: "isExchange", width: 10 },
    { header: "Exchange Model", key: "exchangeModel", width: 18 },
    { header: "Exchange Value", key: "exchangeValue", width: 14 },
    { header: "Created By", key: "createdByName", width: 16 },
    { header: "Role", key: "createdByRole", width: 10 },
    { header: "Notes", key: "notes", width: 28 },
    { header: "Created At", key: "createdAt", width: 18 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const bill of bills) {
    sheet.addRow({
      invoiceNumber: bill.invoiceNumber,
      billDate: formatISTDate(bill.billDate),
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      customerAddress: bill.customerAddress || "",
      payableAmount: money(bill.payableAmount ?? bill.grandTotal),
      cashAmount: money(bill.cashAmount),
      onlineAmount: money(bill.onlineAmount),
      financeAmount: money(bill.financeAmount),
      financeCompanyName: [bill.financeCompanyName, bill.financeCompanyName2]
        .filter(Boolean)
        .join(" + "),
      financeReceived: bill.financeReceived ? "Yes" : "No",
      financeReceivedAt: formatISTDateTime(bill.financeReceivedAt),
      dueAmount: money(bill.dueAmount),
      dueDate: formatISTDate(bill.dueDate),
      dueSettled: bill.dueSettled ? "Yes" : "No",
      isPartialPaid: bill.isPartialPaid ? "Yes" : "No",
      isExchange: bill.isExchange ? "Yes" : "No",
      exchangeModel: bill.exchangeModel || "",
      exchangeValue: bill.exchangeValue ?? "",
      createdByName: bill.createdByName || "",
      createdByRole: bill.createdByRole || "",
      notes: bill.notes || "",
      createdAt: formatISTDateTime(bill.createdAt),
    });
  }
}

function addItemsSheet(wb: ExcelJS.Workbook, bills: BillWithItems[]) {
  const sheet = wb.addWorksheet("Items");
  sheet.columns = [
    { header: "Invoice", key: "invoiceNumber", width: 16 },
    { header: "Bill Date", key: "billDate", width: 12 },
    { header: "Customer", key: "customerName", width: 22 },
    { header: "Product", key: "productName", width: 28 },
    { header: "OS", key: "platform", width: 10 },
    { header: "Color", key: "color", width: 14 },
    { header: "Storage", key: "storage", width: 12 },
    { header: "RAM", key: "ram", width: 10 },
    { header: "Qty", key: "quantity", width: 8 },
    { header: "Rate", key: "rate", width: 10 },
    { header: "GST %", key: "gstPercent", width: 8 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "IMEI 1", key: "imei1", width: 18 },
    { header: "IMEI 2", key: "imei2", width: 18 },
    { header: "Serial", key: "serialNumber", width: 16 },
    { header: "Warranty (months)", key: "warrantyMonths", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const bill of bills) {
    for (const item of bill.items) {
      sheet.addRow({
        invoiceNumber: bill.invoiceNumber,
        billDate: formatISTDate(bill.billDate),
        customerName: bill.customerName,
        productName: item.productName,
        platform: item.platform || "",
        color: item.color || "",
        storage: item.storage || "",
        ram: item.ram || "",
        quantity: item.quantity,
        rate: money(item.rate),
        gstPercent: money(item.gstPercent),
        amount: money(item.amount),
        imei1: item.imei1 || "",
        imei2: item.imei2 || "",
        serialNumber: item.serialNumber || "",
        warrantyMonths: item.warrantyMonths ?? "",
      });
    }
  }
}

function addSummarySheet(
  wb: ExcelJS.Workbook,
  scope: ReportScope,
  bills: BillWithItems[],
  generatedAt: Date,
) {
  const sheet = wb.addWorksheet("Summary");
  sheet.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };

  const payable = bills.reduce(
    (sum, b) => sum + money(b.payableAmount ?? b.grandTotal),
    0,
  );
  const cash = bills.reduce((sum, b) => sum + money(b.cashAmount), 0);
  const online = bills.reduce((sum, b) => sum + money(b.onlineAmount), 0);
  const finance = bills.reduce((sum, b) => sum + money(b.financeAmount), 0);
  const due = bills.reduce(
    (sum, b) => sum + (b.dueSettled ? 0 : money(b.dueAmount)),
    0,
  );

  const rows: Array<[string, string | number]> = [
    ["Shop", process.env.SHOP_NAME || "Suraj Mobile"],
    ["Report type", scope === "today" ? "Today only" : "All data up to date"],
    ["Generated at (IST)", formatISTDateTime(generatedAt)],
    ["Bill count", bills.length],
    ["Total payable", payable],
    ["Cash", cash],
    ["Online", online],
    ["Finance", finance],
    ["Outstanding due (in this file)", due],
  ];

  for (const [metric, value] of rows) {
    sheet.addRow({ metric, value });
  }
}

async function addOutstandingDuesSheet(wb: ExcelJS.Workbook) {
  const dues = await prisma.bill.findMany({
    where: {
      withGst: false,
      dueAmount: { gt: 0 },
      dueSettled: false,
    },
    orderBy: [{ dueDate: "asc" }, { billDate: "asc" }],
  });

  const sheet = wb.addWorksheet("Outstanding Dues");
  sheet.columns = [
    { header: "Invoice", key: "invoiceNumber", width: 16 },
    { header: "Bill Date", key: "billDate", width: 12 },
    { header: "Customer", key: "customerName", width: 22 },
    { header: "Phone", key: "customerPhone", width: 14 },
    { header: "Due Amount", key: "dueAmount", width: 12 },
    { header: "Due Date", key: "dueDate", width: 12 },
    { header: "Partial Paid", key: "isPartialPaid", width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const bill of dues) {
    sheet.addRow({
      invoiceNumber: bill.invoiceNumber,
      billDate: formatISTDate(bill.billDate),
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      dueAmount: money(bill.dueAmount),
      dueDate: formatISTDate(bill.dueDate),
      isPartialPaid: bill.isPartialPaid ? "Yes" : "No",
    });
  }
}

async function addFinanceDuesSheet(wb: ExcelJS.Workbook) {
  const dues = await prisma.bill.findMany({
    where: {
      withGst: false,
      financeAmount: { gt: 0 },
      financeReceived: false,
    },
    orderBy: { billDate: "asc" },
  });

  const sheet = wb.addWorksheet("Finance Dues");
  sheet.columns = [
    { header: "Invoice", key: "invoiceNumber", width: 16 },
    { header: "Bill Date", key: "billDate", width: 12 },
    { header: "Finance Company", key: "financeCompanyName", width: 22 },
    { header: "Customer", key: "customerName", width: 22 },
    { header: "Phone", key: "customerPhone", width: 14 },
    { header: "Amount Pending", key: "financeAmount", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const bill of dues) {
    sheet.addRow({
      invoiceNumber: bill.invoiceNumber,
      billDate: formatISTDate(bill.billDate),
      financeCompanyName: [bill.financeCompanyName, bill.financeCompanyName2]
        .filter(Boolean)
        .join(" + "),
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      financeAmount: money(bill.financeAmount),
    });
  }
}

export async function buildReportWorkbook(scope: ReportScope, now = new Date()) {
  const bills = await fetchBills(scope, now);
  const wb = new ExcelJS.Workbook();
  wb.creator = process.env.SHOP_NAME || "Suraj Mobile";
  wb.created = now;

  addSummarySheet(wb, scope, bills, now);
  addBillsSheet(wb, bills);
  addItemsSheet(wb, bills);
  if (scope === "all") {
    await addOutstandingDuesSheet(wb);
    await addFinanceDuesSheet(wb);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const dateLabel = istDateString(now);
  const filename =
    scope === "today"
      ? `SurajMobile-Today-${dateLabel}.xlsx`
      : `SurajMobile-Full-${dateLabel}.xlsx`;

  return {
    buffer,
    filename,
    billCount: bills.length,
    scope,
    dateLabel,
  };
}
