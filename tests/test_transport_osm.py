"""Tests de la conversión de respuestas de OpenStreetMap en estaciones."""
from __future__ import annotations

import json
import unittest
from dataclasses import FrozenInstanceError, fields
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from src.errors import FetchError, SourceFailure
from src.transport_osm import (MUNICIPALITIES, ParseResult, Snapshot,
                               TransportStation, build_snapshot, collect_snapshot,
                               parse_stations, to_geojson)


FIXTURE = Path(__file__).parent / "fixtures" / "overpass_stations.json"


def node(osm_id, tags=None, lat=6.23, lon=-75.59):
    return {"type": "node", "id": osm_id, "lat": lat, "lon": lon, "tags": tags or {}}


def response(*elements):
    return {"elements": list(elements)}


def station_by_identity(result, identity):
    for station in result.stations:
        if station.identity == identity:
            return station
    return None


class TestParseStationsModes(unittest.TestCase):
    def test_s1_railway_station_is_metro(self):
        raw = response(node(1, {"railway": "station", "name": "Acevedo"}, 6.2300, -75.5900))
        result = parse_stations(raw)
        self.assertEqual(len(result.stations), 1)
        station = station_by_identity(result, "node/1")
        self.assertEqual(station.mode, "metro")
        self.assertEqual(station.name, "Acevedo")


    def test_s2_metrocable_station_is_cable_with_its_network(self):
        raw = response(node(2, {"aerialway": "station", "network": "Metrocable",
                                "name": "Santo Domingo"}))
        station = station_by_identity(parse_stations(raw), "node/2")
        self.assertEqual(station.mode, "cable")
        self.assertEqual(station.network, "Metrocable")

    def test_s3_teleferico_is_cable_distinguished_by_network(self):
        raw = response(node(3, {"aerialway": "station", "name": "Palmitas",
                                "network": "Teleferico de Palmitas"}))
        station = station_by_identity(parse_stations(raw), "node/3")
        self.assertEqual(station.mode, "cable")
        self.assertEqual(station.network, "Teleferico de Palmitas")

    def test_s4_tram_stop_is_tram(self):
        raw = response(node(4, {"railway": "tram_stop", "name": "San Antonio"}))
        self.assertEqual(station_by_identity(parse_stations(raw), "node/4").mode, "tram")

    def test_s5_encicla_station_is_bike_share(self):
        raw = response(node(5, {"amenity": "bicycle_rental", "network": "EnCicla",
                                "name": "Parque Lleras"}))
        self.assertEqual(station_by_identity(parse_stations(raw), "node/5").mode, "bike_share")


class TestParseStationsGeometry(unittest.TestCase):
    def test_s6_node_keeps_own_coordinates_rounded_to_6_decimals(self):
        raw = response(node(6, {"railway": "station"}, 6.2442031999, -75.5812119999))
        station = station_by_identity(parse_stations(raw), "node/6")
        self.assertEqual((station.lat, station.lon), (6.244203, -75.581212))

    def test_s7_way_is_reduced_to_the_center_given_by_the_source(self):
        way = {"type": "way", "id": 7, "tags": {"railway": "station"},
               "center": {"lat": 6.25, "lon": -75.57}}
        station = station_by_identity(parse_stations(response(way)), "way/7")
        self.assertEqual((station.lat, station.lon), (6.25, -75.57))

    def test_s8_relation_is_reduced_to_the_center_given_by_the_source(self):
        relation = {"type": "relation", "id": 8, "center": {"lat": 6.24, "lon": -75.56},
                    "tags": {"railway": "tram_stop", "public_transport": "station"}}
        station = station_by_identity(parse_stations(response(relation)), "relation/8")
        self.assertEqual(station.mode, "tram")
        self.assertEqual((station.lat, station.lon), (6.24, -75.56))

    def test_s9_element_without_coordinates_or_center_is_discarded(self):
        no_geometry = {"type": "way", "id": 9, "tags": {"railway": "station"}}
        valid = node(10, {"railway": "station"})
        result = parse_stations(response(no_geometry, valid))
        self.assertIsNone(station_by_identity(result, "way/9"))
        self.assertIsNotNone(station_by_identity(result, "node/10"))
        self.assertEqual(result.skipped["no_geometry"], 1)


