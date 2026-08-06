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

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
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
  } catch {
    throw new Error(
      "Cannot reach the server. Make sure the API is running on port 4000.",
    );
  }

  if (response.status === 401 && !path.startsWith("/auth/login")) {
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
    throw new Error(message);
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
  me: () => request<{ data: { user: AuthUser } }>("/auth/me"),
  listBills: (period?: string, options?: { withGst?: boolean }) => {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
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
  deleteBill: (id: string) =>
    request<{ data: { id: string; invoiceNumber: string } }>(`/bills/${id}`, {
      method: "DELETE",
    }),
  analytics: (period: string = "all") =>
    request<{ data: AnalyticsSummary }>(
      `/analytics/summary?period=${encodeURIComponent(period)}`,
    ),
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
  createStockItem: (payload: {
    condition: "NEW" | "USED";
    platform: "IOS" | "ANDROID";
    mobileName: string;
    storage: string;
    ram?: string;
    color: string;
    imei: string;
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
      imei: string;
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
  markFinanceReceived: (id: string) =>
    request<{ data: Bill }>(`/dues/finance/${id}/receive`, {
      method: "PATCH",
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

export function formatFinanceCompanies(
  name1?: string | null,
  name2?: string | null,
) {
  return [name1, name2].map((n) => n?.trim()).filter(Boolean).join(" + ");
}

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
