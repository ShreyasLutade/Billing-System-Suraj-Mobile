export type BillItem = {
  id?: string;
  productName: string;
  mobileCatalogId?: string | null;
  stockItemId?: string | null;
  platform?: "IOS" | "ANDROID" | "ACCESSORY" | null;
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
  /** Older bills only; new bills use `warranty`. */
  warrantyMonths?: number | null;
  /** Free text, e.g. "1 year", "6 months", "No warranty". */
  warranty?: string | null;
  /** "BOX,CHARGER" — handed to the buyer with this phone. */
  includedAccessories?: string | null;
};

export type DuePayment = {
  id: string;
  amount: number;
  method: string;
  kind: string;
  paidAt: string;
  note?: string | null;
};

export type BillExchangeItem = {
  model: string;
  platform: "IOS" | "ANDROID";
  color: string;
  storage: string;
  ram?: string | null;
  imei1: string;
  value: number;
  notes?: string | null;
  stockItemId?: string | null;
  stockStatus?: string | null;
  soldBillId?: string | null;
  soldInvoiceNumber?: string | null;
  accessories?: ExchangeAccessory[];
};

export type ExchangeAccessoryKey = "BOX" | "CHARGER" | "CABLE" | "BILL";

export type ExchangeAccessory = {
  key: ExchangeAccessoryKey;
  status: "GIVEN" | "PENDING";
  receivedAt?: string | null;
};

export type PendingAccessoryBill = {
  billId: string;
  invoiceNumber: string;
  billDate: string;
  customerName: string;
  customerPhone: string;
  pendingCount: number;
  phones: Array<{
    itemIndex: number;
    model: string;
    platform: "IOS" | "ANDROID";
    color: string;
    storage: string;
    ram?: string | null;
    imei1: string;
    pending: ExchangeAccessoryKey[];
  }>;
};

export type PendingAccessoriesSummary = {
  billCount: number;
  itemCount: number;
  bills: PendingAccessoryBill[];
};

export type BillPurchaseHistoryItem = {
  billItemId: string;
  productName: string;
  platform?: string | null;
  imei?: string | null;
  serialNumber?: string | null;
  supplier: {
    id: string;
    name: string;
    phone?: string | null;
    isExchange?: boolean;
  } | null;
  purchaseDate: string;
  costPrice: number;
  /** "Given as replacement" / "Replaced · sent back to supplier" … */
  label?: string;
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
  companyDiscount?: number;
  cashAmount: number;
  onlineAmount: number;
  cardAmount?: number;
  financeAmount: number;
  financeCompanyId?: string | null;
  financeCompanyName?: string | null;
  financeAmount2?: number;
  financeCompanyId2?: string | null;
  financeCompanyName2?: string | null;
  financeReceived: boolean;
  financeReceivedAt?: string | null;
  financeReceived2?: boolean;
  financeReceivedAt2?: string | null;
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
  exchangeCashReturn?: number;
  exchangeNotes?: string | null;
  exchangeMobileCatalogId?: string | null;
  exchangeItems?: BillExchangeItem[];
  /** Purchase provenance for stock-linked line items (bill detail only). */
  purchaseHistory?: BillPurchaseHistoryItem[];
  /** Products on this bill sent back to the supplier (replaced / returned). */
  productReturns?: BillProductReturn[];
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
  period: "today" | "yesterday" | "week" | "month" | "all" | "custom";
  periodLabel: string;
  from: string | null;
  to: string | null;
  summary: {
    sales: number;
    payable: number;
    cash: number;
    online: number;
    card: number;
    finance: number;
    due: number;
    bills: number;
    collected: number;
    mixTotal: number;
    cost: number;
    profit: number;
    accessoriesRevenue?: number;
    accessoriesSold?: number;
    shares: {
      cash: number;
      online: number;
      card: number;
      finance: number;
      due: number;
    };
  };
  today: {
    sales: number;
    cash: number;
    online: number;
    card: number;
    finance: number;
    due: number;
    bills: number;
  };
  vsPrevious: {
    mixTotalChangePct: number | null;
    label: string | null;
  };
  outstandingDue: {
    amount: number;
    count: number;
    oldestDueDays: number | null;
  };
  stockOnHand: {
    count: number;
    value: number;
  };
  exchangeIntake?: {
    count: number;
    value: number;
  };
  purchaseHistory?: {
    count: number;
    value: number;
  };
  /** Sales, plus Replace / Return entries made in the period. */
  periodBills: Array<{
    /** Bill to open. */
    id: string;
    /** Unique row key (return entries share their bill's id). */
    entryId?: string;
    kind?: "SALE" | "REPLACED" | "RETURNED";
    refundMethod?: "cash" | "online";
    invoiceNumber: string;
    customerName: string;
    customerPhone: string;
    billDate: string;
    productLabel: string;
    costPrice: number;
    sellingPrice: number;
    companyDiscount?: number;
    exchangeValue?: number;
    profit: number;
  }>;
  paymentSources?: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    billDate: string;
    billTotal: number;
    cashAmount: number;
    onlineAmount: number;
    cardAmount: number;
    financeAmount: number;
    financeLabel?: string | null;
    dueAmount: number;
    dueDate?: string | null;
  }>;
};

