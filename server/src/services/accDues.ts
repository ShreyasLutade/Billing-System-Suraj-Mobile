import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { round2 } from "../lib/accShop";
import { startOfDayIST } from "../lib/ist";

/**
 * Wholesale credit works like a khata: a customer owes the sum of what each
 * bill left unpaid, minus every payment they made later. Payments are not
 * tied to a bill; they clear the oldest bills first (FIFO), which is how the
 * open bills, overdue amount and ageing (0–30 / 31–60 / 60+ days) are found.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type OpenBill = {
  saleId: string;
  number: string;
  saleDate: Date;
  dueDate: Date | null;
  total: number;
  open: number;
  /** Days past the due date (or bill date when no due date); 0 = not yet due */
  daysOverdue: number;
  ageDays: number;
};

export type CustomerBalance = {
  customerId: string;
  billed: number;
  paidAtBill: number;
  paidLater: number;
  balance: number;
  billCount: number;
  lastSaleAt: Date | null;
  lastPaymentAt: Date | null;
  overdue: number;
  aging: { d0_30: number; d31_60: number; d61_90: number; d90p: number };
  oldestOpen: OpenBill | null;
  openBills: OpenBill[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyBalance(customerId: string): CustomerBalance {
  return {
    customerId,
    billed: 0,
    paidAtBill: 0,
    paidLater: 0,
    balance: 0,
    billCount: 0,
    lastSaleAt: null,
    lastPaymentAt: null,
    overdue: 0,
    aging: { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 },
    oldestOpen: null,
    openBills: [],
  };
}

export async function customerBalances(customerIds?: string[], db: Db = prisma) {
  const where = customerIds ? { customerId: { in: customerIds } } : {};
  const [sales, payments] = await Promise.all([
    db.accSale.findMany({
      where: { ...where, kind: "WHOLESALE", voidedAt: null, customerId: customerIds ? { in: customerIds } : { not: null } },
      select: {
        id: true,
        number: true,
        customerId: true,
        saleDate: true,
        dueDate: true,
        total: true,
        cashAmount: true,
        onlineAmount: true,
        dueAmount: true,
      },
      orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }],
    }),
    db.accPayment.groupBy({
      by: ["customerId"],
      where,
      _sum: { amount: true },
      _max: { paidAt: true },
    }),
  ]);

  const map = new Map<string, CustomerBalance>();
  const get = (id: string) => {
    let row = map.get(id);
    if (!row) {
      row = emptyBalance(id);
      map.set(id, row);
    }
    return row;
  };
  for (const id of customerIds || []) get(id);

  const credit = new Map<string, number>();
  for (const p of payments) {
    const row = get(p.customerId);
    row.paidLater = round2(p._sum.amount || 0);
    row.lastPaymentAt = p._max.paidAt;
    credit.set(p.customerId, row.paidLater);
  }

  const today = startOfDayIST().getTime();
  for (const sale of sales) {
    if (!sale.customerId) continue;
    const row = get(sale.customerId);
    row.billed = round2(row.billed + sale.total);
    row.paidAtBill = round2(row.paidAtBill + sale.cashAmount + sale.onlineAmount);
    row.billCount += 1;
    row.lastSaleAt = sale.saleDate;
    let open = sale.dueAmount;
    const left = credit.get(sale.customerId) || 0;
    const used = Math.min(left, open);
    open = round2(open - used);
    credit.set(sale.customerId, round2(left - used));
    if (open > 0.009) {
      const ref = (sale.dueDate || sale.saleDate).getTime();
      const ageDays = Math.max(0, Math.floor((today - startOfDayIST(sale.saleDate).getTime()) / DAY_MS));
      const daysOverdue = sale.dueDate
        ? Math.max(0, Math.floor((today - startOfDayIST(new Date(ref)).getTime()) / DAY_MS))
        : 0;
      row.openBills.push({
        saleId: sale.id,
        number: sale.number,
        saleDate: sale.saleDate,
        dueDate: sale.dueDate,
        total: sale.total,
        open,
        daysOverdue,
        ageDays,
      });
      if (daysOverdue > 0) row.overdue = round2(row.overdue + open);
      const bucket =
        ageDays <= 30 ? "d0_30" : ageDays <= 60 ? "d31_60" : ageDays <= 90 ? "d61_90" : "d90p";
      row.aging[bucket] = round2(row.aging[bucket] + open);
    }
  }

  for (const row of map.values()) {
    row.balance = round2(row.billed - row.paidAtBill - row.paidLater);
    row.oldestOpen = row.openBills[0] || null;
  }
  return map;
}

export type DueFilter = {
  groupId?: string;
  groupIds?: string[];
  status?: "all" | "due" | "overdue" | "clear";
  q?: string;
  sort?: "balance" | "name" | "oldest" | "recent";
};

/** Customers with their balances, filtered and sorted for the Dues page and PDF. */
export async function duesList(filter: DueFilter) {
  const q = filter.q?.trim();
  const groupWhere: Prisma.AccCustomerWhereInput = filter.groupIds?.length
    ? filter.groupIds.includes("none")
      ? { OR: [{ groupId: null }, { groupId: { in: filter.groupIds.filter((id) => id !== "none") } }] }
      : { groupId: { in: filter.groupIds } }
    : filter.groupId === "none"
      ? { groupId: null }
      : filter.groupId
        ? { groupId: filter.groupId }
        : {};
  const customers = await prisma.accCustomer.findMany({
    where: {
      AND: [
        groupWhere,
        q
          ? {
            OR: [
              { name: { contains: q } },
              { phone: { contains: q } },
              { shopName: { contains: q } },
              { city: { contains: q } },
            ],
          }
          : {},
      ],
    },
    include: { group: true },
  });
  const balances = await customerBalances(customers.map((c) => c.id));
  const rows = customers
    .map((customer) => ({ customer, bal: balances.get(customer.id)! }))
    .filter(({ bal }) => {
      switch (filter.status || "due") {
        case "due":
          return bal.balance > 0.009;
        case "overdue":
          return bal.overdue > 0.009;
        case "clear":
          return bal.balance <= 0.009;
        default:
          return true;
      }
    });

  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  rows.sort((a, b) => {
    switch (filter.sort || "balance") {
      case "name":
        return collator.compare(a.customer.name, b.customer.name);
      case "oldest":
        return (
          (a.bal.oldestOpen?.saleDate.getTime() ?? Infinity) - (b.bal.oldestOpen?.saleDate.getTime() ?? Infinity)
        );
      case "recent":
        return (b.bal.lastSaleAt?.getTime() ?? 0) - (a.bal.lastSaleAt?.getTime() ?? 0);
      default:
        return b.bal.balance - a.bal.balance;
    }
  });
  return rows;
}

export type DueRow = Awaited<ReturnType<typeof duesList>>[number];

export function serializeDueRow({ customer, bal }: DueRow) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    shopName: customer.shopName,
    city: customer.city,
    address: customer.address,
    creditLimit: customer.creditLimit,
    group: customer.group ? { id: customer.group.id, name: customer.group.name, color: customer.group.color } : null,
    billed: bal.billed,
    paid: round2(bal.paidAtBill + bal.paidLater),
    balance: bal.balance,
    overdue: bal.overdue,
    billCount: bal.billCount,
    openBillCount: bal.openBills.length,
    lastSaleAt: bal.lastSaleAt,
    lastPaymentAt: bal.lastPaymentAt,
    aging: bal.aging,
    oldestOpen: bal.oldestOpen,
  };
}
