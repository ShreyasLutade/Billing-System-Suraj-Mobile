import { useEffect, useRef, useState } from "react";
import { MODE_FRAMES, ThinkingOrb, resolvePreset, scaleRadii, type OrbState } from "thinking-orbs";
import clsx from "clsx";

/** True while <html> has the `dark` class (the app's theme switch). */
function useHtmlDark() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Which thinking-orbs animation the whole app uses. */
const ORB_STATE: OrbState = "searching";
/** Bolder dots than the stock design so the orbits read on a phone. */
const DOT_SCALE = 1.4;
/** Brand gold: deeper on the light cream page, brighter on dark. */
const GOLD = { light: { r: 224, g: 154, b: 0 }, dark: { r: 255, g: 201, b: 51 } };
const hex = ({ r, g, b }: { r: number; g: number; b: number }) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/**
 * Dot colour, same depth shading as the package's tint (near dots full
 * gold, far ones fading toward the background).
 */
function goldInk(white: number, alpha: number, dark: boolean) {
  const tint = dark ? GOLD.dark : GOLD.light;
  const w = Math.min(1, Math.max(0, white));
  // On dark, fade only part way to black so the gold stays bright.
  const ramp = (c: number) => Math.round(dark ? c * (1 - 0.35 * w) : c + (255 - c) * w);
  // Dark page: a little more opacity so the far side of the globe still shows.
  const a = dark ? Math.min(1, alpha * 1.5) : alpha;
  return `rgba(${ramp(tint.r)},${ramp(tint.g)},${ramp(tint.b)},${a})`;
}

/**
 * The app's loader: the thinking-orbs "searching" orb (a scan sweeps a dotted globe).
 *
 * The package only ships 20/32/64px presets, and at 64px the orbit rings
 * shrink to faint specks. Its design is drawn for ~300px, so larger orbs
 * are painted here with the package's own engine at the real size: the
 * same animation, with the rings and moving particles clearly visible.
 */
export function Orb({ size = 140, className }: { size?: number; className?: string }) {
  if (size <= 24) return <SmallOrb className={className} />;
  return <LargeOrb size={size} className={className} />;
}

function SmallOrb({ className }: { className?: string }) {
  const dark = useHtmlDark();
  return (
    <ThinkingOrb
      state={ORB_STATE}
      size={20}
      theme={dark ? "dark" : "light"}
      color={hex(dark ? GOLD.dark : GOLD.light)}
      aria-hidden
      className={clsx("shrink-0", className)}
    />
  );
}

function LargeOrb({ size, className }: { size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dark = useHtmlDark();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // The 64 preset is the untouched base design; scale only the dots.
    const preset = resolvePreset(ORB_STATE, 64);
    const { mode, speed } = preset;
    const opts = scaleRadii(preset.opts, DOT_SCALE);
    const makeFrame = MODE_FRAMES[mode];
    const paint = (seconds: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const frame = makeFrame(size, seconds, opts);
      for (const line of frame.lines) {
        ctx.strokeStyle = goldInk(line.white, line.a ?? 1, dark);
        ctx.lineWidth = line.w;
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y1);
        ctx.lineTo(line.x2, line.y2);
        ctx.stroke();
      }
      for (const dot of frame.dots) {
        ctx.fillStyle = goldInk(dot.white, dot.a ?? 1, dark);
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, Math.max(0.3, dot.r), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paint(0.6);
      return;
    }

    let raf = 0;
    let running = false;
    const loop = () => {
      paint((performance.now() / 1000) * speed);
      if (running) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    paint((performance.now() / 1000) * speed);

    // Pause when scrolled away or the app is in the background.
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && document.visibilityState !== "hidden") start();
      else stop();
    });
    observer.observe(canvas);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [size, dark]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={clsx("block shrink-0", className)}
      style={{ width: size, height: size }}
    />
  );
}