export type AnalyticsExchangeItem = {
  id: string;
  purchaseId: string;
  purchaseDate: string;
  invoiceNumber: string;
  billId: string | null;
  customerName: string;
  customerPhone: string | null;
  supplierId: string;
  mobileName: string;
  color: string;
  storage: string;
  ram: string;
  platform: string;
  condition: string;
  imei: string | null;
  serialNumber: string | null;
  value: number;
  status: string;
};

export type AnalyticsExchangesSummary = {
  period: "today" | "yesterday" | "week" | "month" | "all" | "custom";
  periodLabel: string;
  from: string | null;
  to: string | null;
  count: number;
  totalValue: number;
  items: AnalyticsExchangeItem[];
};

/** A mobile bought from a supplier (Analytics → Purchase history). */
export type AnalyticsPurchaseItem = {
  id: string;
  purchaseId: string;
  purchaseDate: string;
  supplierId: string;
  supplierName: string;
  mobileName: string;
  color: string;
  storage: string;
  ram: string;
  platform: string;
  condition: string;
  imei: string | null;
  serialNumber: string | null;
  price: number;
  status: string;
};

export type AnalyticsPurchasesSummary = {
  period: "today" | "yesterday" | "week" | "month" | "all" | "custom";
  periodLabel: string;
  from: string | null;
  to: string | null;
  count: number;
  totalValue: number;
  items: AnalyticsPurchaseItem[];
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
  kind?: "MOBILE" | "ACCESSORY" | string;
  condition: "NEW" | "USED";
  platform: "IOS" | "ANDROID" | "ACCESSORY" | string;
  mobileName: string;
  storage: string;
  ram: string;
  color: string;
  imei: string | null;
  serialNumber?: string | null;
  purchasePrice: number;
  suppliers: string[];
  supplierId?: string | null;
  supplierName?: string | null;
  /** True when the linked supplier is from a customer phone exchange. */
  supplierIsExchange?: boolean;
  /** How this unit entered stock — exchange or customer return. */
  intakeKind?: "exchange" | "return" | null;
  status: "AVAILABLE" | "SOLD" | string;
  createdByUserId?: string | null;
  createdByName?: string | null;
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
  /** Purchase price of units returned to this supplier. */
  totalReturned?: number;
  /** Return credit not yet used against a purchase (supplier owes us). */
  supplierCredit?: number;
  /** True when this party is a customer who gave a phone in exchange. */
  isExchange?: boolean;
  hasExchangeIntake?: boolean;
  hasReturnIntake?: boolean;
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
  imei: string | null;
  serialNumber?: string | null;
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
  /** Given to a customer as a replacement (Replace product). */
  givenAsReplacement?: boolean;
  /** Sent back to the supplier after being sold. */
  returned?: {
    createdAt: string;
    note: string | null;
    invoiceNumber: string | null;
    billId: string | null;
  } | null;
  /** Selling price from the sale bill — admin only. */
  soldPrice?: number | null;
};

export type Purchase = {
  id: string;
  supplierId: string;
  purchaseDate: string;
  note?: string | null;
  totalAmount: number;
  condition: "NEW" | "USED" | string;
  paidAt?: string | null;
  /** Paid so far while not fully paid (part payments). */
  paidAmount?: number;
  createdByUserId?: string | null;
  createdByName?: string | null;
  createdAt: string;
  supplier?: { id: string; name: string };
  items: Array<{
    id: string;
    stockItemId: string;
    stockItem: PurchaseStockRef;
  }>;
};

/** A purchased mobile (in stock or sold) with where it came from. */
export type SupplierMobile = {
  id: string;
  mobileName: string;
  platform: string;
  condition: "NEW" | "USED" | string;
  storage: string;
  ram: string;
  color: string;
  imei: string | null;
  serialNumber: string | null;
  status: "AVAILABLE" | "SOLD" | string;
  /** Null for staff — purchase amounts are admin only. */
  purchasePrice: number | null;
  purchaseDate: string;
  supplier: { id: string; name: string } | null;
  sale: { billId: string; invoiceNumber: string } | null;
  returned?: boolean;
  purchase: { id: string; supplierId: string } | null;
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
    supplier: { id: string; name: string; isExchange?: boolean };
  } | null;
  supplier: { id: string; name: string; isExchange?: boolean } | null;
  sale: {
    billId: string;
    invoiceNumber: string;
    billDate: string;
    customerName: string;
    customerPhone: string;
  } | null;
};

