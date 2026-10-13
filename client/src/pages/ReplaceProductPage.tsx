import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import clsx from "clsx";
import {
  AlertTriangle,
  Banknote,
  MonitorSmartphone,
  PackageCheck,
  RefreshCcw,
  RotateCcw,
  Search,
  Smartphone,
} from "lucide-react";
import {
  ImeiScanFieldButton,
  ScanFieldShell,
  scanFieldInputClass,
} from "../components/BarcodeImeiScanner";
import { BackLink, PageHeader } from "../components/ui";
import { api, formatINR } from "../lib/api";
import { backLabel, readFromState } from "../lib/navMemory";
import { formatCapacityLabel } from "../lib/phoneModelSearch";
import type { ReturnLookup, StockItem } from "../types";

type Unit = {
  storage?: string | null;
  ram?: string | null;
  color?: string | null;
  platform?: string | null;
};

function specLabel(unit: Unit) {
  return [
    unit.storage ? formatCapacityLabel(unit.storage) : "",
    unit.platform === "ANDROID" && unit.ram ? formatCapacityLabel(unit.ram) : "",
    unit.color,
  ]
    .filter(Boolean)
    .join(" · ");
}

function idLabel(unit: { imei?: string | null; serialNumber?: string | null }) {
  return [unit.imei ? unit.imei.split("~")[0] : null, unit.serialNumber ? `SN ${unit.serialNumber}` : null]
    .filter(Boolean)
    .join(" · ");
}

function day(value: string) {
  return format(new Date(value), "dd MMM yyyy");
}

const errorBox =
  "rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300";

/**
 * Replace / return a sold product. Find it by IMEI or serial, then choose:
 * Replace — give the customer another unit from stock (it becomes sold), or
 * Return — refund the customer (cash / online). Either way the unit goes back
 * to its supplier, whose outstanding drops by its purchase price, and the bill
 * shows what happened.
 */
