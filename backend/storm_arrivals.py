"""
storm_arrivals.py — Compute where a storm's swell will arrive, when, and at what height.

Called by GET /api/storms/{storm_id}/arrivals → StormCard L2/L3.

Physics:
  Deep-water group velocity:  Cg = g*T/(4*pi) ≈ 0.78*T m/s
  Height decay:               H(r) ∝ 1/sqrt(r/r0) * exp(-r/5000km)
  Period estimate:            T ≈ 0.06*wind_kts + 8  (empirical 8–20s cap)
  Directional window:         regions within ±120° of storm movement receive swell
"""
import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

# ── Surf region table ────────────────────────────────────────────────────────
# lat/lon = representative centroid for distance/bearing math
SURF_REGIONS = [
    {"id": "socal",       "name": "Southern California",   "parent": "California",        "lat":  33.7, "lon": -118.5},
    {"id": "cencal",      "name": "Central California",    "parent": "California",        "lat":  35.5, "lon": -121.0},
    {"id": "norcal",      "name": "Northern California",   "parent": "California",        "lat":  38.5, "lon": -123.5},
    {"id": "hawaii-n",    "name": "North Shore Oahu",      "parent": "Hawaii",            "lat":  21.7, "lon": -158.0},
    {"id": "hawaii-s",    "name": "South Shore Oahu",      "parent": "Hawaii",            "lat":  21.2, "lon": -157.9},
    {"id": "pnw",         "name": "Pacific Northwest",     "parent": "Washington/Oregon", "lat":  47.5, "lon": -124.5},
    {"id": "baja",        "name": "Baja California",       "parent": "Mexico",            "lat":  29.0, "lon": -115.0},
    {"id": "us-east-mid", "name": "Mid-Atlantic",          "parent": "US East Coast",     "lat":  35.0, "lon":  -75.5},
    {"id": "us-east-ne",  "name": "New England",           "parent": "US East Coast",     "lat":  41.5, "lon":  -70.5},
    {"id": "bali",        "name": "Bali",                  "parent": "Indonesia",         "lat":  -8.7, "lon":  115.2},
    {"id": "japan-pac",   "name": "Pacific Coast Japan",   "parent": "Japan",             "lat":  35.5, "lon":  136.5},
    {"id": "aus-east",    "name": "Gold Coast",            "parent": "Australia",         "lat": -28.0, "lon":  153.5},
    {"id": "aus-west",    "name": "Margaret River",        "parent": "Australia",         "lat": -33.9, "lon":  114.9},
    {"id": "ireland",     "name": "West Ireland",          "parent": "Europe",            "lat":  53.5, "lon":   -9.5},
    {"id": "cape-town",   "name": "Cape Town",             "parent": "South Africa",      "lat": -34.0, "lon":   18.5},
]

_COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
_COMPASS_DEG = {c: i * 22.5 for i, c in enumerate(_COMPASS)}

_MIN_HEIGHT_FT = 3.0
_MAX_RANGE_KM  = 8000


