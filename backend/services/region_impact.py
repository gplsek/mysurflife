"""services/region_impact.py — score each storm against surf regions.

Per §7.1 of GLOBAL_STORM_DETECTION_PLAN.md:
  - Compute bearing from storm to region centroid.
  - Distance + arrival timing via deep-water group velocity.
  - Impact tier: direct | glancing | partial | miss | landfall_blocked.
  - Energy index (0-1) from projected_height² × period, normalized.
  - Narrative templater: pure string assembly, no LLM.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "region_swell_windows.json"
_region_config: Optional[Dict] = None


def _load_region_config() -> Dict:
    global _region_config
    if _region_config is None:
        with open(_CONFIG_PATH) as f:
            _region_config = json.load(f)
    return _region_config


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(min(1.0, a)))


def _bearing_to_region(slat: float, slon: float, rlat: float, rlon: float) -> float:
    """Great-circle bearing from storm to region centroid, degrees 0-360."""
    dlon = math.radians(rlon - slon)
    lat1 = math.radians(slat)
    lat2 = math.radians(rlat)
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _in_window(bearing: float, wmin: float, wmax: float) -> bool:
    b = bearing % 360
    lo, hi = wmin % 360, wmax % 360
    if lo <= hi:
        return lo <= b <= hi
    return b >= lo or b <= hi


def _angular_offset_from_center(bearing: float, wmin: float, wmax: float) -> float:
    """Angular offset from window center in degrees (-180..180).

    Wraparound-safe: for a window like [330, 60] the center is 15° (north),
    not (330+60)/2 = 195° (south) — walk half the wrapped span from wmin.
    """
    span = (wmax - wmin) % 360 or 360
    center = (wmin + span / 2) % 360
    return (bearing - center + 180) % 360 - 180


# Swell windows are judgment calls, not walls: a bearing a few degrees outside
# still delivers refracted/angular-spread energy. Taper exposure over this many
# degrees beyond the window edge instead of snapping to zero — a hurricane at
# bearing 174.8° vs a [180, 290] window used to score exactly 0.0 for SoCal.
_SOFT_EDGE_DEG = 25.0


def _exposure_factor(bearing: float, wmin: float, wmax: float) -> float:
    """cos² of angular offset from window center, with a soft shoulder that
    tapers to 0 over _SOFT_EDGE_DEG beyond the window edges."""
    offset = abs(_angular_offset_from_center(bearing, wmin, wmax))
    half_width = (((wmax - wmin) % 360) or 360) / 2
    if offset <= half_width:
        return math.cos(math.radians(offset)) ** 2
    beyond = offset - half_width
    if beyond >= _SOFT_EDGE_DEG:
        return 0.0
    edge = math.cos(math.radians(half_width)) ** 2
    return edge * math.cos(math.radians(90.0 * beyond / _SOFT_EDGE_DEG)) ** 2


# Storms don't radiate swell isotropically: energy is strongest downwind of
# the fetch. Full weight within this half-angle of the storm's primary swell
# propagation direction, cos²-tapering to a floor beyond it. The floor stays
# well above zero — cyclone fetch rotates around the low and real storms leak
# energy over a wide fan, so off-axis regions get reduced, not erased.
_SOURCE_CONE_HALF_DEG = 45.0
_SOURCE_TAPER_DEG     = 60.0
_SOURCE_FLOOR         = 0.25


def _source_factor(swell_from_deg: Optional[float], transit_bearing: float) -> float:
    """Directional radiation weight for the storm→region path.

    swell_from_deg is WW3 DIRPW at the storm center (FROM-direction, project
    convention); propagation is FROM + 180°. transit_bearing is the great-
    circle direction from storm to region. Returns 1.0 when the region lies
    downwind of the fetch, tapering to _SOURCE_FLOOR off-axis. Isotropic
    (1.0) when the detector has no swell direction for the storm.
    """
    if swell_from_deg is None:
        return 1.0
    prop = (swell_from_deg + 180.0) % 360.0
    off = abs((transit_bearing - prop + 180.0) % 360.0 - 180.0)
    if off <= _SOURCE_CONE_HALF_DEG:
        return 1.0
    beyond = off - _SOURCE_CONE_HALF_DEG
    if beyond >= _SOURCE_TAPER_DEG:
        return _SOURCE_FLOOR
    t = math.cos(math.radians(90.0 * beyond / _SOURCE_TAPER_DEG)) ** 2
    return _SOURCE_FLOOR + (1.0 - _SOURCE_FLOOR) * t


# ---------------------------------------------------------------------------
# Swell physics
# ---------------------------------------------------------------------------

def _e_fold_km(period_s: float) -> float:
    """E-folding decay distance (km), period-aware.

    Long-period swell crosses ocean basins with low dissipation, so the e-folding
    distance scales strongly with period — a 16-18s Southern-Ocean swell still
    produces surf ~10,000 km away (e.g. 55°S storm → ~4 ft @ 16s in So-Cal).
    The previous 1000–3000 km range over-decayed far-field swell to zero, so every
    storm scored as a `miss` and the trajectory analysis never fired.
    """
    if period_s >= 18:
        return 9000.0
    if period_s <= 10:
        return 2500.0
    return 2500.0 + (period_s - 10) / 8.0 * 6500.0


def _decay(distance_km: float, period_s: float) -> float:
    return math.exp(-distance_km / _e_fold_km(period_s))


def _group_velocity_km_per_h(period_s: float) -> float:
    """Deep-water group velocity in km/h."""
    # Cg = g*T/(4π); g=9.8 m/s → ×3.6 for km/h
    return 9.8 * period_s / (4 * math.pi) * 3.6


# ---------------------------------------------------------------------------
# Impact tier
# ---------------------------------------------------------------------------

def _impact_tier(energy_index: float, landfall_blocked: bool) -> str:
    if landfall_blocked and energy_index >= 0.1:
        return "landfall_blocked"
    if energy_index >= 0.4:
        return "direct"
    if energy_index >= 0.2:
        return "glancing"
    if energy_index >= 0.1:
        return "partial"
    return "miss"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _score_point_against_region(region_id: str, region: Dict, *,
                                lat: float, lon: float, period_s: float,
                                hs_m: float, swell_dir: Optional[float],
                                blocked: bool, hours_ahead: float) -> Dict:
    """Evaluate one storm state (position + sea state at a forecast hour)
    against one region. Arrival timing accounts for when the storm is at
    this state: swell leaves at hours_ahead, then travels at group velocity.
    """
    c_lat, c_lon = region["centroid"]
    # swell_window_deg is the direction swell arrives AT the region.
    transit_bearing = _bearing_to_region(lat, lon, c_lat, c_lon)
    bearing = (transit_bearing + 180) % 360   # arrival direction at region
    distance = _haversine_km(lat, lon, c_lat, c_lon)

    wmin, wmax = region["swell_window_deg"]
    exposure  = _exposure_factor(bearing, wmin, wmax)
    decay_fac = _decay(distance, period_s)
    source    = _source_factor(swell_dir, transit_bearing)

    # Projected significant wave height at region (height attenuates as sqrt(energy))
    proj_hs = (hs_m * decay_fac * math.sqrt(max(0.0, exposure * source))
               if exposure > 0 else 0.0)

    # Energy index (0-1): normalized by a "solid swell" reference (3m × 14s ≈ 126)
    energy_raw   = (proj_hs ** 2) * period_s
    energy_index = min(1.0, energy_raw / 126.0)

    # Arrival timing: departure hour + transit time
    cg = _group_velocity_km_per_h(period_s)
    arrival_hours      = hours_ahead + (distance / cg if cg > 0 else 9999)
    peak_arrival_hours = arrival_hours + 12.0
    fade_hours         = peak_arrival_hours + max(24.0, 0.3 * 168.0)

    return {
        "region_id":          region_id,
        "label":              region["label"],
        "facing":             region["facing"],
        "impact_tier":        _impact_tier(energy_index, blocked),
        "energy_index":       round(energy_index, 3),
        "bearing_deg":        round(bearing, 1),
        "distance_km":        round(distance),
        "arrival_hours":      round(arrival_hours, 1),
        "peak_arrival_hours": round(peak_arrival_hours, 1),
        "fade_hours":         round(fade_hours, 1),
        "projected_hs_m":     round(proj_hs, 2),
        "exposure_factor":    round(exposure, 3),
        "impact_from_hour":   round(hours_ahead, 1),
        "is_best_exposure":   False,
    }


def _rank_impacts(impacts: List[Dict]) -> List[Dict]:
    # Energy index saturates at 1.0 for strong swell trains — break ties by
    # projected height so "best exposure" names the biggest surf, not the
    # region that happens to come first in the config.
    impacts.sort(key=lambda x: (-x["energy_index"], -x["projected_hs_m"]))
    for r in impacts:
        if r["impact_tier"] == "direct":
            r["is_best_exposure"] = True
            break
    return impacts


def _storm_track_points(storm: Dict) -> List[Dict]:
    """Storm states to evaluate: h0 (storm-level fields) plus every
    forecast_track waypoint, each falling back to storm-level sea state when
    the waypoint predates per-point WW3 capture (older rows)."""
    base_period = float(storm.get("peak_period_s") or 12.0)
    base_hs     = float(storm.get("peak_sea_m")    or 2.0)
    base_dir    = storm.get("swell_direction_deg")

    points = [{
        "lat": float(storm.get("lat") or 0),
        "lon": float(storm.get("lon") or 0),
        "period_s": base_period, "hs_m": base_hs,
        "swell_dir": base_dir, "hours_ahead": 0.0,
    }]
    for wp in (storm.get("forecast_track") or []):
        if wp.get("lat") is None or wp.get("lon") is None:
            continue
        points.append({
            "lat": float(wp["lat"]), "lon": float(wp["lon"]),
            "period_s": float(wp.get("peak_period_s") or base_period),
            "hs_m": float(wp.get("peak_sea_m") or base_hs),
            "swell_dir": wp.get("swell_direction_deg", base_dir),
            "hours_ahead": float(wp.get("hours_ahead") or 0.0),
        })
    return points


def score_storm_against_regions(storm: Dict) -> List[Dict]:
    """Single-state scoring: the storm's current position + sea state only.
    Kept for callers/tests that reason about one snapshot; the detector uses
    score_storm_track_against_regions."""
    cfg = _load_region_config()
    regions = cfg.get("regions", {})
    blocked = bool(storm.get("landfall_before_peak", False))
    p = _storm_track_points(storm)[0]

    impacts = [
        _score_point_against_region(rid, region, lat=p["lat"], lon=p["lon"],
                                    period_s=p["period_s"], hs_m=p["hs_m"],
                                    swell_dir=p["swell_dir"], blocked=blocked,
                                    hours_ahead=0.0)
        for rid, region in regions.items()
    ]
    return _rank_impacts(impacts)


def score_storm_track_against_regions(storm: Dict) -> List[Dict]:
    """Track-aware scoring: evaluate every forecast_track waypoint per region
    and keep the best-energy state. A Southern Ocean low whose h0 sits outside
    a region's swell window still registers when its +72h position moves into
    the window — with arrival timed from that hour, not from now.
    """
    cfg = _load_region_config()
    regions = cfg.get("regions", {})
    blocked = bool(storm.get("landfall_before_peak", False))
    points = _storm_track_points(storm)

    impacts: List[Dict] = []
    for rid, region in regions.items():
        best: Optional[Dict] = None
        for p in points:
            cand = _score_point_against_region(
                rid, region, lat=p["lat"], lon=p["lon"],
                period_s=p["period_s"], hs_m=p["hs_m"],
                swell_dir=p["swell_dir"], blocked=blocked,
                hours_ahead=p["hours_ahead"],
            )
            if best is None or (cand["energy_index"], cand["projected_hs_m"]) > (
                best["energy_index"], best["projected_hs_m"]
            ):
                best = cand
        impacts.append(best)
    return _rank_impacts(impacts)


# Tiers worth surfacing in the trajectory timeline (everything but a clean miss).
_TIMELINE_TIERS = {"direct", "glancing", "partial", "landfall_blocked"}


def build_region_timeline(
    storm: Optional[Dict],
    region_impacts: List[Dict],
    top_n: int = 3,
) -> List[Dict]:
    """Deterministic top-N region trajectory for a storm, ordered chronologically.

    Picks the strongest impacted regions by ``energy_index``, then orders them by
    when the swell peaks — so the card / Sione can say "first X, then Y, then Z".
    Every number comes straight from ``region_impacts`` + the storm's peak period;
    no LLM, no invented values. The LLM layer (Phase 3) only narrates this list.

    Each entry: ``{region_id, region, tier, arrival_hours, peak_hours, fade_hours,
    size_ft, period_s, dir_deg, energy_index}``. ``dir_deg`` is the swell's
    FROM-direction at the region (the impact's arrival bearing).
    """
    if not region_impacts:
        return []

    period_s = (storm or {}).get("peak_period_s")
    period_out = round(period_s, 1) if isinstance(period_s, (int, float)) else None

    impactful = [
        r for r in region_impacts
        if r.get("impact_tier") in _TIMELINE_TIERS and (r.get("energy_index") or 0) >= 0.1
    ]
    # region_impacts arrives sorted by energy desc; take the strongest, then
    # re-order chronologically by peak arrival for display.
    top = impactful[:top_n]
    top.sort(key=lambda r: r.get("peak_arrival_hours") if r.get("peak_arrival_hours") is not None else float("inf"))

    timeline: List[Dict] = []
    for r in top:
        hs_m = r.get("projected_hs_m")
        timeline.append({
            "region_id":     r.get("region_id"),
            "region":        r.get("label"),
            "tier":          r.get("impact_tier"),
            "arrival_hours": r.get("arrival_hours"),
            "peak_hours":    r.get("peak_arrival_hours"),
            "fade_hours":    r.get("fade_hours"),
            "size_ft":       round(hs_m * 3.281, 1) if isinstance(hs_m, (int, float)) else None,
            "period_s":      period_out,
            "dir_deg":       r.get("bearing_deg"),
            "energy_index":  r.get("energy_index"),
        })
    return timeline


def compose_narrative(storm: Dict, region_impacts: List[Dict]) -> str:
    """Returns prose summary for storm drawer. Pure string assembly, no LLM."""
    storm_lat = storm.get("lat", 0)
    storm_lon = storm.get("lon", 0)
    storm_type = storm.get("type", "LOW")
    ocean = storm.get("ocean", "")

    type_label = {
        "HURRICANE":           "Hurricane",
        "TYPHOON":             "Typhoon",
        "TROPICAL_STORM":      "Tropical storm",
        "TROPICAL_DEPRESSION": "Tropical depression",
        "LOW":                 "Low pressure system",
    }.get(storm_type, "Low pressure system")

    # Model-derived systems all carry type "LOW"; the warning tier knows
    # better. 64 kt deserves "Hurricane-force storm", not "low pressure".
    if storm_type == "LOW":
        tier_label = {
            "hurricane": "Hurricane-force storm",
            "storm":     "Storm-force low",
            "gale":      "Gale-force low",
        }.get(storm.get("warning_tier"))
        if tier_label:
            type_label = tier_label

    ns = f"{abs(storm_lat):.0f}°{'N' if storm_lat >= 0 else 'S'}"
    ew = f"{abs(storm_lon):.0f}°{'E' if storm_lon >= 0 else 'W'}"
    ocean_phrase = f" ({ocean.replace('-', ' ').title()})" if ocean else ""
    position_phrase = f"{ns}, {ew}{ocean_phrase}"

    direct_hits = [r for r in region_impacts if r["impact_tier"] == "direct"]
    if not direct_hits:
        # Partial/glancing energy is still surf-relevant — say so instead of
        # writing the storm off entirely.
        lesser = [r for r in region_impacts if r["impact_tier"] in ("glancing", "partial")]
        if lesser:
            names = ", ".join(r["label"] for r in lesser[:3])
            return (
                f"{type_label} at {position_phrase}. "
                f"Sends modest swell toward {names} — no direct hits in the "
                f"{len(region_impacts)}-region forecast window."
            )
        return (
            f"{type_label} at {position_phrase}. "
            f"No surf-relevant regions in the {len(region_impacts)}-region forecast window."
        )

    best = next((r for r in direct_hits if r.get("is_best_exposure")), direct_hits[0])
    now  = datetime.utcnow()

    def to_day(hours: float) -> str:
        return (now + timedelta(hours=hours)).strftime("%a %b %-d")

    arrival_day = to_day(best["arrival_hours"])
    peak_day    = to_day(best["peak_arrival_hours"])
    fade_day    = to_day(best["fade_hours"])
    facing_str  = "/".join(best["facing"])

    also_regions = [r for r in direct_hits if r["region_id"] != best["region_id"]]
    also_clause = ""
    if also_regions:
        names = ", ".join(r["label"] for r in also_regions[:2])
        also_clause = f" Also reaches {names}."

    landfall_clause = ""
    if storm.get("will_make_landfall"):
        eta = int(storm.get("landfall_eta_hours") or 0)
        if storm.get("landfall_before_peak"):
            landfall_clause = f" Caution: storm makes landfall in ~{eta}h, before peak intensity."
        else:
            landfall_clause = f" Storm may make landfall in ~{eta}h."

    return (
        f"{type_label} at {position_phrase}. "
        f"Swell arrives {best['label']} {arrival_day}, "
        f"peaks {peak_day} and runs through {fade_day}. "
        f"Best exposure: {best['label']} ({facing_str}-facing spots)."
        f"{also_clause}{landfall_clause} "
        f"Keep an eye on your spot report for fine-grain timing."
    )
