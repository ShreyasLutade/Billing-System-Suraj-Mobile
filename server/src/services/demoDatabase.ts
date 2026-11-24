import path from "path";
import { spawn } from "child_process";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { demoDatabaseUrl, demoPrisma } from "../lib/prisma";
import { DEMO_PASSWORD, DEMO_PHONE, runWithTenant } from "../lib/tenant";

/**
 * The demo login's own database: created next to the real one when the
 * server starts (schema pushed with the Prisma CLI), with the demo admin
 * and some sample data so a demo doesn't start empty. The real database is
 * never touched here.
 */

let ready = false;
export function isDemoReady() {
  return ready;
}

const SERVER_ROOT = path.resolve(__dirname, "../..");

function pushSchema(url: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["prisma", "db", "push", "--skip-generate"], {
      cwd: SERVER_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`prisma db push failed (${code}): ${output.slice(-600)}`)),
    );
  });
}

/** `startupSeeds` = the same lookups the real database gets on start
 *  (finance companies, phone models), run against the demo database. */
export async function prepareDemoDatabase(startupSeeds?: () => Promise<void>) {
  const url = demoDatabaseUrl();
  if (!url) return;
  try {
    await pushSchema(url);
    if (startupSeeds) await runWithTenant(true, startupSeeds);
    const db = demoPrisma();
    const admin = await db.user.findFirst({ where: { phone: DEMO_PHONE, role: "ADMIN" } });
    if (!admin) {
      await db.user.create({
        data: {
          phone: DEMO_PHONE,
          name: "Demo",
          role: "ADMIN",
          passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
        },
      });
    }
    if ((await db.bill.count()) === 0 && (await db.stockItem.count()) === 0) {
      await seedDemoData(db);
    }
    ready = true;
    console.log(`[demo] Demo database ready (${DEMO_PHONE})`);
  } catch (error) {
    console.error("[demo] Could not prepare the demo database:", error);
  }
}

/* ---------------------------------------------------------- sample data -- */

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
let imeiSeed = 350000000000000 + Math.floor(Math.random() * 1_000_000);
const nextImei = () => String((imeiSeed += 7919));

type Unit = { model: string; storage: string; color: string; platform: string; cost: number };

