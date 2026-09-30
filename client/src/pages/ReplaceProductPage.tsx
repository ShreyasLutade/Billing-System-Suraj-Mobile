import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, RefreshCcw, Search, Smartphone } from "lucide-react";
import {
  ImeiScanFieldButton,
  ScanFieldShell,
  scanFieldInputClass,
} from "../components/BarcodeImeiScanner";
import { BackLink, PageHeader } from "../components/ui";
import { api, formatINR } from "../lib/api";
import { backLabel, readFromState } from "../lib/navMemory";
import { formatCapacityLabel } from "../lib/phoneModelSearch";
import type { ReturnLookup } from "../types";

function specLabel(unit: ReturnLookup) {
  return [
    unit.storage ? formatCapacityLabel(unit.storage) : "",
    unit.platform === "ANDROID" && unit.ram ? formatCapacityLabel(unit.ram) : "",
    unit.color,
  ]
    .filter(Boolean)
    .join(" · ");
}

function day(value: string) {
  return format(new Date(value), "dd MMM yyyy");
}

/**
 * Replace / return a sold product: find it by IMEI or serial, add an optional
 * note and submit. The bill is marked "Replaced / Returned" and the purchase
 * price is deducted from the supplier's outstanding.
 */
export function ReplaceProductPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = readFromState(location.state);
  const [code, setCode] = useState("");
  const [unit, setUnit] = useState<ReturnLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
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
    try {
      const { data } = await api.lookupReturnUnit(trimmed);
      setUnit(data);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Could not find this product");
    } finally {
      setLooking(false);
    }
  }

  function onScanned(value: string) {
    setCode(value);
    void lookup(value);
  }

  async function submit() {
    if (!unit || unit.alreadyReturned || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await api.createProductReturn(unit.stockItemId, note.trim());
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
        title="Replace product"
        description="Scan or type the IMEI / serial number of the product the customer brought back."
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
            <ImeiScanFieldButton disabled={saving} onScan={onScanned} />
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
        {lookupError ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300">
            {lookupError}
          </p>
        ) : null}
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
              <p className="mt-0.5 font-mono text-[12.5px] text-ink-500">
                {[unit.imei, unit.serialNumber ? `SN ${unit.serialNumber}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-2xl border border-ink-100 px-4 py-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-ink-400">Sold on bill</dt>
              <dd className="font-semibold text-ink-900">
                {unit.bill.invoiceNumber}
                <span className="font-normal text-ink-500"> · {day(unit.bill.billDate)}</span>
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
              <label className="block">
                <span className="label">Note (optional)</span>
                <textarea
                  className="field min-h-[84px] w-full resize-y"
                  maxLength={500}
                  placeholder="What happened? e.g. Display issue, customer given a new unit"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={saving}
                />
              </label>

              {unit.supplier && credit > 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  {formatINR(credit)} will be deducted from {unit.supplier.name}&rsquo;s
                  outstanding, and bill {unit.bill.invoiceNumber} will show this product
                  as replaced / returned.
                </p>
              ) : null}

              {saveError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300">
                  {saveError}
                </p>
              ) : null}

              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => void submit()}
                disabled={saving}
              >
                <RefreshCcw className="h-4 w-4" />
                {saving ? "Saving…" : "Submit — mark replaced / returned"}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
