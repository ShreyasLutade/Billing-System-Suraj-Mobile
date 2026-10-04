import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format, isToday, isYesterday } from "date-fns";
import { AlertTriangle, Bell, Phone, Search, Wrench } from "lucide-react";
import clsx from "clsx";
import { RepairPhoto } from "../components/RepairPhoto";
import { api } from "../lib/api";
import { MAIN_REPAIR_SHOP, REPAIR_SHOP_LABEL, formatRupees, repairShopLabel } from "../lib/repair";
import { useAuth } from "../auth/AuthContext";
import type { RepairJob } from "../types";
import "../styles/repairHistory.css";

/* Repair tracker: search, status tabs with counts, a small summary, and jobs
   grouped by day. Each card has a coloured edge for its stage. */

type Stage = "received" | "inRepair" | "ready" | "toReturn" | "delivered" | "returned";

const STAGE: Record<Stage, { label: string; tone: string }> = {
  received: { label: "Received", tone: "is-slate" },
  inRepair: { label: "In repair", tone: "is-amber" },
  ready: { label: "Ready for pickup", tone: "is-blue" },
  toReturn: { label: "Not fixed · return", tone: "is-red" },
  delivered: { label: "Delivered", tone: "is-green" },
  returned: { label: "Returned · Not fixed", tone: "is-red" },
};

function stageOf(job: RepairJob): Stage {
  if (job.status === "RECEIVED") return "received";
  if (job.status === "IN_REPAIR") return "inRepair";
  if (job.status === "REPAIRED") return job.outcome === "NOT_FIXED" ? "toReturn" : "ready";
  return job.outcome === "NOT_FIXED" ? "returned" : "delivered";
}

type TabKey =
  | "all"
  | "action"
  | "received"
  | "inRepair"
  | "inShop"
  | "repaired"
  | "ready"
  | "delivered"
  | "returned";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "action", label: "Needs action" },
  { key: "received", label: "Received" },
  { key: "inRepair", label: "In repair" },
  { key: "inShop", label: "In the shop" },
  { key: "repaired", label: "Repaired" },
  { key: "ready", label: "Ready" },
  { key: "delivered", label: "Delivered" },
  { key: "returned", label: "Returned" },
];

const SUMMARY_TAB_KEYS = new Set<TabKey>(["received", "inRepair", "ready"]);

/** Waiting on the shop: a cost price to add, or a phone to hand back. */
function needsAction(job: RepairJob) {
  return job.costPending || job.status === "REPAIRED";
}

function inTab(job: RepairJob, tab: TabKey) {
  const stage = stageOf(job);
  if (tab === "all") return true;
  if (tab === "action") return needsAction(job);
  if (tab === "inShop") return stage === "received" || stage === "inRepair";
  if (tab === "repaired") return job.status === "REPAIRED" || job.status === "DELIVERED";
  if (tab === "ready") return stage === "ready" || stage === "toReturn";
  return stage === tab;
}

function isTabKey(value: string | null): value is TabKey {
  return value !== null && TABS.some((item) => item.key === value);
}

function dayLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE, d MMM");
}

const isOpen = (job: RepairJob) => job.status === "RECEIVED" || job.status === "IN_REPAIR";

function JobCard({ job, showShop }: { job: RepairJob; showShop: boolean }) {
  const { label, tone } = STAGE[stageOf(job)];
  const open = isOpen(job);
  const amount = open ? job.estimatedCost : (job.finalCharge ?? 0);
  const amountNote = open ? "estimate" : job.status === "REPAIRED" ? "to collect" : "paid";

  return (
    <Link
      to={`/repair/${job.id}`}
      // Yellow card: the job page jumps to the cost box and outlines it.
      state={job.costPending ? { focusCost: true } : undefined}
      className={clsx("rh-job", tone, job.costPending && "is-cost-pending")}
    >
      <div className="rh-main">
        <RepairPhoto
          jobId={job.id}
          side="front"
          available={job.hasFrontPhoto}
          alt={`${job.deviceName} front`}
          className="rh-thumb"
        />
        <div className="rh-body">
          <div className="rh-line">
            <p className="rh-model">{job.deviceName}</p>
            {showShop && job.shop !== MAIN_REPAIR_SHOP ? (
              <span className="rh-shop-tag">{repairShopLabel(job.shop)}</span>
            ) : null}
            <span className="rh-pill">
              <i aria-hidden />
              {label}
            </span>
          </div>
          {job.problemDescription ? (
            <p className="rh-problem">
              <Wrench aria-hidden />
              <span>{job.problemDescription}</span>
            </p>
          ) : null}
          <div className="rh-line">
            <p className="rh-meta">
              <span className="rh-jid">{job.jobNumber}</span>
              <span>·</span>
              <b>{job.customerName}</b>
              <span>· {format(new Date(job.createdAt), "h:mm a")}</span>
            </p>
            <p className={clsx("rh-amt", open && "is-est")}>
              <b>{amount != null ? formatRupees(amount) : "—"}</b>
              <small>{amountNote}</small>
            </p>
          </div>
        </div>
      </div>
      {job.costPending ? (
        <div className="rh-action is-amber">
          <AlertTriangle aria-hidden />
          <span>Add cost price to see profit</span>
          <span className="rh-action-btn">Add</span>
        </div>
      ) : job.status === "REPAIRED" ? (
        <div className="rh-action is-blue">
          <Bell aria-hidden />
          <span>{job.outcome === "NOT_FIXED" ? "Waiting to return the phone" : "Waiting for customer pickup"}</span>
          {/* Button, not a link: the whole card is already a link. */}
          <button
            type="button"
            className="rh-action-btn"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              window.location.href = `tel:+91${job.customerPhone}`;
            }}
          >
            <Phone aria-hidden /> Call
          </button>
        </div>
      ) : null}
    </Link>
  );
}

