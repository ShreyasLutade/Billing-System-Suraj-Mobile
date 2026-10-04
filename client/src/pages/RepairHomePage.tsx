import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  Camera,
  Check,
  ExternalLink,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import clsx from "clsx";
import { CameraCapture } from "../components/CameraCapture";
import { PhoneNameInput } from "../components/PhoneNameInput";
import {
  ImeiScanFieldButton,
  ScanFieldShell,
  scanFieldInputClass,
} from "../components/BarcodeImeiScanner";
import { RepairPhoto } from "../components/RepairPhoto";
import { useFixedBottomBar } from "../hooks/useFixedBottomBar";
import { ApiError, api } from "../lib/api";
import { compressImage, formatBytes } from "../lib/imageCompress";
import { formatRupees, platformLabel } from "../lib/repair";
import type { RepairJob, RepairPlatform } from "../types";
import "../styles/repairIntake.css";

/* New repair intake: customer → phone → problem & delivery, then photos and
   optional extras. One fixed button on phones, a side panel on laptops. */

const PROBLEMS = [
  "Screen broken",
  "Battery",
  "Charging",
  "Not turning on",
  "Speaker / Mic",
  "Camera",
  "Water damage",
  "Back glass",
  "Software",
  "Network",
];

type PhotoValue = { blob: Blob; url: string; size: number; type: string };

const EMPTY = {
  customerPhone: "",
  customerName: "",
  customerAddress: "",
  deviceName: "",
  platform: "" as RepairPlatform | "",
  imei: "",
  problems: [] as string[],
  problemNote: "",
  estimatedCost: "",
  /** yyyy-mm-dd */
  deliveryDate: "",
  lockCode: "",
};
type Form = typeof EMPTY;

type MissingField =
  | "customerPhone"
  | "customerName"
  | "deviceName"
  | "problem"
  | "estimatedCost"
  | "deliveryDate";
type Missing = { field: MissingField; message: string };

function dayKey(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return format(date, "yyyy-MM-dd");
}

const DELIVERY_PRESETS = [
  { label: "Today", offset: 0 },
  { label: "Tomorrow", offset: 1 },
  { label: "2 days", offset: 2 },
  { label: "3 days", offset: 3 },
];

/** iPhone / iPad → iOS, anything else → Android. */
function guessPlatform(name: string): RepairPlatform {
  return /\b(i\s?phone|ipad|apple)\b|^iphone/i.test(name.trim()) ? "IOS" : "ANDROID";
}

/** Saved job → form (edit screen): known problems become chips, the rest the note. */
function formFromJob(job: RepairJob): Form {
  const parts = job.problemDescription
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    customerPhone: job.customerPhone,
    customerName: job.customerName,
    customerAddress: job.customerAddress ?? "",
    deviceName: job.deviceName,
    platform: job.platform,
    imei: job.imei ?? "",
    problems: parts.filter((part) => PROBLEMS.includes(part)),
    problemNote: parts.filter((part) => !PROBLEMS.includes(part)).join(", "),
    estimatedCost: job.estimatedCost != null ? String(job.estimatedCost) : "",
    deliveryDate: job.expectedDeliveryAt ? format(new Date(job.expectedDeliveryAt), "yyyy-MM-dd") : "",
    lockCode: job.lockCode ?? "",
  };
}

function problemText(form: Form) {
  return [...form.problems, form.problemNote.trim()].filter(Boolean).join(", ");
}

