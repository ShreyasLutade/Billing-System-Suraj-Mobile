import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import {
  endOfDayIST,
  formatISTDate,
  formatISTDateTime,
  istDateString,
  startOfDayIST,
} from "../lib/ist";

export type ReportScope = "today" | "all";

type BillWithItems = Awaited<ReturnType<typeof fetchBills>>[number];

async function fetchBills(scope: ReportScope, now = new Date()) {
  // "today" = operational day sheet (non-GST only, same as before).
  // "all" = full backup including GST bills.
  const where =
    scope === "today"
      ? {
          withGst: false,
          billDate: {
            gte: startOfDayIST(now),
            lte: endOfDayIST(now),
          },
        }
      : undefined;

  return prisma.bill.findMany({
    where,
    include: { items: true, duePayments: true },
    orderBy: { billDate: "asc" },
  });
}

function money(value: number | null | undefined) {
  return Number(value ?? 0);
}

function yesNo(value: boolean | null | undefined) {
  return value ? "Yes" : "No";
}

/** ISO timestamps for restore-safe Excel cells. */
function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : "";
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true };
}

function addBillsSheet(wb: ExcelJS.Workbook, bills: BillWithItems[]) {
  const sheet = wb.addWorksheet("Bills");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "invoiceNumber", key: "invoiceNumber", width: 16 },
    { header: "billDate", key: "billDate", width: 24 },
    { header: "customerName", key: "customerName", width: 22 },
    { header: "customerPhone", key: "customerPhone", width: 14 },
    { header: "customerAddress", key: "customerAddress", width: 28 },
    { header: "notes", key: "notes", width: 28 },
    { header: "withGst", key: "withGst", width: 10 },
    { header: "subtotal", key: "subtotal", width: 12 },
    { header: "gstAmount", key: "gstAmount", width: 12 },
    { header: "grandTotal", key: "grandTotal", width: 12 },
    { header: "payableAmount", key: "payableAmount", width: 12 },
    { header: "companyDiscount", key: "companyDiscount", width: 14 },
    { header: "cashAmount", key: "cashAmount", width: 10 },
    { header: "onlineAmount", key: "onlineAmount", width: 10 },
    { header: "financeAmount", key: "financeAmount", width: 12 },
    { header: "financeCompanyId", key: "financeCompanyId", width: 28 },
    { header: "financeCompanyName", key: "financeCompanyName", width: 18 },
    { header: "financeAmount2", key: "financeAmount2", width: 12 },
    { header: "financeCompanyId2", key: "financeCompanyId2", width: 28 },
    { header: "financeCompanyName2", key: "financeCompanyName2", width: 18 },
    { header: "financeReceived", key: "financeReceived", width: 14 },
    { header: "financeReceivedAt", key: "financeReceivedAt", width: 24 },
    { header: "isExchange", key: "isExchange", width: 10 },
    { header: "exchangeModel", key: "exchangeModel", width: 18 },
    { header: "exchangePlatform", key: "exchangePlatform", width: 14 },
    { header: "exchangeColor", key: "exchangeColor", width: 14 },
    { header: "exchangeStorage", key: "exchangeStorage", width: 14 },
    { header: "exchangeRam", key: "exchangeRam", width: 12 },
    { header: "exchangeImei1", key: "exchangeImei1", width: 18 },
    { header: "exchangeImei2", key: "exchangeImei2", width: 18 },
    { header: "exchangeSerial", key: "exchangeSerial", width: 16 },
    { header: "exchangeValue", key: "exchangeValue", width: 12 },
    { header: "exchangeNotes", key: "exchangeNotes", width: 24 },
    {
      header: "exchangeMobileCatalogId",
      key: "exchangeMobileCatalogId",
      width: 28,
    },
    { header: "dueAmount", key: "dueAmount", width: 10 },
    { header: "dueDate", key: "dueDate", width: 24 },
    { header: "dueSettled", key: "dueSettled", width: 12 },
    { header: "dueSettledMethod", key: "dueSettledMethod", width: 14 },
    { header: "dueSettledAt", key: "dueSettledAt", width: 24 },
    { header: "isPartialPaid", key: "isPartialPaid", width: 12 },
    { header: "createdByUserId", key: "createdByUserId", width: 28 },
    { header: "createdByName", key: "createdByName", width: 16 },
    { header: "createdByRole", key: "createdByRole", width: 10 },
    { header: "createdAt", key: "createdAt", width: 24 },
    { header: "updatedAt", key: "updatedAt", width: 24 },
  ];
  styleHeader(sheet);

  for (const bill of bills) {
    sheet.addRow({
      id: bill.id,
      invoiceNumber: bill.invoiceNumber,
      billDate: iso(bill.billDate),
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      customerAddress: bill.customerAddress || "",
      notes: bill.notes || "",
      withGst: yesNo(bill.withGst),
      subtotal: money(bill.subtotal),
      gstAmount: money(bill.gstAmount),
      grandTotal: money(bill.grandTotal),
      payableAmount: money(bill.payableAmount ?? bill.grandTotal),
      companyDiscount: money(bill.companyDiscount || 0),
      cashAmount: money(bill.cashAmount),
      onlineAmount: money(bill.onlineAmount),
      financeAmount: money(bill.financeAmount),
      financeCompanyId: bill.financeCompanyId || "",
      financeCompanyName: bill.financeCompanyName || "",
      financeAmount2: money(bill.financeAmount2),
      financeCompanyId2: bill.financeCompanyId2 || "",
      financeCompanyName2: bill.financeCompanyName2 || "",
      financeReceived: yesNo(bill.financeReceived),
      financeReceivedAt: iso(bill.financeReceivedAt),
      isExchange: yesNo(bill.isExchange),
      exchangeModel: bill.exchangeModel || "",
      exchangePlatform: bill.exchangePlatform || "",
      exchangeColor: bill.exchangeColor || "",
      exchangeStorage: bill.exchangeStorage || "",
      exchangeRam: bill.exchangeRam || "",
      exchangeImei1: bill.exchangeImei1 || "",
      exchangeImei2: bill.exchangeImei2 || "",
      exchangeSerial: bill.exchangeSerial || "",
      exchangeValue: bill.exchangeValue ?? "",
      exchangeNotes: bill.exchangeNotes || "",
      exchangeMobileCatalogId: bill.exchangeMobileCatalogId || "",
      dueAmount: money(bill.dueAmount),
      dueDate: iso(bill.dueDate),
      dueSettled: yesNo(bill.dueSettled),
      dueSettledMethod: bill.dueSettledMethod || "",
      dueSettledAt: iso(bill.dueSettledAt),
      isPartialPaid: yesNo(bill.isPartialPaid),
      createdByUserId: bill.createdByUserId || "",
      createdByName: bill.createdByName || "",
      createdByRole: bill.createdByRole || "",
      createdAt: iso(bill.createdAt),
      updatedAt: iso(bill.updatedAt),
    });
  }
}