class TestParseStationsNames(unittest.TestCase):
    def test_s10_element_without_name_is_kept_with_empty_name_and_counted(self):
        result = parse_stations(response(node(13, {"railway": "station"})))
        station = station_by_identity(result, "node/13")
        self.assertIsNotNone(station)
        self.assertIsNone(station.name)
        self.assertEqual(result.unnamed, 1)


class TestParseStationsClassification(unittest.TestCase):
    def test_s11_without_operator_or_network_mode_comes_from_the_mode_tag(self):
        raw = response(node(16, {"railway": "station", "name": "Sin Operador"}),
                       node(17, {"railway": "tram_stop", "name": "Tranvia sin operador"}))
        result = parse_stations(raw)
        for identity, mode in (("node/16", "metro"), ("node/17", "tram")):
            station = station_by_identity(result, identity)
            self.assertEqual(station.mode, mode)
            self.assertIsNone(station.network)
            self.assertIsNone(station.operator)

    def test_s13_bicycle_rental_that_is_not_encicla_is_discarded(self):
        raw = response(
            node(20, {"amenity": "bicycle_rental", "network": "Bicis Privadas"}),
            node(21, {"amenity": "bicycle_rental"}),
            node(22, {"railway": "station"}),
        )
        result = parse_stations(raw)
        self.assertIsNone(station_by_identity(result, "node/20"))
        self.assertIsNone(station_by_identity(result, "node/21"))
        self.assertEqual(result.skipped["not_encicla"], 2)

    def test_s12_encicla_is_recognized_ignoring_case_and_accents(self):
        cases = (("network", "ENCICLA"), ("network", "encicla"),
                 ("operator", "EnCicla"), ("operator", "Enciclá"))
        for tag, value in cases:
            with self.subTest(tag=tag, value=value):
                raw = response(node(18, {"amenity": "bicycle_rental", tag: value}))
                station = station_by_identity(parse_stations(raw), "node/18")
                self.assertIsNotNone(station)
                self.assertEqual(station.mode, "bike_share")

    def test_s14_element_without_a_recognized_mode_tag_is_discarded(self):
        raw = response(
            node(23, {"name": "Cafe", "shop": "coffee"}),
            {"type": "node", "id": 24, "lat": 6.2, "lon": -75.5},
            node(25, {"disused:railway": "station"}),
            node(26, {"railway": "station"}),
        )
        result = parse_stations(raw)
        self.assertEqual([s.identity for s in result.stations], ["node/26"])
        self.assertEqual(result.skipped["no_mode"], 3)

    def test_s15_only_the_minimum_fields_are_kept(self):
        tags = {"railway": "station", "name": "A", "network": "N", "operator": "O",
                "ref": "A12", "website": "http://x", "phone": "1", "opening_hours": "24/7",
                "capacity": "20"}
        station = station_by_identity(parse_stations(response(node(30, tags))), "node/30")
        names = {field.name for field in fields(station)}
        self.assertEqual(names, {"osm_type", "osm_id", "mode", "name", "network",
                                 "operator", "ref", "lon", "lat"})
        self.assertEqual(station.ref, "A12")


class TestParseStationsIdentity(unittest.TestCase):
    def test_s16_same_element_repeated_is_kept_once(self):
        element = node(31, {"railway": "station"})
        result = parse_stations(response(element, dict(element)))
        identities = [station.identity for station in result.stations]
        self.assertEqual(identities.count("node/31"), 1)

    def test_s17_polygon_and_node_of_same_station_are_both_kept(self):
        way = {"type": "way", "id": 34, "tags": {"railway": "station", "name": "Poblado"},
               "center": {"lat": 6.2100, "lon": -75.5700}}
        stop = node(35, {"railway": "station", "name": "Poblado"}, 6.2101, -75.5701)
        result = parse_stations(response(way, stop))
        self.assertEqual([s.identity for s in result.stations], ["way/34", "node/35"])


class TestParseStationsReport(unittest.TestCase):
    def test_s18_result_reports_discards_per_reason(self):
        raw = response(
            {"type": "way", "id": 1, "tags": {"railway": "station"}},
            node(2, {"shop": "coffee"}),
            node(3, {"amenity": "bicycle_rental", "network": "Otra"}),
            node(36, {"railway": "station"}),
        )
        result = parse_stations(raw)
        self.assertEqual(result.skipped, {"no_geometry": 1, "no_mode": 1, "not_encicla": 1})


def distinct_stations(count):
    return response(*(node(i, {"railway": "station"}) for i in range(1, count + 1)))


