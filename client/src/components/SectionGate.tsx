import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Headphones, ReceiptText, Wrench, X } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../auth/AuthContext";
import { BrandName } from "./BrandName";

/**
 * Which counter to open: the mobile shop (billing, stock) or the repair desk.
 * Shown once after signing in (the login page sets a session flag), and again
 * whenever someone taps "Switch shop" in the account menu.
 */
const PICK_SECTION_KEY = "babu.pickSection";
const OPEN_CHOOSER_EVENT = "babu:open-section-chooser";

export function requestSectionChoice() {
  try {
    sessionStorage.setItem(PICK_SECTION_KEY, "1");
  } catch {
    /* private mode — skip the chooser */
  }
}

export function cancelSectionChoice() {
  try {
    sessionStorage.removeItem(PICK_SECTION_KEY);
  } catch {
    /* ignore */
  }
}

/** "Switch shop" in the account menu. */
export function openSectionChooser() {
  window.dispatchEvent(new Event(OPEN_CHOOSER_EVENT));
}

function sectionChoicePending() {
  try {
    return sessionStorage.getItem(PICK_SECTION_KEY) === "1";
  } catch {
    return false;
  }
}

const isRepairPath = (path: string) => /^\/repair(\/|$)/.test(path);
const isAccPath = (path: string) => /^\/acc(\/|$)/.test(path);

type Section = "shop" | "repair" | "acc";

const OPTIONS = [
  { key: "shop", label: "Mobile shop", hint: "New bills, stock, dues and suppliers", icon: ReceiptText },
  { key: "repair", label: "Repair shop", hint: "Take in phones for repair, with photos", icon: Wrench },
  { key: "acc", label: "Accessories shop", hint: "Quick counter billing, wholesale and dues", icon: Headphones },
] as const;

const SECTION_HOME: Record<Section, string> = { shop: "/", repair: "/repair", acc: "/acc" };

export function SectionGate() {
  const { repairOnly, canUseAccessories } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  /** "login": first choice after signing in; "switch": opened from the menu. */
  const [mode, setMode] = useState<"login" | "switch" | null>(() =>
    sectionChoicePending() ? "login" : null,
  );
  const [exitingTarget, setExitingTarget] = useState<Section | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<Section | null>(null);
  const [transitionExiting, setTransitionExiting] = useState(false);
  const current: Section = isRepairPath(location.pathname) ? "repair" : isAccPath(location.pathname) ? "acc" : "shop";
  // The accessories shop is only offered to the logins it's open for.
  const options = OPTIONS.filter((option) => option.key !== "acc" || canUseAccessories);
  const transitionOption = transitionTarget
    ? OPTIONS.find((option) => option.key === transitionTarget)
    : null;
  const TransitionIcon = transitionOption?.icon;

  // Repair-only accounts have one counter: no chooser.
  useEffect(() => {
    if (repairOnly) {
      cancelSectionChoice();
      setMode(null);
      setTransitionTarget(null);
      setTransitionExiting(false);
    }
  }, [repairOnly]);

  useEffect(() => {
    if (!transitionTarget) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = reducedMotion ? 0 : transitionExiting ? 280 : 720;
    const timer = window.setTimeout(() => {
      if (transitionExiting) {
        setTransitionTarget(null);
        setTransitionExiting(false);
        return;
      }
      navigate(SECTION_HOME[transitionTarget], { replace: true });
      setTransitionExiting(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [navigate, transitionExiting, transitionTarget]);

  useEffect(() => {
    if (!exitingTarget) return;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320;
    const timer = window.setTimeout(() => {
      setMode(null);
      setTransitionTarget(exitingTarget);
      setExitingTarget(null);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [exitingTarget]);

  useEffect(() => {
    const open = () => setMode("switch");
    window.addEventListener(OPEN_CHOOSER_EVENT, open);
    return () => window.removeEventListener(OPEN_CHOOSER_EVENT, open);
  }, []);

  // A switch can be cancelled with Esc; the first choice after login can't.
  useEffect(() => {
    if (mode !== "switch") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !exitingTarget) {
        setExitingTarget(null);
        setMode(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitingTarget, mode]);

  // Repair-only accounts never see the mobile shop: send them to the repair desk.
  if (repairOnly && !isRepairPath(location.pathname)) {
    return <Navigate to="/repair" replace />;
  }

  const switching = mode === "switch";

  function choose(section: Section) {
    cancelSectionChoice();
    if (switching && section !== current) {
      setExitingTarget(section);
      return;
    }
    setExitingTarget(null);
    setMode(null);
    if (switching) return;
    navigate(SECTION_HOME[section], { replace: !switching });
  }

  return (
    <>
      <Outlet />
      {transitionOption && TransitionIcon ? (
        <div
          className={clsx("section-transition", transitionExiting && "is-exiting")}
          role="status"
          aria-live="polite"
        >
          <div className="section-transition-glow" aria-hidden />
          <div className="section-transition-content">
            <img src="/babu_mobile_icon.svg?v=3" alt="" className="section-transition-logo" />
            <p className="section-transition-brand">
              <BrandName />
            </p>
            <div className="section-transition-icon">
              <TransitionIcon />
            </div>
            <h2>Opening {transitionOption.label}</h2>
            <p className="section-transition-caption">Getting your counter ready</p>
            <div className="section-transition-progress" aria-hidden>
              <span />
            </div>
          </div>
        </div>
      ) : null}
      {mode && !repairOnly ? (
        <div
          className={clsx("section-gate", exitingTarget && "is-exiting")}
          role="dialog"
          aria-modal="true"
          aria-labelledby="section-gate-title"
          onClick={switching ? () => {
            setExitingTarget(null);
            setMode(null);
          } : undefined}
        >
          <div className="section-gate-card" onClick={(event) => event.stopPropagation()}>
            {switching ? (
              <button
                type="button"
                className="section-gate-close"
                aria-label="Close"
                onClick={() => {
                  setExitingTarget(null);
                  setMode(null);
                }}
              >
                <X />
              </button>
            ) : null}
            <div className="section-gate-head">
              <img src="/babu_mobile_icon.svg?v=3" alt="" className="section-gate-logo" />
              <p className="section-gate-brand">
                <BrandName />
              </p>
              <h2 id="section-gate-title">{switching ? "Switch shop" : "Which counter are you opening?"}</h2>
              <p className="section-gate-sub">
                {switching ? "Pick the counter to open." : "You can switch any time from the menu."}
              </p>
            </div>

            <div className="section-gate-options">
              {options.map((option) => {
                const here = switching && option.key === current;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={clsx(
                      "section-gate-option",
                      option.key === "repair" && "is-repair",
                      option.key === "acc" && "is-acc",
                      here && "is-current",
                    )}
                    onClick={() => choose(option.key)}
                    autoFocus={switching ? option.key !== current : option.key === "shop"}
                  >
                    <span className="section-gate-icon">
                      <option.icon />
                    </span>
                    <span className="section-gate-text">
                      <strong>{option.label}</strong>
                      <small className={here ? "is-here" : undefined}>
                        {here ? "You're here" : option.hint}
                      </small>
                    </span>
                    {here ? (
                      <Check className="section-gate-arrow" aria-hidden />
                    ) : (
                      <ArrowRight className="section-gate-arrow" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
