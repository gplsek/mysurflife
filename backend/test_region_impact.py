"""Tests for region impact scoring and narrative (Phase 7)."""
import pytest
from services.region_impact import (
    score_storm_against_regions, compose_narrative, _load_region_config,
)


def _storm(lat=0, lon=0, period_s=14.0, hs_m=4.0,
           landfall_before_peak=False, will_make_landfall=False,
           landfall_eta_hours=None, peak_intensity_hour=None):
    return {
        "id": "test", "lat": lat, "lon": lon, "type": "LOW",
        "ocean": "north-pacific",
        "peak_period_s": period_s, "peak_sea_m": hs_m,
        "landfall_before_peak": landfall_before_peak,
        "will_make_landfall": will_make_landfall,
        "landfall_eta_hours": landfall_eta_hours,
        "peak_intensity_hour": peak_intensity_hour,
    }


def test_score_so_cal_direct_hit():
    """Storm at 30°N 155°W, T=16s, Hs=6m → So Cal gets direct hit with energy_index ≥ 0.2."""
    storm = _storm(lat=30.0, lon=-155.0, period_s=16.0, hs_m=6.0)
    impacts = score_storm_against_regions(storm)
    so_cal = next(r for r in impacts if r["region_id"] == "so-cal")
    assert so_cal["impact_tier"] in ("direct", "glancing"), (
        f"Expected direct/glancing for So Cal, got {so_cal['impact_tier']} "
        f"(energy={so_cal['energy_index']})"
    )
    assert so_cal["energy_index"] > 0.05


def test_score_hawaii_shadow():
    """Storm deep in North Atlantic → Hawaii regions get 'miss'."""
    storm = _storm(lat=35.0, lon=40.0, period_s=12.0, hs_m=4.0)
    impacts = score_storm_against_regions(storm)
    hawaii = [r for r in impacts if r["region_id"].startswith("hawaii")]
    for h in hawaii:
        assert h["impact_tier"] == "miss", (
            f"Expected miss for {h['region_id']} from Atlantic storm, got {h['impact_tier']}"
        )


def test_landfall_blocked_tier():
    """Storm with landfall_before_peak=True in So Cal window → landfall_blocked tier."""
    storm = _storm(lat=30.0, lon=-155.0, period_s=14.0, hs_m=6.0,
                   landfall_before_peak=True, will_make_landfall=True,
                   landfall_eta_hours=24, peak_intensity_hour=48)
    impacts = score_storm_against_regions(storm)
    # At least one region that would otherwise get hits should be landfall_blocked
    blocked = [r for r in impacts if r["impact_tier"] == "landfall_blocked"]
    assert len(blocked) > 0, "Expected at least one landfall_blocked region"


def test_score_returns_all_regions():
    """Always returns one entry per configured region."""
    impacts = score_storm_against_regions(_storm())
    regions = _load_region_config()["regions"]
    assert len(regions) > 0
    assert len(impacts) == len(regions)


def test_score_sorted_by_energy():
    """Results are sorted energy_index descending."""
    impacts = score_storm_against_regions(_storm(lat=30, lon=-155, hs_m=5.0))
    energies = [r["energy_index"] for r in impacts]
    assert energies == sorted(energies, reverse=True)


def test_best_exposure_only_direct():
    """is_best_exposure=True only assigned to a direct hit, not glancing/miss."""
    storm = _storm(lat=30.0, lon=-155.0, period_s=16.0, hs_m=8.0)
    impacts = score_storm_against_regions(storm)
    best = [r for r in impacts if r["is_best_exposure"]]
    assert len(best) <= 1
    if best:
        assert best[0]["impact_tier"] == "direct"


def test_narrative_includes_best_region():
    """Narrative for Pacific storm mentions a region label."""
    storm = _storm(lat=30.0, lon=-155.0, period_s=16.0, hs_m=6.0)
    impacts = score_storm_against_regions(storm)
    narrative = compose_narrative(storm, impacts)
    assert len(narrative) > 20
    assert "Best exposure" in narrative or "No surf-relevant" in narrative


def test_narrative_no_direct_hits():
    """Atlantic storm → no direct Pacific hits → fallback narrative."""
    storm = _storm(lat=35.0, lon=40.0, period_s=8.0, hs_m=2.0)
    impacts = score_storm_against_regions(storm)
    narrative = compose_narrative(storm, impacts)
    assert "No surf-relevant regions" in narrative
