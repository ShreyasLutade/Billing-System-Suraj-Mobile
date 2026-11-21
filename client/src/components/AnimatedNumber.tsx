import { useLayoutEffect, useRef } from "react";
import { animate, useReducedMotion } from "framer-motion";
import { EASE_OUT } from "../lib/motion";

/**
 * Counts up to `value` (from 0 the first time, then from what is shown).
 * The text is written straight to the DOM, so the count doesn't re-render
 * the page every frame; the final text is exact.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 1.1,
  className,
}: {
  value: number;
  format: (value: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  formatRef.current = format;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || shown.current === value) {
      shown.current = value;
      el.textContent = formatRef.current(value);
      return;
    }
    el.textContent = formatRef.current(shown.current);
    const controls = animate(shown.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (latest) => {
        shown.current = latest;
        el.textContent = formatRef.current(Math.round(latest));
      },
      onComplete: () => {
        shown.current = value;
        el.textContent = formatRef.current(value);
      },
    });
    return () => controls.stop();
  }, [value, duration, reduce]);

  return <span ref={ref} className={className} />;
}
