import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ChevronRight, Plus, Search } from "lucide-react";
import clsx from "clsx";
import { PageHeader } from "../components/ui";
import { RepairPhoto } from "../components/RepairPhoto";
import { api } from "../lib/api";
import {
  REPAIR_STATUSES,
  formatRupees,
  platformLabel,
  repairSpecs,
  statusLine,
} from "../lib/repair";
import type { RepairJob, RepairStatus } from "../types";

export function RepairHistoryPage() {
  const [jobs, setJobs] = useState<RepairJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RepairStatus | "">("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api
        .listRepairJobs(query, statusFilter)
        .then(({ data }) => {
          if (active) setJobs(data);
        })
        .catch(() => {
          if (active) setJobs([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, query ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, statusFilter]);

  return (
    <div className="rp-history">
      <PageHeader
        eyebrow="Repair desk"
        title="History"
        description="Every phone taken in for repair. Search by name, number, model, problem or BMR number."
        action={
          <Link to="/repair" className="btn-primary">
            <Plus className="h-4 w-4" />
            New repair
          </Link>
        }
      />

      <div className="rp-history-bar">
        <div className="rp-filter" role="group" aria-label="Filter by status">
          {[{ value: "" as const, label: "All" }, ...REPAIR_STATUSES].map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              className={clsx("rp-filter-btn", statusFilter === option.value && "is-on")}
              aria-pressed={statusFilter === option.value}
              onClick={() => setStatusFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="rp-search">
          <Search aria-hidden />
          <input
            id="rp-search"
            className="bg-transparent"
            placeholder="Search name, phone, model, BMR-…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search repairs"
          />
        </label>
      </div>

      {loading && jobs.length === 0 ? (
        <p className="rp-empty">Loading repairs…</p>
      ) : jobs.length === 0 ? (
        <p className="rp-empty">
          {query || statusFilter ? "No repairs match." : "No repairs yet. Saved phones will appear here."}
        </p>
      ) : (
        <ul className="rp-jobs">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link to={`/repair/${job.id}`} className="rp-job">
                <RepairPhoto
                  jobId={job.id}
                  side="front"
                  available={job.hasFrontPhoto}
                  alt={`${job.deviceName} front`}
                  className="rp-job-thumb"
                />
                <div className="rp-job-body">
                  <div className="rp-job-top">
                    <span className="rp-job-number">{job.jobNumber}</span>
                    <span
                      className={clsx(
                        "rp-status",
                        `is-${job.status.toLowerCase()}`,
                        job.outcome === "NOT_FIXED" && "is-not-fixed",
                      )}
                    >
                      {statusLine(job)}
                    </span>
                  </div>
                  <strong className="rp-job-device">{job.deviceName}</strong>
                  <span className="rp-job-meta">
                    {[platformLabel(job.platform), repairSpecs(job)].filter(Boolean).join(" · ")}
                  </span>
                  {job.problemDescription ? (
                    <span className="rp-job-problem">{job.problemDescription}</span>
                  ) : null}
                  <span className="rp-job-customer">
                    {job.customerName} · {job.customerPhone}
                  </span>
                  <span className="rp-job-date">
                    {format(new Date(job.createdAt), "d MMM yyyy, h:mm a")}
                    {job.finalCharge != null
                      ? ` · ${formatRupees(job.finalCharge)}`
                      : job.estimatedCost != null
                        ? ` · est. ${formatRupees(job.estimatedCost)}`
                        : ""}
                  </span>
                </div>
                <ChevronRight className="rp-job-chevron" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
