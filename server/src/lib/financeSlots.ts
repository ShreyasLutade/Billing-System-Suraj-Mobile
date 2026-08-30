export type FinanceSlot = 1 | 2;

export function financeSlotAmounts(bill: {
  financeAmount?: number | null;
  financeAmount2?: number | null;
}) {
  const amount2 = Number(bill.financeAmount2 || 0);
  const amount1 = Math.max(Number(bill.financeAmount || 0) - amount2, 0);
  return {
    amount1: Math.round((amount1 + Number.EPSILON) * 100) / 100,
    amount2: Math.round((amount2 + Number.EPSILON) * 100) / 100,
  };
}

export function pendingFinanceAmount(bill: {
  financeAmount?: number | null;
  financeAmount2?: number | null;
  financeReceived?: boolean | null;
  financeReceived2?: boolean | null;
}) {
  const { amount1, amount2 } = financeSlotAmounts(bill);
  let pending = 0;
  if (amount1 > 0 && !bill.financeReceived) pending += amount1;
  if (amount2 > 0 && !bill.financeReceived2) pending += amount2;
  return Math.round((pending + Number.EPSILON) * 100) / 100;
}

export function isFinanceFullyReceived(bill: {
  financeAmount?: number | null;
  financeAmount2?: number | null;
  financeReceived?: boolean | null;
  financeReceived2?: boolean | null;
}) {
  const { amount1, amount2 } = financeSlotAmounts(bill);
  if (amount1 <= 0 && amount2 <= 0) return true;
  const slot1Ok = amount1 <= 0 || Boolean(bill.financeReceived);
  const slot2Ok = amount2 <= 0 || Boolean(bill.financeReceived2);
  return slot1Ok && slot2Ok;
}

export function hasPendingFinance(bill: {
  financeAmount?: number | null;
  financeAmount2?: number | null;
  financeReceived?: boolean | null;
  financeReceived2?: boolean | null;
}) {
  return pendingFinanceAmount(bill) > 0;
}
