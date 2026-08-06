/**
 * Mark a few demo stock units as sold and create linked bills for testing.
 * Run after seedDemoSuppliers.ts: npx tsx scripts/seedDemoSales.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function sellUnit(input: {
  imei: string;
  customerName: string;
  customerPhone: string;
  salePrice: number;
}) {
  const stock = await prisma.stockItem.findUnique({
    where: { imei: input.imei },
  });
  if (!stock) {
    console.warn("Skip missing stock", input.imei);
    return null;
  }
  if (stock.status === "SOLD") {
    const existing = await prisma.billItem.findFirst({
      where: { stockItemId: stock.id },
      select: { billId: true },
    });
    console.warn("Already sold", input.imei, existing?.billId);
    return existing?.billId || null;
  }

  const rate = input.salePrice;
  const amount = rate;

  return prisma.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const sequence = await tx.invoiceSequence.upsert({
      where: { id: 1 },
      create: { id: 1, counter: 1 },
      update: { counter: { increment: 1 } },
    });
    const invoiceNumber = `SMS-${year}-${String(sequence.counter).padStart(4, "0")}`;

    const bill = await tx.bill.create({
      data: {
        invoiceNumber,
        billDate: new Date(),
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerAddress: "Kolhapur",
        withGst: false,
        subtotal: amount,
        gstAmount: 0,
        grandTotal: amount,
        payableAmount: amount,
        cashAmount: amount,
        onlineAmount: 0,
        financeAmount: 0,
        financeAmount2: 0,
        dueAmount: 0,
        notes: "Demo sale from stock",
        items: {
          create: [
            {
              productName: stock.mobileName,
              stockItemId: stock.id,
              platform: stock.platform,
              color: stock.color,
              storage: stock.storage,
              ram: stock.ram || null,
              condition: stock.condition,
              quantity: 1,
              rate,
              gstPercent: 0,
              amount,
              imei1: stock.imei,
            },
          ],
        },
      },
    });

    await tx.stockItem.update({
      where: { id: stock.id },
      data: { status: "SOLD" },
    });

    return bill.id;
  });
}

async function main() {
  const sales = [
    {
      imei: "359900000000401",
      customerName: "Amit Patil",
      customerPhone: "9876509001",
      salePrice: 78000,
    },
    {
      imei: "359900000000403",
      customerName: "Sneha Desai",
      customerPhone: "9876509002",
      salePrice: 69900,
    },
    {
      imei: "359900000000412",
      customerName: "Rahul Kulkarni",
      customerPhone: "9876509003",
      salePrice: 39900,
    },
    {
      imei: "359900000000501",
      customerName: "Priya Jadhav",
      customerPhone: "9876509004",
      salePrice: 32900,
    },
    {
      imei: "359900000000601",
      customerName: "Vikram Shah",
      customerPhone: "9876509005",
      salePrice: 89900,
    },
    {
      imei: "359900000000101",
      customerName: "Neha More",
      customerPhone: "9876509006",
      salePrice: 68900,
    },
  ];

  const results = [];
  for (const sale of sales) {
    const billId = await sellUnit(sale);
    results.push({ imei: sale.imei, billId, customer: sale.customerName });
  }

  const soldDemo = await prisma.stockItem.count({
    where: {
      imei: { startsWith: "359900000000" },
      status: "SOLD",
    },
  });

  console.log(JSON.stringify({ soldDemoUnits: soldDemo, results }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
