export type Theme = "dark" | "light";

interface Palette {
  bg: string;
  shadow: string;
  highlight: string;
  accent: string;
  wood: string;
  park: string;
  landuse: string;
  water: string;
  river: string;
  roads: string;
  buildings: string;
  text: string;
  halo: string;
  riverText: string;
  roadText: string;
  // Rampa secuencial de las columnas de eventos (bajo -> medio -> alto).
  ramp: [number, number, number][];
  transit: Record<"metro" | "cable" | "tram" | "bike_share", [number, number, number]>;
}

export const PALETTE: Record<Theme, Palette> = {
  dark: {
    bg: "#16202b",
    shadow: "#05080c",
    highlight: "#3a4b5c",
    accent: "#0b1218",
    wood: "#1e3a2c",
    park: "#24503a",
    landuse: "#2a3644",
    water: "#2f7fb8",
    river: "#4aa3e0",
    roads: "#556677",
    buildings: "#5b6b7d",
    text: "#e8eef4",
    halo: "#0f1720",
    riverText: "#8cc8f0",
    roadText: "#aab8c6",
    ramp: [[255, 214, 102], [255, 138, 61], [232, 62, 110]],
    transit: {
      metro: [74, 163, 224],
      cable: [196, 128, 255],
      tram: [90, 220, 160],
      bike_share: [255, 255, 255],
    },
  },
  light: {
    bg: "#f2ece0",
    shadow: "#b9ad98",
    highlight: "#fffaf0",
    accent: "#d8cdb8",
    wood: "#cfe0bd",
    park: "#bcd8a8",
    landuse: "#e9e0cf",
    water: "#8dc2e0",
    river: "#4c9fd0",
    roads: "#cdc2ad",
    buildings: "#d4c9b6",
    text: "#2a2f36",
    halo: "#f8f3e8",
    riverText: "#2f7ba8",
    roadText: "#7a7466",
    ramp: [[250, 190, 80], [235, 110, 50], [176, 30, 80]],
    transit: {
      metro: [28, 110, 190],
      cable: [136, 66, 200],
      tram: [20, 150, 100],
      bike_share: [214, 140, 20],
    },
  },
};

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("b-fork-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* sin almacenamiento: se usa la preferencia del sistema */
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function rampColor(theme: Theme, t: number, alpha = 235): [number, number, number, number] {
  const stops = PALETTE[theme].ramp;
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  const mix = (k: number) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f);
  return [mix(0), mix(1), mix(2), alpha];
}

export function hexToRgb(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
