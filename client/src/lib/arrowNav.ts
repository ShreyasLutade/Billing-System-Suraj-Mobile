/**
 * Laptop keyboard navigation for every page.
 *
 * ← → ↑ ↓  move focus to the nearest button / link / card / field in that
 *          direction (inside the open popup when there is one).
 * Enter    clicks what is focused (cards and rows too, not only buttons).
 *
 * Typing is never disturbed: in a text box ← → move the cursor and only
 * leave the box at its start / end; text areas, dropdowns and date boxes
 * keep their own arrow keys. Components that handle arrows themselves
 * (e.g. suggestion lists) win because they call preventDefault first.
 */

type Dir = "left" | "right" | "up" | "down";

const KEY_DIR: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

const NATIVE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';

/** Cards/rows that only have an onClick (cursor: pointer) also count. */
const CLICKABLE_GUESS = "div, li, tr, span, label, article, section";

const TEXT_TYPES = new Set(["text", "search", "tel", "email", "url", "password", "number", ""]);

function isVisible(el: Element) {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const anyEl = el as Element & { checkVisibility?: (o?: object) => boolean };
  if (anyEl.checkVisibility) return anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function isDisabled(el: Element) {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true" || Boolean(el.closest("[inert]"));
}

/** The open popup (top-most dialog), or the whole page. */
function scope(): ParentNode {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]')).filter(isVisible);
  return dialogs[dialogs.length - 1] ?? document;
}

function candidates(root: ParentNode): HTMLElement[] {
  const set = new Set<HTMLElement>();
  root.querySelectorAll<HTMLElement>(NATIVE).forEach((el) => set.add(el));
  root.querySelectorAll<HTMLElement>(CLICKABLE_GUESS).forEach((el) => {
    if (set.has(el) || el.closest(NATIVE)) return;
    if (getComputedStyle(el).cursor !== "pointer") return;
    // Skip wrappers whose pointer cursor only comes from a clickable child.
    if (el.querySelector(NATIVE) && !el.onclick && !hasReactClick(el)) return;
    set.add(el);
  });
  return Array.from(set).filter((el) => !isDisabled(el) && isVisible(el) && !el.closest('[aria-hidden="true"]'));
}

/** React keeps handlers on a private props key; use it to spot onClick cards. */
function reactProp(el: Element, name: "onClick" | "onKeyDown") {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  const props = key ? (el as unknown as Record<string, Record<string, unknown>>)[key] : null;
  return Boolean(props && typeof props[name] === "function");
}

function hasReactClick(el: Element) {
  return reactProp(el, "onClick");
}

function best(from: DOMRect, dir: Dir, list: HTMLElement[], current: Element | null) {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let winner: HTMLElement | null = null;
  let score = Infinity;
  for (const el of list) {
    // Parents of the current item are skipped; items inside it (e.g. buttons in a card) are fine.
    if (el === current || (current && el.contains(current))) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    let main: number;
    let cross: number;
    let overlap: boolean;
    if (dir === "right" || dir === "left") {
      main = dir === "right" ? r.left - from.right : from.left - r.right;
      if ((dir === "right" ? ex <= cx + 1 : ex >= cx - 1) || main < -from.width / 2) continue;
      overlap = r.top < from.bottom - 2 && r.bottom > from.top + 2;
      cross = overlap ? 0 : Math.abs(ey - cy);
      // ← → stay on the same line.
      if (!overlap && cross > Math.max(from.height, r.height) * 0.9) continue;
    } else {
      main = dir === "down" ? r.top - from.bottom : from.top - r.bottom;
      if ((dir === "down" ? ey <= cy + 1 : ey >= cy - 1) || main < -from.height / 2) continue;
      overlap = r.left < from.right - 2 && r.right > from.left + 2;
      cross = overlap ? 0 : Math.abs(ex - cx);
    }
    // Tie-break: the item most in line with the current one.
    const align = dir === "left" || dir === "right" ? Math.abs(ey - cy) : Math.abs(ex - cx);
    const s = Math.max(main, 0) + cross * 2.5 + (overlap ? 0 : 40) + align * 0.05;
    if (s < score) {
      score = s;
      winner = el;
    }
  }
  return winner;
}

