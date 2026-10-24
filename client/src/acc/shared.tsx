import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Outlet } from "react-router-dom";
import clsx from "clsx";
import {
  Battery,
  Cable,
  Camera,
  CheckCircle2,
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
  Share2,
  Smartphone,
  Speaker,
  Tablet,
  Usb,
  Watch,
  X,
} from "lucide-react";
import { accApi, type AccCatalog, type AccPeriod, type PeriodQuery } from "./accApi";
import { ProductArt } from "./productArt";
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

/* ---------------- stock breakdown & checks ---------------- */

/** Pieces assigned to a phone model, and what's left unsorted. */
export function sortedQty(product: { stockQty: number; models: Array<{ qty: number }> }) {
  const sorted = product.models.reduce((a, m) => a + m.qty, 0);
  return { sorted, unsorted: Math.max(product.stockQty, 0) - sorted };
}

/**
 * The 10-digit mobile once the whole number is typed (10 digits, or with a
 * +91 / 0 prefix); "" while it is still being typed.
 */
export function completePhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return "";
}

export function daysSince(value: string | Date | null | undefined) {
  if (!value) return null;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
}

/** "Checked today" / "Checked 3 days ago" / "Never checked". */
export function checkedLabel(value: string | null | undefined) {
  const days = daysSince(value);
  if (days === null) return "Never checked";
  if (days <= 0) return "Checked today";
  if (days === 1) return "Checked yesterday";
  return `Checked ${days} days ago`;
}

/** A week since the last physical count. */
export const CHECK_EVERY_DAYS = 7;
export const needsCheck = (value: string | null | undefined) => {
  const days = daysSince(value);
  return days === null || days >= CHECK_EVERY_DAYS;
};

/** Suggestions when sorting covers / glass by phone brand. */
export const COMMON_PHONE_BRANDS = [
  "Vivo", "Oppo", "Samsung", "Redmi", "Realme", "iPhone", "OnePlus", "Poco", "Motorola", "iQOO", "Infinix", "Tecno",
  "Nokia", "Lava", "Itel", "Google Pixel", "Nothing",
];

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

/** Light / base / deep shade per icon, for the plate behind its illustration. */
const ICON_TONES: Record<keyof typeof CATEGORY_ICONS, [string, string, string]> = {
  smartphone: ["#c4b5fd", "#8b5cf6", "#4c1d95"],
  shield: ["#a5f3fc", "#06b6d4", "#155e75"],
  headphones: ["#fda4af", "#f43f5e", "#881337"],
  ear: ["#bae6fd", "#0ea5e9", "#0c4a6e"],
  plug: ["#fde68a", "#f59e0b", "#92400e"],
  cable: ["#a7f3d0", "#10b981", "#065f46"],
  speaker: ["#fed7aa", "#f97316", "#9a3412"],
  battery: ["#d9f99d", "#65a30d", "#365314"],
  watch: ["#c7d2fe", "#6366f1", "#312e81"],
  memory: ["#99f6e4", "#14b8a6", "#134e4a"],
  usb: ["#bfdbfe", "#3b82f6", "#1e3a8a"],
  tablet: ["#f5d0fe", "#d946ef", "#701a75"],
  camera: ["#fecaca", "#ef4444", "#7f1d1d"],
  mic: ["#fbcfe8", "#ec4899", "#831843"],
  gamepad: ["#e9d5ff", "#a855f7", "#581c87"],
  keyboard: ["#e2e8f0", "#64748b", "#1e293b"],
  mouse: ["#e7e5e4", "#78716c", "#292524"],
  light: ["#fef08a", "#eab308", "#713f12"],
  car: ["#bfdbfe", "#2563eb", "#172554"],
  package: ["#fde68a", "#d97706", "#78350f"],
};

/**
 * Category icon. "3d" is a product-style illustration (a real phone case,
 * glass, headphones…) on a soft plate in the category colour; used on
 * counter tiles, pickers and filter chips. "plain" is the bare line icon.
 */
