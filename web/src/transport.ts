export type Mode = "metro" | "cable" | "tram" | "bike_share";

export interface Station {
  name: string | null;
  mode: Mode;
  network: string | null;
  position: [number, number];
}

export interface TransportData {
  stations: Station[];
  attribution: string;
  osmBaseTimestamp: string | null;
}

export const MODE_LABEL: Record<Mode, string> = {
  metro: "Metro",
  cable: "Metrocable / teleférico",
  tram: "Tranvía",
  bike_share: "EnCicla",
};

interface GeoFeature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string | null; mode: Mode; network?: string | null };
}

export async function loadTransport(): Promise<TransportData> {
  const response = await fetch("/data/transport.geojson");
  if (!response.ok) throw new Error(`transport.geojson: HTTP ${response.status}`);
  const geo = await response.json();
  return {
    attribution: geo.attribution,
    osmBaseTimestamp: geo.osm_base_timestamp ?? null,
    stations: (geo.features as GeoFeature[]).map((f) => ({
      name: f.properties.name ?? null,
      mode: f.properties.mode,
      network: f.properties.network ?? null,
      position: f.geometry.coordinates,
    })),
  };
}
