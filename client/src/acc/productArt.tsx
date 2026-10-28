import { useId, type ReactNode } from "react";

/*
 * Product-style illustrations for accessory categories: shaded, lit objects
 * (a real phone case, glass sheet, headphones…) instead of line icons.
 * All 64×64; gradient ids are made unique per instance with useId.
 */

type Draw = (u: (name: string) => string) => ReactNode;

const metal = (u: (n: string) => string, id = "metal") => (
  <linearGradient id={u(id)} x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stopColor="#f3f4f6" />
    <stop offset="0.5" stopColor="#c7cbd1" />
    <stop offset="1" stopColor="#8b9099" />
  </linearGradient>
);

const ground = <ellipse cx="32" cy="59" rx="17" ry="2.6" fill="#000" opacity="0.18" />;

const ART: Record<string, Draw> = {
  /* Cover: silicone back case with camera bump */
  smartphone: (u) => (
    <>
      <defs>
        <linearGradient id={u("case")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b9a4ff" />
          <stop offset="0.55" stopColor="#7c4dff" />
          <stop offset="1" stopColor="#4c1d95" />
        </linearGradient>
        <radialGradient id={u("lens")} cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#64748b" />
          <stop offset="0.5" stopColor="#111827" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
      </defs>
      {ground}
      <rect x="17" y="5" width="30" height="52" rx="8" fill={`url(#${u("case")})`} />
      <rect x="18.6" y="6.6" width="26.8" height="48.8" rx="6.6" fill="none" stroke="#fff" strokeOpacity="0.28" />
      <rect x="21" y="10" width="14" height="14" rx="4" fill="#2a1458" />
      <rect x="21" y="10" width="14" height="14" rx="4" fill="none" stroke="#fff" strokeOpacity="0.18" />
      <circle cx="25.2" cy="14.4" r="2.6" fill={`url(#${u("lens")})`} stroke="#a3a3a3" strokeWidth="0.6" />
      <circle cx="25.2" cy="19.8" r="2.6" fill={`url(#${u("lens")})`} stroke="#a3a3a3" strokeWidth="0.6" />
      <circle cx="31" cy="14.2" r="1.2" fill="#fde68a" />
      <circle cx="31" cy="19.8" r="1" fill="#0b0b0f" />
      <rect x="20" y="27" width="3" height="27" rx="1.5" fill="#fff" opacity="0.2" />
      <circle cx="32" cy="40" r="3.4" fill="#fff" opacity="0.16" />
    </>
  ),

  /* Glass: two tempered-glass sheets with reflections */
  shield: (u) => (
    <>
      <defs>
        <linearGradient id={u("g1")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ecfeff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#67e8f9" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id={u("g2")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5f3fc" stopOpacity="0.7" />
          <stop offset="1" stopColor="#0891b2" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {ground}
      <rect x="15" y="8" width="27" height="47" rx="6" fill={`url(#${u("g2")})`} stroke="#0e7490" strokeOpacity="0.5" transform="rotate(-9 28 31)" />
      <rect x="21" y="7" width="27" height="48" rx="6" fill={`url(#${u("g1")})`} stroke="#0891b2" strokeWidth="1.2" />
      <rect x="30" y="9.5" width="9" height="2.2" rx="1.1" fill="#155e75" opacity="0.55" />
      <path d="M24 52 L44 12 L47.5 12 L27.5 52 Z" fill="#fff" opacity="0.6" />
      <path d="M30 52 L46 20 L47 20 L31 52 Z" fill="#fff" opacity="0.5" />
      <rect x="21" y="7" width="27" height="48" rx="6" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="0.6" />
    </>
  ),

  /* Headphone: over-ear with padded band */
  headphones: (u) => (
    <>
      <defs>
        <linearGradient id={u("band")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b7280" />
          <stop offset="1" stopColor="#111827" />
        </linearGradient>
        <linearGradient id={u("cup")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4b5563" />
          <stop offset="1" stopColor="#030712" />
        </linearGradient>
      </defs>
      {ground}
      <path d="M13 38 C13 12 51 12 51 38" fill="none" stroke={`url(#${u("band")})`} strokeWidth="5" strokeLinecap="round" />
      <path d="M20 22 C26 15.5 38 15.5 44 22" fill="none" stroke="#f43f5e" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M21 21 C27 16 37 16 43 21" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1" strokeLinecap="round" />
      <rect x="7" y="33" width="13" height="22" rx="6.5" fill={`url(#${u("cup")})`} />
      <rect x="17" y="35" width="5.5" height="18" rx="2.75" fill="#1f2937" />
      <rect x="9.4" y="36.5" width="8.2" height="15" rx="4.1" fill="none" stroke="#f43f5e" strokeWidth="1.4" />
      <rect x="9" y="35" width="2" height="10" rx="1" fill="#fff" opacity="0.28" />
      <rect x="44" y="33" width="13" height="22" rx="6.5" fill={`url(#${u("cup")})`} />
      <rect x="41.5" y="35" width="5.5" height="18" rx="2.75" fill="#1f2937" />
      <rect x="46.4" y="36.5" width="8.2" height="15" rx="4.1" fill="none" stroke="#f43f5e" strokeWidth="1.4" />
      <rect x="46" y="35" width="2" height="10" rx="1" fill="#fff" opacity="0.28" />
    </>
  ),

  /* Neckband: flexible horseshoe band, battery pods, cables to the buds */
  neckband: (u) => (
    <>
      <defs>
        <linearGradient id={u("band")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4b5563" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id={u("pod")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#374151" />
          <stop offset="1" stopColor="#030712" />
        </linearGradient>
      </defs>
      {ground}
      <path d="M13 13 C9 46 55 46 51 13" fill="none" stroke={`url(#${u("band")})`} strokeWidth="5.5" strokeLinecap="round" />
      <path d="M15.5 30 C21 40 43 40 48.5 30" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M13.5 9 C18 22 22 36 23.5 46" fill="none" stroke="#1f2937" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M50.5 9 C46 22 42 36 40.5 46" fill="none" stroke="#1f2937" strokeWidth="1.3" strokeLinecap="round" />
      <g transform="rotate(-6 13 17)">
        <rect x="8.5" y="6" width="9" height="20" rx="4.5" fill={`url(#${u("pod")})`} />
        <rect x="9.6" y="8" width="2" height="12" rx="1" fill="#fff" opacity="0.25" />
        <rect x="11.5" y="21" width="3" height="1.6" rx="0.8" fill="#14b8a6" />
      </g>
      <g transform="rotate(6 51 17)">
        <rect x="46.5" y="6" width="9" height="20" rx="4.5" fill={`url(#${u("pod")})`} />
        <rect x="47.6" y="8" width="2" height="12" rx="1" fill="#fff" opacity="0.25" />
      </g>
      <circle cx="23.5" cy="50" r="4.6" fill="#111827" />
      <circle cx="22.2" cy="48.7" r="1.6" fill="#14b8a6" opacity="0.9" />
      <circle cx="40.5" cy="50" r="4.6" fill="#111827" />
      <circle cx="39.2" cy="48.7" r="1.6" fill="#14b8a6" opacity="0.9" />
    </>
  ),

  /* Earbuds: charging case + two buds */
  ear: (u) => (
    <>
      <defs>
        <linearGradient id={u("w")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c3cad6" />
        </linearGradient>
      </defs>
      {ground}
      <rect x="6" y="30" width="32" height="25" rx="11" fill={`url(#${u("w")})`} stroke="#94a3b8" strokeWidth="0.6" />
      <path d="M7 39 H37" stroke="#94a3b8" strokeWidth="0.8" />
      <rect x="9" y="32" width="18" height="3" rx="1.5" fill="#fff" opacity="0.9" />
      <circle cx="22" cy="47" r="1.1" fill="#22c55e" />
      <g transform="rotate(14 46 26)">
        <rect x="41.5" y="24" width="5" height="18" rx="2.5" fill={`url(#${u("w")})`} stroke="#94a3b8" strokeWidth="0.5" />
        <circle cx="45" cy="21" r="6.5" fill={`url(#${u("w")})`} stroke="#94a3b8" strokeWidth="0.5" />
        <ellipse cx="47.2" cy="20" rx="2.3" ry="1.7" fill="#334155" opacity="0.75" />
        <rect x="42.5" y="38.5" width="3" height="2.5" rx="1" fill="#cbd5e1" />
      </g>
      <g transform="rotate(-8 54 34)">
        <rect x="51" y="35" width="4.6" height="16" rx="2.3" fill={`url(#${u("w")})`} stroke="#94a3b8" strokeWidth="0.5" />
        <circle cx="54" cy="32" r="6" fill={`url(#${u("w")})`} stroke="#94a3b8" strokeWidth="0.5" />
        <ellipse cx="52" cy="31" rx="2.1" ry="1.5" fill="#334155" opacity="0.75" />
      </g>
    </>
  ),

  /* Charger: wall adapter with prongs and USB-C port */
  plug: (u) => (
    <>
      <defs>
        <linearGradient id={u("b")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9ced6" />
        </linearGradient>
        {metal(u)}
      </defs>
      {ground}
      <rect x="25" y="6" width="3.4" height="15" rx="1.2" fill={`url(#${u("metal")})`} />
      <rect x="35.6" y="6" width="3.4" height="15" rx="1.2" fill={`url(#${u("metal")})`} />
      <rect x="17" y="19" width="30" height="36" rx="7" fill={`url(#${u("b")})`} stroke="#9ca3af" strokeWidth="0.6" />
      <rect x="19" y="21" width="26" height="5" rx="2.5" fill="#fff" opacity="0.9" />
      <path d="M34 30 l-5.5 8 h4 l-1.5 7 l6 -9 h-4 z" fill="#f59e0b" />
      <rect x="27" y="48" width="10" height="3.6" rx="1.8" fill="#111827" />
    </>
  ),

  /* Cable: USB-C cable with two connectors */
  cable: (u) => (
    <>
      <defs>
        <linearGradient id={u("c")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#374151" />
          <stop offset="1" stopColor="#0b0f19" />
        </linearGradient>
        {metal(u)}
      </defs>
      {ground}
      <path d="M15 44 C8 26 34 34 32 22 C30 10 52 10 50 30" fill="none" stroke={`url(#${u("c")})`} strokeWidth="4.6" strokeLinecap="round" />
      <path d="M15 44 C8 26 34 34 32 22 C30 10 52 10 50 30" fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="10" y="42" width="10" height="13" rx="2.5" fill={`url(#${u("c")})`} />
      <rect x="10" y="44" width="10" height="2" fill="#10b981" />
      <rect x="11.7" y="54" width="6.6" height="5" rx="1.6" fill={`url(#${u("metal")})`} />
      <rect x="45" y="28" width="10" height="13" rx="2.5" fill={`url(#${u("c")})`} />
      <rect x="45" y="30" width="10" height="2" fill="#10b981" />
      <rect x="46.7" y="40" width="6.6" height="5" rx="1.6" fill={`url(#${u("metal")})`} />
    </>
  ),

  /* Speaker: fabric Bluetooth speaker */
  speaker: (u) => (
    <>
      <defs>
        <linearGradient id={u("f")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fdba74" />
          <stop offset="0.5" stopColor="#f97316" />
          <stop offset="1" stopColor="#9a3412" />
        </linearGradient>
        <pattern id={u("mesh")} width="3" height="3" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.55" fill="#7c2d12" opacity="0.45" />
        </pattern>
      </defs>
      {ground}
      <rect x="6" y="20" width="52" height="30" rx="15" fill={`url(#${u("f")})`} />
      <rect x="6" y="20" width="52" height="30" rx="15" fill={`url(#${u("mesh")})`} />
      <ellipse cx="11" cy="35" rx="5" ry="14" fill="#7c2d12" />
      <ellipse cx="11" cy="35" rx="3" ry="9" fill="#431407" />
      <ellipse cx="53" cy="35" rx="5" ry="14" fill="#7c2d12" />
      <ellipse cx="53" cy="35" rx="3" ry="9" fill="#431407" />
      <rect x="25" y="32" width="14" height="6" rx="3" fill="#111827" />
      <rect x="27.5" y="34.2" width="9" height="1.6" rx="0.8" fill="#fff" opacity="0.8" />
      <rect x="14" y="22.5" width="36" height="4" rx="2" fill="#fff" opacity="0.28" />
    </>
  ),

  /* Power bank: with charge LEDs */
  battery: (u) => (
    <>
      <defs>
        <linearGradient id={u("p")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6b7280" />
          <stop offset="1" stopColor="#111827" />
        </linearGradient>
        <linearGradient id={u("pf")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#374151" />
          <stop offset="1" stopColor="#1f2937" />
        </linearGradient>
      </defs>
      {ground}
      <rect x="15" y="8" width="34" height="49" rx="8" fill={`url(#${u("p")})`} />
      <rect x="18" y="11" width="28" height="43" rx="6" fill={`url(#${u("pf")})`} />
      <rect x="26" y="8.4" width="12" height="2.6" rx="1.2" fill="#000" />
      <rect x="27" y="22" width="10" height="16" rx="2" fill="none" stroke="#84cc16" strokeWidth="1.6" />
      <rect x="30" y="20" width="4" height="2" rx="0.8" fill="#84cc16" />
      <rect x="29" y="30" width="6" height="6" rx="1" fill="#84cc16" />
      <circle cx="25.5" cy="47" r="1.5" fill="#a3e635" />
      <circle cx="30" cy="47" r="1.5" fill="#a3e635" />
      <circle cx="34.5" cy="47" r="1.5" fill="#a3e635" />
      <circle cx="39" cy="47" r="1.5" fill="#3f3f46" />
      <rect x="17" y="11" width="2.5" height="40" rx="1.25" fill="#fff" opacity="0.18" />
    </>
  ),

  /* Smart watch: square case, lit screen, band */
  watch: (u) => (
    <>
      <defs>
        <linearGradient id={u("band")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#3730a3" />
        </linearGradient>
        <linearGradient id={u("case")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d1d5db" />
          <stop offset="1" stopColor="#4b5563" />
        </linearGradient>
      </defs>
      {ground}
      <rect x="23" y="3" width="18" height="16" rx="3.5" fill={`url(#${u("band")})`} />
      <rect x="23" y="45" width="18" height="14" rx="3.5" fill={`url(#${u("band")})`} />
      <rect x="15" y="15" width="34" height="34" rx="10" fill={`url(#${u("case")})`} />
      <rect x="18" y="18" width="28" height="28" rx="8" fill="#05070f" />
      <rect x="49" y="26" width="3" height="8" rx="1.3" fill="#9ca3af" />
      <circle cx="32" cy="32" r="9.5" fill="none" stroke="#1e1b4b" strokeWidth="2.2" />
      <path d="M32 22.5 A9.5 9.5 0 1 1 23.6 36.4" fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" />
      <text x="32" y="34.3" textAnchor="middle" fontSize="6.4" fontWeight="700" fill="#fff" fontFamily="Inter, Arial, sans-serif">10:09</text>
      <path d="M20 20 L30 20 L20 30 Z" fill="#fff" opacity="0.1" />
    </>
  ),

  /* Memory card: microSD */
  memory: (u) => (
    <>
      <defs>
        <linearGradient id={u("m")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#374151" />
          <stop offset="1" stopColor="#030712" />
        </linearGradient>
        <linearGradient id={u("l")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
        <linearGradient id={u("gold")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#b45309" />
        </linearGradient>
      </defs>
      {ground}
      <path d="M21 6 H40 L47 13 V24 L44 27 V53 A4 4 0 0 1 40 57 H21 A4 4 0 0 1 17 53 V10 A4 4 0 0 1 21 6 Z" fill={`url(#${u("m")})`} />
      {[21, 25.5, 30, 34.5, 39].map((x) => (
        <rect key={x} x={x} y="9" width="2.6" height="8" rx="0.7" fill={`url(#${u("gold")})`} />
      ))}
      <rect x="20" y="30" width="21" height="22" rx="2.5" fill={`url(#${u("l")})`} />
      <text x="30.5" y="41" textAnchor="middle" fontSize="7" fontWeight="800" fill="#fff" fontFamily="Inter, Arial, sans-serif">64GB</text>
      <text x="30.5" y="48" textAnchor="middle" fontSize="3.6" fontWeight="700" fill="#fff" opacity="0.85" fontFamily="Inter, Arial, sans-serif">micro SD</text>
      <rect x="19" y="20" width="2" height="30" rx="1" fill="#fff" opacity="0.15" />
    </>
  ),

  /* Pen drive */
  usb: (u) => (
    <>
      <defs>
        <linearGradient id={u("b")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        {metal(u)}
      </defs>
      {ground}
      <rect x="24" y="6" width="16" height="18" rx="1.6" fill={`url(#${u("metal")})`} />
      <rect x="27.5" y="10" width="3.2" height="3.2" fill="#374151" />
      <rect x="33.3" y="10" width="3.2" height="3.2" fill="#374151" />
      <rect x="20" y="22" width="24" height="35" rx="6" fill={`url(#${u("b")})`} />
      <circle cx="32" cy="50" r="2.6" fill="#0b1a3d" />
      <rect x="22.5" y="25" width="3" height="22" rx="1.5" fill="#fff" opacity="0.25" />
    </>
  ),

  tablet: (u) => (
    <>
      <defs>
        <linearGradient id={u("s")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0abfc" />
          <stop offset="0.5" stopColor="#c026d3" />
          <stop offset="1" stopColor="#3b0764" />
        </linearGradient>
      </defs>
      {ground}
      <rect x="9" y="7" width="46" height="50" rx="6" fill="#1f2937" />
      <rect x="12" y="10" width="40" height="44" rx="3.5" fill={`url(#${u("s")})`} />
      <circle cx="32" cy="8.6" r="0.8" fill="#4b5563" />
      <path d="M12 40 C24 30 36 46 52 34 V50.5 A3.5 3.5 0 0 1 48.5 54 H15.5 A3.5 3.5 0 0 1 12 50.5 Z" fill="#fff" opacity="0.18" />
      <path d="M14 12 L30 12 L14 28 Z" fill="#fff" opacity="0.15" />
    </>
  ),

  camera: (u) => (
    <>
      <defs>
        <linearGradient id={u("b")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4b5563" />
          <stop offset="1" stopColor="#0b0f19" />
        </linearGradient>
        <radialGradient id={u("l")} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="0.45" stopColor="#1e1b4b" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
      </defs>
      {ground}
      <path d="M22 18 L26 13 H38 L42 18 Z" fill="#374151" />
      <rect x="7" y="18" width="50" height="34" rx="6" fill={`url(#${u("b")})`} />
      <rect x="11" y="15" width="8" height="4" rx="1.5" fill="#6b7280" />
      <circle cx="32" cy="35" r="13" fill="#9ca3af" />
      <circle cx="32" cy="35" r="11" fill="#1f2937" />
      <circle cx="32" cy="35" r="7.5" fill={`url(#${u("l")})`} />
      <circle cx="29" cy="32" r="2.2" fill="#fff" opacity="0.75" />
      <rect x="46" y="22" width="6" height="2.4" rx="1.2" fill="#ef4444" />
    </>
  ),

  mic: (u) => (
    <>
      <defs>
        {metal(u)}
        <pattern id={u("grill")} width="2.4" height="2.4" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="0.5" fill="#4b5563" opacity="0.6" />
        </pattern>
      </defs>
      {ground}
      <path d="M15 27 A17 17 0 0 0 49 27" fill="none" stroke="#9ca3af" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="30.5" y="43" width="3" height="11" fill="#6b7280" />
      <ellipse cx="32" cy="55" rx="12" ry="2.8" fill="#374151" />
      <rect x="21" y="4" width="22" height="32" rx="11" fill={`url(#${u("metal")})`} />
      <rect x="21" y="4" width="22" height="21" rx="11" fill={`url(#${u("grill")})`} />
      <rect x="21" y="25" width="22" height="3.5" fill="#ec4899" />
      <rect x="24" y="7" width="3" height="16" rx="1.5" fill="#fff" opacity="0.5" />
    </>
  ),

  gamepad: (u) => (
    <>
      <defs>
        <linearGradient id={u("g")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d8b4fe" />
          <stop offset="1" stopColor="#6b21a8" />
        </linearGradient>
      </defs>
      {ground}
      <path d="M17 20 H47 C55 20 60 27 59 36 L57 48 C56 54 49 56 45 51 L40 45 H24 L19 51 C15 56 8 54 7 48 L5 36 C4 27 9 20 17 20 Z" fill={`url(#${u("g")})`} />
      <rect x="15.5" y="26" width="4" height="13" rx="1" fill="#f5f3ff" />
      <rect x="11" y="30.5" width="13" height="4" rx="1" fill="#f5f3ff" />
      <circle cx="45" cy="27.5" r="2.4" fill="#facc15" />
      <circle cx="50" cy="32.5" r="2.4" fill="#ef4444" />
      <circle cx="45" cy="37.5" r="2.4" fill="#22c55e" />
      <circle cx="40" cy="32.5" r="2.4" fill="#3b82f6" />
      <path d="M17 22 H47 C51 22 54 24 56 27" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),

  keyboard: (u) => (
    <>
      <defs>
        <linearGradient id={u("k")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#64748b" />
        </linearGradient>
      </defs>
      {ground}
      <rect x="5" y="19" width="54" height="31" rx="5" fill={`url(#${u("k")})`} />
      {[0, 1, 2].map((row) =>
        Array.from({ length: row === 1 ? 8 : 9 }, (_, i) => (
          <rect key={`${row}-${i}`} x={8.5 + i * 5.3 + (row === 1 ? 1.5 : 0)} y={22.5 + row * 6} width="4.4" height="4.6" rx="1" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.4" />
        )),
      )}
      <rect x="19" y="41" width="26" height="4.6" rx="1" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.4" />
    </>
  ),

  mouse: (u) => (
    <>
      <defs>
        <linearGradient id={u("m")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fafaf9" />
          <stop offset="1" stopColor="#8a817c" />
        </linearGradient>
      </defs>
      {ground}
      <rect x="18" y="6" width="28" height="51" rx="14" fill={`url(#${u("m")})`} />
      <path d="M32 6.5 V25" stroke="#78716c" strokeWidth="0.8" />
      <path d="M18.5 25 H45.5" stroke="#a8a29e" strokeWidth="0.6" />
      <rect x="30.4" y="11" width="3.2" height="8" rx="1.6" fill="#292524" />
      <rect x="21" y="10" width="3" height="30" rx="1.5" fill="#fff" opacity="0.6" />
    </>
  ),

  light: (u) => (
    <>
      <defs>
        <radialGradient id={u("b")} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#fefce8" />
          <stop offset="0.5" stopColor="#fde047" />
          <stop offset="1" stopColor="#ca8a04" />
        </radialGradient>
        {metal(u)}
      </defs>
      {ground}
      <circle cx="32" cy="25" r="20" fill="#fde047" opacity="0.25" />
      <path d="M32 6 C42 6 49 13 49 23 C49 30 44 34 41 38 L40 42 H24 L23 38 C20 34 15 30 15 23 C15 13 22 6 32 6 Z" fill={`url(#${u("b")})`} />
      <path d="M27 36 L27 27 Q32 22 37 27 L37 36" fill="none" stroke="#a16207" strokeWidth="1.2" />
      <rect x="23.5" y="42" width="17" height="4" rx="1.5" fill={`url(#${u("metal")})`} />
      <rect x="24.5" y="46" width="15" height="4" rx="1.5" fill={`url(#${u("metal")})`} />
      <rect x="25.5" y="50" width="13" height="3.5" rx="1.5" fill={`url(#${u("metal")})`} />
      <path d="M28 54 H36 L34 57 H30 Z" fill="#4b5563" />
      <ellipse cx="25" cy="15" rx="3.5" ry="5" fill="#fff" opacity="0.6" transform="rotate(30 25 15)" />
    </>
  ),

  car: (u) => (
    <>
      <defs>
        <linearGradient id={u("c")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
      {ground}
      <path d="M8 40 L11 30 C12 27 14 26 17 26 L22 18 C23 16.5 25 16 27 16 H39 C41 16 43 17 44 19 L49 26 C54 26 57 28 57 32 V44 C57 46 56 47 54 47 H10 C8.5 47 8 46 8 44 Z" fill={`url(#${u("c")})`} />
      <path d="M24 26 L28 19.5 H36 V26 Z" fill="#dbeafe" opacity="0.9" />
      <path d="M38.5 19.5 H40 C41 19.5 42 20 42.5 21 L45.5 26 H38.5 Z" fill="#dbeafe" opacity="0.9" />
      <rect x="50" y="32" width="6" height="3" rx="1.5" fill="#fde68a" />
      <circle cx="19" cy="47" r="6.5" fill="#111827" />
      <circle cx="19" cy="47" r="3" fill="#9ca3af" />
      <circle cx="46" cy="47" r="6.5" fill="#111827" />
      <circle cx="46" cy="47" r="3" fill="#9ca3af" />
      <path d="M12 31 H48" stroke="#fff" strokeOpacity="0.3" strokeWidth="1.2" />
    </>
  ),

  package: () => (
    <>
      {ground}
      <path d="M32 6 L56 17 L32 28 L8 17 Z" fill="#f2c17a" />
      <path d="M8 17 L32 28 V58 L8 47 Z" fill="#d48a35" />
      <path d="M56 17 L32 28 V58 L56 47 Z" fill="#b4691f" />
      <path d="M20 11.5 L44 22.5 V32 L40 30 V24.5 L16 13.5 Z" fill="#fde9c4" opacity="0.9" />
      <path d="M32 28 V58" stroke="#8a4c12" strokeOpacity="0.4" strokeWidth="0.6" />
    </>
  ),
};

export const PRODUCT_ART_KEYS = Object.keys(ART);

export function ProductArt({ kind, className }: { kind: string; className?: string }) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const u = (name: string) => `pa${raw}-${name}`;
  const draw = ART[kind] || ART.package;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      {draw(u)}
    </svg>
  );
}
