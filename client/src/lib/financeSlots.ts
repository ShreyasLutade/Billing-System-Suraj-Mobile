export type FinanceSlot = 1 | 2;

export type FinanceSlotBill = {
  financeAmount?: number | null;
  financeAmount2?: number | null;
  financeCompanyName?: string | null;
  financeCompanyName2?: string | null;
  financeReceived?: boolean | null;
  financeReceived2?: boolean | null;
  financeReceivedAt?: string | null;
  financeReceivedAt2?: string | null;
};

export type FinanceSlotOption = {
  slot: FinanceSlot;
  label: string;
  amount: number;
  received: boolean;
  receivedAt?: string | null;
};

export function financeSlotAmounts(bill: FinanceSlotBill) {
  const amount2 = Number(bill.financeAmount2 || 0);
  const amount1 = Math.max(Number(bill.financeAmount || 0) - amount2, 0);
  return {
    amount1: Math.round((amount1 + Number.EPSILON) * 100) / 100,
    amount2: Math.round((amount2 + Number.EPSILON) * 100) / 100,
  };
}

export function pendingFinanceAmount(bill: FinanceSlotBill) {
  const { amount1, amount2 } = financeSlotAmounts(bill);
  let pending = 0;
  if (amount1 > 0 && !bill.financeReceived) pending += amount1;
  if (amount2 > 0 && !bill.financeReceived2) pending += amount2;
  return Math.round((pending + Number.EPSILON) * 100) / 100;
}

export function isFinanceFullyReceived(bill: FinanceSlotBill) {
  const { amount1, amount2 } = financeSlotAmounts(bill);
  if (amount1 <= 0 && amount2 <= 0) return true;
  const slot1Ok = amount1 <= 0 || Boolean(bill.financeReceived);
  const slot2Ok = amount2 <= 0 || Boolean(bill.financeReceived2);
  return slot1Ok && slot2Ok;
}

export function hasPendingFinance(bill: FinanceSlotBill) {
  return pendingFinanceAmount(bill) > 0;
}

export function hasReceivedFinance(bill: FinanceSlotBill) {
  const { amount1, amount2 } = financeSlotAmounts(bill);
  return (
    (amount1 > 0 && Boolean(bill.financeReceived)) ||
    (amount2 > 0 && Boolean(bill.financeReceived2))
  );
}

export function financeSlotOptions(
  bill: FinanceSlotBill,
  mode: "receive" | "undo" = "receive",
): FinanceSlotOption[] {
  const { amount1, amount2 } = financeSlotAmounts(bill);
  const options: FinanceSlotOption[] = [];

  if (amount1 > 0) {
    const received = Boolean(bill.financeReceived);
    if ((mode === "receive" && !received) || (mode === "undo" && received)) {
      options.push({
        slot: 1,
        label: bill.financeCompanyName?.trim() || "Finance 1",
        amount: amount1,
        received,
        receivedAt: bill.financeReceivedAt ?? null,
      });
    }
  }

  if (amount2 > 0) {
    const received = Boolean(bill.financeReceived2);
    if ((mode === "receive" && !received) || (mode === "undo" && received)) {
      options.push({
        slot: 2,
        label: bill.financeCompanyName2?.trim() || "Finance 2",
        amount: amount2,
        received,
        receivedAt: bill.financeReceivedAt2 ?? null,
      });
    }
  }

  return options;
}

export function slotsMatchingCompany(
  bill: FinanceSlotBill,
  company: string | null,
): FinanceSlot[] {
  if (!company) return [];
  const { amount1, amount2 } = financeSlotAmounts(bill);
  const name1 = bill.financeCompanyName?.trim() || "";
  const name2 = bill.financeCompanyName2?.trim() || "";
  const slots: FinanceSlot[] = [];
  if (company === "Unknown company") {
    if (!name1 && !name2 && amount1 + amount2 > 0) {
      if (amount1 > 0) slots.push(1);
      if (amount2 > 0) slots.push(2);
    }
    return slots;
  }
  if (name1 === company && amount1 > 0) slots.push(1);
  if (name2 === company && amount2 > 0) slots.push(2);
  return slots;
}
