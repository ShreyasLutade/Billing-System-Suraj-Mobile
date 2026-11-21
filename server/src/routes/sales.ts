import { Router } from "express";
import { getPeriodRange, periodLabel, toDateFilter } from "../lib/period";
import { loadSoldRows } from "./analytics";

/**
 * Phones sold in a period, for the staff Analytics page: what each sold for,
 * never the cost or profit.
 */
export const salesRouter = Router();

const PERIODS = ["today", "yesterday", "all"] as const;
type SalesPeriod = (typeof PERIODS)[number];

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

salesRouter.get("/", async (req, res, next) => {
  try {
    const period: SalesPeriod = PERIODS.includes(req.query.period as SalesPeriod)
      ? (req.query.period as SalesPeriod)
      : "today";
    const rows = await loadSoldRows(
      period === "all" ? undefined : toDateFilter(getPeriodRange(period)),
    );
    // Only these fields go out: the price the customer paid (company
    // cashback taken back out), no cost or profit.
    const items = rows.map((row) => ({
      id: row.id,
      entryId: row.entryId,
      kind: row.kind,
      refundMethod: row.refundMethod ?? null,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      billDate: row.billDate,
      productLabel: row.productLabel,
      sellingPrice: round2(row.sellingPrice - (row.companyDiscount || 0)),
      exchangeValue: row.exchangeValue || 0,
    }));
    const sold = items.filter((item) => item.kind === "SALE");
    res.json({
      data: {
        period,
        periodLabel: periodLabel(period),
        soldCount: sold.length,
        soldTotal: round2(items.reduce((sum, item) => sum + item.sellingPrice, 0)),
        items,
      },
    });
  } catch (error) {
    next(error);
  }
});
