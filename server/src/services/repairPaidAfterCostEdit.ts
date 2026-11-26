import type { PrismaClient } from "@prisma/client";
import { applyPendingAdvances, readAppliedParts } from "./productReturns";

const toPaise = (value: number) => Math.round((value || 0) * 100);

/**
 * Before the fix in setPurchaseTotal, raising a unit's cost on a purchase
 * that was already paid (from the Dues page) kept it "paid in full", as if
 * the extra had been paid too. Find those purchases: marked paid, but the
 * payments recorded against them add up to less than the bill. Put them
 * back to part paid by what was really paid, so the difference is due.
 *
 * Only suppliers whose every payment records where it went are checked
 * (older "Mark paid" payments and return credit don't say which purchase
 * they paid, so a gap there can be real money and is left alone).
 */
export async function repairPaidAfterCostEdit(prisma: PrismaClient) {
  const details: Array<{ supplier: string; purchaseDate: Date; total: number; paid: number }> = [];
  const suppliers = await prisma.supplier.findMany({
    where: { purchases: { some: { paidAt: { not: null } } } },
    select: {
      id: true,
      name: true,
      payments: {
        select: { id: true, amount: true, unapplied: true, appliedJson: true, purchaseId: true },
      },
      productReturns: { select: { creditApplied: true } },
      purchases: {
        where: { paidAt: { not: null } },
        select: { id: true, totalAmount: true, purchaseDate: true },
      },
    },
  });

  for (const supplier of suppliers) {
    const untracked = supplier.payments.some((p) => p.appliedJson === null && !p.purchaseId);
    const returnCredit = supplier.productReturns.some((r) => r.creditApplied > 0.005);
    if (untracked || returnCredit) continue;

    // Money each purchase really got: payments at purchase + Dues payments.
    const paidTo = new Map<string, number>();
    for (const pay of supplier.payments) {
      if (pay.purchaseId) {
        const atPurchase = toPaise(pay.amount) - toPaise(pay.unapplied);
        paidTo.set(pay.purchaseId, (paidTo.get(pay.purchaseId) ?? 0) + atPurchase);
      }
      for (const part of readAppliedParts(pay.appliedJson)) {
        paidTo.set(part.p, (paidTo.get(part.p) ?? 0) + part.a);
      }
    }

    const fixes = supplier.purchases.filter((p) => {
      const paid = paidTo.get(p.id) ?? 0;
      // Paid before payments were recorded at all: nothing to compare with.
      return paid > 0 && paid < toPaise(p.totalAmount) - 50;
    });
    if (!fixes.length) continue;

    await prisma.$transaction(async (tx) => {
      for (const p of fixes) {
        const paid = paidTo.get(p.id) ?? 0;
        await tx.purchase.update({
          where: { id: p.id },
          data: { paidAmount: paid / 100, paidAt: null },
        });
        details.push({
          supplier: supplier.name,
          purchaseDate: p.purchaseDate,
          total: p.totalAmount,
          paid: paid / 100,
        });
      }
      // Advance waiting with this supplier pays the reopened amount.
      await applyPendingAdvances(tx, supplier.id);
    });
  }
  return { repaired: details.length, details };
}
