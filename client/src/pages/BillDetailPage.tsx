import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import clsx from "clsx";
import {
  ArrowLeftRight,
  Check,
  Download,
  Pencil,
  Phone,
  RotateCcw,
  Share2,
  Trash2,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { SettleDueModal } from "../components/SettleDueModal";
import { FinanceReceivedConfirmModal } from "../components/FinanceReceivedConfirmModal";
import { BackLink, EmptyState, LoadingBlock } from "../components/ui";
import { api, formatINR, round2 } from "../lib/api";
import {
  financeSlotAmounts,
  financeSlotOptions,
  hasPendingFinance,
  hasReceivedFinance,
  isFinanceFullyReceived,
  type FinanceSlot,
} from "../lib/financeSlots";
import { isShareAbort, shareInvoicePdf } from "../lib/shareInvoice";
import type { Bill, DuePayment } from "../types";
import { useAuth } from "../auth/AuthContext";
import {
  backLabel,
  billsHomePath,
  fromState,
  readFromState,
} from "../lib/navMemory";

const PAY = {
  cash: "#12B886",
  online: "#3B82F6",
  card: "#6366F1",
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
  const [financeConfirmMode, setFinanceConfirmMode] = useState<
    "receive" | "undo"
  >("receive");
  const [financeConfirmInitialSlots, setFinanceConfirmInitialSlots] = useState<
    FinanceSlot[] | undefined
  >(undefined);
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

  async function markFinanceReceived(slots: FinanceSlot[]) {
    if (!isAdmin || !bill || !hasPendingFinance(bill) || slots.length === 0)
      return;
    setMarkingFinance(true);
    setFinanceError(null);
    try {
      const { data } = await api.markFinanceReceived(bill.id, slots);
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

  async function unmarkFinanceReceived(slots: FinanceSlot[]) {
    if (!isAdmin || !bill || !hasReceivedFinance(bill) || slots.length === 0)
      return;
    setMarkingFinance(true);
    setFinanceError(null);
    try {
      const { data } = await api.unmarkFinanceReceived(bill.id, slots);
      setBill(data);
      setShowFinanceConfirm(false);
    } catch (err) {
      setFinanceError(
        err instanceof Error
          ? err.message
          : "Failed to undo finance received status",
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
  const exchangeGross = Number(bill.exchangeValue || 0) || 0;
  const exchangeCashReturn = Math.min(
    Math.max(Number(bill.exchangeCashReturn || 0) || 0, 0),
    exchangeGross,
  );
  const exchangeCredit = Math.max(exchangeGross - exchangeCashReturn, 0);
  const exchangeRefund =
    !bill.withGst && bill.isExchange && exchangeGross > 0
      ? Math.max(
          exchangeCashReturn + Math.max(exchangeCredit - bill.grandTotal, 0),
          0,
        )
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
                              ? ("ANDROID" as const)
                              : ("IOS" as const),
                          color: bill.exchangeColor || "",
                          storage: bill.exchangeStorage || "",
                          ram: bill.exchangeRam,
                          imei1: bill.exchangeImei1 || "",
                          value: bill.exchangeValue || 0,
                          notes: bill.exchangeNotes,
                        },
                      ]
                  : []
                ).map((item, index) => {
                  const sold =
                    item.stockStatus === "SOLD" || Boolean(item.soldBillId);
                  return (
                  <div
                    key={`${item.imei1}-${index}`}
                    className={clsx(
                      "relative isolate overflow-hidden rounded-xl border p-4",
                      sold
                        ? "border-rose-200/80 bg-rose-50/70 dark:border-rose-500/30 dark:!bg-rose-950/45"
                        : "border-ink-100 bg-ink-50/40",
                    )}
                  >
                    <div className="relative z-20 mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                        Exchange {index + 1}
                      </p>
                      {sold ? (
                        item.soldBillId ? (
                          <Link
                            to={`/bills/${item.soldBillId}`}
                            state={fromState(location)}
                            className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-100 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
                          >
                            Sold
                            {item.soldInvoiceNumber
                              ? ` · ${item.soldInvoiceNumber}`
                              : ""}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-400">
                            Sold
                          </span>
                        )
                      ) : item.stockStatus === "AVAILABLE" ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-400">
                          In stock
                        </span>
                      ) : null}
                    </div>
                    <div className="relative z-20 grid grid-cols-2 gap-4">
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
                      {sold && item.soldInvoiceNumber ? (
                        <Kv
                          label="Sold on bill"
                          value={item.soldInvoiceNumber}
                          full={!item.notes}
                        />
                      ) : null}
                      {item.notes ? (
                        <Kv label="Notes" value={item.notes} full />
                      ) : null}
                    </div>
                    {sold ? (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                      >
                        <span
                          className="select-none whitespace-nowrap rounded border border-rose-500/45 bg-white/55 px-4 py-0.5 text-[11px] font-black uppercase tracking-[0.35em] text-rose-500/75 shadow-sm dark:border-rose-400/40 dark:!bg-rose-500/15 dark:!text-rose-300/80 sm:text-xs"
                          style={{ transform: "rotate(-12deg)" }}
                        >
                          Sold
                        </span>
                      </div>
                    ) : null}
                  </div>
                  );
                })}
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
            {!bill.withGst && bill.isExchange && exchangeGross > 0 ? (
              <>
                {exchangeCashReturn > 0 ? (
                  <SumLine
                    label="Exchange value"
                    value={formatINR(exchangeGross)}
                    muted
                  />
                ) : null}
                {exchangeCashReturn > 0 ? (
                  <SumLine
                    label="Fixed return to client"
                    value={formatINR(exchangeCashReturn)}
                    exchange
                  />
                ) : null}
                <SumLine
                  label="Less: exchange credit"
                  value={`−${formatINR(exchangeCredit)}`}
                  exchange
                />
              </>
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
                    {exchangeCashReturn > 0
                      ? "Pay client (cash return)"
                      : "Refund due to customer"}
                  </span>
                  <span className="font-display text-lg font-bold tabular-nums text-[#B76E00]">
                    {formatINR(exchangeRefund)}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] text-[#9A7A3E]">
                  {exchangeCashReturn > 0
                    ? "Fixed cash return from the exchange mobile."
                    : "Exchange value was higher than the bill — this amount is owed back."}
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
              <PayLine
                color={PAY.card}
                label="Card"
                value={formatINR(bill.cardAmount || 0)}
                zero={!((bill.cardAmount || 0) > 0)}
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
                <div className="mt-3 space-y-2">
                  {(() => {
                    const { amount1, amount2 } = financeSlotAmounts(bill);
                    const rows: Array<{
                      key: string;
                      label: string;
                      received: boolean;
                      receivedAt?: string | null;
                      slot: FinanceSlot;
                    }> = [];
                    if (amount1 > 0) {
                      rows.push({
                        key: "f1",
                        label:
                          bill.financeCompanyName?.trim() ||
                          (amount2 > 0 ? "Finance 1" : "Finance"),
                        received: Boolean(bill.financeReceived),
                        receivedAt: bill.financeReceivedAt,
                        slot: 1,
                      });
                    }
                    if (amount2 > 0) {
                      rows.push({
                        key: "f2",
                        label:
                          bill.financeCompanyName2?.trim() || "Finance 2",
                        received: Boolean(bill.financeReceived2),
                        receivedAt: bill.financeReceivedAt2,
                        slot: 2,
                      });
                    }
                    return rows.map((row) => (
                      <div
                        key={row.key}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <p
                          className={`text-xs font-semibold ${
                            row.received ? "text-[#0E9E76]" : "text-[#B76E00]"
                          }`}
                        >
                          {row.label} ·{" "}
                          {row.received ? "Received" : "Pending"}
                          {row.received && row.receivedAt
                            ? ` · ${format(new Date(row.receivedAt), "dd MMM yyyy")}`
                            : ""}
                        </p>
                        {row.received && isAdmin ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-[11px] font-semibold text-ink-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
                            disabled={markingFinance}
                            onClick={() => {
                              setFinanceError(null);
                              setFinanceConfirmMode("undo");
                              setFinanceConfirmInitialSlots([row.slot]);
                              setShowFinanceConfirm(true);
                            }}
                          >
                            <Undo2 className="h-3 w-3" />
                            Undo
                          </button>
                        ) : null}
                      </div>
                    ));
                  })()}
                </div>
              ) : null}

              {bill.financeAmount > 0 &&
              hasPendingFinance(bill) &&
              isAdmin ? (
                <button
                  type="button"
                  className="btn-primary mt-4 w-full !rounded-[11px]"
                  disabled={markingFinance}
                  onClick={() => {
                    setFinanceError(null);
                    setFinanceConfirmMode("receive");
                    setFinanceConfirmInitialSlots(undefined);
                    setShowFinanceConfirm(true);
                  }}
                >
                  <Check className="h-4 w-4" />
                  {markingFinance
                    ? "Saving…"
                    : isFinanceFullyReceived(bill)
                      ? "Mark finance as received"
                      : hasReceivedFinance(bill)
                        ? "Mark remaining finance as received"
                        : "Mark finance as received"}
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
            mode={financeConfirmMode}
            invoiceNumber={bill.invoiceNumber}
            options={
              financeConfirmMode === "undo" &&
              financeConfirmInitialSlots?.length === 1
                ? financeSlotOptions(bill, "undo").filter((option) =>
                    financeConfirmInitialSlots.includes(option.slot),
                  )
                : financeSlotOptions(bill, financeConfirmMode)
            }
            initialSlots={financeConfirmInitialSlots}
            saving={markingFinance}
            error={financeError}
            onCancel={() => {
              if (markingFinance) return;
              setShowFinanceConfirm(false);
              setFinanceError(null);
            }}
            onConfirm={(slots) =>
              void (financeConfirmMode === "undo"
                ? unmarkFinanceReceived(slots)
                : markFinanceReceived(slots))
            }
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
                  ? ` · ${
                      payment.method === "cash"
                        ? "Cash"
                        : payment.method === "card"
                          ? "Card"
                          : "Online"
                    }`
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