def fixed_clock():
    return datetime(2026, 10, 15, 12, 0, tzinfo=ZoneInfo("America/Bogota"))


class TestBuildSnapshotThreshold(unittest.TestCase):
    def test_s19_empty_elements_raise_source_failure_with_default_threshold(self):
        with self.assertRaises(SourceFailure):
            build_snapshot(response(), fixed_clock)

    def test_s20_default_threshold_rejects_79_valid_stations(self):
        with self.assertRaises(SourceFailure):
            build_snapshot(distinct_stations(79), fixed_clock)

    def test_s21_default_threshold_accepts_80_valid_stations(self):
        snapshot = build_snapshot(distinct_stations(80), fixed_clock)
        self.assertEqual(len(snapshot.stations), 80)

    def test_s22_threshold_is_configurable(self):
        with self.assertRaises(SourceFailure):
            build_snapshot(distinct_stations(2), fixed_clock, min_stations=3)


class TestBuildSnapshotMalformed(unittest.TestCase):
    def test_s23_malformed_response_raises_source_failure(self):
        station = node(1, {"railway": "station"})
        cases = {
            "not an object": [station],
            "no elements key": {"version": 0.6},
            "elements not a list": {"elements": "none"},
            "remark": {"elements": [station], "remark": "runtime error: timed out"},
        }
        for label, raw in cases.items():
            with self.subTest(label):
                with self.assertRaises(SourceFailure):
                    build_snapshot(raw, fixed_clock, min_stations=1)


USER_AGENT = "b-fork/0.1 (+https://github.com/tlon-lab/b-fork)"


class FakeFetch:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    def __call__(self, query, user_agent):
        self.calls.append((query, user_agent))
        if self.error is not None:
            raise self.error
        return self.response


def collect(fetch, **options):
    options.setdefault("min_stations", 1)
    options.setdefault("sleep", lambda seconds: None)
    return collect_snapshot(fetch, fixed_clock, USER_AGENT, **options)


class TestCollectSnapshot(unittest.TestCase):
    def test_s24_http_error_raises_source_failure_after_a_single_retry(self):
        fetch = FakeFetch(error=FetchError(429))
        waits = []
        with self.assertRaises(SourceFailure):
            collect(fetch, sleep=waits.append)
        self.assertEqual(len(fetch.calls), 2)
        self.assertEqual(waits, [5])

    def test_s29_request_carries_an_identifiable_user_agent_without_email(self):
        fetch = FakeFetch(response=distinct_stations(1))
        collect(fetch)
        self.assertEqual(fetch.calls[0][1], USER_AGENT)
        self.assertNotIn("@", fetch.calls[0][1])

    def test_retry_waits_before_the_second_request_and_can_succeed(self):
        outcomes = [FetchError(503), distinct_stations(1)]
        waits = []

        def flaky_fetch(query, user_agent):
            outcome = outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        snapshot = collect_snapshot(flaky_fetch, fixed_clock, USER_AGENT, min_stations=1,
                                    sleep=waits.append)
        self.assertEqual(len(snapshot.stations), 1)
        self.assertEqual(waits, [5])

    def test_s30_query_covers_the_union_of_the_ten_municipalities(self):
        municipalities = ("Medellín", "Bello", "Itagüí", "Envigado", "Sabaneta",
                          "La Estrella", "Caldas", "Copacabana", "Girardota", "Barbosa")
        fetch = FakeFetch(response=distinct_stations(1))
        collect(fetch, municipalities=municipalities)
        query = fetch.calls[0][0]
        for municipality in municipalities:
            self.assertIn(f'"name"="{municipality}"', query)
        self.assertIn('"admin_level"="6"', query)
        self.assertIn("out center;", query)

    def test_query_declares_the_decided_timeout_of_ninety_seconds(self):
        fetch = FakeFetch(response=distinct_stations(1))
        collect(fetch)
        self.assertIn("[timeout:90]", fetch.calls[0][0])

    def test_default_municipalities_are_the_ten_of_the_valle_de_aburra(self):
        self.assertEqual(len(MUNICIPALITIES), 10)
        self.assertIn("Medellín", MUNICIPALITIES)


