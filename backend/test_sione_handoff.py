"""Phase 5 regression: the cross-worker Sione rebuild must keep the rich carried
storm (type/movement/seas/issued_utc) and only fill gaps from the thinner DB row.
(_load_storm_object is mocked — no DB / network.)"""
import asyncio

import routes.sione as sione


# ── _merge_storm (pure) ─────────────────────────────────────────────────────────

def test_merge_prefers_primary_fills_from_secondary():
    primary   = {"id": "np-1", "type": "HURRICANE", "movement": {"direction": "NE"},
                 "lat": 40, "region_impacts": None}
    secondary = {"id": "np-1", "type": "LOW", "lat": 41,
                 "region_impacts": [{"x": 1}], "peak_period_s": 16}
    m = sione._merge_storm(primary, secondary)
    assert m["type"] == "HURRICANE"           # primary non-null wins
    assert m["lat"] == 40                       # primary wins
    assert m["region_impacts"] == [{"x": 1}]    # primary None → filled from secondary
    assert m["peak_period_s"] == 16             # secondary-only field carried over


def test_merge_handles_none_sides():
    assert sione._merge_storm(None, {"a": 1}) == {"a": 1}
    assert sione._merge_storm({"a": 1}, None) == {"a": 1}
    assert sione._merge_storm(None, None) is None


# ── _rebuild_storm_session (the finding #1 regression) ──────────────────────────

def test_rebuild_prefers_carried_rich_storm_over_thin_db(monkeypatch):
    # Thin DB-resolved object — what _coerce_storm_obj yields from a derived_storms
    # row: no type / movement / sea_height_ft / issued_utc, but has region_impacts.
    thin = {
        "id": "np-1", "name": "Low · North Pacific", "lat": 45.0, "lon": -150.0,
        "pressure_mb": 982, "wind_kts": 55, "ocean": "north-pacific",
        "region_impacts": [{"region_id": "so-cal"}], "peak_period_s": 16.0,
    }
    async def fake_load(storm_id):
        return thin
    monkeypatch.setattr(sione, "_load_storm_object", fake_load)

    # Rich carried client storm (full /active object shape the card showed).
    carried = {
        "id": "np-1", "type": "HURRICANE", "name": "Hurricane · North Pacific",
        "lat": 45.0, "lon": -150.0, "pressure_mb": 982, "wind_kts": 55,
        "sea_height_ft": 24, "movement": {"direction": "NE", "speed_kts": 15},
        "issued_utc": "2026-05-21T12:00:00Z", "ocean": "north-pacific",
    }
    ctx = {"session_id": "s1", "storm_id": "np-1", "storm": carried, "arrivals": []}

    sess = asyncio.run(sione._rebuild_storm_session(ctx, None))
    assert sess is not None
    storm = sess["storm"]

    # Carried's rich fields survive (these would be lost if the DB row won).
    assert storm["type"] == "HURRICANE"
    assert storm["movement"]["direction"] == "NE"
    assert storm["sea_height_ft"] == 24
    assert storm["issued_utc"] == "2026-05-21T12:00:00Z"
    # DB-only field still filled in.
    assert storm["region_impacts"] == [{"region_id": "so-cal"}]
    assert storm["peak_period_s"] == 16.0

    # And the assembled system prompt actually carries that rich context.
    spo = sess["system_prompt_override"]
    assert "Type: Hurricane" in spo
    assert "Seas: 24 ft" in spo
    assert "NE at 15" in spo


def test_rebuild_deeplink_uses_db_when_no_carried(monkeypatch):
    resolved = {"id": "np-2", "name": "Low · NP", "lat": 50.0, "lon": -140.0,
                "pressure_mb": 990, "wind_kts": 40, "ocean": "north-pacific"}
    async def fake_load(storm_id):
        return resolved
    monkeypatch.setattr(sione, "_load_storm_object", fake_load)

    sess = asyncio.run(sione._rebuild_storm_session({"session_id": "s2", "storm_id": "np-2"}, None))
    assert sess is not None and sess["storm"]["id"] == "np-2"


def test_rebuild_returns_none_when_nothing_resolves(monkeypatch):
    async def fake_load(storm_id):
        return None
    monkeypatch.setattr(sione, "_load_storm_object", fake_load)
    assert asyncio.run(sione._rebuild_storm_session({"storm_id": "x"}, None)) is None


# ── generate_storm_trip_opener: structured briefing (vitals + regions + prompts) ──
from sione.openers.storm_trip import generate_storm_trip_opener


def test_opener_structured_briefing():
    storm = {"type": "LOW", "ocean": "south-pacific", "lat": -62, "pressure_mb": 955,
             "wind_kts": 55, "movement": {"direction": "ESE", "speed_kts": 25},
             "sea_height_ft": 24, "fetch": {"peak_radius_nm": 300, "peak_quadrant": "NE"},
             "region_timeline": [{"region": "Hawaii S Shore", "peak_hours": 163,
                                  "size_ft": 4, "period_s": 15}]}
    msg = generate_storm_trip_opener(storm, {"favorite_slugs": ["x"]}, [])
    assert "Southern Ocean off Antarctica" in msg
    assert "955 mb" in msg and "55 kt" in msg and "ESE at 25 kt" in msg and "24 ft" in msg
    assert "300 nm fetch to the NE" in msg
    assert "Hawaii S Shore" in msg
    assert "What else would you like to know" in msg


def test_opener_basin_grammar():
    msg = generate_storm_trip_opener(
        {"type": "LOW", "ocean": "north-pacific", "lat": 45, "wind_kts": 40,
         "movement": {"direction": "NE"}}, None, [])
    assert "in the North Pacific" in msg
    assert "system the" not in msg          # no missing preposition


def test_opener_minimal_no_data():
    msg = generate_storm_trip_opener({"type": "LOW"}, None, [])
    assert "tracking" in msg and "What else" in msg     # no crash on sparse data
