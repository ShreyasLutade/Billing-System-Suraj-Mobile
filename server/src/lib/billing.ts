import Decimal from "decimal.js";
import { z } from "zod";

export const money = (value: number | string | Decimal) =>
  new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Rate × qty is the final (GST-inclusive) line total. */
export function lineGstBreakdown(
  rate: number,
  quantity: number,
  gstPercent: number,
) {
  const amount = money(rate).mul(quantity);
  const divisor = money(100).plus(gstPercent);
  const base = amount.mul(100).div(divisor);
  const gstAmount = amount.minus(base);
  return { amount, base, gstAmount };
}

export const billItemSchema = z
  .object({
    productName: z.string().trim().min(1, "Product name is required"),
    mobileCatalogId: z.string().trim().optional().nullable(),
    platform: z.enum(["IOS", "ANDROID"]).optional().nullable(),
    color: z.string().trim().optional().nullable(),
    storage: z.string().trim().optional().nullable(),
    ram: z.string().trim().optional().nullable(),
    condition: z.enum(["NEW", "USED"]).optional().nullable(),
    quantity: z.number().int().positive().default(1),
    rate: z.number().nonnegative("Rate must be 0 or more"),
    gstPercent: z.number().min(0).max(100).default(0),
    imei1: z.string().trim().optional().nullable(),
    imei2: z.string().trim().optional().nullable(),
    serialNumber: z.string().trim().optional().nullable(),
    warrantyMonths: z.number().int().positive().optional().nullable(),
  })
  .superRefine((item, ctx) => {
    if (!item.platform) return;

    if (!item.color) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mobile color is required",
        path: ["color"],
      });
    }
    if (!item.storage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mobile storage is required",
        path: ["storage"],
      });
    }
    if (item.platform === "ANDROID" && !item.ram) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RAM is required for Android mobiles",
        path: ["ram"],
      });
    }
  });

export const createBillSchema = z
  .object({
    customerName: z.string().trim().min(1, "Customer name is required"),
    customerPhone: z
      .string()
      .trim()
      .regex(/^\d{10}$/, "Phone number must be 10 digits"),
    customerAddress: z.string().trim().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
    billDate: z
      .string()
      .trim()
      .optional()
      .nullable()
      .refine(
        (value) =>
          !value ||
          /^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isNaN(Date.parse(value)),
        "Invalid bill date",
      ),
    withGst: z.boolean().default(false),
    items: z.array(billItemSchema).min(1, "Add at least one product"),
    useCash: z.boolean().default(false),
    useOnline: z.boolean().default(false),
    useFinance: z.boolean().default(false),
    cashAmount: z.number().nonnegative().default(0),
    onlineAmount: z.number().nonnegative().default(0),
    financeAmount: z.number().nonnegative().default(0),
    financeCompanyId: z.string().trim().optional().nullable(),
    financeCompanyName: z.string().trim().optional().nullable(),
    financeAmount2: z.number().nonnegative().default(0),
    financeCompanyId2: z.string().trim().optional().nullable(),
    financeCompanyName2: z.string().trim().optional().nullable(),
    isExchange: z.boolean().default(false),
    exchangeModel: z.string().trim().optional().nullable(),
    exchangePlatform: z.enum(["IOS", "ANDROID"]).optional().nullable(),
    exchangeColor: z.string().trim().optional().nullable(),
    exchangeStorage: z.string().trim().optional().nullable(),
    exchangeRam: z.string().trim().optional().nullable(),
    exchangeImei1: z.string().trim().optional().nullable(),
    exchangeImei2: z.string().trim().optional().nullable(),
    exchangeSerial: z.string().trim().optional().nullable(),
    exchangeValue: z.number().nonnegative().optional().nullable(),
    exchangeNotes: z.string().trim().optional().nullable(),
    dueDate: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const cash = data.useCash ? money(data.cashAmount) : money(0);
    const online = data.useOnline ? money(data.onlineAmount) : money(0);
    const finance1 = data.useFinance ? money(data.financeAmount) : money(0);
    const finance2 =
      data.useFinance && money(data.financeAmount2).gt(0)
        ? money(data.financeAmount2)
        : money(0);
    const finance = finance1.plus(finance2);

    if (data.isExchange && !data.exchangeModel?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter exchange mobile name",
        path: ["exchangeModel"],
      });
    }
    if (data.isExchange && !data.exchangePlatform) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select exchange phone OS",
        path: ["exchangePlatform"],
      });
    }
    if (data.isExchange && !data.exchangeColor?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter exchange phone color",
        path: ["exchangeColor"],
      });
    }
    if (data.isExchange && !data.exchangeStorage?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter exchange phone storage",
        path: ["exchangeStorage"],
      });
    }
    if (
      data.isExchange &&
      data.exchangePlatform === "ANDROID" &&
      !data.exchangeRam?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter exchange phone RAM",
        path: ["exchangeRam"],
      });
    }

    if (
      data.isExchange &&
      (data.exchangeValue == null || money(data.exchangeValue).lt(0))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter exchange amount",
        path: ["exchangeValue"],
      });
    }

    if (data.useCash && cash.lte(0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter cash amount",
        path: ["cashAmount"],
      });
    }
    if (data.useOnline && online.lte(0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter online amount",
        path: ["onlineAmount"],
      });
    }
    if (data.useFinance && finance1.lte(0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter finance amount",
        path: ["financeAmount"],
      });
    }
    if (
      data.useFinance &&
      !data.financeCompanyId &&
      !data.financeCompanyName?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a finance company",
        path: ["financeCompanyId"],
      });
    }
    if (data.useFinance && finance2.gt(0)) {
      if (
        !data.financeCompanyId2 &&
        !data.financeCompanyName2?.trim()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Select a second finance company",
          path: ["financeCompanyId2"],
        });
      }
      const firstId = data.financeCompanyId?.trim() || "";
      const secondId = data.financeCompanyId2?.trim() || "";
      const firstName = data.financeCompanyName?.trim().toLowerCase() || "";
      const secondName = data.financeCompanyName2?.trim().toLowerCase() || "";
      if (
        (firstId && secondId && firstId === secondId) ||
        (firstName && secondName && firstName === secondName)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Choose two different finance companies",
          path: ["financeCompanyId2"],
        });
      }
    }

    const lineTotals = data.items.map((item) =>
      lineGstBreakdown(item.rate, item.quantity, item.gstPercent),
    );
    const grandTotal = lineTotals.reduce(
      (sum, row) => sum.plus(row.amount),
      money(0),
    );
    const exchangeDeduction =
      data.isExchange && data.exchangeValue != null
        ? money(data.exchangeValue)
        : money(0);

    if (exchangeDeduction.gt(grandTotal)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exchange amount cannot exceed bill total",
        path: ["exchangeValue"],
      });
    }

    const payableAmount = Decimal.max(grandTotal.minus(exchangeDeduction), 0);
    const paid = cash.plus(online).plus(finance);

    if (paid.gt(payableAmount)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Paid amount cannot exceed payable amount",
        path: ["cashAmount"],
      });
    }

    const due = payableAmount.minus(paid);
    if (due.gt(0) && !data.dueDate?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Due date is required when amount is pending",
        path: ["dueDate"],
      });
    }
  });

