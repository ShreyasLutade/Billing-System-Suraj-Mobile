import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { round2 } from "../../lib/accShop";
import { istDateString } from "../../lib/ist";
import { customerBalances, duesList, serializeDueRow, type DueFilter } from "../../services/accDues";
import { renderAccPdf, rs, sendPdf, pdfDay, PDF_TONE, type PdfRow } from "../../services/accPdf";
import { money } from "../../services/pdf";

export const accCustomersRouter = Router();

const phoneField = z
  .string()
  .transform((v) => v.replace(/\D/g, "").slice(-10))
  .pipe(z.string().length(10, "Enter a valid 10-digit mobile number"));

export const customerInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer name").max(100),
  phone: phoneField,
  shopName: z.string().trim().max(100).default(""),
  address: z.string().trim().max(250).default(""),
  city: z.string().trim().max(60).default(""),
  gstin: z.string().trim().toUpperCase().max(20).default(""),
  groupId: z.string().optional().nullable(),
  /** Creates the group when it doesn't exist yet. */
  groupName: z.string().trim().max(40).optional(),
  creditLimit: z.coerce.number().min(0).max(100_000_000).default(0),
  note: z.string().trim().max(300).default(""),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

async function resolveGroupId(tx: Prisma.TransactionClient, input: CustomerInput) {
  if (input.groupName) {
    const group = await tx.accCustomerGroup.upsert({
      where: { name: input.groupName },
      create: { name: input.groupName },
      update: {},
    });
    return group.id;
  }
  return input.groupId || null;
}

/** Same phone = same customer: update their details instead of a duplicate. */
export async function upsertCustomer(tx: Prisma.TransactionClient, input: CustomerInput) {
  const groupId = await resolveGroupId(tx, input);
  const { groupName: _g, groupId: _id, ...data } = input;
  return tx.accCustomer.upsert({
    where: { phone: input.phone },
    create: { ...data, groupId },
    update: { ...data, groupId },
  });
}

function badRequest(res: import("express").Response, error: z.ZodError) {
  const flat = error.flatten();
  res.status(400).json({ error: Object.values(flat.fieldErrors).flat()[0] || flat.formErrors[0] || "Check the details" });
}

/* ---------------- groups ---------------- */

accCustomersRouter.get("/groups", async (_req, res, next) => {
  try {
    const groups = await prisma.accCustomerGroup.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { customers: true } } },
    });
    res.json({
      data: groups.map((g) => ({ id: g.id, name: g.name, color: g.color, customerCount: g._count.customers })),
    });
  } catch (error) {
    next(error);
  }
});

const groupSchema = z.object({
  name: z.string().trim().min(1, "Enter a group name").max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#5d73b6"),
});

accCustomersRouter.post("/groups", async (req, res, next) => {
  try {
    const parsed = groupSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const group = await prisma.accCustomerGroup.create({ data: parsed.data });
    res.status(201).json({ data: { ...group, customerCount: 0 } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      res.status(409).json({ error: "A group with this name already exists" });
      return;
    }
    next(error);
  }
});

accCustomersRouter.put("/groups/:id", async (req, res, next) => {
  try {
    const parsed = groupSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const group = await prisma.accCustomerGroup.update({ where: { id: req.params.id }, data: parsed.data });
    res.json({ data: group });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      res.status(409).json({ error: "A group with this name already exists" });
      return;
    }
    next(error);
  }
});

