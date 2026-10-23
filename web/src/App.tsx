import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ColumnLayer, ScatterplotLayer } from "deck.gl";
import { applyTheme, buildStyle } from "./mapStyle";
import { fakeEventsFor, ZONES_BY_LEVEL, type ZoneCell } from "./fakeData";
import { loadTransport, MODE_LABEL, type Mode, type Station, type TransportData } from "./transport";
import { hexToRgb, initialTheme, PALETTE, rampColor, type Theme } from "./theme";
import {
  IS_MOBILE,
  LEVELS,
  MAX_DATA_LAYERS,
  ROTATION_RANGE,
  SHOW_EVENTS,
  TERRAIN_EXAGGERATION,
  VALLE_BOUNDS,
  type Level,
} from "./config";

type LayerId = "events" | "transit";
const LAYER_LABEL: Record<LayerId, string> = { events: "Eventos", transit: "Transporte" };
const LAYER_IDS: LayerId[] = SHOW_EVENTS ? ["events", "transit"] : ["transit"];

// Escala de las barras de estaciones (la de Explorar es la de referencia; Zona usa la misma).
// Ciudad no usa barras: dibuja marcadores planos.
const STATION_HEIGHT: Record<Mode, number[]> = {
  metro: [0, 90, 90],
  cable: [0, 90, 90],
  tram: [0, 90, 90],
  bike_share: [0, 40, 40],
};
const STATION_RADIUS = [0, 38, 38];

// Cada vista decide qué gestos se permiten. Se llama al llegar a la vista.
function configureCamera(map: maplibregl.Map, lv: Level): void {
  const [zMin, zMax] = lv.zoomRange ?? [lv.zoom, lv.zoom];
  map.setMinZoom(zMin);
  map.setMaxZoom(zMax);
  if (lv.mode === "top") {
    map.setMinPitch(lv.pitch);
    map.setMaxPitch(lv.pitch);
  } else {
    map.setMinPitch(lv.mode === "free" ? 0 : 25);
    map.setMaxPitch(lv.mode === "free" ? 70 : 50);
  }
  const rotates = lv.mode !== "top";
  const tilts = lv.mode !== "top";
  const zooms = lv.zoomRange !== undefined;
  rotates ? map.dragRotate.enable() : map.dragRotate.disable();
  rotates ? map.touchZoomRotate.enableRotation() : map.touchZoomRotate.disableRotation();
  tilts ? map.touchPitch.enable() : map.touchPitch.disable();
  zooms ? map.scrollZoom.enable() : map.scrollZoom.disable();
  zooms ? map.doubleClickZoom.enable() : map.doubleClickZoom.disable();
}

// Los edificios son bloques genéricos; en la vista cenital 2D quedan planos (escala 0).
function applyBuildingScale(map: maplibregl.Map, scale: number): void {
  map.setPaintProperty("buildings", "fill-extrusion-height", [
    "*",
    scale,
    ["min", ["max", ["to-number", ["get", "render_height"], 6], 6], 45],
  ]);
}

// Durante el vuelo entre vistas se sueltan los límites para que la cámara pueda recorrer el camino.
function relaxCamera(map: maplibregl.Map): void {
  map.setMinZoom(2);
  map.setMaxZoom(22);
  map.setMinPitch(0);
  map.setMaxPitch(85);
}

