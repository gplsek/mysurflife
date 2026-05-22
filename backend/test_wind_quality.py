"""Unit tests for calculate_wind_quality — speed-gated, direction-aware wind scoring.

Models a west-facing spot: offshore wind blows FROM the east (~90°).
"""
from surf_scoring import calculate_wind_quality

# West-facing spot: offshore window centered on E (90°).
WW = [{"category": "offshore", "dir_min": 45, "dir_max": 135, "weight": 1.0}]

def ms(kt):       # knots → m/s
    return kt / 1.94384

def pts(deg, kt):
    return calculate_wind_quality(deg, ms(kt), WW)["points"]


def test_offshore_beats_cross_beats_onshore_at_moderate_speed():
    off   = pts(90, 10)    # from E  = offshore
    cross = pts(0,  10)    # from N  = cross
    on    = pts(270, 10)   # from W  = onshore
    assert off > cross > on
    assert off >= 3.0       # offshore moderate = good
    assert on  <= 1.2       # onshore moderate = blown out


def test_glassy_is_good_any_direction():
    # < 4 kt: clean regardless of direction
    assert pts(270, 2) >= 3.4   # onshore but glassy → still great
    assert pts(90, 2)  >= 3.7
    assert calculate_wind_quality(ms(2), 0, WW)  # smoke (no crash)


def test_light_onshore_is_mediocre_not_terrible():
    # "super light wind is OK" — 6 kt onshore should be middling, not zero
    p = pts(270, 6)
    assert 1.0 <= p <= 2.5


def test_onshore_degrades_sharply_past_8kt():
    assert pts(270, 6) > pts(270, 10) > pts(270, 20)


def test_offshore_holds_up_with_speed():
    # offshore stays good across speed (grooms the wave) until very strong
    assert pts(90, 6) >= 3.5
    assert pts(90, 14) >= 1.5      # strong offshore still has value
    assert pts(90, 14) > pts(270, 14)


def test_relations_labeled():
    assert calculate_wind_quality(90, ms(10), WW)["relation"] == "offshore"
    assert calculate_wind_quality(270, ms(10), WW)["relation"] == "onshore"
    assert calculate_wind_quality(0, ms(10), WW)["relation"] == "cross"
    assert calculate_wind_quality(270, ms(2), WW)["relation"] == "glassy"


def test_no_windows_falls_back_to_speed_only():
    # No orientation info → neutral direction, still penalizes strong wind
    glassy = calculate_wind_quality(270, ms(2), [])["points"]
    strong = calculate_wind_quality(270, ms(20), [])["points"]
    assert glassy > strong
    assert calculate_wind_quality(270, ms(10), [])["relation"] == "unknown"


def test_missing_speed_is_neutral():
    q = calculate_wind_quality(270, None, WW)
    assert q["points"] == 2.0 and q["relation"] == "unknown"
