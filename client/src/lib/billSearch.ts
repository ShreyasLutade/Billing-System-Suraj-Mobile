/** Case-insensitive bill/due search by invoice, customer, phone, product, or IMEI. */

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function includesText(haystack: string, query: string) {
  return haystack.toLowerCase().includes(query);
}

export function matchesBillSearch(
  bill: {
    invoiceNumber: string;
    customerName: string;
    customerPhone: string;
    items?: Array<{
      productName?: string | null;
      color?: string | null;
      storage?: string | null;
      ram?: string | null;
      imei1?: string | null;
      imei2?: string | null;
      serialNumber?: string | null;
    }> | null;
    exchangeModel?: string | null;
    exchangeColor?: string | null;
    exchangeStorage?: string | null;
    exchangeRam?: string | null;
    exchangeImei1?: string | null;
    exchangeImei2?: string | null;
    exchangeSerial?: string | null;
  },
  rawQuery: string,
): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  const qDigits = digitsOnly(rawQuery);
  const phoneDigits = digitsOnly(bill.customerPhone);
  if (qDigits && phoneDigits.includes(qDigits)) return true;

  if (includesText(bill.invoiceNumber, query)) return true;
  if (includesText(bill.customerName, query)) return true;

  for (const item of bill.items || []) {
    const haystack = [
      item.productName,
      item.color,
      item.storage,
      item.ram,
      item.imei1,
      item.imei2,
      item.serialNumber,
    ]
      .filter(Boolean)
      .join(" ");
    const imeiDigits = `${item.imei1 || ""}${item.imei2 || ""}`.replace(
      /\D/g,
      "",
    );
    if (includesText(haystack, query)) return true;
    if (qDigits && imeiDigits.includes(qDigits)) return true;
  }

  const exchangeHaystack = [
    bill.exchangeModel,
    bill.exchangeColor,
    bill.exchangeStorage,
    bill.exchangeRam,
    bill.exchangeImei1,
    bill.exchangeImei2,
    bill.exchangeSerial,
  ]
    .filter(Boolean)
    .join(" ");
  const exchangeImeiDigits =
    `${bill.exchangeImei1 || ""}${bill.exchangeImei2 || ""}`.replace(/\D/g, "");

  if (includesText(exchangeHaystack, query)) return true;
  if (qDigits && exchangeImeiDigits.includes(qDigits)) return true;

  return false;
}

export function matchesDueSearch(
  due: {
    invoiceNumber: string;
    customerName: string;
    customerPhone: string;
    imeiNumbers?: string[] | null;
    productLabels?: string[] | null;
    financeCompanyName?: string | null;
    financeCompanyName2?: string | null;
  },
  rawQuery: string,
  options?: { includeFinanceCompany?: boolean },
): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  const qDigits = digitsOnly(rawQuery);
  const phoneDigits = digitsOnly(due.customerPhone);
  if (qDigits && phoneDigits.includes(qDigits)) return true;

  if (includesText(due.invoiceNumber, query)) return true;
  if (includesText(due.customerName, query)) return true;

  if (
    options?.includeFinanceCompany &&
    (includesText(due.financeCompanyName || "", query) ||
      includesText(due.financeCompanyName2 || "", query))
  ) {
    return true;
  }

  for (const label of due.productLabels || []) {
    if (includesText(label, query)) return true;
  }

  for (const imei of due.imeiNumbers || []) {
    if (includesText(imei, query)) return true;
    if (qDigits && digitsOnly(imei).includes(qDigits)) return true;
  }

  return false;
}
