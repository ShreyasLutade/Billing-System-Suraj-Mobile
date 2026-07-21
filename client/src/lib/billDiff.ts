import { formatINR } from "./api";
import type { Bill, CreateBillPayload } from "../types";

export type DiffKind = "added" | "removed" | "updated";

export type DiffLine = {
  id: string;
  kind: DiffKind;
  path: string;
  before?: string;
  after?: string;
};

export type BillSnapshot = {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes: string;
  useCash: boolean;
  useOnline: boolean;
  useFinance: boolean;
  cashAmount: number;
  onlineAmount: number;
  financeAmount: number;
  financeCompanyId: string;
  financeCompanyName: string;
  isExchange: boolean;
  exchangeModel: string;
  exchangeImei1: string;
  exchangeSerial: string;
  exchangeValue: number | null;
  exchangeNotes: string;
  dueDate: string;
  dueAmount: number;
  payableAmount: number;
  grandTotal: number;
  items: Array<{
    productName: string;
    color: string;
    storage: string;
    ram: string;
    quantity: number;
    rate: number;
    gstPercent: number;
    imei1: string;
    serialNumber: string;
    warrantyMonths: number | null;
    amount: number;
  }>;
};

function display(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  return String(value);
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatINR(value);
}

function dueLabel(value: string) {
  if (!value) return "—";
  // YYYY-MM-DD → keep readable
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return value;
}

function pushChange(
  lines: DiffLine[],
  path: string,
  before: string,
  after: string,
) {
  if (before === after) return;
  const emptyBefore = before === "—";
  const emptyAfter = after === "—";
  if (emptyBefore && !emptyAfter) {
    lines.push({
      id: `${path}:added`,
      kind: "added",
      path,
      after,
    });
    return;
  }
  if (!emptyBefore && emptyAfter) {
    lines.push({
      id: `${path}:removed`,
      kind: "removed",
      path,
      before,
    });
    return;
  }
  lines.push({
    id: `${path}:updated`,
    kind: "updated",
    path,
    before,
    after,
  });
}

export function billToSnapshot(bill: Bill): BillSnapshot {
  const dueDate = bill.dueDate
    ? bill.dueDate.slice(0, 10)
    : "";
  return {
    customerName: bill.customerName,
    customerPhone: bill.customerPhone,
    customerAddress: bill.customerAddress || "",
    notes: bill.notes || "",
    useCash: bill.cashAmount > 0,
    useOnline: bill.onlineAmount > 0,
    useFinance: bill.financeAmount > 0,
    cashAmount: bill.cashAmount,
    onlineAmount: bill.onlineAmount,
    financeAmount: bill.financeAmount,
    financeCompanyId: bill.financeCompanyId || "",
    financeCompanyName: bill.financeCompanyName || "",
    isExchange: bill.isExchange,
    exchangeModel: bill.exchangeModel || "",
    exchangeImei1: bill.exchangeImei1 || "",
    exchangeSerial: bill.exchangeSerial || "",
    exchangeValue: bill.exchangeValue ?? null,
    exchangeNotes: bill.exchangeNotes || "",
    dueDate,
    dueAmount: bill.dueAmount,
    payableAmount: bill.payableAmount ?? bill.grandTotal,
    grandTotal: bill.grandTotal,
    items: bill.items.map((item) => ({
      productName: item.productName,
      color: item.color || "",
      storage: item.storage || "",
      ram: item.ram || "",
      quantity: item.quantity,
      rate: item.rate,
      gstPercent: item.gstPercent,
      imei1: item.imei1 || "",
      serialNumber: item.serialNumber || "",
      warrantyMonths: item.warrantyMonths ?? null,
      amount: item.amount ?? item.rate * item.quantity,
    })),
  };
}

export function payloadToSnapshot(
  payload: CreateBillPayload,
  totals: {
    dueAmount: number;
    payableAmount: number;
    grandTotal: number;
    items: Array<{ amount: number }>;
  },
): BillSnapshot {
  return {
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    customerAddress: payload.customerAddress || "",
    notes: payload.notes || "",
    useCash: payload.useCash,
    useOnline: payload.useOnline,
    useFinance: payload.useFinance,
    cashAmount: payload.useCash ? payload.cashAmount : 0,
    onlineAmount: payload.useOnline ? payload.onlineAmount : 0,
    financeAmount: payload.useFinance ? payload.financeAmount : 0,
    financeCompanyId: payload.financeCompanyId || "",
    financeCompanyName: payload.financeCompanyName || "",
    isExchange: Boolean(payload.isExchange),
    exchangeModel: payload.exchangeModel || "",
    exchangeImei1: payload.exchangeImei1 || "",
    exchangeSerial: payload.exchangeSerial || "",
    exchangeValue: payload.exchangeValue ?? null,
    exchangeNotes: payload.exchangeNotes || "",
    dueDate: payload.dueDate || "",
    dueAmount: totals.dueAmount,
    payableAmount: totals.payableAmount,
    grandTotal: totals.grandTotal,
    items: payload.items.map((item, index) => ({
      productName: item.productName,
      color: item.color || "",
      storage: item.storage || "",
      ram: item.ram || "",
      quantity: item.quantity,
      rate: item.rate,
      gstPercent: item.gstPercent,
      imei1: item.imei1 || "",
      serialNumber: item.serialNumber || "",
      warrantyMonths: item.warrantyMonths ?? null,
      amount: totals.items[index]?.amount ?? item.rate * item.quantity,
    })),
  };
}