# ── Geometry helpers ────────────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return 2 * R * math.asin(math.sqrt(min(1.0, a)))


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Bearing FROM point 1 TO point 2. 0=N, 90=E, 180=S, 270=W."""
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dλ = math.radians(lon2 - lon1)
    x = math.sin(dλ) * math.cos(φ2)
    y = math.cos(φ1) * math.sin(φ2) - math.sin(φ1) * math.cos(φ2) * math.cos(dλ)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


def _deg_to_compass(deg: float) -> str:
    return _COMPASS[round(deg / 22.5) % 16]


# ── Swell physics ───────────────────────────────────────────────────────────

def _estimate_period(wind_kts: float) -> float:
    return min(20.0, max(8.0, 0.06 * wind_kts + 8.0))


def _group_speed_kmh(period_s: float) -> float:
    return 0.78 * period_s * 3.6  # Cg m/s → km/h


def _arrival_height_ft(source_ft: float, dist_km: float, period_s: float, dir_factor: float) -> float:
    """
    Calibrated to match real-world observations:
    45-kt storm, 18ft seas at ~4000 km → ~4-5ft arrival at CA.
    ref=1500km, dissipation e-fold=8000km.
    """
    if dist_km < 100:
        return source_ft * dir_factor
    ref = 1500.0
    spreading    = math.sqrt(ref / max(dist_km, ref))
    dissipation  = math.exp(-dist_km / 8000.0)
    period_bonus = min(1.2, period_s / 14.0)
    return source_ft * spreading * dissipation * period_bonus * dir_factor


# ── Formatting ──────────────────────────────────────────────────────────────

def _fmt_dt(dt: datetime) -> str:
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    h = dt.hour
    d = days[dt.weekday()]
    if h == 0:  return f"{d} midnight"
    if h < 12:  return f"{d} {h}am"
    if h == 12: return f"{d} noon"
    return f"{d} {h - 12}pm"


def _score_from_ft(ft: float) -> int:
    if ft >= 10: return 5
    if ft >= 7:  return 4
    if ft >= 5:  return 3
    if ft >= 3:  return 2
    return 1


def _tier_from_score(score: int) -> str:
    return {5: "firing", 4: "solid", 3: "good", 2: "fair"}.get(score, "flat")


# ── Region → spots matching ──────────────────────────────────────────────────

def _spots_for_region(
    region: Dict,
    db_spots: List[Dict],
    peak_ft: float,
    period_s: float,
    arrival_dir: str,
    arrival_dt: datetime,
) -> List[Dict]:
    rl = region["name"].lower()
    pl = region["parent"].lower()

    matched = [
        s for s in db_spots
        if (rl in (s.get("region") or "").lower() or
            pl in (s.get("region") or "").lower() or
            rl in (s.get("subregion") or "").lower() or
            pl in (s.get("subregion") or "").lower())
    ]

    out = []
    for spot in sorted(matched, key=lambda s: s.get("rating") or 0, reverse=True)[:10]:
        wind_mph = spot.get("wind_mph")
        wind_str = f"{round(wind_mph)} mph" if wind_mph is not None else "—"

        first_str = _fmt_dt(arrival_dt)
        peak_str  = _fmt_dt(arrival_dt + timedelta(hours=8))

        # Blend forecast swell score with current spot rating
        forecast_score = _score_from_ft(peak_ft)
        current_rating = spot.get("rating") or 0
        blended = round((forecast_score * 0.6 + (current_rating / 1.0) * 0.4))
        score = max(1, min(5, blended))

        out.append({
            "id":         spot["slug"],
            "name":       spot["name"],
            "ft":         round(peak_ft, 1),
            "period":     f"{round(period_s)}s",
            "dir":        arrival_dir,
            "first":      first_str,
            "peak":       peak_str,
            "score":      score,
            "wind":       wind_str,
            "wind_class": "",
            "tide":       "—",
            "tide_class": "",
        })

    return out


# ── Public API ───────────────────────────────────────────────────────────────

def compute_arrivals(storm: Dict, db_spots: List[Dict]) -> List[Dict]:
    """
    Compute swell arrivals for a storm.

    Args:
        storm:     Storm dict (lat, lon, wind_kts, sea_height_ft, movement).
        db_spots:  List of spot dicts from DB (slug, name, region, subregion,
                   latitude, longitude, rating, wind_mph).

    Returns:
        List of arrival dicts sorted by peak_ft desc. Each:
        {region_id, name, parent, peak_ft, peak_when, window_h, tier, spots, total_spots}
    """
    storm_lat = storm.get("lat") or 0
    storm_lon = storm.get("lon") or 0
    wind_kts  = storm.get("wind_kts") or 20
    seas_ft   = storm.get("sea_height_ft") or max(4.0, wind_kts * 0.15)

    movement  = storm.get("movement") or {}
    mov_str   = movement.get("direction")
    mov_deg   = _COMPASS_DEG.get(mov_str, -1.0) if mov_str else -1.0

    now_utc = datetime.now(tz=timezone.utc)

    # Build list of positions to evaluate: current position + forecast track.
    # Each track waypoint adds a future swell source — the envelope (max across all
    # positions) gives a more accurate peak height and arrival time than current
    # position alone.
    positions = [{
        "lat":         storm_lat,
        "lon":         storm_lon,
        "wind_kts":    wind_kts,
        "seas_ft":     seas_ft,
        "mov_deg":     mov_deg,
        "hours_ahead": 0,
    }]
    for tp in (storm.get("forecast_track") or []):
        if tp.get("lat") is None or tp.get("lon") is None:
            continue
        tp_wind = tp.get("wind_kts") or wind_kts
        positions.append({
            "lat":         tp["lat"],
            "lon":         tp["lon"],
            "wind_kts":    tp_wind,
            "seas_ft":     tp.get("sea_height_ft") or max(4.0, tp_wind * 0.15),
            "mov_deg":     mov_deg,  # assume same general movement direction
            "hours_ahead": tp.get("hours_ahead") or 0,
        })

    # Best arrival per region across all positions
    region_best: Dict[str, Dict] = {}

    for pos in positions:
        pos_period = _estimate_period(pos["wind_kts"])
        pos_speed  = _group_speed_kmh(pos_period)

        for region in SURF_REGIONS:
            dist_km = _haversine_km(pos["lat"], pos["lon"], region["lat"], region["lon"])
            if dist_km > _MAX_RANGE_KM:
                continue

            bearing = _bearing_deg(pos["lat"], pos["lon"], region["lat"], region["lon"])

            if pos["mov_deg"] >= 0:
                diff = _angle_diff(bearing, pos["mov_deg"])
                if diff > 120:
                    continue
                dir_factor = max(0.3, math.cos(math.radians(diff * 0.75)))
            else:
                dir_factor = 0.75

            peak_ft = _arrival_height_ft(pos["seas_ft"], dist_km, pos_period, dir_factor)
            if peak_ft < _MIN_HEIGHT_FT:
                continue

            travel_h   = dist_km / pos_speed
            arrival_dt = now_utc + timedelta(hours=pos["hours_ahead"] + travel_h)
            window_h   = max(12, min(72, round(dist_km / 800)))
            arrival_dir_deg = (bearing + 180) % 360
            arrival_dir     = _deg_to_compass(arrival_dir_deg)

            rid = region["id"]
            if rid not in region_best or peak_ft > region_best[rid]["peak_ft"]:
                region_best[rid] = {
                    "region":     region,
                    "peak_ft":    peak_ft,
                    "period_s":   pos_period,
                    "arrival_dt": arrival_dt,
                    "window_h":   window_h,
                    "arrival_dir": arrival_dir,
                }

    arrivals = []
    for best in region_best.values():
        region = best["region"]
        spots  = _spots_for_region(
            region, db_spots, best["peak_ft"], best["period_s"],
            best["arrival_dir"], best["arrival_dt"]
        )
        score  = _score_from_ft(best["peak_ft"])
        arrivals.append({
            "region_id":   region["id"],
            "name":        region["name"],
            "parent":      region["parent"],
            "peak_ft":     round(best["peak_ft"], 1),
            "peak_when":   _fmt_dt(best["arrival_dt"]),
            "window_h":    best["window_h"],
            "tier":        _tier_from_score(score),
            "spots":       spots,
            "total_spots": len(spots),
        })

    return sorted(arrivals, key=lambda x: x["peak_ft"], reverse=True)