function addItemsSheet(wb: ExcelJS.Workbook, bills: BillWithItems[]) {
  const sheet = wb.addWorksheet("BillItems");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "billId", key: "billId", width: 28 },
    { header: "invoiceNumber", key: "invoiceNumber", width: 16 },
    { header: "productName", key: "productName", width: 28 },
    { header: "mobileCatalogId", key: "mobileCatalogId", width: 28 },
    { header: "stockItemId", key: "stockItemId", width: 28 },
    { header: "platform", key: "platform", width: 10 },
    { header: "color", key: "color", width: 14 },
    { header: "storage", key: "storage", width: 12 },
    { header: "ram", key: "ram", width: 10 },
    { header: "condition", key: "condition", width: 10 },
    { header: "quantity", key: "quantity", width: 8 },
    { header: "rate", key: "rate", width: 10 },
    { header: "gstPercent", key: "gstPercent", width: 10 },
    { header: "amount", key: "amount", width: 12 },
    { header: "imei1", key: "imei1", width: 18 },
    { header: "imei2", key: "imei2", width: 18 },
    { header: "serialNumber", key: "serialNumber", width: 16 },
    { header: "warrantyMonths", key: "warrantyMonths", width: 14 },
  ];
  styleHeader(sheet);

  for (const bill of bills) {
    for (const item of bill.items) {
      sheet.addRow({
        id: item.id,
        billId: item.billId,
        invoiceNumber: bill.invoiceNumber,
        productName: item.productName,
        mobileCatalogId: item.mobileCatalogId || "",
        stockItemId: item.stockItemId || "",
        platform: item.platform || "",
        color: item.color || "",
        storage: item.storage || "",
        ram: item.ram || "",
        condition: item.condition || "",
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

function addDuePaymentsSheet(wb: ExcelJS.Workbook, bills: BillWithItems[]) {
  const sheet = wb.addWorksheet("DuePayments");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "billId", key: "billId", width: 28 },
    { header: "invoiceNumber", key: "invoiceNumber", width: 16 },
    { header: "amount", key: "amount", width: 12 },
    { header: "method", key: "method", width: 10 },
    { header: "kind", key: "kind", width: 10 },
    { header: "paidAt", key: "paidAt", width: 24 },
    { header: "note", key: "note", width: 28 },
  ];
  styleHeader(sheet);

  for (const bill of bills) {
    for (const payment of bill.duePayments) {
      sheet.addRow({
        id: payment.id,
        billId: payment.billId,
        invoiceNumber: bill.invoiceNumber,
        amount: money(payment.amount),
        method: payment.method,
        kind: payment.kind,
        paidAt: iso(payment.paidAt),
        note: payment.note || "",
      });
    }
  }
}

function addSummarySheet(
  wb: ExcelJS.Workbook,
  scope: ReportScope,
  bills: BillWithItems[],
  generatedAt: Date,
  counts: Record<string, number>,
) {
  const sheet = wb.addWorksheet("Summary");
  sheet.columns = [
    { header: "Metric", key: "metric", width: 36 },
    { header: "Value", key: "value", width: 40 },
  ];
  styleHeader(sheet);

  const payable = bills.reduce(
    (sum, b) => sum + money(b.payableAmount ?? b.grandTotal),
    0,
  );
  const cash = bills.reduce((sum, b) => sum + money(b.cashAmount), 0);
  const online = bills.reduce((sum, b) => sum + money(b.onlineAmount), 0);
  const finance = bills.reduce(
    (sum, b) => sum + money(b.financeAmount) + money(b.financeAmount2),
    0,
  );
  const due = bills.reduce(
    (sum, b) => sum + (b.dueSettled ? 0 : money(b.dueAmount)),
    0,
  );

  const rows: Array<[string, string | number]> = [
    ["Shop", process.env.SHOP_NAME || "Suraj Mobile"],
    [
      "Report type",
      scope === "today"
        ? "Today only (non-GST operational)"
        : "FULL BACKUP — all tables (restore-ready)",
    ],
    ["Generated at (IST)", formatISTDateTime(generatedAt)],
    ["Generated at (ISO)", iso(generatedAt)],
    ["Bill count (in file)", bills.length],
    ["Total payable", payable],
    ["Cash", cash],
    ["Online", online],
    ["Finance (1+2)", finance],
    ["Outstanding due (in this file)", due],
  ];

  if (scope === "all") {
    rows.push(
      ["—", "—"],
      ["Sheet row counts", ""],
      ...Object.entries(counts).map(
        ([name, count]) => [`  ${name}`, count] as [string, number],
      ),
      ["—", "—"],
      [
        "Restore note",
        "Dates are ISO-8601 UTC. Yes/No map to boolean. Re-import sheets to rebuild SQLite.",
      ],
    );
  }

  for (const [metric, value] of rows) {
    sheet.addRow({ metric, value });
  }
}

async function addOutstandingDuesSheet(wb: ExcelJS.Workbook) {
  const dues = await prisma.bill.findMany({
    where: {
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
    { header: "withGst", key: "withGst", width: 10 },
  ];
  styleHeader(sheet);

  for (const bill of dues) {
    sheet.addRow({
      invoiceNumber: bill.invoiceNumber,
      billDate: formatISTDate(bill.billDate),
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      dueAmount: money(bill.dueAmount),
      dueDate: formatISTDate(bill.dueDate),
      isPartialPaid: yesNo(bill.isPartialPaid),
      withGst: yesNo(bill.withGst),
    });
  }
  return dues.length;
}

async function addFinanceDuesSheet(wb: ExcelJS.Workbook) {
  const dues = await prisma.bill.findMany({
    where: {
      OR: [
        { financeAmount: { gt: 0 }, financeReceived: false },
        { financeAmount2: { gt: 0 }, financeReceived: false },
      ],
    },
    orderBy: { billDate: "asc" },
  });

  const sheet = wb.addWorksheet("Finance Dues");
  sheet.columns = [
    { header: "Invoice", key: "invoiceNumber", width: 16 },
    { header: "Bill Date", key: "billDate", width: 12 },
    { header: "Finance Company", key: "financeCompanyName", width: 22 },
    { header: "Finance Co. 2", key: "financeCompanyName2", width: 22 },
    { header: "Customer", key: "customerName", width: 22 },
    { header: "Phone", key: "customerPhone", width: 14 },
    { header: "Finance 1", key: "financeAmount", width: 12 },
    { header: "Finance 2", key: "financeAmount2", width: 12 },
    { header: "Total Pending", key: "totalPending", width: 14 },
  ];
  styleHeader(sheet);

  for (const bill of dues) {
    const f1 = money(bill.financeAmount);
    const f2 = money(bill.financeAmount2);
    sheet.addRow({
      invoiceNumber: bill.invoiceNumber,
      billDate: formatISTDate(bill.billDate),
      financeCompanyName: bill.financeCompanyName || "",
      financeCompanyName2: bill.financeCompanyName2 || "",
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      financeAmount: f1,
      financeAmount2: f2,
      totalPending: f1 + f2,
    });
  }
  return dues.length;
}

async function addCustomersSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.customer.findMany({ orderBy: { phone: "asc" } });
  const sheet = wb.addWorksheet("Customers");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "phone", key: "phone", width: 14 },
    { header: "name", key: "name", width: 22 },
    { header: "address", key: "address", width: 28 },
    { header: "createdAt", key: "createdAt", width: 24 },
    { header: "updatedAt", key: "updatedAt", width: 24 },
  ];
  styleHeader(sheet);
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      phone: row.phone,
      name: row.name,
      address: row.address || "",
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    });
  }
  return rows.length;
}

