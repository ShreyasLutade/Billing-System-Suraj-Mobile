import type {
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
  StockHistory,
  StockItem,
  Supplier,
  SupplierDetail,
  SupplierPayment,
} from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const TOKEN_KEY = "suraj_billing_token";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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
  deleteBill: (id: string, mode: "delete" | "return" = "delete") =>
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
  listStock: (condition?: "NEW" | "USED", includeIds?: string[]) => {
    const params = new URLSearchParams();
    if (condition) params.set("condition", condition);
    if (includeIds?.length) params.set("includeIds", includeIds.join(","));
    const query = params.toString();
    return request<{ data: StockItem[] }>(
      `/stock${query ? `?${query}` : ""}`,
    );
  },
  findAvailableStockByImei: (imei: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ imei: imei.replace(/\D/g, "") });
    return request<{ data: StockItem }>(`/stock/lookup?${params}`, {
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
  deleteStockItem: (id: string) =>
    request<{ data: { id: string } }>(`/stock/${id}`, {
      method: "DELETE",
    }),
  stockHistory: (id: string) =>
    request<{ data: StockHistory }>(`/stock/${id}/history`),
  listSuppliers: () => request<{ data: Supplier[] }>("/suppliers"),
  getSupplier: (id: string) =>
    request<{ data: SupplierDetail }>(`/suppliers/${id}`),
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
  createSupplierPayment: (
    id: string,
    payload: {
      amount: number;
      method: "cash" | "online" | "na";
      paidAt?: string | null;
      note?: string | null;
    },
  ) =>
    request<{ data: SupplierPayment; ledger: Supplier }>(
      `/suppliers/${id}/payments`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
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
  }) =>
    request<{ data: Purchase }>("/purchases", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  markPurchasePaid: (id: string) =>
    request<{ data: Purchase }>(`/purchases/${id}/mark-paid`, {
      method: "POST",
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
      method: "cash" | "online" | "na";
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
};

export function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

/** Display IMEI and/or serial for a stock unit. */
export function formatStockUnitId(item: {
  imei?: string | null;
  serialNumber?: string | null;
}) {
  if (item.imei && item.serialNumber) {
    return `${item.imei} · SN ${item.serialNumber}`;
  }
  return item.imei || item.serialNumber || "—";
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
