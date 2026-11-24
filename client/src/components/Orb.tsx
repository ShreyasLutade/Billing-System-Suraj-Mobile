import { ThinkingOrb } from "thinking-orbs";
import clsx from "clsx";

/**
 * The app's loader: the "working" thinking orb (dots on tilted orbits).
 * 64 for page / panel loading, 20 inline next to text or in small buttons.
 * Light/dark ink follows the `dark` class on <html> automatically.
 */
export function Orb({
  size = 64,
  className,
}: {
  size?: 64 | 32 | 20;
  className?: string;
}) {
  return (
    <ThinkingOrb
      state="working"
      size={size}
      aria-hidden
      className={clsx("shrink-0", className)}
    />
  );
}