async function addStockItemsSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.stockItem.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  const sheet = wb.addWorksheet("StockItems");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "condition", key: "condition", width: 10 },
    { header: "platform", key: "platform", width: 10 },
    { header: "mobileName", key: "mobileName", width: 24 },
    { header: "storage", key: "storage", width: 12 },
    { header: "ram", key: "ram", width: 10 },
    { header: "color", key: "color", width: 14 },
    { header: "imei", key: "imei", width: 18 },
    { header: "serialNumber", key: "serialNumber", width: 18 },
    { header: "purchasePrice", key: "purchasePrice", width: 12 },
    { header: "suppliers", key: "suppliers", width: 28 },
    { header: "supplierId", key: "supplierId", width: 28 },
    { header: "status", key: "status", width: 12 },
    { header: "createdAt", key: "createdAt", width: 24 },
    { header: "updatedAt", key: "updatedAt", width: 24 },
  ];
  styleHeader(sheet);
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      condition: row.condition,
      platform: row.platform,
      mobileName: row.mobileName,
      storage: row.storage,
      ram: row.ram,
      color: row.color,
      imei: row.imei || "",
      serialNumber: row.serialNumber || "",
      purchasePrice: money(row.purchasePrice),
      suppliers: row.suppliers,
      supplierId: row.supplierId || "",
      status: row.status,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    });
  }
  return rows.length;
}