async function seedDemoData(db: PrismaClient) {
  const year = new Date().getFullYear();

  // Suppliers and stock -------------------------------------------------
  const suppliers = {
    mw: await db.supplier.create({ data: { name: "Mobile World Distributors", phone: "9876500011" } }),
    gt: await db.supplier.create({ data: { name: "Gupta Telecom", phone: "9876500022" } }),
  };

  async function purchase(
    supplier: { id: string; name: string },
    when: Date,
    units: Unit[],
    paid: "full" | number,
  ) {
    const total = units.reduce((s, u) => s + u.cost, 0);
    const p = await db.purchase.create({
      data: {
        supplierId: supplier.id,
        purchaseDate: when,
        totalAmount: total,
        condition: "NEW",
        ...(paid === "full" ? { paidAt: when, paidAmount: total } : { paidAmount: paid }),
      },
    });
    if (paid === "full") {
      await db.supplierPayment.create({
        data: { supplierId: supplier.id, amount: total, method: "online", paidAt: when, purchaseId: p.id, note: "Online at purchase" },
      });
    } else if (paid > 0) {
      await db.supplierPayment.create({
        data: { supplierId: supplier.id, amount: paid, method: "cash", paidAt: when, purchaseId: p.id, note: "Cash at purchase" },
      });
    }
    const items = [];
    for (const u of units) {
      const stock = await db.stockItem.create({
        data: {
          condition: "NEW",
          platform: u.platform,
          mobileName: u.model,
          storage: u.storage,
          color: u.color,
          imei: nextImei(),
          purchasePrice: u.cost,
          supplierId: supplier.id,
          suppliers: JSON.stringify([supplier.name]),
          createdAt: when,
          createdByName: "Demo",
        },
      });
      await db.purchaseItem.create({ data: { purchaseId: p.id, stockItemId: stock.id } });
      items.push(stock);
    }
    return items;
  }

  const a = (model: string, storage: string, color: string, cost: number): Unit => ({
    model,
    storage,
    color,
    platform: "ANDROID",
    cost,
  });
  const i = (model: string, storage: string, color: string, cost: number): Unit => ({
    model,
    storage,
    color,
    platform: "IOS",
    cost,
  });

  const lot1 = await purchase(
    suppliers.mw,
    daysAgo(34),
    [
      a("Samsung Galaxy A35 5G", "128GB", "Navy", 26500),
      a("Samsung Galaxy A35 5G", "128GB", "Lilac", 26500),
      a("Samsung Galaxy A35 5G", "256GB", "Navy", 29500),
      a("Redmi 13C", "128GB", "Black", 8800),
      a("Redmi 13C", "128GB", "Green", 8800),
      a("Redmi 13C", "128GB", "Black", 8800),
      a("Redmi 13C", "64GB", "Blue", 7600),
      a("Vivo T3 5G", "128GB", "Black", 17500),
      a("Vivo T3 5G", "128GB", "Gold", 17500),
      a("Vivo T3 5G", "256GB", "Black", 19500),
    ],
    100000,
  );
  const lot2 = await purchase(
    suppliers.gt,
    daysAgo(16),
    [
      i("iPhone 15", "128GB", "Black", 62000),
      i("iPhone 15", "128GB", "Blue", 62000),
      i("iPhone 13", "128GB", "Midnight", 44000),
      a("Oppo A3x", "64GB", "Purple", 10800),
      a("Oppo A3x", "128GB", "Blue", 11800),
      a("Oppo A3x", "128GB", "Purple", 11800),
    ],
    "full",
  );

  // Bills ------------------------------------------------------------------
  let seq = 0;
  async function bill(input: {
    day: number;
    name: string;
    phone: string;
    units: Array<{ stock: (typeof lot1)[number]; price: number }>;
    cash?: number;
    online?: number;
    finance?: { amount: number; company: string };
    due?: { amount: number; dueInDays: number; paidLater?: number };
  }) {
    seq += 1;
    const total = input.units.reduce((s, u) => s + u.price, 0);
    const when = daysAgo(input.day);
    const paidLater = input.due?.paidLater ?? 0;
    const created = await db.bill.create({
      data: {
        invoiceNumber: `SMS-${year}-${String(seq).padStart(4, "0")}`,
        billDate: when,
        createdAt: when,
        customerName: input.name,
        customerPhone: input.phone,
        withGst: false,
        subtotal: total,
        gstAmount: 0,
        grandTotal: total,
        payableAmount: total,
        cashAmount: (input.cash ?? 0) + paidLater,
        onlineAmount: input.online ?? 0,
        financeAmount: input.finance?.amount ?? 0,
        financeCompanyName: input.finance?.company ?? null,
        dueAmount: input.due ? input.due.amount - paidLater : 0,
        dueDate: input.due ? new Date(when.getTime() + input.due.dueInDays * DAY) : null,
        dueSettled: false,
        isPartialPaid: Boolean(input.due && (input.cash || input.online || paidLater)),
        createdByName: "Demo",
        createdByRole: "ADMIN",
        items: {
          create: input.units.map((u) => ({
            productName: u.stock.mobileName,
            stockItemId: u.stock.id,
            platform: u.stock.platform,
            color: u.stock.color,
            storage: u.stock.storage,
            condition: "NEW",
            quantity: 1,
            rate: u.price,
            amount: u.price,
            imei1: u.stock.imei,
          })),
        },
        ...(paidLater > 0
          ? {
              duePayments: {
                create: {
                  amount: paidLater,
                  method: "cash",
                  kind: "partial",
                  paidAt: new Date(when.getTime() + 6 * DAY),
                },
              },
            }
          : {}),
      },
    });
    for (const u of input.units) {
      await db.stockItem.update({ where: { id: u.stock.id }, data: { status: "SOLD" } });
    }
    return created;
  }

  await bill({ day: 28, name: "Rakesh Sharma", phone: "9000000101", units: [{ stock: lot1[0], price: 29999 }], cash: 29999 });
  await bill({ day: 22, name: "Pooja Verma", phone: "9000000102", units: [{ stock: lot1[3], price: 10499 }], online: 10499 });
  await bill({
    day: 20,
    name: "Amit Patel",
    phone: "9000000103",
    units: [{ stock: lot1[7], price: 19999 }],
    cash: 7999,
    due: { amount: 12000, dueInDays: 10, paidLater: 4000 },
  });
  await bill({
    day: 14,
    name: "Neha Gupta",
    phone: "9000000104",
    units: [{ stock: lot2[0], price: 69900 }],
    cash: 9900,
    finance: { amount: 60000, company: "Bajaj Finance" },
  });
  await bill({ day: 9, name: "Sunil Yadav", phone: "9000000105", units: [{ stock: lot1[4], price: 10499 }], cash: 10499 });
  await bill({
    day: 6,
    name: "Kavita Singh",
    phone: "9000000106",
    units: [{ stock: lot2[3], price: 12999 }],
    online: 6999,
    due: { amount: 6000, dueInDays: 12 },
  });
  await bill({ day: 3, name: "Rohit Jain", phone: "9000000107", units: [{ stock: lot1[8], price: 19999 }], online: 15000, cash: 4999 });
  await bill({ day: 1, name: "Manish Tiwari", phone: "9000000108", units: [{ stock: lot2[2], price: 48999 }], cash: 48999 });
  await bill({ day: 0, name: "Sneha Mishra", phone: "9000000109", units: [{ stock: lot1[5], price: 10499 }], online: 10499 });

  // New bills continue the invoice numbers after the sample ones.
  await db.invoiceSequence.upsert({
    where: { id: 1 },
    create: { id: 1, counter: seq },
    update: { counter: seq },
  });

  // Khata entry without a purchase -------------------------------------
  await db.bill.create({
    data: {
      invoiceNumber: `KH-DEMO${Date.now().toString(36).toUpperCase()}`,
      billDate: daysAgo(8),
      customerName: "Rahul Verma",
      customerPhone: "9000000110",
      withGst: false,
      noPurchase: true,
      subtotal: 0,
      gstAmount: 0,
      grandTotal: 0,
      payableAmount: 0,
      dueAmount: 2000,
      dueDate: daysAgo(-7),
      dueCharges: { create: { amount: 2000, note: "Cash lent", givenAt: daysAgo(8) } },
    },
  });

  // Cash / Online books and expenses ------------------------------------
  const month = (n: number) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() - n, 1, 12);
  };
  await db.moneyEntry.createMany({
    data: [
      { book: "CASH", kind: "OPENING", amount: 15000, note: "Opening balance", entryDate: daysAgo(30) },
      { book: "CASH", kind: "IN", amount: 29999, category: "Sale", entryDate: daysAgo(28) },
      { book: "CASH", kind: "OUT", amount: 20000, category: "To bank", entryDate: daysAgo(25) },
      { book: "CASH", kind: "IN", amount: 10499, category: "Sale", entryDate: daysAgo(9) },
      { book: "CASH", kind: "OUT", amount: 1500, category: "Expense", note: "Electricity", entryDate: daysAgo(5) },
      { book: "ONLINE", kind: "OPENING", amount: 0, note: "Opening balance", entryDate: daysAgo(30) },
      { book: "ONLINE", kind: "IN", amount: 10499, category: "Sale", note: "UPI", entryDate: daysAgo(22) },
      { book: "ONLINE", kind: "OUT", amount: 8000, category: "Supplier", note: "Gupta Telecom", entryDate: daysAgo(16) },
      { book: "EXPENSE", kind: "OUT", amount: 8000, category: "rent", method: "online", note: "Shop rent", entryDate: month(0) },
      { book: "EXPENSE", kind: "OUT", amount: 1500, category: "electricity", method: "cash", entryDate: daysAgo(5) },
      { book: "EXPENSE", kind: "OUT", amount: 6000, category: "salary", method: "cash", note: "Helper", entryDate: daysAgo(2) },
      { book: "EXPENSE", kind: "OUT", amount: 350, category: "tea", method: "cash", entryDate: daysAgo(1) },
      { book: "EXPENSE", kind: "OUT", amount: 8000, category: "rent", method: "online", note: "Shop rent", entryDate: month(1) },
      { book: "EXPENSE", kind: "OUT", amount: 1380, category: "electricity", method: "cash", entryDate: month(1) },
      { book: "EXPENSE", kind: "OUT", amount: 6000, category: "salary", method: "cash", entryDate: month(1) },
    ],
  });
}
