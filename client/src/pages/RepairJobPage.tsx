import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
  ArrowLeft,
  Banknote,
  Check,
  ChevronDown,
  CalendarDays,
  Clock,
  Hammer,
  Image as ImageIcon,
  Loader2,
  Package,
  Phone,
  Plus,
  Printer,
  QrCode,
  Share2,
  ShoppingBag,
  SquarePen,
  Smartphone,
  Trash2,
  Undo2,
  Wrench,
  X,
} from "lucide-react";
import clsx from "clsx";
import { ApiError, api, fetchBackend } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { conditionLabel, formatRupees, MAIN_REPAIR_SHOP, platformLabel, repairShopLabel } from "../lib/repair";
import { compressImage } from "../lib/imageCompress";
import { RepairPhoto } from "../components/RepairPhoto";
import { DangerConfirmModal, RECYCLE_BIN_DAYS } from "../components/RemoveConfirmModals";
import type { RepairJob, RepairOutcome, RepairPaymentMethod } from "../types";
import "../styles/repairJob.css";

/* Job sheet: one screen that walks the repairman through
   Received → Repaired / Not fixed → Delivered / Returned. */

const PAYMENTS: Array<{ value: RepairPaymentMethod; label: string; icon: typeof Banknote }> = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "UPI", label: "UPI", icon: QrCode },
];
/** CARD only appears on older jobs; new ones are Cash or UPI / Online. */
const PAYMENT_LABEL: Record<RepairPaymentMethod, string> = { CASH: "Cash", UPI: "UPI / Online", CARD: "Card" };
const UNDO_MS = 5000;

/** A field the bottom button found empty: scrolled to, focused and highlighted. */
type MissingField = "outcome" | "charge" | "pickupName" | "pickupPhone" | "pay";
type Missing = { field: MissingField; message: string };

/** What the repairman is filling in on step 2 (kept locally until saved). */
type Draft = {
  outcome: RepairOutcome | null;
  /** Typed final charge (fixed) or the chosen checking fee (not fixed). */
  charge: string;
  /** Admins only: the shop's cost. */
  cost: string;
  /** Work done (fixed) or the reason (not fixed). */
  note: string;
};

/** Work done / reason text: older jobs may also have picked chips (workDone). */
function workText(job: RepairJob) {
  return [job.workDone, job.repairNotes].filter(Boolean).join(" — ");
}

/** Draft from what the job already has (used on load and when editing the result). */
function draftFromJob(job: RepairJob): Draft {
  return {
    outcome: job.outcome,
    charge:
      job.finalCharge != null
        ? String(job.finalCharge)
        : job.outcome === "NOT_FIXED"
          ? "0"
          : job.estimatedCost != null
            ? String(job.estimatedCost)
            : "",
    note: job.repairNotes ?? "",
    cost: job.costPrice != null ? String(job.costPrice) : "",
  };
}

function when(iso: string | null) {
  return iso ? format(new Date(iso), "d MMM, h:mm a") : null;
}

function amountOf(text: string) {
  const value = Number(text);
  return text.trim() && Number.isFinite(value) && value >= 0 ? value : null;
}

/** 0 received, 1 in repair, 2 repaired / not fixed, 3 delivered / returned. */
function stepOf(job: RepairJob) {
  return { RECEIVED: 0, IN_REPAIR: 1, REPAIRED: 2, DELIVERED: 3 }[job.status];
}

function StatusPill({ job }: { job: RepairJob }) {
  const fixed = job.outcome !== "NOT_FIXED";
  if (job.status === "RECEIVED") return <span className="rj-pill is-neutral">Received</span>;
  if (job.status === "IN_REPAIR") return <span className="rj-pill is-warn">In repair</span>;
  if (job.status === "REPAIRED") {
    return fixed ? (
      <span className="rj-pill is-info">Ready for pickup</span>
    ) : (
      <span className="rj-pill is-bad">Not fixed · return</span>
    );
  }
  return <span className="rj-pill is-ok">{fixed ? "Delivered" : "Returned"}</span>;
}

function Tracker({ job }: { job: RepairJob }) {
  const step = stepOf(job);
  const failed = job.outcome === "NOT_FIXED" && step > 1;
  const nodes = [
    { label: "Received", icon: Package, time: job.createdAt },
    { label: "In repair", icon: Hammer, time: job.startedAt },
    { label: failed ? "Not fixed" : "Repaired", icon: failed ? X : Wrench, time: job.repairedAt },
    {
      label: job.outcome === "NOT_FIXED" && step > 2 ? "Returned" : "Delivered",
      icon: ShoppingBag,
      time: job.deliveredAt,
    },
  ];
  return (
    <ol className="rj-card rj-tracker" aria-label="Repair progress">
      <div className="rj-track-line" aria-hidden>
        <div className={clsx("rj-track-fill", failed && "is-fail")} style={{ width: `${(step / 3) * 100}%` }} />
      </div>
      {nodes.map((node, index) => {
        const state =
          index <= step ? (index === 2 && failed ? "fail" : "done") : index === step + 1 ? "current" : "todo";
        const Icon = state === "done" ? Check : node.icon;
        return (
          <li key={node.label} className={clsx("rj-node", `is-${state}`)} aria-current={state === "current" ? "step" : undefined}>
            <span className="rj-dot">
              <Icon aria-hidden />
            </span>
            <b>{node.label}</b>
            <small>{when(index <= step ? node.time : null) ?? (state === "current" ? "Next step" : "Pending")}</small>
          </li>
        );
      })}
    </ol>
  );
}

