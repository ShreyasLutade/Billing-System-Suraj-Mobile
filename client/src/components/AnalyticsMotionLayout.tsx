import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { AnalyticsBackdrop } from "./AnalyticsBackdrop";
import { useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion, type Variants } from "framer-motion";

/**
 * Analytics pages move like rooms: opening a card zooms you *in* (the page
 * you leave grows and fades, the new one settles from slightly smaller);
 * going back zooms *out*. Phones asking for less motion get fades only.
 */
const portal: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    scale: direction < 0 ? 1.04 : 0.96,
    y: direction < 0 ? -12 : 18,
  }),
  center: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring", stiffness: 240, damping: 30, mass: 0.9 },
  },
  exit: (direction: number) => ({
    opacity: 0,
    scale: direction < 0 ? 0.96 : 1.04,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
  }),
};

function depthOf(pathname: string) {
  return pathname.split("/").filter(Boolean).length;
}

export function AnalyticsMotionLayout() {
  const location = useLocation();
  const outlet = useOutlet();
  const depth = depthOf(location.pathname);
  // The page shown before this one (updated after each change, so a
  // second render in dev mode works out the same direction).
  const shown = useRef({ pathname: location.pathname, depth, direction: 0 });
  const direction =
    location.pathname === shown.current.pathname
      ? shown.current.direction
      : Math.sign(depth - shown.current.depth);
  const directionRef = useRef(direction);
  directionRef.current = direction;
  useEffect(() => {
    shown.current = { pathname: location.pathname, depth, direction };
  }, [location.pathname, depth, direction]);

  /** Spotlight on the card under the finger / mouse (see .fx-lit in CSS). */
  function spotlight(event: ReactPointerEvent<HTMLDivElement>) {
    const card = (event.target as Element).closest<HTMLElement>(".interactive-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    if (event.type === "pointerdown") {
      card.classList.add("fx-lit");
      window.setTimeout(() => card.classList.remove("fx-lit"), 650);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <AnalyticsBackdrop />
      <div onPointerMove={spotlight} onPointerDown={spotlight}>
      <AnimatePresence
        mode="wait"
        custom={direction}
        onExitComplete={() => {
          // Going deeper starts at the top; coming back, the page restores
          // its own spot (see AnalyticsPage).
          if (directionRef.current > 0) {
            document.querySelector("main")?.scrollTo({ top: 0 });
          }
        }}
      >
        <motion.div
          key={location.pathname}
          className="analytics-motion"
          custom={direction}
          variants={portal}
          initial="enter"
          animate="center"
          exit="exit"
        >
          {outlet}
        </motion.div>
      </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