async function addSuppliersSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  const sheet = wb.addWorksheet("Suppliers");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "name", key: "name", width: 24 },
    { header: "phone", key: "phone", width: 14 },
    { header: "address", key: "address", width: 28 },
    { header: "notes", key: "notes", width: 28 },
    { header: "isExchange", key: "isExchange", width: 12 },
    { header: "createdAt", key: "createdAt", width: 24 },
    { header: "updatedAt", key: "updatedAt", width: 24 },
  ];
  styleHeader(sheet);
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      name: row.name,
      phone: row.phone || "",
      address: row.address || "",
      notes: row.notes || "",
      isExchange: yesNo(row.isExchange),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    });
  }
  return rows.length;
}

async function addPurchasesSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.purchase.findMany({
    include: { items: true },
    orderBy: { purchaseDate: "asc" },
  });
  const sheet = wb.addWorksheet("Purchases");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "supplierId", key: "supplierId", width: 28 },
    { header: "purchaseDate", key: "purchaseDate", width: 24 },
    { header: "note", key: "note", width: 28 },
    { header: "totalAmount", key: "totalAmount", width: 12 },
    { header: "condition", key: "condition", width: 10 },
    { header: "paidAt", key: "paidAt", width: 24 },
    { header: "createdAt", key: "createdAt", width: 24 },
    { header: "updatedAt", key: "updatedAt", width: 24 },
  ];
  styleHeader(sheet);

  const itemsSheet = wb.addWorksheet("PurchaseItems");
  itemsSheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "purchaseId", key: "purchaseId", width: 28 },
    { header: "stockItemId", key: "stockItemId", width: 28 },
  ];
  styleHeader(itemsSheet);

  let itemCount = 0;
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      supplierId: row.supplierId,
      purchaseDate: iso(row.purchaseDate),
      note: row.note || "",
      totalAmount: money(row.totalAmount),
      condition: row.condition,
      paidAt: iso(row.paidAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    });
    for (const item of row.items) {
      itemsSheet.addRow({
        id: item.id,
        purchaseId: item.purchaseId,
        stockItemId: item.stockItemId,
      });
      itemCount += 1;
    }
  }
  return { purchaseCount: rows.length, purchaseItemCount: itemCount };
}

