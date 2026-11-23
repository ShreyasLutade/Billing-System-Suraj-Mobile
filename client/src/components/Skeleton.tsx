import type { CSSProperties, ReactNode } from "react";
import clsx from "clsx";

/**
 * Loading skeleton, "outline draws, then fills": each block's border draws
 * itself in brand yellow, then the block fills in, one after another down
 * the page, and the whole thing repeats until the data arrives. Blocks are
 * laid out like the page being loaded. Still (filled) when the phone asks
 * for less motion.
 */
export function SkelBlock({
  className,
  i = 0,
  radius = 12,
  tone = "light",
  style,
  children,
}: {
  className?: string;
  /** Order on the page: later blocks draw a little later. */
  i?: number;
  radius?: number;
  /** "dark" for blocks standing in for navy hero cards. */
  tone?: "light" | "dark";
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={clsx("skel-draw", tone === "dark" && "skel-draw-dark", className)}
      style={{ "--i": i, "--r": `${radius}px`, ...style } as CSSProperties}
      aria-hidden
    >
      <svg className="skel-draw-svg">
        <rect pathLength={100} rx={radius} ry={radius} width="100%" height="100%" />
      </svg>
      {children}
    </div>
  );
}

/** A list row: circle + two lines + amount, drawn as one card. */
function Row({ i }: { i: number }) {
  return (
    <SkelBlock i={i} radius={16} className="flex h-[62px] items-center gap-3 px-3">
      <SkelBlock i={i + 0.5} radius={18} className="h-9 w-9 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <SkelBlock i={i + 0.6} radius={5} className="h-2.5 w-[55%]" />
        <SkelBlock i={i + 0.7} radius={5} className="h-2 w-[35%]" />
      </div>
      <SkelBlock i={i + 0.8} radius={5} className="h-3 w-14 shrink-0" />
    </SkelBlock>
  );
}

export type SkeletonVariant = "rows" | "detail" | "table" | "form" | "analytics" | "trend";

/** The page-shaped skeletons. */
export function PageSkeleton({ variant = "rows", rows = 5 }: { variant?: SkeletonVariant; rows?: number }) {
  if (variant === "detail") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <SkelBlock i={0} radius={12} className="h-9 w-9 shrink-0" />
          <SkelBlock i={0.2} radius={20} className="h-10 w-10 shrink-0" />
          <div className="flex flex-1 flex-col gap-1.5">
            <SkelBlock i={0.3} radius={5} className="h-3.5 w-[45%]" />
            <SkelBlock i={0.4} radius={5} className="h-2.5 w-[30%]" />
          </div>
        </div>
        <SkelBlock i={1} radius={18} tone="dark" className="h-[150px]" />
        <SkelBlock i={1.6} radius={5} className="mt-1 h-2.5 w-24" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: rows }, (_, k) => (
            <Row key={k} i={2 + k * 0.5} />
          ))}
        </div>
      </div>
    );
  }
  if (variant === "table") {
    return (
      <div className="flex flex-col gap-3">
        <SkelBlock i={0} radius={16} className="h-14" />
        <SkelBlock i={0.6} radius={16} className="overflow-hidden">
          <div className="flex flex-col">
            <SkelBlock i={0.8} radius={0} tone="dark" className="h-9" />
            {Array.from({ length: 8 }, (_, k) => (
              <div key={k} className="flex items-center gap-3 border-b border-transparent px-3 py-3">
                <SkelBlock i={1 + k * 0.3} radius={5} className="h-3 flex-1" />
                <SkelBlock i={1.1 + k * 0.3} radius={6} className="h-5 w-7 shrink-0" />
                <SkelBlock i={1.2 + k * 0.3} radius={5} className="h-3 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </SkelBlock>
      </div>
    );
  }
  if (variant === "form") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <SkelBlock i={0} radius={6} className="h-5 w-40" />
        {Array.from({ length: 5 }, (_, k) => (
          <div key={k} className="flex flex-col gap-1.5">
            <SkelBlock i={0.5 + k * 0.4} radius={5} className="h-2.5 w-24" />
            <SkelBlock i={0.6 + k * 0.4} radius={16} className="h-12" />
          </div>
        ))}
        <SkelBlock i={3} radius={16} tone="dark" className="h-12" />
      </div>
    );
  }
  if (variant === "analytics") {
    return (
      <div className="flex flex-col gap-4">
        <SkelBlock i={0} radius={20} tone="dark" className="h-[250px]" />
        <div className="grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map((k) => (
            <SkelBlock key={k} i={1 + k * 0.3} radius={16} className="aspect-square" />
          ))}
        </div>
        <SkelBlock i={2} radius={5} className="h-2.5 w-40" />
        <SkelBlock i={2.3} radius={20} className="h-[200px]" />
      </div>
    );
  }
  if (variant === "trend") {
    return (
      <div className="flex flex-col gap-3">
        <SkelBlock i={0} radius={18} tone="dark" className="h-[148px]" />
        <SkelBlock i={1} radius={18} className="h-[250px]" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, k) => (
        <Row key={k} i={k * 0.5} />
      ))}
    </div>
  );
}

const REVEAL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Called as a skeleton leaves (its LoadingBlock unmounts, still in the
 * page): a frozen copy stays where it was and melts away (fade + blur),
 * while the content that took its place rises in from a soft blur, block
 * by block from the top, so loading and content feel like one motion.
 */
export function meltSkeleton(el: HTMLElement | null) {
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
