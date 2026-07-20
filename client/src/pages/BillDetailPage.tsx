import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  Check,
  Download,
  Pencil,
  Phone,
  UserRound,
} from "lucide-react";
import { SettleDueModal } from "../components/SettleDueModal";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { api, formatINR } from "../lib/api";
import type { Bill } from "../types";

export function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettle, setShowSettle] = useState(false);

  const loadBill = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.getBill(id);
      setBill(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bill");
      setBill(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadBill();
  }, [loadBill]);

  if (loading) {
    return <LoadingBlock label="Loading bill…" />;
  }

  if (error || !bill) {
    return (
      <div className="space-y-4">
        <Link to="/bills" className="btn-secondary inline-flex">
          <ArrowLeft className="h-4 w-4" />
          Back to bills
        </Link>
        <EmptyState
          title="Bill not found"
          description={error || "This invoice may have been removed."}
        />
      </div>
    );
  }

  const hasDue = bill.dueAmount > 0 && !bill.dueSettled;

  return (
    <div>
      <PageHeader
        eyebrow="Invoice"
        title={bill.invoiceNumber}
        description={
          bill.createdByRole
            ? `Created ${format(new Date(bill.billDate), "dd MMM yyyy")} · ${
                bill.createdByRole === "ADMIN" ? "Suraj" : "Staff"
              }`
            : `Created ${format(new Date(bill.billDate), "dd MMM yyyy")}`
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/bills" className="btn-secondary">
              <ArrowLeft className="h-4 w-4" />
              Bills
            </Link>
            <Link to={`/bills/${bill.id}/edit`} className="btn-secondary">
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
            <a
              className="btn-secondary"
              href={api.pdfUrl(bill.id)}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </a>
            {hasDue ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowSettle(true)}
              >
                <Check className="h-4 w-4" />
                Collect due
              </button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
        <section className="space-y-5">
          <div className="glass-panel p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-900 text-tide-400">
                <UserRound className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Customer
                </p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-ink-900">
                  {bill.customerName}
                </h2>
                <p className="mt-2 flex items-center gap-2 text-sm text-ink-500">
                  <Phone className="h-4 w-4" />
                  {bill.customerPhone}
                </p>
                {bill.customerAddress ? (
                  <p className="mt-1 text-sm text-ink-500">{bill.customerAddress}</p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="glass-panel overflow-hidden">
            <div className="border-b border-ink-100 px-5 py-4 sm:px-6">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                Products
              </h3>
            </div>
            <div className="divide-y divide-ink-50">
              {bill.items.map((item) => (
                <div key={item.id || item.productName} className="px-5 py-4 sm:px-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-ink-900">{item.productName}</p>
                      <p className="mt-1 text-sm text-ink-500">
                        Qty {item.quantity} · Rate {formatINR(item.rate)} · GST{" "}
                        {item.gstPercent}%
                      </p>
                      <div className="mt-2 space-y-1 text-xs text-ink-500">
                        {item.imei1 ? <p>IMEI · {item.imei1}</p> : null}
                        {item.serialNumber ? <p>Serial · {item.serialNumber}</p> : null}
                        {item.warrantyMonths ? (
                          <p>Warranty · {item.warrantyMonths} months</p>
                        ) : null}
                      </div>
                    </div>
                    <p className="font-display text-lg font-semibold text-ink-900">
                      {formatINR(item.amount || 0)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {bill.isExchange ? (
            <div className="glass-panel p-5 sm:p-6">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                Exchange mobile
              </h3>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <Detail label="Model" value={bill.exchangeModel || "—"} />
                <Detail
                  label="Exchange value"
                  value={
                    bill.exchangeValue != null
                      ? formatINR(bill.exchangeValue)
                      : "—"
                  }
                />
                <Detail label="IMEI" value={bill.exchangeImei1 || "—"} />
                <Detail label="Serial" value={bill.exchangeSerial || "—"} />
                <Detail label="Notes" value={bill.exchangeNotes || "—"} />
              </dl>
            </div>
          ) : null}

          {bill.notes ? (
            <div className="glass-panel p-5 sm:p-6">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                Notes
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {bill.notes}
              </p>
            </div>
          ) : null}
        </section>

        <aside className="space-y-5">
          <div className="glass-panel overflow-hidden p-5 sm:p-6">
            <h3 className="font-display text-lg font-semibold text-ink-900">
              Amount summary
            </h3>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Subtotal" value={formatINR(bill.subtotal)} />
              <Row label="GST" value={formatINR(bill.gstAmount)} />
              <Row label="Gross total" value={formatINR(bill.grandTotal)} />
              {bill.isExchange && bill.exchangeValue ? (
                <Row
                  label="Less: Exchange"
                  value={`- ${formatINR(bill.exchangeValue)}`}
                  accent
                />
              ) : null}
              <Row
                label="Payable"
                value={formatINR(bill.payableAmount ?? bill.grandTotal)}
                strong
              />
            </dl>
          </div>

          <div className="glass-panel p-5 sm:p-6">
            <h3 className="font-display text-lg font-semibold text-ink-900">
              Payment split
            </h3>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Cash" value={formatINR(bill.cashAmount)} />
              <Row label="Online" value={formatINR(bill.onlineAmount)} />
              <Row
                label={
                  bill.financeCompanyName
                    ? `Finance · ${bill.financeCompanyName}`
                    : "Finance"
                }
                value={formatINR(bill.financeAmount)}
              />
              <Row
                label="Due"
                value={formatINR(bill.dueAmount)}
                accent={bill.dueAmount > 0}
              />
            </dl>
          </div>

          {hasDue ? (
            <div className="rounded-3xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white p-5 shadow-soft sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember-500">
                {bill.isPartialPaid ? "Partial paid" : "Pending due"}
              </p>
              <p className="mt-2 font-display text-3xl font-semibold text-ember-500">
                {formatINR(bill.dueAmount)}
              </p>
              <p className="mt-2 text-sm text-ink-500">
                Next due ·{" "}
                {bill.dueDate
                  ? format(new Date(bill.dueDate), "dd MMM yyyy")
                  : "Not set"}
              </p>
              <button
                type="button"
                className="btn-primary mt-5 w-full"
                onClick={() => setShowSettle(true)}
              >
                <Check className="h-4 w-4" />
                Collect due
              </button>
            </div>
          ) : (
            <div className="rounded-3xl border border-tide-100 bg-gradient-to-br from-tide-100/70 to-white p-5 shadow-soft sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-tide-600">
                Status
              </p>
              <p className="mt-2 font-display text-2xl font-semibold text-ink-900">
                Fully paid
              </p>
              <p className="mt-2 text-sm text-ink-500">
                No pending amount on this invoice.
              </p>
            </div>
          )}
        </aside>
      </div>

      {showSettle && hasDue ? (
        <SettleDueModal
          bill={{
            id: bill.id,
            invoiceNumber: bill.invoiceNumber,
            customerName: bill.customerName,
            dueAmount: bill.dueAmount,
          }}
          onClose={() => setShowSettle(false)}
          onSettled={loadBill}
        />
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.14em] text-ink-500">{label}</dt>
      <dd className="mt-1 font-medium text-ink-800">{value}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={
          strong
            ? "font-display text-lg font-semibold text-ink-900"
            : accent
              ? "font-semibold text-ember-500"
              : "font-medium text-ink-800"
        }
      >
        {value}
      </dd>
    </div>
  );
}
