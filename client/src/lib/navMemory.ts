export function listPath(pathname: string, search: string) {
  return `${pathname}${search}`;
}

export function readStoredTab<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const value = sessionStorage.getItem(key);
    if (value && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
  } catch {
    // ignore
  }
  return fallback;
}

export function writeStoredTab(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function fromState(location: { pathname: string; search: string }) {
  return { from: listPath(location.pathname, location.search) };
}

function safePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}

export function readFromState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  return safePath((state as { from?: unknown }).from);
}

export function readOriginState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  return safePath((state as { origin?: unknown }).origin);
}

export function backLabel(from: string | null) {
  if (from?.startsWith("/dues")) return "Back to dues";
  if (from?.startsWith("/analytics")) return "Back to analytics";
  if (from?.startsWith("/stock")) return "Back to stock";
  if (from?.startsWith("/suppliers")) return "Back to suppliers";
  return "Back to bills";
}

export function billsHomePath(withGst?: boolean) {
  return withGst ? "/bills?tab=gst" : "/bills";
}
