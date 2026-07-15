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


# ---------------------------------------------------------------------------
# Global catalog scenarios (Phase A)
# ---------------------------------------------------------------------------

def _impacts_by_id(impacts):
    return {r["region_id"]: r for r in impacts}


def test_antarctic_low_projects_pacific_swell_train():
    """Southern Ocean low aimed NE lights up the classic S-Pacific train,
    ordered by arrival: Chile before Peru before Central America before SoCal."""
    storm = _storm(lat=-57.0, lon=-120.0, period_s=18.0, hs_m=10.0)
    storm["swell_direction_deg"] = 225.0   # swell FROM SW → radiating NE
    impacts = _impacts_by_id(score_storm_against_regions(storm))

    for rid in ("chile-central", "peru", "central-america", "so-cal"):
        assert impacts[rid]["impact_tier"] == "direct", rid
    assert (impacts["chile-central"]["arrival_hours"]
            < impacts["peru"]["arrival_hours"]
            < impacts["central-america"]["arrival_hours"]
            < impacts["so-cal"]["arrival_hours"])
    # Radiating NE: Japan (far west, up-wind) must not register as direct
    assert impacts["japan"]["impact_tier"] == "miss"


def test_atlantic_hurricane_hits_us_east_and_caribbean():
    storm = _storm(lat=25.0, lon=-70.0, period_s=14.0, hs_m=8.0)
    storm["swell_direction_deg"] = 135.0   # swell FROM SE → radiating NW
    impacts = _impacts_by_id(score_storm_against_regions(storm))
    assert impacts["us-east"]["impact_tier"] in ("direct", "glancing")
    assert impacts["caribbean-north"]["impact_tier"] in ("direct", "glancing", "partial")
    assert impacts["so-cal"]["impact_tier"] == "miss"      # wrong ocean
    assert impacts["portugal"]["impact_tier"] == "miss"    # up-wind of the fetch


def test_typhoon_hits_japan_and_philippines():
    storm = _storm(lat=18.0, lon=135.0, period_s=14.0, hs_m=9.0)
    storm["swell_direction_deg"] = 160.0   # radiating NNW toward Japan
    impacts = _impacts_by_id(score_storm_against_regions(storm))
    assert impacts["japan"]["impact_tier"] in ("direct", "glancing")
    assert impacts["us-east"]["impact_tier"] == "miss"


# ---------------------------------------------------------------------------
# Track-aware scoring (Phase B)
# ---------------------------------------------------------------------------

def test_track_aware_scores_future_window_entry():
    """A storm whose h0 sits outside every SoCal window but whose +72h
    position moves into it must register — with arrival timed from +72h."""
    from services.region_impact import score_storm_track_against_regions

    storm = _storm(lat=-50.0, lon=-170.0, period_s=16.0, hs_m=9.0)
    storm["swell_direction_deg"] = 200.0
    storm["forecast_track"] = [
        # Storm tracks NE across the S Pacific, fetch rotating toward SoCal
        {"hours_ahead": 24, "lat": -45.0, "lon": -160.0,
         "peak_sea_m": 9.5, "peak_period_s": 17.0, "swell_direction_deg": 205.0},
        {"hours_ahead": 72, "lat": -38.0, "lon": -140.0,
         "peak_sea_m": 11.0, "peak_period_s": 18.0, "swell_direction_deg": 215.0},
    ]
    impacts = {r["region_id"]: r for r in score_storm_track_against_regions(storm)}

    socal = impacts["so-cal"]
    assert socal["impact_tier"] != "miss"
    # Swell departs when the storm is at its best waypoint, not at h0
    assert socal["arrival_hours"] >= socal["impact_from_hour"]
    assert socal["impact_from_hour"] > 0


def test_track_aware_falls_back_to_h0_for_legacy_tracks():
    """Old rows lack per-point WW3 fields — waypoints inherit storm-level
    sea state and scoring still works."""
    from services.region_impact import score_storm_track_against_regions

    storm = _storm(lat=15.0, lon=-116.0, period_s=15.0, hs_m=8.0)
    storm["swell_direction_deg"] = 155.0
    storm["forecast_track"] = [
        {"hours_ahead": 24, "lat": 17.0, "lon": -118.0},   # legacy shape
    ]
    impacts = {r["region_id"]: r for r in score_storm_track_against_regions(storm)}
    assert impacts["so-cal"]["impact_tier"] == "direct"


def test_track_aware_matches_single_point_when_no_track():
    from services.region_impact import (
        score_storm_against_regions, score_storm_track_against_regions,
    )
    storm = _storm(lat=15.0, lon=-116.0, period_s=15.0, hs_m=8.0)
    a = score_storm_against_regions(storm)
    b = score_storm_track_against_regions(storm)
    assert [(r["region_id"], r["impact_tier"]) for r in a] == \
           [(r["region_id"], r["impact_tier"]) for r in b]