/** IMEI trace for supplier search — any stock status. */
export type StockImeiTrace = {
  stock: StockItem;
  supplier: {
    id: string;
    name: string;
    phone?: string | null;
    isExchange?: boolean;
  } | null;
  purchaseDate: string;
  costPrice: number;
  sale: {
    billId: string;
    invoiceNumber: string;
    billDate: string;
    customerName: string;
    customerPhone: string;
    sellingPrice: number;
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
  financeReceived2?: boolean;
  financeReceivedAt2?: string | null;
  pendingFinanceAmount?: number;
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
  useCard: boolean;
  useFinance: boolean;
  cashAmount: number;
  onlineAmount: number;
  cardAmount: number;
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
  exchangeItems?: BillExchangeItem[];
  exchangeCashReturn?: number;
  dueDate?: string | null;
  companyDiscount?: number;
};

export type AuthUser = {
  id: string;
  phone: string;
  name: string;
  role: "ADMIN" | "STAFF";
  /** Repair-only account for this repair shop (no mobile-shop access). */
  repairShop?: string | null;
};


export type RepairPlatform = "IOS" | "ANDROID";
export type RepairCondition = "LIKE_NEW" | "GOOD" | "FAIR" | "DAMAGED" | "DEAD";
export type RepairStatus = "RECEIVED" | "IN_REPAIR" | "REPAIRED" | "DELIVERED";
export type RepairOutcome = "FIXED" | "NOT_FIXED";
export type RepairPaymentMethod = "CASH" | "UPI" | "CARD";

/** A repair-desk intake. Photos are fetched separately (see api.repairPhotoUrl). */
export type RepairJob = {
  id: string;
  jobNumber: string;
  /** Repair shop: NX (Babu Mobile NX) | LK (Luckey). */
  shop: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  deviceName: string;
  platform: RepairPlatform;
  color: string | null;
  /** Older jobs only — intake now asks for colour instead. */
  ram: string | null;
  storage: string | null;
  /** Only on older jobs — intake no longer asks for it. */
  condition: RepairCondition | null;
  conditionNotes: string | null;
  problemDescription: string;
  estimatedCost: number | null;
  /** Shop's cost for the repair — admins only (null for staff). */
  costPrice: number | null;
  /** Admin: fixed and delivered but the cost price isn't entered yet. */
  costPending: boolean;
  /** IMEI or serial, scanned or typed at intake. */
  imei: string | null;
  /** When the shop promised it back (ISO). */
  expectedDeliveryAt: string | null;
  /** Screen lock for testing; shown to staff only. */
  lockCode: string | null;
  /** What came in with the phone, e.g. "SIM card, Back cover". */
  accessories: string | null;
  finalCharge: number | null;
  status: RepairStatus;
  outcome: RepairOutcome | null;
  repairNotes: string | null;
  /** Chips: work done when fixed, reasons when not fixed ("A, B"). */
  workDone: string | null;
  paymentMethod: RepairPaymentMethod | null;
  /** Someone other than the customer who collected the phone (null = the customer). */
  pickupName: string | null;
  pickupPhone: string | null;
  /** Last time the shop called the customer. */
  notifiedAt: string | null;
  /** When the technician started (moved to In repair). */
  startedAt: string | null;
  repairedAt: string | null;
  deliveredAt: string | null;
  hasFrontPhoto: boolean;
  hasBackPhoto: boolean;
  createdByName: string | null;
  createdAt: string;
};

export type RepairAnalytics = {
  period: "today" | "yesterday" | "week" | "month" | "all";
  periodLabel: string;
  /** Final charges of phones delivered in the period. */
  revenue: number;
  deliveredCount: number;
  averageCharge: number;
  receivedCount: number;
  fixedCount: number;
  notFixedCount: number;
  fixRate: number | null;
  /** Current, not period-bound. */
  waitingCount: number;
  readyCount: number;
  readyValue: number;
  topDevices: Array<{ deviceName: string; count: number }>;
  recentDelivered: Array<{
    id: string;
    jobNumber: string;
    customerName: string;
    deviceName: string;
    outcome: RepairOutcome | null;
    finalCharge: number | null;
    costPrice: number | null;
    deliveredAt: string | null;
  }>;
};

export type BillProductReturn = {
  billItemId: string | null;
  stockItemId: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  /** REPLACE | RETURN; null on entries made before this choice existed. */
  kind: "REPLACE" | "RETURN" | null;
  refundAmount: number;
  refundMethod: "cash" | "online" | null;
  /** The unit from stock given to the customer (Replace). */
  replacement: {
    id: string;
    mobileName: string;
    storage: string;
    ram: string;
    color: string;
    platform: string;
    condition: string;
    imei: string | null;
    serialNumber: string | null;
  } | null;
};

/** A sold unit found by IMEI / serial for Replace product. */
export type ReturnLookup = {
  stockItemId: string;
  mobileName: string;
  storage: string;
  ram: string;
  color: string;
  platform: string;
  condition: string;
  imei: string | null;
  serialNumber: string | null;
  purchasePrice: number | null;
  purchaseDate: string | null;
  supplier: { id: string; name: string } | null;
  /** What the customer paid for this item (default refund). */
  soldPrice: number;
  bill: {
    id: string;
    billItemId: string;
    invoiceNumber: string;
    billDate: string;
    customerName: string;
    customerPhone: string;
  };
  alreadyReturned: { createdAt: string; note: string | null } | null;
};

/** Accessories that came in with a second-hand phone on its exchange bill. */
export type ExchangeIntake = {
  billId: string;
  invoiceNumber: string;
  billDate: string;
  customerName: string;
  accessories: ExchangeAccessory[];
};
