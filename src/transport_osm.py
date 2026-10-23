"""Conversión de respuestas de OpenStreetMap en estaciones de transporte."""
from __future__ import annotations

import time
import unicodedata
from dataclasses import asdict, dataclass
from zoneinfo import ZoneInfo

from src.errors import FetchError, SourceFailure

COORDINATE_DECIMALS = 6
DEFAULT_MIN_STATIONS = 80
RETRY_DELAY_SECONDS = 5
BOGOTA = ZoneInfo("America/Bogota")
MUNICIPALITIES = (
    "Medellín", "Bello", "Itagüí", "Envigado", "Sabaneta",
    "La Estrella", "Caldas", "Copacabana", "Girardota", "Barbosa",
)
MUNICIPALITY_ADMIN_LEVEL = 6
QUERY_TIMEOUT_SECONDS = 90
ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0"
LICENSE_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
ENCICLA = "encicla"

MODE_TAGS = (
    (("railway", "station"), "metro"),
    (("aerialway", "station"), "cable"),
    (("railway", "tram_stop"), "tram"),
    (("amenity", "bicycle_rental"), "bike_share"),
)


@dataclass(frozen=True)
class TransportStation:
    osm_type: str
    osm_id: int
    mode: str
    name: str | None
    network: str | None
    operator: str | None
    ref: str | None
    lon: float
    lat: float

    @property
    def identity(self) -> str:
        return f"{self.osm_type}/{self.osm_id}"


@dataclass(frozen=True)
class ParseResult:
    stations: tuple
    skipped: dict
    unnamed: int


def _mode_of(tags: dict) -> str | None:
    for (key, value), mode in MODE_TAGS:
        if tags.get(key) == value:
            return mode
    return None


def _point_of(element: dict) -> tuple | None:
    point = element if "lat" in element else element.get("center")
    if point is None:
        return None
    return point["lon"], point["lat"]


def _fold(text: str | None) -> str:
    decomposed = unicodedata.normalize("NFD", (text or "").casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _is_encicla(tags: dict) -> bool:
    return ENCICLA in (_fold(tags.get("network")), _fold(tags.get("operator")))


def _count(skipped: dict, reason: str) -> None:
    skipped[reason] = skipped.get(reason, 0) + 1


def _build_station(element: dict, mode: str, point: tuple) -> TransportStation:
    tags = element.get("tags", {})
    lon, lat = point
    return TransportStation(
        osm_type=element["type"],
        osm_id=element["id"],
        mode=mode,
        name=tags.get("name"),
        network=tags.get("network"),
        operator=tags.get("operator"),
        ref=tags.get("ref"),
        lon=round(lon, COORDINATE_DECIMALS),
        lat=round(lat, COORDINATE_DECIMALS),
    )


def parse_stations(raw: dict) -> ParseResult:
    stations: dict = {}
    skipped: dict = {}
    unnamed = 0
    for element in raw["elements"]:
        tags = element.get("tags", {})
        mode = _mode_of(tags)
        point = _point_of(element)
        if point is None:
            _count(skipped, "no_geometry")
        elif mode is None:
            _count(skipped, "no_mode")
        elif mode == "bike_share" and not _is_encicla(tags):
            _count(skipped, "not_encicla")
        else:
            unnamed += "name" not in tags
            station = _build_station(element, mode, point)
            stations.setdefault(station.identity, station)
    return ParseResult(stations=tuple(stations.values()), skipped=skipped, unnamed=unnamed)


@dataclass(frozen=True)
class Snapshot:
    stations: tuple
    osm_base_timestamp: str | None
    generated_at: str


def _validate_response(raw: object) -> None:
    if not isinstance(raw, dict):
        raise SourceFailure("La respuesta no es un objeto JSON")
    if not isinstance(raw.get("elements"), list):
        raise SourceFailure("La respuesta no trae una lista elements")
    if "remark" in raw:
        raise SourceFailure(f"La fuente reportó un error: {raw['remark']}")


def build_snapshot(raw: dict, clock, min_stations: int = DEFAULT_MIN_STATIONS) -> Snapshot:
    _validate_response(raw)
    result = parse_stations(raw)
    if len(result.stations) < min_stations:
        raise SourceFailure(
            f"Solo {len(result.stations)} estaciones válidas; se esperaban al menos {min_stations}"
        )
    return Snapshot(
        stations=result.stations,
        osm_base_timestamp=raw.get("osm3s", {}).get("timestamp_osm_base"),
        generated_at=clock().astimezone(BOGOTA).isoformat(),
    )


def build_query(municipalities: tuple) -> str:
    areas = "".join(
        f'area["name"="{name}"]["admin_level"="{MUNICIPALITY_ADMIN_LEVEL}"];'
        for name in municipalities
    )
    filters = "".join(f'nwr["{key}"="{value}"](area.valle);' for (key, value), _ in MODE_TAGS)
    return (
        f"[out:json][timeout:{QUERY_TIMEOUT_SECONDS}];"
        f"({areas})->.valle;({filters});out center;"
    )


def collect_snapshot(fetch, clock, user_agent: str, municipalities: tuple = MUNICIPALITIES,
                     min_stations: int = DEFAULT_MIN_STATIONS, sleep=time.sleep) -> Snapshot:
    query = build_query(municipalities)
    try:
        raw = fetch(query, user_agent)
    except FetchError:
        sleep(RETRY_DELAY_SECONDS)
        raw = _fetch_last_time(fetch, query, user_agent)
    return build_snapshot(raw, clock, min_stations)


def _fetch_last_time(fetch, query: str, user_agent: str) -> dict:
    try:
        return fetch(query, user_agent)
    except FetchError as error:
        raise SourceFailure(f"La descarga falló: {error}") from error


def _to_feature(station: TransportStation) -> dict:
    properties = asdict(station)
    del properties["lon"], properties["lat"]
    return {
        "type": "Feature",
        "id": station.identity,
        "geometry": {"type": "Point", "coordinates": [station.lon, station.lat]},
        "properties": properties,
    }


def to_geojson(snapshot: Snapshot) -> dict:
    return {
        "type": "FeatureCollection",
        "attribution": ATTRIBUTION,
        "license_url": LICENSE_URL,
        "osm_base_timestamp": snapshot.osm_base_timestamp,
        "generated_at": snapshot.generated_at,
        "features": [_to_feature(station) for station in snapshot.stations],
    }
