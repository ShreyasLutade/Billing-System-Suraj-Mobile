import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

type Tx = Prisma.TransactionClient;

const toPaise = (value: number) => Math.round((value || 0) * 100);

/**
 * Apply up to `amountPaise` of supplier credit to that supplier's unpaid
 * purchases, the same way a payment is applied (paidAmount / paidAt).
 * `preferPurchaseId` is cleared first (the purchase a returned unit came in
 * on), then the oldest unpaid purchases. Returns the paise actually applied.
 */
export async function applyCreditToPurchases(
  tx: Tx,
  supplierId: string,
  amountPaise: number,
  preferPurchaseId?: string | null,
) {
  if (amountPaise <= 0) return 0;
  const unpaid = await tx.purchase.findMany({
    where: { supplierId, paidAt: null },
    select: { id: true, totalAmount: true, paidAmount: true },
    orderBy: [{ purchaseDate: "asc" }, { createdAt: "asc" }],
  });
  const ordered = preferPurchaseId
    ? [
        ...unpaid.filter((p) => p.id === preferPurchaseId),
        ...unpaid.filter((p) => p.id !== preferPurchaseId),
      ]
    : unpaid;

  let left = amountPaise;
  const now = new Date();
  for (const p of ordered) {
    if (left <= 0) break;
    const totalPaise = toPaise(p.totalAmount);
    const paidPaise = Math.min(toPaise(p.paidAmount), totalPaise);
    const open = totalPaise - paidPaise;
    if (open <= 0) continue;
    const apply = Math.min(open, left);
    left -= apply;
    const newPaid = paidPaise + apply;
    await tx.purchase.update({
      where: { id: p.id },
      data:
        newPaid >= totalPaise
          ? { paidAt: now, paidAmount: p.totalAmount }
          : { paidAmount: newPaid / 100 },
    });
  }
  return amountPaise - left;
}

/**
 * Return credit that couldn't be applied when it was recorded (everything was
 * already paid) is used up as soon as the supplier has something unpaid again.
 */
export async function applyPendingReturnCredits(tx: Tx, supplierId: string) {
  const pending = await tx.productReturn.findMany({
    where: { supplierId },
    select: { id: true, amount: true, creditApplied: true },
    orderBy: { createdAt: "asc" },
  });
  for (const r of pending) {
    const leftPaise = toPaise(r.amount) - toPaise(r.creditApplied);
    if (leftPaise <= 0) continue;
    const applied = await applyCreditToPurchases(tx, supplierId, leftPaise);
    if (applied <= 0) break;
    await tx.productReturn.update({
      where: { id: r.id },
      data: { creditApplied: (toPaise(r.creditApplied) + applied) / 100 },
    });
  }
}

/** Same as above for callers outside a transaction (cheap when nothing is pending). */
export async function settlePendingReturnCredits(supplierId?: string) {
  const suppliers = await prisma.productReturn.findMany({
    where: supplierId ? { supplierId } : {},
    select: { supplierId: true, amount: true, creditApplied: true },
  });
  const ids = new Set(
    suppliers
      .filter((r) => r.supplierId && toPaise(r.amount) > toPaise(r.creditApplied))
      .map((r) => r.supplierId as string),
  );
  for (const id of ids) {
    await prisma.$transaction((tx) => applyPendingReturnCredits(tx, id));
  }
}