function Section({
  num,
  title,
  note,
  done,
  icon: Icon,
  children,
}: {
  num?: number;
  title: string;
  note?: string;
  done?: boolean;
  icon?: typeof Camera;
  children: ReactNode;
}) {
  return (
    <section className={clsx("ri-card", done && "is-done")}>
      <header className="ri-head">
        <span className="ri-num" aria-hidden>
          {done ? <Check /> : Icon ? <Icon /> : num}
        </span>
        <b>{title}</b>
        {note ? <em>{note}</em> : null}
      </header>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={clsx("ri-chip", on && "is-on")} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

export function RepairHomePage() {
  /** Set on /repair/:id/edit: same screen, prefilled, with Update / Cancel. */
  const { id: editId } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<RepairJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  /** Set when the user picks iOS / Android themselves (stop auto-guessing). */
  const [platformManual, setPlatformManual] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);
  const [front, setFront] = useState<PhotoValue | null>(null);
  const [back, setBack] = useState<PhotoValue | null>(null);
  const [busySide, setBusySide] = useState<"front" | "back" | null>(null);
  const [cameraSide, setCameraSide] = useState<"front" | "back" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<Missing | null>(null);
  const [saved, setSaved] = useState<RepairJob | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const bar = useFixedBottomBar(rootRef, barRef);
  const photoUrls = useRef<string[]>([]);
  const fieldRefs = useRef<Partial<Record<MissingField, HTMLElement | null>>>({});
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => photoUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(() => {
    if (!editId) return;
    let active = true;
    api
      .getRepairJob(editId)
      .then(({ data }) => {
        if (!active) return;
        setEditing(data);
        setForm(formFromJob(data));
        setPlatformManual(true);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : "Couldn't load this repair");
      });
    return () => {
      active = false;
    };
  }, [editId]);

  // Any change clears the "fill this" highlight.
  useEffect(() => setMissing(null), [form]);

  // Returning customer: fill name and address from the shop's customer list.
  const phoneDigits = form.customerPhone;
  useEffect(() => {
    if (phoneDigits.length !== 10) {
      setReturning(null);
      return;
    }
    const controller = new AbortController();
    api
      .lookupCustomerByPhone(phoneDigits, { signal: controller.signal })
      .then(({ data }) => {
        if (!data) {
          setReturning(null);
          if (!editId) window.setTimeout(() => nameRef.current?.focus(), 50);
          return;
        }
        setReturning(data.customerName);
        setForm((current) => ({
          ...current,
          customerName: current.customerName.trim() ? current.customerName : data.customerName,
          customerAddress: current.customerAddress.trim()
            ? current.customerAddress
            : data.customerAddress || "",
        }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [phoneDigits, editId]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggle(key: "problems", value: string) {
    setForm((current) => {
      const list = current[key];
      return { ...current, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });
  }

  function setDeviceName(value: string) {
    setForm((current) => ({
      ...current,
      deviceName: value,
      // Typing doesn't set the system: it would filter the model list too early
      // ("ipho" isn't recognisably an iPhone yet). Picking a model or tapping
      // iOS / Android sets it; otherwise it's guessed when saving.
      platform: value.trim() && platformManual ? current.platform : "",
    }));
    if (!value.trim()) setPlatformManual(false);
  }

  async function pickPhoto(side: "front" | "back", file: File) {
    setBusySide(side);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const url = URL.createObjectURL(compressed.blob);
      photoUrls.current.push(url);
      const value = { blob: compressed.blob, url, size: compressed.blob.size, type: compressed.type };
      if (side === "front") setFront(value);
      else setBack(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't use that photo");
    } finally {
      setBusySide(null);
    }
  }

  /* ---------- Progress & checks ---------- */
  const customerDone = form.customerPhone.length === 10 && form.customerName.trim().length >= 2;
  const phoneDone = form.deviceName.trim().length >= 2;
  const problemDone = problemText(form).length >= 3;
  const today = dayKey(0);

  function firstMissing(): Missing | null {
    if (form.customerPhone.length !== 10) {
      return { field: "customerPhone", message: "Enter the 10-digit mobile number" };
    }
    if (form.customerName.trim().length < 2) return { field: "customerName", message: "Enter the customer name" };
    if (!phoneDone) return { field: "deviceName", message: "Enter the phone model" };
    if (!problemDone) return { field: "problem", message: "Pick the problem or describe it" };
    if (form.estimatedCost.trim()) {
      const amount = Number(form.estimatedCost);
      if (!Number.isFinite(amount) || amount < 0) {
        return { field: "estimatedCost", message: "Enter valid estimate charges" };
      }
    }
    const originalDate = editing ? formFromJob(editing).deliveryDate : "";
    if (form.deliveryDate && form.deliveryDate < today && form.deliveryDate !== originalDate) {
      return { field: "deliveryDate", message: "Delivery date can't be in the past" };
    }
    return null;
  }

  function showMissing(next: Missing) {
    const target = fieldRefs.current[next.field];
    setMissing(null);
    window.requestAnimationFrame(() => setMissing(next));
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = target.matches("input, textarea, button")
      ? target
      : target.querySelector<HTMLElement>("input, textarea, button");
    focusable?.focus({ preventScroll: true });
  }

  function note(field: MissingField) {
    return missing?.field === field ? (
      <p className="ri-missing" role="alert">
        {missing.message}
      </p>
    ) : null;
  }

  const attention = (field: MissingField) => missing?.field === field && "is-attention";
  const refFor = (field: MissingField) => (el: HTMLElement | null) => {
    fieldRefs.current[field] = el;
  };

  /** Close the "created" sheet; the job is saved, so start a fresh form. */
  function closeSaved() {
    setSaved(null);
    reset();
  }

  // Escape closes the "created" sheet too.
  useEffect(() => {
    if (!saved) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSaved(null);
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saved]);

  function reset() {
    setForm(EMPTY);
    setPlatformManual(false);
    setReturning(null);
    setFront(null);
    setBack(null);
    setError(null);
    setMissing(null);
    document.querySelector(".babu-main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    const empty = firstMissing();
    if (empty) {
      showMissing(empty);
      return;
    }
    if (editId) {
      await update();
      return;
    }
    const data = new FormData();
    data.append("customerPhone", form.customerPhone);
    data.append("customerName", form.customerName.trim());
    data.append("customerAddress", form.customerAddress.trim());
    data.append("deviceName", form.deviceName.trim());
    data.append("platform", form.platform || guessPlatform(form.deviceName));
    data.append("imei", form.imei.trim());
    data.append("problemDescription", problemText(form));
    data.append("estimatedCost", form.estimatedCost.trim());
    data.append("expectedDeliveryAt", form.deliveryDate);
    data.append("lockCode", form.lockCode.trim());
    const ext = (type: string) => (type === "image/webp" ? "webp" : "jpg");
    if (front) data.append("frontPhoto", front.blob, `front.${ext(front.type)}`);
    if (back) data.append("backPhoto", back.blob, `back.${ext(back.type)}`);

    setSaving(true);
    setError(null);
    try {
      const { data: job } = await api.createRepairJob(data);
      setSaved(job);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the repair");
    } finally {
      setSaving(false);
    }
  }

  /** Edit screen: save the details, upload any retaken photos, back to the job. */
  async function update() {
    if (!editId) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateRepairJob(editId, {
        customerPhone: form.customerPhone,
        customerName: form.customerName.trim(),
        customerAddress: form.customerAddress.trim(),
        deviceName: form.deviceName.trim(),
        platform: form.platform || guessPlatform(form.deviceName),
        imei: form.imei.trim(),
        problemDescription: problemText(form),
        estimatedCost: form.estimatedCost.trim(),
        expectedDeliveryAt: form.deliveryDate,
        lockCode: form.lockCode.trim(),
      });
      if (front) await api.uploadRepairPhoto(editId, "front", front.blob, front.type);
      if (back) await api.uploadRepairPhoto(editId, "back", back.blob, back.type);
      navigate(`/repair/${editId}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the repair");
      setSaving(false);
    }
  }

  const steps = [customerDone, phoneDone, problemDone];
  const saveButton = (
    <div
      ref={barRef}
      className={clsx("ri-cta-bar", bar.mobile && "is-fixed")}
      style={bar.mobile ? { left: 0, width: "100vw", bottom: bar.bottom } : undefined}
    >
      {error ? (
        <p className="ri-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className={clsx(editId && "ri-cta-pair")}>
        {editId ? (
          <Link to={`/repair/${editId}`} className="ri-cta is-ghost">
            Cancel
          </Link>
        ) : null}
        <button
          type="button"
          className={clsx("ri-cta", !editId && "is-create")}
          onClick={() => void save()}
          disabled={saving || busySide !== null || (Boolean(editId) && !editing)}
        >
          {saving ? <Loader2 className="ri-spin" aria-hidden /> : <Check aria-hidden />}
          {saving ? "Saving…" : editId ? "Update" : "Create job sheet"}
        </button>
      </div>
    </div>
  );

  if (loadError) return <p className="ri-load-error">{loadError}</p>;

  return (
    <div className="ri" ref={rootRef}>
      <div className="ri-top">
        <div className="ri-title">
          <h1>{editId ? "Edit repair" : "New repair"}</h1>
          <small>{editId ? editing?.jobNumber ?? "Loading…" : "Takes under a minute"}</small>
        </div>
        {editId ? (
          <Link to={`/repair/${editId}`} className="ri-icon-btn" aria-label="Cancel editing">
            <X aria-hidden />
          </Link>
        ) : null}
      </div>
      <div className="ri-progress" aria-hidden>
        {steps.map((done, index) => (
          <i key={index} className={clsx(done && "is-on")} />
        ))}
      </div>

      <div className="ri-layout">
        <div className="ri-main">
          {/* 1 · Customer */}
          <Section num={1} title="Customer" done={customerDone}>
            <div
              ref={refFor("customerPhone")}
              className={clsx("ri-field is-big", attention("customerPhone"))}
            >
              <span className="ri-pre">+91</span>
              <input
                className="bg-transparent"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={10}
                placeholder="Mobile number"
                aria-label="Customer mobile number"
                value={form.customerPhone}
                onChange={(event) => set("customerPhone", event.target.value.replace(/\D/g, "").slice(0, 10))}
              />
              {form.customerPhone.length === 10 ? <Check className="ri-ok" aria-hidden /> : null}
            </div>
            {note("customerPhone")}
            {!editId && form.customerPhone.length === 10 && !returning ? (
              <p className="ri-new">
                <Sparkles aria-hidden /> New customer — add their name
              </p>
            ) : null}

            <div className="ri-grid2">
              <div>
                <label className="ri-lbl" htmlFor="ri-name">
                  Customer name
                </label>
                <div ref={refFor("customerName")} className={clsx("ri-field", attention("customerName"))}>
                  <UserRound className="ri-lead" aria-hidden />
                  <input
                    ref={nameRef}
                    id="ri-name"
                    className="bg-transparent"
                    autoComplete="name"
                    placeholder="Full name"
                    value={form.customerName}
                    onChange={(event) => set("customerName", event.target.value)}
                  />
                </div>
                {note("customerName")}
              </div>
              <div>
                <label className="ri-lbl" htmlFor="ri-address">
                  Address <em>optional</em>
                </label>
                <div className="ri-field">
                  <MapPin className="ri-lead" aria-hidden />
                  <input
                    id="ri-address"
                    className="bg-transparent"
                    placeholder="Village / area / city"
                    value={form.customerAddress}
                    onChange={(event) => set("customerAddress", event.target.value)}
                  />
                </div>
              </div>
            </div>
          </Section>

          {/* 2 · Phone */}
          <Section num={2} title="Phone" done={phoneDone}>
            <div ref={refFor("deviceName")} className={clsx("ri-model", attention("deviceName"))}>
              <PhoneNameInput
                id="ri-model"
                value={form.deviceName}
                platform={form.platform}
                hasError={missing?.field === "deviceName"}
                onChange={setDeviceName}
                onPickPlatform={(platform) => set("platform", platform)}
              />
            </div>
            {note("deviceName")}
            {form.deviceName.trim() ? (
              <div className="ri-os" role="radiogroup" aria-label="Operating system">
                <span>System</span>
                {(["IOS", "ANDROID"] as const).map((platform) => (
                  <Chip
                    key={platform}
                    on={(form.platform || guessPlatform(form.deviceName)) === platform}
                    onClick={() => {
                      setPlatformManual(true);
                      set("platform", platform);
                    }}
                  >
                    {platformLabel(platform)}
                  </Chip>
                ))}
              </div>
            ) : null}

            <label className="ri-lbl" htmlFor="ri-imei">
              IMEI / Serial <em>scan or type · optional</em>
            </label>
            <ScanFieldShell className="ri-scan">
              <input
                id="ri-imei"
                className={clsx(scanFieldInputClass, "!font-sans font-semibold")}
                autoComplete="off"
                inputMode="text"
                placeholder="Scan the barcode or type the IMEI"
                value={form.imei}
                onChange={(event) => set("imei", event.target.value.trim())}
              />
              <ImeiScanFieldButton onScan={(value) => set("imei", value)} />
            </ScanFieldShell>

            <label className="ri-lbl" htmlFor="ri-lock">
              Screen lock / passcode <em>for testing · optional</em>
            </label>
            <div className="ri-field">
              <input
                id="ri-lock"
                className="bg-transparent"
                autoComplete="off"
                placeholder="PIN or pattern"
                value={form.lockCode}
                onChange={(event) => set("lockCode", event.target.value)}
              />
            </div>
          </Section>

          {/* 3 · Problem, estimate & delivery */}
          <Section num={3} title="Problem & delivery" done={problemDone}>
            <div ref={refFor("problem")} className={clsx("ri-chips is-compact", attention("problem"))}>
              {PROBLEMS.map((problem) => (
                <Chip key={problem} on={form.problems.includes(problem)} onClick={() => toggle("problems", problem)}>
                  {problem}
                </Chip>
              ))}
            </div>
            <textarea
              className="ri-textarea"
              rows={2}
              placeholder="Anything else? Describe the problem (optional if picked above)"
              value={form.problemNote}
              onChange={(event) => set("problemNote", event.target.value)}
            />
            {note("problem")}

            <div className="ri-grid2">
              <div>
                <label className="ri-lbl" htmlFor="ri-estimate">
                  Estimate charges <em>optional</em>
                </label>
                <div ref={refFor("estimatedCost")} className={clsx("ri-field", attention("estimatedCost"))}>
                  <span className="ri-rupee" aria-hidden>
                    ₹
                  </span>
                  <input
                    id="ri-estimate"
                    className="bg-transparent"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="0"
                    value={form.estimatedCost}
                    onChange={(event) => set("estimatedCost", event.target.value)}
                  />
                </div>
                {note("estimatedCost")}
              </div>
              <div>
                <label className="ri-lbl" htmlFor="ri-delivery">
                  Delivery by <em>optional</em>
                </label>
                <div ref={refFor("deliveryDate")} className={clsx("ri-field", attention("deliveryDate"))}>
                  <input
                    id="ri-delivery"
                    className="bg-transparent"
                    type="date"
                    min={today}
                    value={form.deliveryDate}
                    onChange={(event) => set("deliveryDate", event.target.value)}
                  />
                </div>
                {note("deliveryDate")}
              </div>
            </div>
            <div className="ri-dates" aria-label="Quick delivery dates">
              {DELIVERY_PRESETS.map((preset) => {
                const key = dayKey(preset.offset);
                return (
                  <Chip
                    key={preset.label}
                    on={form.deliveryDate === key}
                    onClick={() => set("deliveryDate", form.deliveryDate === key ? "" : key)}
                  >
                    {preset.label}
                  </Chip>
                );
              })}
            </div>
          </Section>
        </div>

        <aside className="ri-side">
          {/* Photos + optional extras */}
          <Section icon={Camera} title="Photos" note="Recommended">
            <div className="ri-photos">
              {(["front", "back"] as const).map((side) => {
                const value = side === "front" ? front : back;
                const label = side === "front" ? "Front" : "Back";
                return value ? (
                  <div key={side} className="ri-shot has-photo">
                    <img src={value.url} alt={`${label} of the phone`} />
                    <span className="ri-shot-tag">
                      {label} · {formatBytes(value.size)}
                    </span>
                    <div className="ri-shot-actions">
                      <button type="button" onClick={() => setCameraSide(side)} aria-label={`Retake ${label}`}>
                        <RefreshCw aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => (side === "front" ? setFront(null) : setBack(null))}
                        aria-label={`Remove ${label}`}
                      >
                        <Trash2 aria-hidden />
                      </button>
                    </div>
                  </div>
                ) : editing && (side === "front" ? editing.hasFrontPhoto : editing.hasBackPhoto) ? (
                  <div key={side} className="ri-shot has-photo">
                    <RepairPhoto
                      jobId={editing.id}
                      side={side}
                      available
                      alt={`${label} of the phone`}
                      className="ri-shot-saved"
                    />
                    <span className="ri-shot-tag">{label} · saved</span>
                    <div className="ri-shot-actions">
                      <button type="button" onClick={() => setCameraSide(side)} aria-label={`Retake ${label}`}>
                        <RefreshCw aria-hidden />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    key={side}
                    type="button"
                    className="ri-shot"
                    disabled={busySide !== null || saving}
                    onClick={() => setCameraSide(side)}
                  >
                    {busySide === side ? (
                      <Loader2 className="ri-spin" aria-hidden />
                    ) : (
                      <span className="ri-cam">
                        <Camera aria-hidden />
                      </span>
                    )}
                    <b>{busySide === side ? "Compressing…" : label}</b>
                    <small>{side === "front" ? "Screen side" : "Camera side"}</small>
                  </button>
                );
              })}
            </div>

          </Section>

          {/* Laptop: summary + save in the side panel. Phones: fixed bar. */}
          {!bar.mobile ? (
            <div className="ri-card ri-summary">
              <p className="ri-sum-title">Summary</p>
              <dl>
                <div>
                  <dt>Customer</dt>
                  <dd>{form.customerName.trim() || "—"}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{form.deviceName.trim() || "—"}</dd>
                </div>
                <div>
                  <dt>Problem</dt>
                  <dd>{problemText(form) || "—"}</dd>
                </div>
                <div>
                  <dt>Estimate charges</dt>
                  <dd>{Number(form.estimatedCost) > 0 ? formatRupees(Number(form.estimatedCost)) : "—"}</dd>
                </div>
                <div>
                  <dt>Delivery</dt>
                  <dd>
                    {form.deliveryDate ? format(new Date(`${form.deliveryDate}T00:00`), "EEE, d MMM") : "—"}
                  </dd>
                </div>
              </dl>
              {saveButton}
            </div>
          ) : null}
        </aside>
      </div>

      {bar.mobile ? (
        <>
          <div aria-hidden style={{ height: bar.height + 12 }} />
          {/* On <body> so "fixed" means the screen, not a page wrapper. */}
          {saved ? null : createPortal(<div className="ri ri-portal">{saveButton}</div>, document.body)}
        </>
      ) : null}

      {cameraSide ? (
        <CameraCapture
          title={cameraSide === "front" ? "Front of the phone" : "Back of the phone"}
          onClose={() => setCameraSide(null)}
          onCapture={(file) => {
            const side = cameraSide;
            setCameraSide(null);
            void pickPhoto(side, file);
          }}
        />
      ) : null}

      {saved
        ? createPortal(
            // On <body>, above everything (incl. the fixed save bar). Tap outside to close.
            <div className="ri ri-portal">
              <div
                className="ri-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ri-done-title"
                onClick={closeSaved}
              >
                <div className="ri-sheet" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="ri-sheet-close" aria-label="Close" onClick={closeSaved}>
                    <X aria-hidden />
                  </button>
                  <span className="ri-done-icon">
                    <Check aria-hidden />
                  </span>
                  <h2 id="ri-done-title">Job sheet created</h2>
                  <span className="ri-jid">{saved.jobNumber}</span>
                  <p>
                    {saved.customerName} · {saved.deviceName}
                    {saved.estimatedCost ? ` · Est. ${formatRupees(saved.estimatedCost)}` : ""}
                    {saved.expectedDeliveryAt
                      ? ` · Ready by ${format(new Date(saved.expectedDeliveryAt), "d MMM")}`
                      : ""}
                  </p>
                  <Link className="ri-btn is-primary ri-sheet-view" to={`/repair/${saved.id}`}>
                    <ExternalLink aria-hidden /> View job sheet
                  </Link>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