class TestSnapshotMetadata(unittest.TestCase):
    def test_s27_snapshot_records_osm_base_date_and_generation_date(self):
        raw = distinct_stations(1)
        raw["osm3s"] = {"timestamp_osm_base": "2026-10-01T00:00:00Z"}
        snapshot = build_snapshot(raw, fixed_clock, min_stations=1)
        self.assertEqual(snapshot.osm_base_timestamp, "2026-10-01T00:00:00Z")
        self.assertEqual(snapshot.generated_at, "2026-10-15T12:00:00-05:00")


class TestGeoJsonExport(unittest.TestCase):
    def test_s25_top_level_carries_the_odbl_attribution(self):
        snapshot = build_snapshot(distinct_stations(1), fixed_clock, min_stations=1)
        geojson = to_geojson(snapshot)
        self.assertEqual(geojson["attribution"], "© OpenStreetMap contributors, ODbL 1.0")
        self.assertIn("opendatacommons.org/licenses/odbl", geojson["license_url"])
        self.assertEqual(geojson["type"], "FeatureCollection")

    def test_s26_each_station_is_a_point_with_lon_lat_and_its_properties(self):
        raw = response(node(37, {"railway": "station", "name": "Niquia"}, 6.33, -75.54))
        geojson = to_geojson(build_snapshot(raw, fixed_clock, min_stations=1))
        feature = geojson["features"][0]
        self.assertEqual(feature["id"], "node/37")
        self.assertEqual(feature["geometry"], {"type": "Point", "coordinates": [-75.54, 6.33]})
        self.assertEqual(feature["properties"]["mode"], "metro")
        self.assertEqual(feature["properties"]["name"], "Niquia")

    def test_s28_same_input_produces_byte_identical_geojson(self):
        exports = [
            json.dumps(to_geojson(build_snapshot(distinct_stations(5), fixed_clock,
                                                 min_stations=1)), ensure_ascii=False)
            for _ in range(2)
        ]
        self.assertEqual(exports[0], exports[1])

    def test_geojson_top_level_carries_both_dates(self):
        raw = distinct_stations(1)
        raw["osm3s"] = {"timestamp_osm_base": "2026-10-01T00:00:00Z"}
        geojson = to_geojson(build_snapshot(raw, fixed_clock, min_stations=1))
        self.assertEqual(geojson["osm_base_timestamp"], "2026-10-01T00:00:00Z")
        self.assertEqual(geojson["generated_at"], "2026-10-15T12:00:00-05:00")


class TestOverpassFixture(unittest.TestCase):
    def test_fixture_goes_through_the_whole_source_without_network(self):
        raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
        snapshot = collect(FakeFetch(response=raw))
        modes = sorted(station.mode for station in snapshot.stations)
        self.assertEqual(modes, ["bike_share", "cable", "cable", "metro", "metro", "tram", "tram"])
        self.assertEqual(snapshot.osm_base_timestamp, "2026-10-01T00:00:00Z")
        result = parse_stations(raw)
        self.assertEqual(result.skipped, {"no_geometry": 1, "not_encicla": 1})
        self.assertEqual(result.unnamed, 1)


class TestImmutability(unittest.TestCase):
    def test_transport_station_is_frozen(self):
        station = parse_stations(response(node(1, {"railway": "station"}))).stations[0]
        self.assertIsInstance(station, TransportStation)
        with self.assertRaises(FrozenInstanceError):
            station.name = "otro"

    def test_parse_result_is_frozen(self):
        result = parse_stations(response())
        self.assertIsInstance(result, ParseResult)
        with self.assertRaises(FrozenInstanceError):
            result.unnamed = 1

    def test_snapshot_is_frozen(self):
        snapshot = build_snapshot(distinct_stations(80), fixed_clock)
        self.assertIsInstance(snapshot, Snapshot)
        with self.assertRaises(FrozenInstanceError):
            snapshot.generated_at = "otro"


if __name__ == "__main__":
    unittest.main()

    def test_s3_teleferico_is_cable_distinguished_by_network(self):
        raw = response(node(3, {"aerialway": "station", "name": "Palmitas",
                                "network": "Teleferico de Palmitas"}))
        station = station_by_identity(parse_stations(raw), "node/3")
        self.assertEqual(station.mode, "cable")
        self.assertEqual(station.network, "Teleferico de Palmitas")

    def test_s4_tram_stop_is_tram(self):
        raw = response(node(4, {"railway": "tram_stop", "name": "San Antonio"}))
        self.assertEqual(station_by_identity(parse_stations(raw), "node/4").mode, "tram")
