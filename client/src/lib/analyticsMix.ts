export type MixTone = {
  color: string;
  soft: string;
  ink: string;
  softDark: string;
  inkDark: string;
};

export const MIX = {
  cash: {
    color: "#12B886",
    soft: "#E7F8F1",
    ink: "#0E9E76",
    softDark: "rgba(18,184,134,0.18)",
    inkDark: "#5CE0AE",
  },
  online: {
    color: "#3B82F6",
    soft: "#E8F0FE",
    ink: "#2563EB",
    softDark: "rgba(59,130,246,0.2)",
    inkDark: "#93C5FD",
  },
  finance: {
    color: "#8B5CF6",
    soft: "#F0EBFE",
    ink: "#7C3AED",
    softDark: "rgba(139,92,246,0.2)",
    inkDark: "#C4B5FD",
  },
  due: {
    color: "#F59E0B",
    soft: "#FEF3E2",
    ink: "#B76E00",
    softDark: "rgba(245,158,11,0.2)",
    inkDark: "#FBBF24",
  },
  exchange: {
    color: "#0EA5E9",
    soft: "#E0F2FE",
    ink: "#0284C7",
    softDark: "rgba(14,165,233,0.2)",
    inkDark: "#7DD3FC",
  },
} as const satisfies Record<string, MixTone>;

export function mixSurface(
  tone: MixTone,
  dark: boolean,
): { background: string; color: string } {
  return dark
    ? { background: tone.softDark, color: tone.inkDark }
    : { background: tone.soft, color: tone.ink };
}
