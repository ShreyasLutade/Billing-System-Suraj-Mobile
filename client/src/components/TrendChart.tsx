import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { EASE_OUT, SPRING } from "../lib/motion";
import { niceTicks } from "../lib/trend";

export type TrendPoint = {
  key: string;
  /** X-axis label ("Nov", "15"). */
  label: string;
  /** Bar value. */
  value: number;
  /** Optional line value on the same axis (e.g. profit next to sales). */
  line?: number;
  /** Accessible name for the column. */
  title: string;
};

const AXIS = 40;
const X_LABELS = 22;

/** Smooth line through the points without overshooting (monotone cubic). */
function monotonePath(points: Array<{ x: number; y: number }>) {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0].x},${points[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = points[i + 1].x - points[i].x;
    m[i] = (points[i + 1].y - points[i].y) / dx[i];
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p = points[i];
    const q = points[i + 1];
    d += ` C${p.x + dx[i] / 3},${p.y + (t[i] * dx[i]) / 3} ${q.x - dx[i] / 3},${q.y - (t[i + 1] * dx[i]) / 3} ${q.x},${q.y}`;
  }
  return d;
}

/**
 * Column chart (one series) with an optional line on the same axis. Bars grow
 * from the baseline in a stagger, the line draws itself, the selected column
 * stays bright while the rest step back. Tap selects; mouse / keyboard focus
 * shows a readout.
 */
