import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Banknote,
  ImageOff,
  KeyRound,
  Smartphone,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BackLink } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { DangerConfirmModal } from "../components/RemoveConfirmModals";
import { api, formatINR, type StaffMark, type StaffMember, type StaffPaymentRow } from "../lib/api";

/*
 * Staff attendance (shared by both shops).
 * Tap today → Full day / Half day. A past day with no mark counts as
 * absent; marking or changing it needs the admin password. A tiny photo
 * from the front camera is saved with each mark (admins can view it).
 * Admins also keep a record of money given (advance / salary).
 */

type Status = "FULL" | "HALF" | "ABSENT" | "OPEN" | "FUTURE" | "BEFORE";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];
const KIND_LABEL: Record<StaffPaymentRow["kind"], string> = { ADVANCE: "Advance", SALARY: "Salary", OTHER: "Other" };

function monthOf(day: string) {
  return day.slice(0, 7);
}
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Front-camera photo, taken without a preview: ~160px wide, low quality
 * JPEG (a few KB). Returns null if the camera is unavailable or refused.
 */
async function quietSelfie(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream | null = null;
  try {
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 320 } }, audio: false }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
    if (!stream) return null;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 450)); // let exposure settle
    const w = 160;
    const h = Math.round((w * (video.videoHeight || 240)) / (video.videoWidth || 320));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", 0.45);
    return url.length < 38_000 ? url : null;
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

