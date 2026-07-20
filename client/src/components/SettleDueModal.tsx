import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Banknote, Check, Smartphone, X } from "lucide-react";
import clsx from "clsx";
import { api, formatINR, round2 } from "../lib/api";

type SettleMethod = "cash" | "online" | "na";
type SettleMode = "full" | "custom";

type SettleTarget = {
  id: string;
  invoiceNumber: string;
  customerName: string;
  dueAmount: number;
};

export function SettleDueModal({
  bill,
  onClose,
  onSettled,
}: {
  bill: SettleTarget;
  onClose: () => void;
  onSettled: () => void | Promise<void>;
}) {
  const [settleMode, setSettleMode] = useState<SettleMode>("full");
  const [customAmount, setCustomAmount] = useState<number | "">("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [settleMethod, setSettleMethod] = useState<SettleMethod | null>(null);
  const [settling, setSettling] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const remainingAmount = useMemo(() => {
    if (settleMode === "full") return 0;
    const paid = typeof customAmount === "number" ? customAmount : 0;
    return round2(Math.max(bill.dueAmount - paid, 0));
  }, [bill.dueAmount, settleMode, customAmount]);

  async function confirmSettle() {
    if (!settleMethod) {
      setModalError("Select payment method: Cash, Online, or N/A");
      return;
    }

    if (settleMode === "custom") {
      const paid = typeof customAmount === "number" ? customAmount : 0;
      if (paid <= 0) {
        setModalError("Enter the amount collected");
        return;
      }
      if (paid > bill.dueAmount) {
        setModalError("Amount cannot exceed pending due");
        return;
      }
      if (paid < bill.dueAmount && !nextDueDate) {
        setModalError("Select next due date for remaining amount");
        return;
      }
    }

    setSettling(true);
    setModalError(null);
    try {
      const paid =
        settleMode === "full"
          ? bill.dueAmount
          : typeof customAmount === "number"
            ? customAmount
            : 0;

      await api.settleDue(bill.id, {
        mode:
          settleMode === "custom" && paid < bill.dueAmount ? "custom" : "full",
        method: settleMethod,
        amount: settleMode === "custom" ? paid : undefined,
        nextDueDate:
          settleMode === "custom" && paid < bill.dueAmount ? nextDueDate : null,
      });
      await onSettled();
      onClose();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to mark as paid");
    } finally {
      setSettling(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-4 sm:items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => !settling && onClose()}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settle-due-title"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/70 bg-white p-5 shadow-lift sm:p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-tide-600">
                Mark paid
              </p>
              <h2
                id="settle-due-title"
                className="mt-1 font-display text-2xl font-semibold text-ink-900"
              >
                {formatINR(bill.dueAmount)}
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                {bill.customerName} · {bill.invoiceNumber}
              </p>
            </div>
            <button
              type="button"
              className="rounded-xl p-2 text-ink-500 hover:bg-ink-50"
              onClick={onClose}
              disabled={settling}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <p className="label required mb-2">Payment type</p>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <ModeChip
              label="Fully paid"
              active={settleMode === "full"}
              onClick={() => {
                setSettleMode("full");
                setCustomAmount("");
                setNextDueDate("");
              }}
            />
            <ModeChip
              label="Custom"
              active={settleMode === "custom"}
              onClick={() => setSettleMode("custom")}
            />
          </div>

          {settleMode === "custom" ? (
            <div className="mb-4 space-y-3 rounded-2xl border border-ink-100 bg-ink-50/50 p-4">
              <div>
                <label className="label required" htmlFor="customPaidAmount">
                  Amount paid now
                </label>
                <input
                  id="customPaidAmount"
                  className="field"
                  type="number"
                  min={0.01}
                  step="0.01"
                  max={bill.dueAmount}
                  value={customAmount}
                  onChange={(e) =>
                    setCustomAmount(
                      e.target.value === "" ? "" : Number(e.target.value) || 0,
                    )
                  }
                  placeholder="Enter amount"
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Remaining</span>
                <span className="font-semibold text-ember-500">
                  {formatINR(remainingAmount)}
                </span>
              </div>
              {remainingAmount > 0 ? (
                <div>
                  <label className="label required" htmlFor="nextDueDate">
                    Next due date
                  </label>
                  <input
                    id="nextDueDate"
                    className="field"
                    type="date"
                    value={nextDueDate}
                    onChange={(e) => setNextDueDate(e.target.value)}
                    required
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="label required mb-2">Collected via</p>
          <div className="grid gap-2">
            <MethodChip
              label="Cash"
              icon={<Banknote className="h-4 w-4 text-tide-600" />}
              active={settleMethod === "cash"}
              onClick={() => setSettleMethod("cash")}
            />
            <MethodChip
              label="Online"
              icon={<Smartphone className="h-4 w-4 text-tide-600" />}
              active={settleMethod === "online"}
              onClick={() => setSettleMethod("online")}
            />
            <MethodChip
              label="N/A"
              icon={<Check className="h-4 w-4 text-ink-500" />}
              active={settleMethod === "na"}
              onClick={() => setSettleMethod("na")}
            />
          </div>

          {modalError ? (
            <p className="mt-4 rounded-2xl bg-orange-50 px-4 py-3 text-sm text-ember-500">
              {modalError}
            </p>
          ) : null}

          <button
            type="button"
            className="btn-primary mt-5 w-full"
            disabled={settling}
            onClick={() => void confirmSettle()}
          >
            {settling ? "Saving…" : "Confirm payment"}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ModeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-2xl border px-3 py-3 text-sm font-semibold transition",
        active
          ? "border-ink-900 bg-ink-900 text-white"
          : "border-ink-100 bg-white text-ink-700 hover:border-ink-300",
      )}
    >
      {label}
    </button>
  );
}

function MethodChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition",
        active
          ? "border-tide-500 bg-tide-100/70 text-ink-900"
          : "border-ink-100 bg-white text-ink-700 hover:border-ink-300",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
