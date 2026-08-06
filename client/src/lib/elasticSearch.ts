/**
 * Elastic-style text match used by all search bars.
 * Ignores case, spaces, and most punctuation so "iphone12" matches "iPhone 12".
 */

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compact form: "iphone 15 pro" → "iphone15pro" */
export function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

/** True if query matches haystack (spaces optional). Empty query matches everything. */
export function matchesElasticSearch(
  haystack: string | null | undefined,
  query: string,
): boolean {
  const qNorm = normalizeSearchText(query);
  if (!qNorm) return true;

  const hNorm = normalizeSearchText(haystack || "");
  if (!hNorm) return false;

  if (hNorm.includes(qNorm)) return true;

  const qCompact = qNorm.replace(/\s+/g, "");
  const hCompact = hNorm.replace(/\s+/g, "");
  return hCompact.includes(qCompact);
}

/** Match query against any of several fields joined as one haystack. */
export function matchesElasticFields(
  fields: Array<string | null | undefined>,
  query: string,
): boolean {
  return matchesElasticSearch(fields.filter(Boolean).join(" "), query);
}
