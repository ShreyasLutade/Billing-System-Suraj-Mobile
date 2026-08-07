import { Router } from "express";
import {
  differenceInCalendarDays,
  endOfDay,
  startOfDay,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { prisma } from "../lib/prisma";
import {
  getPeriodRange,
  isActivityPeriod,
  customPeriodLabel,
  parseDayParam,
  periodLabel,
  toDateFilter,
  type ActivityPeriod,
  type PeriodRange,
} from "../lib/period";

export const analyticsRouter = Router();

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function pct(part: number, total: number) {
  if (total <= 0) return 0;
  return round2((part / total) * 100);
}

type BillRow = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  billDate: Date;
  grandTotal: number;
  payableAmount: number;
  cashAmount: number;
  onlineAmount: number;
  financeAmount: number;
  financeAmount2: number;
  dueAmount: number;
  items: Array<{
    productName: string;
    stockItem: { purchasePrice: number } | null;
  }>;
};

function summarizeBills(bills: BillRow[]) {
  const summary = bills.reduce(
    (acc, bill) => {
      const finance =
        Number(bill.financeAmount || 0) + Number(bill.financeAmount2 || 0);
      const payable = bill.payableAmount || bill.grandTotal;
      const cost = bill.items.reduce(
        (sum, item) => sum + Number(item.stockItem?.purchasePrice || 0),
        0,
      );
      acc.sales += bill.grandTotal;
      acc.payable += payable;
      acc.cash += bill.cashAmount;
      acc.online += bill.onlineAmount;
      acc.finance += finance;
      acc.due += bill.dueAmount;
      acc.cost += cost;
      acc.profit += payable - cost;
      acc.bills += 1;
      return acc;
    },
    {
      sales: 0,
      payable: 0,
      cash: 0,
      online: 0,
      finance: 0,
      due: 0,
      cost: 0,
      profit: 0,
      bills: 0,
    },
  );

  const mixTotal = summary.cash + summary.online + summary.finance + summary.due;

  return {
    sales: round2(summary.sales),
    payable: round2(summary.payable),
    cash: round2(summary.cash),
    online: round2(summary.online),
    finance: round2(summary.finance),
    due: round2(summary.due),
    bills: summary.bills,
    cost: round2(summary.cost),
    profit: round2(summary.profit),
    collected: round2(summary.cash + summary.online + summary.finance),
    mixTotal: round2(mixTotal),
    shares: {
      cash: pct(summary.cash, mixTotal),
      online: pct(summary.online, mixTotal),
      finance: pct(summary.finance, mixTotal),
      due: pct(summary.due, mixTotal),
    },
  };
}

function mapPeriodBills(bills: BillRow[]) {
  return bills.map((bill) => {
    const sellingPrice = round2(bill.payableAmount || bill.grandTotal);
    const costPrice = round2(
      bill.items.reduce(
        (sum, item) => sum + Number(item.stockItem?.purchasePrice || 0),
        0,
      ),
    );
    const names = bill.items.map((item) => item.productName).filter(Boolean);
    const productLabel =
      names.length === 0
        ? "—"
        : names.length === 1
          ? names[0]
          : `${names[0]} +${names.length - 1} more`;

    return {
      id: bill.id,
      invoiceNumber: bill.invoiceNumber,
      customerName: bill.customerName,
      customerPhone: bill.customerPhone,
      billDate: bill.billDate.toISOString(),
      productLabel,
      costPrice,
      sellingPrice,
      profit: round2(sellingPrice - costPrice),
    };
  });
}

async function loadPeriodBills(
  billDateFilter: ReturnType<typeof toDateFilter>,
) {
  return prisma.bill.findMany({
    where: {
      withGst: false,
      ...(billDateFilter ? { billDate: billDateFilter } : {}),
    },
    orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      invoiceNumber: true,
      customerName: true,
      customerPhone: true,
      billDate: true,
      grandTotal: true,
      payableAmount: true,
      cashAmount: true,
      onlineAmount: true,
      financeAmount: true,
      financeAmount2: true,
      dueAmount: true,
      items: {
        select: {
          productName: true,
          stockItem: { select: { purchasePrice: true } },
        },
      },
    },
  });
}

async function analyzePeriod(
  billDateFilter: ReturnType<typeof toDateFilter>,
) {
  const bills = await loadPeriodBills(billDateFilter);
  return {
    summary: summarizeBills(bills),
    periodBills: mapPeriodBills(bills),
  };
}

