import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  Check,
  Download,
  Info,
  ListOrdered,
  Loader2,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  UserRound,
} from "lucide-react";
import { AddMobileModal } from "../components/AddMobileModal";
import {
  ImeiScanFieldButton,
  SerialScanFieldButton,
  ScanFieldShell,
  scanFieldInputClass,
} from "../components/BarcodeImeiScanner";
import { BillChangeConfirmModal } from "../components/BillChangeConfirmModal";
import {
  SaveBillConfirmModal,
  type SaveBillSummary,
} from "../components/SaveBillConfirmModal";
import {
  ExchangeMobileFields,
  blankExchangeItem,
  exchangeTotalValue,
  type ExchangeDraft,
} from "../components/ExchangeMobileFields";
import { BackLink, PageHeader, LoadingBlock } from "../components/ui";
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
import { ApiError, api, formatFinanceCompanies, formatINR, round2 } from "../lib/api";
import { isShareAbort, shareInvoicePdf } from "../lib/shareInvoice";
import { billsHomePath, readFromState } from "../lib/navMemory";
import type {
  Bill,
  BillItem,
  CreateBillPayload,
  FinanceCompany,
  MobileCatalog,
  StockItem,
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
  stockItemId: null,
  platform: null,
  color: "",
  storage: "",
  ram: "",
  condition: null,
  quantity: 1,
  rate: 0,
  gstPercent: 0,
  imei1: "",
  serialNumber: "",
  warrantyMonths: undefined,
});

const STOCK_AVATAR_COLORS: Record<string, { bg: string; fg: string }> = {
  Apple: { bg: "#EEF0F4", fg: "#1B2740" },
  Oppo: { bg: "#E7F8F1", fg: "#0E9E76" },
  Samsung: { bg: "#E8F0FE", fg: "#2563EB" },
  Redmi: { bg: "#FEECEC", fg: "#D64545" },
  Xiaomi: { bg: "#FEECEC", fg: "#D64545" },
  Vivo: { bg: "#EEF0FE", fg: "#4338CA" },
  Realme: { bg: "#FEF3E2", fg: "#B76E00" },
  OnePlus: { bg: "#FEECEC", fg: "#B91C1C" },
};

function stockBrandKey(mobileName: string, platform?: string | null) {
  if (platform === "ACCESSORY") return "Acc";
  if (platform === "IOS" || /^iphone/i.test(mobileName)) return "Apple";
  const first = mobileName.trim().split(/\s+/)[0] || "?";
  return first;
}

function isAccessoryStock(stock: {
  kind?: string | null;
  platform?: string | null;
}) {
  return stock.kind === "ACCESSORY" || stock.platform === "ACCESSORY";
}

function isAccessoryDraft(item: { platform?: string | null }) {
  return item.platform === "ACCESSORY";
}

function stockAvatar(mobileName: string, platform?: string | null) {
  const brand = stockBrandKey(mobileName, platform);
  const colors = STOCK_AVATAR_COLORS[brand] || {
    bg: "#EEF2F8",
    fg: "#3A4658",
  };
  return {
    letter: brand.charAt(0).toUpperCase(),
    bg: colors.bg,
    fg: colors.fg,
  };
}

function formatStockOption(stock: {
  mobileName: string;
  color: string;
  storage: string;
  ram: string;
  imei: string | null;
  serialNumber?: string | null;
  platform?: string | null;
  kind?: string | null;
}) {
  const accessory = isAccessoryStock(stock);
  const ramLabel = (() => {
    if (accessory || !stock.ram) return null;
    const capacity = stock.ram.replace(/\s*gb\s*$/i, "").trim();
    return /^\d+$/.test(capacity)
      ? `${capacity} GB RAM`
      : `${stock.ram} RAM`;
  })();

  const idParts = [
    stock.imei ? `IMEI ${stock.imei}` : null,
    stock.serialNumber ? `SN ${stock.serialNumber}` : null,
  ].filter(Boolean);

  return {
    label: accessory
      ? stock.mobileName
      : [stock.mobileName, stock.color, stock.storage, ramLabel]
          .filter(Boolean)
          .join(" · "),
    description: idParts.length ? idParts.join(" · ") : undefined,
    avatar: stockAvatar(stock.mobileName, stock.platform),
  };
}

type FinanceDraft = {
  key: string;
  select: string;
  companyId: string;
  newName: string;
  amount: number;
};

const blankFinanceEntry = (amount = 0): FinanceDraft => ({
  key: crypto.randomUUID(),
  select: "",
  companyId: "",
  newName: "",
  amount,
});

const MAX_FINANCE_ENTRIES = 2;
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

/** True when an item has enough info to allow adding another row. */
function isDraftItemReady(item: DraftItem, withGst: boolean) {
  if (!item.quantity || item.quantity < 1) return false;
  if (!item.rate || item.rate <= 0) return false;
  if (withGst && (!item.gstPercent || item.gstPercent <= 0)) return false;

  if (item.catalogMode === "other") {
    return Boolean(item.productName.trim());
  }

  if (withGst) {
    if (isAccessoryDraft(item)) {
      return Boolean(item.productName.trim());
    }
    return Boolean(
      item.mobileCatalogId ||
        (item.productName.trim() &&
          item.platform &&
          item.color?.trim() &&
          item.storage?.trim() &&
          (item.platform !== "ANDROID" || Boolean(item.ram?.trim()))),
    );
  }

  return Boolean(item.stockItemId && stockDetailsComplete(item));
}

function stockDetailsComplete(item: DraftItem) {
  if (!item.productName.trim()) return false;
  if (isAccessoryDraft(item)) {
    return Boolean(item.serialNumber?.trim() || item.imei1?.trim());
  }
  return Boolean(
    item.platform &&
      item.color?.trim() &&
      item.storage?.trim() &&
      (item.platform !== "ANDROID" || Boolean(item.ram?.trim())),
  );
}

function firstIncompleteDraftFieldId(item: DraftItem, withGst: boolean) {
  if (item.catalogMode === "other") {
    if (!item.productName.trim()) return `productName-${item.key}`;
  } else if (withGst) {
    const phoneOk = Boolean(
      item.mobileCatalogId ||
        (item.productName.trim() &&
          item.platform &&
          item.color?.trim() &&
          item.storage?.trim() &&
          (item.platform !== "ANDROID" || Boolean(item.ram?.trim()))),
    );
    if (!phoneOk) return `phone-${item.key}`;
  } else if (!item.stockItemId) {
    return `phone-${item.key}`;
  }

  if (!item.quantity || item.quantity < 1) return `qty-${item.key}`;
  if (!item.rate || item.rate <= 0) return `rate-${item.key}`;
  if (withGst && (!item.gstPercent || item.gstPercent <= 0)) {
    return `gstPercent-${item.key}`;
  }
  return `item-${item.key}`;
}

function incompleteDraftHint(item: DraftItem, withGst: boolean) {
  const fieldId = firstIncompleteDraftFieldId(item, withGst);
  if (fieldId.startsWith("phone-")) {
    return withGst
      ? "Select a phone (or Other product) first"
      : "Select a phone from stock first";
  }
  if (fieldId.startsWith("productName-")) return "Enter the product name";
  if (fieldId.startsWith("qty-")) return "Enter quantity";
  if (fieldId.startsWith("rate-")) return "Enter the rate";
  if (fieldId.startsWith("gstPercent-")) return "Enter GST %";
  return "Complete this item first";
}

function focusDraftItemField(item: DraftItem, withGst: boolean) {
  const id = firstIncompleteDraftFieldId(item, withGst);
  const el = document.getElementById(id);
  if (!el) return id;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const target =
    el instanceof HTMLElement
      ? el.matches("input,button,textarea,select")
        ? el
        : el.querySelector<HTMLElement>("button, input, textarea, select")
      : null;
  target?.focus();
  if (target instanceof HTMLInputElement) target.select?.();
  return id;
}

