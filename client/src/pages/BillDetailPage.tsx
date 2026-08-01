import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import {
  ArrowLeft,
  Check,
  Download,
  Pencil,
  Phone,
  Share2,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { SettleDueModal } from "../components/SettleDueModal";
import { FinanceReceivedConfirmModal } from "../components/FinanceReceivedConfirmModal";
import { EmptyState, LoadingBlock, PageHeader } from "../components/ui";
import { api, formatFinanceCompanies, formatINR } from "../lib/api";
import { isShareAbort, shareInvoicePdf } from "../lib/shareInvoice";
import type { Bill, DuePayment } from "../types";
import { useAuth } from "../auth/AuthContext";

export function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettle, setShowSettle] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [markingFinance, setMarkingFinance] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [showFinanceConfirm, setShowFinanceConfirm] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

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

  async function confirmDelete() {
    if (!bill || !isAdmin) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteBill(bill.id);
      navigate("/bills", { replace: true });
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete bill",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function markFinanceReceived() {
    if (!isAdmin || !bill || bill.financeAmount <= 0 || bill.financeReceived)
      return;
    setMarkingFinance(true);
    setFinanceError(null);
    try {
      const { data } = await api.markFinanceReceived(bill.id);
      setBill(data);
      setShowFinanceConfirm(false);
    } catch (err) {
      setFinanceError(
        err instanceof Error
          ? err.message
          : "Failed to mark finance amount as received",
      );
    } finally {
      setMarkingFinance(false);
    }
  }

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
          [
            `Created ${format(new Date(bill.billDate), "dd MMM yyyy")}`,
            bill.withGst ? "GST tax invoice" : "Non-GST bill",
            bill.createdByRole
              ? bill.createdByName ||
                (bill.createdByRole === "ADMIN" ? "Admin" : "Staff")
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
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
            <button
              type="button"
              className="btn-secondary"
              disabled={sharing}
              onClick={() => {
                setShareError(null);
                setSharing(true);
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
                  .finally(() => setSharing(false));
              }}
            >
              <Share2 className="h-4 w-4" />
              {sharing ? "Preparing…" : "Share"}
            </button>
            <a
              className="btn-secondary"
              href={api.pdfUrl(bill.id)}
              target="_blank"
              rel="noreferrer"
              title={bill.withGst ? "GST tax invoice PDF" : "Non-GST bill PDF"}
            >
              <Download className="h-4 w-4" />
              {bill.withGst ? "Download GST PDF" : "Download PDF"}
            </a>
            {isAdmin ? (
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  setDeleteError(null);
                  setShowDeleteConfirm(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            ) : null}
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

      {shareError ? (
        <div className="mb-4 glass-panel px-5 py-4 text-sm text-ember-500">
          {shareError}
        </div>
      ) : null}

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
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink-900">
                          {item.productName}
                        </p>
                        {item.condition ? (
                          <span
                            className={
                              item.condition === "USED"
                                ? "rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-ember-500"
                                : "rounded-full bg-tide-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-tide-700"
                            }
                          >
                            {item.condition === "USED" ? "Old" : "New"}
                          </span>
                        ) : null}
                      </div>
                      {item.color || item.storage || item.ram ? (
                        <p className="mt-1 text-sm font-medium text-tide-600">
                          {[item.color, item.storage, item.ram]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
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
              {bill.financeAmount2 && bill.financeAmount2 > 0 ? (
                <>
                  <Row
                    label={
                      bill.financeCompanyName
                        ? `Finance · ${bill.financeCompanyName}`
                        : "Finance 1"
                    }
                    value={formatINR(
                      Math.max(bill.financeAmount - bill.financeAmount2, 0),
                    )}
                  />
                  <Row
                    label={
                      bill.financeCompanyName2
                        ? `Finance · ${bill.financeCompanyName2}`
                        : "Finance 2"
                    }
                    value={formatINR(bill.financeAmount2)}
                  />
                </>
              ) : (
                <Row
                  label={
                    bill.financeCompanyName
                      ? `Finance · ${bill.financeCompanyName}`
                      : "Finance"
                  }
                  value={formatINR(bill.financeAmount)}
                />
              )}
              {bill.financeAmount > 0 ? (
                <Row
                  label="Finance status"
                  value={bill.financeReceived ? "Received" : "Pending"}
                  accent={!bill.financeReceived}
                />
              ) : null}
              <Row
                label="Due"
                value={formatINR(bill.dueAmount)}
                accent={bill.dueAmount > 0}
              />
            </dl>
            {bill.financeAmount > 0 && !bill.financeReceived && isAdmin ? (
              <button
                type="button"
                className="btn-primary mt-5 w-full"
                disabled={markingFinance}
                onClick={() => {
                  setFinanceError(null);
                  setShowFinanceConfirm(true);
                }}
              >
                <Check className="h-4 w-4" />
                {markingFinance ? "Saving…" : "Mark finance as received"}
              </button>
            ) : null}
            {bill.financeAmount > 0 && bill.financeReceivedAt ? (
              <p className="mt-3 text-xs font-medium text-tide-600">
                <Check className="mr-1 inline h-3.5 w-3.5" />
                Received{" "}
                {format(new Date(bill.financeReceivedAt), "dd MMM yyyy")}
              </p>
            ) : null}
            {financeError ? (
              <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-xs font-medium text-ember-500">
                {financeError}
              </p>
            ) : null}
          </div>

          {hasDue ? (
            <div className="rounded-3xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white p-5 shadow-soft sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember-500">
                {bill.isPartialPaid || (bill.duePayments?.length ?? 0) > 0
                  ? "Partial paid"
                  : "Pending due"}
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
              {(bill.duePayments?.length ?? 0) > 0 ? (
                <DuePaymentHistory
                  payments={bill.duePayments!}
                  borderClass="border-orange-100"
                />
              ) : null}
              {isAdmin ? (
                <button
                  type="button"
                  className="btn-primary mt-5 w-full"
                  onClick={() => setShowSettle(true)}
                >
                  <Check className="h-4 w-4" />
                  Collect due
                </button>
              ) : null}
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
                {bill.dueSettledAt
                  ? `Settled on ${format(new Date(bill.dueSettledAt), "dd MMM yyyy")}`
                  : "No pending amount on this invoice."}
              </p>
              {(bill.duePayments?.length ?? 0) > 0 ? (
                <DuePaymentHistory
                  payments={bill.duePayments!}
                  borderClass="border-tide-100"
                />
              ) : null}
            </div>
          )}
        </aside>
      </div>

      {isAdmin && showSettle && hasDue ? (
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

      <AnimatePresence>
        {showFinanceConfirm && bill.financeAmount > 0 ? (
          <FinanceReceivedConfirmModal
            invoiceNumber={bill.invoiceNumber}
            financeCompanyName={formatFinanceCompanies(
              bill.financeCompanyName,
              bill.financeCompanyName2,
            )}
            amount={bill.financeAmount}
            saving={markingFinance}
            error={financeError}
            onCancel={() => {
              if (markingFinance) return;
              setShowFinanceConfirm(false);
              setFinanceError(null);
            }}
            onConfirm={() => void markFinanceReceived()}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isAdmin && showDeleteConfirm ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !deleting && setShowDeleteConfirm(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-bill-title"
              className="w-full max-w-md overflow-hidden rounded-3xl border border-white/70 bg-white shadow-lift"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember-500">
                    Danger
                  </p>
                  <h2
                    id="delete-bill-title"
                    className="mt-1 font-display text-xl font-semibold text-ink-900"
                  >
                    Delete this bill?
                  </h2>
                </div>
                <button
                  type="button"
                  className="rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
                  onClick={() => !deleting && setShowDeleteConfirm(false)}
                  aria-label="Close"
                  disabled={deleting}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-2 px-5 py-4 text-sm text-ink-600">
                <p>
                  This will permanently delete{" "}
                  <span className="font-semibold text-ink-900">
                    {bill.invoiceNumber}
                  </span>{" "}
                  for {bill.customerName}.
                </p>
                <p>This action cannot be undone.</p>
              </div>

              {deleteError ? (
                <p className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
                  {deleteError}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2 border-t border-ink-100 px-5 py-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Deleting…" : "Delete bill"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function DuePaymentHistory({
  payments,
  borderClass,
}: {
  payments: DuePayment[];
  borderClass: string;
}) {
  return (
    <div className={`mt-4 space-y-2 border-t pt-3 ${borderClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
        Payment history
      </p>
      <ul className="space-y-2">
        {payments.map((payment) => (
          <li key={payment.id} className="text-sm">
            <p className="font-medium text-ink-800">
              {formatINR(payment.amount)}
              <span className="ml-1.5 text-xs font-normal text-ink-400">
                {payment.kind === "full" ? "Full" : "Partial"}
                {payment.method && payment.method !== "na"
                  ? ` · ${payment.method === "cash" ? "Cash" : "Online"}`
                  : ""}
              </span>
            </p>
            <p className="text-xs text-ink-500">
              {format(new Date(payment.paidAt), "dd MMM yyyy")}
            </p>
          </li>
        ))}
      </ul>
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