async function addSupplierPaymentsSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.supplierPayment.findMany({
    orderBy: { paidAt: "asc" },
  });
  const sheet = wb.addWorksheet("SupplierPayments");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "supplierId", key: "supplierId", width: 28 },
    { header: "amount", key: "amount", width: 12 },
    { header: "method", key: "method", width: 10 },
    { header: "paidAt", key: "paidAt", width: 24 },
    { header: "note", key: "note", width: 28 },
    { header: "createdAt", key: "createdAt", width: 24 },
  ];
  styleHeader(sheet);
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      supplierId: row.supplierId,
      amount: money(row.amount),
      method: row.method,
      paidAt: iso(row.paidAt),
      note: row.note || "",
      createdAt: iso(row.createdAt),
    });
  }
  return rows.length;
}

async function addFinanceCompaniesSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.financeCompany.findMany({
    orderBy: { name: "asc" },
  });
  const sheet = wb.addWorksheet("FinanceCompanies");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "name", key: "name", width: 28 },
    { header: "createdAt", key: "createdAt", width: 24 },
  ];
  styleHeader(sheet);
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      name: row.name,
      createdAt: iso(row.createdAt),
    });
  }
  return rows.length;
}

async function addMobileCatalogSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.mobileCatalog.findMany({
    orderBy: [{ name: "asc" }, { condition: "asc" }],
  });
  const sheet = wb.addWorksheet("MobileCatalog");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "name", key: "name", width: 24 },
    { header: "platform", key: "platform", width: 10 },
    { header: "color", key: "color", width: 14 },
    { header: "storage", key: "storage", width: 12 },
    { header: "ram", key: "ram", width: 10 },
    { header: "condition", key: "condition", width: 10 },
    { header: "createdAt", key: "createdAt", width: 24 },
  ];
  styleHeader(sheet);
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      name: row.name,
      platform: row.platform,
      color: row.color,
      storage: row.storage,
      ram: row.ram,
      condition: row.condition,
      createdAt: iso(row.createdAt),
    });
  }
  return rows.length;
}

