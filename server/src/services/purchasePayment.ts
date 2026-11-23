import type { Prisma } from "@prisma/client";
import { z } from "zod";

type Tx = Prisma.TransactionClient;

const toPaise = (value: number) => Math.round((value || 0) * 100);

/**
 * How much of a new purchase was paid while entering it.
 * FULL = everything (nothing outstanding), UNPAID = nothing,
 * CUSTOM = `amount` now, the rest stays outstanding.
 */
export const paymentAtPurchaseSchema = z
  .object({
    mode: z.enum(["FULL", "UNPAID", "CUSTOM"]),
    amount: z.coerce.number().finite().min(0).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "CUSTOM" && !(Number(data.amount) > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter the amount paid",
        path: ["amount"],
      });
    }
  });

export type PaymentAtPurchase = z.infer<typeof paymentAtPurchaseSchema>;

/** Error message when the paid amount can't be used for this total, else null. */
export function paymentAtPurchaseError(
  payment: PaymentAtPurchase | null | undefined,
  total: number,
) {
  if (payment?.mode !== "CUSTOM") return null;
  if (toPaise(payment.amount ?? 0) > toPaise(total)) {
    return `Paid amount is more than the Rs. ${total.toLocaleString("en-IN")} purchase total`;
  }
  return null;
}

function atPurchaseNote(full: boolean) {
  return full ? "Paid in full at purchase" : "Part paid at purchase";
}

/**
 * Record what was paid while entering a purchase: marks the purchase paid
 * (or part paid) and adds a dated supplier payment linked to it, so the
 * statement shows it as paid at purchase.
 */
export async function recordPaymentAtPurchase(
  tx: Tx,
  purchase: { id: string; supplierId: string; totalAmount: number; purchaseDate: Date },
  payment: PaymentAtPurchase | null | undefined,
) {
  if (!payment || payment.mode === "UNPAID") return;
  const totalPaise = toPaise(purchase.totalAmount);
  const paidPaise =
    payment.mode === "FULL"
      ? totalPaise
      : Math.min(toPaise(payment.amount ?? 0), totalPaise);
  if (paidPaise <= 0) return;

  const full = paidPaise >= totalPaise;
  await tx.purchase.update({
    where: { id: purchase.id },
    data: full
      ? { paidAt: purchase.purchaseDate, paidAmount: purchase.totalAmount }
      : { paidAmount: paidPaise / 100 },
  });
  await tx.supplierPayment.create({
    data: {
      supplierId: purchase.supplierId,
      purchaseId: purchase.id,
      amount: paidPaise / 100,
      method: "na",
      paidAt: purchase.purchaseDate,
      note: atPurchaseNote(full),
    },
  });
}

/**
 * Change a purchase's total after a unit's price is edited or a unit is
 * removed, keeping any payment made at purchase consistent:
 * - paid in full at purchase stays paid in full at the new total;
 * - a payment can never be more than the purchase total (the excess comes
 *   off the at-purchase payment);
 * - a purchase cleared by several payments goes back to part paid if its
 *   total goes up.
 */
export async function setPurchaseTotal(tx: Tx, purchaseId: string, newTotal: number) {
  const purchase = await tx.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      totalAmount: true,
      paidAt: true,
      paidAmount: true,
      payments: { select: { id: true, amount: true } },
    },
  });
  if (!purchase) return;
  const atPurchase = purchase.payments[0];
  const newPaise = toPaise(newTotal);
  const total = newPaise / 100;
  if (!atPurchase) {
    await tx.purchase.update({ where: { id: purchaseId }, data: { totalAmount: total } });
    return;
  }

  const oldPaise = toPaise(purchase.totalAmount);
  const paidPaise = purchase.paidAt
    ? oldPaise
    : Math.min(toPaise(purchase.paidAmount), oldPaise);
  const atPaise = toPaise(atPurchase.amount);

  let paymentPaise = atPaise;
  let data: Prisma.PurchaseUpdateInput;
  if (purchase.paidAt && atPaise >= paidPaise) {
    paymentPaise = newPaise;
    data = { totalAmount: total, paidAmount: total };
  } else if (paidPaise >= newPaise) {
    paymentPaise = Math.max(atPaise - (paidPaise - newPaise), 0);
    data = { totalAmount: total, paidAmount: total, paidAt: purchase.paidAt ?? new Date() };
  } else {
    data = { totalAmount: total, paidAmount: paidPaise / 100, paidAt: null };
  }

  await tx.purchase.update({ where: { id: purchaseId }, data });
  if (paymentPaise <= 0) {
    await tx.supplierPayment.delete({ where: { id: atPurchase.id } });
  } else if (paymentPaise !== atPaise) {
    await tx.supplierPayment.update({
      where: { id: atPurchase.id },
      data: {
        amount: paymentPaise / 100,
        note: atPurchaseNote(paymentPaise >= newPaise),
      },
    });
  }
}
