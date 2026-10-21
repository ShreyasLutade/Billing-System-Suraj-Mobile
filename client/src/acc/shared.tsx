import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Outlet } from "react-router-dom";
import clsx from "clsx";
import {
  Battery,
  Cable,
  Camera,
  Car,
  Ear,
  FileDown,
  Gamepad2,
  Headphones,
  Keyboard,
  Lightbulb,
  Loader2,
  MemoryStick,
  Mic,
  Mouse,
  Package,
  Plug,
  Shield,
  Smartphone,
  Speaker,
  Tablet,
  Usb,
  Watch,
  X,
} from "lucide-react";
import { accApi, type AccCatalog, type AccPeriod, type PeriodQuery } from "./accApi";
import "./acc.css";

/* Shared bits for the accessories shop pages: layout, catalogue cache,
   bottom sheet, toasts, period chips, money format, PDF button. */

export function inr(amount: number, decimals = false) {
  return `₹${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: decimals ? 2 : 0,
    minimumFractionDigits: 0,
  }).format(Math.round((amount || 0) * 100) / 100)}`;
}

/** "1 item" / "3 items". */
export function plural(count: number, word: string, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong";
}

export function newRef() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function todayInput(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function shortDate(value: string | Date | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function dateTime(value: string | Date) {
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ---------------- icons ---------------- */

export const CATEGORY_ICONS = {
  smartphone: Smartphone,
  shield: Shield,
  headphones: Headphones,
  ear: Ear,
  plug: Plug,
  cable: Cable,
  speaker: Speaker,
  battery: Battery,
  watch: Watch,
  memory: MemoryStick,
  usb: Usb,
  tablet: Tablet,
  camera: Camera,
  mic: Mic,
  gamepad: Gamepad2,
  keyboard: Keyboard,
  mouse: Mouse,
  light: Lightbulb,
  car: Car,
  package: Package,
} as const;

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = CATEGORY_ICONS[icon as keyof typeof CATEGORY_ICONS] || Package;
  return <Icon className={className} aria-hidden />;
}

/* ---------------- catalogue cache ---------------- */

/**
 * One copy of the catalogue for all accessories pages. Refreshed after each
 * sale or stock change, when the tab comes back into view, and every 45 s so
 * stock seen on one counter keeps up with sales made on another.
 */
let catalog: AccCatalog | null = null;
let catalogError = "";
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function refreshCatalog() {
  if (inflight) return inflight;
  inflight = accApi
    .catalog()
    .then(({ data }) => {
      catalog = data;
      catalogError = "";
    })
    .catch((err) => {
      catalogError = errorText(err);
    })
    .finally(() => {
      inflight = null;
      emit();
    });
  return inflight;
}

/** Apply a saved product to the cache right away (no wait for refresh). */
export function patchCatalogProduct(product: AccCatalog["products"][number]) {
  if (!catalog) return;
  const exists = catalog.products.some((p) => p.id === product.id);
  catalog = {
    ...catalog,
    products: exists
      ? catalog.products.map((p) => (p.id === product.id ? product : p))
      : [...catalog.products, product],
  };
  emit();
}

export function useAccCatalog() {
  const snapshot = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => catalog,
  );
  const error = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => catalogError,
  );
  useEffect(() => {
    void refreshCatalog();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshCatalog();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshCatalog();
    }, 45000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);
  return { catalog: snapshot, error, refresh: refreshCatalog };
}

/* ---------------- toasts ---------------- */

type Toast = { id: number; text: string; tone: "ok" | "error"; action?: { label: string; run: () => void } };
let toasts: Toast[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();

export function toast(text: string, options: { tone?: "ok" | "error"; action?: Toast["action"]; ms?: number } = {}) {
  const id = ++toastSeq;
  toasts = [...toasts.slice(-2), { id, text, tone: options.tone || "ok", action: options.action }];
  toastListeners.forEach((fn) => fn());
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((fn) => fn());
  }, options.ms ?? (options.action ? 6000 : 2600));
}

function ToastHost() {
  const list = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toasts,
  );
  return createPortal(
    <div className="acc-toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={clsx("acc-toast", t.tone === "error" && "is-error")}>
          <span>{t.text}</span>
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                toasts = toasts.filter((x) => x.id !== t.id);
                toastListeners.forEach((fn) => fn());
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Wraps every /acc page: styles, toasts. */
export function AccLayout() {
  return (
    <div className="acc">
      <Outlet />
      <ToastHost />
    </div>
  );
}

/* ---------------- bottom sheet ---------------- */

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("acc-sheet-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("acc-sheet-open");
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="acc acc-sheet-backdrop" onClick={onClose}>
      <div
        className={clsx("acc-sheet", wide && "is-wide")}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="acc-sheet-head">
          <div className="acc-sheet-title">
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="acc-icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="acc-sheet-body">{children}</div>
        {footer ? <div className="acc-sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- small controls ---------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx("acc-seg", className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={clsx(value === option.value && "is-on")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const PERIODS: Array<{ value: AccPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yday" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "last30", label: "30 days" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

export function PeriodChips({ value, onChange }: { value: PeriodQuery; onChange: (value: PeriodQuery) => void }) {
  return (
    <div className="acc-period">
      <div className="acc-chips is-scroll">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={clsx("acc-chip", value.period === p.value && "is-on")}
            onClick={() =>
              onChange(
                p.value === "custom"
                  ? { period: "custom", from: value.from || todayInput(-6), to: value.to || todayInput() }
                  : { period: p.value },
              )
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.period === "custom" ? (
        <div className="acc-range">
          <input
            type="date"
            value={value.from || ""}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            aria-label="From"
          />
          <span>to</span>
          <input
            type="date"
            value={value.to || ""}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            aria-label="To"
          />
        </div>
      ) : null}
    </div>
  );
}

/** Button that downloads a PDF; shows a spinner while the server builds it. */
export function PdfButton({
  onDownload,
  label = "PDF",
  className,
}: {
  onDownload: () => Promise<void>;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onDownload();
    } catch (err) {
      toast(errorText(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }, [busy, onDownload]);
  return (
    <button type="button" className={clsx("acc-btn is-ghost", className)} onClick={run} disabled={busy}>
      {busy ? <Loader2 className="acc-spin" /> : <FileDown />}
      {label}
    </button>
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
  big,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  big?: boolean;
}) {
  return (
    <div className={clsx("acc-stepper", big && "is-big")}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Less" disabled={value <= min}>
        −
      </button>
      <input
        className="bg-transparent"
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value) || 0)))}
        onFocus={(e) => e.target.select()}
        aria-label="Quantity"
      />
      <button type="button" onClick={() => onChange(value + 1)} aria-label="More">
        +
      </button>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="acc-empty">
      <p>{title}</p>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function StockBadge({ qty, low }: { qty: number; low: number }) {
  if (qty <= 0) return <span className="acc-badge is-red">Out</span>;
  if (low > 0 && qty <= low) return <span className="acc-badge is-amber">{qty} left</span>;
  return <span className="acc-badge">{qty}</span>;
}

/** Price ladder for the counter chips when a product has none saved. */
export function suggestPrices(price: number, saved: number[] = []) {
  if (saved.length) return [...new Set(saved)].sort((a, b) => a - b);
  if (price <= 0) return [50, 100, 150, 200, 250, 300];
  const step = price < 100 ? 10 : price < 400 ? 20 : price < 1000 ? 50 : price < 3000 ? 100 : 500;
  const base = Math.round(price / step) * step;
  return [...new Set([base - 2 * step, base - step, price, base + step].filter((n) => n > 0))].sort((a, b) => a - b);
}
