"""services/spot_orientation.py — geo-derived spot orientation (A1).

Estimate which way a surf spot faces (toward open ocean) and therefore its offshore
wind direction, purely from coastline geometry — no LLM, no hallucination. Used to
bootstrap / sanity-check `spot_wind_windows` for spots that lack hand-tuned config.

Method: sample a ring of points around the spot; the bearings that land on open
ocean point seaward. `facing` = circular mean of those ocean bearings. Offshore wind
blows from land out to sea, so its FROM-direction = facing + 180.

Reuses the `global-land-mask` dependency already used by the storm detector.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional

try:
    from global_land_mask import globe as _globe
    _LAND_MASK_OK = True
except ImportError:
    _globe = None
    _LAND_MASK_OK = False

_EARTH_R_KM = 6371.0


def _dest_point(lat: float, lon: float, bearing_deg: float, dist_km: float) -> tuple:
    """Point at `dist_km` along `bearing_deg` from (lat, lon). Returns (lat, lon)."""
    br = math.radians(bearing_deg)
    d = dist_km / _EARTH_R_KM
    lat1, lon1 = math.radians(lat), math.radians(lon)
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(br))
    lon2 = lon1 + math.atan2(
        math.sin(br) * math.sin(d) * math.cos(lat1),
        math.cos(d) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), ((math.degrees(lon2) + 540) % 360) - 180


_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def deg_to_compass(deg: Optional[float]) -> Optional[str]:
    if deg is None:
        return None
    return _COMPASS[round((deg % 360) / 22.5) % 16]


def derive_offshore_direction(
    lat: float,
    lon: float,
    radii_km: tuple = (8.0, 20.0, 40.0),
    n_bearings: int = 36,
) -> Optional[Dict]:
    """Estimate a spot's seaward facing + offshore wind direction from the coastline.

    Returns {facing_deg, facing_compass, offshore_deg, offshore_compass,
    ocean_fraction, confidence} — or None if the mask is unavailable or the point is
    landlocked / in open ocean (no resolvable coastline within range).
    """
    if not _LAND_MASK_OK or _globe is None:
        return None

    ocean_sin = ocean_cos = 0.0
    ocean_hits = 0
    total = 0
    for i in range(n_bearings):
        b = i * 360.0 / n_bearings
        # A bearing counts as "seaward" if it reaches ocean at any sampled distance.
        is_ocean = False
        for r in radii_km:
            dlat, dlon = _dest_point(lat, lon, b, r)
            try:
                if not _globe.is_land(dlat, dlon):
                    is_ocean = True
                    break
            except Exception:
                continue
        total += 1
        if is_ocean:
            ocean_hits += 1
            ocean_sin += math.sin(math.radians(b))
            ocean_cos += math.cos(math.radians(b))

    if total == 0 or ocean_hits == 0:
        return None
    ocean_frac = ocean_hits / total
    # Fully open ocean (island point) or fully landlocked → no meaningful facing.
    if ocean_frac >= 0.95 or ocean_frac <= 0.05:
        return None

    facing = (math.degrees(math.atan2(ocean_sin, ocean_cos)) + 360) % 360
    offshore = (facing + 180) % 360

    # Confidence: a clean coastline has roughly half the ring as ocean and a
    # well-concentrated direction (resultant length near the ocean fraction).
    resultant = math.hypot(ocean_sin, ocean_cos) / ocean_hits  # 0..1 concentration
    confidence = "high" if (0.25 <= ocean_frac <= 0.75 and resultant >= 0.6) else "medium"

    return {
        "facing_deg":       round(facing, 1),
        "facing_compass":   deg_to_compass(facing),
        "offshore_deg":     round(offshore, 1),
        "offshore_compass": deg_to_compass(offshore),
        "ocean_fraction":   round(ocean_frac, 2),
        "confidence":       confidence,
    }


def suggest_wind_windows(lat: float, lon: float) -> Optional[List[Dict]]:
    """Suggest spot_wind_windows rows from the derived offshore direction:
    an `offshore` window (±45° of offshore) + two `side-offshore` flanks.
    Caller reviews/persists. Returns None if orientation can't be derived."""
    o = derive_offshore_direction(lat, lon)
    if not o:
        return None
    off = o["offshore_deg"]
    def win(center, half):
        return [round((center - half) % 360), round((center + half) % 360)]
    off_min, off_max = win(off, 45)
    sl_min, sl_max = win((off - 67) % 360, 22)
    sr_min, sr_max = win((off + 67) % 360, 22)
    return [
        {"category": "offshore",      "dir_min": off_min, "dir_max": off_max, "max_mph": 15, "weight": 1.0},
        {"category": "side-offshore", "dir_min": sl_min,  "dir_max": sl_max,  "max_mph": 12, "weight": 0.8},
        {"category": "side-offshore", "dir_min": sr_min,  "dir_max": sr_max,  "max_mph": 12, "weight": 0.8},
    ]