function todayDateInput() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toDateInputValue(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return todayDateInput();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function CreateBillPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = readFromState(location.state);
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
  const [fetchingCustomer, setFetchingCustomer] = useState(false);
  const customerLookupAbortRef = useRef<AbortController | null>(null);
  const lastCustomerLookupPhoneRef = useRef("");
  const [notes, setNotes] = useState("");
  const [withGst, setWithGst] = useState(false);
  const [useCompanyCashback, setUseCompanyCashback] = useState(false);
  const [companyDiscount, setCompanyDiscount] = useState<number | "">("");
  const [useCustomBillDate, setUseCustomBillDate] = useState(false);
  const [customBillDate, setCustomBillDate] = useState(todayDateInput());
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [isExchange, setIsExchange] = useState(false);
  const [exchangeItems, setExchangeItems] = useState<ExchangeDraft[]>([]);
  const [exchangePayConfirmed, setExchangePayConfirmed] = useState(false);
  const [useFixedReturn, setUseFixedReturn] = useState(false);
  const [fixedReturnAmount, setFixedReturnAmount] = useState(0);

  function clearExchangeFields() {
    setExchangeItems([]);
    setExchangePayConfirmed(false);
    setUseFixedReturn(false);
    setFixedReturnAmount(0);
  }

  function billToExchangeDrafts(bill: Bill): ExchangeDraft[] {
    if (bill.exchangeItems?.length) {
      return bill.exchangeItems.map((item) => ({
        key: crypto.randomUUID(),
        platform: item.platform === "ANDROID" ? "ANDROID" : "IOS",
        model: item.model,
        color: item.color,
        storage: item.storage,
        ram: item.ram || "",
        imei1: item.imei1,
        value: item.value,
        notes: item.notes || "",
      }));
    }
    if (bill.isExchange && bill.exchangeModel) {
      return [
        {
          key: crypto.randomUUID(),
          platform: bill.exchangePlatform === "ANDROID" ? "ANDROID" : "IOS",
          model: bill.exchangeModel,
          color: bill.exchangeColor || "",
          storage: bill.exchangeStorage || "",
          ram: bill.exchangeRam || "",
          imei1: bill.exchangeImei1 || "",
          value: bill.exchangeValue ?? "",
          notes: bill.exchangeNotes || "",
        },
      ];
    }
    return [blankExchangeItem()];
  }

  function updateExchangeItem(key: string, patch: Partial<ExchangeDraft>) {
    setExchangeItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }
  const [useCash, setUseCash] = useState(false);
  const [useOnline, setUseOnline] = useState(false);
  const [useCard, setUseCard] = useState(false);
  const [useFinance, setUseFinance] = useState(false);
  const [hasDue, setHasDue] = useState(false);
  const [dueFollowsRemaining, setDueFollowsRemaining] = useState(true);
  const [cashAmount, setCashAmount] = useState(0);
  const [onlineAmount, setOnlineAmount] = useState(0);
  const [cardAmount, setCardAmount] = useState(0);
  const [dueEntry, setDueEntry] = useState(0);
  const [financeEntries, setFinanceEntries] = useState<FinanceDraft[]>([
    blankFinanceEntry(),
  ]);
  const [financeCompanies, setFinanceCompanies] = useState<FinanceCompany[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [mobileCatalog, setMobileCatalog] = useState<MobileCatalog[]>([]);
  const [addMobileForItem, setAddMobileForItem] = useState<string | null>(null);
  const [stockImeiLookup, setStockImeiLookup] = useState<{
    itemKey: string;
    imei: string;
  } | null>(null);
  const stockImeiLookupAbortRef = useRef<AbortController | null>(null);
  const serialLookupTimerRef = useRef<Record<string, number>>({});
  const [imeiFieldErrors, setImeiFieldErrors] = useState<
    Record<string, string>
  >({});
  const [serialFieldErrors, setSerialFieldErrors] = useState<
    Record<string, string>
  >({});
  const [savingFinanceKey, setSavingFinanceKey] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldHint, setFieldHint] = useState<{
    fieldId: string;
    message: string;
  } | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [successInvoice, setSuccessInvoice] = useState<string | null>(null);
  const [successPayment, setSuccessPayment] = useState<{
    withGst: boolean;
    payableAmount: number;
    payCustomerAmount: number;
    cashAmount: number;
    onlineAmount: number;
    cardAmount: number;
    financeAmount: number;
    financeLabel: string;
    dueAmount: number;
    dueDate: string | null;
  } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  function captureSuccessPayment(bill: Bill) {
    const exchangeVal = bill.isExchange ? Number(bill.exchangeValue || 0) : 0;
    const cashReturn = bill.isExchange
      ? Math.min(Math.max(Number(bill.exchangeCashReturn || 0) || 0, 0), exchangeVal)
      : 0;
    const credit = Math.max(exchangeVal - cashReturn, 0);
    const grand = Number(bill.grandTotal || 0);
    const payCustomerAmount = round2(
      cashReturn + Math.max(credit - grand, 0),
    );
    setSuccessPayment({
      withGst: Boolean(bill.withGst),
      payableAmount: bill.withGst
        ? bill.grandTotal
        : (bill.payableAmount ?? bill.grandTotal),
      payCustomerAmount,
      cashAmount: bill.cashAmount || 0,
      onlineAmount: bill.onlineAmount || 0,
      cardAmount: bill.cardAmount || 0,
      financeAmount: (bill.financeAmount || 0) + (bill.financeAmount2 || 0),
      financeLabel: formatFinanceCompanies(
        bill.financeCompanyName,
        bill.financeCompanyName2,
      ),
      dueAmount: bill.dueAmount || 0,
      dueDate: bill.dueDate
        ? bill.dueDate.slice(0, 10).split("-").reverse().join("/")
        : null,
    });
  }

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
    lastCustomerLookupPhoneRef.current = "";
    setPhoneError(null);
    setCustomerAddress("");
    setNotes("");
    setWithGst(false);
    setUseCompanyCashback(false);
    setCompanyDiscount("");
    setUseCustomBillDate(false);
    setCustomBillDate(todayDateInput());
    setItems([blankItem()]);
    setIsExchange(false);
    clearExchangeFields();
    setUseCash(false);
    setUseOnline(false);
    setUseCard(false);
    setUseFinance(false);
    setHasDue(false);
    setDueFollowsRemaining(true);
    setCashAmount(0);
    setOnlineAmount(0);
    setCardAmount(0);
    setDueEntry(0);
    setFinanceEntries([blankFinanceEntry()]);
    setDueDate("");
    setSaving(false);
    setError(null);
    setFieldHint(null);
    setSuccessId(null);
    setSuccessInvoice(null);
    setSuccessPayment(null);
    setShareError(null);
    setSharing(false);
    setLoadingBill(false);
  }

  function applyBillToForm(bill: Bill) {
    setOriginalBill(bill);
    setCustomerName(bill.customerName);
    setCustomerPhone(bill.customerPhone.replace(/\D/g, "").slice(0, 10));
    lastCustomerLookupPhoneRef.current = bill.customerPhone
      .replace(/\D/g, "")
      .slice(0, 10);
    setCustomerAddress(bill.customerAddress || "");
    setNotes(bill.notes || "");
    setWithGst(Boolean(bill.withGst));
    setUseCompanyCashback(
      !bill.withGst && Boolean(bill.companyDiscount && bill.companyDiscount > 0),
    );
    setCompanyDiscount(
      bill.companyDiscount && bill.companyDiscount > 0 ? bill.companyDiscount : "",
    );
    setUseCustomBillDate(true);
    setCustomBillDate(toDateInputValue(bill.billDate));
    setItems(
      bill.items.length
        ? bill.items.map((item) => ({
            key: crypto.randomUUID(),
            catalogMode:
              item.stockItemId || item.mobileCatalogId || item.platform
                ? "mobile"
                : "other",
            productName: item.productName,
            mobileCatalogId: item.mobileCatalogId || null,
            stockItemId: item.stockItemId || null,
            platform: item.platform || null,
            color: item.color || "",
            storage: item.storage || "",
            ram: item.ram || "",
            condition: item.condition || null,
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
    setExchangeItems(
      bill.isExchange ? billToExchangeDrafts(bill) : [],
    );
    {
      const cashReturn = round2(Math.max(bill.exchangeCashReturn || 0, 0));
      setUseFixedReturn(cashReturn > 0);
      setFixedReturnAmount(cashReturn);
    }
    setExchangePayConfirmed(
      Boolean(
        bill.isExchange &&
          (bill.exchangeValue || 0) - (bill.exchangeCashReturn || 0) >
            (bill.grandTotal || 0),
      ),
    );
    setUseCash(bill.cashAmount > 0);
    setUseOnline(bill.onlineAmount > 0);
    setUseCard((bill.cardAmount || 0) > 0);
    setUseFinance(bill.financeAmount > 0);
    setHasDue(bill.dueAmount > 0);
    setDueFollowsRemaining(
      bill.dueAmount > 0 &&
        (bill.financeAmount || 0) + (bill.financeAmount2 || 0) <= 0,
    );
    setCashAmount(bill.cashAmount);
    setOnlineAmount(bill.onlineAmount);
    setCardAmount(bill.cardAmount || 0);
    setDueEntry(bill.dueAmount > 0 ? bill.dueAmount : 0);
    {
      const secondAmount = bill.financeAmount2 || 0;
      const firstAmount = round2(Math.max(bill.financeAmount - secondAmount, 0));
      const entries: FinanceDraft[] = [
        {
          key: crypto.randomUUID(),
          select: bill.financeCompanyId || "",
          companyId: bill.financeCompanyId || "",
          newName: "",
          amount: firstAmount,
        },
      ];
      if (secondAmount > 0 || bill.financeCompanyId2 || bill.financeCompanyName2) {
        entries.push({
          key: crypto.randomUUID(),
          select: bill.financeCompanyId2 || "",
          companyId: bill.financeCompanyId2 || "",
          newName: "",
          amount: secondAmount,
        });
      }
      setFinanceEntries(entries);
    }
    setDueDate(bill.dueDate ? bill.dueDate.slice(0, 10) : "");
    setSuccessId(null);
    setSuccessInvoice(null);
    setSuccessPayment(null);
    setShareError(null);
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
    const exchangeGross = isExchange
      ? round2(exchangeTotalValue(exchangeItems))
      : 0;
    const cashReturn = isExchange && useFixedReturn
      ? round2(Math.min(Math.max(fixedReturnAmount || 0, 0), exchangeGross))
      : 0;
    const exchangeDeduction = round2(Math.max(exchangeGross - cashReturn, 0));
    const payableAmount = round2(Math.max(grandTotal - exchangeDeduction, 0));
    const excessRefund = round2(Math.max(exchangeDeduction - grandTotal, 0));
    const exchangeRefund = round2(cashReturn + excessRefund);
    const cash = useCash ? cashAmount : 0;
    const online = useOnline ? onlineAmount : 0;
    const card = useCard ? cardAmount : 0;
    const remainingAfterCashOnline = round2(
      Math.max(payableAmount - cash - online - card, 0),
    );
    const enteredDue = hasDue
      ? round2(Math.min(Math.max(dueEntry || 0, 0), remainingAfterCashOnline))
      : 0;
    const financeFromEntries = useFinance
      ? round2(financeEntries.reduce((sum, entry) => sum + (entry.amount || 0), 0))
      : 0;
    const finance = hasDue
      ? dueFollowsRemaining || enteredDue <= 0
        ? 0
        : round2(Math.max(remainingAfterCashOnline - enteredDue, 0))
      : financeFromEntries;
    const paid = round2(cash + online + card + finance);
    const dueAmount = hasDue
      ? dueFollowsRemaining || enteredDue <= 0
        ? remainingAfterCashOnline
        : enteredDue
      : round2(Math.max(payableAmount - paid, 0));
    const companyDiscountAmount =
      withGst || !useCompanyCashback || companyDiscount === ""
        ? 0
        : round2(Number(companyDiscount) || 0);
    const effectiveSelling = round2(payableAmount + companyDiscountAmount);
    return {
      subtotal,
      gstAmount,
      grandTotal,
      exchangeDeduction,
      exchangeGross,
      cashReturn,
      exchangeRefund,
      payableAmount,
      companyDiscountAmount,
      effectiveSelling,
      paid,
      dueAmount,
      cash,
      online,
      card,
      finance,
    };
  }, [
    items,
    isExchange,
    exchangeItems,
    useFixedReturn,
    fixedReturnAmount,
    withGst,
    useCompanyCashback,
    companyDiscount,
    useCash,
    useOnline,
    useCard,
    useFinance,
    hasDue,
    dueFollowsRemaining,
    dueEntry,
    cashAmount,
    onlineAmount,
    cardAmount,
    financeEntries,
  ]);

  const stockOptions = useMemo(() => {
    const mobiles = stockItems.filter((stock) => !isAccessoryStock(stock));
    const accessories = stockItems.filter((stock) => isAccessoryStock(stock));

    const mapOption = (stock: StockItem) => {
      const accessory = isAccessoryStock(stock);
      const isUsed = stock.condition === "USED";
      const formatted = formatStockOption(stock);
      return {
        value: stock.id,
        label: formatted.label,
        description: formatted.description,
        avatar: formatted.avatar,
        badge: accessory ? "Acc" : isUsed ? "Old" : "New",
        badgeTone: (isUsed && !accessory ? "old" : "new") as "old" | "new",
        condition: stock.condition as "USED" | "NEW",
      };
    };

    const fromStock = [...mobiles.map(mapOption), ...accessories.map(mapOption)];

    // Keep currently selected sold/legacy units visible while editing
    for (const item of items) {
      if (
        item.catalogMode !== "mobile" ||
        !item.stockItemId ||
        stockItems.some((stock) => stock.id === item.stockItemId)
      ) {
        continue;
      }
      const accessory = isAccessoryDraft(item);
      const isUsed = (item.condition || "NEW") === "USED";
      const formatted = formatStockOption({
        mobileName: item.productName,
        color: item.color || "",
        storage: item.storage || "",
        ram: item.ram || "",
        imei: item.imei1 || "",
        serialNumber: item.serialNumber || "",
        platform: item.platform,
        kind: accessory ? "ACCESSORY" : "MOBILE",
      });
      fromStock.push({
        value: item.stockItemId,
        label: formatted.label,
        description: formatted.description,
        avatar: formatted.avatar,
        badge: accessory ? "Acc" : isUsed ? "Old" : "New",
        badgeTone: (isUsed && !accessory ? "old" : "new") as "old" | "new",
        condition: (isUsed ? "USED" : "NEW") as "USED" | "NEW",
      });
    }

    return [
      ...fromStock,
      { value: "__other__", label: "Other product / accessory" },
    ];
  }, [stockItems, items]);

  const catalogMobileOptions = useMemo(
    () => [
      ...mobileCatalog.map((mobile) => {
        const isUsed = (mobile.condition || "NEW") === "USED";
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
            .join(" · "),
          avatar: stockAvatar(mobile.name, mobile.platform),
          badge: isUsed ? "Old" : "New",
          badgeTone: (isUsed ? "old" : "new") as "old" | "new",
          condition: (isUsed ? "USED" : "NEW") as "USED" | "NEW",
        };
      }),
      { value: "__other__", label: "Other product / accessory" },
    ],
    [mobileCatalog],
  );

  function stockOptionsForItem(itemKey: string) {
    const selectedElsewhere = new Set(
      items
        .filter((row) => row.key !== itemKey && row.stockItemId)
        .map((row) => row.stockItemId as string),
    );
    return stockOptions.filter(
      (option) =>
        option.value === "__other__" || !selectedElsewhere.has(option.value),
    );
  }

  useEffect(() => {
    if (!useFixedReturn) return;
    const gross = exchangeTotalValue(exchangeItems);
    if (fixedReturnAmount > gross) {
      setFixedReturnAmount(round2(gross));
    }
  }, [useFixedReturn, exchangeItems, fixedReturnAmount]);

  useEffect(() => {
    if (!hasDue || totals.dueAmount <= 0) setDueDate("");
  }, [hasDue, totals.dueAmount]);

  useEffect(() => {
    if (!hasDue) return;
    const remaining = round2(
      Math.max(
        totals.payableAmount -
          (useCash ? cashAmount : 0) -
          (useOnline ? onlineAmount : 0) -
          (useCard ? cardAmount : 0),
        0,
      ),
    );
    if (dueFollowsRemaining) {
      if (dueEntry !== remaining) setDueEntry(remaining);
      return;
    }
    if (dueEntry > remaining) setDueEntry(remaining);
  }, [
    hasDue,
    dueFollowsRemaining,
    dueEntry,
    totals.payableAmount,
    useCash,
    cashAmount,
    useOnline,
    onlineAmount,
    useCard,
    cardAmount,
  ]);

  useEffect(() => {
    if (totals.payableAmount <= 0 && totals.exchangeRefund > 0) {
      setUseCash(false);
      setUseOnline(false);
      setUseCard(false);
      setUseFinance(false);
      setHasDue(false);
      setDueFollowsRemaining(true);
      setCashAmount(0);
      setOnlineAmount(0);
      setCardAmount(0);
      setDueEntry(0);
      setFinanceEntries([blankFinanceEntry()]);
      return;
    }
    setExchangePayConfirmed(false);
    setFieldHint((current) =>
      current?.fieldId === "exchange-pay-confirm-btn" ? null : current,
    );
  }, [totals.exchangeRefund, totals.payableAmount]);

  useEffect(() => {
    if (!fieldHint) return;
    const timer = window.setTimeout(() => setFieldHint(null), 3500);
    return () => window.clearTimeout(timer);
  }, [fieldHint]);

  // Autofill name/address from latest bill when phone is complete (indexed lookup).
  useEffect(() => {
    if (customerPhone.length !== 10) {
      lastCustomerLookupPhoneRef.current = "";
      setFetchingCustomer(false);
      if (!customerPhone) {
        setCustomerName("");
        setCustomerAddress("");
      }
      return;
    }
    if (lastCustomerLookupPhoneRef.current === customerPhone) return;

    customerLookupAbortRef.current?.abort();
    const controller = new AbortController();
    customerLookupAbortRef.current = controller;
    const phone = customerPhone;
    setFetchingCustomer(true);

    const timeoutId = window.setTimeout(() => {
      controller.abort();
      setFetchingCustomer(false);
      // Mark as attempted so we don't keep retrying this number
      lastCustomerLookupPhoneRef.current = phone;
    }, 3000);

    void (async () => {
      try {
        const { data } = await api.lookupCustomerByPhone(phone, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        window.clearTimeout(timeoutId);
        lastCustomerLookupPhoneRef.current = phone;
        if (data) {
          setCustomerName(data.customerName);
          setCustomerAddress(data.customerAddress || "");
        } else {
          // New number with no past bill — clear previous autofill
          setCustomerName("");
          setCustomerAddress("");
        }
      } catch {
        // Ignore abort / network / timeout — user can type manually
      } finally {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted) {
          setFetchingCustomer(false);
        }
      }
    })();

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
      setFetchingCustomer(false);
    };
  }, [customerPhone]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [financeResult, stockResult, mobileResult] = await Promise.allSettled([
        api.listFinanceCompanies(),
        api.listStock(undefined, undefined, "ALL"),
        api.listMobileCatalog(),
      ]);
      if (!active) return;
      if (financeResult.status === "fulfilled") {
        setFinanceCompanies(financeResult.value.data);
      }
      if (stockResult.status === "fulfilled") {
        setStockItems(stockResult.value.data);
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
    return () => {
      stockImeiLookupAbortRef.current?.abort();
      for (const timer of Object.values(serialLookupTimerRef.current)) {
        window.clearTimeout(timer);
      }
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
        const keepIds = data.items
          .map((item) => item.stockItemId)
          .filter((id): id is string => Boolean(id));
        if (keepIds.length) {
          const stockResult = await api.listStock(undefined, keepIds, "ALL");
          if (active) setStockItems(stockResult.data);
        }
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

  function resetFinanceEntries() {
    setFinanceEntries([blankFinanceEntry()]);
  }

  function updateFinanceEntry(key: string, patch: Partial<FinanceDraft>) {
    setFinanceEntries((prev) =>
      prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    );
  }

  async function saveNewFinanceCompany(entryKey: string) {
    const entry = financeEntries.find((e) => e.key === entryKey);
    const name = entry?.newName.trim() || "";
    if (!name) {
      setError("Enter a finance company name");
      return null;
    }

    setSavingFinanceKey(entryKey);
    setError(null);
    try {
      const { data } = await api.createFinanceCompany(name);
      setFinanceCompanies((prev) =>
        prev.some((c) => c.id === data.id)
          ? prev
          : [...prev, data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      updateFinanceEntry(entryKey, {
        select: data.id,
        companyId: data.id,
        newName: "",
      });
      return data;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save finance company",
      );
      return null;
    } finally {
      setSavingFinanceKey(null);
    }
  }

  function remainingAfterPayments(financeSoFar = 0) {
    const dueSlice = hasDue
      ? dueFollowsRemaining || dueEntry <= 0
        ? round2(
            Math.max(
              totals.payableAmount -
                (useCash ? cashAmount : 0) -
                (useOnline ? onlineAmount : 0) -
                (useCard ? cardAmount : 0),
              0,
            ),
          )
        : dueEntry
      : 0;
    return round2(
      Math.max(
        totals.payableAmount -
          (useCash ? cashAmount : 0) -
          (useOnline ? onlineAmount : 0) -
          (useCard ? cardAmount : 0) -
          dueSlice -
          financeSoFar,
        0,
      ),
    );
  }

  function addFinanceEntry() {
    setFinanceEntries((prev) => {
      if (prev.length >= MAX_FINANCE_ENTRIES) return prev;
      const used = prev.reduce((sum, e) => sum + (e.amount || 0), 0);
      const remaining = remainingAfterPayments(used);
      if (remaining <= 0) return prev;
      return [...prev, blankFinanceEntry(remaining)];
    });
  }

  function removeFinanceEntry(key: string) {
    setFinanceEntries((prev) => {
      const next = prev.filter((entry) => entry.key !== key);
      return next.length ? next : [blankFinanceEntry()];
    });
  }

  function remainingForMode(mode: "cash" | "online" | "card" | "finance") {
    const cash = mode === "cash" ? 0 : useCash ? cashAmount : 0;
    const online = mode === "online" ? 0 : useOnline ? onlineAmount : 0;
    const card = mode === "card" ? 0 : useCard ? cardAmount : 0;
    const dueSlice =
      hasDue && !dueFollowsRemaining && dueEntry > 0 ? dueEntry : 0;
    const finance =
      hasDue || mode === "finance"
        ? 0
        : useFinance
          ? financeEntries.reduce((sum, entry) => sum + (entry.amount || 0), 0)
          : 0;
    return round2(
      Math.max(
        totals.payableAmount - cash - online - card - dueSlice - finance,
        0,
      ),
    );
  }

  function toggleHasDue(on: boolean) {
    setHasDue(on);
    setDueFollowsRemaining(true);
    if (on) {
      const remaining = round2(
        Math.max(
          totals.payableAmount -
            (useCash ? cashAmount : 0) -
            (useOnline ? onlineAmount : 0) -
            (useCard ? cardAmount : 0),
          0,
        ),
      );
      setDueEntry(remaining);
      setUseFinance(false);
      resetFinanceEntries();
    } else {
      setDueEntry(0);
    }
  }

  useEffect(() => {
    if (!hasDue || dueEntry <= 0) return;
    const leftover = totals.finance;
    if (leftover > 0) {
      setUseFinance(true);
      setFinanceEntries((prev) => {
        if (prev.length <= 1) {
          const entry = prev[0] ?? blankFinanceEntry();
          if (entry.amount === leftover) return prev;
          return [{ ...entry, amount: leftover }];
        }
        const others = prev
          .slice(0, -1)
          .reduce((sum, entry) => sum + (entry.amount || 0), 0);
        const lastAmount = round2(Math.max(leftover - others, 0));
        const last = prev[prev.length - 1];
        if (last.amount === lastAmount) return prev;
        return [...prev.slice(0, -1), { ...last, amount: lastAmount }];
      });
      return;
    }
    setUseFinance(false);
    setFinanceEntries((prev) => {
      if (prev.length === 1 && prev[0].amount === 0 && !prev[0].select) {
        return prev;
      }
      return [blankFinanceEntry()];
    });
  }, [hasDue, dueEntry, totals.finance]);

  function togglePayment(
    mode: "cash" | "online" | "card" | "finance",
    checked: boolean,
  ) {
    if (mode === "cash") {
      setUseCash(checked);
      if (!checked) setCashAmount(0);
      else setCashAmount(remainingForMode("cash"));
    }
    if (mode === "online") {
      setUseOnline(checked);
      if (!checked) setOnlineAmount(0);
      else setOnlineAmount(remainingForMode("online"));
    }
    if (mode === "card") {
      setUseCard(checked);
      if (!checked) setCardAmount(0);
      else setCardAmount(remainingForMode("card"));
    }
    if (mode === "finance") {
      setUseFinance(checked);
      if (!checked) {
        resetFinanceEntries();
      } else {
        setFinanceEntries([blankFinanceEntry(remainingForMode("finance"))]);
      }
    }
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setFieldHint(null);
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  function applyCatalogMobile(key: string, mobile: MobileCatalog) {
    updateItem(key, {
      catalogMode: "mobile",
      stockItemId: null,
      mobileCatalogId: mobile.id,
      productName: mobile.name,
      platform: mobile.platform,
      color: mobile.color,
      storage: mobile.storage,
      ram: mobile.platform === "ANDROID" ? mobile.ram : "",
      condition: mobile.condition || "NEW",
      quantity: 1,
    });
  }

  function selectCatalogMobile(key: string, value: string) {
    if (!value) {
      updateItem(key, {
        catalogMode: "mobile",
        productName: "",
        mobileCatalogId: null,
        stockItemId: null,
        platform: null,
        color: "",
        storage: "",
        ram: "",
        condition: null,
        imei1: "",
        rate: 0,
      });
      return;
    }

    if (value === "__other__") {
      updateItem(key, {
        catalogMode: "other",
        productName: "",
        mobileCatalogId: null,
        stockItemId: null,
        platform: null,
        color: "",
        storage: "",
        ram: "",
        condition: null,
        imei1: "",
      });
      return;
    }

    const mobile = mobileCatalog.find((entry) => entry.id === value);
    if (!mobile) return;
    applyCatalogMobile(key, mobile);
  }

  function applyStockMobile(key: string, stock: StockItem) {
    const accessory = isAccessoryStock(stock);
    updateItem(key, {
      catalogMode: "mobile",
      stockItemId: stock.id,
      mobileCatalogId: null,
      productName: stock.mobileName,
      platform: accessory ? "ACCESSORY" : stock.platform,
      color: accessory ? "" : stock.color,
      storage: accessory ? "" : stock.storage,
      ram: !accessory && stock.platform === "ANDROID" ? stock.ram : "",
      condition: stock.condition || "NEW",
      imei1: stock.imei || "",
      serialNumber: stock.serialNumber || "",
      quantity: 1,
    });
  }

  function cancelStockImeiLookup() {
    stockImeiLookupAbortRef.current?.abort();
    stockImeiLookupAbortRef.current = null;
    setStockImeiLookup(null);
  }

  async function lookupStockFromImeiScan(itemKey: string, imei: string) {
    const cleaned = imei.replace(/\D/g, "");
    updateItem(itemKey, { imei1: cleaned });
    setImeiFieldErrors((prev) => {
      if (!prev[itemKey]) return prev;
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });

    if (withGst || cleaned.length < 8) return;

    stockImeiLookupAbortRef.current?.abort();
    const ac = new AbortController();
    stockImeiLookupAbortRef.current = ac;
    setStockImeiLookup({ itemKey, imei: cleaned });

    try {
      const { data: stock } = await api.findAvailableStockByImei(
        cleaned,
        ac.signal,
      );
      if (ac.signal.aborted) return;

      const usedElsewhere = items.some(
        (row) => row.key !== itemKey && row.stockItemId === stock.id,
      );
      if (usedElsewhere) {
        setImeiFieldErrors((prev) => ({
          ...prev,
          [itemKey]: "This unit is already added on another line",
        }));
        return;
      }

      setStockItems((prev) =>
        prev.some((entry) => entry.id === stock.id)
          ? prev
          : [stock, ...prev],
      );
      applyStockMobile(itemKey, stock);
      setImeiFieldErrors((prev) => {
        if (!prev[itemKey]) return prev;
        const next = { ...prev };
        delete next[itemKey];
        return next;
      });
      setSerialFieldErrors((prev) => {
        if (!prev[itemKey]) return prev;
        const next = { ...prev };
        delete next[itemKey];
        return next;
      });
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      const message =
        err instanceof ApiError && err.status === 404
          ? "No mobile found"
          : err instanceof Error
            ? err.message
            : "No mobile found";
      setImeiFieldErrors((prev) => ({ ...prev, [itemKey]: message }));
    } finally {
      if (stockImeiLookupAbortRef.current === ac) {
        stockImeiLookupAbortRef.current = null;
        setStockImeiLookup(null);
      }
    }
  }

  async function lookupStockFromSerial(
    itemKey: string,
    serial: string,
    options?: { fromScan?: boolean },
  ) {
    const cleaned = serial.replace(/\s+/g, "").trim();
    updateItem(itemKey, { serialNumber: cleaned });
    setSerialFieldErrors((prev) => {
      if (!prev[itemKey]) return prev;
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });

    if (withGst || cleaned.length < 3) return;

    const current = items.find((row) => row.key === itemKey);
    if (
      current?.stockItemId &&
      current.serialNumber?.replace(/\s+/g, "").trim() === cleaned
    ) {
      return;
    }

    stockImeiLookupAbortRef.current?.abort();
    const ac = new AbortController();
    stockImeiLookupAbortRef.current = ac;
    setStockImeiLookup({ itemKey, imei: cleaned });

    try {
      const { data: stock } = await api.findAvailableStockBySerial(
        cleaned,
        ac.signal,
      );
      if (ac.signal.aborted) return;

      const usedElsewhere = items.some(
        (row) => row.key !== itemKey && row.stockItemId === stock.id,
      );
      if (usedElsewhere) {
        setSerialFieldErrors((prev) => ({
          ...prev,
          [itemKey]: "This unit is already added on another line",
        }));
        return;
      }

      setStockItems((prev) =>
        prev.some((entry) => entry.id === stock.id)
          ? prev
          : [stock, ...prev],
      );
      applyStockMobile(itemKey, stock);
      setSerialFieldErrors((prev) => {
        if (!prev[itemKey]) return prev;
        const next = { ...prev };
        delete next[itemKey];
        return next;
      });
      setImeiFieldErrors((prev) => {
        if (!prev[itemKey]) return prev;
        const next = { ...prev };
        delete next[itemKey];
        return next;
      });
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }
      if (!options?.fromScan && cleaned.length < 5) {
        // Wait for a fuller serial before showing "not found" while typing.
        return;
      }
      const message =
        err instanceof ApiError && err.status === 404
          ? "No stock found for this serial"
          : err instanceof Error
            ? err.message
            : "No stock found for this serial";
      setSerialFieldErrors((prev) => ({ ...prev, [itemKey]: message }));
    } finally {
      if (stockImeiLookupAbortRef.current === ac) {
        stockImeiLookupAbortRef.current = null;
        setStockImeiLookup(null);
      }
    }
  }

  function scheduleSerialLookup(itemKey: string, serial: string) {
    window.clearTimeout(serialLookupTimerRef.current[itemKey]);
    const cleaned = serial.replace(/\s+/g, "").trim();
    if (cleaned.length < 3 || withGst) return;
    serialLookupTimerRef.current[itemKey] = window.setTimeout(() => {
      void lookupStockFromSerial(itemKey, cleaned);
    }, 450);
  }

  function selectMobile(key: string, value: string) {
    if (!value) {
      updateItem(key, {
        catalogMode: "mobile",
        productName: "",
        mobileCatalogId: null,
        stockItemId: null,
        platform: null,
        color: "",
        storage: "",
        ram: "",
        condition: null,
        imei1: "",
        serialNumber: "",
        rate: 0,
      });
      return;
    }

    if (value === "__other__") {
      updateItem(key, {
        catalogMode: "other",
        productName: "",
        mobileCatalogId: null,
        stockItemId: null,
        platform: null,
        color: "",
        storage: "",
        ram: "",
        condition: null,
        imei1: "",
        serialNumber: "",
      });
      return;
    }

    const stock = stockItems.find((entry) => entry.id === value);
    if (stock) {
      applyStockMobile(key, stock);
      return;
    }

    // Selected unit already on this bill while editing (sold status)
    const current = items.find((entry) => entry.key === key);
    if (current?.stockItemId === value) return;
  }

  async function buildPayload(): Promise<CreateBillPayload | null> {
    if (withGst) {
      return {
        customerName,
        customerPhone,
        customerAddress: customerAddress || null,
        notes: notes || null,
        billDate: useCustomBillDate ? customBillDate.trim() : null,
        withGst: true,
        useCash: false,
        useOnline: false,
        useCard: false,
        useFinance: false,
        cashAmount: 0,
        onlineAmount: 0,
        cardAmount: 0,
        financeAmount: 0,
        financeCompanyId: null,
        financeCompanyName: null,
        financeAmount2: 0,
        financeCompanyId2: null,
        financeCompanyName2: null,
        isExchange: false,
        exchangeModel: null,
        exchangePlatform: null,
        exchangeColor: null,
        exchangeStorage: null,
        exchangeRam: null,
        exchangeImei1: null,
        exchangeImei2: null,
        exchangeSerial: null,
        exchangeValue: null,
        exchangeCashReturn: 0,
        exchangeNotes: null,
        dueDate: null,
        companyDiscount: 0,
        items: items.map((item) => ({
          productName: item.productName,
          mobileCatalogId:
            item.catalogMode === "mobile" ? item.mobileCatalogId || null : null,
          // GST invoices never link stock units
          stockItemId: null,
          platform:
            item.catalogMode === "mobile" ? item.platform || null : null,
          color: item.catalogMode === "mobile" ? item.color || null : null,
          storage: item.catalogMode === "mobile" ? item.storage || null : null,
          ram:
            item.catalogMode === "mobile" && item.platform === "ANDROID"
              ? item.ram || null
              : null,
          condition:
            item.catalogMode === "mobile" ? item.condition || null : null,
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

    let resolvedCompanyId: string | null = null;
    let resolvedCompanyName: string | null = null;
    let resolvedCompanyId2: string | null = null;
    let resolvedCompanyName2: string | null = null;
    let financeAmount = 0;
    let financeAmount2 = 0;

    if (useFinance) {
      const activeEntries = financeEntries.filter(
        (entry) =>
          entry.select || entry.companyId || entry.newName.trim() || entry.amount > 0,
      );
      if (!activeEntries.length) {
        throw new Error("Select a finance company");
      }

      const resolved: Array<{ id: string | null; name: string | null; amount: number }> =
        [];

      for (const entry of activeEntries) {
        if (entry.amount <= 0) {
          throw new Error("Enter finance amount for each company");
        }
        if (entry.select === ADD_NEW_FINANCE) {
          const created = await saveNewFinanceCompany(entry.key);
        if (!created) return null;
          resolved.push({ id: created.id, name: created.name, amount: entry.amount });
        } else if (entry.companyId) {
          resolved.push({
            id: entry.companyId,
            name:
              financeCompanies.find((c) => c.id === entry.companyId)?.name || null,
            amount: entry.amount,
          });
      } else {
        throw new Error("Select a finance company");
        }
      }

      if (resolved.length > MAX_FINANCE_ENTRIES) {
        throw new Error("Maximum two finance companies allowed");
      }

      const ids = resolved.map((r) => r.id).filter(Boolean);
      if (new Set(ids).size !== ids.length) {
        throw new Error("Choose two different finance companies");
      }

      resolvedCompanyId = resolved[0]?.id || null;
      resolvedCompanyName = resolved[0]?.name || null;
      financeAmount = resolved[0]?.amount || 0;
      if (resolved[1]) {
        resolvedCompanyId2 = resolved[1].id;
        resolvedCompanyName2 = resolved[1].name;
        financeAmount2 = resolved[1].amount;
      }
    }

    return {
      customerName,
      customerPhone,
      customerAddress: customerAddress || null,
      notes: notes || null,
      billDate: useCustomBillDate ? customBillDate.trim() : null,
      withGst: false,
      useCash,
      useOnline,
      useCard,
      useFinance,
      cashAmount: useCash ? cashAmount : 0,
      onlineAmount: useOnline ? onlineAmount : 0,
      cardAmount: useCard ? cardAmount : 0,
      financeAmount: useFinance ? financeAmount : 0,
      financeCompanyId: useFinance ? resolvedCompanyId : null,
      financeCompanyName: useFinance ? resolvedCompanyName : null,
      financeAmount2: useFinance ? financeAmount2 : 0,
      financeCompanyId2: useFinance ? resolvedCompanyId2 : null,
      financeCompanyName2: useFinance ? resolvedCompanyName2 : null,
      isExchange,
      exchangeItems: isExchange
        ? exchangeItems.map((item) => ({
            model: item.model.trim(),
            platform: item.platform,
            color: item.color.trim(),
            storage: item.storage.trim(),
            ram:
              item.platform === "ANDROID" ? item.ram.trim() || null : null,
            imei1: item.imei1.trim(),
            value: item.value === "" ? 0 : Number(item.value) || 0,
            notes: item.notes.trim() || null,
          }))
        : [],
      exchangeModel: isExchange ? exchangeItems[0]?.model.trim() || null : null,
      exchangePlatform: isExchange ? exchangeItems[0]?.platform ?? null : null,
      exchangeColor: isExchange ? exchangeItems[0]?.color.trim() || null : null,
      exchangeStorage: isExchange
        ? exchangeItems[0]?.storage.trim() || null
        : null,
      exchangeRam:
        isExchange && exchangeItems[0]?.platform === "ANDROID"
          ? exchangeItems[0]?.ram.trim() || null
          : null,
      exchangeImei1: isExchange ? exchangeItems[0]?.imei1.trim() || null : null,
      exchangeImei2: null,
      exchangeSerial: null,
      exchangeValue: isExchange
        ? round2(exchangeTotalValue(exchangeItems))
        : null,
      exchangeCashReturn:
        isExchange && useFixedReturn ? totals.cashReturn : 0,
      exchangeNotes: isExchange
        ? exchangeItems[0]?.notes.trim() || null
        : null,
      dueDate: hasDue && totals.dueAmount > 0 ? dueDate.trim() : null,
      companyDiscount: totals.companyDiscountAmount,
      items: items.map((item) => ({
        productName: item.productName,
        mobileCatalogId:
          item.catalogMode === "mobile" ? item.mobileCatalogId || null : null,
        stockItemId:
          item.catalogMode === "mobile" ? item.stockItemId || null : null,
        platform:
          item.catalogMode === "other" ? null : item.platform || null,
        color: item.catalogMode === "other" ? null : item.color || null,
        storage: item.catalogMode === "other" ? null : item.storage || null,
        ram:
          item.catalogMode !== "other" && item.platform === "ANDROID"
            ? item.ram || null
            : null,
        condition:
          item.catalogMode === "other" ? null : item.condition || null,
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

    if (useCustomBillDate && !customBillDate.trim()) {
      setError("Select a custom bill date");
      document.getElementById("customBillDate")?.focus();
      return;
    }

    const incompleteMobile = items.find((item) => {
      if (item.catalogMode !== "mobile") return false;
      const detailsComplete = stockDetailsComplete(item);

      if (withGst) {
        if (isAccessoryDraft(item)) return !detailsComplete;
        return !(item.mobileCatalogId || detailsComplete);
      }

      if (item.stockItemId) return !detailsComplete;
      // Older bills may not have a stock link yet
      if (isEdit && detailsComplete) return false;
      return true;
    });
    if (incompleteMobile) {
      setError(
        withGst
          ? "Select a phone from the list or use Add new mobile. Accessories can use Other product."
          : "Select a phone or accessory from stock (add units under Stock first).",
      );
      return;
    }

    if (withGst) {
      const missingGst = items.find(
        (item) => !item.gstPercent || item.gstPercent <= 0,
      );
      if (missingGst) {
        setError("Enter GST % for every item when generating a GST bill.");
        const field = document.getElementById(`gstPercent-${missingGst.key}`);
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
        field?.focus();
        return;
      }
    }

    if (
      !withGst &&
      totals.payableAmount <= 0 &&
      totals.exchangeRefund > 0 &&
      !exchangePayConfirmed
    ) {
      setError(null);
      const btn = document.getElementById("exchange-pay-confirm-btn");
      btn?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        btn?.focus();
      }, 280);
      setFieldHint({
        fieldId: "exchange-pay-confirm-btn",
        message: "Confirm here first — exchange value is more, so you need to pay the customer.",
      });
      return;
    }

    if (
      !withGst &&
      useFixedReturn &&
      totals.cashReturn <= 0
    ) {
      setError("Enter the fixed return amount to the customer, or turn the toggle off.");
      document.getElementById("fixedReturnAmount")?.focus();
      return;
    }

    if (!withGst && !hasDue && totals.dueAmount > 0) {
      setError(
        `Payment is short by ${formatINR(totals.dueAmount)}. Complete the payment split or turn on "This bill has due".`,
      );
      document.getElementById("hasDue")?.focus();
      return;
    }

    if (!withGst && hasDue && totals.dueAmount > 0 && !dueDate.trim()) {
      setError("Select expected collection date for the pending due amount");
      document.getElementById("dueDate")?.focus();
      return;
    }

    if (!withGst && isExchange) {
      const missingImei = exchangeItems.find((item) => !item.imei1.trim());
      if (missingImei) {
        setError("Enter exchange phone IMEI for every exchange mobile");
        const field = document.getElementById(
          `exchange-${missingImei.key}-imei`,
        );
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
        field?.focus();
        return;
      }
      const imeis = exchangeItems
        .map((item) => item.imei1.replace(/\s+/g, "").trim())
        .filter(Boolean);
      if (new Set(imeis).size !== imeis.length) {
        setError("Each exchange phone needs a unique IMEI");
        return;
      }
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
        payCustomerAmount: totals.exchangeRefund,
        cashAmount: payload.useCash ? payload.cashAmount : 0,
        onlineAmount: payload.useOnline ? payload.onlineAmount : 0,
        cardAmount: payload.useCard ? payload.cardAmount : 0,
        financeAmount: payload.useFinance
          ? round2(
              (payload.financeAmount || 0) + (payload.financeAmount2 || 0),
            )
          : 0,
        financeCompanyName: formatFinanceCompanies(
          payload.financeCompanyName,
          payload.financeCompanyName2,
        ),
        dueAmount: totals.dueAmount,
        dueDate:
          payload.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate)
            ? payload.dueDate.split("-").reverse().join("/")
            : payload.dueDate,
        isExchange: Boolean(payload.isExchange),
        exchangeValue: payload.exchangeValue,
        exchangeCashReturn: payload.exchangeCashReturn || 0,
        companyDiscount: totals.companyDiscountAmount,
      });
      setShowSaveConfirm(true);
      setSaving(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save bill");
      setSaving(false);
    }
  }

  async function refreshStock(includeIds: string[] = []) {
    try {
      const { data } = await api.listStock(undefined, includeIds, "ALL");
      setStockItems(data);
    } catch {
      // Keep existing stock if refresh fails
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
      setSuccessInvoice(data.invoiceNumber);
      captureSuccessPayment(data);
      setShareError(null);
      await refreshStock();
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
      setSuccessInvoice(data.invoiceNumber);
      captureSuccessPayment(data);
      setShareError(null);
      setOriginalBill(data);
      const keepIds = data.items
        .map((item) => item.stockItemId)
        .filter((id): id is string => Boolean(id));
      await refreshStock(keepIds);
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
        <BackLink to={from ?? "/bills"}>Back to bills</BackLink>
        <div className="glass-panel px-5 py-8 text-center text-sm text-ember-500">
          {loadError}
        </div>
      </div>
    );
  }

  if (successId) {
    const savedBillId = successId;
    const invoiceLabel = successInvoice || "Invoice";

    async function shareOnWhatsApp() {
      setSharing(true);
      setShareError(null);
      try {
        await shareInvoicePdf(savedBillId, invoiceLabel);
      } catch (err) {
        if (isShareAbort(err)) return;
        setShareError(
          err instanceof Error ? err.message : "Could not open share sheet",
        );
      } finally {
        setSharing(false);
      }
    }

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
        {successInvoice ? (
          <p className="mt-1 text-sm font-medium text-ink-700">
            {successInvoice}
          </p>
        ) : null}
        {successPayment ? (
          <div className="mx-auto mt-5 w-full max-w-sm rounded-2xl border border-ink-100 bg-ink-50/70 px-4 py-4 text-left">
            {successPayment.payCustomerAmount > 0 &&
            successPayment.payableAmount <= 0 &&
            !successPayment.withGst ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-500">Pay customer</span>
                <span className="font-display text-xl font-semibold text-ember-500">
                  {formatINR(successPayment.payCustomerAmount)}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-500">
                  {successPayment.withGst ? "Invoice total" : "Payable"}
                </span>
                <span className="font-display text-xl font-semibold text-ink-900">
                  {formatINR(successPayment.payableAmount)}
                </span>
              </div>
            )}
            {successPayment.withGst ? (
              <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
                Submission invoice — not recorded in shop sales.
              </p>
            ) : successPayment.payCustomerAmount > 0 &&
              successPayment.payableAmount <= 0 ? (
              <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
                Exchange value exceeded the bill. No customer payment due.
              </p>
            ) : (
              <dl className="mt-3 space-y-2 border-t border-ink-100 pt-3 text-sm">
                {successPayment.payCustomerAmount > 0 ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500">Pay customer</dt>
                    <dd className="font-medium text-ember-500">
                      {formatINR(successPayment.payCustomerAmount)}
                    </dd>
                  </div>
                ) : null}
                {successPayment.cashAmount > 0 ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500">Cash</dt>
                    <dd className="font-medium text-ink-800">
                      {formatINR(successPayment.cashAmount)}
                    </dd>
                  </div>
                ) : null}
                {successPayment.onlineAmount > 0 ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500">Online</dt>
                    <dd className="font-medium text-ink-800">
                      {formatINR(successPayment.onlineAmount)}
                    </dd>
                  </div>
                ) : null}
                {successPayment.cardAmount > 0 ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500">Card</dt>
                    <dd className="font-medium text-ink-800">
                      {formatINR(successPayment.cardAmount)}
                    </dd>
                  </div>
                ) : null}
                {successPayment.financeAmount > 0 ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-500">
                      Finance
                      {successPayment.financeLabel
                        ? ` · ${successPayment.financeLabel}`
                        : ""}
                    </dt>
                    <dd className="font-medium text-ink-800">
                      {formatINR(successPayment.financeAmount)}
                    </dd>
                  </div>
                ) : null}
                {successPayment.dueAmount > 0 ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ember-500">
                      Due
                      {successPayment.dueDate
                        ? ` · by ${successPayment.dueDate}`
                        : ""}
                    </dt>
                    <dd className="font-medium text-ember-500">
                      {formatINR(successPayment.dueAmount)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
          </div>
        ) : null}
        {shareError ? (
          <p className="mt-3 text-sm text-ember-500">{shareError}</p>
        ) : null}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
          <button
            className="btn-primary"
            type="button"
            disabled={sharing}
            onClick={() => void shareOnWhatsApp()}
          >
            <Share2 className="h-4 w-4" />
            {sharing ? "Preparing…" : "Share"}
          </button>
          <a
            className="btn-secondary"
            href={api.pdfUrl(savedBillId)}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </a>
          <button
            className="btn-secondary"
            type="button"
            onClick={() =>
              navigate(`/bills/${savedBillId}`, {
                state: from ? { from } : { from: billsHomePath(withGst) },
              })
            }
          >
            View bill
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => navigate(from ?? billsHomePath(withGst))}
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
            : "Enter products manually. Split payment across cash, online, card, and finance — remaining amount becomes due."
        }
        action={
          isEdit && editId ? (
            <BackLink to={`/bills/${editId}`} state={location.state}>
              Cancel
            </BackLink>
          ) : undefined
        }
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-[16px] border border-ink-100/80 bg-white/90 p-5 shadow-soft">
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-ink-900">
              Generate GST bill
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {withGst
                ? "GST tax invoice for submission only — payment split is hidden and not recorded in sales."
                : "Default shop bill with payment modes. Turn on for a GST tax invoice."}
            </p>
          </div>
          <Switch
            checked={withGst}
            aria-label="Generate GST bill"
            onChange={(on) => {
              setWithGst(on);
              if (on) {
                setUseCompanyCashback(false);
                setCompanyDiscount("");
                setUseCash(false);
                setUseOnline(false);
                setUseCard(false);
                setUseFinance(false);
                setHasDue(false);
                setDueFollowsRemaining(true);
                setCashAmount(0);
                setOnlineAmount(0);
                setCardAmount(0);
                setDueEntry(0);
                resetFinanceEntries();
                setDueDate("");
                setIsExchange(false);
                clearExchangeFields();
                // Detach stock — GST lines use catalog phones only
                setItems((prev) =>
                  prev.map((item) => {
                    if (item.catalogMode === "other") {
                      return { ...item, stockItemId: null };
                    }
                    return {
                      ...item,
                      stockItemId: null,
                      catalogMode: "mobile" as const,
                    };
                  }),
                );
              } else {
                setItems((prev) =>
                  prev.map((item) =>
                    item.catalogMode === "mobile" && !item.stockItemId
                      ? {
                          ...blankItem(),
                          key: item.key,
                          gstPercent: item.gstPercent,
                          rate: item.rate,
                          quantity: item.quantity,
                        }
                      : item,
                  ),
                );
              }
            }}
          />
        </div>

        <div className="space-y-4">
            <section className="rounded-[16px] border border-ink-100/80 bg-white/90 p-5 shadow-soft">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-tide-100 text-tide-600">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="font-display text-base font-semibold text-ink-900">
                      Customer
                    </h2>
                    <p className="mt-0.5 text-xs text-ink-500">
                      Phone lookup fills name and address automatically.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <label
                    htmlFor="useCustomBillDate"
                    className="text-xs font-medium text-ink-600"
                  >
                    Custom date
                  </label>
                  <Switch
                    id="useCustomBillDate"
                    checked={useCustomBillDate}
                    aria-label="Use custom bill date"
                    onChange={(enabled) => {
                      setUseCustomBillDate(enabled);
                      if (enabled && !customBillDate) {
                        setCustomBillDate(todayDateInput());
                      }
                    }}
                  />
                </div>
              </div>

              <div className="space-y-4">
                {useCustomBillDate ? (
                  <div>
                    <label className="label required" htmlFor="customBillDate">
                      Bill date
                    </label>
                    <input
                      id="customBillDate"
                      className="field"
                      type="date"
                      value={customBillDate}
                      max={todayDateInput()}
                      onChange={(event) => setCustomBillDate(event.target.value)}
                      required
                    />
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
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
                      aria-describedby={
                        phoneError ? "customerPhone-error" : undefined
                      }
                      required
                      autoComplete="tel"
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
                    {fetchingCustomer ? (
                      <p
                        className="mt-1.5 text-xs font-medium text-tide-600"
                        aria-live="polite"
                      >
                        Fetching customer details…
                      </p>
                    ) : null}
                  </div>
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
                      autoComplete="name"
                    />
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
              </div>
            </section>

            <section className="rounded-[16px] border border-ink-100/80 bg-white/90 p-5 shadow-soft">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-tide-100 text-tide-600">
                  <ListOrdered className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="font-display text-base font-semibold text-ink-900">
                    Products
                  </h2>
                  {withGst ? (
                    <p className="mt-0.5 text-xs text-ink-500">
                      Pick a saved phone or add a new one. GST lines are not taken from
                      stock and do not change inventory.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {items.map((item, index) => (
                    <motion.div
                      id={`item-${item.key}`}
                      key={item.key}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="min-w-0 overflow-visible rounded-xl border border-ink-100 bg-ink-50/30 p-4"
                    >
                      <div className="mb-4 flex items-center justify-between gap-2">
                        <span className="inline-flex rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-ink-100">
                          Item {index + 1}
                        </span>
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

                <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_4.5rem_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  {withGst ? (
                    <>
                      <div className="min-w-0 sm:col-span-2 lg:col-span-5">
                        <label className="label required">Phone</label>
                        <div id={`phone-${item.key}`} className="min-w-0">
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
                          onChange={(value) =>
                            selectCatalogMobile(item.key, value)
                          }
                          placeholder={
                            mobileCatalog.length
                              ? "Select phone"
                              : "No phones yet — use Add new mobile"
                          }
                          searchable
                          searchPlaceholder="Search phone…"
                          required
                          conditionFilters
                          options={catalogMobileOptions}
                          footerAction={{
                            label: "Add a new mobile to stock",
                            onClick: () => setAddMobileForItem(item.key),
                          }}
                        />
                        </div>
                      </div>

                      {item.catalogMode === "other" ? (
                        <div className="sm:col-span-2 lg:col-span-5">
                          <label className="label required" htmlFor={`productName-${item.key}`}>Product name</label>
                          <input
                            id={`productName-${item.key}`}
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
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 sm:col-span-2 lg:col-span-5">
                        <label className="label required">Product</label>
                        <div id={`phone-${item.key}`} className="min-w-0">
                        <FieldPicker
                          value={
                            item.catalogMode === "other"
                              ? "__other__"
                              : item.stockItemId || ""
                          }
                          onChange={(value) => selectMobile(item.key, value)}
                          placeholder={
                            stockItems.length
                              ? "Select phone or accessory"
                              : "No stock yet — add under Stock"
                          }
                          searchable
                          searchPlaceholder="Search phone, accessory, IMEI, serial…"
                          required
                          conditionFilters
                          options={stockOptionsForItem(item.key)}
                          footerAction={{
                            label: "Add a new mobile to stock",
                            onClick: () => setAddMobileForItem(item.key),
                          }}
                        />
                        </div>
                      </div>

                      {item.catalogMode === "other" ? (
                        <div className="sm:col-span-2 lg:col-span-5">
                          <label className="label required" htmlFor={`productName-${item.key}`}>Product name</label>
                          <input
                            id={`productName-${item.key}`}
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
                    </>
                  )}
                  <div>
                    <label className="label required" htmlFor={`rate-${item.key}`}>Rate (₹)</label>
                    <input
                      id={`rate-${item.key}`}
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
                  <div className="min-w-0">
                    <label
                      className={withGst ? "label required" : "label"}
                      htmlFor={`gstPercent-${item.key}`}
                    >
                      GST %
                    </label>
                    <input
                      id={`gstPercent-${item.key}`}
                      className="field px-2"
                      type="number"
                      min={withGst ? 0.01 : 0}
                      max={100}
                      step="0.01"
                      value={item.gstPercent || ""}
                      onChange={(e) =>
                        updateItem(item.key, {
                          gstPercent: Number(e.target.value) || 0,
                        })
                      }
                      required={withGst}
                      placeholder={withGst ? "18" : "0"}
                      title="GST % (incl.)"
                    />
                  </div>
                  <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                    <label className="label">IMEI</label>
                    <ScanFieldShell
                      className={clsx(
                        item.stockItemId && !withGst && item.imei1?.trim()
                          ? "cursor-default border-ink-200 bg-ink-100/80"
                          : null,
                        imeiFieldErrors[item.key] &&
                          "border-red-400 focus-within:border-red-500 focus-within:ring-red-200",
                      )}
                    >
                      <input
                        className={clsx(
                          scanFieldInputClass,
                          "text-sm tracking-wide",
                          item.stockItemId &&
                            !withGst &&
                            item.imei1?.trim() &&
                            "cursor-default text-ink-600",
                        )}
                        value={item.imei1 || ""}
                        onChange={(e) => {
                          updateItem(item.key, { imei1: e.target.value });
                          if (imeiFieldErrors[item.key]) {
                            setImeiFieldErrors((prev) => {
                              const next = { ...prev };
                              delete next[item.key];
                              return next;
                            });
                          }
                        }}
                        placeholder="Scan or type"
                        readOnly={
                          Boolean(item.stockItemId) &&
                          !withGst &&
                          Boolean(item.imei1?.trim())
                        }
                        aria-invalid={Boolean(imeiFieldErrors[item.key])}
                      />
                      {!(
                        item.stockItemId &&
                        !withGst &&
                        item.imei1?.trim()
                      ) ? (
                        <ImeiScanFieldButton
                          disabled={Boolean(stockImeiLookup)}
                          onScan={(imei) =>
                            void lookupStockFromImeiScan(item.key, imei)
                          }
                        />
                      ) : null}
                    </ScanFieldShell>
                    {imeiFieldErrors[item.key] ? (
                      <p className="mt-1.5 text-xs font-medium text-red-600">
                        {imeiFieldErrors[item.key]}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="label">Serial</label>
                    <ScanFieldShell
                      className={clsx(
                        item.stockItemId &&
                          !withGst &&
                          item.serialNumber?.trim()
                          ? "cursor-default border-ink-200 bg-ink-100/80"
                          : null,
                        serialFieldErrors[item.key] &&
                          "border-red-400 focus-within:border-red-500 focus-within:ring-red-200",
                      )}
                    >
                      <input
                        className={clsx(
                          scanFieldInputClass,
                          item.stockItemId &&
                            !withGst &&
                            item.serialNumber?.trim() &&
                            "cursor-default text-ink-600",
                        )}
                        value={item.serialNumber || ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          updateItem(item.key, { serialNumber: value });
                          if (serialFieldErrors[item.key]) {
                            setSerialFieldErrors((prev) => {
                              const next = { ...prev };
                              delete next[item.key];
                              return next;
                            });
                          }
                          if (
                            !(
                              item.stockItemId &&
                              !withGst &&
                              item.serialNumber?.trim()
                            )
                          ) {
                            scheduleSerialLookup(item.key, value);
                          }
                        }}
                        placeholder="Scan or type"
                        readOnly={
                          Boolean(item.stockItemId) &&
                          !withGst &&
                          Boolean(item.serialNumber?.trim())
                        }
                        aria-invalid={Boolean(serialFieldErrors[item.key])}
                      />
                      {!(
                        item.stockItemId &&
                        !withGst &&
                        item.serialNumber?.trim()
                      ) ? (
                        <SerialScanFieldButton
                          disabled={Boolean(stockImeiLookup)}
                          onScan={(serial) =>
                            void lookupStockFromSerial(item.key, serial, {
                              fromScan: true,
                            })
                          }
                        />
                      ) : null}
                    </ScanFieldShell>
                    {serialFieldErrors[item.key] ? (
                      <p className="mt-1.5 text-xs font-medium text-red-600">
                        {serialFieldErrors[item.key]}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="label">Warranty</label>
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
                      placeholder="Months"
                    />
                  </div>
                </div>
                <p className="mt-4 border-t border-ink-100/80 pt-3 text-right text-sm font-semibold text-ink-800">
                  Line total · {formatINR(lineAmount(item))}
                </p>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              <button
                type="button"
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-ink-200 bg-white/60 px-4 py-3 text-sm font-semibold text-ink-600 transition hover:border-tide-300 hover:bg-tide-50/40 hover:text-tide-700 dark:border-ink-100 dark:bg-surface-muted/40 dark:text-ink-700 dark:hover:border-tide-400/40 dark:hover:bg-tide-100/25 dark:hover:text-tide-400"
                onClick={() => {
                  const last = items[items.length - 1];
                  if (last && !isDraftItemReady(last, withGst)) {
                    const fieldId = focusDraftItemField(last, withGst);
                    setFieldHint({
                      fieldId,
                      message: incompleteDraftHint(last, withGst),
                    });
                    return;
                  }
                  setFieldHint(null);
                  setItems((prev) => [...prev, blankItem()]);
                }}
              >
                <Plus className="h-4 w-4" />
                Add another item
              </button>
            </section>

            {!withGst ? (
              <section className="overflow-visible rounded-[18px] border border-ink-100/80 bg-white shadow-soft">
                <div className="flex items-center gap-3.5 px-5 py-[18px] sm:px-[22px]">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#E7F8F1] text-[#0E9E76] dark:bg-tide-100/70 dark:text-tide-400">
                    <RefreshCw className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-[17px] font-semibold text-ink-900">
                      Mobile exchange
                    </h2>
                    <p className="mt-0.5 text-[12.5px] text-ink-300">
                      Old phone enters second-hand stock; its value is deducted
                      from payable.
                    </p>
                  </div>
                  <Switch
                    checked={isExchange}
                    aria-label="Mobile exchange"
                    onChange={(checked) => {
                      setIsExchange(checked);
                      if (checked) {
                        setExchangeItems((current) =>
                          current.length ? current : [blankExchangeItem()],
                        );
                      } else {
                        clearExchangeFields();
                      }
                    }}
                  />
                </div>

                <AnimatePresence>
                  {isExchange ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-visible"
                    >
                      <div className="space-y-4 px-5 pb-5 sm:px-[22px] sm:pb-[22px]">
                        <div className="flex items-start gap-2.5 rounded-xl border border-[#CDEFE0] bg-[#E7F8F1] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#0B7A5B] dark:border-tide-400/25 dark:bg-tide-100/40 dark:text-tide-400">
                          <Info
                            className="mt-0.5 h-4 w-4 shrink-0"
                            strokeWidth={2}
                          />
                          <span>
                            Added as a second-hand <b className="font-semibold">(Old)</b>{" "}
                            mobile in the catalog so it can be resold later.{" "}
                            <b className="font-semibold">
                              Payable = bill total − exchange credit.
                            </b>{" "}
                            Use fixed return if the customer wants cash back from
                            the exchange value.
                          </span>
                        </div>

                        {exchangeItems.map((item, index) => (
                          <ExchangeMobileFields
                            key={item.key}
                            item={item}
                            index={index}
                            canRemove={exchangeItems.length > 1}
                            onChange={(patch) =>
                              updateExchangeItem(item.key, patch)
                            }
                            onRemove={() =>
                              setExchangeItems((current) =>
                                current.filter((row) => row.key !== item.key),
                              )
                            }
                          />
                        ))}

                        <button
                          type="button"
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#BFE9D6] bg-[#E7F8F1]/40 px-4 py-3 text-sm font-semibold text-[#0B7A5B] transition hover:border-[#12B886] hover:bg-[#E7F8F1] dark:border-tide-400/30 dark:bg-tide-100/30 dark:text-tide-400 dark:hover:border-tide-400 dark:hover:bg-tide-100/50"
                          onClick={() =>
                            setExchangeItems((current) => [
                              ...current,
                              blankExchangeItem(),
                            ])
                          }
                        >
                          <Plus className="h-4 w-4" />
                          Add another exchange mobile
                        </button>

                        <div className="mt-1 space-y-3">
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 px-3.5 py-3 dark:border-amber-500/40 dark:bg-amber-950/50">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-orange-950 dark:text-amber-100">
                                Fixed return to customer
                              </p>
                              <p className="mt-0.5 text-[11px] text-orange-800/70 dark:text-amber-200/80">
                                Pay cash from the exchange value; remaining
                                becomes bill credit.
                              </p>
                            </div>
                            <Switch
                              id="useFixedReturn"
                              checked={useFixedReturn}
                              aria-label="Fixed return to customer"
                              onChange={(on) => {
                                setUseFixedReturn(on);
                                if (!on) setFixedReturnAmount(0);
                              }}
                            />
                          </div>

                          {useFixedReturn ? (
                            <div>
                              <label
                                className="label required"
                                htmlFor="fixedReturnAmount"
                              >
                                Refund to customer
                              </label>
                              <div className="relative">
                                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-ember-500">
                                  ₹
                                </span>
                                <input
                                  id="fixedReturnAmount"
                                  className="w-full rounded-[11px] border border-amber-200 bg-amber-50/70 py-3 pl-[30px] pr-3.5 font-display text-base font-semibold tabular-nums text-ink-900 outline-none transition focus:border-amber-400 focus:bg-white focus:shadow-[0_0_0_3px_rgba(245,158,11,.18)] dark:border-amber-500/35 dark:bg-amber-950/40 dark:focus:bg-surface-elevated"
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  max={
                                    exchangeTotalValue(exchangeItems) ||
                                    undefined
                                  }
                                  value={fixedReturnAmount || ""}
                                  onChange={(e) => {
                                    const gross = exchangeTotalValue(
                                      exchangeItems,
                                    );
                                    const next = round2(
                                      Math.min(
                                        Math.max(Number(e.target.value) || 0, 0),
                                        gross,
                                      ),
                                    );
                                    setFixedReturnAmount(next);
                                  }}
                                  placeholder="e.g. 10000"
                                  required
                                />
                              </div>
                              {totals.cashReturn > 0 ? (
                                <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
                                  Effective exchange credit{" "}
                                  <span className="font-semibold text-ink-800">
                                    {formatINR(totals.exchangeDeduction)}
                                  </span>
                                  {" · "}
                                  Pay customer{" "}
                                  <span className="font-semibold text-ember-500">
                                    {formatINR(totals.cashReturn)}
                                  </span>
                                </p>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="flex items-center justify-between gap-3 rounded-xl bg-gradient-to-br from-[#0E1626] to-[#1B2740] px-4 py-3.5 text-white">
                            <span className="inline-flex items-center gap-2 text-[13px] text-[#B7C3D6]">
                              <Check
                                className="h-[15px] w-[15px] text-[#12B886]"
                                strokeWidth={2.6}
                              />
                              {useFixedReturn && totals.cashReturn > 0
                                ? "Bill credit after return"
                                : "Exchange credit on this bill"}
                            </span>
                            <span className="font-display text-lg font-bold tabular-nums text-[#5CE0AE]">
                              −
                              {formatINR(totals.exchangeDeduction)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </section>
            ) : null}

          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div
                className={clsx(
                  "order-2 rounded-[16px] border border-ink-100/80 bg-white/90 p-5 shadow-soft",
                  withGst && "order-none lg:col-span-2",
                )}
              >
                <h2 className="font-display text-base font-semibold text-ink-900">
                  Summary
                </h2>
                <dl className="mt-4 space-y-2">
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
                  {!withGst && totals.exchangeDeduction > 0 ? (
                    <SummaryRow
                      label="Exchange credit"
                      value={`- ${formatINR(totals.exchangeDeduction)}`}
                      accent
                    />
                  ) : null}
                  {!withGst && totals.cashReturn > 0 ? (
                    <SummaryRow
                      label="Fixed return to customer"
                      value={formatINR(totals.cashReturn)}
                      accent
                    />
                  ) : null}
                  <div className="border-t border-ink-100 pt-2">
                    <SummaryRow
                      label={withGst ? "Invoice total" : "Payable"}
                      value={formatINR(
                        withGst ? totals.grandTotal : totals.payableAmount,
                      )}
                      strong
                    />
                  </div>
                  {!withGst && totals.companyDiscountAmount > 0 ? (
                    <>
                      <SummaryRow
                        label="Company cashback"
                        value={`+ ${formatINR(totals.companyDiscountAmount)}`}
                      />
                      <SummaryRow
                        label="Effective selling"
                        value={formatINR(totals.effectiveSelling)}
                        strong
                      />
                    </>
                  ) : null}
                  {!withGst && totals.exchangeRefund > 0 ? (
                    <SummaryRow
                      label="Pay customer"
                      value={formatINR(totals.exchangeRefund)}
                      accent
                      strong
                    />
                  ) : null}
                  {withGst ? (
                    <p className="pt-1 text-xs leading-relaxed text-ink-500">
                      GST bill — payment modes are not recorded; excluded from shop sales.
                    </p>
                  ) : null}
                </dl>

                {!withGst ? (
                  <div className="mt-4 border-t border-ink-100 pt-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-display text-base font-semibold text-ink-900">
                        Company cashback
                      </p>
                      <Switch
                        checked={useCompanyCashback}
                        aria-label="Company cashback"
                        onChange={(on) => {
                          setUseCompanyCashback(on);
                          if (!on) setCompanyDiscount("");
                        }}
                      />
                    </div>
                    {useCompanyCashback ? (
                      <div className="relative mt-3">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-[#0E9E76]">
                          ₹
                        </span>
                        <input
                          id="companyDiscount"
                          className="w-full rounded-[11px] border border-[#BFE9D6] bg-[#E7F8F1] py-3 pl-[30px] pr-3.5 font-display text-base font-semibold tabular-nums text-ink-900 outline-none transition focus:border-[#12B886] focus:bg-white focus:shadow-[0_0_0_3px_rgba(18,184,134,.15)] dark:border-tide-400/30 dark:bg-tide-100/35 dark:focus:border-tide-400 dark:focus:bg-surface-elevated dark:focus:shadow-[0_0_0_3px_rgba(45,212,191,0.2)]"
                          type="number"
                          min={0}
                          step="0.01"
                          value={companyDiscount}
                          onChange={(e) =>
                            setCompanyDiscount(
                              e.target.value === ""
                                ? ""
                                : Number(e.target.value) || 0,
                            )
                          }
                          placeholder="0"
                          inputMode="decimal"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 border-t border-ink-100 pt-4">
                  <label className="label" htmlFor="notes">
                    Note (optional)
                  </label>
                  <textarea
                    id="notes"
                    className="field min-h-[64px] resize-y"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional note for this bill"
                  />
                </div>

                {error ? (
                  <p className="mt-3 rounded-xl bg-orange-50 px-4 py-3 text-sm text-ember-500">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  className="btn-primary mt-4 w-full"
                  disabled={saving}
                >
                  <Check className="h-4 w-4" />
                  {saving
                    ? "Saving…"
                    : isEdit
                      ? "Review & update"
                      : "Save bill"}
                </button>
              </div>

              {!withGst ? (
                <div
                  className={clsx(
                    "relative order-1 overflow-visible rounded-[16px] border border-ink-100/80 bg-white/90 p-5 shadow-soft",
                    totals.payableAmount <= 0 &&
                      totals.exchangeRefund > 0 &&
                      "min-h-[280px]",
                  )}
                >
                  <h2 className="font-display text-base font-semibold text-ink-900">
                    Payment
                  </h2>
                  <p className="mt-1 text-xs text-ink-500">
                    {hasDue
                      ? "Cash, online, card, then due — leftover goes to finance."
                      : "Tick each mode — remaining payable fills in automatically."}
                  </p>

                  {!withGst &&
                  totals.cashReturn > 0 &&
                  totals.payableAmount > 0 ? (
                    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
                      Pay customer{" "}
                      <span className="font-semibold">
                        {formatINR(totals.cashReturn)}
                      </span>{" "}
                      cash return, then collect remaining payable below
                      (e.g. finance).
                    </div>
                  ) : null}

                  <div
                    className={clsx(
                      "mt-4 space-y-2.5 transition",
                      totals.payableAmount <= 0 &&
                        totals.exchangeRefund > 0 &&
                        "pointer-events-none select-none opacity-25 blur-[1px]",
                    )}
                  >
                    <label
                      htmlFor="hasDue"
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-orange-200/80 bg-orange-50/60 px-3 py-2.5 dark:border-amber-500/40 dark:bg-amber-950/50"
                    >
                      <span>
                        <span className="block text-xs font-semibold text-ink-800 dark:text-amber-100">
                          This bill has due
                        </span>
                        <span className="mt-0.5 block text-[11px] text-ink-500 dark:text-amber-200/80">
                          Record amount the customer will pay later.
                        </span>
                      </span>
                      <Switch
                        id="hasDue"
                        checked={hasDue}
                        aria-label="This bill has due"
                        onChange={toggleHasDue}
                      />
                    </label>

                    <PaymentToggle
                      label="Cash"
                      tone="cash"
                      checked={useCash}
                      amount={cashAmount}
                      onChecked={(checked) => togglePayment("cash", checked)}
                      onAmount={setCashAmount}
                    />
                    <PaymentToggle
                      label="Online"
                      tone="online"
                      checked={useOnline}
                      amount={onlineAmount}
                      onChecked={(checked) => togglePayment("online", checked)}
                      onAmount={setOnlineAmount}
                    />
                    <PaymentToggle
                      label="Card"
                      tone="card"
                      checked={useCard}
                      amount={cardAmount}
                      onChecked={(checked) => togglePayment("card", checked)}
                      onAmount={setCardAmount}
                    />
                    {hasDue ? (
                      <PaymentToggle
                        label="Due"
                        tone="due"
                        checked
                        amount={dueFollowsRemaining ? totals.dueAmount : dueEntry}
                        onChecked={(checked) => toggleHasDue(checked)}
                        onAmount={() => {}}
                        showAmount={false}
                      >
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
                          <div>
                            <label className="label required" htmlFor="dueAmount">
                              Amount
                            </label>
                            <input
                              id="dueAmount"
                              className="field"
                              type="number"
                              min={0}
                              step="0.01"
                              value={
                                (dueFollowsRemaining
                                  ? totals.dueAmount
                                  : dueEntry) || ""
                              }
                              onChange={(e) => {
                                const maxDue = round2(
                                  Math.max(
                                    totals.payableAmount -
                                      (useCash ? cashAmount : 0) -
                                      (useOnline ? onlineAmount : 0) -
                                      (useCard ? cardAmount : 0),
                                    0,
                                  ),
                                );
                                const next = round2(
                                  Math.min(
                                    Math.max(Number(e.target.value) || 0, 0),
                                    maxDue,
                                  ),
                                );
                                setDueEntry(next);
                                setDueFollowsRemaining(next >= maxDue);
                              }}
                              placeholder="Amount pending from customer"
                              required
                            />
                          </div>
                          <div>
                            <label className="label required" htmlFor="dueDate">
                              Due date
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
                          </div>
                        </div>
                      </PaymentToggle>
                    ) : null}
                    <PaymentToggle
                      label="Finance"
                      tone="finance"
                      checked={useFinance}
                      amount={totals.finance}
                      onChecked={(checked) => {
                        if (hasDue && totals.finance > 0 && !checked) return;
                        togglePayment("finance", checked);
                      }}
                      onAmount={() => {}}
                      showAmount={false}
                    >
                      <div className="space-y-4">
                        {financeEntries.map((entry, index) => {
                          const excludeIds = financeEntries
                            .filter((e) => e.key !== entry.key && e.companyId)
                            .map((e) => e.companyId);
                          const financeUsed = financeEntries.reduce(
                            (sum, e) => sum + (e.amount || 0),
                            0,
                          );
                          const remainingForNext = remainingAfterPayments(financeUsed);
                          const canAddAnother =
                            index === financeEntries.length - 1 &&
                            financeEntries.length < MAX_FINANCE_ENTRIES &&
                            Boolean(entry.select) &&
                            entry.amount > 0 &&
                            remainingForNext > 0;

                          return (
                            <div
                              key={entry.key}
                              className={
                                index > 0
                                  ? "space-y-3 border-t border-ink-100 pt-4"
                                  : "space-y-3"
                              }
                            >
                              <div className="flex items-center justify-between gap-2">
                                <label className="label required mb-0">
                                  {financeEntries.length > 1
                                    ? `Finance company ${index + 1}`
                                    : "Finance company"}
                                </label>
                                {index > 0 ? (
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-ember-500 hover:underline"
                                    onClick={() => removeFinanceEntry(entry.key)}
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                              <FinanceCompanyPicker
                                companies={financeCompanies}
                                value={entry.select}
                                required={useFinance}
                                excludeIds={excludeIds}
                                onChange={(value) => {
                                  updateFinanceEntry(entry.key, {
                                    select: value,
                                    companyId: value === ADD_NEW_FINANCE ? "" : value,
                                    newName:
                                      value === ADD_NEW_FINANCE ? entry.newName : "",
                                  });
                                }}
                              />
                              {entry.select === ADD_NEW_FINANCE ? (
                                <div>
                                  <label
                                    className="label required"
                                    htmlFor={`newFinanceName-${entry.key}`}
                                  >
                                    New finance company
                                  </label>
                                  <div className="flex flex-col gap-2 sm:flex-row">
                                    <input
                                      id={`newFinanceName-${entry.key}`}
                                      className="field"
                                      value={entry.newName}
                                      onChange={(e) =>
                                        updateFinanceEntry(entry.key, {
                                          newName: e.target.value,
                                        })
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          void saveNewFinanceCompany(entry.key);
                                        }
                                      }}
                                      placeholder="e.g. HDFC Finance"
                                      required={
                                        useFinance && entry.select === ADD_NEW_FINANCE
                                      }
                                    />
                                    <button
                                      type="button"
                                      className="btn-secondary shrink-0"
                                      disabled={
                                        savingFinanceKey === entry.key ||
                                        !entry.newName.trim()
                                      }
                                      onClick={() =>
                                        void saveNewFinanceCompany(entry.key)
                                      }
                                    >
                                      {savingFinanceKey === entry.key
                                        ? "Saving…"
                                        : "Save for later"}
                                    </button>
                                  </div>
                                  <p className="mt-2 text-xs text-ink-500">
                                    Saved names stay in the list for all future bills.
                                  </p>
                                </div>
                              ) : null}
                              <div>
                                <label className="label required">Amount</label>
                                <input
                                  className="field"
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={entry.amount || ""}
                                  onChange={(e) =>
                                    updateFinanceEntry(entry.key, {
                                      amount: Number(e.target.value) || 0,
                                    })
                                  }
                                  placeholder="Amount paid by finance"
                                  required={useFinance}
                                />
                              </div>
                              {canAddAnother ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-ink-300 hover:bg-ink-50"
                                  onClick={addFinanceEntry}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Add another finance company · {formatINR(remainingForNext)} left
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </PaymentToggle>

                  {(useCash || useOnline || useCard || useFinance || hasDue) &&
                  (totals.dueAmount > 0 || totals.paid > 0) ? (
                    <div
                      className={clsx(
                        "mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold",
                        totals.dueAmount > 0
                          ? "border border-amber-200 bg-amber-50 text-amber-800"
                          : "border border-emerald-200 bg-emerald-50 text-emerald-800",
                      )}
                    >
                      <span>
                        {totals.dueAmount > 0
                          ? hasDue
                            ? "Remaining due"
                            : "Payment short"
                          : "Fully paid"}
                      </span>
                      <span>
                        {totals.dueAmount > 0
                          ? formatINR(totals.dueAmount)
                          : formatINR(totals.paid)}
                      </span>
                    </div>
                  ) : null}

                  </div>

                  {totals.payableAmount <= 0 && totals.exchangeRefund > 0 ? (
                    <div
                      id="exchange-pay-confirm"
                      className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 px-6 text-center backdrop-blur-[2px]"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {exchangePayConfirmed ? (
                          <motion.div
                            key="exchange-confirmed"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="flex flex-col items-center"
                          >
                            <motion.span
                              initial={{ scale: 0.7, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{
                                type: "spring",
                                stiffness: 420,
                                damping: 22,
                                mass: 0.6,
                              }}
                              className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-[#E7F8F1] text-[#0E9E76] dark:bg-tide-100/70 dark:text-tide-400"
                            >
                              <Check className="h-7 w-7" strokeWidth={2.5} />
                            </motion.span>
                            <p className="font-display text-lg font-semibold text-ink-900">
                              Confirmed
                            </p>
                            <p className="mt-1.5 max-w-[16rem] text-sm leading-relaxed text-ink-500">
                              Exchange value is more. Pay customer{" "}
                              <span className="font-semibold text-ink-900">
                                {formatINR(totals.exchangeRefund)}
                              </span>
                              .
                            </p>
                            <p className="mt-3 max-w-[16rem] text-xs leading-relaxed text-ink-300">
                              Edit price to change
                            </p>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="exchange-confirm-prompt"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ duration: 0.14, ease: "easeOut" }}
                            className="flex flex-col items-center"
                          >
                            <p className="font-display text-lg font-semibold text-ink-900">
                              Exchange value is more
                            </p>
                            <p className="mt-1.5 max-w-[16rem] text-sm leading-relaxed text-ink-500">
                              You need to pay customer{" "}
                              <span className="font-semibold text-ink-900">
                                {formatINR(totals.exchangeRefund)}
                              </span>
                              .
                            </p>
                            <motion.button
                              type="button"
                              id="exchange-pay-confirm-btn"
                              className="btn-primary mt-5 min-w-[10rem]"
                              whileTap={{ scale: 0.96 }}
                              transition={{ duration: 0.1 }}
                              onClick={() => {
                                setExchangePayConfirmed(true);
                                setFieldHint(null);
                                setError(null);
                              }}
                            >
                              <Check className="h-4 w-4" />
                              Confirm
                            </motion.button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </form>

      {fieldHint ? (
        <FieldInfoTip
          fieldId={fieldHint.fieldId}
          message={fieldHint.message}
          onDismiss={() => setFieldHint(null)}
        />
      ) : null}

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

      {stockImeiLookup
        ? createPortal(
            <div
              className="fixed inset-0 z-[95] flex items-center justify-center bg-ink-950/50 p-4"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="stock-imei-lookup-title"
              aria-busy="true"
            >
              <div className="w-full max-w-sm rounded-3xl border border-white/70 bg-white p-6 shadow-lift">
                <div className="flex flex-col items-center text-center">
                  <Loader2 className="h-9 w-9 animate-spin text-tide-600" />
                  <h2
                    id="stock-imei-lookup-title"
                    className="mt-4 font-display text-lg font-semibold text-ink-900"
                  >
                    Looking up mobile…
                  </h2>
                  <p className="mt-1.5 text-sm text-ink-500">
                    Checking stock for IMEI{" "}
                    <span className="font-mono text-ink-700">
                      {stockImeiLookup.imei}
                    </span>
                  </p>
                  <button
                    type="button"
                    className="btn-secondary mt-5 min-w-[140px]"
                    onClick={cancelStockImeiLookup}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  id,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent dark:focus-visible:ring-offset-surface",
        checked
          ? "border-[#0B9B72] bg-[#12B886] shadow-[0_0_0_3px_rgba(18,184,134,0.25)] focus-visible:ring-[#12B886]"
          : "border-ink-300 bg-ink-100 shadow-sm focus-visible:ring-ink-300 dark:border-slate-500 dark:bg-slate-600 dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]",
      )}
    >
      <span
        className={clsx(
          "inline-block h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] ring-1 ring-black/10 transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function FieldInfoTip({
  fieldId,
  message,
  onDismiss,
}: {
  fieldId: string;
  message: string;
  onDismiss: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const el = document.getElementById(fieldId);
      if (!el) {
        setPos(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      setPos({
        top: Math.max(8, rect.top - 8),
        left: Math.min(rect.left, window.innerWidth - 252),
      });
    };
    // After scrollIntoView settles
    const frame = window.requestAnimationFrame(update);
    const delayed = window.setTimeout(update, 280);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(delayed);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [fieldId]);

  if (!pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="status"
      className="pointer-events-auto fixed z-[80] max-w-[240px] -translate-y-full"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="flex items-start gap-2 rounded-xl border border-[#93C5FD] bg-[#E8F0FE] px-3 py-2 text-[12.5px] font-medium leading-snug text-[#1E40AF] shadow-[0_8px_24px_rgba(16,25,40,.14)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
        <span className="min-w-0">{message}</span>
        <button
          type="button"
          className="ml-1 shrink-0 rounded-md px-1 text-[#2563EB]/80 hover:bg-white/60 hover:text-[#1D4ED8]"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
      <span
        aria-hidden
        className="ml-4 block h-2.5 w-2.5 -translate-y-1.5 rotate-45 border-b border-r border-[#93C5FD] bg-[#E8F0FE]"
      />
    </div>,
    document.body,
  );
}

const PAYMENT_TONE_STYLES = {
  cash: { accent: "#12B886", ring: "ring-[#12B886]/20", bg: "bg-[#12B886]/5" },
  online: { accent: "#3B82F6", ring: "ring-[#3B82F6]/20", bg: "bg-[#3B82F6]/5" },
  card: { accent: "#6366F1", ring: "ring-[#6366F1]/20", bg: "bg-[#6366F1]/5" },
  due: { accent: "#F59E0B", ring: "ring-[#F59E0B]/20", bg: "bg-[#F59E0B]/5" },
  finance: { accent: "#8B5CF6", ring: "ring-[#8B5CF6]/20", bg: "bg-[#8B5CF6]/5" },
} as const;

function PaymentToggle({
  label,
  tone,
  checked,
  amount,
  onChecked,
  onAmount,
  children,
  showAmount = true,
  amountPlaceholder,
}: {
  label: string;
  tone: keyof typeof PAYMENT_TONE_STYLES;
  checked: boolean;
  amount: number;
  onChecked: (value: boolean) => void;
  onAmount: (value: number) => void;
  children?: ReactNode;
  showAmount?: boolean;
  amountPlaceholder?: string;
}) {
  const styles = PAYMENT_TONE_STYLES[tone];

  return (
    <div
      className={clsx(
        "rounded-xl border border-ink-100 bg-white transition dark:border-ink-100 dark:bg-surface-elevated",
        checked ? "overflow-visible" : "overflow-hidden",
        checked && styles.bg,
        checked && "ring-1",
        checked && styles.ring,
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: styles.accent }}
    >
      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChecked(e.target.checked)}
          className="h-4 w-4 rounded border-ink-300 focus:ring-2"
          style={{ accentColor: styles.accent }}
        />
        <span className="text-xs font-semibold text-ink-800">{label}</span>
      </label>
      <AnimatePresence>
        {checked ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={checked ? "overflow-visible" : "overflow-hidden"}
          >
            <div className="space-y-3 border-t border-ink-100/80 px-3 pb-3 pt-2.5">
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
                    placeholder={
                      amountPlaceholder || `Amount paid by ${label.toLowerCase()}`
                    }
                    required={checked}
                  />
                </div>
              ) : null}
              {children}
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
    <div className="flex items-center justify-between gap-2 text-xs">
      <dt className={strong ? "font-medium text-ink-700" : "text-ink-500"}>
        {label}
      </dt>
      <dd
        className={clsx(
          strong && accent
            ? "font-display text-lg font-semibold text-ember-500"
            : strong
              ? "font-display text-lg font-semibold text-ink-900"
              : accent
                ? "font-semibold text-ember-500"
                : "font-medium tabular-nums text-ink-800",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