export function ReplaceProductPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = readFromState(location.state);
  const [code, setCode] = useState("");
  const [unit, setUnit] = useState<ReturnLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [mode, setMode] = useState<"REPLACE" | "RETURN" | null>(null);
  // Replace
  const [newCode, setNewCode] = useState("");
  const [replacement, setReplacement] = useState<StockItem | null>(null);
  const [findingNew, setFindingNew] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  // Return
  const [refundMethod, setRefundMethod] = useState<"cash" | "online" | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function lookup(value = code) {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setLookupError("Enter the IMEI or serial number");
      return;
    }
    setLooking(true);
    setLookupError(null);
    setSaveError(null);
    setUnit(null);
    setMode(null);
    setReplacement(null);
    setNewCode("");
    setRefundMethod(null);
    try {
      const { data } = await api.lookupReturnUnit(trimmed);
      setUnit(data);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Could not find this product");
    } finally {
      setLooking(false);
    }
  }

  /** Find the replacement in stock by IMEI (8+ digits) or serial number. */
  async function findReplacement(value = newCode) {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setNewError("Enter the IMEI or serial number of the new product");
      return;
    }
    setFindingNew(true);
    setNewError(null);
    setReplacement(null);
    try {
      const digits = trimmed.replace(/\D/g, "");
      let found: StockItem | null = null;
      if (digits.length >= 8 && digits.length === trimmed.replace(/\s+/g, "").length) {
        found = (await api.findAvailableStockByImei(digits).catch(() => null))?.data ?? null;
      }
      if (!found) {
        found = (await api.findAvailableStockBySerial(trimmed).catch(() => null))?.data ?? null;
      }
      if (!found) {
        setNewError("No product in stock with this IMEI / serial number");
      } else if (found.id === unit?.stockItemId) {
        setNewError("That is the product being returned — scan the new one");
      } else {
        setReplacement(found);
      }
    } finally {
      setFindingNew(false);
    }
  }

  const soldPrice = unit?.soldPrice ?? 0;
  /** Refund is always what the customer paid for this item. */
  const refundNum = soldPrice;

  function validate(): string | null {
    if (!mode) return "Choose Replace or Return";
    if (mode === "REPLACE" && !replacement) return "Find the new product to give from stock";
    if (mode === "RETURN") {
      if (refundNum <= 0) return "Nothing was paid for this item to refund";
      if (!refundMethod) return "Choose how the refund was given";
    }
    return null;
  }

  async function submit() {
    if (!unit || unit.alreadyReturned || saving) return;
    const issue = validate();
    if (issue) {
      setSaveError(issue);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await api.createProductReturn({
        stockItemId: unit.stockItemId,
        note: note.trim() || null,
        kind: mode!,
        replacementStockItemId: mode === "REPLACE" ? replacement!.id : null,
        refundAmount: mode === "RETURN" ? refundNum : null,
        refundMethod: mode === "RETURN" ? refundMethod : null,
      });
      navigate(`/bills/${data.billId}`, {
        replace: true,
        state: { from: from ?? "/bills", returnRecorded: true },
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save");
      setSaving(false);
    }
  }

  const credit = unit?.purchasePrice ?? 0;

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink to={from ?? "/bills"} className="mb-4">
        {from ? backLabel(from) : "Back to bills"}
      </BackLink>
      <PageHeader
        eyebrow="Bills"
        title="Replace / return product"
      />

      <div className="glass-panel space-y-3 p-4 sm:p-5">
        <label className="label required" htmlFor="replace-code">
          IMEI or serial number
        </label>
        <div className="flex gap-2">
          <ScanFieldShell className="flex-1">
            <input
              id="replace-code"
              className={scanFieldInputClass}
              value={code}
              placeholder="Scan or type…"
              autoComplete="off"
              autoFocus
              disabled={saving}
              onChange={(event) => {
                setCode(event.target.value);
                setLookupError(null);
                if (unit) setUnit(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void lookup();
                }
              }}
            />
            {/* One scanner (IMEI barcode); a serial number can be typed. */}
            <ImeiScanFieldButton
              disabled={saving}
              onScan={(value) => {
                setCode(value);
                void lookup(value);
              }}
            />
          </ScanFieldShell>
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={() => void lookup()}
            disabled={looking || saving}
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">{looking ? "Finding…" : "Find"}</span>
          </button>
        </div>
        {lookupError ? <p className={errorBox}>{lookupError}</p> : null}
      </div>

      {unit ? (
        <div className="glass-panel mt-4 space-y-4 p-4 sm:p-5">
          <div className="flex gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-tide-100 text-tide-600">
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink-900">
                {unit.mobileName}
              </h2>
              {specLabel(unit) ? (
                <p className="text-sm text-ink-500">{specLabel(unit)}</p>
              ) : null}
              <p className="mt-0.5 font-mono text-[12.5px] text-ink-500">{idLabel(unit)}</p>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-2xl border border-ink-100 px-4 py-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-ink-400">Sold on bill</dt>
              <dd className="font-semibold text-ink-900">
                {unit.bill.invoiceNumber}
                <span className="font-normal text-ink-500">
                  {" "}· {day(unit.bill.billDate)} · {formatINR(soldPrice)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">Customer</dt>
              <dd className="font-semibold text-ink-900">
                {unit.bill.customerName}
                <span className="font-normal text-ink-500"> · {unit.bill.customerPhone}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">Supplier</dt>
              <dd className="font-semibold text-ink-900">{unit.supplier?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">Purchased</dt>
              <dd className="font-semibold text-ink-900">
                {unit.purchaseDate ? day(unit.purchaseDate) : "—"}
                {unit.purchasePrice != null ? (
                  <span className="font-normal text-ink-500"> · {formatINR(unit.purchasePrice)}</span>
                ) : null}
              </dd>
            </div>
          </dl>

          {unit.alreadyReturned ? (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Already marked replaced / returned on {day(unit.alreadyReturned.createdAt)}
              {unit.alreadyReturned.note ? ` — ${unit.alreadyReturned.note}` : ""}.
            </p>
          ) : (
            <>
              <div>
                <span className="label required">What did the customer get?</span>
                <div
                  role="radiogroup"
                  aria-label="Replace or return"
                  className="grid grid-cols-2 gap-1 rounded-[12px] bg-[#EBEDF1] p-1 dark:bg-surface-muted"
                >
                  {(
                    [
                      ["REPLACE", "Replace", "Another product from stock", RefreshCcw],
                      ["RETURN", "Return", "Money back (refund)", RotateCcw],
                    ] as const
                  ).map(([value, label, hint, Icon]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={mode === value}
                      className={clsx(
                        "flex flex-col items-center gap-0.5 rounded-[10px] px-2 py-2.5 text-center transition",
                        mode === value ? "segment-on" : "segment-off",
                      )}
                      onClick={() => {
                        setMode(value);
                        setSaveError(null);
                      }}
                      disabled={saving}
                    >
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                        <Icon className="h-4 w-4" />
                        {label}
                      </span>
                      <span className="text-[11.5px] opacity-75">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {mode === "REPLACE" ? (
                <div className="space-y-3 rounded-2xl border border-ink-100 p-3.5">
                  <label className="label required" htmlFor="replacement-code">
                    New product from stock (IMEI or serial)
                  </label>
                  <div className="flex gap-2">
                    <ScanFieldShell className="flex-1">
                      <input
                        id="replacement-code"
                        className={scanFieldInputClass}
                        value={newCode}
                        placeholder="Scan or type the new product…"
                        autoComplete="off"
                        disabled={saving}
                        onChange={(event) => {
                          setNewCode(event.target.value);
                          setNewError(null);
                          if (replacement) setReplacement(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void findReplacement();
                          }
                        }}
                      />
                      <ImeiScanFieldButton
                        disabled={saving}
                        onScan={(value) => {
                          setNewCode(value);
                          void findReplacement(value);
                        }}
                      />
                    </ScanFieldShell>
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      onClick={() => void findReplacement()}
                      disabled={findingNew || saving}
                    >
                      <Search className="h-4 w-4" />
                      <span className="hidden sm:inline">{findingNew ? "Finding…" : "Find"}</span>
                    </button>
                  </div>
                  {newError ? <p className={errorBox}>{newError}</p> : null}
                  {replacement ? (
                    <div className="flex gap-3 rounded-xl border border-tide-500/30 bg-tide-100/60 px-3 py-2.5 dark:bg-tide-100/20">
                      <PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-tide-600" />
                      <div className="min-w-0 text-sm">
                        <p className="font-semibold text-ink-900">
                          {replacement.mobileName}
                          <span className="ml-1.5 rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-500 dark:bg-surface">
                            {replacement.condition === "USED" ? "Second hand" : "New"}
                          </span>
                        </p>
                        {specLabel(replacement) ? (
                          <p className="text-ink-500">{specLabel(replacement)}</p>
                        ) : null}
                        <p className="font-mono text-[12px] text-ink-500">{idLabel(replacement)}</p>
                        <p className="mt-0.5 text-[12.5px] text-ink-500">
                          In stock
                          {replacement.supplierName ? ` · from ${replacement.supplierName}` : ""}
                          {replacement.purchasePrice ? ` · cost ${formatINR(replacement.purchasePrice)}` : ""}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {mode === "RETURN" ? (
                <div className="grid gap-3 rounded-2xl border border-ink-100 p-3.5 sm:grid-cols-2">
                  <div>
                    <span className="label">Refund</span>
                    {/* Always what the customer paid for this item. */}
                    <p className="font-display text-xl font-bold tabular-nums text-ink-900">
                      {formatINR(soldPrice)}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-400">Paid for this item</p>
                  </div>
                  <div>
                    <span className="label required">Refund given by</span>
                    <div className="grid grid-cols-2 gap-1 rounded-[11px] bg-[#EBEDF1] p-1 dark:bg-surface-muted">
                      {(
                        [
                          ["cash", "Cash", Banknote],
                          ["online", "Online", MonitorSmartphone],
                        ] as const
                      ).map(([value, label, Icon]) => (
                        <button
                          key={value}
                          type="button"
                          className={clsx(
                            "inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] transition",
                            refundMethod === value ? "segment-on" : "segment-off",
                          )}
                          onClick={() => setRefundMethod(value)}
                          disabled={saving}
                        >
                          <Icon className="h-4 w-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {mode ? (
                <>
                  <label className="block">
                    <span className="label">Note (optional)</span>
                    <textarea
                      className="field min-h-[72px] w-full resize-y"
                      maxLength={500}
                      placeholder="What happened? e.g. Display issue"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      disabled={saving}
                    />
                  </label>

                  <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                    {unit.supplier && credit > 0 ? (
                      <li>
                        • {unit.mobileName} goes back to {unit.supplier.name}:{" "}
                        {formatINR(credit)} comes off their outstanding.
                      </li>
                    ) : null}
                    {mode === "REPLACE" ? (
                      <li>
                        • {replacement ? replacement.mobileName : "The new product"} leaves stock as
                        sold to {unit.bill.customerName}.
                      </li>
                    ) : (
                      <li>
                        • {refundNum > 0 ? formatINR(refundNum) : "The refund"} is counted as a
                        return{refundMethod ? ` (${refundMethod})` : ""} and comes off revenue in
                        Analytics.
                      </li>
                    )}
                    <li>• Bill {unit.bill.invoiceNumber} shows what happened.</li>
                  </ul>
                </>
              ) : null}

              {saveError ? <p className={errorBox}>{saveError}</p> : null}

              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => void submit()}
                disabled={saving || !mode}
              >
                {mode === "RETURN" ? <RotateCcw className="h-4 w-4" /> : <RefreshCcw className="h-4 w-4" />}
                {saving
                  ? "Saving…"
                  : mode === "RETURN"
                    ? "Return & refund"
                    : mode === "REPLACE"
                      ? "Replace product"
                      : "Choose Replace or Return"}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
