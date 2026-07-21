import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Download,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { BillChangeConfirmModal } from "../components/BillChangeConfirmModal";
import {
  SaveBillConfirmModal,
  type SaveBillSummary,
} from "../components/SaveBillConfirmModal";
import { PageHeader, LoadingBlock } from "../components/ui";
import { AddMobileModal } from "../components/AddMobileModal";
import { FieldPicker } from "../components/FieldPicker";
import {
  ADD_NEW_FINANCE,
  FinanceCompanyPicker,
} from "../components/FinanceCompanyPicker";
import {
  billToSnapshot,
  diffBillSnapshots,
  payloadToSnapshot,
  type DiffLine,
} from "../lib/billDiff";
import { api, formatINR, round2 } from "../lib/api";
import type {
  Bill,
  BillItem,
  CreateBillPayload,
  FinanceCompany,
  MobileCatalog,
} from "../types";

type DraftItem = BillItem & {
  key: string;
  catalogMode: "mobile" | "other";
};

const blankItem = (): DraftItem => ({
  key: crypto.randomUUID(),
  catalogMode: "mobile",
  productName: "",
  mobileCatalogId: null,
  platform: null,
  color: "",
  storage: "",
  ram: "",
  quantity: 1,
  rate: 0,
  gstPercent: 0,
  imei1: "",
  serialNumber: "",
  warrantyMonths: undefined,
});

/** Rate is GST-inclusive — line total does not grow when GST % is set. */
function lineBreakdown(item: DraftItem) {
  const amount = round2(item.rate * item.quantity);
  const base = round2((amount * 100) / (100 + item.gstPercent));
  const gst = round2(amount - base);
  return { amount, base, gst };
}

function lineAmount(item: DraftItem) {
  return lineBreakdown(item).amount;
}

