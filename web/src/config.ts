export const IS_MOBILE =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 720);

export const MAX_DATA_LAYERS = IS_MOBILE ? 1 : 3;

// Las columnas de eventos se retiran por ahora: primero se cierra la capa base del mapa.
export const SHOW_EVENTS = false;

// Valores de partida de la spec ("relieve suave"): a afinar mirando.
export const TERRAIN_EXAGGERATION = 1.25;
export const ROTATION_RANGE = 45; // grados a cada lado de bearing, en la vista Zona
export const DEFAULT_FOV = 36.87; // campo de visión por defecto de MapLibre

export const CIUDAD_CENTER: [number, number] = [-75.572, 6.245];
export const ZONA_CENTER: [number, number] = [-75.572, 6.232];
export const VALLE_BOUNDS: [[number, number], [number, number]] = [
  [-75.7, 6.05],
  [-75.28, 6.5],
];

// "top": mapa cenital 2D (como Google Maps), solo se desplaza. "limited": zoom fijo, rotación e inclinación acotadas.
// "free": explorar el mapa tú mismo (zoom, rotación e inclinación libres).
export type LevelMode = "top" | "limited" | "free";

export interface Level {
  name: string;
  mode: LevelMode;
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  fov: number;
  terrain: boolean; // relieve 3D: la vista cenital 2D lo apaga
  buildingScale: number; // exageración de la altura de los edificios genéricos en esta vista
  zoomRange?: [number, number]; // si existe, el zoom es libre dentro de este rango
  // Escala de las columnas de eventos (hoy ocultas): resolución H3 y tamaño.
  h3Res: number;
  hexRadius: number;
  maxHeight: number;
  fill: number;
  alpha: number;
}

export const LEVELS: Level[] = [
  {
    name: "Ciudad",
    mode: "top",
    center: CIUDAD_CENTER,
    zoom: IS_MOBILE ? 12 : 12.8,
    pitch: 0,
    bearing: 0,
    fov: DEFAULT_FOV,
    terrain: false,
    buildingScale: 0,
    zoomRange: [11, 16.5],
    h3Res: 7, hexRadius: 1220, maxHeight: 1800, fill: 0.93, alpha: 235,
  },
  {
    name: "Zona",
    mode: "limited",
    center: ZONA_CENTER,
    zoom: IS_MOBILE ? 13.4 : 14,
    pitch: 48,
    bearing: -15,
    fov: DEFAULT_FOV,
    terrain: true,
    buildingScale: 1.4,
    h3Res: 8, hexRadius: 461, maxHeight: 380, fill: 0.84, alpha: 205,
  },
  {
    name: "Explorar",
    mode: "free",
    center: ZONA_CENTER,
    zoom: IS_MOBILE ? 14.4 : 15,
    pitch: 50,
    bearing: -15,
    fov: DEFAULT_FOV,
    terrain: true,
    buildingScale: 1,
    zoomRange: [10.5, 18],
    h3Res: 9, hexRadius: 174, maxHeight: 130, fill: 0.76, alpha: 180,
  },
];
