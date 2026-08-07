import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07111C",
          900: "#0B1F33",
          800: "#143049",
          700: "#1E3F5A",
          500: "#4A657A",
          300: "#8FA3B5",
          100: "#D7E2EC",
          50: "#F3F7FB",
        },
        tide: {
          600: "#0F766E",
          500: "#0D9488",
          400: "#2DD4BF",
          100: "#CCFBF1",
        },
        sand: {
          50: "#F7F4EF",
          100: "#EFE8DE",
        },
        ember: {
          500: "#C2410C",
          400: "#EA580C",
        },
      },
      fontFamily: {
        display: ['"Manrope"', "system-ui", "sans-serif"],
        sans: ['"Manrope"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "0 18px 50px rgba(11, 31, 51, 0.08)",
        lift: "0 10px 30px rgba(11, 31, 51, 0.12)",
      },
      backgroundImage: {
        mesh:
          "radial-gradient(1200px 600px at 10% -10%, rgba(45, 212, 191, 0.18), transparent 55%), radial-gradient(900px 500px at 100% 0%, rgba(14, 116, 144, 0.14), transparent 50%), linear-gradient(180deg, #F4F7FB 0%, #EEF3F8 45%, #F7F4EF 100%)",
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