export function App() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const levelRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState(0);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [active, setActive] = useState<LayerId[]>(["transit"]);
  const [selected, setSelected] = useState<ZoneCell | null>(null);
  const [transport, setTransport] = useState<TransportData | null>(null);
  const [transportError, setTransportError] = useState(false);
  const [terrainTick, setTerrainTick] = useState(0);
  const terrainSig = useRef("");

  useEffect(() => {
    loadTransport().then(setTransport).catch(() => setTransportError(true));
  }, []);

  const goLevel = (next: number, center?: [number, number]) => {
    const map = mapRef.current;
    if (!map) return;
    const lv = LEVELS[next];
    setLevel(next);
    levelRef.current = next;
    relaxCamera(map);
    map.setVerticalFieldOfView(lv.fov);
    applyBuildingScale(map, lv.buildingScale);
    map.once("moveend", () => configureCamera(map, lv));
    map.flyTo({
      center: center ?? lv.center,
      zoom: lv.zoom,
      pitch: lv.pitch,
      bearing: lv.bearing,
      duration: 1400,
      essential: true,
    });
  };

  useEffect(() => {
    const first = LEVELS[0];
    const map = new maplibregl.Map({
      container: container.current!,
      style: buildStyle(theme),
      center: first.center,
      zoom: first.zoom,
      pitch: first.pitch,
      bearing: first.bearing,
      maxPitch: 85,
      maxBounds: [
        [VALLE_BOUNDS[0][0] - 0.05, VALLE_BOUNDS[0][1] - 0.05],
        [VALLE_BOUNDS[1][0] + 0.05, VALLE_BOUNDS[1][1] + 0.05],
      ],
      attributionControl: { compact: true },
    });
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);
    map.on("load", () => {
      map.setVerticalFieldOfView(first.fov);
      applyBuildingScale(map, first.buildingScale);
      configureCamera(map, first);
      setReady(true);
    });
    // En la vista Zona la rotación se limita a ±ROTATION_RANGE° de su orientación base.
    map.on("rotate", () => {
      const lv = LEVELS[levelRef.current];
      if (lv.mode !== "limited") return;
      const b = map.getBearing();
      const min = lv.bearing - ROTATION_RANGE;
      const max = lv.bearing + ROTATION_RANGE;
      if (b < min || b > max) map.setBearing(Math.min(Math.max(b, min), max));
    });
    mapRef.current = map;
    overlayRef.current = overlay;
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map;
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Relieve suave en Zona y Explorar; la vista Ciudad es un mapa plano (2D).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setTerrain(
      LEVELS[level].terrain ? { source: "dem-terrain", exaggeration: TERRAIN_EXAGGERATION } : null,
    );
  }, [ready, level]);

  // Tema claro/oscuro: colores del mapa, de las columnas y de la interfaz.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("b-fork-theme", theme);
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
    const map = mapRef.current;
    if (map && ready) applyTheme(map, theme);
  }, [theme, ready]);

  // Las columnas se apoyan en el relieve: sin altura propia quedan bajo el terreno y "nadan"
  // al mover la cámara. Se vuelve a medir cuando terminan de cargar teselas de elevación.
  const zAt = (lng: number, lat: number): number =>
    mapRef.current?.queryTerrainElevation({ lng, lat }) ?? 0;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const probes = [LEVELS[0].center, ...(transport?.stations.slice(0, 12).map((s) => s.position) ?? [])];
    const onIdle = () => {
      const sig = probes
        .map(([lng, lat]) => Math.round((map.queryTerrainElevation({ lng, lat }) ?? 0) / 5))
        .join(",");
      if (sig !== terrainSig.current) {
        terrainSig.current = sig;
        setTerrainTick((t) => t + 1);
      }
    };
    map.on("idle", onIdle);
    onIdle();
    return () => void map.off("idle", onIdle);
  }, [ready, transport]);

  const zones = ZONES_BY_LEVEL[level];
  const maxValue = useMemo(() => Math.max(...zones.map((z) => z.value)), [zones]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const lv = LEVELS[level];
    const colors = PALETTE[theme].transit;
    const layers = active.flatMap(
      (id): Array<ColumnLayer<Station> | ColumnLayer<ZoneCell> | ScatterplotLayer<Station>> => {
      if (id === "transit") {
        const stations = transport?.stations ?? [];
        if (!lv.terrain) {
          // Vista cenital 2D: marcadores planos con contorno, como en un mapa de calles.
          const marker = (suffix: string, data: Station[], px: number) =>
            new ScatterplotLayer<Station>({
              id: `${id}-flat-${suffix}`,
              data,
              getPosition: (s) => s.position,
              getFillColor: (s) => [...colors[s.mode], 255],
              getLineColor: hexToRgb(PALETTE[theme].halo),
              updateTriggers: { getFillColor: [theme], getLineColor: [theme] },
              radiusUnits: "pixels",
              getRadius: px,
              stroked: true,
              lineWidthUnits: "pixels",
              getLineWidth: 1.5,
              pickable: true,
            });
          return [
            marker("rail", stations.filter((s) => s.mode !== "bike_share"), IS_MOBILE ? 7 : 8),
            marker("bike", stations.filter((s) => s.mode === "bike_share"), IS_MOBILE ? 4.5 : 5),
          ];
        }
        const stationLayer = (suffix: string, data: Station[], radius: number) =>
          new ColumnLayer<Station>({
            id: `${id}-${suffix}`,
            data,
            getPosition: (s) => [s.position[0], s.position[1], zAt(s.position[0], s.position[1])],
            updateTriggers: { getPosition: [terrainTick], getFillColor: [theme] },
            getElevation: (s) => STATION_HEIGHT[s.mode][level],
            getFillColor: (s) => [...colors[s.mode], 255],
            diskResolution: 8,
            radius,
            extruded: true,
            pickable: true,
            material: { ambient: 0.6, diffuse: 0.6, shininess: 20 },
          });
        return [
          stationLayer("rail", stations.filter((s) => s.mode !== "bike_share"), STATION_RADIUS[level]),
          stationLayer("bike", stations.filter((s) => s.mode === "bike_share"), STATION_RADIUS[level] * 0.6),
        ];
      }
      return [new ColumnLayer<ZoneCell>({
        id: `events-${level}`,
        data: zones,
        getPosition: (z) => [z.position[0], z.position[1], zAt(z.position[0], z.position[1])],
        updateTriggers: { getPosition: [terrainTick], getFillColor: [theme, level] },
        getElevation: (z) => 60 + (z.value / maxValue) * lv.maxHeight,
        getFillColor: (z) => rampColor(theme, Math.sqrt(z.value / maxValue), lv.alpha),
        diskResolution: 6,
        radius: lv.hexRadius * lv.fill,
        extruded: true,
        pickable: true,
        material: { ambient: 0.6, diffuse: 0.7, shininess: 16 },
      })];
      },
    );
    overlay.setProps({
      layers,
      getTooltip: ({ object }: { object?: unknown }) => {
        if (!object) return null;
        if ("mode" in (object as object)) {
          const s = object as Station;
          return `${s.name ?? "Sin nombre"} · ${MODE_LABEL[s.mode]}`;
        }
        return `${(object as ZoneCell).value} eventos esta semana (ficticio)`;
      },
      onClick: ({ object }: { object?: unknown }) => {
        if (!SHOW_EVENTS || !object || "mode" in (object as object)) return;
        setSelected(object as ZoneCell);
      },
    });
  }, [active, level, theme, transport, ready, terrainTick, zones, maxValue]);

  const toggle = (id: LayerId) =>
    setActive((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      return [...cur, id].slice(-MAX_DATA_LAYERS);
    });

  const events = selected ? fakeEventsFor(selected) : [];
  const ramp = PALETTE[theme].ramp;

  return (
    <div className="app">
      <div ref={container} className="map" />
      <header className="bar">
        <strong>b-fork</strong>
        <span className="tag">prototipo</span>
        <button
          className="icon"
          aria-label="Cambiar tema"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <nav className="levels" aria-label="Vista">
        {LEVELS.map((l, i) => (
          <button key={l.name} className={i === level ? "on" : ""} onClick={() => goLevel(i)}>
            {l.name}
          </button>
        ))}
      </nav>

      <nav className="controls">
        {LAYER_IDS.map((id) => (
          <button key={id} className={active.includes(id) ? "on" : ""} onClick={() => toggle(id)}>
            {LAYER_LABEL[id]}
          </button>
        ))}
      </nav>

      <aside className="legend">
        {SHOW_EVENTS && active.includes("events") && (
          <div className="scale">
            <span>Menos eventos</span>
            <i
              className="grad"
              style={{ background: `linear-gradient(90deg, ${ramp.map((c) => `rgb(${c.join(",")})`).join(",")})` }}
            />
            <span>Más</span>
          </div>
        )}
        {LEVELS[level].terrain && <div><i className="sw bld" /> Edificios genéricos — ilustrativo</div>}
        {active.includes("transit") &&
          (Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <div key={m}>
              <i className="sw" style={{ background: `rgb(${PALETTE[theme].transit[m].join(",")})` }} />{" "}
              {MODE_LABEL[m]}
            </div>
          ))}
        {active.includes("transit") && transportError && <div>No se pudo cargar el transporte</div>}
        {active.includes("transit") && transport && (
          <div className="attr">
            {transport.attribution}
            {transport.osmBaseTimestamp && ` · datos al ${transport.osmBaseTimestamp.slice(0, 10)}`}
          </div>
        )}
      </aside>

      {SHOW_EVENTS && selected && (
        <section className="card" aria-label="Eventos de la zona">
          <button className="close" aria-label="Cerrar" onClick={() => setSelected(null)}>
            ×
          </button>
          <h2>{selected.value} eventos esta semana</h2>
          <p className="muted">Zona hexagonal · datos ficticios</p>
          <ul>
            {events.map((e, i) => (
              <li key={i}>
                <strong>{e.title}</strong>
                <span>
                  {e.category} · {e.when}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
