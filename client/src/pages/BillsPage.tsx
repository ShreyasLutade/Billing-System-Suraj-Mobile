import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Download, Search, Share2 } from "lucide-react";
import {
  PeriodFilter,
  type ActivityPeriodValue,
} from "../components/PeriodFilter";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { api, formatFinanceCompanies, formatINR } from "../lib/api";
import { isShareAbort, shareInvoicePdf } from "../lib/shareInvoice";
import type { Bill } from "../types";

export function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<ActivityPeriodValue>("today");
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.listBills(period);
        if (active) {
          setBills(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load bills");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [period]);

  const filtered = bills.filter((bill) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const imeiMatch = bill.items.some(
      (item) =>
        item.imei1?.toLowerCase().includes(q) ||
        item.imei2?.toLowerCase().includes(q),
    );
    const exchangeImeiMatch =
      bill.exchangeImei1?.toLowerCase().includes(q) ||
      bill.exchangeImei2?.toLowerCase().includes(q);
    return (
      bill.invoiceNumber.toLowerCase().includes(q) ||
      bill.customerName.toLowerCase().includes(q) ||
      bill.customerPhone.includes(q) ||
      imeiMatch ||
      Boolean(exchangeImeiMatch)
    );
  });

  return (
    <div>
      <PageHeader
        eyebrow="History"
        title="Bills"
        description="Filter by period and search by invoice, customer, phone, or IMEI."
        action={
          <Link to="/" className="btn-primary">
            New bill
          </Link>
        }
      />

      <div className="mb-5 space-y-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
          <input
            className="field pl-11"
            placeholder="Search invoice, customer, phone, or IMEI…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {loading ? <LoadingBlock label="Fetching bills…" /> : null}
      {error ? (
        <div className="glass-panel px-5 py-4 text-sm text-ember-500">{error}</div>
      ) : null}
      {shareError ? (
        <div className="glass-panel mb-3 px-5 py-4 text-sm text-ember-500">
          {shareError}
        </div>
      ) : null}

      {!loading && !error && filtered.length === 0 ? (
        <EmptyState
          title="No bills in this period"
          description="Try another filter, or create a new bill from the New Bill screen."
        />
      ) : null}

      <div className="space-y-3">
        {filtered.map((bill) => (
          <Link
            key={bill.id}
            to={`/bills/${bill.id}`}
            className="glass-panel block p-4 transition hover:-translate-y-0.5 hover:shadow-lift sm:p-5"
          >
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-tide-600">
                {bill.invoiceNumber}
              </p>
              {bill.createdByRole ? (
                <span
                  className={
                    bill.createdByRole === "ADMIN"
                      ? "shrink-0 rounded-full bg-ink-900/90 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-white"
                      : "shrink-0 rounded-full bg-tide-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-tide-600"
                  }
                >
                  {bill.createdByName ||
                    (bill.createdByRole === "ADMIN" ? "Admin" : "Staff")}
                </span>
              ) : null}
            </div>

            <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-stretch sm:justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-xl font-semibold text-ink-900">
                  {bill.customerName}
                </h3>
                <p className="mt-1 text-sm text-ink-500">
                  {bill.customerPhone} ·{" "}
                  {format(new Date(bill.billDate), "dd MMM yyyy")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Pill label={`Cash ${formatINR(bill.cashAmount)}`} />
                  <Pill label={`Online ${formatINR(bill.onlineAmount)}`} />
                  <Pill
                    label={`Finance ${formatINR(bill.financeAmount)}${
                      (() => {
                        const names = formatFinanceCompanies(
                          bill.financeCompanyName,
                          bill.financeCompanyName2,
                        );
                        return names ? ` · ${names}` : "";
                      })()
                    }`}
                  />
                  {bill.isExchange ? (
                    <Pill
                      label={`Exchange · ${bill.exchangeModel || "Mobile"}${
                        bill.exchangeValue != null
                          ? ` · ${formatINR(bill.exchangeValue)}`
                          : ""
                      }`}
                      tone="ok"
                    />
                  ) : null}
                  {bill.dueAmount > 0 ? (
                    <div className="w-full space-y-2">
                      <Pill
                        label={
                          bill.isPartialPaid
                            ? `Partial paid · Remaining ${formatINR(bill.dueAmount)}`
                            : `Due ${formatINR(bill.dueAmount)}`
                        }
                        tone="due"
                      />
                      <div className="rounded-2xl border border-orange-100 bg-orange-50/80 px-3 py-2 text-xs text-ember-500">
                        <p>Remaining · {formatINR(bill.dueAmount)}</p>
                        <p className="mt-1">
                          Next due ·{" "}
                          {bill.dueDate
                            ? format(new Date(bill.dueDate), "dd MMM yyyy")
                            : "Not set"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <Pill label="Fully paid" tone="ok" />
                  )}
                </div>
              </div>

              <div className="flex flex-col justify-between gap-4 sm:items-end">
                <div className="text-left sm:text-right">
                  <p className="font-display text-2xl font-semibold text-ink-900">
                    {formatINR(bill.payableAmount ?? bill.grandTotal)}
                  </p>
                  {bill.isExchange && bill.exchangeValue ? (
                    <p className="text-xs text-ink-500">
                      After exchange −{formatINR(bill.exchangeValue)}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs font-semibold text-tide-600">
                    View details →
                  </p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2 self-start sm:self-end">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={sharingId === bill.id}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShareError(null);
                      setSharingId(bill.id);
                      void shareInvoicePdf(bill.id, bill.invoiceNumber)
                        .catch((err) => {
                          if (!isShareAbort(err)) {
                            setShareError(
                              err instanceof Error
                                ? err.message
                                : "Could not open share sheet",
                            );
                          }
                        })
                        .finally(() => setSharingId(null));
                    }}
                  >
                    <Share2 className="h-4 w-4" />
                    {sharingId === bill.id ? "…" : "Share"}
                  </button>
                  <span
                    className="btn-secondary"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(
                        api.pdfUrl(bill.id),
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    role="link"
                  >
                    <Download className="h-4 w-4" />
                    PDF
                  </span>
                </div>
              </div>
            </div>
          </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Pill({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "due" | "ok";
}) {
  const classes =
    tone === "due"
      ? "bg-orange-50 text-ember-500"
      : tone === "ok"
        ? "bg-tide-100 text-tide-600"
        : "bg-ink-50 text-ink-700";
  return (
    <span className={`rounded-full px-3 py-1 font-medium ${classes}`}>
      {label}
    </span>
  );
}