async function addPhoneModelsSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.phoneModel.findMany({
    orderBy: [{ platform: "asc" }, { name: "asc" }],
  });
  const sheet = wb.addWorksheet("PhoneModels");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "platform", key: "platform", width: 10 },
    { header: "name", key: "name", width: 24 },
    { header: "storage", key: "storage", width: 12 },
    { header: "ram", key: "ram", width: 10 },
    { header: "createdAt", key: "createdAt", width: 24 },
    { header: "updatedAt", key: "updatedAt", width: 24 },
  ];
  styleHeader(sheet);
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      platform: row.platform,
      name: row.name,
      storage: row.storage,
      ram: row.ram,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    });
  }
  return rows.length;
}

async function addUsersSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { phone: "asc" }],
  });
  const sheet = wb.addWorksheet("Users");
  sheet.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "phone", key: "phone", width: 14 },
    { header: "passwordHash", key: "passwordHash", width: 60 },
    { header: "name", key: "name", width: 22 },
    { header: "role", key: "role", width: 10 },
    { header: "createdAt", key: "createdAt", width: 24 },
    { header: "updatedAt", key: "updatedAt", width: 24 },
  ];
  styleHeader(sheet);
  for (const row of rows) {
    sheet.addRow({
      id: row.id,
      phone: row.phone,
      passwordHash: row.passwordHash,
      name: row.name,
      role: row.role,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    });
  }
  return rows.length;
}

async function addInvoiceSequenceSheet(wb: ExcelJS.Workbook) {
  const rows = await prisma.invoiceSequence.findMany();
  const sheet = wb.addWorksheet("InvoiceSequence");
  sheet.columns = [
    { header: "id", key: "id", width: 8 },
    { header: "counter", key: "counter", width: 12 },
  ];
  styleHeader(sheet);
  for (const row of rows) {
    sheet.addRow({ id: row.id, counter: row.counter });
  }
  return rows.length;
}

function addTodayBillsSheet(wb: ExcelJS.Workbook, bills: BillWithItems[]) {
  const sheet = wb.addWorksheet("Bills");
  sheet.columns = [
    { header: "Invoice", key: "invoiceNumber", width: 16 },
    { header: "Bill Date", key: "billDate", width: 12 },
    { header: "Customer", key: "customerName", width: 22 },
    { header: "Phone", key: "customerPhone", width: 14 },
    { header: "Address", key: "customerAddress", width: 28 },
    { header: "Payable", key: "payableAmount", width: 12 },
    { header: "Company cashback", key: "companyDiscount", width: 16 },
    { header: "Cash", key: "cashAmount", width: 10 },
    { header: "Online", key: "onlineAmount", width: 10 },
    { header: "Finance", key: "financeAmount", width: 10 },
    { header: "Finance Co.", key: "financeCompanyName", width: 18 },
    { header: "Due", key: "dueAmount", width: 10 },
    { header: "Created By", key: "createdByName", width: 16 },
    { header: "Notes", key: "notes", width: 28 },
  ];
  styleHeader(sheet);
  for (const bill of bills) {
    sheet.addRow({
      invoiceNumber: bill.invoiceNumber,
      billDate: formatISTDate(bill.billDate),
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      customerAddress: bill.customerAddress || "",
      payableAmount: money(bill.payableAmount ?? bill.grandTotal),
      companyDiscount: money(bill.companyDiscount || 0),
      cashAmount: money(bill.cashAmount),
      onlineAmount: money(bill.onlineAmount),
      financeAmount: money(bill.financeAmount) + money(bill.financeAmount2),
      financeCompanyName: [bill.financeCompanyName, bill.financeCompanyName2]
        .filter(Boolean)
        .join(" + "),
      dueAmount: money(bill.dueAmount),
      createdByName: bill.createdByName || "",
      notes: bill.notes || "",
    });
  }
}

