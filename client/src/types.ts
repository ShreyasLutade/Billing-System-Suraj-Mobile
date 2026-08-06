export type BillItem = {
  id?: string;
  productName: string;
  mobileCatalogId?: string | null;
  stockItemId?: string | null;
  platform?: "IOS" | "ANDROID" | null;
  color?: string | null;
  storage?: string | null;
  ram?: string | null;
  condition?: "NEW" | "USED" | null;
  quantity: number;
  rate: number;
  gstPercent: number;
  amount?: number;
  imei1?: string | null;
  imei2?: string | null;
  serialNumber?: string | null;
  warrantyMonths?: number | null;
};

export type DuePayment = {
  id: string;
  amount: number;
  method: string;
  kind: string;
  paidAt: string;
  note?: string | null;
};

export type Bill = {
  id: string;
  invoiceNumber: string;
  billDate: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string | null;
  notes?: string | null;
  withGst?: boolean;
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
  payableAmount: number;
  cashAmount: number;
  onlineAmount: number;
  financeAmount: number;
  financeCompanyId?: string | null;
  financeCompanyName?: string | null;
  financeAmount2?: number;
  financeCompanyId2?: string | null;
  financeCompanyName2?: string | null;
  financeReceived: boolean;
  financeReceivedAt?: string | null;
  isExchange: boolean;
  exchangeModel?: string | null;
  exchangePlatform?: "IOS" | "ANDROID" | string | null;
  exchangeColor?: string | null;
  exchangeStorage?: string | null;
  exchangeRam?: string | null;
  exchangeImei1?: string | null;
  exchangeImei2?: string | null;
  exchangeSerial?: string | null;
  exchangeValue?: number | null;
  exchangeNotes?: string | null;
  exchangeMobileCatalogId?: string | null;
  dueAmount: number;
  dueDate?: string | null;
  dueSettled: boolean;
  dueSettledMethod?: string | null;
  dueSettledAt?: string | null;
  isPartialPaid?: boolean;
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdByRole?: "ADMIN" | "STAFF" | string | null;
  items: BillItem[];
  duePayments?: DuePayment[];
  createdAt: string;
  updatedAt: string;
};

export type AnalyticsSummary = {
  period: "today" | "yesterday" | "week" | "month" | "all";
  periodLabel: string;
  from: string | null;
  to: string | null;
  summary: {
    sales: number;
    payable: number;
    cash: number;
    online: number;
    finance: number;
    due: number;
    bills: number;
  };
  today: {
    sales: number;
    cash: number;
    online: number;
    finance: number;
    due: number;
    bills: number;
  };
  outstandingDue: {
    amount: number;
    count: number;
  };
  upcomingDues: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    customerPhone: string;
    dueAmount: number;
    dueDate: string | null;
    billDate: string;
  }>;
};

export type FinanceCompany = {
  id: string;
  name: string;
  createdAt: string;
};

export type MobileCatalog = {
  id: string;
  name: string;
  platform: "IOS" | "ANDROID";
  condition: "NEW" | "USED";
  color: string;
  storage: string;
  ram: string;
  createdAt: string;
};

/** Stock search catalog (no color). */
export type PhoneModel = {
  id: string;
  platform: "IOS" | "ANDROID";
  name: string;
  storage: string;
  ram: string;
};

export type StockItem = {
  id: string;
  condition: "NEW" | "USED";
  platform: "IOS" | "ANDROID";
  mobileName: string;
  storage: string;
  ram: string;
  color: string;
  imei: string;
  purchasePrice: number;
  suppliers: string[];
  supplierId?: string | null;
  supplierName?: string | null;
  status: "AVAILABLE" | "SOLD" | string;
  createdAt: string;
  updatedAt: string;
};

export type Supplier = {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  purchaseCount: number;
  totalPurchased: number;
  totalPaid: number;
  outstanding: number;
  stockAvailable: number;
  stockSold: number;
  /** Total units purchased from this supplier (available + sold). */
  stockPurchased: number;
};

export type SupplierPayment = {
  id: string;
  supplierId: string;
  amount: number;
  method: string;
  paidAt: string;
  note?: string | null;
  createdAt: string;
};

export type PurchaseStockRef = {
  id: string;
  mobileName: string;
  imei: string;
  purchasePrice: number;
  status: string;
  color?: string;
  storage?: string;
  ram?: string;
  platform?: string;
  condition?: string;
  soldBillId?: string | null;
  soldInvoiceNumber?: string | null;
  soldCustomerName?: string | null;
};

export type Purchase = {
  id: string;
  supplierId: string;
  purchaseDate: string;
  note?: string | null;
  totalAmount: number;
  condition: "NEW" | "USED" | string;
  paidAt?: string | null;
  createdAt: string;
  supplier?: { id: string; name: string };
  items: Array<{
    id: string;
    stockItemId: string;
    stockItem: PurchaseStockRef;
  }>;
};

export type SupplierDetail = Supplier & {
  purchases: Purchase[];
  payments?: SupplierPayment[];
  stockItems: StockItem[];
};

export type StockHistory = {
  stock: StockItem;
  purchase: {
    id: string;
    purchaseDate: string;
    note?: string | null;
    supplier: { id: string; name: string };
  } | null;
  supplier: { id: string; name: string } | null;
  sale: {
    billId: string;
    invoiceNumber: string;
    billDate: string;
    customerName: string;
    customerPhone: string;
  } | null;
};

export type DueItem = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  dueAmount: number;
  dueDate: string | null;
  billDate: string;
  grandTotal?: number;
  payableAmount?: number;
  isPartialPaid?: boolean;
  productLabels?: string[];
  imeiNumbers?: string[];
};

export type DuesSummary = {
  period: "today" | "tomorrow" | "yesterday" | "past_due" | "future_due" | "all";
  periodLabel: string;
  totalDue: number;
  count: number;
  dues: DueItem[];
};

export type FinanceDueItem = {
  id: string;
  invoiceNumber: string;
  billDate: string;
  customerName: string;
  customerPhone: string;
  financeAmount: number;
  financeCompanyName?: string | null;
  financeAmount2?: number;
  financeCompanyName2?: string | null;
  financeReceived: boolean;
  financeReceivedAt?: string | null;
  productLabels?: string[];
  imeiNumbers?: string[];
};

export type FinanceDuesSummary = {
  totalFinanceDue: number;
  count: number;
  dues: FinanceDueItem[];
};

export type CreateBillPayload = {
  customerName: string;
  customerPhone: string;
  customerAddress?: string | null;
  notes?: string | null;
  billDate?: string | null;
  withGst?: boolean;
  items: BillItem[];
  useCash: boolean;
  useOnline: boolean;
  useFinance: boolean;
  cashAmount: number;
  onlineAmount: number;
  financeAmount: number;
  financeCompanyId?: string | null;
  financeCompanyName?: string | null;
  financeAmount2?: number;
  financeCompanyId2?: string | null;
  financeCompanyName2?: string | null;
  isExchange?: boolean;
  exchangeModel?: string | null;
  exchangePlatform?: "IOS" | "ANDROID" | null;
  exchangeColor?: string | null;
  exchangeStorage?: string | null;
  exchangeRam?: string | null;
  exchangeImei1?: string | null;
  exchangeImei2?: string | null;
  exchangeSerial?: string | null;
  exchangeValue?: number | null;
  exchangeNotes?: string | null;
  dueDate?: string | null;
};

export type AuthUser = {
  id: string;
  phone: string;
  name: string;
  role: "ADMIN" | "STAFF";
};

