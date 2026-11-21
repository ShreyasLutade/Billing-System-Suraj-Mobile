import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";

/**
 * Living background for the Analytics pages: soft aurora lights that drift on
 * their own and glide at different depths as you scroll, plus a few tiny
 * glowing motes rising slowly. Gradients only (no blur filter), moved with
 * transforms, so it stays smooth on phones. Hidden when the phone asks for
 * less motion.
 *
 * Babu's <main> paints its own background, so the layer lives inside it
 * (portal), pinned over main's box (not the sidebar), behind the page
 * content (main gets `fx-host` = its own stacking context).
 */

/** Fixed positions (not random) so it looks the same on every visit. */
const MOTES = [
  { left: 6, size: 3, duration: 26, delay: -4, depth: 0 },
  { left: 14, size: 2, duration: 31, delay: -19, depth: 1 },
  { left: 23, size: 4, duration: 28, delay: -11, depth: 0 },
  { left: 31, size: 2, duration: 35, delay: -27, depth: 1 },
  { left: 42, size: 3, duration: 24, delay: -7, depth: 1 },
  { left: 51, size: 2, duration: 33, delay: -22, depth: 0 },
  { left: 60, size: 3, duration: 29, delay: -15, depth: 1 },
  { left: 68, size: 4, duration: 37, delay: -3, depth: 0 },
  { left: 77, size: 2, duration: 27, delay: -24, depth: 1 },
  { left: 85, size: 3, duration: 32, delay: -9, depth: 0 },
  { left: 92, size: 2, duration: 30, delay: -17, depth: 1 },
  { left: 97, size: 3, duration: 34, delay: -30, depth: 0 },
] as const;

export function AnalyticsBackdrop() {
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const main = document.querySelector("main");
    scroller.current = main;
    setHost(main);
    if (!main) return;
    main.classList.add("fx-host");
    const measure = () => {
      const r = main.getBoundingClientRect();
      setBox({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      main.classList.remove("fx-host");
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const { scrollY } = useScroll({ container: scroller });
  // Springs smooth out the scroll so the lights glide instead of stepping.
  const smooth = useSpring(scrollY, { stiffness: 70, damping: 22, mass: 0.6 });
  // Gentle waves (not a straight drift), so however far you scroll the
  // lights stay on screen; each layer moves at its own pace = depth.
  const far = useTransform(smooth, (y) => Math.sin(y / 1200) * 90);
  const farX = useTransform(smooth, (y) => Math.cos(y / 1500) * 60);
  const mid = useTransform(smooth, (y) => Math.cos(y / 900) * -140);
  const midX = useTransform(smooth, (y) => Math.sin(y / 1100) * -80);
  const near = useTransform(smooth, (y) => Math.sin(y / 700 + 1) * -180);
  const turn = useTransform(smooth, (y) => y * 0.02);
  const motesNear = useTransform(smooth, (y) => Math.sin(y / 420) * -70);
  const motesFar = useTransform(smooth, (y) => Math.sin(y / 650) * -30);

  if (reduce || !host || !box) return null;

  return createPortal(
    <div
      className="fx-backdrop"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      aria-hidden
    >
      <motion.div className="fx-light fx-light-amber" style={{ y: far, x: farX, rotate: turn }} />
      <motion.div className="fx-light fx-light-blue" style={{ y: mid, x: midX }} />
      <motion.div className="fx-light fx-light-teal" style={{ y: near }} />
      <motion.div className="fx-motes" style={{ y: motesFar }}>
        {MOTES.filter((m) => m.depth === 0).map((m) => (
          <span
            key={m.left}
            className="fx-mote"
            style={{
              left: `${m.left}%`,
              width: m.size,
              height: m.size,
              animationDuration: `${m.duration}s`,
              animationDelay: `${m.delay}s`,
            }}
          />
        ))}
      </motion.div>
      <motion.div className="fx-motes" style={{ y: motesNear }}>
        {MOTES.filter((m) => m.depth === 1).map((m) => (
          <span
            key={m.left}
            className="fx-mote fx-mote-near"
            style={{
              left: `${m.left}%`,
              width: m.size + 1,
              height: m.size + 1,
              animationDuration: `${m.duration}s`,
              animationDelay: `${m.delay}s`,
            }}
          />
        ))}
      </motion.div>
    </div>,
    host,
  );
}

/** A few tiny twinkling stars for a hero card (place inside a relative box). */
export function HeroSparkles() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <span className="fx-aurora" />
      <span className="fx-star" style={{ top: "18%", right: "16%", animationDelay: "0.2s" }} />
      <span className="fx-star" style={{ top: "62%", right: "8%", animationDelay: "1.6s" }} />
      <span className="fx-star fx-star-small" style={{ top: "34%", right: "34%", animationDelay: "2.9s" }} />
      <span className="fx-star fx-star-small" style={{ bottom: "14%", left: "46%", animationDelay: "4.1s" }} />
    </div>
  );
}
