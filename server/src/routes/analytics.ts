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
import { EXCHANGE_NOTE_PREFIX } from "../services/stockSync";

export const analyticsRouter = Router();

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function pct(part: number, total: number) {
  if (total <= 0) return 0;
  return round2((part / total) * 100);
}

type BillItemRow = {
  productName: string;
  quantity: number;
  rate: number;
  stockItemId: string | null;
  stockItem: { purchasePrice: number } | null;
};

type BillRow = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  billDate: Date;
  grandTotal: number;
  payableAmount: number;
  companyDiscount?: number;
  cashAmount: number;
  onlineAmount: number;
  financeAmount: number;
  financeAmount2: number;
  dueAmount: number;
  dueDate?: Date | null;
  dueSettled?: boolean;
  financeCompanyName?: string | null;
  financeCompanyName2?: string | null;
  isExchange?: boolean;
  exchangeValue?: number | null;
  items: BillItemRow[];
};

function isStockMobile(item: BillItemRow) {
  return Boolean(item.stockItemId || item.stockItem);
}

function splitBillItems(items: BillItemRow[]) {
  let mobileSales = 0;
  let accessorySales = 0;
  let accessoryQty = 0;
  let cost = 0;
  const mobileNames: string[] = [];

  for (const item of items) {
    const amount = round2(Number(item.rate || 0) * Number(item.quantity || 1));
    if (isStockMobile(item)) {
      mobileSales += amount;
      cost += Number(item.stockItem?.purchasePrice || 0);
      if (item.productName) mobileNames.push(item.productName);
    } else {
      accessorySales += amount;
      accessoryQty += Number(item.quantity || 1);
    }
  }

  return {
    mobileSales: round2(mobileSales),
    accessorySales: round2(accessorySales),
    accessoryQty,
    cost: round2(cost),
    mobileNames,
  };
}

