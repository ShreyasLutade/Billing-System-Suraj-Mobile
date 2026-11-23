import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";

/** Fixed spread of particles (not random), so every burst looks the same. */
const PARTICLES = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2 + (i % 2 ? 0.18 : 0);
  const distance = 78 + (i % 3) * 22;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    size: 5 + (i % 4) * 2,
    delay: (i % 5) * 0.015,
    round: i % 3 !== 0,
  };
});

/**
 * Saved! A check draws itself in a glowing circle, a ring ripples out and a
 * burst of sparks flies away; then it fades by itself (`onDone`).
 * Phones asking for less motion get a simple fade.
 */
export function SuccessBurst({
  label,
  sublabel,
  color = "#10B981",
  onDone,
}: {
  label: string;
  sublabel?: string;
  color?: string;
  onDone: () => void;
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const timer = window.setTimeout(onDone, reduce ? 900 : 1500);
    return () => window.clearTimeout(timer);
  }, [onDone, reduce]);

  return createPortal(
    <motion.div
      className="pointer-events-none fixed inset-0 z-[70] grid place-items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      role="status"
      aria-live="polite"
    >
      <motion.div
        className="absolute inset-0 bg-ink-950/35 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />
      <div className="relative grid place-items-center">
        {!reduce
          ? PARTICLES.map((p, i) => (
              <motion.span
                key={i}
                className="absolute"
                style={{
                  width: p.size,
                  height: p.size,
                  borderRadius: p.round ? "50%" : 2,
                  background: i % 4 === 0 ? "#FFD166" : color,
                  boxShadow: `0 0 10px ${color}`,
                }}
                initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
                animate={{ x: p.x, y: p.y, scale: [0, 1.2, 0.6], opacity: [1, 1, 0], rotate: 120 }}
                transition={{ duration: 0.9, delay: 0.18 + p.delay, ease: [0.22, 1, 0.36, 1] }}
              />
            ))
          : null}
        {!reduce ? (
          <motion.span
            className="absolute h-24 w-24 rounded-full border-2"
            style={{ borderColor: color }}
            initial={{ scale: 0.6, opacity: 0.9 }}
            animate={{ scale: 2.4, opacity: 0 }}
            transition={{ duration: 0.9, delay: 0.12, ease: "easeOut" }}
          />
        ) : null}
        <motion.div
          className="relative grid h-24 w-24 place-items-center rounded-full text-white"
          style={{ background: color, boxShadow: `0 0 0 8px ${color}33, 0 18px 40px -10px ${color}` }}
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18 }}
        >
          <svg viewBox="0 0 52 52" className="h-12 w-12" fill="none" aria-hidden>
            <motion.path
              d="M14 27 L23 36 L39 18"
              stroke="currentColor"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
            />
          </svg>
        </motion.div>
        <motion.div
          className="absolute top-full mt-5 w-64 text-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <p className="font-display text-lg font-bold text-white drop-shadow">{label}</p>
          {sublabel ? <p className="text-sm font-semibold text-white/80">{sublabel}</p> : null}
        </motion.div>
      </div>
    </motion.div>,
    document.body,
  );
}
