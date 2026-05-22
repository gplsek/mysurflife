"""Tests for services.spot_orientation (A1 geo offshore deriver).

Skipped when global-land-mask isn't installed.
"""
import pytest

from services import spot_orientation as so

pytestmark = pytest.mark.skipif(not so._LAND_MASK_OK, reason="global-land-mask not installed")


def _in_arc(deg, lo, hi):
    """True if deg is within the [lo, hi] arc (handles wraparound)."""
    deg %= 360
    lo %= 360
    hi %= 360
    return lo <= deg <= hi if lo <= hi else (deg >= lo or deg <= hi)


def test_west_facing_socal_is_offshore_east():
    r = so.derive_offshore_direction(32.88, -117.25)   # Blacks Beach
    assert r is not None
    assert _in_arc(r["offshore_deg"], 45, 110)          # ENE-ish (Santa Ana)
    assert _in_arc(r["facing_deg"], 225, 300)           # faces WSW–W


def test_oahu_north_shore_is_offshore_south():
    r = so.derive_offshore_direction(21.665, -158.053)  # Pipeline
    assert r is not None
    assert _in_arc(r["offshore_deg"], 120, 200)         # SE–S (Kona)


def test_east_facing_coast_is_offshore_west():
    r = so.derive_offshore_direction(28.0, -80.55)      # Florida east coast
    assert r is not None
    assert _in_arc(r["offshore_deg"], 200, 290)         # W-ish


def test_landlocked_returns_none():
    assert so.derive_offshore_direction(39.5, -98.35) is None   # central Kansas


def test_open_ocean_returns_none():
    assert so.derive_offshore_direction(30.0, -150.0) is None   # mid North Pacific


def test_suggest_wind_windows_shape():
    ws = so.suggest_wind_windows(32.88, -117.25)
    assert ws and len(ws) == 3
    assert any(w["category"] == "offshore" for w in ws)
    for w in ws:
        assert 0 <= w["dir_min"] <= 360 and 0 <= w["dir_max"] <= 360


def test_compass_helper():
    assert so.deg_to_compass(0) == "N"
    assert so.deg_to_compass(90) == "E"
    assert so.deg_to_compass(None) is None
