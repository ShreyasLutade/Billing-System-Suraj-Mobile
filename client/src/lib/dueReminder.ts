import type { DueItem } from "../types";
import { formatRupees } from "./dueStatus";

const SHOP_NAME = "Suraj Mobile";
const SHOP_PHONE = "9516533556";

/** Bill phone → WhatsApp number with country code (India), or null. */
export function whatsappNumber(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null;
}

/** Short, polite due reminder: product and pending amount (WhatsApp *bold*). */
export function dueReminderMessage(due: DueItem) {
  const products = (due.productLabels ?? []).filter(Boolean);
  const product = products.length
    ? `${products[0]}${products.length > 1 ? ` + ${products.length - 1} more` : ""}`
    : null;

  return [
    `Namaste ${due.customerName} ji,`,
    "",
    `This is a gentle reminder from *${SHOP_NAME}*, Balaghat, about your pending payment.`,
    "",
    product ? `Product: ${product}` : null,
    `Pending amount: *${formatRupees(due.dueAmount)}*`,
    "",
    "Kindly clear the pending amount at the earliest. You can pay in cash at the shop or online.",
    "If you have already paid, please ignore this message.",
    "",
    "Thank you,",
    SHOP_NAME,
    `Ph: ${SHOP_PHONE}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Opens the customer's WhatsApp chat with the reminder typed in, or null. */
export function dueReminderLink(due: DueItem) {
  const number = whatsappNumber(due.customerPhone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(dueReminderMessage(due))}`;
}
