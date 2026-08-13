import type { PrismaClient } from "@prisma/client";
import { exchangePurchaseNote } from "./stockSync";

export const RENUMBER_SHOP_CONFIRM = "SHOP_BILLS_FROM_3000";
const START = 3000;
/** Sequence increments before issuing, so counter 3003 → next bill 3004. */
const SEQUENCE_COUNTER_FOR_NEXT_3004 = 3003;

export async function renumberShopBillsFrom3000(
  prisma: PrismaClient,
  options: { apply: boolean },
) {
  const shopBills = await prisma.bill.findMany({
    where: { withGst: false },
    select: {
      id: true,
      invoiceNumber: true,
      customerName: true,
      billDate: true,
    },
    orderBy: [{ invoiceNumber: "asc" }],
  });

  const sequence = await prisma.invoiceSequence.findUnique({
    where: { id: 1 },
  });

  const planned = shopBills.map((bill, index) => {
    const yearMatch = bill.invoiceNumber.match(/^SMS-(\d{4})-/);
    const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
    const nextNumber = START + index;
    return {
      id: bill.id,
      customerName: bill.customerName,
      from: bill.invoiceNumber,
      to: `SMS-${year}-${String(nextNumber).padStart(4, "0")}`,
    };
  });

  const preview = {
    apply: options.apply,
    planned,
    shopSequenceBefore: sequence?.counter ?? null,
    shopSequenceAfter: SEQUENCE_COUNTER_FOR_NEXT_3004,
    nextShopInvoice: `SMS-${new Date().getFullYear()}-${String(SEQUENCE_COUNTER_FOR_NEXT_3004 + 1).padStart(4, "0")}`,
  };

  if (!options.apply) return preview;

  await prisma.$transaction(async (tx) => {
    for (const row of planned) {
      if (row.from === row.to) continue;
      const temp = `TMP-${row.id}`;
      await tx.bill.update({
        where: { id: row.id },
        data: { invoiceNumber: temp },
      });
    }
    for (const row of planned) {
      await tx.bill.update({
        where: { id: row.id },
        data: { invoiceNumber: row.to },
      });
      const oldNote = exchangePurchaseNote(row.from);
      const newNote = exchangePurchaseNote(row.to);
      await tx.purchase.updateMany({
        where: { note: oldNote },
        data: { note: newNote },
      });
    }
    await tx.invoiceSequence.upsert({
      where: { id: 1 },
      create: { id: 1, counter: SEQUENCE_COUNTER_FOR_NEXT_3004 },
      update: { counter: SEQUENCE_COUNTER_FOR_NEXT_3004 },
    });
  });

  const remaining = await prisma.bill.findMany({
    where: { withGst: false },
    select: { invoiceNumber: true, customerName: true },
    orderBy: { invoiceNumber: "asc" },
  });
  const afterSeq = await prisma.invoiceSequence.findUnique({
    where: { id: 1 },
  });

  return {
    ...preview,
    remaining,
    shopSequenceNow: afterSeq?.counter ?? null,
  };
}
