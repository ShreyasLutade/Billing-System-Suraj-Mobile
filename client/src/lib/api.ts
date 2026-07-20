import type {
  AnalyticsSummary,
  AuthUser,
  Bill,
  CreateBillPayload,
  DuesSummary,
  FinanceCompany,
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
  listBills: (period?: string) =>
    request<{ data: Bill[]; period?: string }>(
      `/bills${period ? `?period=${encodeURIComponent(period)}` : ""}`,
    ),
  getBill: (id: string) => request<{ data: Bill }>(`/bills/${id}`),
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
  analytics: (period: string = "today") =>
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
  listDues: (period: string = "all") =>
    request<{ data: DuesSummary }>(
      `/dues?period=${encodeURIComponent(period)}`,
    ),
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

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
