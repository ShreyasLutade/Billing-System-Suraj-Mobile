import type { Config } from "tailwindcss";

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
  plugins: [],
} satisfies Config;