export function CategoryIcon({
  icon,
  className,
  variant = "plain",
  size = "md",
}: {
  icon: string;
  className?: string;
  variant?: "plain" | "3d";
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const key = (icon in CATEGORY_ICONS ? icon : "package") as keyof typeof CATEGORY_ICONS;
  const Icon = CATEGORY_ICONS[key];
  if (variant === "plain") return <Icon className={className} aria-hidden />;
  const [light, base, deep] = ICON_TONES[key];
  return (
    <span
      className={clsx("acc-ico3d", `is-${size}`, className)}
      style={{ "--i1": light, "--i2": base, "--i3": deep } as CSSProperties}
      aria-hidden
    >
      <ProductArt kind={key} />
    </span>
  );
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

/** "ok" is the plain dark toast; "success" is the green one for completed sales. */
type Toast = {
  id: number;
  text: string;
  tone: "ok" | "success" | "error";
  action?: { label: string; run: () => void };
  /** Set just before removal so the toast can fade out. */
  leaving?: boolean;
};

const TOAST_FADE_MS = 250;
let toasts: Toast[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();

/* ---------------- sale chime ---------------- */

let audioCtx: AudioContext | null = null;

/**
 * Soft, warm three-note chime (G4 → C5 → E5) so the counter hears a sale
 * went through without a harsh beep: gentle attack, long fade, a quiet
 * octave for a bell-like tone, and a low-pass filter to round it off.
 * Plus a tiny vibration on phones. Made with Web Audio — no sound file.
 */
export function playSuccessSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime + 0.02;

    const warm = ctx.createBiquadFilter();
    warm.type = "lowpass";
    warm.frequency.value = 2200;
    warm.Q.value = 0.4;
    warm.connect(ctx.destination);

    [
      { freq: 392.0, at: 0 },
      { freq: 523.25, at: 0.11 },
      { freq: 659.25, at: 0.22 },
    ].forEach(({ freq, at }, i) => {
      // fundamental + a soft octave partial
      [
        { mult: 1, level: 0.13 },
        { mult: 2, level: 0.035 },
      ].forEach(({ mult, level }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq * mult;
        const t0 = start + at;
        const tail = i === 2 ? 1.25 : 0.9; // last note rings a little longer
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(level, t0 + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tail);
        osc.connect(gain).connect(warm);
        osc.start(t0);
        osc.stop(t0 + tail + 0.05);
      });
    });
    navigator.vibrate?.(30);
  } catch {
    /* sound is a nice-to-have */
  }
}

export function toast(text: string, options: { tone?: Toast["tone"]; action?: Toast["action"]; ms?: number } = {}) {
  if (options.tone === "success") playSuccessSound();
  const id = ++toastSeq;
  toasts = [...toasts.slice(-2), { id, text, tone: options.tone || "ok", action: options.action }];
  toastListeners.forEach((fn) => fn());
  const ms = options.ms ?? 2000;
  window.setTimeout(() => {
    toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
    toastListeners.forEach((fn) => fn());
  }, Math.max(0, ms - TOAST_FADE_MS));
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((fn) => fn());
  }, ms);
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
        <div key={t.id} className={clsx("acc-toast", t.tone === "error" && "is-error", t.tone === "success" && "is-success", t.leaving && "is-leaving")}>
          {t.tone === "success" ? <CheckCircle2 className="acc-toast-icon" aria-hidden /> : null}
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
  className,
  leading,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Extra class on the sheet for screens with their own look (e.g. the sell popup). */
  className?: string;
  /** Picture before the title (e.g. the product's category art). */
  leading?: ReactNode;
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
        className={clsx("acc-sheet", wide && "is-wide", className)}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="acc-sheet-head">
          {leading ? <div className="acc-sheet-leading">{leading}</div> : null}
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