function previousComparableRange(
  period: ActivityPeriod,
  now = new Date(),
): PeriodRange | null {
  const current = getPeriodRange(period, now);
  if (period === "today") {
    const day = subDays(now, 1);
    return { from: startOfDay(day), to: endOfDay(day) };
  }
  if (period === "yesterday") {
    const day = subDays(now, 2);
    return { from: startOfDay(day), to: endOfDay(day) };
  }
  if (period === "week" && current.from && current.to) {
    return {
      from: subWeeks(current.from, 1),
      to: subWeeks(current.to, 1),
    };
  }
  if (period === "month") {
    return getPeriodRange("month", subMonths(now, 1));
  }
  if (period === "all") {
    return {
      from: startOfDay(subDays(now, 60)),
      to: endOfDay(subDays(now, 31)),
    };
  }
  return null;
}

analyticsRouter.get("/summary", async (req, res, next) => {
  try {
    const customFrom = parseDayParam(req.query.from, false);
    const customTo = parseDayParam(req.query.to, true);
    const hasCustomRange = Boolean(customFrom || customTo);

    const period: ActivityPeriod | "custom" = hasCustomRange
      ? "custom"
      : isActivityPeriod(req.query.period)
        ? req.query.period
        : "all";

    const range: PeriodRange = hasCustomRange
      ? { from: customFrom, to: customTo }
      : getPeriodRange(period === "custom" ? "all" : period);

    const billDateFilter = toDateFilter(range);

    const { summary, periodBills } = await analyzePeriod(
      period === "all" ? undefined : billDateFilter,
    );

    let vsPrevious: {
      mixTotalChangePct: number | null;
      label: string | null;
    } = { mixTotalChangePct: null, label: null };

    if (period !== "custom") {
      const prevRange = previousComparableRange(period);
      if (prevRange) {
        const currentForTrend =
          period === "all"
            ? (
                await analyzePeriod(
                  toDateFilter({
                    from: startOfDay(subDays(new Date(), 30)),
                    to: endOfDay(new Date()),
                  }),
                )
              ).summary
            : summary;
        const previous = (
          await analyzePeriod(toDateFilter(prevRange))
        ).summary;
        const label =
          period === "all"
            ? "vs prior 30 days"
            : period === "month"
              ? "vs last month"
              : period === "week"
                ? "vs last week"
                : "vs prior day";

        if (previous.mixTotal > 0) {
          vsPrevious = {
            mixTotalChangePct: round2(
              ((currentForTrend.mixTotal - previous.mixTotal) /
                previous.mixTotal) *
                100,
            ),
            label,
          };
        } else if (currentForTrend.mixTotal > 0) {
          vsPrevious = { mixTotalChangePct: 100, label };
        } else {
          vsPrevious = { mixTotalChangePct: 0, label };
        }
      }
    }

    const outstandingRows = await prisma.bill.findMany({
      where: {
        withGst: false,
        dueAmount: { gt: 0 },
        dueSettled: false,
      },
      select: { dueAmount: true, dueDate: true, billDate: true },
    });

    const outstandingAmount = outstandingRows.reduce(
      (sum, row) => sum + row.dueAmount,
      0,
    );
    const todayStart = startOfDay(new Date());
    let oldestDueDays: number | null = null;
    for (const row of outstandingRows) {
      const anchor = row.dueDate || row.billDate;
      const days = differenceInCalendarDays(todayStart, startOfDay(anchor));
      if (days >= 0 && (oldestDueDays == null || days > oldestDueDays)) {
        oldestDueDays = days;
      }
    }

    const stockAgg = await prisma.stockItem.aggregate({
      where: { status: "AVAILABLE" },
      _count: { _all: true },
      _sum: { purchasePrice: true },
    });

    res.json({
      data: {
        period,
        periodLabel:
          period === "custom"
            ? customPeriodLabel(customFrom, customTo)
            : periodLabel(period),
        from: range.from ? range.from.toISOString() : null,
        to: range.to ? range.to.toISOString() : null,
        summary: {
          sales: summary.sales,
          payable: summary.payable,
          cash: summary.cash,
          online: summary.online,
          finance: summary.finance,
          due: summary.due,
          bills: summary.bills,
          cost: summary.cost,
          profit: summary.profit,
          collected: summary.collected,
          mixTotal: summary.mixTotal,
          shares: summary.shares,
        },
        today: {
          sales: summary.sales,
          cash: summary.cash,
          online: summary.online,
          finance: summary.finance,
          due: summary.due,
          bills: summary.bills,
        },
        vsPrevious,
        outstandingDue: {
          amount: round2(outstandingAmount),
          count: outstandingRows.length,
          oldestDueDays,
        },
        stockOnHand: {
          count: stockAgg._count._all,
          value: round2(stockAgg._sum.purchasePrice || 0),
        },
        periodBills,
      },
    });
  } catch (error) {
    next(error);
  }
});
