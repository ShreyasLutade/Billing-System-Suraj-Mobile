/**
 * Elastic-style text match used by all search bars.
 * Ignores case, spaces, and most punctuation so "redmia13" matches "Redmi A13".
 */

/** Insert spaces between letter↔digit boundaries: "a13" → "a 13", "13a" → "13 a" */
function splitAlphaNum(value: string): string {
  return value
    .replace(/([a-z])(\d)/gi, "$1 $2")
    .replace(/(\d)([a-z])/gi, "$1 $2");
}

export function normalizeSearchText(value: string): string {
  return splitAlphaNum(value)
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

function tokens(value: string): string[] {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

/**
 * Match a compact query against haystack tokens in order, allowing gaps.
 * "redmia13" matches tokens [redmi, a13] or [redmi, a, 13] or [redmi, note, 13].
 */
function compactTokenMatch(haystack: string, queryCompact: string): boolean {
  if (!queryCompact) return true;
  const hTokens = tokens(haystack);
  if (!hTokens.length) return false;

  let i = 0;
  for (const token of hTokens) {
    if (i >= queryCompact.length) return true;
    const rest = queryCompact.slice(i);

    if (rest.startsWith(token)) {
      i += token.length;
      continue;
    }
    // Query ends inside this token ("red" vs "redmi")
    if (token.startsWith(rest)) return true;

    // Partial overlap at the start of remaining query — only consume
    // when the shared prefix exhausts the query (mid-token end).
    let k = 0;
    while (
      k < token.length &&
      i + k < queryCompact.length &&
      token[k] === queryCompact[i + k]
    ) {
      k += 1;
    }
    if (k > 0 && i + k === queryCompact.length) return true;
    // Otherwise skip this token (gap) and keep trying.
  }
  return i >= queryCompact.length;
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
  if (hCompact.includes(qCompact)) return true;

  // "redmia13" vs "Redmi A 13" / "Redmi Note A13" via ordered tokens
  if (compactTokenMatch(haystack || "", qCompact)) return true;

  // Spaced query: every token must appear (prefix-friendly)
  const qTokens = qNorm.split(" ").filter(Boolean);
  if (qTokens.length > 1) {
    const hTokens = tokens(haystack || "");
    return qTokens.every(
      (qt) =>
        hNorm.includes(qt) ||
        hCompact.includes(qt) ||
        hTokens.some((ht) => ht.startsWith(qt) || qt.startsWith(ht)),
    );
  }

  return false;
}

/** Match query against any of several fields joined as one haystack. */
export function matchesElasticFields(
  fields: Array<string | null | undefined>,
  query: string,
): boolean {
  if (!normalizeSearchText(query)) return true;
  // Prefer per-field match so a long joined string can't hide token gaps oddly,
  // then fall back to joined haystack for cross-field queries ("redmi 128").
  if (fields.some((field) => matchesElasticSearch(field, query))) return true;
  return matchesElasticSearch(fields.filter(Boolean).join(" "), query);
}
