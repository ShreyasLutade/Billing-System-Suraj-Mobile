import type { PhoneModel } from "../types";
import {
  compactSearchText,
  normalizeSearchText,
} from "./elasticSearch";

function tokens(value: string) {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

/** Rank phone models for Google-like typeahead. */
export function rankPhoneModels(
  models: PhoneModel[],
  query: string,
  limit = 12,
): PhoneModel[] {
  const q = normalizeSearchText(query);
  if (!q) return [];

  const qTokens = tokens(q);
  const qCompact = compactSearchText(q);
  const scored: Array<{ model: PhoneModel; score: number }> = [];

  for (const model of models) {
    const name = normalizeSearchText(model.name);
    const storage = normalizeSearchText(model.storage);
    const ram = normalizeSearchText(model.ram || "");
    const haystack = `${name} ${storage} ${ram}`.trim();
    const nameCompact = compactSearchText(model.name);
    const hayCompact = compactSearchText(haystack);

    let score = 0;

    if (name === q || nameCompact === qCompact) score = 1000;
    else if (name.startsWith(q) || nameCompact.startsWith(qCompact)) {
      score = 920 - Math.min(name.length, 80);
    } else if (haystack.startsWith(q) || hayCompact.startsWith(qCompact)) {
      score = 860;
    } else if (
      name.includes(` ${q}`) ||
      name.includes(q) ||
      nameCompact.includes(qCompact)
    ) {
      score = 750;
    } else if (haystack.includes(q) || hayCompact.includes(qCompact)) {
      score = 620;
    } else {
      // Token match: every query word must appear somewhere (order-free).
      const nameTokens = tokens(name);
      const allMatch = qTokens.every(
        (token) =>
          name.includes(token) ||
          nameTokens.some((nt) => nt.startsWith(token) || token.startsWith(nt)) ||
          storage.includes(token) ||
          ram.includes(token) ||
          nameCompact.includes(token),
      );
      if (!allMatch) continue;

      let tokenScore = 480;
      for (const token of qTokens) {
        if (nameTokens.includes(token)) tokenScore += 50;
        else if (name.startsWith(token) || name.includes(` ${token}`)) {
          tokenScore += 35;
        } else if (name.includes(token)) tokenScore += 25;
        else if (storage.includes(token) || ram.includes(token)) tokenScore += 15;
      }
      // Prefer contiguous phrase order (e.g. "15 pro" inside "iphone 15 pro").
      if (name.includes(q) || nameCompact.includes(qCompact)) tokenScore += 80;
      score = tokenScore;
    }

    score -= Math.min(model.name.length, 40) * 0.12;
    scored.push({ model, score });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score || a.model.name.localeCompare(b.model.name),
    )
    .slice(0, limit)
    .map((row) => row.model);
}

export function formatCapacityLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/gb$/i.test(trimmed) || /tb$/i.test(trimmed)) return trimmed;
  return /^\d+$/.test(trimmed) ? `${trimmed} GB` : trimmed;
}

export function formatPhoneModelLabel(model: PhoneModel) {
  const storage = formatCapacityLabel(model.storage);
  if (model.platform === "ANDROID" && model.ram) {
    return `${model.name} · ${storage} · ${formatCapacityLabel(model.ram)}`;
  }
  return `${model.name} · ${storage}`;
}
