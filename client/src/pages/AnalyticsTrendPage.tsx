import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import clsx from "clsx";
import { BackLink, LoadingBlock } from "../components/ui";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { TrendChart, type TrendPoint } from "../components/TrendChart";
import { HeroSparkles } from "../components/AnalyticsBackdrop";
import { formatRupees } from "../lib/dueStatus";
import { readFromState } from "../lib/navMemory";
import { SPRING, riseIn } from "../lib/motion";
import {
  bestMonth,
  cachedTrend,
  changePct,
  compactINR,
  loadTrend,
  metricValue,
  monthLong,
  previousComparable,
  monthShort,
  type TrendMetric,
} from "../lib/trend";
import type { MonthlyTrend } from "../types";

const METRICS: Array<{ value: TrendMetric; label: string }> = [
  { value: "sales", label: "Sales & profit" },
  { value: "collected", label: "Collected" },
  { value: "phones", label: "Phones sold" },
];

function formatMetric(value: number, metric: TrendMetric) {
  return metric === "phones" ? String(Math.round(value)) : formatRupees(value);
}

function formatAxis(value: number, metric: TrendMetric) {
  return metric === "phones" ? String(value) : compactINR(value);
}

function rupees(value: number) {
  return formatRupees(value);
}

/** Line key for tooltips / legend (identity next to the text, never text colour). */
function Key({ kind }: { kind: "bar" | "line" }) {
  return kind === "bar" ? (
    <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--trend-sales)" }} />
  ) : (
    <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: "var(--trend-profit)" }} />
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Info card for one day of the day-by-day chart: sales, profit, more. */
function DayCard({ day }: { day: MonthlyTrend["months"][number]["days"][number] }) {
  const [y, m, d] = day.date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const margin = day.sales > 0 ? (day.profit / day.sales) * 100 : null;
  const row = (label: string, value: string, tone = "text-ink-900") => (
    <p className="flex items-baseline justify-between gap-4">
      <span className="text-[11px] font-medium text-ink-500">{label}</span>
      <span className={clsx("text-[13px] font-bold tabular-nums", tone)}>{value}</span>
    </p>
  );
  return (
    <div className="min-w-[10.5rem]">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-400">
        {weekday}, {d} {monthShort(day.date.slice(0, 7))}
      </p>
      {row("Sales", formatRupees(day.sales))}
      {row(
        "Profit",
        `${formatRupees(day.profit)}${margin != null ? ` · ${margin.toFixed(1)}%` : ""}`,
        day.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
      )}
      {row("Collected", formatRupees(day.collected))}
      <p className="mt-1 border-t border-[#EEF1F5] pt-1 text-[11px] text-ink-500 dark:border-[rgb(var(--color-line))]">
        {day.bills} bill{day.bills === 1 ? "" : "s"} · {day.phones} phone{day.phones === 1 ? "" : "s"}
      </p>
    </div>
  );
}

