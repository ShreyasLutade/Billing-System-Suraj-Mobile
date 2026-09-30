import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { ArrowRight, ReceiptText, Wrench } from "lucide-react";
import { BrandName } from "./BrandName";

/**
 * After signing in, ask which counter to open: the mobile shop (billing, stock)
 * or the separate repair desk. The login page sets a session flag; this
 * wrapper shows the chooser once and clears it.
 */
const PICK_SECTION_KEY = "babu.pickSection";

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

function sectionChoicePending() {
  try {
    return sessionStorage.getItem(PICK_SECTION_KEY) === "1";
  } catch {
    return false;
  }
}

export function SectionGate() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(sectionChoicePending);

  function choose(section: "shop" | "repair") {
    cancelSectionChoice();
    setOpen(false);
    navigate(section === "repair" ? "/repair" : "/", { replace: true });
  }

  return (
    <>
      <Outlet />
      {open ? (
        <div className="section-gate" role="dialog" aria-modal="true" aria-labelledby="section-gate-title">
          <div className="section-gate-card">
            <div className="section-gate-head">
              <img src="/babu_mobile_icon.svg?v=3" alt="" className="section-gate-logo" />
              <p className="section-gate-brand">
                <BrandName />
              </p>
              <h2 id="section-gate-title">Which counter are you opening?</h2>
              <p className="section-gate-sub">You can switch any time from the menu.</p>
            </div>

            <div className="section-gate-options">
              <button type="button" className="section-gate-option" onClick={() => choose("shop")} autoFocus>
                <span className="section-gate-icon">
                  <ReceiptText />
                </span>
                <span className="section-gate-text">
                  <strong>Mobile shop</strong>
                  <small>New bills, stock, dues and suppliers</small>
                </span>
                <ArrowRight className="section-gate-arrow" aria-hidden />
              </button>

              <button type="button" className="section-gate-option is-repair" onClick={() => choose("repair")}>
                <span className="section-gate-icon">
                  <Wrench />
                </span>
                <span className="section-gate-text">
                  <strong>Repair shop</strong>
                  <small>Take in phones for repair, with photos</small>
                </span>
                <ArrowRight className="section-gate-arrow" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
