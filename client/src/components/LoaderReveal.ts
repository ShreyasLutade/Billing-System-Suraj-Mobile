/* Loading → content hand-over for LoadingBlock (components/ui). */

const REVEAL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Called as the loader leaves (its LoadingBlock unmounts, still in the
 * page): a frozen copy stays where it was and fades away (fade + blur),
 * while the content that took its place rises in from a soft blur, block
 * by block from the top, so loading and content feel like one motion.
 */
export function meltLoader(el: HTMLElement | null) {
  if (!el || !el.isConnected || typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = el.getBoundingClientRect();
  if (rect.height < 8 || rect.bottom < 0 || rect.top > window.innerHeight) return;
  const parent = el.parentElement;

  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("role");
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("skel-ghost");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    zIndex: "25",
    pointerEvents: "none",
  });
  document.body.appendChild(ghost);
  ghost.animate(
    [
      { opacity: 1, filter: "blur(0px)", transform: "scale(1)" },
      { opacity: 0, filter: "blur(10px)", transform: "scale(1.015)" },
    ],
    { duration: 420, easing: REVEAL_EASE, fill: "forwards" },
  ).finished.finally(() => ghost.remove());

  // Next frame: the content is in the page; bring it in under the ghost.
  requestAnimationFrame(() => {
    if (!parent || !parent.isConnected) return;
    const below = (nodes: Element[]) =>
      nodes.filter(
        (node) =>
          node instanceof HTMLElement &&
          !node.classList.contains("skel-ghost") &&
          node.getBoundingClientRect().top >= rect.top - 8,
      ) as HTMLElement[];
    let targets = below([...parent.children]);
    // The whole page replaced the skeleton: stagger its sections instead.
    if (targets.length === 1 && targets[0].children.length > 1) {
      targets = below([...targets[0].children]);
    }
    targets.slice(0, 14).forEach((node, index) => {
      node.animate(
        [
          { opacity: 0, transform: "translateY(12px) scale(0.985)", filter: "blur(6px)" },
          { opacity: 1, transform: "none", filter: "blur(0px)" },
        ],
        { duration: 520, delay: 60 + index * 55, easing: REVEAL_EASE, fill: "backwards" },
      );
    });
  });
}
