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
  return (await applyCreditTracked(tx, supplierId, amountPaise, preferPurchaseId)).applied;
}

/** One purchase a payment / credit went to: paise, and whether it cleared it. */
export type AppliedPart = { p: string; a: number; c: boolean };

/** Same as applyCreditToPurchases, also listing where the money went. */
export async function applyCreditTracked(
  tx: Tx,
  supplierId: string,
  amountPaise: number,
  preferPurchaseId?: string | null,
): Promise<{ applied: number; parts: AppliedPart[] }> {
  const parts: AppliedPart[] = [];
  if (amountPaise <= 0) return { applied: 0, parts };
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
    parts.push({ p: p.id, a: apply, c: newPaid >= totalPaise });
  }
  return { applied: amountPaise - left, parts };
}

/** Parse a payment's appliedJson (null / bad JSON = nothing recorded). */
export function readAppliedParts(json: string | null | undefined): AppliedPart[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as AppliedPart[]) : [];
  } catch {
    return [];
  }
}

/**
 * Advance paid to a supplier (paid more than was pending) is used up on their
 * unpaid purchases, oldest advance first; each payment keeps a record of
 * where it went so it can still be undone.
 */
export async function applyPendingAdvances(tx: Tx, supplierId: string) {
  const payments = await tx.supplierPayment.findMany({
    where: { supplierId, unapplied: { gt: 0 } },
    select: { id: true, unapplied: true, appliedJson: true },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
  });
  for (const pay of payments) {
    const leftPaise = toPaise(pay.unapplied);
    if (leftPaise <= 0) continue;
    const { applied, parts } = await applyCreditTracked(tx, supplierId, leftPaise);
    if (applied <= 0) break;
    await tx.supplierPayment.update({
      where: { id: pay.id },
      data: {
        unapplied: (leftPaise - applied) / 100,
        appliedJson: JSON.stringify([...readAppliedParts(pay.appliedJson), ...parts]),
      },
    });
  }
}

/**
 * Return credit that couldn't be applied when it was recorded (everything was
 * already paid) is used up as soon as the supplier has something unpaid again.
 */
export async function applyPendingReturnCredits(tx: Tx, supplierId: string) {
  await applyPendingReturnCreditsOnly(tx, supplierId);
  await applyPendingAdvances(tx, supplierId);
}

async function applyPendingReturnCreditsOnly(tx: Tx, supplierId: string) {
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
  // Suppliers with advance not yet used, but only if something is unpaid.
  const advances = await prisma.supplierPayment.findMany({
    where: {
      unapplied: { gt: 0 },
      ...(supplierId ? { supplierId } : {}),
      supplier: { purchases: { some: { paidAt: null } } },
    },
    select: { supplierId: true },
    distinct: ["supplierId"],
  });
  for (const a of advances) ids.add(a.supplierId);
  for (const id of ids) {
    await prisma.$transaction((tx) => applyPendingReturnCredits(tx, id));
  }
}
