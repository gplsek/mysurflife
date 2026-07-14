"""
backend/test_smoke.py
=====================
Smoke tests that hit the live API at localhost:8000.

These catch production-style failures that static analysis and unit tests miss:
  - FastAPI Depends() objects leaking into internal calls (causes AttributeError)
  - External data source retirements (NOMADS OPeNDAP SCN25-81, etc.)
  - Empty/null response bodies that look like 200 success but have no data
  - Endpoint signature drift between callers

Run:
    cd backend && source venv/bin/activate
    pytest test_smoke.py -v                              # requires server running
    BASE_URL=https://mysurflife.com pytest test_smoke.py -v   # production

If the server isn't reachable the whole suite skips (instead of failing),
so a plain `pytest` run stays green without one. Start the server with:
    uvicorn main:app --host 127.0.0.1 --port 8000
"""

import os
import pytest
import httpx

BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:8000")
TIMEOUT   = 60.0  # wave overlay GRIB downloads can take 20-30s on first fetch

# Spot used for all spot-specific tests — well-mapped with real buoys
TEST_SPOT = "blacks-beach"


@pytest.fixture(scope="session")
def client():
    with httpx.Client(base_url=BASE_URL, timeout=TIMEOUT) as c:
        try:
            c.get("/openapi.json", timeout=3.0)
        except httpx.TransportError:
            pytest.skip(f"server not reachable at {BASE_URL} — start uvicorn or set BASE_URL")
        yield c


# ─── Buoy status ─────────────────────────────────────────────────────────────

def test_buoy_status_returns_data(client):
    """Basic liveness check: buoy pipeline must return at least one station."""
    r = client.get("/api/buoy-status/all")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
    data = r.json()
    assert isinstance(data, list), "Expected list of buoys"
    assert len(data) > 0, "No buoy data returned — NDBC pipeline may be down"
    first = data[0]
    assert "station" in first or "id" in first, f"Unexpected buoy shape: {first}"


def test_buoy_status_has_wave_readings(client):
    """At least one buoy should have a wave_height_m value (sanity check data flow)."""
    r = client.get("/api/buoy-status/all")
    assert r.status_code == 200
    buoys = r.json()
    readings = [b for b in buoys if b.get("wave_height_m") is not None]
    assert len(readings) > 0, (
        "No buoys have wave_height_m — either NDBC is down or parsing broke"
    )


# ─── Conditions endpoint ─────────────────────────────────────────────────────

def test_conditions_returns_200(client):
    """GET /api/surf-spots/{slug}/conditions must not 500."""
    r = client.get(f"/api/surf-spots/{TEST_SPOT}/conditions")
    assert r.status_code == 200, f"Conditions 500: {r.text[:400]}"


def test_conditions_no_depends_crash(client):
    """
    Regression: when get_surf_spot_conditions() is called internally by the
    Copilot tool, FastAPI does NOT inject Depends() — Python uses the raw
    default value. Previously this caused 'Depends object has no attribute get'.
    The fix is isinstance(user, dict) guard. This test catches that regression
    by calling the endpoint and checking the response doesn't contain the error.
    """
    r = client.get(f"/api/surf-spots/{TEST_SPOT}/conditions")
    assert r.status_code == 200
    body = r.text
    assert "has no attribute" not in body, f"AttributeError leaked into response: {body[:400]}"
    assert "'Depends'" not in body, f"Depends object leaked: {body[:400]}"


def test_conditions_has_score(client):
    """Conditions response must include a numeric score — not just an error dict."""
    r = client.get(f"/api/surf-spots/{TEST_SPOT}/conditions")
    assert r.status_code == 200
    data = r.json()
    assert "error" not in data, f"Conditions returned error: {data.get('error')}"
    assert data.get("overall_score") is not None or data.get("score") is not None, (
        f"Conditions missing score — surf_scoring pipeline may be broken. "
        f"Got keys: {list(data.keys())}"
    )


def test_conditions_has_wave_data(client):
    """Conditions response must have buoy-derived wave height."""
    r = client.get(f"/api/surf-spots/{TEST_SPOT}/conditions")
    assert r.status_code == 200
    data = r.json()
    assert data.get("wave_height_ft") is not None or data.get("wave_height_m") is not None, (
        "No wave height in conditions — buoy blend may have failed"
    )


# ─── Forecast timeline (catches NOMADS / GRIB regressions) ───────────────────

def test_forecast_timeline_returns_200(client):
    """GET /api/surf-spots/{slug}/forecast-timeline must not 500."""
    r = client.get(f"/api/surf-spots/{TEST_SPOT}/forecast-timeline?hours=24")
    assert r.status_code == 200, f"Forecast timeline 500: {r.text[:400]}"


def test_forecast_timeline_has_points(client):
    """
    Regression: NOMADS OPeNDAP retirement (SCN25-81) caused the WW3 GRIB fetch
    to fail silently, returning an empty timeline. This test catches that by
    asserting the timeline array has actual data points.
    """
    r = client.get(f"/api/surf-spots/{TEST_SPOT}/forecast-timeline?hours=24")
    assert r.status_code == 200
    data = r.json()
    timeline = data.get("timeline", [])
    assert len(timeline) > 0, (
        "Forecast timeline is empty — WW3 GRIB fetch may be failing. "
        "Check NOMADS GRIB filter URL format. See NOMADS SCN25-81 notes."
    )


