"""Descarga las estaciones reales de OSM y deja el GeoJSON que lee el mapa."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.errors import FetchError, SourceFailure  # noqa: E402
from src.transport_osm import collect_snapshot, to_geojson  # noqa: E402

OVERPASS_URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
USER_AGENT = "b-fork/0.1 (+https://github.com/tlon-lab/b-fork)"
OUTPUT = ROOT / "web" / "public" / "data" / "transport.geojson"


def fetch(query: str, user_agent: str) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    request = urllib.request.Request(OVERPASS_URL, data=body, headers={"User-Agent": user_agent})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise FetchError(error.code) from error


def main() -> int:
    try:
        snapshot = collect_snapshot(fetch, lambda: datetime.now(timezone.utc), USER_AGENT)
    except SourceFailure as failure:
        sys.stderr.write(f"Fuente fallida: {failure}\n")
        return 1
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(to_geojson(snapshot), ensure_ascii=False, indent=1), encoding="utf-8"
    )
    sys.stdout.write(f"{len(snapshot.stations)} estaciones -> {OUTPUT}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
