import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Cable, Plus, Smartphone } from "lucide-react";
import clsx from "clsx";

type Option = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
};

/** Lets the scroll-to-top button move up so the two never overlap. */
const BODY_CLASS = "has-fab";

/**
 * Phones only: a floating + in the bottom-right corner. Tapping it shows
 * "Add mobile" and "Add accessories"; picking one opens that screen.
 * Rendered into <body> so no page transform or scroll area can move it.
 */
export function AddStockFab({
  onAddMobile,
  onAddAccessories,
}: {
  onAddMobile: () => void;
  onAddAccessories: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.classList.add(BODY_CLASS);
    return () => document.body.classList.remove(BODY_CLASS);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Listed bottom-up: the first option sits closest to the + button.
  const options: Option[] = [
    { label: "Add mobile", icon: Smartphone, onSelect: onAddMobile },
    { label: "Add accessories", icon: Cable, onSelect: onAddAccessories },
  ];

  function choose(option: Option) {
    setOpen(false);
    option.onSelect();
  }

  return createPortal(
    <div className="md:hidden">
      <AnimatePresence>
        {open ? (
          <motion.div
            key="fab-backdrop"
            className="fixed inset-0 z-40 bg-ink-950/30 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
        ) : null}
      </AnimatePresence>

      <div className="fixed bottom-24 right-4 z-50 flex flex-col-reverse items-end gap-3 pb-[env(safe-area-inset-bottom)]">
        <button
          type="button"
          className="fab-glass grid h-14 w-14 place-items-center rounded-full transition active:scale-95"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={open ? "Close add menu" : "Add stock"}
        >
          <motion.span
            className="grid place-items-center"
            animate={{ rotate: open ? 45 : 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <Plus className="h-6 w-6" strokeWidth={2.5} />
          </motion.span>
        </button>

        <AnimatePresence>
          {open
            ? options.map((option, index) => (
                <motion.button
                  key={option.label}
                  type="button"
                  role="menuitem"
                  className={clsx(
                    "mr-1 flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-sm font-semibold text-ink-900 shadow-lift",
                    // Frosted glass, like the rest of the app's buttons.
                    "bg-white/75 backdrop-blur-xl backdrop-saturate-150",
                    "dark:bg-white/10",
                  )}
                  initial={{ opacity: 0, y: 12, scale: 0.92 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    transition: { duration: 0.2, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] },
                  }}
                  exit={{ opacity: 0, y: 8, scale: 0.95, transition: { duration: 0.12 } }}
                  onClick={() => choose(option)}
                >
                  {option.label}
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-50 text-ink-700 dark:bg-white/10 dark:text-ink-100">
                    <option.icon className="h-[18px] w-[18px]" />
                  </span>
                </motion.button>
              ))
            : null}
        </AnimatePresence>
      </div>
    </div>,
    document.body,
  );
}