function summarizeBills(bills: BillRow[]) {
  const summary = bills.reduce(
    (acc, bill) => {
      const finance =
        Number(bill.financeAmount || 0) + Number(bill.financeAmount2 || 0);
      const payable = bill.payableAmount || bill.grandTotal;
      const companyDiscount = Number(bill.companyDiscount || 0);
      const split = splitBillItems(bill.items);
      acc.sales += split.mobileSales;
      acc.payable += payable;
      acc.cash += bill.cashAmount;
      acc.online += bill.onlineAmount;
      acc.finance += finance;
      acc.due += bill.dueAmount;
      acc.cost += split.cost;
      if (split.mobileSales > 0 || split.cost > 0) {
        acc.profit += split.mobileSales + companyDiscount - split.cost;
      }
      acc.accessoriesRevenue += split.accessorySales;
      acc.accessoriesSold += split.accessoryQty;
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
      accessoriesRevenue: 0,
      accessoriesSold: 0,
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
    accessoriesRevenue: round2(summary.accessoriesRevenue),
    accessoriesSold: summary.accessoriesSold,
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
  return bills
    .map((bill) => {
      const split = splitBillItems(bill.items);
      if (split.mobileSales <= 0 && split.cost <= 0) return null;
      const companyDiscount = round2(bill.companyDiscount || 0);
      const sellingPrice = round2(split.mobileSales + companyDiscount);
      const exchangeValue =
        bill.isExchange && Number(bill.exchangeValue || 0) > 0
          ? round2(Number(bill.exchangeValue || 0))
          : 0;
      const productLabel =
        split.mobileNames.length === 0
          ? "—"
          : split.mobileNames.length === 1
            ? split.mobileNames[0]
            : `${split.mobileNames[0]} +${split.mobileNames.length - 1} more`;

      return {
        id: bill.id,
        invoiceNumber: bill.invoiceNumber,
        customerName: bill.customerName,
        customerPhone: bill.customerPhone,
        billDate: bill.billDate.toISOString(),
        productLabel,
        costPrice: split.cost,
        sellingPrice,
        companyDiscount,
        exchangeValue,
        profit: round2(sellingPrice - split.cost),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function financeLabel(bill: BillRow) {
  return [bill.financeCompanyName, bill.financeCompanyName2]
    .map((name) => name?.trim())
    .filter(Boolean)
    .join(" + ");
}

function mapPaymentSources(bills: BillRow[]) {
  return bills.map((bill) => {
    const finance =
      Number(bill.financeAmount || 0) + Number(bill.financeAmount2 || 0);
    return {
      id: bill.id,
      invoiceNumber: bill.invoiceNumber,
      customerName: bill.customerName,
      billDate: bill.billDate.toISOString(),
      billTotal: round2(bill.payableAmount || bill.grandTotal),
      cashAmount: round2(bill.cashAmount || 0),
      onlineAmount: round2(bill.onlineAmount || 0),
      financeAmount: round2(finance),
      financeLabel: financeLabel(bill) || null,
      dueAmount: round2(bill.dueAmount || 0),
      dueDate: bill.dueDate ? bill.dueDate.toISOString() : null,
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
      companyDiscount: true,
      cashAmount: true,
      onlineAmount: true,
      financeAmount: true,
      financeAmount2: true,
      financeCompanyName: true,
      financeCompanyName2: true,
      dueAmount: true,
      dueDate: true,
      isExchange: true,
      exchangeValue: true,
      items: {
        select: {
          productName: true,
          quantity: true,
          rate: true,
          stockItemId: true,
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
    paymentSources: mapPaymentSources(bills),
  };
}

async function loadExchangeIntake(
  purchaseDateFilter: ReturnType<typeof toDateFilter>,
) {
  const purchases = await prisma.purchase.findMany({
    where: {
      note: { startsWith: EXCHANGE_NOTE_PREFIX },
      ...(purchaseDateFilter ? { purchaseDate: purchaseDateFilter } : {}),
    },
    orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      note: true,
      purchaseDate: true,
      supplierId: true,
      supplier: { select: { id: true, name: true, phone: true } },
      items: {
        select: {
          stockItem: {
            select: {
              id: true,
              mobileName: true,
              color: true,
              storage: true,
              ram: true,
              platform: true,
              condition: true,
              imei: true,
              serialNumber: true,
              purchasePrice: true,
              status: true,
            },
          },
        },
      },
    },
  });

  const invoiceNumbers = [
    ...new Set(
      purchases
        .map((purchase) =>
          (purchase.note || "").startsWith(EXCHANGE_NOTE_PREFIX)
            ? purchase.note!.slice(EXCHANGE_NOTE_PREFIX.length).trim()
            : "",
        )
        .filter(Boolean),
    ),
  ];

  const bills = invoiceNumbers.length
    ? await prisma.bill.findMany({
        where: { invoiceNumber: { in: invoiceNumbers } },
        select: { id: true, invoiceNumber: true },
      })
    : [];
  const billIdByInvoice = new Map(
    bills.map((bill) => [bill.invoiceNumber, bill.id]),
  );

  const items = purchases.flatMap((purchase) => {
    const invoiceNumber = (purchase.note || "")
      .slice(EXCHANGE_NOTE_PREFIX.length)
      .trim();
    return purchase.items
      .filter((row) => row.stockItem)
      .map((row) => {
        const stock = row.stockItem!;
        return {
          id: stock.id,
          purchaseId: purchase.id,
          purchaseDate: purchase.purchaseDate.toISOString(),
          invoiceNumber,
          billId: billIdByInvoice.get(invoiceNumber) || null,
          customerName: purchase.supplier.name,
          customerPhone: purchase.supplier.phone || null,
          supplierId: purchase.supplierId,
          mobileName: stock.mobileName,
          color: stock.color,
          storage: stock.storage,
          ram: stock.ram,
          platform: stock.platform,
          condition: stock.condition,
          imei: stock.imei,
          serialNumber: stock.serialNumber,
          value: round2(stock.purchasePrice || 0),
          status: stock.status,
        };
      });
  });

  const totalValue = round2(
    items.reduce((sum, item) => sum + item.value, 0),
  );

  return {
    count: items.length,
    totalValue,
    items,
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

    const { summary, periodBills, paymentSources } = await analyzePeriod(
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

    const exchangeIntake = await loadExchangeIntake(
      period === "all" ? undefined : billDateFilter,
    );

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
          accessoriesRevenue: summary.accessoriesRevenue,
          accessoriesSold: summary.accessoriesSold,
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
        exchangeIntake: {
          count: exchangeIntake.count,
          value: exchangeIntake.totalValue,
        },
        periodBills,
        paymentSources,
      },
    });
  } catch (error) {
    next(error);
  }
});

analyticsRouter.get("/exchanges", async (req, res, next) => {
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

    const purchaseDateFilter = toDateFilter(range);
    const exchangeIntake = await loadExchangeIntake(
      period === "all" ? undefined : purchaseDateFilter,
    );

    res.json({
      data: {
        period,
        periodLabel:
          period === "custom"
            ? customPeriodLabel(customFrom, customTo)
            : periodLabel(period),
        from: range.from ? range.from.toISOString() : null,
        to: range.to ? range.to.toISOString() : null,
        count: exchangeIntake.count,
        totalValue: exchangeIntake.totalValue,
        items: exchangeIntake.items,
      },
    });
  } catch (error) {
    next(error);
  }
});
