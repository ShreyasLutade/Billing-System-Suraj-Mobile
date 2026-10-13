import { Cable, Package, PlugZap, Receipt, type LucideIcon } from "lucide-react";
import type { ExchangeAccessory, ExchangeAccessoryKey } from "../types";

export const EXCHANGE_ACCESSORIES: Array<{
  key: ExchangeAccessoryKey;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "BOX", label: "Box", icon: Package },
  { key: "CHARGER", label: "Charger", icon: PlugZap },
  { key: "CABLE", label: "Cable", icon: Cable },
  { key: "BILL", label: "Bill", icon: Receipt },
];

export function accessoryLabel(key: ExchangeAccessoryKey) {
  return EXCHANGE_ACCESSORIES.find((a) => a.key === key)?.label ?? key;
}

export function accessoryIcon(key: ExchangeAccessoryKey) {
  return EXCHANGE_ACCESSORIES.find((a) => a.key === key)?.icon ?? Package;
}

export function pendingAccessories(accessories?: ExchangeAccessory[] | null) {
  return (accessories ?? []).filter((a) => a.status === "PENDING");
}

/** "Box, Charger & Bill" */
export function joinAccessoryLabels(keys: ExchangeAccessoryKey[]) {
  const labels = keys.map(accessoryLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
}

/** Bill line field "BOX,CHARGER" → keys in display order. */
export function parseIncludedAccessories(raw?: string | null) {
  if (!raw) return [] as ExchangeAccessoryKey[];
  const parts = raw.split(",").map((part) => part.trim());
  return EXCHANGE_ACCESSORIES.map((a) => a.key).filter((key) =>
    parts.includes(key),
  );
}

export function serializeIncludedAccessories(keys: ExchangeAccessoryKey[]) {
  const ordered = EXCHANGE_ACCESSORIES.map((a) => a.key).filter((key) =>
    keys.includes(key),
  );
  return ordered.length ? ordered.join(",") : null;
}
