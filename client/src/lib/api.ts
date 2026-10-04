import type {
  AnalyticsExchangesSummary,
  AnalyticsPurchasesSummary,
  AnalyticsSummary,
  AuthUser,
  Bill,
  CreateBillPayload,
  DuesSummary,
  FinanceDuesSummary,
  FinanceCompany,
  MobileCatalog,
  PhoneModel,
  Purchase,
  ReturnLookup,
  RepairAnalytics,
  RepairJob,
  RepairOutcome,
  RepairPaymentMethod,
  RepairStatus,
  StockHistory,
  StockImeiTrace,
  StockItem,
  Supplier,
  SupplierDetail,
  SupplierMobile,
} from "../types";

/** Something deleted that can still be undone (kept a few days). */
export type RecycleBinEntry = {
  id: string;
  kind: "BILL" | "SUPPLIER" | "STOCK" | "REPAIR";
  label: string;
  detail: string | null;
  deletedAt: string;
  deletedByName: string | null;
  /** When it is removed for good. */
  expiresAt: string;
};

/** Paid to the supplier while entering a purchase (omit = unpaid). */
export type PaymentAtPurchase =
  | { mode: "FULL" | "UNPAID" }
  | { mode: "CUSTOM"; amount: number };

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const TOKEN_KEY = "suraj_billing_token";
export const BACKEND_ISSUE_EVENT = "babu:backend-issue";

export type BackendIssue = {
  status: number;
  message: string;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if ((status === 0 || status >= 500) && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<BackendIssue>(BACKEND_ISSUE_EVENT, {
          detail: { status, message },
        }),
      );
    }
  }
}

