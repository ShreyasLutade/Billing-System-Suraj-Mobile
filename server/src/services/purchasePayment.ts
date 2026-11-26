import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { format } from "date-fns";
import { applyPendingAdvances, readAppliedParts } from "./productReturns";

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
 * removed. The money already paid stays what it was, so the change shows
 * in what is owed:
 * - total goes up: the difference is due again (or comes out of advance);
 * - total goes down below what was paid: the extra is kept as advance
 *   (used on the next stock from this supplier).
 * The one exception is "Fully paid" chosen while entering the purchase: that
 * paid whatever the bill was, so it stays paid in full at the new total.
 */
export async function setPurchaseTotal(tx: Tx, purchaseId: string, newTotal: number) {
  const purchase = await tx.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      supplierId: true,
      totalAmount: true,
      paidAt: true,
      paidAmount: true,
      purchaseDate: true,
      updatedAt: true,
      payments: {
        select: { id: true, amount: true, unapplied: true, note: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!purchase) return;
  const newPaise = toPaise(newTotal);
  const total = newPaise / 100;
  const oldPaise = toPaise(purchase.totalAmount);
  const paidPaise = purchase.paidAt
    ? oldPaise
    : Math.min(toPaise(purchase.paidAmount), oldPaise);
  const atPurchase = purchase.payments[0];

  // "Fully paid" at purchase: the payment follows the bill.
  if (
    atPurchase &&
    purchase.paidAt &&
    atPurchase.note === atPurchaseNote(true) &&
    toPaise(atPurchase.amount) >= paidPaise
  ) {
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { totalAmount: total, paidAmount: total },
    });
    if (newPaise <= 0) {
      await tx.supplierPayment.delete({ where: { id: atPurchase.id } });
    } else if (newPaise !== toPaise(atPurchase.amount)) {
      await tx.supplierPayment.update({
        where: { id: atPurchase.id },
        data: { amount: total },
      });
    }
    return;
  }

  if (newPaise >= paidPaise) {
    // Same money paid against a bigger (or equal) bill.
    const full = paidPaise > 0 && paidPaise >= newPaise;
    await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        totalAmount: total,
        paidAmount: paidPaise / 100,
        paidAt: full ? (purchase.paidAt ?? new Date()) : null,
      },
    });
    if (atPurchase) {
      const note = atPurchaseNote(full);
      if (atPurchase.note !== note && atPurchase.note?.endsWith("at purchase")) {
        await tx.supplierPayment.update({ where: { id: atPurchase.id }, data: { note } });
      }
    }
  } else {
    // Paid more than the new bill: the purchase is paid, the rest is advance.
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { totalAmount: total, paidAmount: total, paidAt: purchase.paidAt ?? new Date() },
    });
    await keepExtraAsAdvance(tx, purchase, paidPaise - newPaise);
  }
  // Advance waiting with this supplier pays a bill that went up.
  await applyPendingAdvances(tx, purchase.supplierId);
}

/**
 * `extraPaise` that was paid on a purchase is no longer needed there (its
 * total went down): keep it as advance on the payments that paid it.
 */
async function keepExtraAsAdvance(
  tx: Tx,
  purchase: {
    id: string;
    supplierId: string;
    paidAt: Date | null;
    updatedAt: Date;
    purchaseDate: Date;
    payments: Array<{ id: string; amount: number; unapplied: number }>;
  },
  extraPaise: number,
) {
  let left = extraPaise;
  /** Take up to `cap` paise of the extra onto this payment's advance. */
  const take = (pay: { amount: number; unapplied: number }, cap = Number.POSITIVE_INFINITY) => {
    const room = toPaise(pay.amount) - toPaise(pay.unapplied);
    const move = Math.max(Math.min(left, room, cap), 0);
    left -= move;
    return move;
  };

  // 1. Paid while entering this purchase.
  for (const pay of purchase.payments) {
    if (left <= 0) break;
    const move = take(pay);
    if (move > 0) {
      await tx.supplierPayment.update({
        where: { id: pay.id },
        data: { unapplied: (toPaise(pay.unapplied) + move) / 100 },
      });
    }
  }

  // 2. Dues-page payments that went to this purchase (latest first); their
  //    record of where the money went is reduced so Undo stays right.
  if (left > 0) {
    const pays = await tx.supplierPayment.findMany({
      where: { supplierId: purchase.supplierId, appliedJson: { contains: purchase.id } },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, amount: true, unapplied: true, appliedJson: true },
    });
    for (const pay of pays) {
      if (left <= 0) break;
      const parts = readAppliedParts(pay.appliedJson);
      let moved = 0;
      for (const part of parts) {
        if (part.p !== purchase.id || left <= 0) continue;
        const move = take(pay, part.a);
        if (move <= 0) continue;
        part.a -= move;
        part.c = false;
        moved += move;
        pay.unapplied = (toPaise(pay.unapplied) + move) / 100;
      }
      if (moved > 0) {
        await tx.supplierPayment.update({
          where: { id: pay.id },
          data: {
            unapplied: pay.unapplied,
            appliedJson: JSON.stringify(parts.filter((part) => part.a > 0)),
          },
        });
      }
    }
  }

  // 3. Older payments ("Mark paid"): any of this supplier's payments.
  if (left > 0) {
    const pays = await tx.supplierPayment.findMany({
      where: { supplierId: purchase.supplierId, purchaseId: null },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, amount: true, unapplied: true },
    });
    for (const pay of pays) {
      if (left <= 0) break;
      const move = take(pay);
      if (move > 0) {
        await tx.supplierPayment.update({
          where: { id: pay.id },
          data: { unapplied: (toPaise(pay.unapplied) + move) / 100 },
        });
      }
    }
  }

  // 4. Paid before payments were recorded at all: record the advance.
  if (left > 0) {
    await tx.supplierPayment.create({
      data: {
        supplierId: purchase.supplierId,
        amount: left / 100,
        unapplied: left / 100,
        method: "na",
        paidAt: purchase.paidAt ?? purchase.updatedAt,
        note: `Advance · price lowered on purchase of ${format(purchase.purchaseDate, "dd MMM yyyy")}`,
        appliedJson: "[]",
      },
    });
  }
}
