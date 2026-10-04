import type {
  RepairCondition,
  RepairOutcome,
  RepairPlatform,
  RepairStatus,
} from "../types";

export const REPAIR_STATUSES: Array<{ value: RepairStatus; label: string }> = [
  { value: "RECEIVED", label: "Received" },
  { value: "IN_REPAIR", label: "In repair" },
  { value: "REPAIRED", label: "Repaired" },
  { value: "DELIVERED", label: "Delivered" },
];

export function statusLabel(value: RepairStatus) {
  return REPAIR_STATUSES.find((s) => s.value === value)?.label ?? value;
}

export function outcomeLabel(value: RepairOutcome) {
  return value === "FIXED" ? "Fixed" : "Couldn’t fix";
}

/** "Repaired · Fixed", "Delivered · Couldn’t fix", "Received". */
export function statusLine(job: { status: RepairStatus; outcome: RepairOutcome | null }) {
  return job.outcome && job.status !== "RECEIVED" && job.status !== "IN_REPAIR"
    ? `${statusLabel(job.status)} · ${outcomeLabel(job.outcome)}`
    : statusLabel(job.status);
}

export function formatRupees(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export const REPAIR_PLATFORMS: Array<{ value: RepairPlatform; label: string }> = [
  { value: "IOS", label: "iOS" },
  { value: "ANDROID", label: "Android" },
];

export const REPAIR_CONDITIONS: Array<{
  value: RepairCondition;
  label: string;
  hint: string;
}> = [
  { value: "LIKE_NEW", label: "Like new", hint: "No marks" },
  { value: "GOOD", label: "Good", hint: "Light scratches" },
  { value: "FAIR", label: "Fair", hint: "Visible wear" },
  { value: "DAMAGED", label: "Damaged", hint: "Cracks or dents" },
  { value: "DEAD", label: "Dead", hint: "Won't turn on" },
];

/** Common phone colours; anything else can be typed. */
export const COLOR_OPTIONS = ["Black", "White", "Blue", "Green", "Silver"];

export function conditionLabel(value: RepairCondition | null) {
  if (!value) return "";
  return REPAIR_CONDITIONS.find((c) => c.value === value)?.label ?? value;
}

export function platformLabel(value: RepairPlatform) {
  return value === "IOS" ? "iOS" : "Android";
}

/** "Black" (plus RAM / storage on older jobs). */
export function repairSpecs(job: {
  color: string | null;
  ram: string | null;
  storage: string | null;
}) {
  return [job.color, job.ram ? `${job.ram} RAM` : null, job.storage].filter(Boolean).join(" · ");
}

/** Repair shops (same keys as server/src/lib/repairShops). */
export const REPAIR_SHOP_LABEL: Record<string, string> = {
  NX: "Babu Mobile NX",
  LK: "Luckey",
};

/** Main shop key: jobs from anyone with full access. */
export const MAIN_REPAIR_SHOP = "NX";

export function repairShopLabel(shop: string) {
  return REPAIR_SHOP_LABEL[shop] ?? shop;
}