export async function fetchBackend(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      throw err;
    }
    throw new ApiError(
      "Cannot reach the server. Make sure the API is running on port 4000.",
      0,
    );
  }
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function readSessionFromToken(token: string): AuthUser | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as {
      sub?: string;
      phone?: string;
      name?: string;
      role?: string;
      repairShop?: string | null;
      exp?: number;
    };
    if (!payload.sub || !payload.phone || !payload.exp) return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    if (payload.role !== "ADMIN" && payload.role !== "STAFF") return null;
    return {
      id: String(payload.sub),
      phone: String(payload.phone),
      name: String(payload.name || ""),
      role: payload.role,
      repairShop: typeof payload.repairShop === "string" ? payload.repairShop : null,
    };
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
      ...init,
    });
  } catch (err) {
    if (
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      throw err;
    }
    throw new ApiError(
      "Cannot reach the server. Make sure the API is running on port 4000.",
      0,
    );
  }

  if (
    response.status === 401 &&
    !path.startsWith("/auth/login") &&
    !path.startsWith("/auth/forgot-password") &&
    !path.startsWith("/auth/reset-password") &&
    !path.startsWith("/auth/me")
  ) {
    clearAuthToken();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.assign("/login");
    }
  }

  if (!response.ok) {
    let message = "Something went wrong";
    try {
      const body = await response.json();
      message = body.error || message;
      if (body.detail && typeof body.detail === "string") {
        message = `${message}: ${body.detail}`;
      }
      if (body.details?.fieldErrors) {
        const first = Object.values(body.details.fieldErrors).flat()[0];
        if (typeof first === "string") message = first;
      }
      if (body.details?.formErrors?.[0]) {
        message = body.details.formErrors[0];
      }
    } catch {
      if (response.status >= 500) {
        message = "Server error. Please try again.";
      } else if (response.status === 404) {
        message = "API route not found. Restart the server.";
      }
    }
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean }>("/health"),
  login: (phone: string, password: string) =>
    request<{ data: { token: string; user: AuthUser } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    }),
  requestPasswordOtp: (phone: string) =>
    request<{ data: { sent: boolean; email: string } }>(
      "/auth/forgot-password",
      {
        method: "POST",
        body: JSON.stringify({ phone }),
      },
    ),
  resetPassword: (phone: string, otp: string, password: string) =>
    request<{ data: { reset: boolean } }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ phone, otp, password }),
    }),
  me: () => request<{ data: { user: AuthUser } }>("/auth/me"),
  listBills: (
    period?: string,
    options?: { withGst?: boolean; from?: string; to?: string },
  ) => {
    const params = new URLSearchParams();
    if (options?.from || options?.to) {
      if (options.from) params.set("from", options.from);
      if (options.to) params.set("to", options.to);
    } else if (period) {
      params.set("period", period);
    }
    if (options?.withGst === true) params.set("withGst", "true");
    if (options?.withGst === false) params.set("withGst", "false");
    const query = params.toString();
    return request<{ data: Bill[]; period?: string }>(
      `/bills${query ? `?${query}` : ""}`,
    );
  },
  getBill: (id: string) => request<{ data: Bill }>(`/bills/${id}`),
  /** Find a sold unit by IMEI or serial number (Replace product). */
  lookupReturnUnit: (code: string) =>
    request<{ data: ReturnLookup }>(
      `/returns/lookup?${new URLSearchParams({ code })}`,
    ),
  /** Mark a sold unit replaced / returned to its supplier. */
  createProductReturn: (payload: {
    stockItemId: string;
    note?: string | null;
    /** REPLACE: give another unit from stock. RETURN: refund the customer. */
    kind: "REPLACE" | "RETURN";
    replacementStockItemId?: string | null;
    refundAmount?: number | null;
    refundMethod?: "cash" | "online" | null;
  }) =>
    request<{
      data: { id: string; billId: string; amount: number; creditApplied: number };
    }>("/returns", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  lookupCustomerByPhone: (phone: string, init?: RequestInit) =>
    request<{
      data: {
        customerName: string;
        customerPhone: string;
        customerAddress: string | null;
      } | null;
    }>(`/bills/customer-lookup?phone=${encodeURIComponent(phone)}`, init),
  createBill: (payload: CreateBillPayload) =>
    request<{ data: Bill }>("/bills", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateBill: (id: string, payload: CreateBillPayload) =>
    request<{ data: Bill }>(`/bills/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteBill: (
    id: string,
    mode: "delete" | "return" | "restock" = "delete",
  ) =>
    request<{ data: { id: string; invoiceNumber: string; mode?: string } }>(
      `/bills/${id}`,
      {
        method: "DELETE",
        body: JSON.stringify({ mode }),
      },
    ),
  analytics: (
    period: string = "all",
    options?: { from?: string; to?: string },
  ) => {
    const params = new URLSearchParams();
    if (options?.from || options?.to) {
      if (options.from) params.set("from", options.from);
      if (options.to) params.set("to", options.to);
    } else {
      params.set("period", period);
    }
    return request<{ data: AnalyticsSummary }>(
      `/analytics/summary?${params.toString()}`,
    );
  },
  analyticsExchanges: (
    period: string = "all",
    options?: { from?: string; to?: string },
  ) => {
    const params = new URLSearchParams();
    if (options?.from || options?.to) {
      if (options.from) params.set("from", options.from);
      if (options.to) params.set("to", options.to);
    } else {
      params.set("period", period);
    }
    return request<{ data: AnalyticsExchangesSummary }>(
      `/analytics/exchanges?${params.toString()}`,
    );
  },
  analyticsPurchases: (
    period: string = "all",
    options?: { from?: string; to?: string },
  ) => {
    const params = new URLSearchParams();
    if (options?.from || options?.to) {
      if (options.from) params.set("from", options.from);
      if (options.to) params.set("to", options.to);
    } else {
      params.set("period", period);
    }
    return request<{ data: AnalyticsPurchasesSummary }>(
      `/analytics/purchases?${params.toString()}`,
    );
  },
  listFinanceCompanies: () =>
    request<{ data: FinanceCompany[] }>("/finance-companies"),
  createFinanceCompany: (name: string) =>
    request<{ data: FinanceCompany; created: boolean }>("/finance-companies", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  listMobileCatalog: () =>
    request<{ data: MobileCatalog[] }>("/mobile-catalog"),
  listPhoneModels: (platform?: "IOS" | "ANDROID") => {
    const query = platform
      ? `?platform=${encodeURIComponent(platform)}`
      : "";
    return request<{ data: PhoneModel[] }>(`/phone-models${query}`);
  },
  createPhoneModel: (payload: {
    platform: "IOS" | "ANDROID";
    name: string;
    storage: string;
    ram?: string | null;
  }) =>
    request<{ data: PhoneModel }>("/phone-models", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createMobile: (payload: {
    name: string;
    platform: "IOS" | "ANDROID";
    condition: "NEW" | "USED";
    color: string;
    storage: string;
    ram?: string;
  }) =>
    request<{ data: MobileCatalog; created: boolean }>("/mobile-catalog", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listStock: (
    condition?: "NEW" | "USED",
    includeIds?: string[],
    kind?: "MOBILE" | "ACCESSORY" | "ALL",
  ) => {
    const params = new URLSearchParams();
    if (condition) params.set("condition", condition);
    if (kind) params.set("kind", kind);
    if (includeIds?.length) params.set("includeIds", includeIds.join(","));
    const query = params.toString();
    return request<{ data: StockItem[] }>(
      `/stock${query ? `?${query}` : ""}`,
    );
  },
  listAccessoryNames: () =>
    request<{ data: string[] }>("/stock/accessory-names"),
  /** One purchase of one or more accessory types from the same supplier. */
  createAccessories: (payload: {
    items: Array<{
      name: string;
      purchasePrice: number;
      serials: string[];
    }>;
    supplierId?: string | null;
    supplierName?: string | null;
    supplierPhone?: string | null;
    payment?: PaymentAtPurchase | null;
  }) =>
    request<{ data: StockItem[] }>("/stock/accessories", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  findAvailableStockByImei: (imei: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ imei: imei.replace(/\D/g, "") });
    return request<{ data: StockItem }>(`/stock/lookup?${params}`, {
      signal,
    });
  },
  findAvailableStockBySerial: (serial: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      serial: serial.replace(/\s+/g, "").trim(),
    });
    return request<{ data: StockItem }>(`/stock/lookup?${params}`, {
      signal,
    });
  },
  traceStockByImei: (imei: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ imei: imei.replace(/\D/g, "") });
    return request<{ data: StockImeiTrace }>(`/stock/trace?${params}`, {
      signal,
    });
  },
  createStockItem: (payload: {
    condition: "NEW" | "USED";
    platform: "IOS" | "ANDROID";
    mobileName: string;
    storage: string;
    ram?: string;
    color: string;
    imei?: string;
    serialNumber?: string;
    purchasePrice: number;
    suppliers?: string[];
    supplierId?: string | null;
  }) =>
    request<{ data: StockItem }>("/stock", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateStockItem: (
    id: string,
    payload: {
      mobileName: string;
      platform: "IOS" | "ANDROID";
      condition?: "NEW" | "USED";
      storage: string;
      ram?: string;
      color: string;
      purchasePrice: number;
      imei?: string;
      serialNumber?: string;
      supplierId?: string | null;
      suppliers?: string[];
    },
  ) =>
    request<{ data: StockItem }>(`/stock/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteStockItem: (id: string) =>
    request<{
      data: { id: string; purchaseId?: string | null; purchaseDeleted?: boolean };
    }>(`/stock/${id}`, {
      method: "DELETE",
    }),
  stockHistory: (id: string) =>
    request<{ data: StockHistory }>(`/stock/${id}/history`),
  /** Admin: things deleted in the last few days (meta.days). */
  listRecycleBin: () =>
    request<{ data: RecycleBinEntry[]; meta: { days: number } }>("/recycle-bin"),
  /** Undo a delete. 409 with a reason when it can't be restored any more. */
  restoreRecycleBinEntry: (id: string) =>
    request<{ data: { kind: RecycleBinEntry["kind"]; label: string; path: string } }>(
      `/recycle-bin/${id}/restore`,
      { method: "POST" },
    ),
  /** Delete everything in the bin for good. */
  emptyRecycleBin: () =>
    request<{ data: { removed: number } }>("/recycle-bin", { method: "DELETE" }),
  listSuppliers: () => request<{ data: Supplier[] }>("/suppliers"),
  deleteSupplier: (id: string) =>
    request<{ data: { id: string; stock: number; purchases: number } }>(
      `/suppliers/${id}`,
      { method: "DELETE" },
    ),
  listSupplierMobiles: () =>
    request<{ data: SupplierMobile[] }>("/suppliers/mobiles"),
  getSupplier: (id: string) =>
    request<{ data: SupplierDetail }>(`/suppliers/${id}`),
  downloadSupplierMobilesExport: async (
    supplierId: string,
    condition: "NEW" | "USED",
  ) => {
    const token = getAuthToken();
    const params = new URLSearchParams({ condition });
    const response = await fetchBackend(
      `${API_BASE}/suppliers/${encodeURIComponent(supplierId)}/mobiles-export?${params}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!response.ok) {
      let message = "Could not download PDF";
      try {
        const body = await response.json();
        message = body.error || message;
      } catch {
        // ignore
      }
      throw new ApiError(message, response.status);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename="?([^"]+)"?/i.exec(disposition);
    const filename = match?.[1] || `supplier-mobiles.pdf`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return {
      filename,
      unitCount: Number(response.headers.get("X-Unit-Count") || 0),
      soldCount: Number(response.headers.get("X-Sold-Count") || 0),
    };
  },
  downloadSupplierMobilesExportByName: async (
    name: string,
    condition: "NEW" | "USED",
  ) => {
    const token = getAuthToken();
    const params = new URLSearchParams({ name, condition });
    const response = await fetchBackend(
      `${API_BASE}/suppliers/export-mobiles?${params}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!response.ok) {
      let message = "Could not download Excel";
      try {
        const body = await response.json();
        message = body.error || message;
      } catch {
        // ignore
      }
      throw new ApiError(message, response.status);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename="?([^"]+)"?/i.exec(disposition);
    const filename = match?.[1] || `supplier-mobiles.xlsx`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return {
      filename,
      unitCount: Number(response.headers.get("X-Unit-Count") || 0),
      soldCount: Number(response.headers.get("X-Sold-Count") || 0),
    };
  },
  createSupplier: (payload: {
    name: string;
    phone?: string | null;
    address?: string | null;
    notes?: string | null;
  }) =>
    request<{ data: Supplier }>("/suppliers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSupplier: (
    id: string,
    payload: {
      name?: string;
      phone?: string | null;
      address?: string | null;
      notes?: string | null;
    },
  ) =>
    request<{ data: Supplier }>(`/suppliers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  /** Download the supplier statement PDF (purchases Cr / payments Dr). */
  downloadSupplierStatement: async (supplierId: string) => {
    const token = getAuthToken();
    const response = await fetchBackend(
      `${API_BASE}/suppliers/${encodeURIComponent(supplierId)}/statement`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!response.ok) {
      let message = "Could not download statement";
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* not JSON */
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename="?([^"]+)"?/i.exec(disposition);
    const filename = match?.[1] || "supplier-statement.pdf";
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
  createPurchase: (payload: {
    supplierId?: string | null;
    supplierName?: string | null;
    supplierPhone?: string | null;
    condition: "NEW" | "USED";
    note?: string | null;
    purchaseDate?: string | null;
    items: Array<{
      platform: "IOS" | "ANDROID";
      mobileName: string;
      storage: string;
      ram?: string;
      color: string;
      imei?: string;
      serialNumber?: string;
      purchasePrice: number;
    }>;
    payment?: PaymentAtPurchase | null;
  }) =>
    request<{ data: Purchase }>("/purchases", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /** No amount = mark the whole purchase paid; with amount = part payment. */
  /** Pay a supplier's outstanding (oldest purchases first). Omit amount to pay it all. */
  paySupplier: (id: string, amount?: number) =>
    request<{
      data: { paid: number; purchasesCleared: number; outstanding: number };
    }>(`/suppliers/${id}/pay`, {
      method: "POST",
      body: JSON.stringify(amount === undefined ? {} : { amount }),
    }),
  markPurchasePaid: (id: string, amount?: number) =>
    request<{ data: Purchase }>(`/purchases/${id}/mark-paid`, {
      method: "POST",
      body: JSON.stringify(amount === undefined ? {} : { amount }),
    }),
  getPurchase: (id: string) =>
    request<{ data: Purchase }>(`/purchases/${id}`),
  listPurchases: (supplierId?: string) => {
    const params = new URLSearchParams();
    if (supplierId) params.set("supplierId", supplierId);
    const query = params.toString();
    return request<{ data: Purchase[] }>(
      `/purchases${query ? `?${query}` : ""}`,
    );
  },
  listDues: (period: string = "all") =>
    request<{ data: DuesSummary }>(
      `/dues?period=${encodeURIComponent(period)}`,
    ),
  listFinanceDues: () =>
    request<{ data: FinanceDuesSummary }>("/dues/finance"),
  markFinanceReceived: (id: string, slots: Array<1 | 2>) =>
    request<{ data: Bill }>(`/dues/finance/${id}/receive`, {
      method: "PATCH",
      body: JSON.stringify({ slots }),
    }),
  unmarkFinanceReceived: (id: string, slots: Array<1 | 2>) =>
    request<{ data: Bill }>(`/dues/finance/${id}/unreceive`, {
      method: "PATCH",
      body: JSON.stringify({ slots }),
    }),
  settleDue: (
    id: string,
    payload: {
      mode: "full" | "custom";
      method: "cash" | "online" | "card" | "na";
      amount?: number;
      nextDueDate?: string | null;
    },
  ) =>
    request<{ data: Bill }>(`/dues/${id}/settle`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  pdfUrl: (id: string) => {
    const token = getAuthToken();
    const base = `${API_BASE}/bills/${id}/pdf`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
  backupStatus: () =>
    request<{
      data: {
        sqlite: boolean;
        canRestore: boolean;
        approxDbBytes: number | null;
        confirmPhrase: string;
      };
    }>("/reports/backup-status"),
  sendBackupEmail: (scope: "today" | "all" = "all", force = true) =>
    request<{
      data: {
        skipped: boolean;
        scope?: string;
        filename?: string;
        dbFilename?: string | null;
        dbBytes?: number | null;
        billCount?: number;
        emailedTo?: string;
        message?: string;
        dateKey?: string;
      };
    }>("/reports/send", {
      method: "POST",
      body: JSON.stringify({ scope, force }),
    }),
  downloadBackupZip: async () => {
    const token = getAuthToken();
    let response: Response;
    try {
      response = await fetchBackend(`${API_BASE}/reports/download-backup-zip`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      throw new ApiError(
        "Cannot reach the server. Make sure the API is running on port 4000.",
        0,
      );
    }

    if (response.status === 401) {
      clearAuthToken();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }

    if (!response.ok) {
      let message = "Could not download backup zip";
      try {
        const body = await response.json();
        message = body.error || message;
      } catch {
        /* ignore */
      }
      throw new ApiError(message, response.status);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename="?([^"]+)"?/i.exec(disposition);
    const filename = match?.[1] || `BabuMobile-Backup.zip`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return {
      filename,
      excelFilename: response.headers.get("X-Excel-Filename") || null,
      dbFilename: response.headers.get("X-Db-Filename") || null,
    };
  },
  listRepairJobs: (q = "", status: RepairStatus | "" = "") => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    const query = params.toString();
    return request<{ data: RepairJob[] }>(`/repairs${query ? `?${query}` : ""}`);
  },
  /** shop: one repair shop, or omit for every shop this user may see. */
  repairAnalytics: (period: RepairAnalytics["period"], shop?: string) =>
    request<{ data: RepairAnalytics }>(
      `/repairs/analytics?period=${period}${shop ? `&shop=${encodeURIComponent(shop)}` : ""}`,
    ),
  updateRepairStatus: (
    id: string,
    payload: {
      status: RepairStatus;
      outcome?: RepairOutcome;
      finalCharge?: number | null;
      repairNotes?: string;
      /** Chips joined: work done (fixed) or reasons (not fixed). */
      workDone?: string;
      /** Required when delivering with a charge. */
      paymentMethod?: RepairPaymentMethod;
      /** Admins only: the shop's cost for the repair. */
      costPrice?: number | null;
      /** Only when someone other than the customer collects (send both). */
      pickupName?: string;
      pickupPhone?: string;
    },
  ) =>
    request<{ data: RepairJob }>(`/repairs/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  /** Repair slip PDF; token in the URL like bill PDFs so it opens in a new tab. */
  repairSlipUrl: (id: string, download = false) => {
    const token = getAuthToken();
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (download) params.set("download", "1");
    return `${API_BASE}/repairs/${id}/slip?${params.toString()}`;
  },
  getRepairJob: (id: string) => request<{ data: RepairJob }>(`/repairs/${id}`),
  deleteRepairJob: (id: string) =>
    request<{ ok: true }>(`/repairs/${id}`, { method: "DELETE" }),
  /** Edit a job's intake details (customer, phone, problem, delivery date…). */
  updateRepairJob: (id: string, payload: Record<string, string>) =>
    request<{ data: RepairJob }>(`/repairs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  /** Admin: set the shop's cost for a job at any stage. */
  setRepairCost: (id: string, costPrice: number | null) =>
    request<{ data: RepairJob }>(`/repairs/${id}/cost`, {
      method: "PATCH",
      body: JSON.stringify({ costPrice }),
    }),
  /** Records that the shop called the customer (shown in the job's activity). */
  markRepairNotified: (id: string) =>
    request<{ data: RepairJob }>(`/repairs/${id}/notified`, { method: "POST" }),
  /** Adds or replaces a photo after intake (compress it first). */
  uploadRepairPhoto: async (id: string, side: "front" | "back", photo: Blob, type: string) => {
    const token = getAuthToken();
    const form = new FormData();
    form.append("photo", photo, `.${type === "image/webp" ? "webp" : "jpg"}`);
    let response: Response;
    try {
      response = await fetchBackend(`${API_BASE}/repairs/${id}/photo/${side}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
    } catch {
      throw new ApiError("Cannot reach the server. Check your connection.", 0);
    }
    if (!response.ok) {
      let message = "Could not save the photo";
      try {
        message = (await response.json()).error || message;
      } catch {
        /* keep default */
      }
      throw new ApiError(message, response.status);
    }
    return response.json() as Promise<{ data: RepairJob }>;
  },
  /** Multipart: text fields plus optional frontPhoto / backPhoto (already compressed). */
  createRepairJob: async (form: FormData) => {
    const token = getAuthToken();
    let response: Response;
    try {
      response = await fetchBackend(`${API_BASE}/repairs`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
    } catch {
      throw new ApiError("Cannot reach the server. Check your connection.", 0);
    }
    if (!response.ok) {
      let message = "Could not save the repair";
      try {
        const body = await response.json();
        message = body.error || message;
        const firstField = body.details?.fieldErrors
          ? Object.values(body.details.fieldErrors).flat()[0]
          : null;
        if (typeof firstField === "string") message = firstField;
        if (body.details?.formErrors?.[0]) message = body.details.formErrors[0];
      } catch {
        /* keep default */
      }
      throw new ApiError(message, response.status);
    }
    return response.json() as Promise<{ data: RepairJob }>;
  },
  /** Photos need the auth header, so load them as blobs and hand back an object URL. */
  loadRepairPhoto: async (id: string, side: "front" | "back") => {
    const token = getAuthToken();
    const response = await fetchBackend(`${API_BASE}/repairs/${id}/photo/${side}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new ApiError("Photo not available", response.status);
    return URL.createObjectURL(await response.blob());
  },
  restoreDatabase: async (file: File, confirm: string) => {
    const token = getAuthToken();
    const form = new FormData();
    form.append("database", file);
    form.append("confirm", confirm);

    let response: Response;
    try {
      response = await fetchBackend(`${API_BASE}/reports/restore-db`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
    } catch {
      throw new ApiError(
        "Cannot reach the server. Make sure the API is running on port 4000.",
        0,
      );
    }

    if (response.status === 401) {
      clearAuthToken();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }

    if (!response.ok) {
      let message = "Restore failed";
      try {
        const body = await response.json();
        message = body.error || message;
        if (body.detail && typeof body.detail === "string") {
          message = `${message}: ${body.detail}`;
        }
      } catch {
        /* ignore */
      }
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<{
      data: {
        ok: boolean;
        bytes: number;
        restarting: boolean;
        message: string;
        previousBackupPath: string | null;
      };
    }>;
  },
};

export function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

/** Display IMEI and/or serial for a stock unit. */
/** Sold units bought back later keep their old ID as `ID~stockId`; show just ID. */
function liveStockId(value?: string | null) {
  return value ? value.split("~")[0] : value;
}

export function formatStockUnitId(item: {
  imei?: string | null;
  serialNumber?: string | null;
}) {
  const imei = liveStockId(item.imei);
  const serialNumber = liveStockId(item.serialNumber);
  if (imei && serialNumber) {
    return `${imei} · SN ${serialNumber}`;
  }
  return imei || serialNumber || "—";
}

export function formatFinanceCompanies(
  name1?: string | null,
  name2?: string | null,
) {
  return [name1, name2].map((n) => n?.trim()).filter(Boolean).join(" + ");
}

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
