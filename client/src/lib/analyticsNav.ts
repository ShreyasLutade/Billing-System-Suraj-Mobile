import type { AnalyticsPeriodValue } from "../components/PeriodFilter";

export type PaymentMode = "cash" | "online" | "card" | "finance";

function periodSearchParams(
  period: AnalyticsPeriodValue,
  customFrom = "",
  customTo = "",
) {
  const params = new URLSearchParams();
  if (period === "custom") {
    if (customFrom) params.set("from", customFrom);
    if (customTo) params.set("to", customTo);
  } else {
    params.set("period", period);
  }
  return params;
}

export function analyticsPaymentsPath(
  mode: PaymentMode,
  period: AnalyticsPeriodValue,
  customFrom = "",
  customTo = "",
) {
  const params = periodSearchParams(period, customFrom, customTo);
  params.set("mode", mode);
  return `/analytics/payments?${params.toString()}`;
}

export function analyticsExchangesPath(
  period: AnalyticsPeriodValue,
  customFrom = "",
  customTo = "",
) {
  const params = periodSearchParams(period, customFrom, customTo);
  return `/analytics/exchanges?${params.toString()}`;
}
