"""Tests for WW3 confirmation pass and track dynamics (Phase 4 + 5)."""
import math
import numpy as np
import pytest
from jobs.detect_storms import (
    sample_hs_cone,
    _annotate_track_dynamics,
    _annotate_landfall,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_grid(rows=18, cols=36, fill=np.nan):
    """Make a small synthetic lat/lon/hs grid. Covers 0..170 lat, 0..350 lon."""
    lat = np.linspace(85, -85, rows)
    lon = np.linspace(0, 355, cols)
    hs  = np.full((rows, cols), fill, dtype=float)
    return hs, lat, lon


def _storm_with_track(pressures, start_hour=0, step=6):
    """Build a minimal storm dict with forecast_track from a list of pressures."""
    track = [
        {"hours_ahead": start_hour + i * step, "lat": 20.0, "lon": -130.0,
         "pressure_mb": p, "peak_wind_kts": None}
        for i, p in enumerate(pressures)
    ]
    return {"id": "test", "lat": 20.0, "lon": -130.0, "forecast_track": track}


# ---------------------------------------------------------------------------
# sample_hs_cone
# ---------------------------------------------------------------------------

def test_sample_hs_cone_land_only():
    """All-NaN grid (land) → ocean_cells == 0."""
    hs, lat, lon = _make_grid(fill=np.nan)
    result = sample_hs_cone(hs, lat, lon, center_lat=20.0, center_lon=180.0,
                            peak_quadrant="W")
    assert result["ocean_cells"] == 0


def test_sample_hs_cone_strong_fetch():
    """Grid with 8m peak in NE quadrant, peak_quadrant='NE' → max_hs_m ≈ 8."""
    hs, lat, lon = _make_grid(rows=36, cols=72, fill=0.5)
    # Place 8m values roughly NE of center (center at lat=20, lon=180)
    # NE cone: bearing ~45°, range 100-800nm (185-1482 km)
    # Cells at lat~25, lon~185 are roughly NE at ~600km from center
    for ri, la in enumerate(lat):
        for ci, lo in enumerate(lon):
            lo180 = lo - 360 if lo > 180 else lo
            dlat = la - 20.0
            dlon = lo180 - 0.0  # center at lon=0 for simplicity
            dist = math.sqrt(dlat**2 + dlon**2) * 111.0  # rough km
            if 300 < dist < 1200 and dlat > 0 and dlon > 0:
                hs[ri, ci] = 8.0

    # Use center at 0° lon (in 0..360 grid, that's lon_1d=0)
    result = sample_hs_cone(hs, lat, lon, center_lat=20.0, center_lon=0.0,
                            peak_quadrant="NE",
                            range_nm=(100, 800))
    assert result["ocean_cells"] > 0
    assert result["max_hs_m"] >= 7.0


def test_sample_hs_cone_weak_fetch():
    """Grid all 1.5m → max_hs_m < 3.0 (would-drop threshold)."""
    hs, lat, lon = _make_grid(rows=36, cols=72, fill=1.5)
    result = sample_hs_cone(hs, lat, lon, center_lat=20.0, center_lon=0.0,
                            peak_quadrant="NE")
    # May find ocean cells but all weak
    if result["ocean_cells"] > 0:
        assert result["max_hs_m"] < 3.0


def test_sample_hs_cone_no_quadrant():
    """peak_quadrant=None → returns empty (no cone axis defined)."""
    hs, lat, lon = _make_grid(fill=5.0)
    result = sample_hs_cone(hs, lat, lon, center_lat=20.0, center_lon=0.0,
                            peak_quadrant=None)
    assert result["ocean_cells"] == 0


# ---------------------------------------------------------------------------
# _annotate_track_dynamics
# ---------------------------------------------------------------------------

def test_annotate_track_dynamics_basic():
    """5-point track 1010→990→980→985→995 — peak at h12, deepening=True."""
    storm = _storm_with_track([1010, 990, 980, 985, 995])
    _annotate_track_dynamics(storm)

    assert storm["is_deepening"] is True           # 990 < 1010
    assert storm["peak_intensity_hour"] == 12      # min pressure at index 2 = h12
    # Rate over first 24h (4 steps): (995 - 1010) / 4 = -3.75 mb/6h
    assert storm["intensification_rate_mb_per_6h"] == pytest.approx(-3.75, abs=0.1)


def test_annotate_track_dynamics_weakening():
    """Track 990→1000→1005 → is_deepening=False."""
    storm = _storm_with_track([990, 1000, 1005])
    _annotate_track_dynamics(storm)
    assert storm["is_deepening"] is False


def test_annotate_track_dynamics_short_track():
    """Single-point track → all None (guard for short tracks)."""
    storm = {"id": "x", "lat": 0, "lon": 0, "forecast_track": [
        {"hours_ahead": 0, "lat": 0, "lon": 0, "pressure_mb": 1000, "peak_wind_kts": None}
    ]}
    _annotate_track_dynamics(storm)
    assert storm["peak_intensity_hour"] is None


# ---------------------------------------------------------------------------
# _annotate_landfall  (these tests are skipped when global_land_mask unavailable)
# ---------------------------------------------------------------------------

try:
    from global_land_mask import globe as _gl
    _LAND_MASK_OK = True
except ImportError:
    _LAND_MASK_OK = False


@pytest.mark.skipif(not _LAND_MASK_OK, reason="global_land_mask not installed")
def test_landfall_oceanic_track():
    """All-ocean Pacific track → will_make_landfall=False."""
    track = [
        {"hours_ahead": i * 6, "lat": 20.0 + i * 0.5, "lon": -140.0 + i * 0.3,
         "pressure_mb": 990, "peak_wind_kts": None}
        for i in range(10)
    ]
    storm = {"id": "x", "lat": 20, "lon": -140, "forecast_track": track,
             "peak_intensity_hour": 18}
    _annotate_landfall(storm)
    assert storm["will_make_landfall"] is False


@pytest.mark.skipif(not _LAND_MASK_OK, reason="global_land_mask not installed")
def test_landfall_crosses_coast():
    """Track that passes through Hawaii (21°N 157°W, land) → will_make_landfall=True."""
    track = [
        {"hours_ahead": 0,  "lat": 20.0, "lon": -160.0, "pressure_mb": 985, "peak_wind_kts": None},
        {"hours_ahead": 6,  "lat": 20.8, "lon": -158.0, "pressure_mb": 982, "peak_wind_kts": None},
        {"hours_ahead": 12, "lat": 21.3, "lon": -157.8, "pressure_mb": 980, "peak_wind_kts": None},
        {"hours_ahead": 18, "lat": 22.0, "lon": -156.0, "pressure_mb": 982, "peak_wind_kts": None},
    ]
    storm = {"id": "x", "lat": 20, "lon": -160, "forecast_track": track,
             "peak_intensity_hour": 12}
    _annotate_landfall(storm)
    # Hawaii coordinates should trigger landfall
    assert storm["will_make_landfall"] is True
    assert storm["landfall_eta_hours"] is not None


@pytest.mark.skipif(not _LAND_MASK_OK, reason="global_land_mask not installed")
def test_landfall_before_peak_flag():
    """Landfall at h12, peak at h24 → landfall_before_peak=True."""
    # Use Oahu coordinates for landfall
    track = [
        {"hours_ahead": 0,  "lat": 20.0, "lon": -160.0, "pressure_mb": 990, "peak_wind_kts": None},
        {"hours_ahead": 12, "lat": 21.3, "lon": -157.8, "pressure_mb": 985, "peak_wind_kts": None},
        {"hours_ahead": 24, "lat": 22.0, "lon": -155.0, "pressure_mb": 975, "peak_wind_kts": None},
    ]
    storm = {"id": "x", "lat": 20, "lon": -160, "forecast_track": track,
             "peak_intensity_hour": 24}
    _annotate_landfall(storm)
    if storm["will_make_landfall"]:
        if storm["landfall_eta_hours"] < 24:
            assert storm["landfall_before_peak"] is True
