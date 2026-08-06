/** Shared capacity helpers — users type numbers; we store "128 GB". */

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Normalize storage/RAM for persistence.
 * - "128" / "128 GB" → "128 GB"
 * - "1 TB" / "1TB" → "1024 GB"
 * - "2 TB" → "2048 GB"
 */
export function normalizeCapacity(value: string) {
  const normalized = clean(value);
  if (!normalized) return "";

  const tb = normalized.match(/^(\d+(?:\.\d+)?)\s*tb$/i);
  if (tb) {
    const gb = Math.round(Number(tb[1]) * 1024);
    return `${gb} GB`;
  }

  // Also accept bare 2048 / 1024 style already in digits.
  const capacity = normalized.replace(/\s*gb\s*$/i, "").trim();
  return /^\d+$/.test(capacity) ? `${capacity} GB` : normalized;
}

/** Digits only for search catalog / form fill: "128 GB" → "128", "1 TB" → "1024". */
export function capacityDigits(value: string) {
  const normalized = normalizeCapacity(value);
  if (!normalized) return "";
  const digits = normalized.replace(/\s*gb\s*$/i, "").trim();
  return /^\d+$/.test(digits) ? digits : clean(value);
}
