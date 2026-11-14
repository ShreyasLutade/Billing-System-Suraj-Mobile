import { Router } from "express";
import { getPeriodRange, periodLabel, toDateFilter } from "../lib/period";
import { loadExchangeIntake } from "./analytics";

/**
 * Exchange mobiles taken in from customers, for everyone (staff included).
 * Same list as Analytics → Exchange mobiles, but never with prices.
 */
export const exchangesRouter = Router();

const PERIODS = ["today", "yesterday", "all"] as const;
type ExchangePeriod = (typeof PERIODS)[number];

exchangesRouter.get("/", async (req, res, next) => {
  try {
    const period: ExchangePeriod = PERIODS.includes(req.query.period as ExchangePeriod)
      ? (req.query.period as ExchangePeriod)
      : "today";
    const intake = await loadExchangeIntake(
      period === "all" ? undefined : toDateFilter(getPeriodRange(period)),
    );
    // Only these fields go out: no purchase price (value) or totals.
    const items = intake.items.map((item) => ({
      id: item.id,
      purchaseDate: item.purchaseDate,
      invoiceNumber: item.invoiceNumber,
      billId: item.billId,
      customerName: item.customerName,
      customerPhone: item.customerPhone,
      mobileName: item.mobileName,
      color: item.color,
      storage: item.storage,
      ram: item.ram,
      platform: item.platform,
      condition: item.condition,
      imei: item.imei,
      serialNumber: item.serialNumber,
      status: item.status,
    }));
    res.json({
      data: { period, periodLabel: periodLabel(period), count: items.length, items },
    });
  } catch (error) {
    next(error);
  }
});