/** Customers in it stay, just without a group. */
accCustomersRouter.delete("/groups/:id", async (req, res, next) => {
  try {
    await prisma.accCustomerGroup.delete({ where: { id: req.params.id } });
    res.json({ data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});

/* ---------------- customers ---------------- */

/** Search box on the wholesale bill: name / phone / shop. */
accCustomersRouter.get("/customers", async (req, res, next) => {
  try {
    const rows = await duesList({
      q: typeof req.query.q === "string" ? req.query.q : "",
      groupId: typeof req.query.groupId === "string" ? req.query.groupId : undefined,
      status: "all",
      sort: req.query.sort === "name" ? "name" : "recent",
    });
    res.json({ data: rows.slice(0, Number(req.query.limit) || 1000).map(serializeDueRow) });
  } catch (error) {
    next(error);
  }
});

accCustomersRouter.post("/customers", async (req, res, next) => {
  try {
    const parsed = customerInputSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const existing = await prisma.accCustomer.findUnique({ where: { phone: parsed.data.phone } });
    if (existing) {
      res.status(409).json({ error: `${parsed.data.phone} is already saved as ${existing.name}` });
      return;
    }
    const customer = await prisma.$transaction((tx) => upsertCustomer(tx, parsed.data));
    res.status(201).json({ data: customer });
  } catch (error) {
    next(error);
  }
});

accCustomersRouter.put("/customers/:id", async (req, res, next) => {
  try {
    const parsed = customerInputSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const clash = await prisma.accCustomer.findFirst({
      where: { phone: parsed.data.phone, NOT: { id: req.params.id } },
    });
    if (clash) {
      res.status(409).json({ error: `${parsed.data.phone} belongs to ${clash.name}` });
      return;
    }
    const customer = await prisma.$transaction(async (tx) => {
      const groupId = await resolveGroupId(tx, parsed.data);
      const { groupName: _g, groupId: _id, ...data } = parsed.data;
      return tx.accCustomer.update({ where: { id: req.params.id }, data: { ...data, groupId } });
    });
    res.json({ data: customer });
  } catch (error) {
    next(error);
  }
});

type LedgerLine = {
  id: string;
  date: Date;
  kind: "BILL" | "PAYMENT";
  ref: string;
  detail: string;
  debit: number;
  credit: number;
  balance: number;
  saleId?: string;
  method?: string;
};

async function customerLedger(customerId: string) {
  const [sales, payments] = await Promise.all([
    prisma.accSale.findMany({
      where: { customerId, kind: "WHOLESALE", voidedAt: null },
      include: { items: true },
      orderBy: { saleDate: "asc" },
    }),
    prisma.accPayment.findMany({ where: { customerId }, orderBy: { paidAt: "asc" } }),
  ]);
  const lines: Omit<LedgerLine, "balance">[] = [];
  for (const sale of sales) {
    const pcs = sale.items.reduce((a, i) => a + i.qty, 0);
    lines.push({
      id: sale.id,
      saleId: sale.id,
      date: sale.saleDate,
      kind: "BILL",
      ref: sale.number,
      detail: `${pcs} pcs · ${sale.items
        .slice(0, 3)
        .map((i) => i.name)
        .join(", ")}${sale.items.length > 3 ? "…" : ""}`,
      debit: sale.total,
      credit: 0,
    });
    const paid = round2(sale.cashAmount + sale.onlineAmount);
    if (paid > 0) {
      lines.push({
        id: `${sale.id}-paid`,
        saleId: sale.id,
        date: sale.saleDate,
        kind: "PAYMENT",
        ref: sale.number,
        detail: `Paid with bill${sale.cashAmount ? ` · cash ${money(sale.cashAmount)}` : ""}${
          sale.onlineAmount ? ` · online ${money(sale.onlineAmount)}` : ""
        }`,
        debit: 0,
        credit: paid,
      });
    }
  }
  for (const p of payments) {
    lines.push({
      id: p.id,
      date: p.paidAt,
      kind: "PAYMENT",
      ref: p.method,
      method: p.method,
      detail: [p.method === "DISCOUNT" ? "Discount / write-off" : `Payment · ${p.method.toLowerCase()}`, p.note]
        .filter(Boolean)
        .join(" · "),
      debit: 0,
      credit: p.amount,
    });
  }
  lines.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.kind === "BILL" ? -1 : 1));
  let balance = 0;
  return lines.map((line) => {
    balance = round2(balance + line.debit - line.credit);
    return { ...line, balance };
  });
}

accCustomersRouter.get("/customers/:id", async (req, res, next) => {
  try {
    const customer = await prisma.accCustomer.findUnique({ where: { id: req.params.id }, include: { group: true } });
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const [balances, ledger, top] = await Promise.all([
      customerBalances([customer.id]),
      customerLedger(customer.id),
      prisma.accSaleItem.groupBy({
        by: ["name"],
        where: { sale: { customerId: customer.id, voidedAt: null } },
        _sum: { qty: true, amount: true },
        orderBy: { _sum: { qty: "desc" } },
        take: 8,
      }),
    ]);
    const row = serializeDueRow({ customer, bal: balances.get(customer.id)! });
    res.json({
      data: {
        ...row,
        gstin: customer.gstin,
        note: customer.note,
        groupId: customer.groupId,
        openBills: balances.get(customer.id)!.openBills,
        ledger: ledger.reverse(),
        topItems: top.map((t) => ({ name: t.name, qty: t._sum.qty || 0, amount: round2(t._sum.amount || 0) })),
      },
    });
  } catch (error) {
    next(error);
  }
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Enter the amount received").max(100_000_000),
  method: z.enum(["CASH", "UPI", "BANK", "CHEQUE", "DISCOUNT"]),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note: z.string().trim().max(200).default(""),
});

accCustomersRouter.post("/customers/:id/payments", async (req, res, next) => {
  try {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const customer = await prisma.accCustomer.findUnique({ where: { id: req.params.id } });
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const today = istDateString();
    const paidAt =
      parsed.data.paidAt && parsed.data.paidAt !== today
        ? new Date(`${parsed.data.paidAt}T12:00:00+05:30`)
        : new Date();
    const payment = await prisma.accPayment.create({
      data: {
        customerId: customer.id,
        amount: round2(parsed.data.amount),
        method: parsed.data.method,
        paidAt,
        note: parsed.data.note,
        createdByName: req.user?.name || null,
      },
    });
    const balance = (await customerBalances([customer.id])).get(customer.id)!.balance;
    res.status(201).json({ data: { payment, balance } });
  } catch (error) {
    next(error);
  }
});

accCustomersRouter.delete("/payments/:id", async (req, res, next) => {
  try {
    if (req.user?.role !== "ADMIN") {
      res.status(403).json({ error: "Only an admin can delete a payment" });
      return;
    }
    await prisma.accPayment.delete({ where: { id: req.params.id } });
    res.json({ data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});

/* ---------------- dues ---------------- */

function dueFilter(query: Record<string, unknown>): DueFilter {
  const status = ["all", "due", "overdue", "clear"].includes(String(query.status))
    ? (String(query.status) as DueFilter["status"])
    : "due";
  const sort = ["balance", "name", "oldest", "recent"].includes(String(query.sort))
    ? (String(query.sort) as DueFilter["sort"])
    : "balance";
  return {
    status,
    sort,
    groupId: typeof query.groupId === "string" && query.groupId ? query.groupId : undefined,
    q: typeof query.q === "string" ? query.q : "",
  };
}

accCustomersRouter.get("/dues", async (req, res, next) => {
  try {
    const rows = await duesList(dueFilter(req.query));
    const list = rows.map(serializeDueRow);
    // Group cards always show every group's outstanding, whatever the filter.
    const all = await duesList({ status: "due" });
    const groups = new Map<string, { id: string; name: string; color: string; count: number; balance: number; overdue: number }>();
    for (const { customer, bal } of all) {
      const key = customer.group?.id || "none";
      const g = groups.get(key) || {
        id: key,
        name: customer.group?.name || "No group",
        color: customer.group?.color || "#94a3b8",
        count: 0,
        balance: 0,
        overdue: 0,
      };
      g.count += 1;
      g.balance = round2(g.balance + bal.balance);
      g.overdue = round2(g.overdue + bal.overdue);
      groups.set(key, g);
    }
    const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
    for (const { bal } of all) {
      for (const k of Object.keys(aging) as Array<keyof typeof aging>) aging[k] = round2(aging[k] + bal.aging[k]);
    }
    res.json({
      data: {
        customers: list,
        totals: {
          outstanding: round2(all.reduce((a, r) => a + Math.max(r.bal.balance, 0), 0)),
          overdue: round2(all.reduce((a, r) => a + r.bal.overdue, 0)),
          customers: all.length,
          aging,
          shown: round2(list.reduce((a, r) => a + r.balance, 0)),
        },
        groups: [...groups.values()].sort((a, b) => b.balance - a.balance),
      },
    });
  } catch (error) {
    next(error);
  }
});

accCustomersRouter.get("/dues/pdf", async (req, res, next) => {
  try {
    const filter = dueFilter(req.query);
    const byGroup = req.query.groupBy !== "none";
    const showBills = req.query.bills === "1";
    const rows = await duesList(filter);
    if (byGroup) {
      rows.sort(
        (a, b) =>
          (a.customer.group?.name || "~").localeCompare(b.customer.group?.name || "~") || b.bal.balance - a.bal.balance,
      );
    }

    const pdfRows: PdfRow[] = [];
    let group: string | null = null;
    let gt = { billed: 0, paid: 0, balance: 0, overdue: 0, a: 0, b: 0, c: 0, n: 0 };
    const flush = () => {
      if (group === null || !byGroup) return;
      pdfRows.push({
        kind: "subtotal",
        cells: {
          name: `${group} · ${gt.n} customers`,
          billed: money(gt.billed),
          paid: money(gt.paid),
          balance: money(gt.balance),
          a: money(gt.a),
          b: money(gt.b),
          c: money(gt.c),
        },
      });
    };
    const totals = { billed: 0, paid: 0, balance: 0, overdue: 0, a: 0, b: 0, c: 0 };
    for (const { customer, bal } of rows) {
      const name = customer.group?.name || "No group";
      if (byGroup && name !== group) {
        flush();
        group = name;
        gt = { billed: 0, paid: 0, balance: 0, overdue: 0, a: 0, b: 0, c: 0, n: 0 };
        pdfRows.push({ kind: "group", cells: { name: name.toUpperCase() } });
      }
      const paid = round2(bal.paidAtBill + bal.paidLater);
      const a = bal.aging.d0_30;
      const b = bal.aging.d31_60;
      const c = round2(bal.aging.d61_90 + bal.aging.d90p);
      for (const [k, v] of Object.entries({ billed: bal.billed, paid, balance: bal.balance, overdue: bal.overdue, a, b, c })) {
        totals[k as keyof typeof totals] = round2(totals[k as keyof typeof totals] + v);
        gt[k as keyof typeof gt] = round2(gt[k as keyof typeof gt] + v);
      }
      gt.n += 1;
      pdfRows.push({
        cells: {
          name: customer.name,
          phone: customer.phone,
          last: pdfDay(bal.lastSaleAt),
          billed: money(bal.billed),
          paid: money(paid),
          balance: money(bal.balance),
          a: a ? money(a) : "",
          b: b ? money(b) : "",
          c: c ? money(c) : "",
          oldest: bal.oldestOpen ? `${bal.oldestOpen.ageDays}d` : "",
        },
        sub: {
          name: [customer.shopName, customer.city].filter(Boolean).join(" · "),
          last: bal.lastPaymentAt ? `Paid ${pdfDay(bal.lastPaymentAt)}` : "",
          balance: bal.overdue ? `Overdue ${money(bal.overdue)}` : "",
          oldest: bal.oldestOpen?.number || "",
        },
        color: { balance: bal.balance > 0 ? PDF_TONE.red : PDF_TONE.green, c: PDF_TONE.red, b: PDF_TONE.amber },
      });
      if (showBills) {
        for (const bill of bal.openBills) {
          pdfRows.push({
            cells: {
              name: `   ${bill.number}`,
              last: pdfDay(bill.saleDate),
              billed: money(bill.total),
              balance: money(bill.open),
              oldest: `${bill.ageDays}d`,
            },
            sub: { name: bill.dueDate ? `   Pay by ${pdfDay(bill.dueDate)}` : "" },
          });
        }
      }
    }
    flush();

    const groupName =
      filter.groupId === "none"
        ? "No group"
        : filter.groupId
          ? (await prisma.accCustomerGroup.findUnique({ where: { id: filter.groupId } }))?.name
          : "All groups";
    const statusLabel = { all: "All customers", due: "With balance", overdue: "Overdue only", clear: "Cleared" }[
      filter.status || "due"
    ];
    const pdf = await renderAccPdf({
      title: "Wholesale dues",
      subtitle: `${groupName} · ${statusLabel} · as of ${pdfDay(new Date())}`,
      landscape: true,
      summary: [
        { label: "Customers", value: String(rows.length) },
        { label: "Total outstanding", value: rs(totals.balance), tone: "red" },
        { label: "Overdue", value: rs(totals.overdue), tone: "amber" },
        { label: "0–30 days", value: rs(totals.a) },
        { label: "31–60 days", value: rs(totals.b), tone: "amber" },
        { label: "Over 60 days", value: rs(totals.c), tone: "red" },
        { label: "Total billed", value: rs(totals.billed), tone: "blue" },
        { label: "Total received", value: rs(totals.paid), tone: "green" },
      ],
      sections: [
        {
          columns: [
            { key: "name", label: "Customer", width: 22 },
            { key: "phone", label: "Phone", width: 10 },
            { key: "last", label: "Last bill", width: 11 },
            { key: "billed", label: "Billed", width: 10, align: "right" },
            { key: "paid", label: "Received", width: 10, align: "right" },
            { key: "balance", label: "Balance", width: 11, align: "right" },
            { key: "a", label: "0–30 d", width: 8, align: "right" },
            { key: "b", label: "31–60 d", width: 8, align: "right" },
            { key: "c", label: "60+ d", width: 8, align: "right" },
            { key: "oldest", label: "Oldest", width: 7, align: "right" },
          ],
          rows: pdfRows,
          total: {
            name: `Total · ${rows.length} customers`,
            billed: money(totals.billed),
            paid: money(totals.paid),
            balance: money(totals.balance),
            a: money(totals.a),
            b: money(totals.b),
            c: money(totals.c),
          },
          empty: "No customers for this filter.",
        },
      ],
      footNote: "Payments clear the oldest bills first. Age = days since the bill.",
    });
    sendPdf(res, pdf, `accessories-dues-${istDateString()}.pdf`);
  } catch (error) {
    next(error);
  }
});

accCustomersRouter.get("/customers/:id/statement", async (req, res, next) => {
  try {
    const customer = await prisma.accCustomer.findUnique({ where: { id: req.params.id }, include: { group: true } });
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const [balances, ledger] = await Promise.all([customerBalances([customer.id]), customerLedger(customer.id)]);
    const bal = balances.get(customer.id)!;
    const pdf = await renderAccPdf({
      title: "Account statement",
      subtitle: `As of ${pdfDay(new Date())}`,
      info: [
        { label: "Customer", value: customer.name },
        { label: "Phone", value: customer.phone },
        { label: "Shop", value: customer.shopName },
        { label: "Address", value: [customer.address, customer.city].filter(Boolean).join(", ") },
        { label: "Group", value: customer.group?.name || "" },
        { label: "GSTIN", value: customer.gstin },
      ],
      summary: [
        { label: "Total billed", value: rs(bal.billed), tone: "blue" },
        { label: "Total received", value: rs(round2(bal.paidAtBill + bal.paidLater)), tone: "green" },
        { label: "Balance due", value: rs(bal.balance), tone: "red" },
        { label: "Overdue", value: rs(bal.overdue), tone: "amber" },
      ],
      sections: [
        {
          heading: "Ledger",
          columns: [
            { key: "date", label: "Date", width: 12 },
            { key: "ref", label: "Ref", width: 11 },
            { key: "detail", label: "Particulars", width: 41 },
            { key: "debit", label: "Bill (Dr)", width: 12, align: "right" },
            { key: "credit", label: "Paid (Cr)", width: 12, align: "right" },
            { key: "balance", label: "Balance", width: 12, align: "right" },
          ],
          rows: ledger.map((l) => ({
            cells: {
              date: pdfDay(l.date),
              ref: l.ref,
              detail: l.detail,
              debit: l.debit ? money(l.debit) : "",
              credit: l.credit ? money(l.credit) : "",
              balance: money(l.balance),
            },
            color: { credit: PDF_TONE.green },
          })),
          total: { detail: "Closing balance", debit: money(bal.billed), credit: money(round2(bal.paidAtBill + bal.paidLater)), balance: money(bal.balance) },
          empty: "No bills yet.",
        },
        ...(bal.openBills.length
          ? [
              {
                heading: "Unpaid bills",
                columns: [
                  { key: "number", label: "Bill", width: 18 },
                  { key: "date", label: "Date", width: 18 },
                  { key: "due", label: "Pay by", width: 18 },
                  { key: "total", label: "Bill total", width: 16, align: "right" as const },
                  { key: "open", label: "Still due", width: 16, align: "right" as const },
                  { key: "age", label: "Age", width: 14, align: "right" as const },
                ],
                rows: bal.openBills.map((b) => ({
                  cells: {
                    number: b.number,
                    date: pdfDay(b.saleDate),
                    due: b.dueDate ? pdfDay(b.dueDate) : "",
                    total: money(b.total),
                    open: money(b.open),
                    age: `${b.ageDays} days`,
                  },
                  color: b.daysOverdue ? { open: PDF_TONE.red } : undefined,
                })),
              },
            ]
          : []),
      ],
      notes: ["Please clear the balance at the earliest. Thank you!"],
    });
    sendPdf(res, pdf, `statement-${customer.name.replace(/[^a-z0-9]+/gi, "-")}-${istDateString()}.pdf`);
  } catch (error) {
    next(error);
  }
});
