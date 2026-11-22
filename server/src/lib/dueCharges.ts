import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * "You gave" amounts on a bill's due that are still unpaid: every entry
 * minus what later payments cleared of them. They are part of the bill's
 * dueAmount but never part of the bill's own cash / online / card.
 */
export async function outstandingCharges(db: Db, billId: string) {
  return Math.max(await chargeBalance(db, billId), 0);
}

/**
 * Signed part of a due that isn't the bill's own: "You gave" entries minus
 * payments beyond the bill (chargePart). Below 0 = extra money received,
 * kept as an advance. Bill's own due = dueAmount − this.
 */
export async function chargeBalance(db: Db, billId: string) {
  const [charges, paid] = await Promise.all([
    db.dueCharge.aggregate({ where: { billId }, _sum: { amount: true } }),
    db.duePayment.aggregate({ where: { billId }, _sum: { chargePart: true } }),
  ]);
  return round2((charges._sum.amount ?? 0) - (paid._sum.chargePart ?? 0));
}

/**
 * Split a due payment: the bill's own due first (it came first), anything
 * over that clears "You gave" amounts. Only `billPart` goes on the bill's
 * cash / online / card, so the bill never shows more paid than it costs.
 */
export function splitDuePayment(amount: number, dueAmount: number, extraBalance: number) {
  // Bill's own due = balance − the signed "You gave" / advance part.
  const billDue = Math.max(round2(dueAmount - extraBalance), 0);
  const billPart = round2(Math.min(amount, billDue));
  return { billPart, chargePart: round2(Math.max(amount - billPart, 0)) };
}
