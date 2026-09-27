import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  MapPin,
  PackageCheck,
  Phone,
  Printer,
  Share2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import clsx from "clsx";
import { ApiError, api } from "../lib/api";
import {
  conditionLabel,
  formatRupees,
  outcomeLabel,
  platformLabel,
  statusLine,
} from "../lib/repair";
import { RepairPhoto } from "../components/RepairPhoto";
import type { RepairJob, RepairOutcome, RepairStatus } from "../types";

function when(iso: string | null) {
  return iso ? format(new Date(iso), "d MMM yyyy, h:mm a") : null;
}

const STEPS: Array<{ status: RepairStatus; label: string }> = [
  { status: "RECEIVED", label: "Received" },
  { status: "REPAIRED", label: "Repaired" },
  { status: "DELIVERED", label: "Delivered" },
];

function StatusSteps({ job }: { job: RepairJob }) {
  const reached = STEPS.findIndex((step) => step.status === job.status);
  const dates = [job.createdAt, job.repairedAt, job.deliveredAt];
  return (
    <ol className="rp-steps" aria-label="Repair progress">
      {STEPS.map((step, index) => {
        const done = index <= reached;
        const detail =
          index === 1 && job.outcome && done ? outcomeLabel(job.outcome) : null;
        return (
          <li
            key={step.status}
            className={clsx(
              "rp-step",
              done && "is-done",
              index === reached && "is-current",
              index === 1 && job.outcome === "NOT_FIXED" && done && "is-not-fixed",
            )}
            aria-current={index === reached ? "step" : undefined}
          >
            <span className="rp-step-dot">{done ? <Check aria-hidden /> : index + 1}</span>
            <span className="rp-step-text">
              <strong>
                {step.label}
                {detail ? ` · ${detail}` : ""}
              </strong>
              <small>{done ? when(dates[index]) : "Pending"}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Mark repaired (or edit the result): fixed or not, final charge, work done. */
function FinishForm({
  job,
  busy,
  onSubmit,
  onCancel,
}: {
  job: RepairJob;
  busy: boolean;
  onSubmit: (payload: { outcome: RepairOutcome; finalCharge: number | null; repairNotes: string }) => void;
  onCancel?: () => void;
}) {
  const [outcome, setOutcome] = useState<RepairOutcome | "">(job.outcome ?? "");
  const [charge, setCharge] = useState(
    job.finalCharge != null
      ? String(job.finalCharge)
      : job.estimatedCost != null
        ? String(job.estimatedCost)
        : "",
  );
  const [notes, setNotes] = useState(job.repairNotes ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!outcome) {
      setError("Choose whether the phone was fixed");
      return;
    }
    const amount = charge.trim() ? Number(charge) : null;
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      setError("Enter a valid charge");
      return;
    }
    setError(null);
    onSubmit({ outcome, finalCharge: amount, repairNotes: notes.trim() });
  }

  return (
    <form className="rp-finish" onSubmit={submit} noValidate>
      <div className="rp-field">
        <span className="rp-label" id="rp-outcome-label">
          Was it fixed? <em>*</em>
        </span>
        <div className="rp-outcomes" role="radiogroup" aria-labelledby="rp-outcome-label">
          <button
            type="button"
            role="radio"
            aria-checked={outcome === "FIXED"}
            className={clsx("rp-outcome is-fixed", outcome === "FIXED" && "is-on")}
            onClick={() => setOutcome("FIXED")}
          >
            <Check aria-hidden /> Fixed
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={outcome === "NOT_FIXED"}
            className={clsx("rp-outcome is-not-fixed", outcome === "NOT_FIXED" && "is-on")}
            onClick={() => setOutcome("NOT_FIXED")}
          >
            <X aria-hidden /> Couldn't fix
          </button>
        </div>
      </div>
      <div className="rp-field">
        <label className="rp-label" htmlFor="rp-finalCharge">
          Final charge <span className="rp-optional">optional</span>
        </label>
        <div className="rp-input-icon rp-rupee">
          <span aria-hidden>₹</span>
          <input
            id="rp-finalCharge"
            className="rp-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            placeholder="0"
            value={charge}
            onChange={(event) => setCharge(event.target.value)}
          />
        </div>
        {job.estimatedCost != null ? (
          <p className="rp-hint">Estimate was {formatRupees(job.estimatedCost)}</p>
        ) : null}
      </div>
      <div className="rp-field">
        <label className="rp-label" htmlFor="rp-repairNotes">
          Work done <span className="rp-optional">optional</span>
        </label>
        <textarea
          id="rp-repairNotes"
          className="rp-input rp-textarea"
          rows={2}
          placeholder="e.g. Replaced display and charging port"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      {error ? (
        <p className="rp-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rp-finish-actions">
        {onCancel ? (
          <button type="button" className="rp-btn rp-btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="rp-btn rp-btn-primary" disabled={busy}>
          {busy ? <Loader2 className="rp-spin" aria-hidden /> : <Wrench aria-hidden />}
          {job.status === "RECEIVED" ? "Mark repaired" : "Save result"}
        </button>
      </div>
    </form>
  );
}

export function RepairJobPage() {
  const { id = "" } = useParams();
  const [job, setJob] = useState<RepairJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingResult, setEditingResult] = useState(false);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let active = true;
    setJob(null);
    setError(null);
    api
      .getRepairJob(id)
      .then(({ data }) => {
        if (active) setJob(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Couldn't load this repair");
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!zoomUrl) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomUrl]);

  async function updateStatus(payload: Parameters<typeof api.updateRepairStatus>[1]) {
    if (!job) return;
    setBusy(true);
    setActionError(null);
    try {
      const { data } = await api.updateRepairStatus(job.id, payload);
      setJob(data);
      setEditingResult(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't update the status");
    } finally {
      setBusy(false);
    }
  }

  async function shareSlip() {
    if (!job) return;
    setSharing(true);
    setActionError(null);
    try {
      const response = await fetch(api.repairSlipUrl(job.id));
      if (!response.ok) throw new Error("Couldn't load the repair slip");
      const file = new File([await response.blob()], `${job.jobNumber}.pdf`, {
        type: "application/pdf",
      });
      const shareData: ShareData = {
        title: `Repair slip ${job.jobNumber}`,
        text: `Repair slip ${job.jobNumber} — Babu Mobile NX`,
        files: [file],
      };
      if (typeof navigator.canShare === "function" && !navigator.canShare(shareData)) {
        throw new Error("This device can't share PDFs from the browser. Download it, then share from WhatsApp.");
      }
      await navigator.share(shareData);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setActionError(err instanceof Error ? err.message : "Couldn't share the slip");
    } finally {
      setSharing(false);
    }
  }

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="rp-detail">
      <Link to="/repair/history" className="rp-back">
        <ArrowLeft aria-hidden /> History
      </Link>

      {error ? (
        <p className="rp-empty">{error}</p>
      ) : !job ? (
        <p className="rp-empty">Loading…</p>
      ) : (
        <>
          <div className="rp-detail-head">
            <div>
              <p className="rp-eyebrow">{job.jobNumber}</p>
              <h1>{job.deviceName}</h1>
              <p className="rp-lead">
                Received {when(job.createdAt)}
                {job.createdByName ? ` by ${job.createdByName}` : ""}
              </p>
            </div>
            <div className="rp-slip-actions">
              <a
                className="rp-btn rp-btn-ghost"
                href={api.repairSlipUrl(job.id)}
                target="_blank"
                rel="noreferrer"
              >
                <Printer aria-hidden /> Print slip
              </a>
              <a className="rp-btn rp-btn-ghost rp-btn-icon" href={api.repairSlipUrl(job.id, true)} aria-label="Download slip" title="Download slip">
                <Download aria-hidden />
              </a>
              {canShare ? (
                <button
                  type="button"
                  className="rp-btn rp-btn-ghost rp-btn-icon"
                  onClick={() => void shareSlip()}
                  disabled={sharing}
                  aria-label="Share slip"
                  title="Share slip (WhatsApp)"
                >
                  {sharing ? <Loader2 className="rp-spin" aria-hidden /> : <Share2 aria-hidden />}
                </button>
              ) : null}
            </div>
          </div>

          <section className="rp-card rp-status-card" aria-labelledby="rp-status-title">
            <div className="rp-status-top">
              <h2 id="rp-status-title" className="rp-card-title">
                Status
              </h2>
              <span
                className={clsx(
                  "rp-status rp-status-lg",
                  `is-${job.status.toLowerCase()}`,
                  job.outcome === "NOT_FIXED" && "is-not-fixed",
                )}
              >
                {statusLine(job)}
              </span>
            </div>
            <StatusSteps job={job} />

            {actionError ? (
              <p className="rp-error" role="alert">
                {actionError}
              </p>
            ) : null}

            {job.status === "RECEIVED" || editingResult ? (
              <FinishForm
                key={`${job.id}-${job.status}-${editingResult}`}
                job={job}
                busy={busy}
                onSubmit={(payload) =>
                  void updateStatus({
                    status: job.status === "DELIVERED" ? "DELIVERED" : "REPAIRED",
                    ...payload,
                  })
                }
                onCancel={editingResult ? () => setEditingResult(false) : undefined}
              />
            ) : (
              <div className="rp-status-actions">
                {job.status === "REPAIRED" ? (
                  <button
                    type="button"
                    className="rp-btn rp-btn-primary"
                    disabled={busy}
                    onClick={() => void updateStatus({ status: "DELIVERED" })}
                  >
                    {busy ? <Loader2 className="rp-spin" aria-hidden /> : <PackageCheck aria-hidden />}
                    Mark delivered to customer
                  </button>
                ) : null}
                <button type="button" className="rp-btn rp-btn-ghost" disabled={busy} onClick={() => setEditingResult(true)}>
                  Edit result
                </button>
                <button
                  type="button"
                  className="rp-link-btn"
                  disabled={busy}
                  onClick={() =>
                    void updateStatus(
                      job.status === "DELIVERED" ? { status: "REPAIRED" } : { status: "RECEIVED" },
                    )
                  }
                >
                  {job.status === "DELIVERED" ? "Undo delivery" : "Move back to received"}
                </button>
              </div>
            )}
          </section>

          <div className="rp-detail-grid">
            <section className="rp-card">
              <h2 className="rp-card-title">Customer</h2>
              <dl className="rp-dl">
                <div>
                  <dt>
                    <UserRound aria-hidden /> Name
                  </dt>
                  <dd>{job.customerName}</dd>
                </div>
                <div>
                  <dt>
                    <Phone aria-hidden /> Mobile
                  </dt>
                  <dd>
                    <a href={`tel:${job.customerPhone}`}>{job.customerPhone}</a>
                  </dd>
                </div>
                <div>
                  <dt>
                    <MapPin aria-hidden /> Location
                  </dt>
                  <dd>{job.customerAddress || "—"}</dd>
                </div>
              </dl>
            </section>

            <section className="rp-card">
              <h2 className="rp-card-title">Phone</h2>
              <dl className="rp-dl">
                <div>
                  <dt>Model</dt>
                  <dd>{job.deviceName}</dd>
                </div>
                <div>
                  <dt>System</dt>
                  <dd>{platformLabel(job.platform)}</dd>
                </div>
                <div>
                  <dt>Colour</dt>
                  <dd>{job.color || "—"}</dd>
                </div>
                {job.ram || job.storage ? (
                  <div>
                    <dt>RAM / Storage</dt>
                    <dd>{[job.ram, job.storage].filter(Boolean).join(" / ")}</dd>
                  </div>
                ) : null}
                {job.condition ? (
                  <div>
                    <dt>Condition</dt>
                    <dd>
                      <span className={clsx("rp-badge", `is-${job.condition.toLowerCase()}`)}>
                        {conditionLabel(job.condition)}
                      </span>
                    </dd>
                  </div>
                ) : null}
              </dl>
              {job.conditionNotes ? <p className="rp-notes">{job.conditionNotes}</p> : null}
            </section>

            <section className="rp-card rp-span-full">
              <h2 className="rp-card-title">Problem &amp; charges</h2>
              <p className="rp-notes">{job.problemDescription || "—"}</p>
              <dl className="rp-dl rp-dl-inline">
                <div>
                  <dt>Estimate</dt>
                  <dd>{job.estimatedCost != null ? formatRupees(job.estimatedCost) : "—"}</dd>
                </div>
                <div>
                  <dt>Final charge</dt>
                  <dd>{job.finalCharge != null ? formatRupees(job.finalCharge) : "—"}</dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd>{job.outcome ? outcomeLabel(job.outcome) : "Not checked yet"}</dd>
                </div>
              </dl>
              {job.repairNotes ? (
                <div>
                  <p className="rp-label">Work done</p>
                  <p className="rp-notes">{job.repairNotes}</p>
                </div>
              ) : null}
            </section>

            <section className="rp-card rp-span-full">
              <h2 className="rp-card-title">Photos</h2>
              <div className="rp-photos rp-photos-detail">
                {(["front", "back"] as const).map((side) => (
                  <figure key={side} className="rp-photo-figure">
                    <RepairPhoto
                      jobId={job.id}
                      side={side}
                      available={side === "front" ? job.hasFrontPhoto : job.hasBackPhoto}
                      alt={`${job.deviceName} ${side}`}
                      className="rp-photo-view"
                      onOpen={setZoomUrl}
                    />
                    <figcaption>{side === "front" ? "Front" : "Back"}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {zoomUrl ? (
        <div className="rp-zoom" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setZoomUrl(null)}>
          <button type="button" className="rp-zoom-close" aria-label="Close photo" onClick={() => setZoomUrl(null)}>
            <X aria-hidden />
          </button>
          <img src={zoomUrl} alt="" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  );
}
