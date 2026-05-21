"""Unit tests for services.region_impact.build_region_timeline (Phase 2)."""
from services.region_impact import build_region_timeline


def _impact(region_id, label, energy, peak_h, hs_m, tier, bearing=200.0, arrival_h=None):
    """Build a region_impact dict in the shape score_storm_against_regions emits."""
    return {
        "region_id":          region_id,
        "label":              label,
        "facing":             ["S", "SW"],
        "impact_tier":        tier,
        "energy_index":       energy,
        "bearing_deg":        bearing,
        "distance_km":        4000,
        "arrival_hours":      arrival_h if arrival_h is not None else peak_h - 12,
        "peak_arrival_hours": peak_h,
        "fade_hours":         peak_h + 48,
        "projected_hs_m":     hs_m,
        "exposure_factor":    0.8,
        "is_best_exposure":   False,
    }


# Sorted by energy desc, as score_storm_against_regions returns them.
_IMPACTS = [
    _impact("south-america",   "South America",        0.62, 60, 1.8, "direct"),
    _impact("central-america", "Central America",       0.45, 30, 1.5, "direct",   bearing=210),
    _impact("so-cal",          "Southern California",   0.22, 90, 1.0, "glancing", bearing=195),
    _impact("hawaii",          "Hawaii",                0.05, 40, 0.3, "miss"),
]
_STORM = {"peak_period_s": 15.0}


def test_top_n_and_chronological_order():
    tl = build_region_timeline(_STORM, _IMPACTS)
    assert len(tl) == 3                                   # miss excluded, top 3 of remainder
    # ordered by peak arrival, not energy
    assert [t["region"] for t in tl] == ["Central America", "South America", "Southern California"]
    peaks = [t["peak_hours"] for t in tl]
    assert peaks == sorted(peaks)                          # monotonic non-decreasing


def test_miss_tier_excluded():
    tl = build_region_timeline(_STORM, _IMPACTS)
    assert "Hawaii" not in [t["region"] for t in tl]


def test_field_mapping():
    tl = build_region_timeline(_STORM, _IMPACTS)
    central = next(t for t in tl if t["region"] == "Central America")
    assert central["size_ft"] == round(1.5 * 3.281, 1)    # m → ft
    assert central["dir_deg"] == 210                       # arrival bearing (FROM-direction)
    assert central["period_s"] == 15.0                     # from storm peak_period_s
    assert central["tier"] == "direct"
    assert central["region_id"] == "central-america"


def test_top_n_respected():
    tl = build_region_timeline(_STORM, _IMPACTS, top_n=2)
    assert len(tl) == 2
    # two highest-energy regions (SA 0.62, CA 0.45), ordered chronologically
    assert [t["region"] for t in tl] == ["Central America", "South America"]


def test_missing_period_is_none():
    tl = build_region_timeline({}, _IMPACTS)
    assert all(t["period_s"] is None for t in tl)


def test_empty_inputs():
    assert build_region_timeline(_STORM, []) == []
    assert build_region_timeline(None, []) == []


def test_low_energy_filtered_even_if_not_miss():
    impacts = [_impact("x", "X", 0.05, 20, 0.3, "partial")]   # below 0.1 energy floor
    assert build_region_timeline(_STORM, impacts) == []