def test_forecast_timeline_points_have_wave_data(client):
    """Each timeline point should have wave height data (not all null)."""
    r = client.get(f"/api/surf-spots/{TEST_SPOT}/forecast-timeline?hours=24")
    assert r.status_code == 200
    timeline = r.json().get("timeline", [])
    if not timeline:
        pytest.skip("Empty timeline — covered by test_forecast_timeline_has_points")

    # Timeline wave dict uses height_m/height_ft keys (not 'hs')
    wave_points = [
        pt for pt in timeline
        if (pt.get("wave") or {}).get("height_m") is not None
        or (pt.get("wave") or {}).get("height_ft") is not None
    ]
    assert len(wave_points) > 0, (
        "All timeline wave values are null — WW3 GRIB fetch is failing silently. "
        "Check waves-overlay endpoint for 500 errors (TypeError in _get_wave_overlay_impl). "
        "Check that cfgrib variables 'swh','perpw','dirpw' match ww3_grid_registry.json."
    )


# ─── Copilot chat (catches internal tool call crashes) ────────────────────────

def test_copilot_conditions_question_no_crash(client):
    """
    POST /api/copilot/chat with a conditions question must not return a generic
    error message. This catches the Depends() crash that occurred when the
    Copilot tool called get_surf_spot_conditions() directly in Python.
    """
    payload = {
        "messages": [{"role": "user", "content": f"How are the conditions at {TEST_SPOT} right now?"}],
        "context": {"spot_id": TEST_SPOT}
    }
    r = client.post("/api/copilot/chat", json=payload)
    assert r.status_code == 200, f"Copilot 500: {r.text[:400]}"
    data = r.json()
    message = data.get("message", "")

    error_phrases = [
        "Something went wrong",
        "backend error",
        "data feed isn't responding",
        "'Depends'",
        "has no attribute",
        "AttributeError",
        "NoneType",
    ]
    for phrase in error_phrases:
        assert phrase.lower() not in message.lower(), (
            f"Copilot returned error phrase '{phrase}': {message[:400]}"
        )


def test_copilot_conditions_question_has_surf_data(client):
    """
    Copilot response to a conditions question must mention wave or surf data,
    not just a generic fallback. Regression for when conditions tool returned
    empty data and Copilot generated a non-answer.
    """
    payload = {
        "messages": [{"role": "user", "content": f"What are the current surf conditions at {TEST_SPOT}?"}],
        "context": {"spot_id": TEST_SPOT}
    }
    r = client.post("/api/copilot/chat", json=payload)
    assert r.status_code == 200
    message = (r.json().get("message") or "").lower()

    surf_keywords = ["ft", "feet", "wave", "swell", "surf", "conditions", "period", "wind"]
    has_surf_data = any(kw in message for kw in surf_keywords)
    assert has_surf_data, (
        f"Copilot response contains no surf-related data — tool may have failed silently. "
        f"Response: {message[:400]}"
    )


# ─── Wave overlay (GRIB pipeline health) ─────────────────────────────────────

def test_waves_overlay_returns_vectors(client):
    """
    GET /api/waves-overlay must return a non-empty vectors list.
    Regression for NOMADS SCN25-81: retired OPeNDAP returned HTML 'retired'
    page which parsed as empty data, but the endpoint returned 200 with vectors=[].
    """
    # Small bbox around SD coast to keep download fast
    params = {
        "source": "global",
        "bounds": "32.0,-118.5,34.5,-116.5",
        "forecast_hour": 0
    }
    r = client.get("/api/waves-overlay", params=params)
    assert r.status_code == 200, f"Waves overlay error: {r.text[:400]}"
    data = r.json()
    vectors = data.get("vectors", [])
    assert len(vectors) > 0, (
        "Wave overlay returned empty vectors — WW3 GRIB fetch is failing. "
        "Verify NOMADS GRIB filter URL: filter_gfswave.pl + gfs.DATE/HH/wave/gridded path."
    )


# ─── Swell physics + tables (pure math — always available) ───────────────────

def test_swell_category_endpoint(client):
    """GET /api/swell/category must return correct category for known inputs."""
    r = client.get("/api/swell/category?wvht_ft=6&period_s=14")
    assert r.status_code == 200
    data = r.json()
    assert data.get("category") == 3, (
        f"Expected category 3 for 6ft@14s, got {data.get('category')}"
    )


def test_swell_distance_endpoint(client):
    """GET /api/swell/distance must return a plausible NM distance."""
    # Storm at 42°N 155°W to Blacks Beach (32.88°N 117.25°W)
    # Great circle ≈ 1864nm (verified)
    r = client.get("/api/swell/distance?lat1=42&lon1=-155&lat2=32.88&lon2=-117.25")
    assert r.status_code == 200
    data = r.json()
    dist = data.get("distance_nm", 0)
    assert 1700 < dist < 2100, f"Expected ~1864nm (great circle), got {dist}"


# ─── Tides endpoint ───────────────────────────────────────────────────────────

def test_tide_timeline_returns_data(client):
    """GET /api/tides/timeline must return hourly points for a known spot."""
    r = client.get(f"/api/tides/timeline?spot_slug={TEST_SPOT}&days=2")
    assert r.status_code == 200, f"Tide timeline error: {r.text[:400]}"
    data = r.json()
    timeline = data.get("timeline", [])
    assert len(timeline) > 0, "Tide timeline empty — NOAA CO-OPS fetch may be failing"
    first = timeline[0]
    assert "v" in first, f"Unexpected tide point shape: {first}"
    assert "state" in first, f"Tide state missing from point: {first}"