export function CreateBillPage() {
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id?: string }>();
  const isEdit = Boolean(editId);

  const [loadingBill, setLoadingBill] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [originalBill, setOriginalBill] = useState<Bill | null>(null);
  const [pendingPayload, setPendingPayload] = useState<CreateBillPayload | null>(
    null,
  );
  const [pendingDiff, setPendingDiff] = useState<DiffLine[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [saveSummary, setSaveSummary] = useState<SaveBillSummary | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [customerAddress, setCustomerAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [isExchange, setIsExchange] = useState(false);
  const [exchangeModel, setExchangeModel] = useState("");
  const [exchangeImei1, setExchangeImei1] = useState("");
  const [exchangeSerial, setExchangeSerial] = useState("");
  const [exchangeValue, setExchangeValue] = useState<number | "">("");
  const [exchangeNotes, setExchangeNotes] = useState("");
  const [useCash, setUseCash] = useState(false);
  const [useOnline, setUseOnline] = useState(false);
  const [useFinance, setUseFinance] = useState(false);
  const [hasDue, setHasDue] = useState(false);
  const [cashAmount, setCashAmount] = useState(0);
  const [onlineAmount, setOnlineAmount] = useState(0);
  const [financeAmount, setFinanceAmount] = useState(0);
  const [financeCompanies, setFinanceCompanies] = useState<FinanceCompany[]>([]);
  const [mobileCatalog, setMobileCatalog] = useState<MobileCatalog[]>([]);
  const [addMobileForItem, setAddMobileForItem] = useState<string | null>(null);
  const [financeCompanyId, setFinanceCompanyId] = useState("");
  const [financeSelect, setFinanceSelect] = useState("");
  const [newFinanceName, setNewFinanceName] = useState("");
  const [savingFinance, setSavingFinance] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  function validatePhone(value: string) {
    const digits = value.replace(/\D/g, "");
    if (!digits) return "Phone number is required";
    if (digits.length !== 10) return "Phone number must be 10 digits";
    return null;
  }

  function resetBlankForm() {
    setOriginalBill(null);
    setLoadError(null);
    setPendingPayload(null);
    setPendingDiff([]);
    setShowConfirm(false);
    setShowSaveConfirm(false);
    setSaveSummary(null);
    setCustomerName("");
    setCustomerPhone("");
    setPhoneError(null);
    setCustomerAddress("");
    setNotes("");
    setItems([blankItem()]);
    setAddMobileForItem(null);
    setIsExchange(false);
    setExchangeModel("");
    setExchangeImei1("");
    setExchangeSerial("");
    setExchangeValue("");
    setExchangeNotes("");
    setUseCash(false);
    setUseOnline(false);
    setUseFinance(false);
    setHasDue(false);
    setCashAmount(0);
    setOnlineAmount(0);
    setFinanceAmount(0);
    setFinanceSelect("");
    setFinanceCompanyId("");
    setNewFinanceName("");
    setDueDate("");
    setSaving(false);
    setError(null);
    setSuccessId(null);
    setLoadingBill(false);
  }

  function applyBillToForm(bill: Bill) {
    setOriginalBill(bill);
    setCustomerName(bill.customerName);
    setCustomerPhone(bill.customerPhone.replace(/\D/g, "").slice(0, 10));
    setCustomerAddress(bill.customerAddress || "");
    setNotes(bill.notes || "");
    setItems(
      bill.items.length
        ? bill.items.map((item) => ({
            key: crypto.randomUUID(),
            catalogMode:
              item.mobileCatalogId || item.platform ? "mobile" : "other",
            productName: item.productName,
            mobileCatalogId: item.mobileCatalogId || null,
            platform: item.platform || null,
            color: item.color || "",
            storage: item.storage || "",
            ram: item.ram || "",
            quantity: item.quantity,
            rate: item.rate,
            gstPercent: item.gstPercent,
            imei1: item.imei1 || "",
            serialNumber: item.serialNumber || "",
            warrantyMonths: item.warrantyMonths ?? undefined,
          }))
        : [blankItem()],
    );
    setIsExchange(bill.isExchange);
    setExchangeModel(bill.exchangeModel || "");
    setExchangeImei1(bill.exchangeImei1 || "");
    setExchangeSerial(bill.exchangeSerial || "");
    setExchangeValue(bill.exchangeValue ?? "");
    setExchangeNotes(bill.exchangeNotes || "");
    setUseCash(bill.cashAmount > 0);
    setUseOnline(bill.onlineAmount > 0);
    setUseFinance(bill.financeAmount > 0);
    setHasDue(bill.dueAmount > 0);
    setCashAmount(bill.cashAmount);
    setOnlineAmount(bill.onlineAmount);
    setFinanceAmount(bill.financeAmount);
    setFinanceCompanyId(bill.financeCompanyId || "");
    setFinanceSelect(bill.financeCompanyId || "");
    setDueDate(bill.dueDate ? bill.dueDate.slice(0, 10) : "");
    setSuccessId(null);
    setError(null);
    setPhoneError(null);
    setShowConfirm(false);
    setShowSaveConfirm(false);
    setPendingPayload(null);
    setPendingDiff([]);
    setSaveSummary(null);
  }

  const totals = useMemo(() => {
    const lines = items.map(lineBreakdown);
    const subtotal = round2(lines.reduce((sum, line) => sum + line.base, 0));
    const gstAmount = round2(lines.reduce((sum, line) => sum + line.gst, 0));
    const grandTotal = round2(lines.reduce((sum, line) => sum + line.amount, 0));
    const exchangeDeduction =
      isExchange && exchangeValue !== "" ? round2(Number(exchangeValue) || 0) : 0;
    const payableAmount = round2(Math.max(grandTotal - exchangeDeduction, 0));
    const cash = useCash ? cashAmount : 0;
    const online = useOnline ? onlineAmount : 0;
    const finance = useFinance ? financeAmount : 0;
    const paid = round2(cash + online + finance);
    const dueAmount = round2(Math.max(payableAmount - paid, 0));
    return {
      subtotal,
      gstAmount,
      grandTotal,
      exchangeDeduction,
      payableAmount,
      paid,
      dueAmount,
      cash,
      online,
      finance,
    };
  }, [
    items,
    isExchange,
    exchangeValue,
    useCash,
    useOnline,
    useFinance,
    cashAmount,
    onlineAmount,
    financeAmount,
  ]);

  const mobileOptions = useMemo(
    () => [
      ...mobileCatalog.map((mobile) => {
        const ramLabel = (() => {
          if (!mobile.ram) return null;
          const capacity = mobile.ram.replace(/\s*gb\s*$/i, "").trim();
          return /^\d+$/.test(capacity)
            ? `${capacity} GB RAM`
            : `${mobile.ram} RAM`;
        })();

        return {
          value: mobile.id,
          label: [mobile.name, mobile.color, mobile.storage, ramLabel]
            .filter(Boolean)
            .join(" • "),
        };
      }),
      { value: "__other__", label: "Other product / accessory" },
    ],
    [mobileCatalog],
  );

  useEffect(() => {
    if (!hasDue || totals.dueAmount <= 0) setDueDate("");
  }, [hasDue, totals.dueAmount]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [financeResult, mobileResult] = await Promise.allSettled([
        api.listFinanceCompanies(),
        api.listMobileCatalog(),
      ]);
      if (!active) return;
      if (financeResult.status === "fulfilled") {
        setFinanceCompanies(financeResult.value.data);
      }
      if (mobileResult.status === "fulfilled") {
        setMobileCatalog(mobileResult.value.data);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!editId) {
      resetBlankForm();
      return;
    }
    let active = true;
    setLoadingBill(true);
    setLoadError(null);
    (async () => {
      try {
        const { data } = await api.getBill(editId);
        if (!active) return;
        applyBillToForm(data);
      } catch (err) {
        if (active) {
          setLoadError(
            err instanceof Error ? err.message : "Failed to load bill",
          );
        }
      } finally {
        if (active) setLoadingBill(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [editId]);

  function resetFinanceCompany() {
    setFinanceSelect("");
    setFinanceCompanyId("");
    setNewFinanceName("");
  }

  async function saveNewFinanceCompany() {
    const name = newFinanceName.trim();
    if (!name) {
      setError("Enter a finance company name");
      return null;
    }

    setSavingFinance(true);
    setError(null);
    try {
      const { data } = await api.createFinanceCompany(name);
      setFinanceCompanies((prev) =>
        prev.some((c) => c.id === data.id)
          ? prev
          : [...prev, data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setFinanceSelect(data.id);
      setFinanceCompanyId(data.id);
      setNewFinanceName("");
      return data;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save finance company",
      );
      return null;
    } finally {
      setSavingFinance(false);
    }
  }

  function togglePayment(
    mode: "cash" | "online" | "finance",
    checked: boolean,
  ) {
    const currentlyEnabled =
      Number(useCash) + Number(useOnline) + Number(useFinance);
    const isFirstEnabled = checked && currentlyEnabled === 0;
    const defaultAmount = isFirstEnabled ? totals.payableAmount : undefined;

    if (mode === "cash") {
      setUseCash(checked);
      if (!checked) setCashAmount(0);
      else if (defaultAmount !== undefined) setCashAmount(defaultAmount);
    }
    if (mode === "online") {
      setUseOnline(checked);
      if (!checked) setOnlineAmount(0);
      else if (defaultAmount !== undefined) setOnlineAmount(defaultAmount);
    }
    if (mode === "finance") {
      setUseFinance(checked);
      if (!checked) {
        setFinanceAmount(0);
        resetFinanceCompany();
      } else {
        const remainingAfterCashAndOnline = round2(
          Math.max(
            totals.payableAmount -
              (useCash ? cashAmount : 0) -
              (useOnline ? onlineAmount : 0),
            0,
          ),
        );
        setFinanceAmount(remainingAfterCashAndOnline);
      }
    }
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  function applyCatalogMobile(key: string, mobile: MobileCatalog) {
    updateItem(key, {
      catalogMode: "mobile",
      productName: mobile.name,
      mobileCatalogId: mobile.id,
      platform: mobile.platform,
      color: mobile.color,
      storage: mobile.storage,
      ram: mobile.platform === "ANDROID" ? mobile.ram : "",
    });
  }

  function selectMobile(key: string, value: string) {
    if (value === "__other__") {
      updateItem(key, {
        catalogMode: "other",
        productName: "",
        mobileCatalogId: null,
        platform: null,
        color: "",
        storage: "",
        ram: "",
      });
      return;
    }

    const mobile = mobileCatalog.find((entry) => entry.id === value);
    if (!mobile) return;
    applyCatalogMobile(key, mobile);
  }

  async function buildPayload(): Promise<CreateBillPayload | null> {
    let resolvedCompanyId = financeCompanyId || null;
    let resolvedCompanyName: string | null = null;

    if (useFinance) {
      if (financeSelect === ADD_NEW_FINANCE) {
        const created = await saveNewFinanceCompany();
        if (!created) return null;
        resolvedCompanyId = created.id;
        resolvedCompanyName = created.name;
      } else if (financeCompanyId) {
        resolvedCompanyId = financeCompanyId;
        resolvedCompanyName =
          financeCompanies.find((c) => c.id === financeCompanyId)?.name || null;
      } else {
        throw new Error("Select a finance company");
      }
    }

    return {
      customerName,
      customerPhone,
      customerAddress: customerAddress || null,
      notes: notes || null,
      useCash,
      useOnline,
      useFinance,
      cashAmount: useCash ? cashAmount : 0,
      onlineAmount: useOnline ? onlineAmount : 0,
      financeAmount: useFinance ? financeAmount : 0,
      financeCompanyId: useFinance ? resolvedCompanyId : null,
      financeCompanyName: useFinance ? resolvedCompanyName : null,
      isExchange,
      exchangeModel: isExchange ? exchangeModel.trim() : null,
      exchangeImei1: isExchange ? exchangeImei1.trim() || null : null,
      exchangeImei2: null,
      exchangeSerial: isExchange ? exchangeSerial.trim() || null : null,
      exchangeValue:
        isExchange && exchangeValue !== "" ? Number(exchangeValue) : null,
      exchangeNotes: isExchange ? exchangeNotes.trim() || null : null,
      dueDate: hasDue && totals.dueAmount > 0 ? dueDate.trim() : null,
      items: items.map((item) => ({
        productName: item.productName,
        mobileCatalogId:
          item.catalogMode === "mobile" ? item.mobileCatalogId || null : null,
        platform: item.catalogMode === "mobile" ? item.platform || null : null,
        color: item.catalogMode === "mobile" ? item.color || null : null,
        storage: item.catalogMode === "mobile" ? item.storage || null : null,
        ram:
          item.catalogMode === "mobile" && item.platform === "ANDROID"
            ? item.ram || null
            : null,
        quantity: item.quantity,
        rate: item.rate,
        gstPercent: item.gstPercent,
        imei1: item.imei1 || null,
        imei2: null,
        serialNumber: item.serialNumber || null,
        warrantyMonths: item.warrantyMonths || null,
      })),
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const phoneIssue = validatePhone(customerPhone);
    if (phoneIssue) {
      setPhoneError(phoneIssue);
      document.getElementById("customerPhone")?.focus();
      return;
    }

    const incompleteMobile = items.find(
      (item) =>
        item.catalogMode === "mobile" &&
        (!item.productName ||
          !item.platform ||
          !item.color ||
          !item.storage ||
          (item.platform === "ANDROID" && !item.ram)),
    );
    if (incompleteMobile) {
      setError(
        "Select a complete mobile variant with name, color, storage, and RAM for Android.",
      );
      return;
    }

    if (!hasDue && totals.dueAmount > 0) {
      setError(
        `Payment is short by ${formatINR(totals.dueAmount)}. Complete the payment split or turn on "This bill has due".`,
      );
      document.getElementById("hasDue")?.focus();
      return;
    }

    if (hasDue && totals.dueAmount > 0 && !dueDate.trim()) {
      setError("Select expected collection date for the pending due amount");
      document.getElementById("dueDate")?.focus();
      return;
    }

    setSaving(true);
    try {
      const payload = await buildPayload();
      if (!payload) {
        setSaving(false);
        return;
      }

      if (isEdit && editId && originalBill) {
        const after = payloadToSnapshot(payload, {
          dueAmount: totals.dueAmount,
          payableAmount: totals.payableAmount,
          grandTotal: totals.grandTotal,
          items: items.map((item) => ({ amount: lineAmount(item) })),
        });
        const changes = diffBillSnapshots(billToSnapshot(originalBill), after);
        setPendingPayload(payload);
        setPendingDiff(changes);
        setShowConfirm(true);
        setSaving(false);
        return;
      }

      setPendingPayload(payload);
      setSaveSummary({
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        itemCount: payload.items.length,
        payableAmount: totals.payableAmount,
        cashAmount: payload.useCash ? payload.cashAmount : 0,
        onlineAmount: payload.useOnline ? payload.onlineAmount : 0,
        financeAmount: payload.useFinance ? payload.financeAmount : 0,
        financeCompanyName: payload.financeCompanyName,
        dueAmount: totals.dueAmount,
        dueDate:
          payload.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate)
            ? payload.dueDate.split("-").reverse().join("/")
            : payload.dueDate,
        isExchange: Boolean(payload.isExchange),
        exchangeValue: payload.exchangeValue,
      });
      setShowSaveConfirm(true);
      setSaving(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save bill");
      setSaving(false);
    }
  }

  async function confirmCreate() {
    if (!pendingPayload) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.createBill(pendingPayload);
      setShowSaveConfirm(false);
      setPendingPayload(null);
      setSaveSummary(null);
      setSuccessId(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save bill");
    } finally {
      setSaving(false);
    }
  }

  async function confirmUpdate() {
    if (!editId || !pendingPayload) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.updateBill(editId, pendingPayload);
      setShowConfirm(false);
      setPendingPayload(null);
      setPendingDiff([]);
      setSuccessId(data.id);
      setOriginalBill(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update bill");
    } finally {
      setSaving(false);
    }
  }

  if (loadingBill) {
    return <LoadingBlock label="Loading bill…" />;
  }

  if (isEdit && loadError) {
    return (
      <div className="space-y-4">
        <Link to="/bills" className="btn-secondary inline-flex">
          <ArrowLeft className="h-4 w-4" />
          Back to bills
        </Link>
        <div className="glass-panel px-5 py-8 text-center text-sm text-ember-500">
          {loadError}
        </div>
      </div>
    );
  }

  if (successId) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-panel mx-auto max-w-xl px-6 py-12 text-center"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-tide-100 text-tide-600">
          <Check className="h-7 w-7" />
        </div>
        <h2 className="font-display text-3xl font-semibold text-ink-900">
          {isEdit ? "Bill updated" : "Bill saved"}
        </h2>
        <p className="mt-2 text-sm text-ink-500">
          {isEdit
            ? "Changes are saved and the PDF will use the latest details."
            : "Invoice is stored on the server and synced across devices."}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <a
            className="btn-primary"
            href={api.pdfUrl(successId)}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </a>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => navigate(`/bills/${successId}`)}
          >
            View bill
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => navigate("/bills")}
          >
            View all bills
          </button>
          {!isEdit ? (
          <button
            className="btn-secondary"
            type="button"
            onClick={() => resetBlankForm()}
          >
            Create another
          </button>
          ) : null}
        </div>
      </motion.div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={isEdit ? "Edit" : "Create"}
        title={isEdit ? `Edit ${originalBill?.invoiceNumber || "bill"}` : "New bill"}
        description={
          isEdit
            ? "Update customer, products, or payment details. You’ll review a change summary before saving."
            : "Enter products manually. Split payment across cash, online, and finance — remaining amount becomes due."
        }
        action={
          isEdit && editId ? (
            <Link to={`/bills/${editId}`} className="btn-secondary">
              <ArrowLeft className="h-4 w-4" />
              Cancel
            </Link>
          ) : undefined
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="glass-panel p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold text-ink-900">
            Customer
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label required" htmlFor="customerName">
                Name
              </label>
              <input
                id="customerName"
                className="field"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer full name"
                required
              />
            </div>
            <div>
              <label className="label required" htmlFor="customerPhone">
                Phone
              </label>
              <input
                id="customerPhone"
                className={`field ${phoneError ? "border-ember-400 focus:border-ember-500 focus:ring-ember-200" : ""}`}
                inputMode="numeric"
                maxLength={10}
                value={customerPhone}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setCustomerPhone(next);
                  if (phoneError && next.length === 10) setPhoneError(null);
                }}
                onBlur={() => setPhoneError(validatePhone(customerPhone))}
                placeholder="10-digit mobile"
                aria-invalid={Boolean(phoneError)}
                aria-describedby={phoneError ? "customerPhone-error" : undefined}
                required
              />
              {phoneError ? (
                <p
                  id="customerPhone-error"
                  className="mt-1.5 text-xs font-medium text-ember-500"
                  role="alert"
                >
                  {phoneError}
                </p>
              ) : null}
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="customerAddress">
                Address (optional)
              </label>
              <input
                id="customerAddress"
                className="field"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Village / city"
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Products
            </h2>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setItems((prev) => [...prev, blankItem()])}
            >
              <Plus className="h-4 w-4" />
              Add item
            </button>
          </div>

          <AnimatePresence initial={false}>
            {items.map((item, index) => (
              <motion.div
                key={item.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="glass-panel p-5 sm:p-6"
              >
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-700">
                    Item {index + 1}
                  </p>
                  {items.length > 1 ? (
                    <button
                      type="button"
                      className="rounded-xl p-2 text-ink-500 transition hover:bg-orange-50 hover:text-ember-500"
                      onClick={() =>
                        setItems((prev) => prev.filter((row) => row.key !== item.key))
                      }
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2 lg:col-span-4">
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <label className="label required mb-0">Phone</label>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-tide-600 hover:text-tide-700"
                        onClick={() => setAddMobileForItem(item.key)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add new mobile
                      </button>
                    </div>
                    <FieldPicker
                      value={
                        item.catalogMode === "other"
                          ? "__other__"
                          : item.mobileCatalogId ||
                            mobileCatalog.find(
                              (mobile) =>
                                mobile.name === item.productName &&
                                mobile.color === item.color &&
                                mobile.storage === item.storage &&
                                (mobile.ram || "") === (item.ram || ""),
                            )?.id ||
                            ""
                      }
                      onChange={(value) => selectMobile(item.key, value)}
                      placeholder="Select phone"
                      searchable
                      searchPlaceholder="Search phone…"
                      required
                      options={mobileOptions}
                    />
                  </div>

                  {item.catalogMode === "other" ? (
                    <div className="sm:col-span-2 lg:col-span-4">
                      <label className="label required">Product name</label>
                      <input
                        className="field"
                        value={item.productName}
                        onChange={(event) =>
                          updateItem(item.key, {
                            productName: event.target.value,
                          })
                        }
                        placeholder="e.g. Charger / Earphones"
                        required
                      />
                    </div>
                  ) : null}
                  <div>
                    <label className="label required">Qty</label>
                    <input
                      className="field"
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(item.key, {
                          quantity: Number(e.target.value) || 1,
                        })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="label required">Rate (₹)</label>
                    <input
                      className="field"
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.rate || ""}
                      onChange={(e) =>
                        updateItem(item.key, {
                          rate: Number(e.target.value) || 0,
                        })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="label">GST % (incl.)</label>
                    <input
                      className="field"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={item.gstPercent}
                      onChange={(e) =>
                        updateItem(item.key, {
                          gstPercent: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">IMEI</label>
                    <input
                      className="field font-mono"
                      value={item.imei1 || ""}
                      onChange={(e) =>
                        updateItem(item.key, { imei1: e.target.value })
                      }
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="label">Serial</label>
                    <input
                      className="field font-mono"
                      value={item.serialNumber || ""}
                      onChange={(e) =>
                        updateItem(item.key, { serialNumber: e.target.value })
                      }
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="label">Warranty (months)</label>
                    <input
                      className="field"
                      type="number"
                      min={1}
                      value={item.warrantyMonths || ""}
                      onChange={(e) =>
                        updateItem(item.key, {
                          warrantyMonths: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <p className="mt-4 text-right text-sm font-semibold text-ink-800">
                  Line total · {formatINR(lineAmount(item))}
                </p>
              </motion.div>
            ))}
          </AnimatePresence>

          <div className="glass-panel p-5 sm:p-6">
            <label className="flex cursor-pointer items-center justify-between gap-4">
              <div>
                <p className="font-display text-lg font-semibold text-ink-900">
                  Mobile exchange?
                </p>
                <p className="mt-1 text-sm text-ink-500">
                  Enter old phone details. Exchange value is deducted from the payable amount.
                </p>
              </div>
              <input
                type="checkbox"
                checked={isExchange}
                onChange={(e) => {
                  setIsExchange(e.target.checked);
                  if (!e.target.checked) {
                    setExchangeModel("");
                    setExchangeImei1("");
                    setExchangeSerial("");
                    setExchangeValue("");
                    setExchangeNotes("");
                  }
                }}
                className="h-6 w-6 shrink-0 rounded border-ink-300 text-tide-600 focus:ring-tide-400"
              />
            </label>

            <AnimatePresence>
              {isExchange ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-5 grid gap-4 border-t border-ink-100 pt-5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="label required" htmlFor="exchangeModel">
                        Exchange mobile model
                      </label>
                      <input
                        id="exchangeModel"
                        className="field"
                        value={exchangeModel}
                        onChange={(e) => setExchangeModel(e.target.value)}
                        placeholder="e.g. Redmi Note 10"
                        required={isExchange}
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="exchangeImei1">
                        IMEI
                      </label>
                      <input
                        id="exchangeImei1"
                        className="field font-mono"
                        value={exchangeImei1}
                        onChange={(e) => setExchangeImei1(e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div>
                      <label className="label" htmlFor="exchangeSerial">
                        Serial number
                      </label>
                      <input
                        id="exchangeSerial"
                        className="field font-mono"
                        value={exchangeSerial}
                        onChange={(e) => setExchangeSerial(e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div>
                      <label className="label required" htmlFor="exchangeValue">
                        Exchange value (₹)
                      </label>
                      <input
                        id="exchangeValue"
                        className="field"
                        type="number"
                        min={0}
                        step="0.01"
                        value={exchangeValue}
                        onChange={(e) =>
                          setExchangeValue(
                            e.target.value === ""
                              ? ""
                              : Number(e.target.value) || 0,
                          )
                        }
                        placeholder="Amount to deduct"
                        required={isExchange}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label" htmlFor="exchangeNotes">
                        Condition / notes
                      </label>
                      <textarea
                        id="exchangeNotes"
                        className="field min-h-[88px] resize-y"
                        value={exchangeNotes}
                        onChange={(e) => setExchangeNotes(e.target.value)}
                        placeholder="Optional — screen condition, box, etc."
                      />
                    </div>
                    <p className="sm:col-span-2 rounded-2xl bg-tide-100/60 px-4 py-3 text-xs text-tide-600">
                      Payable = bill total − exchange value. Payment split uses the payable amount.
                    </p>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="glass-panel p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-tide-600" />
              <h2 className="font-display text-lg font-semibold text-ink-900">
                Payment split
              </h2>
            </div>
            <p className="mb-5 text-sm text-ink-500">
              Tick each mode received and enter its amount.
            </p>

            <div className="space-y-3">
              <label
                htmlFor="hasDue"
                className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-orange-200 bg-orange-50/70 p-4"
              >
                <span>
                  <span className="block text-sm font-semibold text-ink-800">
                    This bill has due
                  </span>
                  <span className="mt-1 block text-xs text-ink-500">
                    Turn on to record any amount the customer will pay later.
                  </span>
                </span>
                <input
                  id="hasDue"
                  type="checkbox"
                  checked={hasDue}
                  onChange={(event) => setHasDue(event.target.checked)}
                  className="h-5 w-5 shrink-0 rounded border-ink-300 text-ember-500 focus:ring-orange-300"
                />
              </label>

              <PaymentToggle
                label="Cash"
                checked={useCash}
                amount={cashAmount}
                onChecked={(checked) => togglePayment("cash", checked)}
                onAmount={setCashAmount}
              />
              <PaymentToggle
                label="Online"
                checked={useOnline}
                amount={onlineAmount}
                onChecked={(checked) => togglePayment("online", checked)}
                onAmount={setOnlineAmount}
              />
              <PaymentToggle
                label="Finance"
                checked={useFinance}
                amount={financeAmount}
                onChecked={(checked) => togglePayment("finance", checked)}
                onAmount={setFinanceAmount}
              >
                <div className="space-y-3">
                  <div>
                    <label className="label required" htmlFor="financeCompany">
                      Finance company
                    </label>
                    <FinanceCompanyPicker
                      companies={financeCompanies}
                      value={financeSelect}
                      required={useFinance}
                      onChange={(value) => {
                        setFinanceSelect(value);
                        if (value === ADD_NEW_FINANCE) {
                          setFinanceCompanyId("");
                        } else {
                          setFinanceCompanyId(value);
                          setNewFinanceName("");
                        }
                      }}
                    />
                  </div>
                  {financeSelect === ADD_NEW_FINANCE ? (
                    <div>
                      <label className="label required" htmlFor="newFinanceName">
                        New finance company
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          id="newFinanceName"
                          className="field"
                          value={newFinanceName}
                          onChange={(e) => setNewFinanceName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void saveNewFinanceCompany();
                            }
                          }}
                          placeholder="e.g. HDFC Finance"
                          required={
                            useFinance && financeSelect === ADD_NEW_FINANCE
                          }
                        />
                        <button
                          type="button"
                          className="btn-secondary shrink-0"
                          disabled={savingFinance || !newFinanceName.trim()}
                          onClick={() => void saveNewFinanceCompany()}
                        >
                          {savingFinance ? "Saving…" : "Save for later"}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-ink-500">
                        Saved names stay in the list for all future bills.
                      </p>
                    </div>
                  ) : null}
                </div>
              </PaymentToggle>
            </div>

            <AnimatePresence>
              {hasDue ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="mt-5 rounded-2xl border border-orange-200 bg-orange-50/80 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-ember-500">
                      Remaining due
                    </p>
                    <p className="font-display text-xl font-semibold text-ember-500">
                      {formatINR(totals.dueAmount)}
                    </p>
                  </div>
                  {totals.dueAmount > 0 ? (
                    <>
                      <label className="label required mt-4" htmlFor="dueDate">
                        Expected collection date
                      </label>
                      <input
                        id="dueDate"
                        className="field"
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        required
                        aria-required="true"
                      />
                      {!dueDate ? (
                        <p className="mt-2 text-xs font-medium text-ember-500">
                          Required when due amount is pending
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-ink-500">
                      The selected payments currently cover the full payable
                      amount.
                    </p>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="glass-panel overflow-hidden p-5 sm:p-6">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Summary
            </h2>
            <dl className="mt-5 space-y-3 text-sm">
              <SummaryRow
                label="Taxable value"
                value={formatINR(totals.subtotal)}
              />
              <SummaryRow
                label="GST (included)"
                value={formatINR(totals.gstAmount)}
              />
              <SummaryRow
                label="Gross total"
                value={formatINR(totals.grandTotal)}
              />
              {totals.exchangeDeduction > 0 ? (
                <SummaryRow
                  label="Less: Exchange"
                  value={`- ${formatINR(totals.exchangeDeduction)}`}
                  accent
                />
              ) : null}
              <SummaryRow
                label="Payable"
                value={formatINR(totals.payableAmount)}
                strong
              />
              <div className="border-t border-ink-100 pt-3" />
              <SummaryRow label="Cash" value={formatINR(totals.cash)} />
              <SummaryRow label="Online" value={formatINR(totals.online)} />
              <SummaryRow
                label={
                  useFinance &&
                  (financeCompanies.find((c) => c.id === financeCompanyId)
                    ?.name ||
                    newFinanceName.trim())
                    ? `Finance · ${
                        financeCompanies.find((c) => c.id === financeCompanyId)
                          ?.name || newFinanceName.trim()
                      }`
                    : "Finance"
                }
                value={formatINR(totals.finance)}
              />
              {hasDue ? (
                <SummaryRow
                  label="Due"
                  value={formatINR(totals.dueAmount)}
                  accent={totals.dueAmount > 0}
                />
              ) : null}
            </dl>

            <div className="mt-5">
              <label className="label" htmlFor="notes">
                Notes
              </label>
              <textarea
                id="notes"
                className="field min-h-[88px] resize-y"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional note for this bill"
              />
            </div>

            {error ? (
              <p className="mt-4 rounded-2xl bg-orange-50 px-4 py-3 text-sm text-ember-500">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              className="btn-primary mt-6 w-full"
              disabled={saving}
            >
              {saving
                ? "Saving…"
                : isEdit
                  ? "Review & update"
                  : "Save bill"}
            </button>
          </div>
        </section>
      </form>

      <AnimatePresence>
        {addMobileForItem ? (
          <AddMobileModal
            onClose={() => setAddMobileForItem(null)}
            onCreated={(mobile) => {
              setMobileCatalog((previous) =>
                previous.some((entry) => entry.id === mobile.id)
                  ? previous
                  : [...previous, mobile].sort((a, b) =>
                      a.name.localeCompare(b.name),
                    ),
              );
              applyCatalogMobile(addMobileForItem, mobile);
              setAddMobileForItem(null);
            }}
          />
        ) : null}
      </AnimatePresence>

      {showSaveConfirm && saveSummary ? (
        <SaveBillConfirmModal
          summary={saveSummary}
          saving={saving}
          error={error}
          onCancel={() => {
            if (saving) return;
            setShowSaveConfirm(false);
            setPendingPayload(null);
            setSaveSummary(null);
            setError(null);
          }}
          onConfirm={() => void confirmCreate()}
        />
      ) : null}

      {showConfirm && originalBill ? (
        <BillChangeConfirmModal
          invoiceNumber={originalBill.invoiceNumber}
          changes={pendingDiff}
          saving={saving}
          error={error}
          onCancel={() => {
            if (saving) return;
            setShowConfirm(false);
            setPendingPayload(null);
            setPendingDiff([]);
            setError(null);
          }}
          onConfirm={() => void confirmUpdate()}
        />
      ) : null}
    </div>
  );
}

function PaymentToggle({
  label,
  checked,
  amount,
  onChecked,
  onAmount,
  children,
  showAmount = true,
}: {
  label: string;
  checked: boolean;
  amount: number;
  onChecked: (value: boolean) => void;
  onAmount: (value: number) => void;
  children?: ReactNode;
  showAmount?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white/70 p-4 transition hover:border-ink-300">
      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChecked(e.target.checked)}
          className="h-5 w-5 rounded border-ink-300 text-tide-600 focus:ring-tide-400"
        />
        <span className="text-sm font-semibold text-ink-800">{label}</span>
      </label>
      <AnimatePresence>
        {checked ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-3">
              {children}
              {showAmount ? (
                <div>
                  <label className="label required">Amount</label>
                  <input
                    className="field"
                    type="number"
                    min={0}
                    step="0.01"
                    value={amount || ""}
                    onChange={(e) => onAmount(Number(e.target.value) || 0)}
                    placeholder={`Amount paid by ${label.toLowerCase()}`}
                    required={checked}
                  />
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SummaryRow({
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
