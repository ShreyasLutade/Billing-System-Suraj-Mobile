import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ChevronRight, Clock3, Inbox, PackageCheck, Wrench } from "lucide-react";
import clsx from "clsx";
import { PageHeader } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { formatRupees, outcomeLabel } from "../lib/repair";
import type { RepairAnalytics } from "../types";

const PERIODS: Array<{ value: RepairAnalytics["period"]; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All" },
];

export function RepairAnalyticsPage() {
  const [period, setPeriod] = useState<RepairAnalytics["period"]>("month");
  const [data, setData] = useState<RepairAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .repairAnalytics(period)
      .then(({ data: next }) => {
        if (active) setData(next);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Couldn't load repair analytics");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [period]);

  const checked = data ? data.fixedCount + data.notFixedCount : 0;
  const fixedShare = data && checked ? (data.fixedCount / checked) * 100 : 0;
  const topMax = data?.topDevices[0]?.count ?? 0;

  return (
    <div className="rp-analytics">
      <PageHeader
        eyebrow="Insights"
        title="Repair sales"
        description="Money from repairs is counted when the phone is delivered back to the customer."
      />

      <div className="rp-filter rp-period" role="group" aria-label="Period">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={clsx("rp-filter-btn", period === option.value && "is-on")}
            aria-pressed={period === option.value}
            onClick={() => setPeriod(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rp-empty">{error}</p>
      ) : !data ? (
        <p className="rp-empty">Loading…</p>
      ) : (
        <div className={clsx("rp-an", loading && "is-loading")}>
          <section className="rp-an-hero" aria-label="Repair revenue">
            <p className="rp-an-hero-label">Repair revenue · {data.periodLabel.toLowerCase()}</p>
            <p className="rp-an-hero-value">{formatRupees(data.revenue)}</p>
            <div className="rp-an-hero-row">
              <div>
                <span>Phones delivered</span>
                <strong>{data.deliveredCount}</strong>
              </div>
              <div>
                <span>Average charge</span>
                <strong>{formatRupees(Math.round(data.averageCharge))}</strong>
              </div>
            </div>
          </section>

          <div className="rp-an-tiles">
            <div className="rp-an-tile">
              <span className="rp-an-tile-icon">
                <Inbox aria-hidden />
              </span>
              <span className="rp-an-tile-label">Phones received</span>
              <strong className="rp-an-tile-value">{data.receivedCount}</strong>
              <span className="rp-an-tile-sub">{data.periodLabel}</span>
            </div>

            <div className="rp-an-tile">
              <span className="rp-an-tile-icon">
                <Wrench aria-hidden />
              </span>
              <span className="rp-an-tile-label">Repaired</span>
              <strong className="rp-an-tile-value">{checked}</strong>
              <div
                className="rp-an-split"
                role="img"
                aria-label={`${data.fixedCount} fixed, ${data.notFixedCount} couldn't fix`}
              >
                <span style={{ width: `${fixedShare}%` }} />
              </div>
              <span className="rp-an-tile-sub">
                {data.fixedCount} fixed · {data.notFixedCount} couldn't fix
                {data.fixRate != null ? ` · ${Math.round(data.fixRate * 100)}% fixed` : ""}
              </span>
            </div>

            <div className="rp-an-tile">
              <span className="rp-an-tile-icon is-waiting">
                <Clock3 aria-hidden />
              </span>
              <span className="rp-an-tile-label">In the shop now</span>
              <strong className="rp-an-tile-value">{data.waitingCount}</strong>
              <span className="rp-an-tile-sub">Waiting to be repaired</span>
            </div>

            <div className="rp-an-tile">
              <span className="rp-an-tile-icon is-ready">
                <PackageCheck aria-hidden />
              </span>
              <span className="rp-an-tile-label">Ready for pickup</span>
              <strong className="rp-an-tile-value">{data.readyCount}</strong>
              <span className="rp-an-tile-sub">
                {data.readyValue ? `${formatRupees(data.readyValue)} to collect` : "Nothing to collect"}
              </span>
            </div>
          </div>

          <div className="rp-an-grid">
            <section className="rp-card">
              <h2 className="rp-card-title">Most repaired phones</h2>
              {data.topDevices.length === 0 ? (
                <p className="rp-an-empty">No phones received in this period.</p>
              ) : (
                <ol className="rp-an-bars">
                  {data.topDevices.map((device) => (
                    <li key={device.deviceName}>
                      <div className="rp-an-bar-label">
                        <span>{device.deviceName}</span>
                        <strong>{device.count}</strong>
                      </div>
                      <div className="rp-an-bar">
                        <span style={{ width: `${topMax ? (device.count / topMax) * 100 : 0}%` }} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rp-card">
              <h2 className="rp-card-title">Recently delivered</h2>
              {data.recentDelivered.length === 0 ? (
                <p className="rp-an-empty">No phones delivered in this period.</p>
              ) : (
                <ul className="rp-an-list">
                  {data.recentDelivered.map((job) => (
                    <li key={job.id}>
                      <Link to={`/repair/${job.id}`} className="rp-an-row">
                        <div>
                          <strong>{job.deviceName}</strong>
                          <span>
                            {job.jobNumber} · {job.customerName}
                            {job.deliveredAt ? ` · ${format(new Date(job.deliveredAt), "d MMM")}` : ""}
                          </span>
                        </div>
                        <div className="rp-an-row-end">
                          <strong>{job.finalCharge != null ? formatRupees(job.finalCharge) : "—"}</strong>
                          {job.outcome ? (
                            <span className={clsx("rp-status", job.outcome === "NOT_FIXED" ? "is-not-fixed" : "is-repaired")}>
                              {outcomeLabel(job.outcome)}
                            </span>
                          ) : null}
                        </div>
                        <ChevronRight className="rp-job-chevron" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
