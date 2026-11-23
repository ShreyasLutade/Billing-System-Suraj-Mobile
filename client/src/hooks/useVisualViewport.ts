import { useEffect, useState, type CSSProperties } from "react";

/**
 * Style for a `fixed` overlay that covers only the visible part of the screen.
 *
 * On phones the on-screen keyboard doesn't shrink `inset-0` overlays (iOS
 * Safari keeps the layout viewport full height), so a dialog pinned to the
 * bottom ends up behind the keyboard. Following `window.visualViewport`
 * keeps the overlay — and the dialog centred in it — above the keyboard.
 */
export function useVisualViewportStyle(active: boolean): CSSProperties | undefined {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) {
      setBox(null);
      return;
    }
    const update = () => setBox({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);

  return box ? { top: box.top, height: box.height, bottom: "auto" } : undefined;
}
