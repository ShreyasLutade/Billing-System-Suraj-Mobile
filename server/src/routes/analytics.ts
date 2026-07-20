import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  getPeriodRange,
  isActivityPeriod,
  periodLabel,
  toDateFilter,
  type ActivityPeriod,
} from "../lib/period";

export const analyticsRouter = Router();

analyticsRouter.get("/summary", async (req, res, next) => {
  try {
    const period: ActivityPeriod = isActivityPeriod(req.query.period)
      ? req.query.period
      : "today";
    const range = getPeriodRange(period);
    const billDateFilter = toDateFilter(range);

    const periodBills = await prisma.bill.findMany({
      where: billDateFilter ? { billDate: billDateFilter } : undefined,
      select: {
        grandTotal: true,
        payableAmount: true,
        cashAmount: true,
        onlineAmount: true,
        financeAmount: true,
        dueAmount: true,
      },
    });

    const summary = periodBills.reduce(
      (acc, bill) => {
        acc.sales += bill.grandTotal;
        acc.payable += bill.payableAmount || bill.grandTotal;
        acc.cash += bill.cashAmount;
        acc.online += bill.onlineAmount;
        acc.finance += bill.financeAmount;
        acc.due += bill.dueAmount;
        acc.bills += 1;
        return acc;
      },
      { sales: 0, payable: 0, cash: 0, online: 0, finance: 0, due: 0, bills: 0 },
    );

    const outstanding = await prisma.bill.aggregate({
      where: {
        dueAmount: { gt: 0 },
        dueSettled: false,
      },
      _sum: { dueAmount: true },
      _count: { _all: true },
    });

    const dueBills = await prisma.bill.findMany({
      where: {
        dueAmount: { gt: 0 },
        dueSettled: false,
      },
      orderBy: { dueDate: "asc" },
      take: 10,
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        customerPhone: true,
        dueAmount: true,
        dueDate: true,
        billDate: true,
      },
    });

    res.json({
      data: {
        period,
        periodLabel: periodLabel(period),
        from: range.from ? range.from.toISOString() : null,
        to: range.to ? range.to.toISOString() : null,
        summary: {
          sales: Number(summary.sales.toFixed(2)),
          payable: Number(summary.payable.toFixed(2)),
          cash: Number(summary.cash.toFixed(2)),
          online: Number(summary.online.toFixed(2)),
          finance: Number(summary.finance.toFixed(2)),
          due: Number(summary.due.toFixed(2)),
          bills: summary.bills,
        },
        // keep `today` alias for older clients
        today: {
          sales: Number(summary.sales.toFixed(2)),
          cash: Number(summary.cash.toFixed(2)),
          online: Number(summary.online.toFixed(2)),
          finance: Number(summary.finance.toFixed(2)),
          due: Number(summary.due.toFixed(2)),
          bills: summary.bills,
        },
        outstandingDue: {
          amount: Number((outstanding._sum.dueAmount || 0).toFixed(2)),
          count: outstanding._count._all,
        },
        upcomingDues: dueBills.map((bill) => ({
          ...bill,
          dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
          billDate: bill.billDate.toISOString(),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});
