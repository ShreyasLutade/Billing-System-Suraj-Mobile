import { format } from "date-fns";
import type { DueItem } from "../types";
import { dueStatus, formatRupees } from "./dueStatus";

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

function day(value: string) {
  return format(new Date(value), "dd MMM yyyy");
}

/** Short, polite due reminder with the bill details (WhatsApp *bold*). */
export function dueReminderMessage(due: DueItem, now = new Date()) {
  const status = dueStatus(due.dueDate, now);
  const paid = Math.round((due.paidTotal ?? 0) * 100) / 100;
  const products = (due.productLabels ?? []).filter(Boolean);
  const product = products.length
    ? `${products[0]}${products.length > 1 ? ` + ${products.length - 1} more` : ""}`
    : null;

  let dueLine: string | null = null;
  if (due.dueDate) {
    if (status.urgency === "overdue") {
      dueLine = `Due date: ${day(due.dueDate)} (${status.days} day${status.days === 1 ? "" : "s"} overdue)`;
    } else if (status.urgency === "today") {
      dueLine = `Due date: Today, ${day(due.dueDate)}`;
    } else {
      dueLine = `Due date: ${day(due.dueDate)}`;
    }
  }

  return [
    `Namaste ${due.customerName} ji,`,
    "",
    `This is a gentle reminder from *${SHOP_NAME}*, Balaghat, about your pending payment.`,
    "",
    `Bill: ${due.invoiceNumber} (${day(due.billDate)})`,
    product ? `Product: ${product}` : null,
    `Pending amount: *${formatRupees(due.dueAmount)}*`,
    paid > 0
      ? `(Total due ${formatRupees(paid + due.dueAmount)} · Paid ${formatRupees(paid)})`
      : null,
    dueLine,
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
