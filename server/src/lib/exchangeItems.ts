export const EXCHANGE_ACCESSORY_KEYS = [
  "BOX",
  "CHARGER",
  "CABLE",
  "BILL",
] as const;

export type ExchangeAccessoryKey = (typeof EXCHANGE_ACCESSORY_KEYS)[number];

/** Extra item handed over with an exchange phone; PENDING = customer still owes it. */
export type ExchangeAccessory = {
  key: ExchangeAccessoryKey;
  status: "GIVEN" | "PENDING";
  /** Set when a PENDING item was later handed over. */
  receivedAt?: string | null;
};

export function normalizeExchangeAccessories(raw: unknown): ExchangeAccessory[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ExchangeAccessory[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const key = entry.key;
    if (
      typeof key !== "string" ||
      !(EXCHANGE_ACCESSORY_KEYS as readonly string[]).includes(key) ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    const status = entry.status === "PENDING" ? "PENDING" : "GIVEN";
    out.push({
      key: key as ExchangeAccessoryKey,
      status,
      receivedAt:
        status === "GIVEN" &&
        typeof entry.receivedAt === "string" &&
        entry.receivedAt
          ? entry.receivedAt
          : null,
    });
  }
  return out;
}

export type BillExchangeItem = {
  model: string;
  platform: "IOS" | "ANDROID";
  color: string;
  storage: string;
  ram?: string | null;
  imei1: string;
  value: number;
  notes?: string | null;
  accessories?: ExchangeAccessory[];
};

export function parseExchangeItemsJson(
  raw?: string | null,
): BillExchangeItem[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row): BillExchangeItem | null => {
        if (!row || typeof row !== "object") return null;
        const item = row as Record<string, unknown>;
        const model = typeof item.model === "string" ? item.model.trim() : "";
        const platform =
          item.platform === "ANDROID" ? ("ANDROID" as const) : ("IOS" as const);
        const color = typeof item.color === "string" ? item.color.trim() : "";
        const storage =
          typeof item.storage === "string" ? item.storage.trim() : "";
        const imei1 = typeof item.imei1 === "string" ? item.imei1.trim() : "";
        const value = Number(item.value);
        if (!model || !color || !storage || !imei1 || !Number.isFinite(value)) {
          return null;
        }
        return {
          model,
          platform,
          color,
          storage,
          ram:
            typeof item.ram === "string" && item.ram.trim()
              ? item.ram.trim()
              : null,
          imei1,
          value,
          notes:
            typeof item.notes === "string" && item.notes.trim()
              ? item.notes.trim()
              : null,
          accessories: normalizeExchangeAccessories(item.accessories),
        };
      })
      .filter((item): item is BillExchangeItem => item !== null);
  } catch {
    return [];
  }
}

export function serializeExchangeItemsJson(items: BillExchangeItem[]) {
  return JSON.stringify(items);
}

export function exchangeItemsFromInput(input: {
  isExchange?: boolean;
  exchangeItems?: BillExchangeItem[];
  exchangeModel?: string | null;
  exchangePlatform?: string | null;
  exchangeColor?: string | null;
  exchangeStorage?: string | null;
  exchangeRam?: string | null;
  exchangeImei1?: string | null;
  exchangeValue?: number | null;
  exchangeNotes?: string | null;
}): BillExchangeItem[] {
  if (input.exchangeItems?.length) {
    return input.exchangeItems.map((item) => ({
      ...item,
      platform: item.platform === "ANDROID" ? "ANDROID" : "IOS",
      ram:
        item.platform === "ANDROID" && item.ram?.trim() ? item.ram.trim() : null,
      accessories: normalizeExchangeAccessories(item.accessories),
    }));
  }

  if (
    input.isExchange &&
    input.exchangeModel?.trim() &&
    input.exchangePlatform &&
    input.exchangeColor?.trim() &&
    input.exchangeStorage?.trim() &&
    input.exchangeImei1?.trim()
  ) {
    const platform =
      input.exchangePlatform === "ANDROID" ? "ANDROID" : "IOS";
    return [
      {
        model: input.exchangeModel.trim(),
        platform,
        color: input.exchangeColor.trim(),
        storage: input.exchangeStorage.trim(),
        ram:
          platform === "ANDROID" && input.exchangeRam?.trim()
            ? input.exchangeRam.trim()
            : null,
        imei1: input.exchangeImei1.trim(),
        value: Number(input.exchangeValue ?? 0) || 0,
        notes: input.exchangeNotes?.trim() || null,
      },
    ];
  }

  return [];
}

export function totalExchangeValue(items: BillExchangeItem[]) {
  return Math.round(
    items.reduce((sum, item) => sum + (Number(item.value) || 0), 0) * 100,
  ) / 100;
}

export function exchangeDeductionAmount(input: {
  isExchange?: boolean;
  exchangeItems?: BillExchangeItem[];
  exchangeValue?: number | null;
  exchangeCashReturn?: number | null;
  exchangeModel?: string | null;
  exchangePlatform?: string | null;
  exchangeColor?: string | null;
  exchangeStorage?: string | null;
  exchangeRam?: string | null;
  exchangeImei1?: string | null;
  exchangeNotes?: string | null;
}) {
  if (!input.isExchange) return 0;
  const items = exchangeItemsFromInput(input);
  const gross = items.length
    ? totalExchangeValue(items)
    : Number(input.exchangeValue ?? 0) || 0;
  const cashReturn = Math.max(0, Number(input.exchangeCashReturn ?? 0) || 0);
  const capped = Math.min(cashReturn, gross);
  return Math.round((gross - capped) * 100) / 100;
}

/** Bill line: accessories handed to the buyer, stored as "BOX,CHARGER". */
export function serializeIncludedAccessories(keys?: readonly string[] | null) {
  const valid = EXCHANGE_ACCESSORY_KEYS.filter((key) => keys?.includes(key));
  return valid.length ? valid.join(",") : null;
}

export function parseIncludedAccessories(raw?: string | null) {
  if (!raw) return [] as ExchangeAccessoryKey[];
  const parts = raw.split(",").map((part) => part.trim());
  return EXCHANGE_ACCESSORY_KEYS.filter((key) => parts.includes(key));
}

const ACCESSORY_LABELS: Record<ExchangeAccessoryKey, string> = {
  BOX: "Box",
  CHARGER: "Charger",
  CABLE: "Cable",
  BILL: "Bill",
};

/** "Box, Charger & Cable" */
export function includedAccessoriesLabel(raw?: string | null) {
  const labels = parseIncludedAccessories(raw).map((key) => ACCESSORY_LABELS[key]);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
}
