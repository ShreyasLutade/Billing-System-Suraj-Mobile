import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  ImagePlus,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Smartphone,
  Trash2,
  UserRound,
} from "lucide-react";
import clsx from "clsx";
import { CameraCapture } from "../components/CameraCapture";
import { PhoneNameInput } from "../components/PhoneNameInput";
import { PageHeader } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { compressImage, formatBytes } from "../lib/imageCompress";
import { COLOR_OPTIONS, REPAIR_PLATFORMS } from "../lib/repair";
import type { RepairJob, RepairPlatform } from "../types";

type PhotoValue = { blob: Blob; url: string; size: number; type: string };

const EMPTY_FORM = {
  customerPhone: "",
  customerName: "",
  customerAddress: "",
  deviceName: "",
  platform: "" as RepairPlatform | "",
  color: "",
  problemDescription: "",
  estimatedCost: "",
};

type FormState = typeof EMPTY_FORM;
type FieldKey = keyof FormState | "photos";

function validate(form: FormState): { field: FieldKey; message: string } | null {
  if (form.customerPhone.replace(/\D/g, "").length !== 10) {
    return { field: "customerPhone", message: "Enter a valid 10-digit mobile number" };
  }
  if (form.customerName.trim().length < 2) {
    return { field: "customerName", message: "Enter the customer name" };
  }
  if (form.deviceName.trim().length < 2) {
    return { field: "deviceName", message: "Enter the phone name" };
  }
  if (!form.platform) return { field: "platform", message: "Choose iOS or Android" };
  if (!form.color.trim()) return { field: "color", message: "Enter the colour" };
  if (form.problemDescription.trim().length < 3) {
    return { field: "problemDescription", message: "Describe the problem" };
  }
  if (form.estimatedCost.trim()) {
    const amount = Number(form.estimatedCost);
    if (!Number.isFinite(amount) || amount < 0) {
      return { field: "estimatedCost", message: "Enter a valid estimate" };
    }
  }
  return null;
}

/** Tap-to-fill chips with a free-text box for anything not listed. */
function ChipField({
  id,
  label,
  value,
  options,
  placeholder,
  hasError,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  hasError: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className={clsx("rp-field", hasError && "rp-field-error")}>
      <label className="rp-label" htmlFor={id}>
        {label} <em>*</em>
      </label>
      <div className="rp-chips" role="group" aria-label={`${label} presets`}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={clsx("rp-chip", value === option && "is-on")}
            aria-pressed={value === option}
            onClick={() => onChange(value === option ? "" : option)}
          >
            {option}
          </button>
        ))}
      </div>
      <input
        id={id}
        className="rp-input rp-input-sm"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
      />
    </div>
  );
}

function PhotoSlot({
  label,
  hint,
  value,
  busy,
  disabled,
  onOpenCamera,
  onClear,
}: {
  label: string;
  hint: string;
  value: PhotoValue | null;
  busy: boolean;
  disabled: boolean;
  onOpenCamera: () => void;
  onClear: () => void;
}) {
  return (
    <div className="rp-photo-slot">
      {value ? (
        <div className="rp-photo-frame has-photo">
          <img src={value.url} alt={`${label} of the phone`} />
          <span className="rp-photo-size">{formatBytes(value.size)}</span>
          <div className="rp-photo-actions">
            <button type="button" className="rp-photo-action" onClick={onOpenCamera} disabled={disabled}>
              <RefreshCw aria-hidden /> Retake
            </button>
            <button type="button" className="rp-photo-action is-danger" onClick={onClear} disabled={disabled}>
              <Trash2 aria-hidden /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={clsx("rp-photo-frame", busy && "is-busy")}
          onClick={onOpenCamera}
          disabled={disabled || busy}
          aria-label={`Take ${label.toLowerCase()} photo`}
        >
          {busy ? (
            <>
              <Loader2 className="rp-spin" aria-hidden />
              <strong>Compressing…</strong>
            </>
          ) : (
            <>
              <span className="rp-photo-icon">
                <Camera aria-hidden />
              </span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </>
          )}
        </button>
      )}
      <p className="rp-photo-caption">{label}</p>
    </div>
  );
}

