export type MenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

function visualBox() {
  const vv = window.visualViewport;
  if (vv) {
    return {
      top: vv.offsetTop,
      left: vv.offsetLeft,
      width: vv.width,
      height: vv.height,
      bottom: vv.offsetTop + vv.height,
    };
  }
  return {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    bottom: window.innerHeight,
  };
}

function isCompactViewport() {
  return window.matchMedia("(max-width: 900px), (pointer: coarse)").matches;
}

/**
 * Position a fixed dropdown relative to a trigger.
 * On mobile / touch, always open below so the keyboard can't flip it above.
 * Uses visualViewport so height accounts for the soft keyboard.
 */
export function computeMenuPosition(
  trigger: HTMLElement,
  opts?: {
    gap?: number;
    minHeight?: number;
    maxHeightCap?: number;
    forceBelow?: boolean;
  },
): MenuPosition {
  const gap = opts?.gap ?? 8;
  const minHeight = opts?.minHeight ?? 140;
  const maxHeightCap = opts?.maxHeightCap ?? 320;
  const rect = trigger.getBoundingClientRect();
  const vp = visualBox();
  const forceBelow = opts?.forceBelow ?? isCompactViewport();

  const spaceBelow = vp.bottom - rect.bottom - gap - 8;
  const spaceAbove = rect.top - vp.top - gap - 8;
  const preferBelow =
    forceBelow || spaceBelow >= 180 || spaceBelow >= spaceAbove;

  const left = Math.min(
    Math.max(vp.left + 8, rect.left),
    vp.left + vp.width - rect.width - 8,
  );

  if (preferBelow) {
    // Stay anchored under the field; shrink height for the keyboard instead of flipping.
    const top = rect.bottom + gap;
    const maxHeight = Math.max(
      96,
      Math.min(maxHeightCap, Math.max(spaceBelow, 96)),
    );
    return {
      top,
      left,
      width: rect.width,
      maxHeight: Math.min(maxHeight, Math.max(96, vp.bottom - top - 8)),
    };
  }

  const maxHeight = Math.max(
    minHeight,
    Math.min(maxHeightCap, Math.max(spaceAbove, minHeight)),
  );
  const top = Math.max(vp.top + 8, rect.top - gap - maxHeight);

  return {
    top,
    left,
    width: rect.width,
    maxHeight: Math.min(maxHeight, Math.max(96, rect.top - gap - top)),
  };
}

export function subscribeViewportChange(handler: () => void) {
  window.addEventListener("resize", handler);
  window.addEventListener("scroll", handler, true);
  const vv = window.visualViewport;
  vv?.addEventListener("resize", handler);
  vv?.addEventListener("scroll", handler);
  return () => {
    window.removeEventListener("resize", handler);
    window.removeEventListener("scroll", handler, true);
    vv?.removeEventListener("resize", handler);
    vv?.removeEventListener("scroll", handler);
  };
}

/**
 * Dismiss when the user taps outside — but ignore the synthetic
 * focus/pointer sequence that happens when the mobile keyboard closes.
 */
export function subscribeOutsideDismiss(
  isInside: (target: EventTarget | null) => boolean,
  onDismiss: () => void,
) {
  let ignoreUntil = 0;

  const armIgnore = () => {
    ignoreUntil = Date.now() + 500;
  };

  const onFocusOut = (event: FocusEvent) => {
    // Keyboard "Done" / dismiss usually blurs with no relatedTarget.
    if (!event.relatedTarget) armIgnore();
  };

  const onPointerDown = (event: Event) => {
    if (Date.now() < ignoreUntil) return;
    if (isInside(event.target)) return;
    onDismiss();
  };

  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("pointerdown", onPointerDown, true);

  return () => {
    document.removeEventListener("focusout", onFocusOut, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
}
