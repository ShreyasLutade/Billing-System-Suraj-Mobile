import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

/**
 * Apple-style continuous ("squircle") corners.
 * Every rounded-* class keeps its normal radius in browsers without
 * `corner-shape`; where it is supported the corner becomes a squircle and
 * the radius grows by --rs (1.5, set in index.css) so it reads like iOS.
 * Circles and pills (rounded-full, 50%) stay perfectly round.
 */
const RADIUS_PROPS = {
  rounded: ["border-radius"],
  "rounded-s": ["border-start-start-radius", "border-end-start-radius"],
  "rounded-e": ["border-start-end-radius", "border-end-end-radius"],
  "rounded-t": ["border-top-left-radius", "border-top-right-radius"],
  "rounded-r": ["border-top-right-radius", "border-bottom-right-radius"],
  "rounded-b": ["border-bottom-right-radius", "border-bottom-left-radius"],
  "rounded-l": ["border-top-left-radius", "border-bottom-left-radius"],
  "rounded-ss": ["border-start-start-radius"],
  "rounded-se": ["border-start-end-radius"],
  "rounded-ee": ["border-end-end-radius"],
  "rounded-es": ["border-end-start-radius"],
  "rounded-tl": ["border-top-left-radius"],
  "rounded-tr": ["border-top-right-radius"],
  "rounded-br": ["border-bottom-right-radius"],
  "rounded-bl": ["border-bottom-left-radius"],
};

/** Plain positive length that is not a circle/pill radius. */
function squircleable(value) {
  const m = /^(\d*\.?\d+)(px|rem|em)$/.exec(String(value).trim());
  if (!m) return false;
  const n = parseFloat(m[1]);
  return n > 0 && !(m[2] === "px" && n >= 999);
}

const squircleCorners = plugin(({ matchUtilities, theme }) => {
  matchUtilities(
    Object.fromEntries(
      Object.entries(RADIUS_PROPS).map(([name, props]) => [
        name,
        (value) => {
          if (!squircleable(value)) {
            return Object.fromEntries(props.map((prop) => [prop, value]));
          }
          const scaled = `calc(${value} * var(--rs, 1))`;
          return {
            ...Object.fromEntries(props.map((prop) => [prop, scaled])),
            "corner-shape": "squircle",
          };
        },
      ]),
    ),
    { values: theme("borderRadius") },
  );
});

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "rgb(var(--color-ink-950) / <alpha-value>)",
          900: "rgb(var(--color-ink-900) / <alpha-value>)",
          800: "rgb(var(--color-ink-800) / <alpha-value>)",
          700: "rgb(var(--color-ink-700) / <alpha-value>)",
          600: "rgb(var(--color-ink-600) / <alpha-value>)",
          500: "rgb(var(--color-ink-500) / <alpha-value>)",
          400: "rgb(var(--color-ink-400) / <alpha-value>)",
          300: "rgb(var(--color-ink-300) / <alpha-value>)",
          100: "rgb(var(--color-ink-100) / <alpha-value>)",
          50: "rgb(var(--color-ink-50) / <alpha-value>)",
        },
        tide: {
          600: "rgb(var(--color-tide-600) / <alpha-value>)",
          500: "rgb(var(--color-tide-500) / <alpha-value>)",
          400: "rgb(var(--color-tide-400) / <alpha-value>)",
          100: "rgb(var(--color-tide-100) / <alpha-value>)",
        },
        sand: {
          50: "rgb(var(--color-sand-50) / <alpha-value>)",
          100: "rgb(var(--color-sand-100) / <alpha-value>)",
        },
        ember: {
          500: "rgb(var(--color-ember-500) / <alpha-value>)",
          400: "rgb(var(--color-ember-400) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgb(var(--color-surface) / <alpha-value>)",
          muted: "rgb(var(--color-surface-muted) / <alpha-value>)",
          elevated: "rgb(var(--color-surface-elevated) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ['"Manrope"', "system-ui", "sans-serif"],
        sans: ['"Manrope"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        lift: "var(--shadow-lift)",
      },
      backgroundImage: {
        mesh: "var(--bg-mesh)",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  corePlugins: { borderRadius: false },
  plugins: [squircleCorners],
} satisfies Config;