export function RepairHistoryPage() {
  const { isAdmin, repairOnly } = useAuth();
  const [searchParams] = useSearchParams();
  /** Full-access admins see every shop's jobs and can narrow to one. */
  const multiShop = isAdmin && !repairOnly;
  const [shop, setShop] = useState<string>("all");
  const [jobs, setJobs] = useState<RepairJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabKey>(() => {
    const requested = searchParams.get("tab");
    return isTabKey(requested) ? requested : "all";
  });

  useEffect(() => {
    const requested = searchParams.get("tab");
    setTab(isTabKey(requested) ? requested : "all");
  }, [searchParams]);

  // Search runs on the server (names, numbers, models, BMR-…); tabs filter here.
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setLoadError(null);
        api
          .listRepairJobs(query.trim())
          .then(({ data }) => {
            if (active) {
              setJobs(data);
              setLoadError(null);
            }
          })
          .catch((error: unknown) => {
            if (active) {
              setJobs([]);
              setLoadError(
                error instanceof Error ? error.message : "Could not load repairs.",
              );
            }
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, retry]);

  // The server already limits jobs to the shops this user may see.
  const shopJobs = useMemo(
    () => (multiShop && shop !== "all" ? jobs.filter((job) => job.shop === shop) : jobs),
    [jobs, multiShop, shop],
  );

  const counts = useMemo(() => {
    const result = {} as Record<TabKey, number>;
    for (const item of TABS) result[item.key] = shopJobs.filter((job) => inTab(job, item.key)).length;
    return result;
  }, [shopJobs]);

  const visible = useMemo(() => shopJobs.filter((job) => inTab(job, tab)), [shopJobs, tab]);

  const groups = useMemo(() => {
    const map = new Map<string, { date: Date; jobs: RepairJob[] }>();
    for (const job of visible) {
      const date = new Date(job.createdAt);
      const key = format(date, "yyyy-MM-dd");
      const group = map.get(key) ?? { date, jobs: [] };
      group.jobs.push(job);
      map.set(key, group);
    }
    return [...map.values()];
  }, [visible]);

  return (
    <div className="rh">
      <div className="rh-top">
        <div className="rh-title">
          <h1>Tracker</h1>
          <span>
            {visible.length} job{visible.length === 1 ? "" : "s"}
          </span>
        </div>
        <label className="rh-search">
          <Search aria-hidden />
          <input
            className="bg-transparent"
            placeholder="Search name, mobile, model or job ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search repairs"
          />
        </label>
        {multiShop ? (
          <div className="rh-shops" role="radiogroup" aria-label="Repair shop">
            {[["all", "All shops"], ...Object.entries(REPAIR_SHOP_LABEL)].map(([key, name]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={shop === key}
                className={clsx("rh-shop", shop === key && "is-on")}
                onClick={() => setShop(key)}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="rh-tabs" role="tablist" aria-label="Filter by status">
          {TABS.filter((item) => !SUMMARY_TAB_KEYS.has(item.key)).map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={clsx(
                "rh-tab",
                tab === item.key && "is-on",
                item.key === "action" && counts.action > 0 && "is-alert",
              )}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              <b>{counts[item.key] ?? 0}</b>
            </button>
          ))}
        </div>
      </div>

      {/* Where the phones are right now; tap to filter the list. */}
      <div className="rh-stats">
        {(
          [
            { key: "received", label: "Received", tone: "is-slate" },
            { key: "inRepair", label: "In repair", tone: "is-amber" },
            { key: "ready", label: "Ready", tone: "is-blue" },
          ] as const
        ).map((stat) => (
          <button
            key={stat.key}
            type="button"
            className={clsx("rh-stat", stat.tone, tab === stat.key && "is-on")}
            onClick={() => setTab(tab === stat.key ? "all" : stat.key)}
          >
            <small>{stat.label}</small>
            <b>{counts[stat.key] ?? 0}</b>
          </button>
        ))}
      </div>

      {loadError ? (
        <div className="rh-load-error" role="alert">
          <strong>Couldn’t load repairs</strong>
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : loading && jobs.length === 0 ? (
        <p className="rh-empty">Loading repairs…</p>
      ) : groups.length === 0 ? (
        <p className="rh-empty">
          {query || tab !== "all" ? `No repairs match${query ? ` “${query}”` : ""}.` : "No repairs yet. Saved phones appear here."}
        </p>
      ) : (
        groups.map((group) => {
          const total = group.jobs.reduce((sum, job) => sum + (isOpen(job) ? 0 : (job.finalCharge ?? 0)), 0);
          return (
            <section key={group.date.toDateString()}>
              <p className="rh-group">
                {dayLabel(group.date)}
                <span>
                  {group.jobs.length} job{group.jobs.length === 1 ? "" : "s"}
                  {total ? ` · ${formatRupees(total)}` : ""}
                </span>
              </p>
              <div className="rh-list">
                {group.jobs.map((job) => (
                  <JobCard key={job.id} job={job} showShop={multiShop} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
