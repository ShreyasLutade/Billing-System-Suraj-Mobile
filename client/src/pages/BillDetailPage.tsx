import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import {
  ArrowLeftRight,
  Check,
  Download,
  Pencil,
  Phone,
  RotateCcw,
  Share2,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { SettleDueModal } from "../components/SettleDueModal";
import { FinanceReceivedConfirmModal } from "../components/FinanceReceivedConfirmModal";
import { BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { api, formatFinanceCompanies, formatINR, round2 } from "../lib/api";
import { isShareAbort, shareInvoicePdf } from "../lib/shareInvoice";
import type { Bill, DuePayment } from "../types";
import { useAuth } from "../auth/AuthContext";
import {
  backLabel,
  billsHomePath,
  readFromState,
} from "../lib/navMemory";

const PAY = {
  cash: "#12B886",
  online: "#3B82F6",
  finance: "#8B5CF6",
  due: "#F59E0B",
} as const;

function formatPhoneDisplay(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return phone;
}

function createdByLabel(bill: Bill) {
  if (!bill.createdByRole) return null;
  return (
    bill.createdByName ||
    (bill.createdByRole === "ADMIN" ? "Admin" : "Staff")
  );
}

export function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from = readFromState(location.state);
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

  async function confirmDelete(mode: "delete" | "return" = "delete") {
    if (!bill || !isAdmin) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteBill(bill.id, mode);
      navigate(from ?? billsHomePath(bill.withGst), { replace: true });
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : mode === "return"
            ? "Failed to return this bill to stock"
            : "Failed to delete bill",
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
        <BackLink to={from ?? "/bills"}>{backLabel(from)}</BackLink>
        <EmptyState
          title="Bill not found"
          description={error || "This invoice may have been removed."}
        />
      </div>
    );
  }

  const hasDue = bill.dueAmount > 0 && !bill.dueSettled;
  const fullyPaid = !bill.withGst && !hasDue;
  const exchangeRefund =
    !bill.withGst &&
    bill.isExchange &&
    bill.exchangeValue != null &&
    bill.exchangeValue > bill.grandTotal
      ? Math.max(bill.exchangeValue - bill.grandTotal, 0)
      : 0;
  const payable = bill.withGst
    ? bill.grandTotal
    : (bill.payableAmount ?? bill.grandTotal);
  const creator = createdByLabel(bill);
  const meta = [
    `Created ${format(new Date(bill.billDate), "dd MMM yyyy")}`,
    creator ? `by ${creator}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <BackLink to={from ?? billsHomePath(bill.withGst)} className="mb-4">
        {backLabel(from)}
      </BackLink>

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7A8699]">
            Invoice
          </span>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[30px] font-bold leading-none tracking-[-0.01em] text-[#0E1626]">
              {bill.invoiceNumber}
            </h1>
            {bill.withGst ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F0FE] px-[11px] py-1 text-xs font-semibold text-[#2563EB]">
                GST invoice
              </span>
            ) : fullyPaid ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E7F8F1] px-[11px] py-1 text-xs font-semibold text-[#0E9E76]">
                <Check className="h-[13px] w-[13px]" strokeWidth={2.6} />
                Fully paid
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FEF3E2] px-[11px] py-1 text-xs font-semibold text-[#B76E00]">
                ● {formatINR(bill.dueAmount)} due
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-[#7A8699]">{meta}</p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto">
          <div className="flex w-full gap-1.5 sm:w-auto sm:flex-wrap sm:gap-2">
            <Link
              to={`/bills/${bill.id}/edit`}
              state={location.state}
              className="bd-action flex-1 sm:flex-none"
            >
              <Pencil className="h-[15px] w-[15px] shrink-0" />
              Edit
            </Link>
            <button
              type="button"
              className="bd-action flex-1 sm:flex-none"
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
              <Share2 className="h-[15px] w-[15px] shrink-0" />
              <span className="truncate">{sharing ? "…" : "Share"}</span>
            </button>
            <a
              className="bd-action flex-1 sm:flex-none"
              href={api.pdfUrl(bill.id)}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="h-[15px] w-[15px] shrink-0" />
              <span className="sm:hidden">PDF</span>
              <span className="hidden sm:inline">Download PDF</span>
            </a>
            {isAdmin ? (
              <button
                type="button"
                className="bd-action bd-action-danger flex-1 sm:flex-none"
                onClick={() => {
                  setDeleteError(null);
                  setShowDeleteConfirm(true);
                }}
              >
                <Trash2 className="h-[15px] w-[15px] shrink-0" />
                Delete
              </button>
            ) : null}
          </div>
          {hasDue && !bill.withGst ? (
            <button
              type="button"
              className="btn-primary w-full !rounded-[11px] !px-3.5 !py-2.5 !text-[13px] sm:w-auto"
              onClick={() => setShowSettle(true)}
            >
              <Check className="h-4 w-4" />
              Collect due
            </button>
          ) : null}
        </div>
      </div>

      {shareError ? (
        <div className="mb-4 rounded-2xl border border-orange-100 bg-orange-50 px-5 py-4 text-sm text-ember-500">
          {shareError}
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <section className="bd-card">
            <div className="flex items-center gap-3.5">
              <div className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] bg-gradient-to-br from-[#12B886] to-[#0E9E76] text-white">
                <UserRound className="h-[22px] w-[22px]" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7A8699]">
                  Customer
                </p>
                <p className="mt-0.5 font-display text-[19px] font-semibold leading-tight text-[#0E1626]">
                  {bill.customerName}
                </p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] tabular-nums text-[#3A4658]">
                  <Phone className="h-3.5 w-3.5 text-[#7A8699]" />
                  {formatPhoneDisplay(bill.customerPhone)}
                </p>
                {bill.customerAddress ? (
                  <p className="mt-1 text-[13px] text-[#7A8699]">
                    {bill.customerAddress}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="bd-card">
            <h2 className="mb-4 font-display text-base font-semibold text-[#0E1626]">
              Products
            </h2>
            <div className="space-y-4">
              {bill.items.map((item, index) => {
                const specs = [item.color, item.storage, item.ram]
                  .filter(Boolean)
                  .join(" · ");
                const subParts = [
                  `Qty ${item.quantity}`,
                  `Rate ${formatINR(item.rate)}`,
                  `GST ${item.gstPercent}%`,
                  item.imei1 ? `IMEI ${item.imei1}` : null,
                  item.serialNumber ? `Serial ${item.serialNumber}` : null,
                  item.warrantyMonths
                    ? `Warranty ${item.warrantyMonths} mo`
                    : null,
                ].filter(Boolean);

                return (
                  <div
                    key={item.id || `${item.productName}-${index}`}
                    className="flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#0E1626]">
                        <span>{item.productName}</span>
                        {item.condition === "USED" ? (
                          <span className="rounded-md bg-[#FEF3E2] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[#B76E00]">
                            OLD
                          </span>
                        ) : item.condition === "NEW" ? (
                          <span className="rounded-md bg-[#E7F8F1] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[#0E9E76]">
                            NEW
                          </span>
                        ) : null}
                      </div>
                      {specs ? (
                        <p className="mt-1 text-[13px] font-medium text-[#0E9E76]">
                          {specs}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[12.5px] leading-relaxed text-[#7A8699]">
                        {subParts.map((part, i) => (
                          <span key={part}>
                            {i > 0 ? (
                              <span className="mx-1.5 opacity-50">·</span>
                            ) : null}
                            {part}
                          </span>
                        ))}
                      </p>
                    </div>
                    <p className="shrink-0 whitespace-nowrap font-display text-[17px] font-bold tabular-nums text-[#0E1626]">
                      {formatINR(item.amount || 0)}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {!bill.withGst && bill.isExchange ? (
            <section className="bd-card">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-[#E7F8F1] text-[#0E9E76]">
                  <ArrowLeftRight className="h-[15px] w-[15px]" strokeWidth={2} />
                </span>
                <h2 className="font-display text-base font-semibold text-[#0E1626]">
                  Exchange mobile
                  {(bill.exchangeItems?.length || 0) > 1
                    ? `s (${bill.exchangeItems?.length})`
                    : ""}
                </h2>
              </div>
              <div className="space-y-4">
                {(bill.exchangeItems?.length
                  ? bill.exchangeItems
                  : bill.exchangeModel
                    ? [
                        {
                          model: bill.exchangeModel,
                          platform:
                            bill.exchangePlatform === "ANDROID"
                              ? "ANDROID"
                              : "IOS",
                          color: bill.exchangeColor || "",
                          storage: bill.exchangeStorage || "",
                          ram: bill.exchangeRam,
                          imei1: bill.exchangeImei1 || "",
                          value: bill.exchangeValue || 0,
                          notes: bill.exchangeNotes,
                        },
                      ]
                  : []
                ).map((item, index) => (
                  <div
                    key={`${item.imei1}-${index}`}
                    className="rounded-xl border border-ink-100 bg-ink-50/40 p-4"
                  >
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                      Exchange {index + 1}
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <Kv label="Model" value={item.model || "—"} />
                      <Kv
                        label="Exchange value"
                        value={formatINR(item.value || 0)}
                        highlight
                      />
                      <Kv label="IMEI" value={item.imei1 || "—"} />
                      <Kv
                        label="Specs"
                        value={[
                          item.color,
                          item.storage,
                          item.platform === "ANDROID" && item.ram
                            ? item.ram
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      />
                      {item.notes ? (
                        <Kv label="Notes" value={item.notes} full />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {bill.notes ? (
            <section className="bd-card">
              <h2 className="mb-3 font-display text-base font-semibold text-[#0E1626]">
                Notes
              </h2>
              <p className="text-sm leading-relaxed text-[#3A4658]">
                {bill.notes}
              </p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <section className="bd-card">
            <h2 className="mb-3.5 font-display text-base font-semibold text-[#0E1626]">
              Amount summary
            </h2>
            <SumLine label="Subtotal" value={formatINR(bill.subtotal)} muted />
            <SumLine label="GST" value={formatINR(bill.gstAmount)} muted />
            <SumLine label="Gross total" value={formatINR(bill.grandTotal)} />
            {!bill.withGst && bill.isExchange && bill.exchangeValue ? (
              <SumLine
                label="Less: exchange"
                value={`−${formatINR(bill.exchangeValue)}`}
                exchange
              />
            ) : null}
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t-2 border-[#0E1626] pt-3">
              <span className="text-sm font-semibold text-[#0E1626]">
                {bill.withGst ? "Invoice total" : "Payable by customer"}
              </span>
              <span className="font-display text-2xl font-bold tabular-nums tracking-[-0.01em] text-[#0E1626]">
                {formatINR(payable)}
              </span>
            </div>
            {exchangeRefund > 0 ? (
              <div className="mt-3.5 rounded-xl border border-[#F5E0BC] bg-[#FEF3E2] px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] font-semibold text-[#B76E00]">
                    Refund due to customer
                  </span>
                  <span className="font-display text-lg font-bold tabular-nums text-[#B76E00]">
                    {formatINR(exchangeRefund)}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-[#9A7A3E]">
                  Exchange value was higher than the bill — this amount is owed
                  back.
                </p>
              </div>
            ) : null}
            {!bill.withGst && (bill.companyDiscount || 0) > 0 ? (
              <div className="mt-3.5 rounded-xl border border-[#D8EEE4] bg-[#E7F8F1] px-3.5 py-3">
                <SumLine
                  label="Company cashback"
                  value={`+ ${formatINR(bill.companyDiscount || 0)}`}
                />
                <div className="mt-2 flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] font-semibold text-[#0E9E76]">
                    Effective selling
                  </span>
                  <span className="font-display text-lg font-bold tabular-nums text-[#0E9E76]">
                    {formatINR(
                      round2(payable + Number(bill.companyDiscount || 0)),
                    )}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-[#3A8F73]">
                  Company cashback — shown on the bill as discount amount.
                </p>
              </div>
            ) : null}
          </section>

          {!bill.withGst ? (
            <section className="bd-card">
              <h2 className="mb-2 font-display text-base font-semibold text-[#0E1626]">
                Payment split
              </h2>
              <PayLine
                color={PAY.cash}
                label="Cash"
                value={formatINR(bill.cashAmount)}
                zero={!(bill.cashAmount > 0)}
              />
              <PayLine
                color={PAY.online}
                label="Online"
                value={formatINR(bill.onlineAmount)}
                zero={!(bill.onlineAmount > 0)}
              />
              {bill.financeAmount2 && bill.financeAmount2 > 0 ? (
                <>
                  <PayLine
                    color={PAY.finance}
                    label={
                      bill.financeCompanyName
                        ? `Finance · ${bill.financeCompanyName}`
                        : "Finance 1"
                    }
                    value={formatINR(
                      Math.max(bill.financeAmount - bill.financeAmount2, 0),
                    )}
                    zero={
                      !(
                        Math.max(bill.financeAmount - bill.financeAmount2, 0) >
                        0
                      )
                    }
                  />
                  <PayLine
                    color={PAY.finance}
                    label={
                      bill.financeCompanyName2
                        ? `Finance · ${bill.financeCompanyName2}`
                        : "Finance 2"
                    }
                    value={formatINR(bill.financeAmount2)}
                    zero={!(bill.financeAmount2 > 0)}
                  />
                </>
              ) : (
                <PayLine
                  color={PAY.finance}
                  label={
                    bill.financeCompanyName
                      ? `Finance · ${bill.financeCompanyName}`
                      : "Finance"
                  }
                  value={formatINR(bill.financeAmount)}
                  zero={!(bill.financeAmount > 0)}
                />
              )}
              <PayLine
                color={PAY.due}
                label="Due"
                value={formatINR(bill.dueAmount)}
                zero={!(bill.dueAmount > 0)}
                last
              />

              {bill.financeAmount > 0 ? (
                <p
                  className={`mt-3 text-xs font-semibold ${
                    bill.financeReceived ? "text-[#0E9E76]" : "text-[#B76E00]"
                  }`}
                >
                  Finance status ·{" "}
                  {bill.financeReceived ? "Received" : "Pending"}
                  {bill.financeReceivedAt
                    ? ` · ${format(new Date(bill.financeReceivedAt), "dd MMM yyyy")}`
                    : ""}
                </p>
              ) : null}

              {bill.financeAmount > 0 && !bill.financeReceived && isAdmin ? (
                <button
                  type="button"
                  className="btn-primary mt-4 w-full !rounded-[11px]"
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
              {financeError ? (
                <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-xs font-medium text-ember-500">
                  {financeError}
                </p>
              ) : null}
            </section>
          ) : (
            <section className="bd-card">
              <h2 className="mb-2 font-display text-base font-semibold text-[#0E1626]">
                Submission invoice
              </h2>
              <p className="text-sm text-[#7A8699]">
                Payment modes are not recorded. This bill is excluded from shop
                sales.
              </p>
            </section>
          )}

          {!bill.withGst && hasDue ? (
            <div className="relative overflow-hidden rounded-2xl border border-[#F5E0BC] bg-gradient-to-br from-[#FEF3E2] to-white p-5 shadow-[0_1px_2px_rgba(16,25,40,.04),0_6px_18px_rgba(16,25,40,.05)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#B76E00]">
                {bill.isPartialPaid || (bill.duePayments?.length ?? 0) > 0
                  ? "Partial paid"
                  : "Pending due"}
              </p>
              <p className="mt-2 font-display text-[22px] font-bold text-[#B76E00]">
                {formatINR(bill.dueAmount)}
              </p>
              <p className="mt-1 text-[13px] text-[#9A7A3E]">
                Next due ·{" "}
                {bill.dueDate
                  ? format(new Date(bill.dueDate), "dd MMM yyyy")
                  : "Not set"}
              </p>
              {(bill.duePayments?.length ?? 0) > 0 ? (
                <DuePaymentHistory
                  payments={bill.duePayments!}
                  borderClass="border-[#F5E0BC]"
                />
              ) : null}
              {isAdmin ? (
                <button
                  type="button"
                  className="btn-primary mt-4 w-full !rounded-[11px]"
                  onClick={() => setShowSettle(true)}
                >
                  <Check className="h-4 w-4" />
                  Collect due
                </button>
              ) : null}
            </div>
          ) : null}

          {!bill.withGst && fullyPaid ? (
            <div className="relative overflow-hidden rounded-2xl border border-[#CDEFE0] bg-gradient-to-br from-[#E7F8F1] to-[#EAF6FF] p-5 shadow-[0_1px_2px_rgba(16,25,40,.04),0_6px_18px_rgba(16,25,40,.05)]">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-[30px] -top-[30px] h-[120px] w-[120px] rounded-full bg-[radial-gradient(circle,rgba(18,184,134,.18),transparent_70%)]"
              />
              <p className="relative text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0E9E76]">
                Status
              </p>
              <p className="relative mt-2 flex items-center gap-2.5 font-display text-[22px] font-bold text-[#0E1626]">
                <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-[#12B886] text-white">
                  <Check className="h-[15px] w-[15px]" strokeWidth={2.6} />
                </span>
                Fully paid
              </p>
              <p className="relative mt-1 text-[13px] text-[#0E9E76]/85">
                {bill.dueSettledAt
                  ? `Settled on ${format(new Date(bill.dueSettledAt), "dd MMM yyyy")}`
                  : "No pending amount on this invoice."}
              </p>
              {(bill.duePayments?.length ?? 0) > 0 ? (
                <DuePaymentHistory
                  payments={bill.duePayments!}
                  borderClass="border-[#CDEFE0]"
                />
              ) : null}
            </div>
          ) : null}
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
                <h2
                  id="delete-bill-title"
                  className="mt-0.5 font-display text-xl font-semibold text-ink-900"
                >
                  Remove {bill.invoiceNumber} ({bill.customerName})?
                </h2>
                <button
                  type="button"
                  className="shrink-0 rounded-xl p-2 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
                  onClick={() => !deleting && setShowDeleteConfirm(false)}
                  aria-label="Close"
                  disabled={deleting}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-2 px-5 py-4 text-sm text-ink-600">
                {bill.items.some((item) => item.stockItemId) ? (
                  <p>
                    <span className="font-semibold text-ink-800">Return</span>
                    {" → "}mobiles go back to second-hand stock (adds a Return
                    card).
                  </p>
                ) : (
                  <p>This bill has no stock mobile to return.</p>
                )}
                <p>
                  <span className="font-semibold text-ink-800">Delete</span>
                  {" → "}invoice removed, mobiles permanently deleted from
                  stock.
                </p>
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
                  onClick={() => void confirmDelete("delete")}
                  disabled={deleting}
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Working…" : "Delete"}
                </button>
                {bill.items.some((item) => item.stockItemId) ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void confirmDelete("return")}
                    disabled={deleting}
                  >
                    <RotateCcw className="h-4 w-4" />
                    {deleting ? "Working…" : "Return"}
                  </button>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Kv({
  label,
  value,
  highlight,
  muted,
  full,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : undefined}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7A8699]">
        {label}
      </p>
      <p
        className={
          highlight
            ? "font-display text-[15px] font-bold tabular-nums text-[#0E9E76]"
            : muted
              ? "text-sm tabular-nums text-[#7A8699]"
              : "text-sm tabular-nums text-[#0E1626]"
        }
      >
        {value}
      </p>
    </div>
  );
}

function SumLine({
  label,
  value,
  muted,
  exchange,
}: {
  label: string;
  value: string;
  muted?: boolean;
  exchange?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13.5px] text-[#3A4658]">
      <span>{label}</span>
      <span
        className={
          exchange
            ? "font-semibold tabular-nums text-[#0E9E76]"
            : muted
              ? "font-medium tabular-nums text-[#7A8699]"
              : "font-medium tabular-nums text-[#0E1626]"
        }
      >
        {value}
      </span>
    </div>
  );
}

function PayLine({
  color,
  label,
  value,
  zero,
  last,
}: {
  color: string;
  label: string;
  value: string;
  zero?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 text-[13.5px] text-[#3A4658] ${
        last ? "" : "border-b border-[#E7EAF0]"
      }`}
    >
      <span className="inline-flex min-w-0 items-center gap-2.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ background: color }}
        />
        <span className="truncate">{label}</span>
      </span>
      <span
        className={
          zero
            ? "font-medium tabular-nums text-[#7A8699]"
            : "font-semibold tabular-nums text-[#0E1626]"
        }
      >
        {value}
      </span>
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
    <div className={`relative mt-4 space-y-2 border-t pt-3 ${borderClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7A8699]">
        Payment history
      </p>
      <ul className="space-y-2">
        {payments.map((payment) => (
          <li key={payment.id} className="text-sm">
            <p className="font-medium text-[#0E1626]">
              {formatINR(payment.amount)}
              <span className="ml-1.5 text-xs font-normal text-[#7A8699]">
                {payment.kind === "full" ? "Full" : "Partial"}
                {payment.method && payment.method !== "na"
                  ? ` · ${payment.method === "cash" ? "Cash" : "Online"}`
                  : ""}
              </span>
            </p>
            <p className="text-xs text-[#7A8699]">
              {format(new Date(payment.paidAt), "dd MMM yyyy")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
