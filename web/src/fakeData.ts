import { cellToLatLng, cellToParent, polygonToCells } from "h3-js";
import { LEVELS } from "./config";

export interface ZoneCell {
  hex: string;
  position: [number, number];
  value: number; // eventos esta semana — DATO FICTICIO
}

// Focos de actividad inventados (lng, lat, peso). No representan nada real.
const HOTSPOTS: [number, number, number][] = [
  [-75.57, 6.248, 30],
  [-75.567, 6.209, 26],
  [-75.59, 6.245, 22],
  [-75.6, 6.23, 14],
  [-75.585, 6.17, 14],
  [-75.612, 6.185, 12],
  [-75.616, 6.151, 8],
  [-75.558, 6.337, 12],
];

const AREA: [number, number][] = [
  [-75.68, 6.08],
  [-75.3, 6.08],
  [-75.3, 6.47],
  [-75.68, 6.47],
  [-75.68, 6.08],
];

// Pseudoaleatorio determinista: la misma semilla produce la misma "ciudad".
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function build(): ZoneCell[][] {
  const rand = rng(42);
  const finestRes = LEVELS[LEVELS.length - 1].h3Res;
  const fine = new Map<string, number>();
  for (const hex of polygonToCells(AREA, finestRes, true)) {
    const [lat, lng] = cellToLatLng(hex);
    let v = 0;
    for (const [hx, hy, w] of HOTSPOTS) {
      const dx = (lng - hx) * 111 * Math.cos((lat * Math.PI) / 180);
      const dy = (lat - hy) * 111;
      v += w * Math.exp(-(dx * dx + dy * dy) / (2 * 1.8 * 1.8));
    }
    // Escala creíble: unos pocos eventos por celda fina, decenas en una zona grande.
    const n = Math.round(v * 0.12 * (0.4 + rand()));
    if (n >= 1) fine.set(hex, n);
  }
  return LEVELS.map(({ h3Res }) => {
    const sums = new Map<string, number>();
    for (const [hex, n] of fine) {
      const key = h3Res === finestRes ? hex : cellToParent(hex, h3Res);
      sums.set(key, (sums.get(key) ?? 0) + n);
    }
    return [...sums].map(([hex, value]) => {
      const [lat, lng] = cellToLatLng(hex);
      return { hex, position: [lng, lat] as [number, number], value };
    });
  });
}

// Una lista de zonas por nivel (Valle, Zona, Barrio), calculada una sola vez.
export const ZONES_BY_LEVEL: ZoneCell[][] = build();

const TITLES = [
  "Concierto en el parque",
  "Feria de diseño independiente",
  "Cine al aire libre",
  "Mercado de productores",
  "Noche de jazz",
  "Taller de cerámica",
  "Recorrido en bicicleta",
  "Muestra de teatro",
];
const CATEGORIES = ["Música", "Feria", "Cine", "Mercado", "Música", "Taller", "Deporte", "Teatro"];

export interface FakeEvent {
  title: string;
  category: string;
  when: string;
}

// Tarjetas de ejemplo para la zona tocada (también ficticias; el enlace a la fuente vendrá con datos reales).
export function fakeEventsFor(zone: ZoneCell): FakeEvent[] {
  const rand = rng([...zone.hex].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  const count = Math.min(zone.value, 4);
  const today = new Date();
  return Array.from({ length: count }, () => {
    const i = Math.floor(rand() * TITLES.length);
    const day = new Date(today.getTime() + Math.floor(rand() * 7) * 86400000);
    return {
      title: TITLES[i],
      category: CATEGORIES[i],
      when: day.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" }),
    };
  });
}