function addTodayItemsSheet(wb: ExcelJS.Workbook, bills: BillWithItems[]) {
  const items = wb.addWorksheet("Items");
  items.columns = [
    { header: "Invoice", key: "invoiceNumber", width: 16 },
    { header: "Product", key: "productName", width: 28 },
    { header: "Color", key: "color", width: 14 },
    { header: "Storage", key: "storage", width: 12 },
    { header: "RAM", key: "ram", width: 10 },
    { header: "Rate", key: "rate", width: 10 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "IMEI 1", key: "imei1", width: 18 },
    { header: "IMEI 2", key: "imei2", width: 18 },
  ];
  styleHeader(items);
  for (const bill of bills) {
    for (const item of bill.items) {
      items.addRow({
        invoiceNumber: bill.invoiceNumber,
        productName: item.productName,
        color: item.color || "",
        storage: item.storage || "",
        ram: item.ram || "",
        rate: money(item.rate),
        amount: money(item.amount),
        imei1: item.imei1 || "",
        imei2: item.imei2 || "",
      });
    }
  }
}

export async function buildReportWorkbook(scope: ReportScope, now = new Date()) {
  const bills = await fetchBills(scope, now);
  const wb = new ExcelJS.Workbook();
  wb.creator = process.env.SHOP_NAME || "Suraj Mobile";
  wb.created = now;

  if (scope === "all") {
    // Build data sheets first, then prepend a Summary with final counts.
    addBillsSheet(wb, bills);
    addItemsSheet(wb, bills);
    addDuePaymentsSheet(wb, bills);

    const counts: Record<string, number> = {
      Bills: bills.length,
      BillItems: bills.reduce((sum, b) => sum + b.items.length, 0),
      DuePayments: bills.reduce((sum, b) => sum + b.duePayments.length, 0),
    };

    counts.Customers = await addCustomersSheet(wb);
    counts.StockItems = await addStockItemsSheet(wb);
    counts.Suppliers = await addSuppliersSheet(wb);
    const purchases = await addPurchasesSheet(wb);
    counts.Purchases = purchases.purchaseCount;
    counts.PurchaseItems = purchases.purchaseItemCount;
    counts.SupplierPayments = await addSupplierPaymentsSheet(wb);
    counts.FinanceCompanies = await addFinanceCompaniesSheet(wb);
    counts.MobileCatalog = await addMobileCatalogSheet(wb);
    counts.PhoneModels = await addPhoneModelsSheet(wb);
    counts.Users = await addUsersSheet(wb);
    counts.InvoiceSequence = await addInvoiceSequenceSheet(wb);
    counts["Outstanding Dues (view)"] = await addOutstandingDuesSheet(wb);
    counts["Finance Dues (view)"] = await addFinanceDuesSheet(wb);

    addSummarySheet(wb, scope, bills, now, counts);
  } else {
    addSummarySheet(wb, scope, bills, now, {
      Bills: bills.length,
      BillItems: bills.reduce((sum, b) => sum + b.items.length, 0),
    });
    addTodayBillsSheet(wb, bills);
    addTodayItemsSheet(wb, bills);
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const dateLabel = istDateString(now);
  const filename =
    scope === "today"
      ? `SurajMobile-Today-${dateLabel}.xlsx`
      : `SurajMobile-FullBackup-${dateLabel}.xlsx`;

  return {
    buffer,
    filename,
    billCount: bills.length,
    scope,
    dateLabel,
  };
}
