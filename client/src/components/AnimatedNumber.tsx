import { useLayoutEffect, useRef } from "react";
import clsx from "clsx";
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
  fit = false,
}: {
  value: number;
  format: (value: number) => string;
  duration?: number;
  className?: string;
  /** Shrink the text (down to 60%) so the full amount fits its box. */
  fit?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  formatRef.current = format;
  const valueRef = useRef(value);
  valueRef.current = value;

  /** Size the box for the final text, so counting up never overflows. */
  function fitTo(el: HTMLElement, text: string) {
    if (!fit) return;
    const shownText = el.textContent;
    el.style.fontSize = "";
    el.textContent = text;
    let size = parseFloat(getComputedStyle(el).fontSize);
    const min = size * 0.6;
    while (el.scrollWidth > el.clientWidth && size > min) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
    el.textContent = shownText;
  }

  // Re-fit when the box changes width (rotation, resize).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!fit || !el) return;
    const observer = new ResizeObserver(() => fitTo(el, formatRef.current(valueRef.current)));
    observer.observe(el);
    return () => observer.disconnect();
    // fitTo only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitTo(el, formatRef.current(value));
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
    // fitTo only reads refs / props captured for this value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, reduce]);

  return (
    <span
      ref={ref}
      className={clsx(fit && "block min-w-0 overflow-hidden whitespace-nowrap", className)}
    />
  );
}
