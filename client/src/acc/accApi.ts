import { apiRequest, downloadAuthed, shareAuthed } from "../lib/api";

/* Accessories shop API (/api/acc). Types mirror server/src/routes/acc. */

export type AccCategory = {
  id: string;
  name: string;
  drillBy: "TYPE" | "BRAND";
  icon: string;
  sortOrder: number;
};

export type AccProduct = {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  type: string;
  brand: string;
  model: string;
  color: string;
  barcode: string | null;
  purchasePrice: number;
  sellingPrice: number;
  wholesalePrice: number;
  quickPrices: number[];
  stockQty: number;
  lowStockAt: number;
  isFavourite: boolean;
  active: boolean;
  /** Last weekly stock check, if any. */
  countedAt: string | null;
  /** Pieces per phone model (a record only; the rest is "not sorted"). */
  models: AccModelQty[];
  createdAt: string;
  updatedAt: string;
};

export type AccModelQty = { model: string; qty: number };

export type AccStockCheckItem = { productId: string; qty: number; models?: AccModelQty[] };

export type AccCatalog = { categories: AccCategory[]; products: AccProduct[] };

export type AccSaleKind = "RETAIL" | "WHOLESALE";

export type AccSaleItem = {
  id: string;
  productId: string | null;
  name: string;
  categoryName: string;
  qty: number;
  rate: number;
  amount: number;
};

export type AccSale = {
  id: string;
  number: string;
  kind: AccSaleKind;
  saleDate: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerShop: string;
  groupName: string;
  subtotal: number;
  discount: number;
  total: number;
  transportCharge: number;
  costTotal: number;
  profit: number;
  cashAmount: number;
  onlineAmount: number;
  dueAmount: number;
  dueDate: string | null;
  note: string;
  voidedAt: string | null;
  voidReason: string | null;
  createdByName: string | null;
  createdAt: string;
  items: AccSaleItem[];
};

export type AccSalesSummary = {
  count: number;
  total: number;
  retailTotal: number;
  retailCount: number;
  wholesaleTotal: number;
  wholesaleCount: number;
  cash: number;
  online: number;
  due: number;
  transport: number;
  discount: number;
  profit: number;
  items: number;
};

export type AccGroup = { id: string; name: string; color: string; customerCount: number };

export type AccAging = { d0_30: number; d31_60: number; d61_90: number; d90p: number };

export type AccOpenBill = {
  saleId: string;
  number: string;
  saleDate: string;
  dueDate: string | null;
  total: number;
  transportCharge: number;
  open: number;
  daysOverdue: number;
  ageDays: number;
};

export type AccCustomerRow = {
  id: string;
  name: string;
  phone: string;
  shopName: string;
  city: string;
  address: string;
  creditLimit: number;
  group: { id: string; name: string; color: string } | null;
  billed: number;
  paid: number;
  balance: number;
  overdue: number;
  billCount: number;
  openBillCount: number;
  lastSaleAt: string | null;
  lastPaymentAt: string | null;
  aging: AccAging;
  oldestOpen: AccOpenBill | null;
};

export type AccLedgerLine = {
  id: string;
  date: string;
  kind: "BILL" | "PAYMENT";
  ref: string;
  detail: string;
  debit: number;
  credit: number;
  balance: number;
  transportCharge?: number;
  saleId?: string;
  method?: string;
};

export type AccCustomerDetail = AccCustomerRow & {
  gstin: string;
  note: string;
  groupId: string | null;
  openBills: AccOpenBill[];
  ledger: AccLedgerLine[];
  topItems: Array<{ name: string; qty: number; amount: number }>;
};

export type AccCustomerInput = {
  name: string;
  phone: string;
  shopName?: string;
  address?: string;
  city?: string;
  gstin?: string;
  groupId?: string | null;
  groupName?: string;
  creditLimit?: number;
  note?: string;
};

export type AccDues = {
  customers: AccCustomerRow[];
  totals: { outstanding: number; overdue: number; customers: number; aging: AccAging; shown: number };
  groups: Array<{ id: string; name: string; color: string; count: number; balance: number; overdue: number }>;
};

export type AccSupplierGroup = { id: string; name: string; color: string };

