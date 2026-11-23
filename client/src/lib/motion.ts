import type { Transition, Variants } from "framer-motion";

/** Shared motion language for Analytics: springs, not durations. */
export const SPRING: Transition = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 };
export const SPRING_SOFT: Transition = { type: "spring", stiffness: 170, damping: 24 };
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Section reveal: rise + fade, staggered by `custom` index. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 22, scale: 0.985 },
  show: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...SPRING, delay: Math.min(index, 6) * 0.06 },
  }),
};