export function AnalyticsTrendPage() {
  const location = useLocation();
  const from = readFromState(location.state);
  const [data, setData] = useState<MonthlyTrend | null>(cachedTrend);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<TrendMetric>("sales");
  const [selected, setSelected] = useState<number | null>(null);
  /** -1 = moved to an older month, 1 = newer (for the slide direction). */
  const [direction, setDirection] = useState(0);
  /** Day whose info card is open in the day-by-day chart. */
  const [pinnedDay, setPinnedDay] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    loadTrend()
      .then((fresh) => {
        if (active) {
          setData(fresh);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load the trend");
      });
    return () => {
      active = false;
    };
  }, []);

  const months = useMemo(() => data?.months ?? [], [data]);
  const index = selected ?? months.length - 1;
  const month = months[index];
  const previous = index > 0 ? months[index - 1] : null;

  // A new month or metric closes the day card.
  useEffect(() => {
    setPinnedDay(null);
  }, [selected, metric]);

  function select(next: number) {
    if (next < 0 || next >= months.length || next === index) return;
    setDirection(next > index ? 1 : -1);
    setSelected(next);
  }

  function onSwipe(_: unknown, info: PanInfo) {
    if (info.offset.x < -50 || info.velocity.x < -400) select(index + 1);
    else if (info.offset.x > 50 || info.velocity.x > 400) select(index - 1);
  }

  const monthPoints: TrendPoint[] = useMemo(
    () =>
      months.map((m) => ({
        key: m.key,
        label: monthShort(m.key),
        value: metricValue(m, metric),
        line: metric === "sales" ? m.profit : undefined,
        title: `${monthLong(m.key)}: ${formatMetric(metricValue(m, metric), metric)}${
          metric === "sales" ? `, profit ${rupees(m.profit)}` : ""
        }`,
      })),
    [months, metric],
  );

  const dayPoints: TrendPoint[] = useMemo(
    () =>
      (month?.days ?? []).map((d) => ({
        key: d.date,
        label: String(Number(d.date.slice(8, 10))),
        value: metricValue(d, metric),
        title: `${Number(d.date.slice(8, 10))} ${monthShort(month?.key ?? "")}: ${formatMetric(metricValue(d, metric), metric)}`,
      })),
    [month, metric],
  );

  const bestDayIndex = useMemo(() => {
    let best = -1;
    dayPoints.forEach((p, i) => {
      if (p.value > 0 && (best < 0 || p.value > dayPoints[best].value)) best = i;
    });
    return best < 0 ? null : best;
  }, [dayPoints]);

  const total = months.reduce((sum, m) => sum + metricValue(m, metric), 0);
  const activeMonths = months.filter((m) => m.bills > 0).length || months.length || 1;
  const best = bestMonth(months, metric);
  const value = month ? metricValue(month, metric) : 0;
  const comparable = data && month ? previousComparable(months, index, metric, data.today) : null;
  const change = comparable ? changePct(value, comparable.value) : null;
  const margin = month && month.sales > 0 ? (month.profit / month.sales) * 100 : null;

  return (
    <div>
      <BackLink to={from ?? "/analytics"}>Back to analytics</BackLink>

      <motion.div
        className="mb-4 mt-3 flex items-start justify-between gap-3"
        variants={riseIn}
        initial="hidden"
        animate="show"
        custom={0}
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
            Monthly trend
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink-900">
            Last 12 months
          </h1>
        </div>
        <motion.div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[#E8F0FE] text-[#2563EB] dark:bg-[#3987e5]/20 dark:text-[#93C5FD]"
          initial={{ rotate: -20, scale: 0.6, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={{ ...SPRING, delay: 0.1 }}
        >
          <TrendingUp className="h-5 w-5" strokeWidth={2.2} />
        </motion.div>
      </motion.div>

      {/* Metric switch: the highlight slides between options. */}
      <motion.div
        className="mb-3 grid grid-cols-3 gap-1 rounded-2xl border border-ink-100/80 bg-white/80 p-1 dark:bg-surface"
        role="tablist"
        aria-label="What to show"
        variants={riseIn}
        initial="hidden"
        animate="show"
        custom={1}
      >
        {METRICS.map((option) => {
          const on = metric === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={on}
              className={clsx(
                "relative isolate rounded-xl px-1 py-2 text-[12.5px] font-semibold transition-colors",
                on ? "text-[#1f1600]" : "text-ink-500 hover:text-ink-800",
              )}
              onClick={() => setMetric(option.value)}
            >
              {on ? (
                <motion.span
                  layoutId="trend-metric-pill"
                  className="segment-on absolute inset-0 -z-10 rounded-xl"
                  transition={SPRING}
                />
              ) : null}
              {option.label}
            </button>
          );
        })}
      </motion.div>

      {error && !data ? (
        <div className="rounded-[14px] border border-orange-100 bg-orange-50 px-5 py-4 text-sm text-ember-500">
          {error}
        </div>
      ) : null}

      {!data ? (
        <LoadingBlock label="Loading the trend…" />
      ) : month ? (
        <>
          {/* Selected month: swipe left / right to move. */}
          <motion.section
            className="fx-sheen relative mb-3 touch-pan-y overflow-hidden rounded-[1.125rem] bg-[radial-gradient(120%_140%_at_0%_0%,#1B2740_0%,#0E1626_60%)] p-5 text-white shadow-lift"
            variants={riseIn}
            initial="hidden"
            animate="show"
            custom={2}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={onSwipe}
            aria-label={`${monthLong(month.key)} figures`}
          >
            <HeroSparkles />
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 animate-float rounded-full opacity-60"
              style={{ background: "radial-gradient(circle, rgba(255,168,0,.22), transparent 65%)" }}
            />
            <div className="relative flex items-center justify-between gap-2">
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-30"
                onClick={() => select(index - 1)}
                disabled={index === 0}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="relative h-5 flex-1 overflow-hidden text-center">
                <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                  <motion.p
                    key={month.key}
                    custom={direction}
                    className="absolute inset-x-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[#8EA0BC]"
                    initial={{ opacity: 0, x: direction * 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: direction * -40 }}
                    transition={SPRING}
                  >
                    {monthLong(month.key)}
                    {index === months.length - 1 ? " · so far" : ""}
                  </motion.p>
                </AnimatePresence>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 disabled:opacity-30"
                onClick={() => select(index + 1)}
                disabled={index === months.length - 1}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="relative mt-3 flex flex-wrap items-end justify-center gap-x-3 gap-y-1 text-center">
              <AnimatedNumber
                value={value}
                format={(v) => formatMetric(v, metric)}
                className="font-display text-[2.4rem] font-bold leading-none tracking-tight tabular-nums"
              />
              {metric === "phones" ? (
                <span className="pb-1 text-sm font-semibold text-white/60">phones</span>
              ) : null}
            </div>

            <div className="relative mt-2.5 flex justify-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={`${month.key}|${metric}`}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold",
                    change == null
                      ? "bg-white/10 text-white/70"
                      : change >= 0
                        ? "bg-[#5CE0AE]/15 text-[#5CE0AE]"
                        : "bg-orange-300/15 text-orange-300",
                  )}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                >
                  {change == null ? (
                    previous ? "No sales the month before" : "First month shown"
                  ) : (
                    <>
                      {change >= 0 ? (
                        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.6} />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2.6} />
                      )}
                      {Math.abs(change).toFixed(1)}% {comparable?.label}
                    </>
                  )}
                </motion.span>
              </AnimatePresence>
            </div>

            <div className="relative mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center [&>div]:min-w-0">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8EA0BC]">Profit</p>
                <AnimatedNumber
                  value={month.profit}
                  format={formatRupees}
                  fit
                  className={clsx(
                    "mt-0.5 font-display text-base font-bold tabular-nums",
                    month.profit >= 0 ? "text-[#5CE0AE]" : "text-orange-300",
                  )}
                />
                {margin != null ? (
                  <p className="text-[10.5px] font-semibold text-white/50">{margin.toFixed(1)}% margin</p>
                ) : null}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8EA0BC]">Bills</p>
                <AnimatedNumber
                  value={month.bills}
                  format={(v) => String(Math.round(v))}
                  className="mt-0.5 block font-display text-base font-bold tabular-nums"
                />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8EA0BC]">
                  {metric === "phones" ? "Sales" : "Phones"}
                </p>
                <AnimatedNumber
                  value={metric === "phones" ? month.sales : month.phones}
                  format={(v) => (metric === "phones" ? formatRupees(v) : String(Math.round(v)))}
                  fit
                  className="mt-0.5 font-display text-base font-bold tabular-nums"
                />
              </div>
            </div>
            <p className="relative mt-3 text-center text-[10.5px] font-medium text-white/40">
              Swipe or tap a month in the chart
            </p>
          </motion.section>

          {/* 12-month chart */}
          <motion.section
            className="due-card mb-3 px-3 pb-3 pt-3.5"
            variants={riseIn}
            initial="hidden"
            animate="show"
            custom={3}
          >
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <h2 className="text-[13px] font-bold text-ink-900">Month by month</h2>
              {metric === "sales" ? (
                <div className="flex items-center gap-3 text-[11.5px] font-semibold text-ink-500">
                  <span className="flex items-center gap-1.5">
                    <Key kind="bar" /> Sales
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Key kind="line" /> Profit
                  </span>
                </div>
              ) : null}
            </div>
            <TrendChart
              points={monthPoints}
              height={170}
              selected={index}
              onSelect={select}
              animationKey={metric}
              formatAxis={(v) => formatAxis(v, metric)}
              tooltip={(i) => {
                const m = months[i];
                return (
                  <>
                    <p className="text-[10.5px] font-semibold text-ink-500">{monthLong(m.key)}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold tabular-nums text-ink-900">
                      <Key kind="bar" />
                      {formatMetric(metricValue(m, metric), metric)}
                      <span className="text-[10.5px] font-medium text-ink-500">
                        {metric === "phones" ? "phones" : metric === "collected" ? "collected" : "sales"}
                      </span>
                    </p>
                    {metric === "sales" ? (
                      <p className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-ink-900">
                        <Key kind="line" />
                        {rupees(m.profit)}
                        <span className="text-[10.5px] font-medium text-ink-500">profit</span>
                      </p>
                    ) : null}
                  </>
                );
              }}
            />
          </motion.section>

          {/* Day by day for the selected month */}
          <motion.section
            className="due-card mb-3 px-3 pb-3 pt-3.5"
            variants={riseIn}
            initial="hidden"
            animate="show"
            custom={4}
          >
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <h2 className="text-[13px] font-bold text-ink-900">
                Day by day · <span className="text-ink-500">{monthShort(month.key)}</span>
              </h2>
              {bestDayIndex != null ? (
                <span className="rounded-full bg-[#E8F0FE] px-2 py-0.5 text-[11px] font-bold text-[#1D4ED8] dark:bg-[#3987e5]/20 dark:text-[#93C5FD]">
                  Best: {dayPoints[bestDayIndex].label} {monthShort(month.key)} ·{" "}
                  {formatMetric(dayPoints[bestDayIndex].value, metric)}
                </span>
              ) : null}
            </div>
            {dayPoints.some((p) => p.value !== 0) ? (
              <TrendChart
                points={dayPoints}
                height={140}
                barMax={10}
                highlight={bestDayIndex}
                pinned={pinnedDay}
                onSelect={(i) => setPinnedDay((open) => (open === i ? null : i))}
                onDismiss={() => setPinnedDay(null)}
                tipPlacement="corner"
                animationKey={`${month.key}|${metric}`}
                stagger={0.012}
                labelEvery={7}
                formatAxis={(v) => formatAxis(v, metric)}
                tooltip={(i) => <DayCard day={month.days[i]} />}
              />
            ) : (
              <p className="px-1 py-6 text-center text-sm text-ink-500">No sales in this month.</p>
            )}
          </motion.section>

          {/* Year at a glance */}
          <motion.section
            className="mb-3 grid grid-cols-3 gap-2"
            variants={riseIn}
            initial="hidden"
            animate="show"
            custom={5}
          >
            {[
              { label: "12 months", value: total },
              { label: "Avg / month", value: Math.round(total / activeMonths) },
              { label: best ? `Best · ${monthShort(best.key)}` : "Best month", value: best ? metricValue(best, metric) : 0 },
            ].map((tile) => (
              <div key={tile.label} className="due-card min-w-0 px-3 py-2.5">
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-400">
                  {tile.label}
                </p>
                <AnimatedNumber
                  value={tile.value}
                  format={(v) => (metric === "phones" ? String(Math.round(v)) : formatRupees(v))}
                  fit
                  className="mt-0.5 font-display text-[17px] font-bold tabular-nums text-ink-900"
                />
              </div>
            ))}
          </motion.section>

          {/* Month-by-month table: every number without hovering. */}
          <motion.section
            className="due-card mb-4 overflow-hidden"
            variants={riseIn}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.15 }}
            custom={0}
          >
            <div className="grid grid-cols-[0.75fr_1.25fr_1.15fr_0.55fr] gap-2 border-b border-[#E7EAF0] px-3.5 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-400 dark:border-[rgb(var(--color-line))]">
              <span>Month</span>
              <span className="text-right">Sales</span>
              <span className="text-right">Profit</span>
              <span className="text-right">Phones</span>
            </div>
            {[...months].reverse().map((m) => {
              const i = months.indexOf(m);
              const on = i === index;
              return (
                <button
                  key={m.key}
                  type="button"
                  className="relative grid w-full grid-cols-[0.75fr_1.25fr_1.15fr_0.55fr] gap-2 px-3.5 py-2.5 text-left text-[12.5px] tabular-nums"
                  onClick={() => {
                    select(i);
                    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  {on ? (
                    <motion.span
                      layoutId="trend-row"
                      className="absolute inset-0 bg-[#E8F0FE] dark:bg-[#3987e5]/15"
                      transition={SPRING}
                    />
                  ) : null}
                  <span className={clsx("relative font-semibold", on ? "text-ink-900" : "text-ink-700")}>
                    {monthShort(m.key)} {m.key.slice(2, 4)}
                  </span>
                  <span className="relative whitespace-nowrap text-right font-semibold text-ink-900">
                    {formatRupees(m.sales)}
                  </span>
                  <span
                    className={clsx(
                      "relative whitespace-nowrap text-right font-semibold",
                      m.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                    )}
                  >
                    {formatRupees(m.profit)}
                  </span>
                  <span className="relative text-right text-ink-700">{m.phones}</span>
                </button>
              );
            })}
          </motion.section>
        </>
      ) : null}
    </div>
  );
}