const PERIODS: Array<{ value: AccPeriod; label: string; short?: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yday" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "last30", label: "30 days", short: "30d" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

export function PeriodChips({ value, onChange }: { value: PeriodQuery; onChange: (value: PeriodQuery) => void }) {
  return (
    <div className="acc-period">
      {/* One equal-width bar: every option on one line, phone or laptop. */}
      <div className="acc-period-bar" role="tablist" style={{ "--n": PERIODS.length } as CSSProperties}>
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            role="tab"
            aria-selected={value.period === p.value}
            className={clsx(value.period === p.value && "is-on")}
            onClick={() =>
              onChange(
                p.value === "custom"
                  ? { period: "custom", from: value.from || todayInput(-6), to: value.to || todayInput() }
                  : { period: p.value },
              )
            }
          >
            {p.short ? (
              <>
                <span className="acc-long">{p.label}</span>
                <span className="acc-short">{p.short}</span>
              </>
            ) : (
              p.label
            )}
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

/** Paired download/share controls for a generated PDF. */
export function PdfButton({
  onDownload,
  onShare,
  label,
  actionLabels = false,
  className,
}: {
  onDownload: () => Promise<void>;
  onShare: () => Promise<void>;
  label?: string;
  actionLabels?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const run = useCallback(async (action: "download" | "share") => {
    if (busy) return;
    setBusy(action);
    try {
      await (action === "download" ? onDownload() : onShare());
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast(errorText(err), { tone: "error" });
      }
    } finally {
      setBusy(null);
    }
  }, [busy, onDownload, onShare]);
  return (
    <div className={clsx("acc-pdf-actions", className)}>
      {label ? <span>{label.replace(/\s*PDF\s*/gi, " ").trim()}</span> : null}
      <button type="button" className="acc-icon-btn" onClick={() => void run("download")} disabled={Boolean(busy)} aria-label={`Download${label ? ` ${label}` : " PDF"}`} title="Download">
        {busy === "download" ? <Loader2 className="acc-spin" /> : <FileDown />}
        {actionLabels ? <span>{busy === "download" ? "Preparing…" : "Download"}</span> : null}
      </button>
      <button type="button" className="acc-icon-btn" onClick={() => void run("share")} disabled={Boolean(busy)} aria-label={`Share${label ? ` ${label}` : " PDF"}`} title="Share">
        {busy === "share" ? <Loader2 className="acc-spin" /> : <Share2 />}
        {actionLabels ? <span>{busy === "share" ? "Preparing…" : "Share"}</span> : null}
      </button>
    </div>
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

/** Stock pill. `long` spells it out: "5 in stock", "3 left", "Out of stock". */
export function StockBadge({ qty, low, long = false }: { qty: number; low: number; long?: boolean }) {
  // The trailing words sit in .acc-badge-unit so tight rows can hide them.
  if (qty <= 0)
    return (
      <span className="acc-badge is-red">
        Out{long ? <span className="acc-badge-unit">{"\u00a0"}of stock</span> : null}
      </span>
    );
  if (low > 0 && qty <= low) return <span className="acc-badge is-amber">{qty} left</span>;
  return (
    <span className={clsx("acc-badge", long && "is-ok")}>
      {qty}
      {long ? <span className="acc-badge-unit">{"\u00a0"}in stock</span> : null}
    </span>
  );
}

/** Price ladder for the counter chips when a product has none saved. */
export function suggestPrices(price: number, saved: number[] = []) {
  if (saved.length) return [...new Set(saved)].sort((a, b) => a - b);
  if (price <= 0) return [50, 100, 150, 200, 250, 300];
  const step = price < 100 ? 10 : price < 400 ? 20 : price < 1000 ? 50 : price < 3000 ? 100 : 500;
  const base = Math.round(price / step) * step;
  return [...new Set([base - 2 * step, base - step, price, base + step].filter((n) => n > 0))].sort((a, b) => a - b);
}
