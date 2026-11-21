/** ₹15,000 for whole rupees, ₹15,000.50 only when there are paise. */
export function formatRupees(amount: number) {
  const value = Math.round((amount || 0) * 100) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}
