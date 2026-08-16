import type { AnalyticsPeriodValue } from "../components/PeriodFilter";

export type PaymentMode = "cash" | "online" | "finance";

export function analyticsPaymentsPath(
  mode: PaymentMode,
  period: AnalyticsPeriodValue,
  customFrom = "",
  customTo = "",
) {
  const params = new URLSearchParams();
  params.set("mode", mode);
  if (period === "custom") {
    if (customFrom) params.set("from", customFrom);
    if (customTo) params.set("to", customTo);
  } else {
    params.set("period", period);
  }
  return `/analytics/payments?${params.toString()}`;
}