export function diffBillSnapshots(
  before: BillSnapshot,
  after: BillSnapshot,
): DiffLine[] {
  const lines: DiffLine[] = [];

  pushChange(lines, "Customer name", display(before.customerName), display(after.customerName));
  pushChange(lines, "Phone", display(before.customerPhone), display(after.customerPhone));
  pushChange(
    lines,
    "Address",
    display(before.customerAddress),
    display(after.customerAddress),
  );
  pushChange(lines, "Notes", display(before.notes), display(after.notes));

  pushChange(lines, "Gross total", money(before.grandTotal), money(after.grandTotal));
  pushChange(
    lines,
    "Payable",
    money(before.payableAmount),
    money(after.payableAmount),
  );

  pushChange(lines, "Cash", money(before.cashAmount), money(after.cashAmount));
  pushChange(lines, "Online", money(before.onlineAmount), money(after.onlineAmount));
  pushChange(
    lines,
    "Finance",
    money(before.financeAmount),
    money(after.financeAmount),
  );
  pushChange(
    lines,
    "Finance company",
    display(before.financeCompanyName),
    display(after.financeCompanyName),
  );
  pushChange(lines, "Due amount", money(before.dueAmount), money(after.dueAmount));
  pushChange(
    lines,
    "Due date",
    dueLabel(before.dueDate),
    dueLabel(after.dueDate),
  );

  pushChange(
    lines,
    "Exchange",
    display(before.isExchange),
    display(after.isExchange),
  );
  if (before.isExchange || after.isExchange) {
    pushChange(
      lines,
      "Exchange model",
      display(before.exchangeModel),
      display(after.exchangeModel),
    );
    pushChange(
      lines,
      "Exchange value",
      money(before.exchangeValue),
      money(after.exchangeValue),
    );
    pushChange(
      lines,
      "Exchange IMEI",
      display(before.exchangeImei1),
      display(after.exchangeImei1),
    );
    pushChange(
      lines,
      "Exchange serial",
      display(before.exchangeSerial),
      display(after.exchangeSerial),
    );
    pushChange(
      lines,
      "Exchange notes",
      display(before.exchangeNotes),
      display(after.exchangeNotes),
    );
  }

  const maxItems = Math.max(before.items.length, after.items.length);
  for (let i = 0; i < maxItems; i += 1) {
    const prev = before.items[i];
    const next = after.items[i];
    const label = `Item ${i + 1}`;

    if (!prev && next) {
      lines.push({
        id: `item-${i}:added`,
        kind: "added",
        path: label,
        after: `${next.productName} · Qty ${next.quantity} · ${money(next.amount)}`,
      });
      continue;
    }
    if (prev && !next) {
      lines.push({
        id: `item-${i}:removed`,
        kind: "removed",
        path: label,
        before: `${prev.productName} · Qty ${prev.quantity} · ${money(prev.amount)}`,
      });
      continue;
    }
    if (!prev || !next) continue;

    const beforeText = [
      prev.productName,
      prev.color || null,
      prev.storage || null,
      prev.ram || null,
      `Qty ${prev.quantity}`,
      `Rate ${money(prev.rate)}`,
      `GST ${prev.gstPercent}%`,
      prev.imei1 ? `IMEI ${prev.imei1}` : null,
      prev.serialNumber ? `Serial ${prev.serialNumber}` : null,
      prev.warrantyMonths ? `Warranty ${prev.warrantyMonths}m` : null,
      money(prev.amount),
    ]
      .filter(Boolean)
      .join(" · ");

    const afterText = [
      next.productName,
      next.color || null,
      next.storage || null,
      next.ram || null,
      `Qty ${next.quantity}`,
      `Rate ${money(next.rate)}`,
      `GST ${next.gstPercent}%`,
      next.imei1 ? `IMEI ${next.imei1}` : null,
      next.serialNumber ? `Serial ${next.serialNumber}` : null,
      next.warrantyMonths ? `Warranty ${next.warrantyMonths}m` : null,
      money(next.amount),
    ]
      .filter(Boolean)
      .join(" · ");

    pushChange(lines, label, beforeText, afterText);
  }

  return lines;
}
