import { useLayoutEffect, useState, type RefObject } from "react";

export type FixedBottomBar = {
  /** True while the phone bottom nav is showing. */
  mobile: boolean;
  left: number;
  width: number;
  /** Height of the bottom nav: the bar sits right on top of it. */
  bottom: number;
  /** Height of the bar itself, to leave room at the end of the page. */
  height: number;
};

/**
 * Phones: a button bar `position: fixed` over the page column, right above the
 * bottom nav (measured, so it fits every phone). Laptop: `mobile` is false and
 * the bar can stay in the normal page flow.
 */
export function useFixedBottomBar(
  rootRef: RefObject<HTMLElement | null>,
  barRef: RefObject<HTMLElement | null>,
  enabled = true,
) {
  const [bar, setBar] = useState<FixedBottomBar>(() => ({
    mobile: typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
    left: 0,
    width: 0,
    bottom: 0,
    height: 0,
  }));

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const nav = document.querySelector<HTMLElement>(".babu-mobile-nav");
    const measure = () => {
      const box = root.getBoundingClientRect();
      const navHeight =
        nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().height : 0;
      const height = barRef.current?.getBoundingClientRect().height ?? 0;
      const mobile = navHeight > 0;
      setBar((current) =>
        current.mobile === mobile &&
        current.left === box.left &&
        current.width === box.width &&
        current.bottom === navHeight &&
        current.height === height
          ? current
          : { mobile, left: box.left, width: box.width, bottom: navHeight, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (nav) observer.observe(nav);
    if (barRef.current) observer.observe(barRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rootRef, barRef, enabled]);

  return bar;
}