export function RepairHomePage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [front, setFront] = useState<PhotoValue | null>(null);
  const [back, setBack] = useState<PhotoValue | null>(null);
  const [busySide, setBusySide] = useState<"front" | "back" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ field: FieldKey | null; message: string } | null>(null);
  const [saved, setSaved] = useState<RepairJob | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [cameraSide, setCameraSide] = useState<"front" | "back" | null>(null);

  // Free photo previews when the page closes.
  const photoUrls = useRef<string[]>([]);
  useEffect(() => () => photoUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  // Returning customer: fill name and location from the shop's customer list.
  const phoneDigits = form.customerPhone.replace(/\D/g, "");
  useEffect(() => {
    if (phoneDigits.length !== 10) {
      setLookupNote(null);
      return;
    }
    const controller = new AbortController();
    api
      .lookupCustomerByPhone(phoneDigits, { signal: controller.signal })
      .then(({ data }) => {
        if (!data) return;
        setForm((current) => ({
          ...current,
          customerName: current.customerName.trim() ? current.customerName : data.customerName,
          customerAddress: current.customerAddress.trim()
            ? current.customerAddress
            : data.customerAddress || "",
        }));
        setLookupNote(`Returning customer · ${data.customerName}`);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [phoneDigits]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (error?.field === key) setError(null);
  }

  function choosePlatform(platform: RepairPlatform) {
    setForm((current) => ({ ...current, platform }));
    if (error?.field === "platform") setError(null);
  }

  async function pickPhoto(side: "front" | "back", file: File) {
    setBusySide(side);
    if (error?.field === "photos") setError(null);
    try {
      const compressed = await compressImage(file);
      const url = URL.createObjectURL(compressed.blob);
      photoUrls.current.push(url);
      const value = { blob: compressed.blob, url, size: compressed.blob.size, type: compressed.type };
      if (side === "front") setFront(value);
      else setBack(value);
    } catch (err) {
      setError({ field: "photos", message: err instanceof Error ? err.message : "Couldn't use that photo" });
    } finally {
      setBusySide(null);
    }
  }

  function focusField(field: FieldKey) {
    const id = field === "platform" ? "rp-platform-IOS" : `rp-${field}`;
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el?.focus({ preventScroll: true }), 250);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setFront(null);
    setBack(null);
    setError(null);
    setLookupNote(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const issue = validate(form);
    if (issue) {
      setError(issue);
      focusField(issue.field);
      return;
    }

    const data = new FormData();
    data.append("customerPhone", phoneDigits);
    data.append("customerName", form.customerName.trim());
    data.append("customerAddress", form.customerAddress.trim());
    data.append("deviceName", form.deviceName.trim());
    data.append("platform", form.platform);
    data.append("color", form.color.trim());
    data.append("problemDescription", form.problemDescription.trim());
    data.append("estimatedCost", form.estimatedCost.trim());
    const ext = (type: string) => (type === "image/webp" ? "webp" : "jpg");
    if (front) data.append("frontPhoto", front.blob, `front.${ext(front.type)}`);
    if (back) data.append("backPhoto", back.blob, `back.${ext(back.type)}`);

    setSaving(true);
    setError(null);
    try {
      const { data: job } = await api.createRepairJob(data);
      setSaved(job);
      resetForm();
      document.querySelector(".babu-main")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError({ field: null, message: err instanceof ApiError ? err.message : "Could not save the repair" });
    } finally {
      setSaving(false);
    }
  }

  const photoBytes = (front?.size ?? 0) + (back?.size ?? 0);

  return (
    <div className="rp-home">
      <PageHeader
        eyebrow="Repair desk"
        title="New repair"
        description="Log the phone in with the customer's details, the problem and photos, so it's all on record when it goes back."
      />

      {saved ? (
        <div className="rp-saved" role="status">
          <CheckCircle2 aria-hidden />
          <div>
            <strong>Saved {saved.jobNumber}</strong>
            <span>
              {saved.customerName} · {saved.deviceName}
            </span>
          </div>
          <Link to={`/repair/${saved.id}`} className="rp-saved-link">
            View <ChevronRight aria-hidden />
          </Link>
          <button type="button" className="rp-saved-close" onClick={() => setSaved(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

      <form className="rp-grid" onSubmit={(event) => void save(event)} noValidate>
        <div className="rp-col">
          <section className="rp-card" aria-labelledby="rp-customer-title">
            <header className="rp-card-head">
              <span className="rp-card-icon">
                <UserRound aria-hidden />
              </span>
              <div>
                <h2 id="rp-customer-title">Customer</h2>
                <p>Type the number first — returning customers fill in automatically.</p>
              </div>
            </header>
            <div className="rp-fields">
              <div className="rp-field">
                <label className="rp-label" htmlFor="rp-customerPhone">
                  Mobile number <em>*</em>
                </label>
                <div className={clsx("rp-input-icon", error?.field === "customerPhone" && "has-error")}>
                  <Phone aria-hidden />
                  <input
                    id="rp-customerPhone"
                    className="rp-input"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={10}
                    placeholder="10-digit mobile"
                    value={form.customerPhone}
                    onChange={(event) => set("customerPhone", event.target.value.replace(/\D/g, "").slice(0, 10))}
                  />
                </div>
                {lookupNote ? (
                  <p className="rp-hint rp-hint-ok">
                    <Check aria-hidden /> {lookupNote}
                  </p>
                ) : null}
              </div>
              <div className="rp-field">
                <label className="rp-label" htmlFor="rp-customerName">
                  Customer name <em>*</em>
                </label>
                <input
                  id="rp-customerName"
                  className={clsx("rp-input", error?.field === "customerName" && "has-error")}
                  autoComplete="name"
                  placeholder="Full name"
                  value={form.customerName}
                  onChange={(event) => set("customerName", event.target.value)}
                />
              </div>
              <div className="rp-field rp-span-2">
                <label className="rp-label" htmlFor="rp-customerAddress">
                  Location <span className="rp-optional">optional</span>
                </label>
                <div className="rp-input-icon">
                  <MapPin aria-hidden />
                  <input
                    id="rp-customerAddress"
                    className="rp-input"
                    placeholder="Village / area / city"
                    value={form.customerAddress}
                    onChange={(event) => set("customerAddress", event.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="rp-card" aria-labelledby="rp-device-title">
            <header className="rp-card-head">
              <span className="rp-card-icon">
                <Smartphone aria-hidden />
              </span>
              <div>
                <h2 id="rp-device-title">Phone</h2>
                <p>Start typing the model to pick it from the list.</p>
              </div>
            </header>
            <div className="rp-fields">
              <div className="rp-field">
                <label className="rp-label" htmlFor="rp-deviceName">
                  Phone name <em>*</em>
                </label>
                <PhoneNameInput
                  id="rp-deviceName"
                  value={form.deviceName}
                  platform={form.platform}
                  hasError={error?.field === "deviceName"}
                  onChange={(value) => {
                    set("deviceName", value);
                    // No phone name → no OS either (it's usually set from the picked model).
                    if (!value.trim()) setForm((current) => ({ ...current, platform: "" }));
                  }}
                  onPickPlatform={choosePlatform}
                />
              </div>
              <div className="rp-field">
                <span className="rp-label" id="rp-platform-label">
                  Operating system <em>*</em>
                </span>
                <div
                  className={clsx("rp-segment", error?.field === "platform" && "has-error")}
                  role="radiogroup"
                  aria-labelledby="rp-platform-label"
                >
                  {REPAIR_PLATFORMS.map((option) => (
                    <button
                      key={option.value}
                      id={`rp-platform-${option.value}`}
                      type="button"
                      role="radio"
                      aria-checked={form.platform === option.value}
                      className={clsx("rp-segment-btn", form.platform === option.value && "is-on")}
                      onClick={() => choosePlatform(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rp-span-2">
                <ChipField
                  id="rp-color"
                  label="Colour"
                  value={form.color}
                  options={COLOR_OPTIONS}
                  placeholder="Or type, e.g. Midnight Purple"
                  hasError={error?.field === "color"}
                  onChange={(value) => set("color", value)}
                />
              </div>
            </div>
          </section>

          <section className="rp-card" aria-labelledby="rp-problem-title">
            <header className="rp-card-head">
              <span className="rp-card-icon">
                <ClipboardList aria-hidden />
              </span>
              <div>
                <h2 id="rp-problem-title">Problem &amp; estimate</h2>
                <p>What the customer says is wrong, and what you quoted.</p>
              </div>
            </header>
            <div className="rp-fields">
              <div className="rp-field rp-span-2">
                <label className="rp-label" htmlFor="rp-problemDescription">
                  Problem <em>*</em>
                </label>
                <textarea
                  id="rp-problemDescription"
                  className={clsx(
                    "rp-input rp-textarea",
                    error?.field === "problemDescription" && "has-error",
                  )}
                  rows={3}
                  placeholder="e.g. Screen not working after a fall, charging port loose"
                  value={form.problemDescription}
                  onChange={(event) => set("problemDescription", event.target.value)}
                />
              </div>
              <div className="rp-field">
                <label className="rp-label" htmlFor="rp-estimatedCost">
                  Estimate <span className="rp-optional">optional</span>
                </label>
                <div
                  className={clsx(
                    "rp-input-icon rp-rupee",
                    error?.field === "estimatedCost" && "has-error",
                  )}
                >
                  <span aria-hidden>₹</span>
                  <input
                    id="rp-estimatedCost"
                    className="rp-input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={form.estimatedCost}
                    onChange={(event) => set("estimatedCost", event.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside className="rp-side">
          <section className="rp-card rp-photos-card" aria-labelledby="rp-photos-title">
            <header className="rp-card-head">
              <span className="rp-card-icon">
                <ImagePlus aria-hidden />
              </span>
              <div>
                <h2 id="rp-photos-title">Photos</h2>
                <p>Front and back, so scratches and cracks are on record.</p>
              </div>
            </header>
            <div className="rp-photos">
              <PhotoSlot
                label="Front"
                hint="Screen side"
                value={front}
                busy={busySide === "front"}
                disabled={saving}
                onOpenCamera={() => setCameraSide("front")}
                onClear={() => setFront(null)}
              />
              <PhotoSlot
                label="Back"
                hint="Camera side"
                value={back}
                busy={busySide === "back"}
                disabled={saving}
                onOpenCamera={() => setCameraSide("back")}
                onClear={() => setBack(null)}
              />
            </div>
            <p className="rp-photo-note">
              {photoBytes
                ? `Compressed to ${formatBytes(photoBytes)} before saving.`
                : "Photos are compressed before saving to keep storage small."}
            </p>
          </section>

          <div className="rp-savebar">
            {error ? (
              <p className="rp-error" role="alert">
                {error.message}
              </p>
            ) : null}
            <div className="rp-savebar-actions">
              <button type="button" className="rp-btn rp-btn-ghost" onClick={resetForm} disabled={saving}>
                Clear
              </button>
              <button type="submit" className="rp-btn rp-btn-primary" disabled={saving || busySide !== null}>
                {saving ? <Loader2 className="rp-spin" aria-hidden /> : <Check aria-hidden />}
                {saving ? "Saving…" : "Save repair"}
              </button>
            </div>
          </div>
        </aside>
      </form>

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
    </div>
  );
}