/** Should this key stay with the text box (cursor movement)? */
function keepInField(el: Element, dir: Dir) {
  // Dropdowns: arrows move on; Enter opens the list.
  if (el instanceof HTMLSelectElement) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  const type = el.type.toLowerCase();
  if (type === "range" || type.startsWith("date") || type === "time" || type === "month" || type === "week") return true;
  if (!TEXT_TYPES.has(type)) return false;
  if (dir === "up" || dir === "down") return false;
  // number inputs have no selection API: let ←/→ leave right away.
  let start: number | null = null;
  let end: number | null = null;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    return false;
  }
  if (start === null || end === null) return false;
  if (start !== end) return true;
  return dir === "left" ? start > 0 : end < el.value.length;
}

function focusEl(el: HTMLElement) {
  if (!el.matches(NATIVE) && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  document.documentElement.classList.add("kbd-nav");
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

function onKeyDown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (event.key === "Escape") {
    onEscape(event, document.activeElement as HTMLElement | null);
    return;
  }
  if (event.defaultPrevented) return;

  const active = document.activeElement as HTMLElement | null;

  if (event.key === "Enter") {
    if (!active || active === document.body) return;
    const native = active.matches('a[href], button, input, select, textarea, summary');
    if (active instanceof HTMLSelectElement) {
      event.preventDefault();
      try {
        (active as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
      } catch {
        /* not allowed here: nothing to do */
      }
      return;
    }
    if (active instanceof HTMLInputElement && (active.type === "checkbox" || active.type === "radio")) {
      event.preventDefault();
      active.click();
      return;
    }
    // Elements with their own Enter handling keep it.
    if (!native && !reactProp(active, "onKeyDown")) {
      event.preventDefault();
      active.click();
    }
    return;
  }

  const dir = KEY_DIR[event.key];
  if (!dir || event.shiftKey) return;
  if (active && active !== document.body && keepInField(active, dir)) return;

  const list = candidates(scope());
  if (!list.length) return;

  let next: HTMLElement | null;
  if (!active || active === document.body || !list.includes(active) && !active.closest('[role="dialog"]')) {
    // Nothing chosen yet: start at the top-left item on screen.
    const onScreen = list.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 56 && r.top < window.innerHeight;
    });
    const main = onScreen.filter((el) => el.closest("main, .babu-main, .acc"));
    const pool = main.length ? main : onScreen.length ? onScreen : list;
    next = pool.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    })[0];
  } else {
    next = best(active.getBoundingClientRect(), dir, list, active);
  }
  if (!next) return; // nothing that way: let the page scroll as usual
  event.preventDefault();
  focusEl(next);
}

/** A popup on screen: a dialog, or a full-screen layer over the page. */
function topPopup(): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"], dialog[open]')).filter(isVisible);
  if (dialogs.length) return dialogs[dialogs.length - 1];
  const layers = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((el) => {
    const st = getComputedStyle(el);
    if (st.position !== "fixed" || Number(st.zIndex) < 30) return false;
    const r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9 && isVisible(el) && el.childElementCount > 0;
  });
  return layers[layers.length - 1] ?? null;
}

function closePopup(popup: HTMLElement) {
  const closeBtn = Array.from(
    popup.querySelectorAll<HTMLElement>(
      'button[aria-label^="Close" i], button[aria-label^="Cancel" i], button[title^="Close" i], [data-close], .acc-sheet-close',
    ),
  ).find((b) => isVisible(b) && !isDisabled(b));
  if (closeBtn) {
    closeBtn.click();
    return true;
  }
  // Most popups close when the dark area around them is clicked.
  const overlay = popup.getAttribute("role") === "dialog" ? popup.parentElement : popup;
  if (overlay && overlay !== document.body && reactProp(overlay, "onClick")) {
    overlay.click();
    return true;
  }
  return false;
}

/** Esc: close the popup on top; otherwise leave the text box; otherwise go back. */
function onEscape(event: KeyboardEvent, active: HTMLElement | null) {
  const popup = topPopup();
  if (popup) {
    // Popups that handle Esc themselves already did; don't close twice.
    if (event.defaultPrevented) return;
    if (closePopup(popup)) event.preventDefault();
    return;
  }
  if (event.defaultPrevented) return;
  if (active && active !== document.body && active.matches("input, textarea, select, [contenteditable='true']")) {
    active.blur();
    event.preventDefault();
    return;
  }
  if (window.history.length > 1) {
    event.preventDefault();
    window.history.back();
  }
}

let installed = false;

export function installArrowNav() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", onKeyDown);
  // Hide the keyboard ring again once the mouse / finger is used.
  window.addEventListener("pointerdown", () => document.documentElement.classList.remove("kbd-nav"), { passive: true });
}
