import type {
  ExpressionSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import { IS_MOBILE } from "./config";
import { PALETTE, type Theme } from "./theme";

// Estilo propio: la geografía real (agua, parques, relieve) es la base; los edificios son
// bloques genéricos ("ilustrativo") que ceden ante las capas de datos. Los colores salen de
// theme.ts (un solo lugar) y se aplican igual al crear el estilo y al cambiar de tema.
type PaintEntry = [layerId: string, property: string, value: string];

function themePaint(theme: Theme): PaintEntry[] {
  const p = PALETTE[theme];
  return [
    ["bg", "background-color", p.bg],
    ["hillshade", "hillshade-shadow-color", p.shadow],
    ["hillshade", "hillshade-highlight-color", p.highlight],
    ["hillshade", "hillshade-accent-color", p.accent],
    ["landcover-wood", "fill-color", p.wood],
    ["park", "fill-color", p.park],
    ["landuse-res", "fill-color", p.landuse],
    ["water", "fill-color", p.water],
    ["river", "line-color", p.river],
    ["roads", "line-color", p.roads],
    ["buildings", "fill-extrusion-color", p.buildings],
    ["label-waterway", "text-color", p.riverText],
    ["label-waterway", "text-halo-color", p.halo],
    ["label-roads", "text-color", p.roadText],
    ["label-roads", "text-halo-color", p.halo],
    ...["label-neighbourhood", "label-suburb", "label-town"].flatMap(
      (id): PaintEntry[] => [
        [id, "text-color", p.text],
        [id, "text-halo-color", p.halo],
      ],
    ),
  ];
}

export function applyTheme(map: MapLibreMap, theme: Theme): void {
  for (const [id, property, value] of themePaint(theme)) {
    if (map.getLayer(id)) map.setPaintProperty(id, property, value);
  }
}

export function buildStyle(theme: Theme): StyleSpecification {
  const layers = baseLayers();
  for (const [id, property, value] of themePaint(theme)) {
    const layer = layers.find((l) => l.id === id);
    if (layer) (layer.paint as Record<string, unknown>)[property] = value;
  }
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
      // Dos fuentes con los mismos tiles: MapLibre recomienda separar sombreado y terreno 3D.
      "dem-terrain": {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        encoding: "terrarium",
        maxzoom: IS_MOBILE ? 11 : 13,
      },
      dem: {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        encoding: "terrarium",
        maxzoom: IS_MOBILE ? 11 : 13,
        attribution: "Terrain: Mapzen/AWS Terrain Tiles",
      },
    },
    layers,
  };
}

function baseLayers(): LayerSpecification[] {
  return [
    { id: "bg", type: "background", paint: {} },
    { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.6 } },
    {
      id: "landcover-wood",
      type: "fill",
      source: "omt",
      "source-layer": "landcover",
      filter: ["==", "class", "wood"],
      paint: { "fill-opacity": 0.55 },
    },
    { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-opacity": 0.55 } },
    {
      id: "landuse-res",
      type: "fill",
      source: "omt",
      "source-layer": "landuse",
      filter: ["in", "class", "residential", "commercial", "retail"],
      paint: { "fill-opacity": 0.6 },
    },
    { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: {} },
    {
      id: "river",
      type: "line",
      source: "omt",
      "source-layer": "waterway",
      filter: ["in", "class", "river", "stream", "canal"],
      paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 14, 4] },
    },
    {
      id: "roads",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["in", "class", "motorway", "trunk", "primary", "secondary"],
      paint: { "line-width": 0.8, "line-opacity": 0.7 },
    },
    {
      id: "buildings",
      type: "fill-extrusion",
      source: "omt",
      "source-layer": "building",
      minzoom: 13,
      paint: {
        // Altura estilizada: se acota la real para que no compita con los datos.
        "fill-extrusion-height": ["min", ["max", ["to-number", ["get", "render_height"], 6], 6], 45],
        "fill-extrusion-opacity": 0.8,
      },
    },
    ...labelLayers(),
  ];
}

const NAME = ["coalesce", ["get", "name:es"], ["get", "name"]] as ExpressionSpecification;
const HALO_WIDTH = 1.6;

// Nombres para poder ubicarse: ciudades y barrios, el río y las vías principales.
function labelLayers(): LayerSpecification[] {
  return [
    {
      id: "label-waterway",
      type: "symbol",
      source: "omt",
      "source-layer": "waterway",
      minzoom: 11,
      filter: ["==", "class", "river"],
      layout: { "text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 12, "symbol-placement": "line" },
      paint: { "text-halo-width": HALO_WIDTH },
    },
    {
      id: "label-roads",
      type: "symbol",
      source: "omt",
      "source-layer": "transportation_name",
      minzoom: 12.5,
      filter: ["in", "class", "motorway", "trunk", "primary", "secondary"],
      layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-placement": "line" },
      paint: { "text-halo-width": HALO_WIDTH },
    },
    {
      id: "label-neighbourhood",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 13,
      filter: ["in", "class", "neighbourhood", "quarter"],
      layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 7 },
      paint: { "text-halo-width": HALO_WIDTH },
    },
    {
      id: "label-suburb",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 11.5,
      filter: ["==", "class", "suburb"],
      layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 13, "text-max-width": 7 },
      paint: { "text-halo-width": HALO_WIDTH },
    },
    {
      id: "label-town",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 8,
      filter: ["in", "class", "city", "town", "village"],
      layout: {
        "text-field": NAME,
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 12, 18],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.08,
      },
      paint: { "text-halo-width": HALO_WIDTH },
    },
  ];
}