export type CreateBillInput = z.infer<typeof createBillSchema>;

export function computeBillTotals(input: CreateBillInput) {
  const items = input.items.map((item) => {
    const { amount, base, gstAmount } = lineGstBreakdown(
      item.rate,
      item.quantity,
      item.gstPercent,
    );
    return {
      ...item,
      imei1: item.imei1 || null,
      imei2: item.imei2 || null,
      serialNumber: item.serialNumber || null,
      warrantyMonths: item.warrantyMonths ?? null,
      amount: amount.toNumber(),
      base: base.toNumber(),
      gstAmount: gstAmount.toNumber(),
    };
  });

  const subtotal = items.reduce((sum, item) => sum.plus(item.base), money(0));
  const gstAmount = items.reduce((sum, item) => sum.plus(item.gstAmount), money(0));
  const grandTotal = items.reduce((sum, item) => sum.plus(item.amount), money(0));
  const exchangeDeduction =
    input.isExchange && input.exchangeValue != null
      ? money(input.exchangeValue)
      : money(0);
  const payableAmount = Decimal.max(grandTotal.minus(exchangeDeduction), 0);

  const cashAmount = input.useCash ? money(input.cashAmount) : money(0);
  const onlineAmount = input.useOnline ? money(input.onlineAmount) : money(0);
  const financeAmount1 = input.useFinance ? money(input.financeAmount) : money(0);
  const financeAmount2 =
    input.useFinance && money(input.financeAmount2 || 0).gt(0)
      ? money(input.financeAmount2 || 0)
      : money(0);
  const financeTotal = financeAmount1.plus(financeAmount2);
  const paid = cashAmount.plus(onlineAmount).plus(financeTotal);
  const dueAmount = Decimal.max(payableAmount.minus(paid), 0);

  return {
    items,
    subtotal: subtotal.toNumber(),
    gstAmount: gstAmount.toNumber(),
    grandTotal: grandTotal.toNumber(),
    exchangeDeduction: exchangeDeduction.toNumber(),
    payableAmount: payableAmount.toNumber(),
    cashAmount: cashAmount.toNumber(),
    onlineAmount: onlineAmount.toNumber(),
    /** Total finance (company 1 + company 2) — stored on Bill.financeAmount */
    financeAmount: financeTotal.toNumber(),
    /** Second company amount only — stored on Bill.financeAmount2 */
    financeAmount2: financeAmount2.toNumber(),
    dueAmount: dueAmount.toNumber(),
  };
}