function Accordion({
  icon: Icon,
  title,
  summary,
  open,
  children,
}: {
  icon: typeof Package;
  title: string;
  summary: string;
  /** Laptop starts with details expanded; phones start collapsed. */
  open: boolean;
  children: ReactNode;
}) {
  return (
    <details className="rj-acc" open={open}>
      <summary>
        <span className="rj-acc-icon">
          <Icon aria-hidden />
        </span>
        <span className="rj-acc-title">
          <b>{title}</b>
          <span>{summary}</span>
        </span>
        <ChevronDown className="rj-acc-chev" aria-hidden />
      </summary>
      {children}
    </details>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function RepairJobPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<RepairJob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pay, setPay] = useState<RepairPaymentMethod | null>(null);
  /** Who collects the phone: the customer (default) or someone else. */
  const [pickup, setPickup] = useState({ same: true, name: "", phone: "" });
  /** Hand-over: amount actually collected (starts at the final charge; can be bargained down). */
  const [dueText, setDueText] = useState("");
  const { isAdmin, repairOnly } = useAuth();
  /** Admin cost box after the repair step. */
  const [costText, setCostText] = useState("");
  const [costSaving, setCostSaving] = useState(false);
  const [costSaved, setCostSaved] = useState(false);
  /** Highlighted after tapping the bottom button with something still empty. */
  const [missing, setMissing] = useState<Missing | null>(null);
  const outcomeRef = useRef<HTMLDivElement | null>(null);
  const chargeRef = useRef<HTMLInputElement | null>(null);
  const pickupNameRef = useRef<HTMLInputElement | null>(null);
  const pickupPhoneRef = useRef<HTMLInputElement | null>(null);
  const payRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Shown for a few seconds after a step, with Undo. */
  const [toast, setToast] = useState<{ message: string; undo: () => Promise<void> } | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState<"front" | "back" | null>(null);
  const [sharing, setSharing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  /**
   * Phones (bottom nav visible): the next-step button is fixed over the page
   * column, right above the nav. Laptop: it sits in the left column.
   */
  const [bar, setBar] = useState(() => ({
    mobile: typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
    left: 0,
    width: 0,
    bottom: 0,
    height: 0,
  }));

  useEffect(() => {
    let active = true;
    setJob(null);
    setDraft(null);
    setLoadError(null);
    api
      .getRepairJob(id)
      .then(({ data }) => {
        if (!active) return;
        setJob(data);
        setDraft(draftFromJob(data));
        setPay(data.paymentMethod);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : "Couldn't load this repair");
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // Admin cost box follows the saved value.
  const savedCost = job?.costPrice;
  useEffect(() => {
    setCostText(savedCost != null ? String(savedCost) : "");
    setCostSaved(false);
  }, [savedCost, job?.id]);

  // Cost price is optional: a missing one is flagged in the Tracker. Opening
  // the job from that yellow card jumps here and outlines the box in red.
  const costRef = useRef<HTMLInputElement | null>(null);
  const location = useLocation();
  const fromPendingCard = Boolean((location.state as { focusCost?: boolean } | null)?.focusCost);
  const highlightCost = fromPendingCard && Boolean(job?.costPending);
  useEffect(() => {
    if (!highlightCost) return;
    const timer = window.setTimeout(() => {
      costRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      costRef.current?.focus({ preventScroll: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [highlightCost, job?.id]);

  // The highlight goes as soon as the user fills or changes something.
  useEffect(() => {
    setMissing(null);
  }, [draft, pickup, pay, job?.status]);

  // Every time a job arrives at the hand-over step (marked repaired, a delivery
  // undone, or the page opened) start clean: the user picks Cash / UPI and who
  // is collecting themselves — nothing carried over from before.
  const jobId = job?.id;
  const jobStatus = job?.status;
  const jobFinal = job?.finalCharge;
  useEffect(() => {
    if (jobStatus !== "REPAIRED") return;
    setPay(null);
    setPickup({ same: true, name: "", phone: "" });
    setDueText(jobFinal != null ? String(jobFinal) : "0");
  }, [jobId, jobStatus, jobFinal]);

  const loaded = Boolean(job && draft);
  // The bottom button is position:fixed, so line it up with the page column and
  // sit it exactly on top of the phone's bottom nav (0 on desktop, no nav).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!loaded || !root) return;
    const nav = document.querySelector<HTMLElement>(".babu-mobile-nav");
    const measure = () => {
      const box = root.getBoundingClientRect();
      const navHeight =
        nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().height : 0;
      const height = barRef.current?.getBoundingClientRect().height ?? 0;
      const mobile = navHeight > 0;
      setBar((current) =>
        current.mobile === mobile &&
        current.left === box.left &&
        current.width === box.width &&
        current.bottom === navHeight &&
        current.height === height
          ? current
          : { mobile, left: box.left, width: box.width, bottom: navHeight, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (nav) observer.observe(nav);
    if (barRef.current) observer.observe(barRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [loaded]);

  useEffect(() => {
    if (!zoomUrl) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomUrl]);

  function showToast(message: string, undo: () => Promise<void>) {
    window.clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), UNDO_MS);
  }

  async function save(payload: Parameters<typeof api.updateRepairStatus>[1]) {
    if (!job) return null;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.updateRepairStatus(job.id, payload);
      setJob(data);
      return data;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the job");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function deleteJob() {
    if (!job || !isAdmin) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deleteRepairJob(job.id);
      navigate("/repair/history", { replace: true });
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Couldn't delete this repair job");
      setDeleteBusy(false);
    }
  }

  function scrollTop() {
    document.querySelector(".babu-main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loadError) return <p className="rj-empty">{loadError}</p>;
  if (!job || !draft) return <p className="rj-empty">Loading…</p>;

  const step = stepOf(job);
  const fixedDraft = draft.outcome === "FIXED";
  const draftCharge = amountOf(draft.charge);
  const jobCharge = job.finalCharge ?? 0;
  /** What's collected at hand-over (may be bargained below the final charge). */
  const dueAmount =
    step === 2
      ? ((value) => (dueText.trim() && Number.isFinite(value) && value >= 0 ? value : 0))(Number(dueText))
      : jobCharge;
  const jobFixed = job.outcome === "FIXED";
  const phoneHref = `tel:+91${job.customerPhone}`;

  function update(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function chooseOutcome(outcome: RepairOutcome) {
    if (!job || draft?.outcome === outcome) return;
    update({
      outcome,
      charge: outcome === "FIXED" ? (job.estimatedCost != null ? String(job.estimatedCost) : "") : "0",
      // Cost price is only for repaired phones.
      ...(outcome === "NOT_FIXED" ? { cost: "" } : {}),
    });
  }

  /** First empty required field on this step, top to bottom (null = ready). */
  function firstMissing(): Missing | null {
    if (!draft) return null;
    if (step === 1) {
      if (!draft.outcome) return { field: "outcome", message: "Choose Fixed or Couldn't fix" };
      if (draft.outcome === "FIXED" && !draftCharge) {
        return { field: "charge", message: "Enter the final charge" };
      }
    }
    if (step === 2) {
      if (!pickup.same && pickup.name.trim().length < 2) {
        return { field: "pickupName", message: "Enter the name of the person collecting" };
      }
      if (!pickup.same && pickup.phone.length !== 10) {
        return { field: "pickupPhone", message: "Enter their 10-digit mobile number" };
      }
      if (dueAmount > 0 && !pay) return { field: "pay", message: "Choose Cash or UPI / Online" };
    }
    return null;
  }

  /** Scroll to the empty field, focus it and highlight it (shake restarts each tap). */
  function showMissing(next: Missing) {
    const target = {
      outcome: outcomeRef,
      charge: chargeRef,
      pickupName: pickupNameRef,
      pickupPhone: pickupPhoneRef,
      pay: payRef,
    }[next.field].current;
    setMissing(null);
    window.requestAnimationFrame(() => setMissing(next));
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable =
      target instanceof HTMLInputElement ? target : target.querySelector<HTMLElement>("button");
    focusable?.focus({ preventScroll: true });
  }

  /** The bottom button: move the job one step forward. */
  async function advance() {
    if (!job || !draft) return;
    const empty = firstMissing();
    if (empty) {
      showMissing(empty);
      return;
    }
    if (step === 3) {
      navigate("/repair");
      return;
    }
    if (step === 0) {
      const saved = await save({ status: "IN_REPAIR" });
      if (!saved) return;
      showToast("Repair started", async () => {
        await save({ status: "RECEIVED" });
      });
    } else if (step === 1) {
      if (!draft.outcome) return;
      const saved = await save({
        status: "REPAIRED",
        outcome: draft.outcome,
        finalCharge: draftCharge ?? 0,
        repairNotes: draft.note.trim(),
        ...(isAdmin && draft.outcome === "FIXED" && draft.cost.trim()
          ? { costPrice: Number(draft.cost) }
          : {}),
      });
      if (!saved) return;
      showToast(saved.outcome === "FIXED" ? "Marked as repaired" : "Marked as couldn't fix", async () => {
        await save({ status: "IN_REPAIR" });
      });
    } else {
      const saved = await save({
        status: "DELIVERED",
        // The agreed amount becomes the final charge.
        finalCharge: dueAmount,
        ...(dueAmount > 0 && pay ? { paymentMethod: pay } : {}),
        ...(pickup.same ? {} : { pickupName: pickup.name.trim(), pickupPhone: pickup.phone }),
      });
      if (!saved) return;
      showToast(jobFixed ? "Delivered to customer" : "Returned to customer", async () => {
        await save({ status: "REPAIRED" });
      });
    }
    scrollTop();
  }

  async function undo() {
    if (!toast) return;
    const action = toast.undo;
    window.clearTimeout(toastTimer.current);
    setToast(null);
    await action();
  }

  /** Back to In repair to change the result, keeping what was entered. */
  async function editResult() {
    if (!job) return;
    setDraft(draftFromJob(job));
    await save({ status: "IN_REPAIR" });
  }

  async function addPhoto(side: "front" | "back", file: File) {
    if (!job) return;
    setPhotoBusy(side);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const { data } = await api.uploadRepairPhoto(job.id, side, compressed.blob, compressed.type);
      setJob(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the photo");
    } finally {
      setPhotoBusy(null);
    }
  }

  async function shareSlip() {
    if (!job) return;
    setSharing(true);
    setError(null);
    try {
      const response = await fetchBackend(api.repairSlipUrl(job.id));
      if (!response.ok) throw new ApiError("Couldn't load the repair slip", response.status);
      const file = new File([await response.blob()], `${job.jobNumber}.pdf`, { type: "application/pdf" });
      const shareData: ShareData = { title: `Repair slip ${job.jobNumber}`, files: [file] };
      if (typeof navigator.share !== "function" || (navigator.canShare && !navigator.canShare(shareData))) {
        window.location.assign(api.repairSlipUrl(job.id, true));
        return;
      }
      await navigator.share(shareData);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Couldn't share the slip");
    } finally {
      setSharing(false);
    }
  }

  async function saveCost() {
    if (!job) return;
    const text = costText.trim();
    const value = text ? Number(text) : null;
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      setError("Enter a valid cost price");
      return;
    }
    setCostSaving(true);
    setError(null);
    try {
      const { data } = await api.setRepairCost(job.id, value);
      setJob(data);
      setCostSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the cost price");
    } finally {
      setCostSaving(false);
    }
  }

  /** Admin only, after the repair is recorded: the shop's cost (red while pending). */
  const costBox =
    !isAdmin || job.outcome !== "FIXED" ? null : job.costPrice != null ? (
      // Already entered: just a small read-only line.
      <p className="rj-cost-info">
        <span>Cost price</span>
        <b>{formatRupees(job.costPrice)}</b>
        <span className="rj-cost-sep">·</span>
        <span>Profit</span>
        <b className={jobCharge - job.costPrice < 0 ? "is-loss" : "is-profit"}>
          {formatRupees(jobCharge - job.costPrice)}
        </b>
      </p>
    ) : (
      <div className={clsx("rj-cost", highlightCost && "is-pending")}>
        <label className="rj-label" htmlFor="rj-cost-after">
          Cost price{" "}
          <em>optional · only you see this</em>
        </label>
        <div className="rj-cost-row">
          <div className={clsx("rj-money", highlightCost && "is-attention-static")}>
            <span aria-hidden>₹</span>
            <input
              ref={costRef}
              id="rj-cost-after"
              className="bg-transparent"
              type="number"
              inputMode="numeric"
              min="0"
              placeholder="0"
              value={costText}
              onChange={(event) => {
                setCostText(event.target.value);
                setCostSaved(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveCost();
              }}
            />
          </div>
          <button
            type="button"
            className="rj-cost-save"
            onClick={() => void saveCost()}
            disabled={costSaving || costText.trim() === (job.costPrice != null ? String(job.costPrice) : "")}
          >
            {costSaving ? <Loader2 className="rj-spin" aria-hidden /> : <Check aria-hidden />}
            Save
          </button>
        </div>
        <p className="rj-hint">
          {job.costPrice != null
              ? `Profit ${formatRupees(jobCharge - job.costPrice)}${costSaved ? " · saved" : ""}`
              : "Add what this repair cost you to see the profit."}
        </p>
      </div>
    );

  /** Short red note under a field the bottom button found empty. */
  function missingNote(field: MissingField) {
    return missing?.field === field ? (
      <p className="rj-missing" role="alert">
        {missing.message}
      </p>
    ) : null;
  }

  /* ---------- Step card ---------- */
  let stepCard: ReactNode;
  if (step === 0) {
    stepCard = (
      <>
        <p className="rj-eyebrow">Step 1 of 4 · Received</p>
        <h2>Start the repair</h2>
        <div className="rj-banner is-info">
          <span className="rj-banner-icon">
            <Package aria-hidden />
          </span>
          <div>
            <b>Phone received from {job.customerName}</b>
            <span>Tap Start repair when the technician begins working on it.</span>
          </div>
        </div>
        <div className="rj-due">
          <span>Estimate</span>
          <b>{job.estimatedCost != null ? formatRupees(job.estimatedCost) : "Not given"}</b>
        </div>
      </>
    );
  } else if (step === 1) {
    stepCard = (
      <>
        <p className="rj-eyebrow">Step 2 of 4 · Repair</p>
        <h2>Did the repair work?</h2>
        <div
          ref={outcomeRef}
          className={clsx("rj-choices", missing?.field === "outcome" && "is-attention")}
          role="radiogroup"
          aria-label="Repair result"
        >
          <button
            type="button"
            role="radio"
            aria-checked={draft.outcome === "FIXED"}
            className={clsx("rj-choice is-fixed", draft.outcome === "FIXED" && "is-on")}
            onClick={() => chooseOutcome("FIXED")}
          >
            <span className="rj-choice-icon">
              <Check aria-hidden />
            </span>
            <b>Fixed</b>
            <small>Phone works fine</small>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={draft.outcome === "NOT_FIXED"}
            className={clsx("rj-choice is-notfixed", draft.outcome === "NOT_FIXED" && "is-on")}
            onClick={() => chooseOutcome("NOT_FIXED")}
          >
            <span className="rj-choice-icon">
              <X aria-hidden />
            </span>
            <b>Couldn&apos;t fix</b>
            <small>Return to customer</small>
          </button>
        </div>

        {missingNote("outcome")}

        {draft.outcome === "FIXED" ? (
          <>
            {/* Admin: cost price first, then final charge — same size, one line. */}
            <div className={clsx("rj-sub", isAdmin && "rj-money-pair")}>
              {isAdmin ? (
                <div>
                  <label className="rj-label" htmlFor="rj-cost">
                    Cost price
                  </label>
                  <div className="rj-money">
                    <span aria-hidden>₹</span>
                    <input
                      id="rj-cost"
                      className="bg-transparent"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      placeholder="0"
                      value={draft.cost}
                      onChange={(event) => update({ cost: event.target.value })}
                    />
                  </div>
                </div>
              ) : null}
              <div>
                <label className="rj-label" htmlFor="rj-charge">
                  Final charge
                </label>
                <div className={clsx("rj-money", missing?.field === "charge" && "is-attention")}>
                  <span aria-hidden>₹</span>
                  <input
                    ref={chargeRef}
                    id="rj-charge"
                    // bg-transparent opts out of the app's global input border:
                    // the .rj-money box is the only border.
                    className="bg-transparent"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="0"
                    value={draft.charge}
                    onChange={(event) => update({ charge: event.target.value })}
                  />
                </div>
              </div>
            </div>
            {missingNote("charge")}
            <div className="rj-sub">
              <label className="rj-label" htmlFor="rj-work">
                Work done <em>optional</em>
              </label>
              <textarea
                id="rj-work"
                className="rj-textarea is-first"
                rows={2}
                placeholder="e.g. Replaced display and battery"
                value={draft.note}
                onChange={(event) => update({ note: event.target.value })}
              />
            </div>
          </>
        ) : null}

        {draft.outcome === "NOT_FIXED" ? (
          <>
            <div className="rj-sub">
              <label className="rj-label" htmlFor="rj-reason">
                Reason <em>optional</em>
              </label>
              <input
                id="rj-reason"
                className="rj-textarea is-first is-line"
                autoComplete="off"
                placeholder="e.g. Board damaged, part not available"
                value={draft.note}
                onChange={(event) => update({ note: event.target.value })}
              />
            </div>
            <div className="rj-sub">
              <p className="rj-label">
                Checking fee <em>optional</em>
              </p>
              {/* "No charge", or type any fee. */}
              <div className="rj-fee">
                <button
                  type="button"
                  className={clsx("rj-chip is-sm", !draftCharge && "is-on")}
                  aria-pressed={!draftCharge}
                  onClick={() => update({ charge: "0" })}
                >
                  No charge
                </button>
                <div className="rj-money is-fee">
                  <span aria-hidden>₹</span>
                  <input
                    className="bg-transparent"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    placeholder="Fee"
                    aria-label="Checking fee"
                    value={draftCharge ? draft.charge : ""}
                    onChange={(event) => update({ charge: event.target.value || "0" })}
                  />
                </div>
              </div>
            </div>
          </>
        ) : null}
      </>
    );
  } else if (step === 2) {
    const work = workText(job);
    stepCard = (
      <>
        <p className="rj-eyebrow">Step 3 of 4 · {jobFixed ? "Delivery" : "Return"}</p>
        <h2>{jobFixed ? "Hand over to customer" : "Return phone to customer"}</h2>
        <div className={clsx("rj-banner", !jobFixed && "is-bad")}>
          <span className="rj-banner-icon">{jobFixed ? <Check aria-hidden /> : <X aria-hidden />}</span>
          <div>
            <b>{jobFixed ? "Repaired — ready for pickup" : "Could not be repaired"}</b>
            <span>
              {work || (jobFixed ? "Repair completed" : "Returned unrepaired")}
            </span>
          </div>
        </div>

        <p className="rj-label">1 · Who is collecting?</p>
        <div>
          <button
            type="button"
            role="checkbox"
            aria-checked={pickup.same}
            className={clsx("rj-same", pickup.same && "is-on")}
            onClick={() => setPickup((current) => ({ ...current, same: !current.same }))}
          >
            <span className="rj-same-box">{pickup.same ? <Check aria-hidden /> : null}</span>
            <span className="rj-same-text">
              <b>Same as the customer</b>
              <span>
                {job.customerName} · +91 {job.customerPhone}
              </span>
            </span>
          </button>
          {pickup.same ? null : (
            <div className="rj-pickup">
              <label className="rj-field">
                <span>Name</span>
                <input
                  ref={pickupNameRef}
                  className={clsx("rj-input", missing?.field === "pickupName" && "is-attention")}
                  autoComplete="off"
                  placeholder="Person collecting the phone"
                  value={pickup.name}
                  onChange={(event) => setPickup((current) => ({ ...current, name: event.target.value }))}
                />
                {missingNote("pickupName")}
              </label>
              <label className="rj-field">
                <span>Mobile number</span>
                <input
                  ref={pickupPhoneRef}
                  className={clsx("rj-input", missing?.field === "pickupPhone" && "is-attention")}
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit number"
                  value={pickup.phone}
                  onChange={(event) =>
                    setPickup((current) => ({ ...current, phone: event.target.value.replace(/\D/g, "").slice(0, 10) }))
                  }
                />
                {missingNote("pickupPhone")}
              </label>
            </div>
          )}
        </div>

        <div className="rj-sub">
          <p className="rj-label">2 · Collect payment</p>
          {/* What was quoted (and, for admins, what it cost) — for bargaining. */}
          {job.estimatedCost != null || (isAdmin && jobFixed && job.costPrice != null) ? (
            <p className="rj-cost-info is-top">
              {job.estimatedCost != null ? (
                <>
                  <span>Estimate</span>
                  <b>{formatRupees(job.estimatedCost)}</b>
                </>
              ) : null}
              {isAdmin && jobFixed && job.costPrice != null ? (
                <>
                  {job.estimatedCost != null ? <span className="rj-cost-sep">·</span> : null}
                  <span>Cost</span>
                  <b>{formatRupees(job.costPrice)}</b>
                  <span className="rj-cost-sep">·</span>
                  <span>Profit</span>
                  <b className={dueAmount - job.costPrice < 0 ? "is-loss" : "is-profit"}>
                    {formatRupees(dueAmount - job.costPrice)}
                  </b>
                </>
              ) : null}
            </p>
          ) : null}
          {/* Amount (editable — customers bargain) and how it was paid, on one line. */}
          <div className={clsx("rj-due", missing?.field === "pay" && "is-attention")}>
            <label className="rj-due-amount">
              <span>Amount due</span>
              <span className="rj-due-input">
                <i aria-hidden>₹</i>
                <input
                  className="bg-transparent"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  aria-label="Amount due"
                  value={dueText}
                  onChange={(event) => setDueText(event.target.value)}
                />
              </span>
            </label>
            {dueAmount > 0 ? (
            <div ref={payRef} className="rj-pay" role="radiogroup" aria-label="How the customer paid">
              {PAYMENTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={pay === option.value}
                  className={clsx(pay === option.value && "is-on")}
                  onClick={() => setPay(option.value)}
                >
                  <option.icon aria-hidden />
                  {option.label}
                </button>
              ))}
            </div>
            ) : null}
          </div>
          {missingNote("pay")}
          {dueAmount !== jobCharge ? (
            <p className="rj-hint">Changed from {formatRupees(jobCharge)} — {formatRupees(dueAmount)} will be saved as the final charge</p>
          ) : null}
        </div>
        {job.costPrice == null ? costBox : null}
        <button type="button" className="rj-text-btn" onClick={() => void editResult()} disabled={busy}>
          Change repair result
        </button>
      </>
    );
  } else {
    const work = workText(job);
    stepCard = (
      <>
        <div className="rj-done">
          <span className={clsx("rj-done-icon", !jobFixed && "is-bad")}>
            {jobFixed ? <Check aria-hidden /> : <X aria-hidden />}
          </span>
          <h2>{jobFixed ? "Delivered 🎉" : "Returned"}</h2>
          <p>
            {job.deviceName} handed to <b className="rj-cap">{job.pickupName ?? job.customerName}</b> ·{" "}
            {when(job.deliveredAt)}
          </p>
        </div>
        <div className="rj-receipt">
          <Row label="Job" value={job.jobNumber} />
          <Row
            label="Collected by"
            value={job.pickupName ? `${job.pickupName} · +91 ${job.pickupPhone ?? ""}` : "Customer"}
          />
          <Row label={jobFixed ? "Work done" : "Reason"} value={work || "—"} />
          <Row
            label="Paid"
            value={
              jobCharge
                ? `${formatRupees(jobCharge)}${job.paymentMethod ? ` · ${PAYMENT_LABEL[job.paymentMethod]}` : ""}`
                : "No charge"
            }
          />
        </div>
        {costBox}
        <div className="rj-actions2">
          <a className="rj-btn" href={api.repairSlipUrl(job.id)} target="_blank" rel="noreferrer">
            <Printer aria-hidden /> Print bill
          </a>
          <button type="button" className="rj-btn" onClick={() => void shareSlip()} disabled={sharing}>
            {sharing ? <Loader2 className="rj-spin" aria-hidden /> : <Share2 aria-hidden />} Share bill
          </button>
        </div>
        <button
          type="button"
          className="rj-text-btn"
          onClick={() => void save({ status: "REPAIRED" })}
          disabled={busy}
        >
          Undo {jobFixed ? "delivery" : "return"}
        </button>
      </>
    );
  }

  /* ---------- Bottom button ---------- */
  let cta: { label: ReactNode; help: string; tone: string; disabled: boolean };
  if (step === 0) {
    cta = {
      label: (
        <>
          <Hammer aria-hidden /> Start repair
        </>
      ),
      help: "Next: record whether it was fixed",
      tone: "",
      disabled: false,
    };
  } else if (step === 1) {
    if (!draft.outcome) {
      cta = { label: "Mark repaired", help: "Choose Fixed or Couldn't fix first", tone: "", disabled: false };
    } else if (fixedDraft) {
      cta = {
        label: (
          <>
            <Check aria-hidden /> Mark repaired{draftCharge ? ` · ${formatRupees(draftCharge)}` : ""}
          </>
        ),
        help: "Next: call the customer & collect payment",
        tone: "is-green",
        disabled: false,
      };
    } else {
      cta = {
        label: (
          <>
            <X aria-hidden /> Mark not repairable
          </>
        ),
        help: "Next: return phone to customer",
        tone: "is-red",
        disabled: false,
      };
    }
  } else if (step === 2) {
    const needPay = dueAmount > 0 && !pay;
    const needPickup =
      !pickup.same && (pickup.name.trim().length < 2 || pickup.phone.length !== 10);
    cta = {
      label: (
        <>
          <ShoppingBag aria-hidden />
          {dueAmount ? `Collect ${formatRupees(dueAmount)} & deliver` : jobFixed ? "Mark delivered" : "Mark returned"}
        </>
      ),
      help: needPickup
        ? "Enter the name and 10-digit number of the person collecting"
        : needPay
          ? "Select how the customer paid"
          : `Phone goes to ${pickup.same ? job.customerName : pickup.name.trim()}`,
      tone: "is-green",
      disabled: false,
    };
  } else {
    cta = {
      label: (
        <>
          <Plus aria-hidden /> New repair
        </>
      ),
      help: "This job is complete",
      tone: "is-ghost",
      disabled: false,
    };
  }

  /* ---------- Activity (newest first) ---------- */
  const activity = [
    { title: "Job created", time: job.createdAt, by: job.createdByName },
    job.startedAt ? { title: "Repair started", time: job.startedAt, by: null } : null,
    job.repairedAt
      ? {
          title: jobFixed ? `Marked repaired · ${formatRupees(jobCharge)}` : "Marked couldn't fix",
          time: job.repairedAt,
          by: null,
        }
      : null,
    job.notifiedAt ? { title: "Customer called", time: job.notifiedAt, by: null } : null,
    job.deliveredAt
      ? {
          title:
            (jobFixed ? "Delivered" : "Returned") +
            (jobCharge
              ? ` · ${formatRupees(jobCharge)}${job.paymentMethod ? ` via ${PAYMENT_LABEL[job.paymentMethod]}` : ""}`
              : "") +
            (job.pickupName ? ` · collected by ${job.pickupName}` : ""),
          time: job.deliveredAt,
          by: null,
        }
      : null,
  ]
    .filter((entry): entry is { title: string; time: string; by: string | null } => entry !== null)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const photoCount = Number(job.hasFrontPhoto) + Number(job.hasBackPhoto);
  const meta = [job.color, job.estimatedCost != null ? `Est. ${formatRupees(job.estimatedCost)}` : null]
    .filter(Boolean)
    .join(" · ");

  /** Next-step button (or the finished strip). Phones: fixed right above the
   * bottom nav. Laptop: sits under the step card in the left column. */
  const ctaBar = (
    <div
      ref={barRef}
      className={clsx("rj-cta-bar", bar.mobile && "is-fixed", step === 3 && "is-strip")}
      style={
        bar.mobile
          ? step === 3
            ? { left: 0, right: 0, bottom: bar.bottom } // finished strip: edge to edge like the footer
            : { left: 0, width: "100vw", bottom: bar.bottom }
          : undefined
      }
    >
      {step === 3 ? (
        // Finished: a status bar instead of a button.
        <p className={clsx("rj-done-bar", jobFixed ? "is-ok" : "is-bad")} role="status">
          {jobFixed ? <Check aria-hidden /> : <X aria-hidden />}
          {jobFixed ? "Job complete · Delivered" : "Returned unrepaired"}
        </p>
      ) : (
        <>
          <p className="rj-cta-help">{cta.help}</p>
          <button
            type="button"
            className={clsx("rj-cta", cta.tone)}
            disabled={cta.disabled || busy}
            onClick={() => void advance()}
          >
            {busy ? <Loader2 className="rj-spin" aria-hidden /> : null}
            {cta.label}
          </button>
        </>
      )}
    </div>
  );

  const toastEl = (
  <div
    className={clsx("rj-toast", toast && "is-show")}
    role="status"
    aria-live="polite"
    style={{
      bottom: bar.mobile ? bar.bottom + bar.height + 10 : 24,
      left: bar.left + bar.width / 2,
    }}
  >
    <span>{toast?.message}</span>
    <button type="button" onClick={() => void undo()} disabled={!toast || busy}>
      <Undo2 aria-hidden /> Undo
    </button>
  </div>
  );

  return (
    <div className="rj" ref={rootRef}>
      <div className="rj-top">
        <Link to="/repair/history" className="rj-icon-btn" aria-label="Back to history">
          <ArrowLeft aria-hidden />
        </Link>
        <div className="rj-top-id">
          <small>
            REPAIR JOB
            {isAdmin && !repairOnly && job.shop !== MAIN_REPAIR_SHOP ? `  ·  ${repairShopLabel(job.shop).toUpperCase()}` : ""}
          </small>
          <span>{job.jobNumber}</span>
        </div>
        <Link to={`/repair/${job.id}/edit`} className="rj-icon-btn" aria-label="Edit job details">
          <SquarePen aria-hidden />
        </Link>
        <a className="rj-icon-btn" href={api.repairSlipUrl(job.id)} target="_blank" rel="noreferrer" aria-label="Print slip">
          <Printer aria-hidden />
        </a>
        <button type="button" className="rj-icon-btn" onClick={() => void shareSlip()} disabled={sharing} aria-label="Share slip">
          {sharing ? <Loader2 className="rj-spin" aria-hidden /> : <Share2 aria-hidden />}
        </button>
        {isAdmin ? (
          <button
            type="button"
            className="rj-icon-btn is-danger"
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
            aria-label="Delete repair job"
          >
            <Trash2 aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="rj-layout">
        <div className="rj-main">
      {/* Everything the repairman needs at a glance */}
      <section className="rj-card rj-hero">
        <div className="rj-hero-row">
          <div className="rj-hero-title">
            <h1 className="rj-device">{job.deviceName}</h1>
            {meta ? <p className="rj-meta">{meta}</p> : null}
          </div>
          <StatusPill job={job} />
        </div>
        <div className="rj-cust">
          <span className="rj-avatar" aria-hidden>
            {job.customerName.trim().slice(0, 1)}
          </span>
          <div className="rj-who">
            <b>{job.customerName}</b>
            <span>+91 {job.customerPhone}</span>
          </div>
          <a className="rj-round is-call" href={phoneHref} aria-label={`Call ${job.customerName}`}>
            <Phone aria-hidden />
          </a>
        </div>
      </section>

      {/* What's wrong and when it's promised back. */}
      <section className="rj-card rj-issue" aria-labelledby="rj-issue-title">
        <div className="rj-issue-head">
          <span className="rj-acc-icon">
            <Wrench aria-hidden />
          </span>
          <h2 id="rj-issue-title">Issue</h2>
        </div>
        <p className="rj-issue-text">{job.problemDescription || "—"}</p>
        {job.conditionNotes ? <p className="rj-issue-note">{job.conditionNotes}</p> : null}
        <div className="rj-issue-due">
          <CalendarDays aria-hidden />
          <span>Delivery by</span>
          <b>
            {job.expectedDeliveryAt
              ? format(new Date(job.expectedDeliveryAt), "EEE, d MMM")
              : "Not set"}
          </b>
        </div>
      </section>

      <Tracker job={job} />

      {/* The one thing to do now */}
      <section className={clsx("rj-card rj-next", step === 3 && "is-green")}>
        {error ? (
          <p className="rj-error" role="alert">
            {error}
          </p>
        ) : null}
        {stepCard}
      </section>

          {bar.mobile ? null : ctaBar}
        </div>

        <aside className="rj-side">
          <p className="rj-sec-title">Job details</p>      <Accordion open={!bar.mobile} icon={Smartphone} title="Phone" summary={[job.deviceName, job.color].filter(Boolean).join(" · ")}>
        <div className="rj-rows">
          <Row label="Model" value={job.deviceName} />
          <Row label="System" value={platformLabel(job.platform)} />
          <Row label="Colour" value={job.color || "—"} />
          {job.imei ? <Row label="IMEI / Serial" value={job.imei} /> : null}
          {job.lockCode ? <Row label="Screen lock" value={job.lockCode} /> : null}
          {job.accessories ? <Row label="Received with" value={job.accessories} /> : null}
          {job.ram || job.storage ? (
            <Row label="RAM / Storage" value={[job.ram, job.storage].filter(Boolean).join(" / ")} />
          ) : null}
          {job.condition ? <Row label="Condition" value={conditionLabel(job.condition)} /> : null}
          <Row label="Location" value={job.customerAddress || "—"} />
        </div>
      </Accordion>
      <Accordion open={!bar.mobile} icon={ImageIcon} title="Photos" summary={`${photoCount} of 2 added`}>
        <div className="rj-photos">
          {(["front", "back"] as const).map((side) => {
            const has = side === "front" ? job.hasFrontPhoto : job.hasBackPhoto;
            const label = side === "front" ? "Front" : "Back";
            return has ? (
              <figure key={side} className="rj-ph">
                <RepairPhoto
                  jobId={job.id}
                  side={side}
                  available
                  alt={`${job.deviceName} ${side}`}
                  className="rj-ph-img"
                  onOpen={setZoomUrl}
                />
                <figcaption>{label}</figcaption>
              </figure>
            ) : (
              <label key={side} className="rj-ph is-empty">
                {photoBusy === side ? <Loader2 className="rj-spin" aria-hidden /> : <Plus aria-hidden />}
                {photoBusy === side ? "Saving…" : `Add ${side}`}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={photoBusy !== null}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void addPhoto(side, file);
                  }}
                />
              </label>
            );
          })}
        </div>
      </Accordion>
      <Accordion open={!bar.mobile} icon={Clock} title="Activity" summary={`${activity.length} update${activity.length === 1 ? "" : "s"}`}>
        <ol className="rj-log">
          {activity.map((entry) => (
            <li key={entry.title + entry.time}>
              <i aria-hidden />
              <div>
                <b>{entry.title}</b>
                <span>
                  {when(entry.time)}
                  {entry.by ? ` · by ${entry.by}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </Accordion>
        </aside>
      </div>

      {/* Phones: room for the fixed button so the last section isn't hidden. */}
      {bar.mobile ? <div aria-hidden style={{ height: bar.height + 12 }} /> : null}



      {/* Phones: rendered on <body> so "fixed" means the screen, not a page wrapper. */}
      {bar.mobile
        ? createPortal(
            <div className="rj rj-portal">
              {ctaBar}
              {toastEl}
            </div>,
            document.body,
          )
        : toastEl}

      {zoomUrl ? (
        <div className="rp-zoom" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setZoomUrl(null)}>
          <button type="button" className="rp-zoom-close" aria-label="Close photo" onClick={() => setZoomUrl(null)}>
            <X aria-hidden />
          </button>
          <img src={zoomUrl} alt="" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
      <AnimatePresence>
        {confirmDelete ? (
          <DangerConfirmModal
            title="Delete this repair job?"
            subtitle={`${job.jobNumber} · ${job.customerName}`}
            points={["The job is removed from the tracker with its photos."]}
            undoDays={RECYCLE_BIN_DAYS}
            confirmLabel="Move to recycle bin"
            working={deleteBusy}
            error={deleteError}
            onCancel={() => {
              if (deleteBusy) return;
              setConfirmDelete(false);
              setDeleteError(null);
            }}
            onConfirm={() => void deleteJob()}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