export function TrendChart({
  points,
  height = 180,
  barMax = 24,
  selected,
  highlight,
  onSelect,
  pinned,
  onDismiss,
  tipPlacement = "column",
  formatAxis,
  tooltip,
  labelEvery = 1,
  animationKey,
  stagger = 0.045,
}: {
  points: TrendPoint[];
  height?: number;
  barMax?: number;
  selected?: number | null;
  /** A column to mark (e.g. best day) when nothing is selected. */
  highlight?: number | null;
  onSelect?: (index: number) => void;
  /** Column whose readout stays open (tap to show), until `onDismiss`. */
  pinned?: number | null;
  /** Called on a tap outside the chart while a readout is pinned. */
  onDismiss?: () => void;
  /** "column": next to the column; "corner": top corner on the other side
   *  (for short charts with a big readout, so the bar stays visible). */
  tipPlacement?: "column" | "corner";
  formatAxis: (value: number) => string;
  tooltip: (index: number) => ReactNode;
  labelEvery?: number;
  /** Change it to replay the grow-in (metric / month switch). */
  animationKey: string;
  stagger?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = points.length;
  const plotW = Math.max(width - AXIS, 0);
  const values = points.flatMap((p) => (p.line == null ? [p.value] : [p.value, p.line]));
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 3);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const y = (v: number) => ((hi - v) / (hi - lo || 1)) * height;
  const slot = n ? plotW / n : 0;
  const barW = Math.max(Math.min(slot * 0.58, barMax), 3);
  const zeroY = y(0);
  const hasLine = points.some((p) => p.line != null);
  const linePoints = hasLine
    ? points.map((p, i) => ({ x: i * slot + slot / 2, y: y(p.line ?? 0) }))
    : [];
  /** Highest point of a column (bar top or line dot), for the readout. */
  const tipAnchor = (i: number) =>
    Math.min(y(points[i].value), points[i].line != null ? y(points[i].line ?? 0) : height);
  const focus = pinned ?? selected ?? highlight ?? null;
  const shownTip = hover ?? pinned ?? null;

  // Tap anywhere else closes a pinned readout.
  useEffect(() => {
    if (pinned == null || !onDismiss) return;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pinned, onDismiss]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none"
      style={{ height: height + X_LABELS }}
    >
      {/* Gridlines + axis labels (recessive). */}
      {ticks.map((tick) => (
        <div
          key={tick}
          className="pointer-events-none absolute right-0 flex items-center"
          style={{ top: y(tick), left: 0 }}
        >
          <span className="w-[36px] -translate-y-1/2 pr-1 text-right text-[10px] font-medium tabular-nums text-ink-400">
            {formatAxis(tick)}
          </span>
          <span
            className="h-px flex-1"
            style={{ background: tick === 0 ? "var(--trend-axis)" : "var(--trend-grid)" }}
          />
        </div>
      ))}

      <div className="absolute top-0" style={{ left: AXIS, width: plotW, height }}>
        {width > 0 ? (
          <div key={animationKey} className="absolute inset-0">
            {points.map((p, i) => {
              const top = p.value >= 0 ? y(p.value) : zeroY;
              const barH = Math.max(Math.abs(y(p.value) - zeroY), p.value === 0 ? 0 : 2);
              const dim = focus != null && focus !== i;
              const radius = barW >= 8 ? 4 : 2;
              return (
                <motion.div
                  key={p.key}
                  className="absolute"
                  style={{
                    left: i * slot + (slot - barW) / 2,
                    top,
                    width: barW,
                    height: barH,
                    background: "var(--trend-sales)",
                    borderRadius:
                      p.value >= 0 ? `${radius}px ${radius}px 0 0` : `0 0 ${radius}px ${radius}px`,
                    originY: p.value >= 0 ? 1 : 0,
                  }}
                  initial={{ scaleY: 0, opacity: 0.6 }}
                  animate={{ scaleY: 1, opacity: dim ? 0.32 : 1 }}
                  transition={{
                    scaleY: { ...SPRING, delay: i * stagger },
                    opacity: { duration: 0.35, ease: EASE_OUT },
                  }}
                />
              );
            })}

            {hasLine ? (
              <svg
                className="pointer-events-none absolute inset-0 overflow-visible"
                width={plotW}
                height={height}
                aria-hidden
              >
                <motion.path
                  d={monotonePath(linePoints)}
                  fill="none"
                  stroke="var(--trend-profit)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.25 }}
                />
                {linePoints.map((pt, i) => (
                  <motion.circle
                    key={points[i].key}
                    cx={pt.x}
                    cy={pt.y}
                    r={focus === i ? 5.5 : 4}
                    fill="var(--trend-profit)"
                    stroke="var(--trend-surface)"
                    strokeWidth={2}
                    style={{ transformBox: "fill-box", originX: 0.5, originY: 0.5 }}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1, opacity: focus != null && focus !== i ? 0.45 : 1 }}
                    transition={{ ...SPRING, delay: 0.55 + i * 0.035 }}
                  />
                ))}
              </svg>
            ) : null}
          </div>
        ) : null}

        {/* Hit areas: the whole column (and its label), bigger than the bar. */}
        {points.map((p, i) => (
          <button
            key={p.key}
            type="button"
            aria-label={p.title}
            aria-pressed={selected === i}
            className="absolute top-0 z-10 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-tide-400/70"
            style={{ left: i * slot, width: slot, height: height + X_LABELS }}
            onClick={() => onSelect?.(i)}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setHover(i);
            }}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}

        <AnimatePresence>
          {shownTip != null && points[shownTip] ? (
            <motion.div
              key="tip"
              className="pointer-events-none absolute z-20 whitespace-nowrap rounded-xl border border-[#E7EAF0] bg-white px-3 py-2 text-left shadow-lift dark:border-[rgb(var(--color-line))] dark:bg-surface-elevated"
              style={
                tipPlacement === "corner"
                  ? shownTip * slot + slot / 2 < plotW / 2
                    ? { right: 0, top: -4 }
                    : { left: 0, top: -4 }
                  : {
                // Left half: grow to the right of the column; right half: to the left.
                ...(shownTip * slot + slot / 2 < plotW / 2
                  ? { left: Math.max(shownTip * slot + slot / 2 - 20, -AXIS + 4) }
                  : { right: Math.max(plotW - (shownTip * slot + slot / 2) - 20, 0) }),
                // Above the bar when there is room, otherwise just below its top.
                ...(tipAnchor(shownTip) >= 90
                  ? { bottom: height - tipAnchor(shownTip) + 8 }
                  : { top: tipAnchor(shownTip) + 10 }),
                    }
              }
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
            >
              {tooltip(shownTip)}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* X labels */}
      <div className="pointer-events-none absolute" style={{ left: AXIS, width: plotW, top: height + 6 }}>
        {points.map((p, i) =>
          // Every n-th label, plus the focused one (a neighbour of it hides
          // so the two don't run together).
          i === focus || (i % labelEvery === 0 && (focus == null || labelEvery === 1 || Math.abs(i - focus) > 1)) ? (
            <span
              key={p.key}
              className={clsx(
                "absolute -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums transition-colors",
                i === focus ? "font-bold text-ink-900" : "font-medium text-ink-400",
              )}
              style={{ left: i * slot + slot / 2 }}
            >
              {p.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
