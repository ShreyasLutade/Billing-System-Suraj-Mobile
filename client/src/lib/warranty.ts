/**
 * Warranty is free text ("1 year", "6 months", "No warranty"). Older bills
 * only have a number of months, shown as "N months".
 */
export function warrantyText(item: {
  warranty?: string | null;
  warrantyMonths?: number | null;
}) {
  const text = item.warranty?.trim();
  if (text) return text;
  const months = item.warrantyMonths;
  if (!months) return "";
  return `${months} month${months === 1 ? "" : "s"}`;
}
