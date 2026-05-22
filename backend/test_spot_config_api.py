"""Tests for routes.spot_config window models (B): dir wrap + weight clamp."""
from routes.spot_config import SwellWindow, WindWindow, WindowsPayload


def test_swell_window_wraps_dir_and_clamps_weight():
    w = SwellWindow(dir_min=370, dir_max=-10, weight=1.5)
    assert w.dir_min == 10 and w.dir_max == 350      # 370%360, -10%360
    assert w.weight == 1.0                            # clamped to [0,1]


def test_wind_window_defaults():
    w = WindWindow(dir_min=45, dir_max=90)
    assert w.category == "offshore" and w.max_mph == 15 and w.weight == 1.0


def test_payload_parses_dicts():
    p = WindowsPayload(
        swell=[{"dir_min": 270, "dir_max": 300}],
        wind=[{"category": "offshore", "dir_min": 45, "dir_max": 90}],
    )
    assert len(p.swell) == 1 and len(p.wind) == 1
    assert p.swell[0].period_min_sec == 8            # default