export type AccSupplierInput = {
  name: string;
  phone: string;
  city?: string;
  address?: string;
  groupId?: string | null;
  groupName?: string;
};

export type AccSupplier = {
  id: string;
  name: string;
  phone: string;
  city: string;
  address: string;
  group: AccSupplierGroup | null;
  purchased: number;
  paid: number;
  balance: number;
  purchaseCount: number;
  lastPurchaseAt: string | null;
  lastPaymentAt: string | null;
};

export type AccSupplierDetail = {
  id: string;
  name: string;
  phone: string;
  city: string;
  address: string;
  group: AccSupplierGroup | null;
  createdAt: string;
  purchased: number;
  paid: number;
  balance: number;
  pieces: number;
  lastPurchaseAt: string | null;
  lastPaymentAt: string | null;
  purchases: Array<{
    id: string;
    purchaseDate: string;
    billNo: string;
    total: number;
    note: string;
    createdByName: string | null;
    pieces: number;
    items: Array<{ name: string; qty: number; unitCost: number; amount: number }>;
  }>;
  payments: Array<{ id: string; amount: number; method: string; paidAt: string; reference: string; note: string }>;
  /** Purchases (Dr) and payments (Cr) by date, with the running balance. */
  statement: Array<{
    id: string;
    kind: "PURCHASE" | "PAYMENT";
    date: string;
    detail: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
};

export type AccStockMove = {
  id: string;
  kind: "OPENING" | "PURCHASE" | "SALE" | "VOID" | "ADJUST" | "COUNT";
  qty: number;
  unitCost: number;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  sale: { id: string; number: string; kind: AccSaleKind; customerName: string } | null;
};

export type AccAnalytics = {
  period: string;
  label: string;
  totals: {
    revenue: number;
    profit: number;
    margin: number;
    bills: number;
    pieces: number;
    avgBill: number;
    retail: number;
    retailBills: number;
    retailProfit: number;
    wholesale: number;
    wholesaleBills: number;
    wholesaleProfit: number;
    cash: number;
    online: number;
    creditGiven: number;
    collected: number;
    discount: number;
  };
  previous: { revenue: number; profit: number; bills: number } | null;
  trend: { byMonth: boolean; rows: Array<{ key: string; retail: number; wholesale: number; profit: number }> };
  hours: Array<{ hour: number; bills: number; revenue: number }>;
  categories: Array<{ name: string; qty: number; revenue: number; profit: number }>;
  topProducts: Array<{ productId: string | null; name: string; category: string; qty: number; revenue: number; profit: number }>;
  groups: Array<{ id: string; name: string; color: string; revenue: number; bills: number; credit: number }>;
  topCustomers: Array<{ id: string; name: string; shopName: string; revenue: number; bills: number; pieces: number }>;
  staff: Array<{ name: string; bills: number; revenue: number }>;
  stock: {
    products: number;
    units: number;
    costValue: number;
    retailValue: number;
    low: number;
    out: number;
    lowList: Array<{ id: string; name: string; category: string; stockQty: number; lowStockAt: number }>;
    slow: Array<{ id: string; name: string; category: string; stockQty: number; value: number }>;
  };
  dues: { outstanding: number; overdue: number; aging: AccAging };
};

export type AccPeriod = "today" | "yesterday" | "week" | "month" | "last30" | "all" | "custom";

export type PeriodQuery = { period: AccPeriod; from?: string; to?: string };

export type ProductInput = {
  categoryId: string;
  type: string;
  brand: string;
  color: string;
  name: string;
  barcode?: string;
  purchasePrice: number;
  sellingPrice: number;
  wholesalePrice: number;
  quickPrices: number[];
  lowStockAt: number;
  isFavourite: boolean;
};

export type SaleInput = {
  kind: AccSaleKind;
  clientRef: string;
  items: Array<{ productId?: string; name?: string; model?: string; qty: number; rate: number }>;
  discount?: number;
  transportCharge?: number;
  cashAmount?: number;
  onlineAmount?: number;
  customerId?: string;
  customer?: AccCustomerInput;
  customerName?: string;
  customerPhone?: string;
  dueDate?: string;
  note?: string;
  allowOutOfStock?: boolean;
};

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, value === true ? "1" : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const post = <T>(path: string, body: unknown) =>
  apiRequest<{ data: T }>(path, { method: "POST", body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) =>
  apiRequest<{ data: T }>(path, { method: "PUT", body: JSON.stringify(body) });

export const accApi = {
  catalog: () => apiRequest<{ data: AccCatalog }>("/acc/catalog"),
  createCategory: (body: { name: string; drillBy: "TYPE" | "BRAND"; icon: string }) =>
    post<AccCategory>("/acc/categories", body),
  updateCategory: (id: string, body: { name: string; drillBy: "TYPE" | "BRAND"; icon: string }) =>
    put<AccCategory>(`/acc/categories/${id}`, body),
  deleteCategory: (id: string) => apiRequest(`/acc/categories/${id}`, { method: "DELETE" }),

  createProducts: (
    body: ProductInput & { variants: Array<{ model: string; color?: string; qty: number }>; supplierId?: string },
  ) => post<AccProduct[]>("/acc/products", body),
  updateProduct: (id: string, body: ProductInput & { model: string }) => put<AccProduct>(`/acc/products/${id}`, body),
  setFavourite: (id: string, isFavourite: boolean) =>
    apiRequest<{ data: AccProduct }>(`/acc/products/${id}/favourite`, {
      method: "PATCH",
      body: JSON.stringify({ isFavourite }),
    }),
  adjustStock: (id: string, setTo: number, note: string) => post<AccProduct>(`/acc/products/${id}/adjust`, { setTo, note }),
  deleteProduct: (id: string) => apiRequest(`/acc/products/${id}`, { method: "DELETE" }),
  productHistory: (id: string) => apiRequest<{ data: AccStockMove[] }>(`/acc/products/${id}/history`),
  setProductModels: (id: string, models: AccModelQty[]) => put<AccProduct>(`/acc/products/${id}/models`, { models }),
  stockCheck: (items: AccStockCheckItem[], note = "") =>
    post<{ checked: number; changed: number; products: AccProduct[] }>("/acc/stock-check", { items, note }),

  createSale: (body: SaleInput) => post<AccSale>("/acc/sales", body),
  listSales: (q: PeriodQuery & { kind?: AccSaleKind | ""; q?: string; customerId?: string; void?: boolean }) =>
    apiRequest<{ data: { sales: AccSale[]; summary: AccSalesSummary; label: string } }>(`/acc/sales${qs(q)}`),
  getSale: (id: string) => apiRequest<{ data: AccSale }>(`/acc/sales/${id}`),
  voidSale: (id: string, reason: string) => post<AccSale>(`/acc/sales/${id}/void`, { reason }),

  groups: () => apiRequest<{ data: AccGroup[] }>("/acc/groups"),
  createGroup: (body: { name: string; color: string }) => post<AccGroup>("/acc/groups", body),
  updateGroup: (id: string, body: { name: string; color: string }) => put<AccGroup>(`/acc/groups/${id}`, body),
  deleteGroup: (id: string) => apiRequest(`/acc/groups/${id}`, { method: "DELETE" }),

  customers: (q: { q?: string; groupId?: string; sort?: "name" | "recent"; limit?: number } = {}) =>
    apiRequest<{ data: AccCustomerRow[] }>(`/acc/customers${qs(q)}`),
  customer: (id: string) => apiRequest<{ data: AccCustomerDetail }>(`/acc/customers/${id}`),
  createCustomer: (body: AccCustomerInput) => post<{ id: string }>("/acc/customers", body),
  updateCustomer: (id: string, body: AccCustomerInput) => put<{ id: string }>(`/acc/customers/${id}`, body),
  receivePayment: (id: string, body: { amount: number; method: string; paidAt?: string; note?: string }) =>
    post<{ balance: number }>(`/acc/customers/${id}/payments`, body),
  deletePayment: (id: string) => apiRequest(`/acc/payments/${id}`, { method: "DELETE" }),
  dues: (q: { groupId?: string; status?: string; sort?: string; q?: string }) =>
    apiRequest<{ data: AccDues }>(`/acc/dues${qs(q)}`),

  suppliers: () => apiRequest<{ data: AccSupplier[] }>("/acc/suppliers"),
  supplier: (id: string) => apiRequest<{ data: AccSupplierDetail }>(`/acc/suppliers/${id}`),
  supplierGroups: () => apiRequest<{ data: AccSupplierGroup[] }>("/acc/supplier-groups"),
  createSupplier: (body: AccSupplierInput) => post<{ id: string }>("/acc/suppliers", body),
  updateSupplier: (id: string, body: AccSupplierInput) => put<{ id: string }>(`/acc/suppliers/${id}`, body),
  paySupplier: (id: string, body: { amount: number; method: string; reference?: string; paidAt?: string; note?: string }) =>
    post(`/acc/suppliers/${id}/payments`, body),
  createPurchase: (body: {
    supplierId?: string | null;
    /** A new supplier, saved with the purchase. */
    supplier?: AccSupplierInput;
    billNo?: string;
    note?: string;
    paidNow?: number;
    paidMethod?: string;
    items: Array<{
      /** An existing product… */
      productId?: string;
      /** …or one bought for the first time, created with the purchase. */
      newProduct?: { categoryId: string; name: string; brand?: string; wholesalePrice?: number };
      qty: number;
      unitCost: number;
      sellingPrice?: number;
      wholesalePrice?: number;
    }>;
  }) => post<{ id: string }>("/acc/purchases", body),

  analytics: (q: PeriodQuery) => apiRequest<{ data: AccAnalytics }>(`/acc/analytics${qs(q)}`),

  pdf: {
    stock: (q: { filter?: string; categoryId?: string; cost?: boolean }) =>
      downloadAuthed(`/acc/products/pdf${qs(q)}`, "accessories-stock.pdf"),
    sales: (q: PeriodQuery & { kind?: string; items?: boolean; q?: string }) =>
      downloadAuthed(`/acc/sales/pdf${qs(q)}`, "accessories-sales.pdf"),
    bill: (id: string) => downloadAuthed(`/acc/sales/${id}/pdf`, "bill.pdf"),
    dues: (q: { groupId?: string; groupIds?: string; status?: string; sort?: string; columns?: string }) =>
      downloadAuthed(`/acc/dues/pdf${qs(q)}`, "accessories-dues.pdf"),
    statement: (id: string) => downloadAuthed(`/acc/customers/${id}/statement`, "statement.pdf"),
    suppliers: () => downloadAuthed("/acc/suppliers/pdf", "accessories-suppliers.pdf"),
    supplier: (id: string) => downloadAuthed(`/acc/suppliers/${id}/pdf`, "supplier-statement.pdf"),
    analytics: (q: PeriodQuery) => downloadAuthed(`/acc/analytics/pdf${qs(q)}`, "accessories-report.pdf"),
  },
  sharePdf: {
    stock: (q: { filter?: string; categoryId?: string; cost?: boolean }) =>
      shareAuthed(`/acc/products/pdf${qs(q)}`, "accessories-stock.pdf", "Accessories stock"),
    sales: (q: PeriodQuery & { kind?: string; items?: boolean; q?: string }) =>
      shareAuthed(`/acc/sales/pdf${qs(q)}`, "accessories-sales.pdf", "Accessories sales"),
    bill: (id: string, text?: string) => shareAuthed(`/acc/sales/${id}/pdf`, "bill.pdf", "Accessories bill", text),
    dues: (q: { groupId?: string; groupIds?: string; status?: string; sort?: string; columns?: string }) =>
      shareAuthed(`/acc/dues/pdf${qs(q)}`, "accessories-dues.pdf", "Accessories dues"),
    statement: (id: string) =>
      shareAuthed(`/acc/customers/${id}/statement`, "statement.pdf", "Customer statement"),
    suppliers: () => shareAuthed("/acc/suppliers/pdf", "accessories-suppliers.pdf", "Accessories suppliers"),
    supplier: (id: string) =>
      shareAuthed(`/acc/suppliers/${id}/pdf`, "supplier-statement.pdf", "Supplier statement"),
    analytics: (q: PeriodQuery) =>
      shareAuthed(`/acc/analytics/pdf${qs(q)}`, "accessories-report.pdf", "Accessories report"),
  },
};
