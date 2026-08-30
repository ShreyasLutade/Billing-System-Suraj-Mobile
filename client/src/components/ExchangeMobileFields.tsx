import clsx from "clsx";
import { Trash2 } from "lucide-react";
import { MobileNameSearch } from "./MobileNameSearch";
import {
  ImeiScanFieldButton,
  ScanFieldShell,
  scanFieldInputClass,
} from "./BarcodeImeiScanner";
import { formatINR } from "../lib/api";
import { formatCapacityLabel } from "../lib/phoneModelSearch";
import type { PhoneModel } from "../types";

export type ExchangeDraft = {
  key: string;
  platform: "IOS" | "ANDROID";
  model: string;
  color: string;
  storage: string;
  ram: string;
  imei1: string;
  value: number | "";
  notes: string;
};

export function blankExchangeItem(): ExchangeDraft {
  return {
    key: crypto.randomUUID(),
    platform: "IOS",
    model: "",
    color: "",
    storage: "",
    ram: "",
    imei1: "",
    value: "",
    notes: "",
  };
}

export function exchangeTotalValue(items: ExchangeDraft[]) {
  return items.reduce(
    (sum, item) => sum + (item.value === "" ? 0 : Number(item.value) || 0),
    0,
  );
}

type Props = {
  item: ExchangeDraft;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<ExchangeDraft>) => void;
  onRemove: () => void;
};

export function ExchangeMobileFields({
  item,
  index,
  canRemove,
  onChange,
  onRemove,
}: Props) {
  const idPrefix = `exchange-${item.key}`;

  return (
    <div className="space-y-4 rounded-2xl border border-ink-100 bg-white/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
          Exchange mobile {index + 1}
        </p>
        {canRemove ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-rose-600 hover:underline"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        ) : null}
      </div>

      <div>
        <span className="label required">Operating system</span>
        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#EEF0F3] p-1.5">
          {(["IOS", "ANDROID"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={clsx(
                "inline-flex items-center justify-center gap-2 rounded-[9px] px-3 py-2.5 text-sm font-medium transition",
                item.platform === option
                  ? "bg-ink-900 font-semibold text-white shadow-[0_4px_12px_rgba(11,31,51,.25)]"
                  : "text-ink-500 hover:text-ink-700",
              )}
              aria-pressed={item.platform === option}
              onClick={() => {
                if (option === item.platform) return;
                onChange({
                  platform: option,
                  model: "",
                  storage: "",
                  ram: "",
                });
              }}
            >
              {option === "IOS" ? "iOS" : "Android"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label required" htmlFor={`${idPrefix}-model`}>
          Mobile name
        </label>
        <MobileNameSearch
          id={`${idPrefix}-model`}
          platform={item.platform}
          value={item.model}
          required
          onChange={(name) => {
            if (!name.trim()) {
              onChange({ model: "", storage: "", ram: "" });
              return;
            }
            onChange({ model: name });
          }}
          onSelectModel={(model: PhoneModel) => {
            onChange({
              model: model.name,
              storage:
                formatCapacityLabel(model.storage) || model.storage,
              ram:
                item.platform === "ANDROID"
                  ? formatCapacityLabel(model.ram) || model.ram
                  : "",
            });
          }}
        />
      </div>

      <div
        className={
          item.platform === "ANDROID"
            ? "grid gap-3.5 sm:grid-cols-3"
            : "grid gap-3.5 sm:grid-cols-2"
        }
      >
        <div>
          <label className="label required" htmlFor={`${idPrefix}-storage`}>
            Storage
          </label>
          <input
            id={`${idPrefix}-storage`}
            className="field"
            value={item.storage}
            onChange={(e) => onChange({ storage: e.target.value })}
            placeholder="e.g. 128 GB"
            required
          />
        </div>
        <div>
          <label className="label required" htmlFor={`${idPrefix}-color`}>
            Color
          </label>
          <input
            id={`${idPrefix}-color`}
            className="field"
            value={item.color}
            onChange={(e) => onChange({ color: e.target.value })}
            placeholder="e.g. Black"
            required
          />
        </div>
        {item.platform === "ANDROID" ? (
          <div>
            <label className="label required" htmlFor={`${idPrefix}-ram`}>
              RAM
            </label>
            <input
              id={`${idPrefix}-ram`}
              className="field"
              value={item.ram}
              onChange={(e) => onChange({ ram: e.target.value })}
              placeholder="e.g. 8 GB"
              required
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label className="label required" htmlFor={`${idPrefix}-imei`}>
            IMEI
          </label>
          <div className="flex items-center gap-2">
            <ScanFieldShell className="min-w-0 flex-1">
              <input
                id={`${idPrefix}-imei`}
                className={scanFieldInputClass}
                value={item.imei1}
                onChange={(e) => onChange({ imei1: e.target.value })}
                placeholder="15-digit IMEI"
                inputMode="numeric"
                required
              />
              <ImeiScanFieldButton
                onScan={(imei) => onChange({ imei1: imei })}
              />
            </ScanFieldShell>
          </div>
        </div>
        <div>
          <label
            className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.07em] text-[#0E9E76]"
            htmlFor={`${idPrefix}-value`}
          >
            Exchange value
            <span className="ml-0.5 text-[#B76E00]"> *</span>
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-[#0E9E76]">
              ₹
            </span>
            <input
              id={`${idPrefix}-value`}
              className="w-full rounded-[11px] border border-[#BFE9D6] bg-[#E7F8F1] py-3 pl-[30px] pr-3.5 font-display text-base font-semibold tabular-nums text-ink-900 outline-none transition focus:border-[#12B886] focus:bg-white focus:shadow-[0_0_0_3px_rgba(18,184,134,.15)]"
              type="number"
              min={0}
              step="0.01"
              value={item.value}
              onChange={(e) =>
                onChange({
                  value:
                    e.target.value === ""
                      ? ""
                      : Number(e.target.value) || 0,
                })
              }
              placeholder="Amount to deduct"
              inputMode="decimal"
              required
            />
          </div>
          {item.value !== "" ? (
            <p className="mt-1 text-[11.5px] text-ink-300">
              {formatINR(Number(item.value) || 0)} for this phone
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`${idPrefix}-notes`}>
          Notes
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          className="field min-h-[70px] resize-y"
          value={item.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Optional — screen condition, box, accessories, etc."
        />
      </div>
    </div>
  );
}