export function StaffPage() {
  const { isAdmin } = useAuth();
  const [month, setMonth] = useState("");
  const [today, setToday] = useState("");
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** One person's day (mark / change). */
  const [dayFor, setDayFor] = useState<{ id: string; day: string } | null>(null);
  /** Admin: everyone on one day. */
  const [teamDay, setTeamDay] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StaffMember | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (m = month) => {
      try {
        const { data } = await api.staff(m || "");
        setMonth(data.month);
        setToday(data.today);
        setStaff(data.staff);
        setSelectedId((cur) => (cur && data.staff.some((s) => s.id === cur) ? cur : data.staff[0]?.id ?? null));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load staff");
      }
    },
    [month],
  );

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const person = staff?.find((s) => s.id === selectedId) ?? null;
  const marks = useMemo(() => new Map((person?.attendance ?? []).map((a) => [a.day, a])), [person]);

  function statusFor(p: StaffMember | null, day: string): Status {
    const mark = p?.attendance.find((a) => a.day === day);
    if (mark) return mark.kind;
    if (day > today) return "FUTURE";
    if (p && day < p.since) return "BEFORE";
    return day === today ? "OPEN" : "ABSENT";
  }
  const statusOf = (day: string) => statusFor(person, day);

  const days = useMemo(() => {
    if (!month) return [];
    const [y, m] = month.split("-").map(Number);
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  }, [month]);
  const lead = month ? new Date(`${month}-01T00:00:00Z`).getUTCDay() : 0;

  const counts = useMemo(() => {
    const c = { FULL: 0, HALF: 0, ABSENT: 0 };
    if (isAdmin) {
      // Admin: today across the team.
      for (const p of staff ?? []) {
        const s = statusFor(p, today);
        if (s === "FULL" || s === "HALF") c[s] += 1;
        else if (s === "OPEN" || s === "ABSENT") c.ABSENT += 1;
      }
      return c;
    }
    for (const d of days) {
      const s = statusOf(d);
      if (s === "FULL" || s === "HALF" || s === "ABSENT") c[s] += 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, marks, today, person, staff, isAdmin]);

  /** Admin calendar: how many of the team came on a day. */
  function teamOn(day: string) {
    let present = 0;
    let total = 0;
    for (const p of staff ?? []) {
      const s = statusFor(p, day);
      if (s === "BEFORE" || s === "FUTURE") continue;
      total += 1;
      if (s === "FULL" || s === "HALF") present += 1;
    }
    return { present, total };
  }

  async function removePerson() {
    if (!removeTarget) return;
    setRemoveBusy(true);
    try {
      await api.removeStaff(removeTarget.id);
      setRemoveTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove staff");
      setRemoveTarget(null);
    } finally {
      setRemoveBusy(false);
    }
  }

  const changeMonth = (by: number) => {
    const next = shiftMonth(month, by);
    if (by > 0 && next > monthOf(today)) return;
    setMonth(next);
    void load(next);
  };

  const dayPerson = dayFor ? staff?.find((s) => s.id === dayFor.id) ?? null : null;
  const hasStaff = Boolean(staff?.length);

  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tide-600">Team</p>
          <h1 className="font-display text-2xl font-bold leading-tight text-ink-900">Staff attendance</h1>
        </div>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="flex shrink-0 items-center gap-2 rounded-2xl border border-ink-100 bg-white/90 py-1.5 pl-1.5 pr-3 text-sm font-semibold text-ink-800 shadow-sm transition active:scale-95 dark:bg-surface-elevated"
          >
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-tide-500 to-[#5d73b6] text-white">
              <Users className="h-4 w-4" />
            </span>
            Staff
            <span className="rounded-full bg-ink-50 px-1.5 text-xs tabular-nums text-ink-500 dark:bg-white/10">{staff?.length ?? 0}</span>
          </button>
        ) : null}
      </header>

      <div className="flex items-center justify-between gap-2 rounded-2xl border border-ink-100 bg-white/90 p-1 shadow-sm dark:bg-surface-elevated">
        <button type="button" className="grid h-9 w-9 place-items-center rounded-xl text-ink-600 hover:bg-ink-50" onClick={() => changeMonth(-1)} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-ink-900">{month ? monthLabel(month) : "…"}</span>
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-xl text-ink-600 hover:bg-ink-50 disabled:opacity-30"
          onClick={() => changeMonth(1)}
          disabled={!month || month >= monthOf(today)}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p> : null}

      {/* Staff login: pick who you are marking. */}
      {!isAdmin && hasStaff ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {(staff ?? []).map((s) => {
            const t = s.attendance.find((a) => a.day === today);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={clsx(
                  "flex shrink-0 items-center gap-2 rounded-2xl border py-1.5 pl-1.5 pr-3 text-sm font-semibold transition",
                  s.id === selectedId
                    ? "border-tide-500 bg-tide-100/70 text-ink-900 shadow-sm dark:bg-tide-400/15"
                    : "border-ink-100 bg-white/90 text-ink-700 dark:bg-surface-elevated",
                )}
              >
                <Avatar name={s.name} dot={!t ? "bg-ink-200" : t.kind === "FULL" ? "bg-emerald-500" : "bg-amber-500"} />
                <span className="capitalize">{s.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!staff ? (
        <div className="grid h-40 place-items-center text-ink-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !hasStaff ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white/70 px-6 py-10 text-center dark:bg-surface-elevated">
          <p className="font-semibold text-ink-900">No staff yet</p>
          <p className="mt-1 text-sm text-ink-500">{isAdmin ? "Tap Staff to add the people who work here." : "Ask the admin to add staff."}</p>
          {isAdmin ? (
            <button type="button" className="btn-primary mx-auto mt-4" onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" /> Add staff
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={isAdmin ? "Full today" : "Full day"} value={counts.FULL} tone="text-emerald-600" dot="bg-emerald-500" />
            <Stat label={isAdmin ? "Half today" : "Half day"} value={counts.HALF} tone="text-amber-600" dot="bg-amber-500" />
            <Stat label={isAdmin ? "Not in today" : "Absent"} value={counts.ABSENT} tone="text-rose-600" dot="bg-rose-500" />
          </div>

          <section className="rounded-3xl border border-ink-100 bg-white/90 p-3 shadow-sm dark:bg-surface-elevated">
            <div className="mb-1.5 grid grid-cols-7 text-center text-[11px] font-semibold text-ink-400">
              {WEEK.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {days.map((d) => {
                if (isAdmin) {
                  const { present, total } = teamOn(d);
                  const future = d > today || total === 0;
                  const all = !future && present === total;
                  const none = !future && present === 0;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={future}
                      onClick={() => setTeamDay(d)}
                      className={clsx(
                        "relative flex aspect-square flex-col items-center justify-center rounded-xl text-[13px] font-semibold tabular-nums transition active:scale-95",
                        future && "text-ink-300",
                        all && "bg-emerald-500 text-white shadow-[0_6px_14px_-8px_rgba(16,185,129,0.9)]",
                        !future && !all && !none && "bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30",
                        none && d !== today && "bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-500/30",
                        none && d === today && "bg-white text-tide-600 dark:bg-transparent",
                        d === today && "ring-2 ring-tide-500",
                      )}
                    >
                      {Number(d.slice(8))}
                      {!future ? <span className="text-[9px] font-bold leading-none opacity-80">{present}/{total}</span> : null}
                    </button>
                  );
                }
                const s = statusOf(d);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={s === "FUTURE" || s === "BEFORE"}
                    onClick={() => person && setDayFor({ id: person.id, day: d })}
                    className={clsx(
                      "relative grid aspect-square place-items-center rounded-xl text-[13px] font-semibold tabular-nums transition active:scale-95",
                      s === "FULL" && "bg-emerald-500 text-white shadow-[0_6px_14px_-8px_rgba(16,185,129,0.9)]",
                      s === "HALF" && "bg-[linear-gradient(135deg,#f59e0b_50%,#fde68a_50%)] text-white",
                      s === "ABSENT" && "bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-500/30",
                      s === "OPEN" && "bg-white text-tide-600 ring-2 ring-tide-500 dark:bg-transparent",
                      (s === "FUTURE" || s === "BEFORE") && "text-ink-300",
                    )}
                  >
                    {Number(d.slice(8))}
                    {marks.get(d)?.byAdmin ? <KeyRound className="absolute right-0.5 top-0.5 h-2.5 w-2.5 opacity-70" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
              {isAdmin ? (
                <>
                  <Legend className="bg-emerald-500" label="Everyone in" />
                  <Legend className="bg-amber-300" label="Some in" />
                  <Legend className="bg-rose-300" label="Nobody" />
                  <span>2/3 = came / staff</span>
                </>
              ) : (
                <>
                  <Legend className="bg-emerald-500" label="Full" />
                  <Legend className="bg-amber-500" label="Half" />
                  <Legend className="bg-rose-300" label="Absent" />
                  <span className="inline-flex items-center gap-1">
                    <KeyRound className="h-3 w-3" /> Added by admin
                  </span>
                </>
              )}
            </div>
          </section>
        </>
      )}

      <AnimatePresence>
        {teamDay && staff ? (
          <TeamDaySheet
            key={`team-${teamDay}`}
            day={teamDay}
            today={today}
            staff={staff.filter((p) => statusFor(p, teamDay) !== "BEFORE")}
            statusFor={statusFor}
            onClose={() => setTeamDay(null)}
            onPick={(id) => {
              setTeamDay(null);
              setDayFor({ id, day: teamDay });
            }}
          />
        ) : null}
        {dayFor && dayPerson ? (
          <DaySheet
            key={`${dayFor.id}-${dayFor.day}`}
            person={dayPerson}
            day={dayFor.day}
            today={today}
            mark={dayPerson.attendance.find((a) => a.day === dayFor.day) ?? null}
            isAdmin={isAdmin}
            onClose={() => setDayFor(null)}
            onSaved={() => {
              setDayFor(null);
              void load();
            }}
          />
        ) : null}
        {listOpen && staff ? (
          <StaffListSheet
            key="list"
            staff={staff}
            onClose={() => setListOpen(false)}
            onAdd={() => {
              setListOpen(false);
              setAdding(true);
            }}
            onMoney={(id) => {
              setListOpen(false);
              navigate(`${id}/money?month=${month}`);
            }}
            onRemove={(p) => {
              setListOpen(false);
              setRemoveTarget(p);
            }}
          />
        ) : null}
        {removeTarget ? (
          <DangerConfirmModal
            key="remove"
            title="Remove staff?"
            subtitle={removeTarget.name}
            points={[
              `${removeTarget.name} leaves the staff list and can't be marked any more.`,
              "Past attendance, photos and money given stay saved.",
            ]}
            confirmLabel="Remove staff"
            cancelLabel="Keep"
            working={removeBusy}
            onCancel={() => !removeBusy && setRemoveTarget(null)}
            onConfirm={() => void removePerson()}
          />
        ) : null}
        {adding ? (
          <AddStaffSheet
            key="add"
            onClose={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              void load();
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Avatar({ name, dot, size = "h-8 w-8" }: { name: string; dot?: string; size?: string }) {
  return (
    <span className={clsx("relative grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-tide-500 to-[#5d73b6] text-xs font-bold text-white", size)}>
      {name.slice(0, 1).toUpperCase()}
      {dot ? <i className={clsx("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-surface-elevated", dot)} /> : null}
    </span>
  );
}

const TIME = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Admin: everyone's attendance on one day, with photo thumbnails that zoom. */
function TeamDaySheet({
  day,
  today,
  staff,
  statusFor,
  onClose,
  onPick,
}: {
  day: string;
  today: string;
  staff: StaffMember[];
  statusFor: (p: StaffMember, day: string) => Status;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [zoom, setZoom] = useState<{ id: string; name: string; time: string } | null>(null);
  const rows = staff.map((p) => ({ p, mark: p.attendance.find((a) => a.day === day) ?? null, s: statusFor(p, day) }));

  useEffect(() => {
    for (const { mark } of rows) {
      if (!mark?.hasPhoto) continue;
      api
        .staffPhoto(mark.id)
        .then(({ data }) => setPhotos((cur) => ({ ...cur, [mark.id]: data.photo })))
        .catch(() => setPhotos((cur) => ({ ...cur, [mark.id]: null })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const present = rows.filter((r) => r.s === "FULL" || r.s === "HALF").length;
  return (
    <Sheet title={dayLabel(day)} subtitle={`${present} of ${rows.length} came`} onClose={onClose}>
      <ul className="space-y-2">
        {rows.map(({ p, mark, s }, index) => (
          <motion.li
            key={p.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { delay: index * 0.035 } }}
            className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-2.5 dark:border-white/10 dark:bg-white/5"
          >
            <Avatar name={p.name} size="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold capitalize text-ink-900">{p.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs">
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 font-semibold",
                    s === "FULL" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
                    s === "HALF" && "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
                    s === "ABSENT" && "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
                    s === "OPEN" && "bg-ink-50 text-ink-500 dark:bg-white/10",
                  )}
                >
                  {s === "FULL" ? "Full day" : s === "HALF" ? "Half day" : s === "ABSENT" ? "Absent" : "Not marked"}
                </span>
                {mark ? <span className="text-ink-500">{TIME(mark.createdAt)}{mark.byAdmin ? " · admin" : ""}</span> : null}
              </p>
            </div>
            {mark?.hasPhoto ? (
              <button
                type="button"
                onClick={() => photos[mark.id] && setZoom({ id: mark.id, name: p.name, time: TIME(mark.createdAt) })}
                className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink-50 shadow-sm ring-2 ring-white transition active:scale-95 dark:bg-white/10 dark:ring-white/10"
                aria-label={`Open ${p.name}'s photo`}
              >
                {photos[mark.id] ? (
                  <motion.img layoutId={`team-photo-${mark.id}`} src={photos[mark.id]!} alt="" className="h-full w-full object-cover" />
                ) : photos[mark.id] === null ? (
                  <ImageOff className="h-4 w-4 text-ink-300" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
                )}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onPick(p.id)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-ink-100 text-ink-500 transition hover:border-tide-500 hover:text-tide-600 dark:border-white/10"
              aria-label={mark ? `Change ${p.name}` : `Add ${p.name}`}
              title={mark ? "Change" : day === today ? "Add as admin" : "Add attendance"}
            >
              {mark ? <KeyRound className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </button>
          </motion.li>
        ))}
      </ul>
      {createPortal(
        <AnimatePresence>
          {zoom && photos[zoom.id] ? (
            <motion.div
              className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-ink-950/80 p-6 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setZoom(null)}
            >
              <motion.img
                layoutId={`team-photo-${zoom.id}`}
                src={photos[zoom.id]!}
                alt={zoom.name}
                className="w-full max-w-[320px] rounded-[28px] object-cover shadow-2xl ring-4 ring-white/15"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
              <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.12 } }} exit={{ opacity: 0 }} className="text-center text-sm font-semibold text-white/90">
                <span className="capitalize">{zoom.name}</span> · {dayLabel(day)} · {zoom.time}
                <span className="mt-1 block text-xs font-normal text-white/60">Tap anywhere to close</span>
              </motion.p>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </Sheet>
  );
}

/** Admin: the staff list (add, money given, remove). */
function StaffListSheet({
  staff,
  onClose,
  onAdd,
  onMoney,
  onRemove,
}: {
  staff: StaffMember[];
  onClose: () => void;
  onAdd: () => void;
  onMoney: (id: string) => void;
  onRemove: (p: StaffMember) => void;
}) {
  return (
    <Sheet title="Staff" subtitle={`${staff.length} ${staff.length === 1 ? "person" : "people"}`} onClose={onClose}>
      <ul className="space-y-2">
        {staff.map((p, index) => {
          const given = p.payments.reduce((a, x) => a + x.amount, 0);
          const came = p.attendance.length;
          return (
            <motion.li
              key={p.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: index * 0.035 } }}
              className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white p-2.5 dark:border-white/10 dark:bg-white/5"
            >
              <Avatar name={p.name} size="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold capitalize text-ink-900">{p.name}</p>
                <p className="text-xs text-ink-500">
                  {came} day{came === 1 ? "" : "s"} marked · {formatINR(given)} given
                  {p.phone ? ` · ${p.phone}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onMoney(p.id)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-ink-100 text-tide-600 transition hover:border-tide-500 dark:border-white/10"
                aria-label={`Money given to ${p.name}`}
                title="Money given"
              >
                <Wallet className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onRemove(p)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                aria-label={`Remove ${p.name}`}
                title="Remove staff"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </motion.li>
          );
        })}
      </ul>
      <button type="button" className="btn-primary mt-3 w-full" onClick={onAdd}>
        <UserPlus className="h-4 w-4" /> Add staff
      </button>
    </Sheet>
  );
}

function Stat({ label, value, tone, dot }: { label: string; value: number; tone: string; dot: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white/90 px-3 py-2.5 dark:bg-surface-elevated">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-500">
        <i className={clsx("h-2 w-2 rounded-full", dot)} /> {label}
      </p>
      <p className={clsx("mt-0.5 font-display text-xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i className={clsx("h-2.5 w-2.5 rounded", className)} /> {label}
    </span>
  );
}

/** Bottom sheet used by every staff popup. */
function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-lift sm:rounded-3xl dark:bg-surface-elevated"
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-ink-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-ink-500 first-letter:uppercase">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-ink-400 hover:bg-ink-50" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function DaySheet({
  person,
  day,
  today,
  mark,
  isAdmin,
  onClose,
  onSaved,
}: {
  person: StaffMember;
  day: string;
  today: string;
  mark: StaffMark | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<"FULL" | "HALF">(mark?.kind ?? "FULL");
  // Today is marked from the staff account; an admin adds it only on purpose.
  const [editing, setEditing] = useState(!mark && !(isAdmin && day === today));
  const [zoom, setZoom] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const needsAdmin = day !== today || Boolean(mark) || isAdmin;

  useEffect(() => {
    if (!isAdmin || !mark?.hasPhoto) return;
    api
      .staffPhoto(mark.id)
      .then(({ data }) => setPhoto(data.photo))
      .catch(() => setPhoto(null));
  }, [isAdmin, mark]);

  async function submit(next: "FULL" | "HALF" | "CLEAR") {
    if (needsAdmin && !password) {
      setError("Enter the admin password");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Photo only when the staff member marks their own day.
      const shot = next === "CLEAR" || day !== today || isAdmin ? null : await quietSelfie();
      await api.markStaff(person.id, { day, kind: next, photo: shot, adminPassword: needsAdmin ? password : undefined });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <Sheet title={dayLabel(day)} subtitle={person.name} onClose={() => !busy && onClose()}>
      {!mark && !editing ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-2xl bg-tide-100/60 p-3 dark:bg-tide-400/10">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-tide-500 text-white">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-ink-900">Not marked yet</p>
              <p className="text-ink-500">Staff marks today&apos;s attendance from their own account.</p>
            </div>
          </div>
          <button type="button" className="btn-secondary w-full" onClick={() => setEditing(true)}>
            <KeyRound className="h-4 w-4" /> Add as admin
          </button>
        </div>
      ) : mark && !editing ? (
        <div className="space-y-3">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={clsx("flex items-center gap-3 rounded-2xl p-3", mark.kind === "FULL" ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-amber-50 dark:bg-amber-500/10")}
          >
            <span className={clsx("grid h-10 w-10 place-items-center rounded-xl text-white", mark.kind === "FULL" ? "bg-emerald-500" : "bg-amber-500")}>
              <Check className="h-5 w-5" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-ink-900">{mark.kind === "FULL" ? "Full day" : "Half day"}</p>
              <p className="text-ink-500">
                {new Date(mark.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                {mark.markedByName ? ` · ${mark.markedByName}` : ""}
                {mark.byAdmin ? " · admin" : ""}
              </p>
            </div>
            {isAdmin ? (
              mark.hasPhoto ? (
                <button
                  type="button"
                  onClick={() => photo && setZoom(true)}
                  className="ml-auto grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-md ring-2 ring-white transition active:scale-95 dark:bg-white/10 dark:ring-white/10"
                  aria-label="Open photo"
                >
                  {photo ? (
                    <motion.img layoutId={`staff-photo-${mark.id}`} src={photo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
                  )}
                </button>
              ) : (
                <span className="ml-auto grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/70 text-ink-300 dark:bg-white/5" title="No photo">
                  <ImageOff className="h-5 w-5" />
                </span>
              )
            ) : null}
          </motion.div>
          <button type="button" className="btn-secondary w-full" onClick={() => setEditing(true)}>
            Change (admin)
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {day !== today && !mark ? (
            <p className="rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              Marked absent. The admin can add the attendance for this day.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {(["FULL", "HALF"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={clsx(
                  "rounded-2xl border-2 p-4 text-left transition",
                  kind === k
                    ? k === "FULL"
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                      : "border-amber-500 bg-amber-50 dark:bg-amber-500/10"
                    : "border-ink-100",
                )}
              >
                <span className={clsx("mb-2 block h-7 w-7 rounded-full", k === "FULL" ? "bg-emerald-500" : "bg-[linear-gradient(90deg,#f59e0b_50%,#fde68a_50%)]")} />
                <span className="block font-semibold text-ink-900">{k === "FULL" ? "Full day" : "Half day"}</span>
                <span className="text-xs text-ink-500">{k === "FULL" ? "Counts as 1 day" : "Counts as ½ day"}</span>
              </button>
            ))}
          </div>
          {needsAdmin ? (
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-500">
                <KeyRound className="h-3.5 w-3.5" /> Admin password
              </span>
              <input type="password" className="field w-full" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            </label>
          ) : null}
          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
          <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void submit(kind)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Submit attendance
          </button>
          {mark ? (
            <button type="button" className="w-full py-1 text-sm font-semibold text-rose-600" disabled={busy} onClick={() => void submit("CLEAR")}>
              Remove this day&apos;s attendance
            </button>
          ) : null}
        </div>
      )}
      {createPortal(
        <AnimatePresence>
          {zoom && photo && mark ? (
            <motion.div
              className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-ink-950/80 p-6 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setZoom(false)}
            >
              <motion.img
                layoutId={`staff-photo-${mark.id}`}
                src={photo}
                alt={`${person.name} on ${day}`}
                className="w-full max-w-[320px] rounded-[28px] object-cover shadow-2xl ring-4 ring-white/15"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.12 } }}
                exit={{ opacity: 0 }}
                className="text-center text-sm font-semibold text-white/90"
              >
                <span className="capitalize">{person.name}</span> · {dayLabel(day)} ·{" "}
                {new Date(mark.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                <span className="mt-1 block text-xs font-normal normal-case text-white/60">Tap anywhere to close</span>
              </motion.p>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </Sheet>
  );
}

/** Money given to one staff member, month by month (admin). */
export function StaffMoneyPage() {
  const { id } = useParams();
  const location = useLocation();
  const base = location.pathname.replace(/\/[^/]+\/money\/?$/, "") || "/staff";
  const [search, setSearch] = useSearchParams();
  const [month, setMonth] = useState(search.get("month") || "");
  const [today, setToday] = useState("");
  const [person, setPerson] = useState<StaffMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (m: string) => {
      try {
        const { data } = await api.staff(m);
        setMonth(data.month);
        setToday(data.today);
        const found = data.staff.find((s) => s.id === id) ?? null;
        setPerson(found);
        setError(found ? null : "This staff member was not found");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load");
      }
    },
    [id],
  );

  useEffect(() => {
    void load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const changeMonth = (by: number) => {
    const next = shiftMonth(month, by);
    if (by > 0 && next > monthOf(today)) return;
    setMonth(next);
    setSearch({ month: next }, { replace: true });
    void load(next);
  };

  return (
    <div className="mx-auto max-w-md space-y-3 pb-8">
      <BackLink to={base} historyBack>
        Staff
      </BackLink>
      <header className="flex items-center gap-3">
        <Avatar name={person?.name || "?"} size="h-11 w-11" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-[22px] font-bold leading-tight text-ink-900">{person?.name || "…"}</h1>
          <p className="text-sm text-ink-500">Money given</p>
        </div>
      </header>
      {error ? (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>
      ) : person && today ? (
        <MoneyTab person={person} month={month} today={today} onMonth={changeMonth} onChanged={() => void load(month)} />
      ) : (
        <div className="grid place-items-center py-16 text-ink-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
    </div>
  );
}

const KIND_TONE: Record<StaffPaymentRow["kind"], string> = {
  ADVANCE: "bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-400/10 dark:text-amber-300",
  SALARY: "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-400/10 dark:text-emerald-300",
  OTHER: "bg-slate-100 text-slate-600 ring-slate-200/70 dark:bg-white/10 dark:text-slate-300",
};

function rupees(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function MoneyTab({
  person,
  month,
  today,
  onMonth,
  onChanged,
}: {
  person: StaffMember;
  month: string;
  today: string;
  onMonth: (by: number) => void;
  onChanged: () => void;
}) {
  const thisMonth = month === today.slice(0, 7);
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(thisMonth ? today : `${month}-01`);
  const [kind, setKind] = useState<StaffPaymentRow["kind"]>("ADVANCE");
  const [mode, setMode] = useState<StaffPaymentRow["mode"]>("CASH");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New entries go into the month being looked at.
  useEffect(() => {
    setDay(month === today.slice(0, 7) ? today : `${month}-01`);
  }, [month, today]);

  const pays = person.payments;
  const total = pays.reduce((a, p) => a + p.amount, 0);
  const sumBy = (f: (p: StaffPaymentRow) => boolean) => pays.filter(f).reduce((a, p) => a + p.amount, 0);
  const cash = sumBy((p) => (p.mode ?? "CASH") === "CASH");
  const online = total - cash;
  const short = monthLabel(month).split(" ")[0];
  const n = Number(amount);

  async function add() {
    if (!(n > 0)) return setError("Enter the amount");
    setBusy(true);
    setError(null);
    try {
      await api.addStaffPayment(person.id, { amount: n, day, kind, mode, note });
      setAmount("");
      setNote("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: StaffPaymentRow) {
    if (!window.confirm(`Delete ${rupees(p.amount)} given on ${dayLabel(p.day)}?`)) return;
    await api.deleteStaffPayment(p.id).catch(() => undefined);
    onChanged();
  }

  return (
    <div className="space-y-3">
      {/* Month */}
      <div className="flex items-center justify-between rounded-2xl border border-ink-100 bg-white/90 p-1 shadow-sm dark:bg-surface-elevated">
        <button type="button" className="grid h-8 w-8 place-items-center rounded-xl text-ink-600 transition hover:bg-ink-50 active:scale-95 dark:hover:bg-white/10" onClick={() => onMonth(-1)} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-ink-900">{monthLabel(month)}</span>
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-xl text-ink-600 transition hover:bg-ink-50 active:scale-95 disabled:opacity-30 dark:hover:bg-white/10"
          onClick={() => onMonth(1)}
          disabled={thisMonth}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Summary */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1e293b] via-[#24365f] to-[#3b5bdb] p-4 text-white shadow-lift">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Given in {short}</p>
        <p className="mt-0.5 font-display text-[28px] font-extrabold leading-tight tabular-nums">{rupees(total)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2">
            <Banknote className="h-4 w-4 text-emerald-300" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">Cash</p>
              <p className="text-sm font-bold tabular-nums">{rupees(cash)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2">
            <Smartphone className="h-4 w-4 text-sky-300" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">Online</p>
              <p className="text-sm font-bold tabular-nums">{rupees(online)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Give money */}
      <section className="space-y-2.5 rounded-3xl border border-ink-100 bg-white p-3.5 shadow-sm dark:bg-surface-elevated">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Give money</p>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-ink-50 p-1 dark:bg-white/5">
          {(["ADVANCE", "SALARY", "OTHER"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={clsx("rounded-lg py-1.5 text-xs font-semibold transition", kind === k ? "bg-white text-ink-900 shadow-sm dark:bg-surface-elevated" : "text-ink-500")}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-ink-50/50 px-3 focus-within:border-tide-400 focus-within:bg-white dark:bg-white/5">
          <span className="text-lg font-bold text-ink-400">₹</span>
          <input
            className="h-12 w-full min-w-0 bg-transparent text-xl font-bold tabular-nums text-ink-900 outline-none placeholder:text-base placeholder:font-medium placeholder:text-ink-300"
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Amount"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["CASH", "Cash", Banknote],
              ["ONLINE", "Online", Smartphone],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={clsx(
                "flex h-10 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition active:scale-[0.98]",
                mode === m
                  ? m === "CASH"
                    ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"
                    : "border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300"
                  : "border-ink-100 text-ink-500",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {mode === m ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_1.2fr] gap-2">
          <input className="field h-10" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
          <input className="field h-10" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void add()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {n > 0 ? `Give ${rupees(n)} · ${KIND_LABEL[kind]} · ${mode === "CASH" ? "Cash" : "Online"}` : `Save ${KIND_LABEL[kind].toLowerCase()}`}
        </button>
      </section>

      {/* History */}
      <section className="overflow-hidden rounded-3xl border border-ink-100 bg-white shadow-sm dark:bg-surface-elevated">
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">History · {short}</p>
          <p className="text-xs font-medium text-ink-400">{pays.length} {pays.length === 1 ? "entry" : "entries"}</p>
        </div>
        {pays.length ? (
          <ul>
            {pays.map((p) => {
              const online = (p.mode ?? "CASH") === "ONLINE";
              return (
                <li key={p.id} className="flex items-center gap-3 border-b border-ink-100/70 px-4 py-2.5 last:border-0">
                  <span className={clsx("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-center ring-1", KIND_TONE[p.kind])}>
                    <span className="text-sm font-extrabold leading-none">{Number(p.day.slice(8))}</span>
                    <span className="-mt-1 text-[9px] font-semibold uppercase leading-none opacity-70">{p.day && monthLabel(p.day.slice(0, 7)).slice(0, 3)}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                      {KIND_LABEL[p.kind]}
                      <span
                        className={clsx(
                          "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold",
                          online ? "bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
                        )}
                      >
                        {online ? <Smartphone className="h-3 w-3" /> : <Banknote className="h-3 w-3" />}
                        {online ? "Online" : "Cash"}
                      </span>
                    </p>
                    <p className="truncate text-xs text-ink-500">{[dayLabel(p.day), p.note].filter(Boolean).join(" · ")}</p>
                  </div>
                  <p className="font-display text-[15px] font-bold tabular-nums text-ink-900">{rupees(p.amount)}</p>
                  <button type="button" onClick={() => void remove(p)} className="-mr-1 rounded-lg p-1.5 text-ink-300 transition hover:bg-rose-50 hover:text-rose-600" aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 pb-6 pt-4 text-center text-sm text-ink-500">Nothing given in {monthLabel(month)}.</p>
        )}
        {pays.length ? (
          <div className="border-t border-ink-100 bg-ink-50/70 px-4 py-3 dark:bg-white/5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-ink-900">Total for {short}</p>
              <p className="font-display text-lg font-extrabold tabular-nums text-ink-900">{rupees(total)}</p>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(["ADVANCE", "SALARY", "OTHER"] as const).map((k) => {
                const sum = sumBy((x) => x.kind === k);
                return sum > 0 ? (
                  <span key={k} className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1", KIND_TONE[k])}>
                    {KIND_LABEL[k]} {rupees(sum)}
                  </span>
                ) : null;
              })}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function AddStaffSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.addStaff({ name: name.trim(), phone: phone.replace(/\D/g, "") });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }
  return (
    <Sheet title="Add staff" onClose={() => !busy && onClose()}>
      <div className="space-y-3">
        <input className="field w-full" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <input className="field w-full" placeholder="Mobile (optional)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
        <button type="button" className="btn-primary w-full" disabled={busy || name.trim().length < 2} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add staff
        </button>
      </div>
    </Sheet>
  );
}
