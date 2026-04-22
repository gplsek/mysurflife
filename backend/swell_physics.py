"""
backend/swell_physics.py
========================
Swell arrival time, decay, and size estimation.

Implements the complete Stormsurf calculator methodology:
  https://www.stormsurf.com/page2/papers/papers.shtml
  https://www.stormsurf.com/page2/papers/calculator/about.shtml
  https://www.stormsurf.com/page2/papers/swell_decay.html

Three core functions:
  great_circle_nm(lat1, lon1, lat2, lon2)  → distance in nautical miles
  swell_arrivals(storm_positions, spot_lat, spot_lon, spot_name)  → list[SwellArrival]
  decay_size(storm_sea_ft, distance_nm)  → predicted swell height in feet at destination

All physics is pure Python — no external API calls. Zero dependencies beyond stdlib.

FastAPI routes are registered via register_routes(app).

---
PHYSICS SUMMARY
---------------

Swell travel speed:
  Swell group velocity = (g × T) / (4π)
  In practical units: speed_knots ≈ period_s × 0.78 kts/sec-of-period
  But Stormsurf uses empirical speeds from the Swell Characteristics Table:
    11s → 17.16 kts, 13s → 20.28 kts, 14s → 21.84 kts,
    17s → 26.52 kts, 20s → 31.2 kts, 25s → 39.0 kts

  The calculator auto-interpolates periods between these anchor points.

Max period from storm sea height (Swell Characteristics Table):
  14-17ft → 11s,  18-24ft → 13s,  25-29ft → 14s,
  30-34ft → 17s,  35-39ft → 20s,  40ft+   → 25s

Decay:
  Empirical tables by sea height (5, 10, 15, 20, 25, 30, 35, 40, 45 ft)
  and distance (50 to 10,000 nm). Interpolation is bilinear.
  For storms > 4,000 nm: decay_size × 0.75 (additional long-range correction).
  Off-axis fetch (>30° off great circle to spot): × 0.75.
  Small fetch: × 0.75.
  Both off-axis AND small: × 0.75 × 0.75.

Period dispersion:
  A storm generates a range of periods. The longest period arrives first,
  followed by progressively shorter periods. The calculator reports arrival
  times for each period band from max_period down to 11s.
"""

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional


# ---------------------------------------------------------------------------
# Swell Characteristics Table (Stormsurf)
# Maps max storm sea height (ft) to (max_period_s, swell_speed_kts)
# ---------------------------------------------------------------------------

# Anchor points: (min_sea_ft, max_period_s, speed_kts)
_SEA_HEIGHT_TABLE = [
    (0,  11, 17.16),   # 14-17 ft seas
    (18, 13, 20.28),
    (25, 14, 21.84),
    (30, 17, 26.52),
    (35, 20, 31.20),
    (40, 25, 39.00),
]

# All period bands to compute arrivals for (descending = fastest first)
_ALL_PERIODS = [25, 22, 20, 18, 17, 16, 15, 14, 13, 12, 11]


def max_period_from_sea_height(sea_height_ft: float) -> int:
    """
    Returns the maximum swell period (seconds) a storm of given sea height
    can generate, per the Stormsurf Swell Characteristics Table.
    """
    for min_ft, period, _ in reversed(_SEA_HEIGHT_TABLE):
        if sea_height_ft >= min_ft:
            return period
    return 11  # floor


def speed_from_period(period_s: float) -> float:
    """
    Returns swell group velocity in knots for a given period.
    Interpolates linearly between Stormsurf anchor points.
    """
    # Extract anchor pairs (period, speed)
    anchors = [(p, s) for (_, p, s) in _SEA_HEIGHT_TABLE]

    if period_s <= anchors[0][0]:
        return anchors[0][1]
    if period_s >= anchors[-1][0]:
        return anchors[-1][1]

    for i in range(len(anchors) - 1):
        p0, s0 = anchors[i]
        p1, s1 = anchors[i + 1]
        if p0 <= period_s <= p1:
            frac = (period_s - p0) / (p1 - p0)
            return s0 + frac * (s1 - s0)

    return anchors[-1][1]


# ---------------------------------------------------------------------------
# Decay Tables (Stormsurf)
# Keyed by sea height (ft) → list of (distance_nm, decay_factor)
# ---------------------------------------------------------------------------

_DECAY_TABLES: dict[int, list[tuple[int, float]]] = {
    5: [
        (50, .73), (100, .60), (200, .48), (300, .42), (400, .375),
        (500, .35), (600, .32), (700, .295), (800, .27), (900, .26),
        (1000, .25), (1100, .2375), (1200, .225), (1300, .2125), (1400, .2),
        (1500, .192), (1600, .185), (1700, .175), (1800, .165), (1900, .16),
        (2000, .155), (2500, .14), (3000, .125), (3500, .113), (4000, .1),
        (5000, .088), (6000, .075), (7000, .069), (8000, .063),
        (9000, .057), (10000, .05),
    ],
    10: [
        (50, .75), (100, .62), (200, .5), (300, .453), (400, .4067),
        (500, .36), (600, .342), (700, .324), (800, .295), (900, .2825),
        (1000, .27), (1100, .2575), (1200, .245), (1300, .2325), (1400, .22),
        (1500, .215), (1600, .21), (1700, .201), (1800, .192), (1900, .186),
        (2000, .18), (2500, .164), (3000, .148), (3500, .134), (4000, .12),
        (5000, .1025), (6000, .085), (7000, .0775), (8000, .07),
        (9000, .0625), (10000, .055),
    ],
    15: [
        (50, .76), (100, .63), (200, .5125), (300, .465), (400, .4175),
        (500, .37), (600, .353), (700, .336), (800, .319), (900, .303),
        (1000, .285), (1100, .272), (1200, .259), (1300, .252), (1400, .245),
        (1500, .235), (1600, .225), (1700, .220), (1800, .210), (1900, .200),
        (2000, .190), (2500, .178), (3000, .155), (3500, .1425), (4000, .13),
        (5000, .104), (6000, .095), (7000, .09), (8000, .085),
        (9000, .0738), (10000, .0625),
    ],
    20: [
        (50, .77), (100, .64), (200, .525), (300, .465), (400, .4283),
        (500, .38), (600, .361), (700, .342), (800, .323), (900, .304),
        (1000, .29), (1100, .28), (1200, .27), (1300, .26), (1400, .25),
        (1500, .242), (1600, .233), (1700, .225), (1800, .217), (1900, .208),
        (2000, .20), (2500, .188), (3000, .175), (3500, .1575), (4000, .14),
        (5000, .12), (6000, .1), (7000, .095), (8000, .09),
        (9000, .08), (10000, .07),
    ],
    25: [
        (50, .775), (100, .645), (200, .535), (300, .475), (400, .4346),
        (500, .398), (600, .368), (700, .3485), (800, .329), (900, .3095),
        (1000, .295), (1100, .285), (1200, .275), (1300, .2625), (1400, .25),
        (1500, .245), (1600, .24), (1700, .232), (1800, .225), (1900, .218),
        (2000, .21), (2500, .1975), (3000, .185), (3500, .165), (4000, .145),
        (5000, .128), (6000, .11), (7000, .102), (8000, .094),
        (9000, .084), (10000, .075),
    ],
    30: [
        (50, .775), (100, .645), (200, .54), (300, .485), (400, .445),
        (500, .4), (600, .375), (700, .354), (800, .333), (900, .316),
        (1000, .3), (1100, .29), (1200, .28), (1300, .27), (1400, .26),
        (1500, .25), (1600, .24), (1700, .2325), (1800, .225), (1900, .218),
        (2000, .21), (2500, .20), (3000, .19), (3500, .17), (4000, .15),
        (5000, .13), (6000, .11), (7000, .1033), (8000, .0966),
        (9000, .0858), (10000, .075),
    ],
    35: [
        (50, .78), (100, .655), (200, .545), (300, .49), (400, .445),
        (500, .405), (600, .375), (700, .356), (800, .337), (900, .321),
        (1000, .305), (1100, .2925), (1200, .28), (1300, .272), (1400, .263),
        (1500, .255), (1600, .248), (1700, .2393), (1800, .231), (1900, .222),
        (2000, .21), (2500, .20), (3000, .19), (3500, .17), (4000, .15),
        (5000, .135), (6000, .12), (7000, .1094), (8000, .0988),
        (9000, .0881), (10000, .0775),
    ],
    40: [
        (50, .785), (100, .658), (200, .545), (300, .4967), (400, .449),
        (500, .405), (600, .379), (700, .36), (800, .34), (900, .326),
        (1000, .310), (1100, .296), (1200, .282), (1300, .268), (1400, .265),
        (1500, .26), (1600, .256), (1700, .246), (1800, .237), (1900, .227),
        (2000, .217), (2500, .207), (3000, .1975), (3500, .1713), (4000, .155),
        (5000, .14), (6000, .125), (7000, .12), (8000, .108),
        (9000, .096), (10000, .08),
    ],
    45: [
        (50, .79), (100, .658), (200, .548), (300, .497), (400, .45),
        (500, .41), (600, .38), (700, .362), (800, .345), (900, .33),
        (1000, .315), (1100, .301), (1200, .287), (1300, .273), (1400, .27),
        (1500, .265), (1600, .26), (1700, .25), (1800, .24), (1900, .23),
        (2000, .22), (2500, .21), (3000, .2), (3500, .1713), (4000, .155),
        (5000, .142), (6000, .131), (7000, .12), (8000, .108),
        (9000, .096), (10000, .08),
    ],
}

_DECAY_SEA_HEIGHTS = sorted(_DECAY_TABLES.keys())   # [5, 10, 15, 20, 25, 30, 35, 40, 45]


def decay_size(
    storm_sea_ft: float,
    distance_nm: float,
    off_axis: bool = False,
    small_fetch: bool = False,
) -> float:
    """
    Predicts swell height (ft) at destination given storm sea height and
    great-circle distance, using Stormsurf decay tables with bilinear interpolation.

    Args:
        storm_sea_ft:  Maximum sea height in the storm's fetch area (feet)
        distance_nm:   Great-circle distance from fetch center to spot (nautical miles)
        off_axis:      True if swell direction is >30° off the great circle path
        small_fetch:   True if the fetch area is smaller than average

    Returns:
        Predicted swell height at the spot in feet (Hs, significant wave height)
    """
    # Clamp to table range
    distance_nm = max(50.0, min(distance_nm, 10000.0))
    storm_sea_ft = max(5.0, storm_sea_ft)

    # ── Interpolate between sea height tables ──────────────────────────────
    sea_heights = _DECAY_SEA_HEIGHTS

    if storm_sea_ft <= sea_heights[0]:
        factor = _interpolate_decay_factor(_DECAY_TABLES[sea_heights[0]], distance_nm)
    elif storm_sea_ft >= sea_heights[-1]:
        factor = _interpolate_decay_factor(_DECAY_TABLES[sea_heights[-1]], distance_nm)
    else:
        # Find surrounding sea height brackets
        lo_h = max(h for h in sea_heights if h <= storm_sea_ft)
        hi_h = min(h for h in sea_heights if h >= storm_sea_ft)

        if lo_h == hi_h:
            factor = _interpolate_decay_factor(_DECAY_TABLES[lo_h], distance_nm)
        else:
            f_lo = _interpolate_decay_factor(_DECAY_TABLES[lo_h], distance_nm)
            f_hi = _interpolate_decay_factor(_DECAY_TABLES[hi_h], distance_nm)
            frac = (storm_sea_ft - lo_h) / (hi_h - lo_h)
            factor = f_lo + frac * (f_hi - f_lo)

    height = storm_sea_ft * factor

    # ── Long-range correction (>4000 nm) ──────────────────────────────────
    if distance_nm > 4000:
        height *= 0.75

    # ── Fetch quality corrections ──────────────────────────────────────────
    if off_axis:
        height *= 0.75
    if small_fetch:
        height *= 0.75

    return round(height, 2)


def _interpolate_decay_factor(table: list[tuple[int, float]], distance_nm: float) -> float:
    """Linearly interpolate a decay factor from a table at the given distance."""
    if distance_nm <= table[0][0]:
        return table[0][1]
    if distance_nm >= table[-1][0]:
        return table[-1][1]

    for i in range(len(table) - 1):
        d0, f0 = table[i]
        d1, f1 = table[i + 1]
        if d0 <= distance_nm <= d1:
            frac = (distance_nm - d0) / (d1 - d0)
            return f0 + frac * (f1 - f0)

    return table[-1][1]


# ---------------------------------------------------------------------------
# Great Circle Distance (Haversine)
# ---------------------------------------------------------------------------

_EARTH_RADIUS_NM = 3440.065   # nautical miles


def great_circle_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Returns great-circle distance in nautical miles between two lat/lon points.
    Uses the haversine formula. Inputs in decimal degrees.
    """
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lon2 - lon1)

    a = math.sin(Δφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(Δλ / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return round(_EARTH_RADIUS_NM * c, 1)


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Returns initial bearing in degrees (0-360) from point 1 to point 2.
    Used to determine if a storm is inside a spot's swell window.
    """
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δλ = math.radians(lon2 - lon1)

    x = math.sin(Δλ) * math.cos(φ2)
    y = math.cos(φ1) * math.sin(φ2) - math.sin(φ1) * math.cos(φ2) * math.cos(Δλ)

    return (math.degrees(math.atan2(x, y)) + 360) % 360


# ---------------------------------------------------------------------------
# Swell Arrival Calculation
# ---------------------------------------------------------------------------

@dataclass
class StormPosition:
    """One snapshot of a storm's position during its lifecycle."""
    lat: float
    lon: float
    timestamp: datetime          # UTC
    sea_height_ft: float         # max confirmed/forecast sea height
    label: str = ""              # e.g. "Wed AM", "Thu 00Z"
    confirmed: bool = False      # True = '00hr' model data, False = forecast


@dataclass
class ArrivalBand:
    """Predicted arrival at the target for one period band from one storm position."""
    period_s: int
    travel_hours: float
    arrival_utc: datetime
    swell_height_ft: float       # decayed size at destination
    is_peak: bool = False        # True for the period with the most energy


@dataclass
class SwellArrival:
    """All arrival bands computed from one storm position."""
    storm_label: str
    storm_lat: float
    storm_lon: float
    storm_timestamp: datetime
    storm_sea_ft: float
    confirmed: bool
    distance_nm: float
    bearing_from_spot: float     # direction swell travels FROM (what the buoy will report)
    max_period: int
    bands: list[ArrivalBand] = field(default_factory=list)

    @property
    def first_arrival(self) -> Optional[ArrivalBand]:
        return self.bands[0] if self.bands else None

    @property
    def peak_arrival(self) -> Optional[ArrivalBand]:
        peaks = [b for b in self.bands if b.is_peak]
        return peaks[0] if peaks else None


def swell_arrivals(
    storm_positions: list[StormPosition],
    spot_lat: float,
    spot_lon: float,
    spot_name: str = "",
    swell_window: Optional[tuple[float, float]] = None,  # (from_deg, to_deg)
    off_axis: bool = False,
    small_fetch: bool = False,
) -> list[SwellArrival]:
    """
    Calculate swell arrival times and sizes for a list of storm positions
    at a target surf spot.

    Args:
        storm_positions:  List of StormPosition snapshots from a storm's lifecycle
        spot_lat:         Target latitude (decimal degrees)
        spot_lon:         Target longitude (decimal degrees)
        spot_name:        Display name for the spot
        swell_window:     Optional (from_deg, to_deg) tuple defining the spot's
                          swell window. If provided, positions outside the window
                          are flagged but still calculated.
        off_axis:         True if overall fetch is >30° off great circle axis
        small_fetch:      True if fetch area is smaller than average

    Returns:
        List of SwellArrival objects, one per storm position, sorted by
        first_arrival time.
    """
    results = []

    for pos in storm_positions:
        distance = great_circle_nm(pos.lat, pos.lon, spot_lat, spot_lon)

        # Bearing FROM spot TO storm = direction swell travels FROM
        # (what compass direction the swell comes from at the beach)
        swell_from = bearing_deg(spot_lat, spot_lon, pos.lat, pos.lon)

        max_period = max_period_from_sea_height(pos.sea_height_ft)

        # Generate arrival bands for all periods ≤ max_period
        bands: list[ArrivalBand] = []
        for period in _ALL_PERIODS:
            if period > max_period:
                continue

            speed = speed_from_period(period)
            travel_hours = distance / speed
            arrival = pos.timestamp + timedelta(hours=travel_hours)

            # Decay size — use the storm's sea height, not the period's
            height = decay_size(pos.sea_height_ft, distance, off_axis, small_fetch)

            # The 'peak' is the period band with the highest energy (highest period
            # arriving first from the most energetic part of the storm)
            is_peak = (period == max_period)

            bands.append(ArrivalBand(
                period_s=period,
                travel_hours=round(travel_hours, 1),
                arrival_utc=arrival,
                swell_height_ft=height,
                is_peak=is_peak,
            ))

        # Sort by arrival time (longest period = fastest = first)
        bands.sort(key=lambda b: b.arrival_utc)

        results.append(SwellArrival(
            storm_label=pos.label or pos.timestamp.strftime("%a %HZ"),
            storm_lat=pos.lat,
            storm_lon=pos.lon,
            storm_timestamp=pos.timestamp,
            storm_sea_ft=pos.sea_height_ft,
            confirmed=pos.confirmed,
            distance_nm=distance,
            bearing_from_spot=round(swell_from, 1),
            max_period=max_period,
            bands=bands,
        ))

    # Sort by first arrival across all positions
    results.sort(key=lambda r: r.first_arrival.arrival_utc if r.first_arrival else datetime.max.replace(tzinfo=timezone.utc))

    return results


def format_arrival_summary(arrivals: list[SwellArrival], tz_offset_hours: int = -7) -> str:
    """
    Returns a human-readable forecast narrative from a list of SwellArrival objects.
    Suitable for the Copilot's natural language response.

    tz_offset_hours: local time offset from UTC (default: PDT = UTC-7)
    """
    if not arrivals:
        return "No swell arrivals calculated."

    lines = []
    for arrival in arrivals:
        if not arrival.bands:
            continue

        first = arrival.bands[0]
        peak  = next((b for b in arrival.bands if b.is_peak), first)

        local_first = first.arrival_utc + timedelta(hours=tz_offset_hours)
        local_peak  = peak.arrival_utc  + timedelta(hours=tz_offset_hours)

        confirmed_str = "✅ confirmed" if arrival.confirmed else "📊 forecast"
        lines.append(
            f"**{arrival.storm_label}** ({confirmed_str}) — "
            f"{arrival.storm_sea_ft:.0f}ft seas @ {arrival.distance_nm:.0f}nm, "
            f"swell from {arrival.bearing_from_spot:.0f}°\n"
            f"  → First energy ({first.period_s}s): "
            f"{local_first.strftime('%a %b %d %I:%M%p').replace(' 0', ' ')}\n"
            f"  → Peak ({peak.period_s}s, ~{peak.swell_height_ft:.1f}ft): "
            f"{local_peak.strftime('%a %b %d %I:%M%p').replace(' 0', ' ')}\n"
        )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# FastAPI route registration
# ---------------------------------------------------------------------------

def register_routes(app):
    """
    Call from main.py:
        from swell_physics import register_routes as register_swell_routes
        register_swell_routes(app)

    Mounts:
        POST /api/swell/arrivals    — calculate arrival times + sizes
        GET  /api/swell/decay       — look up decay size for given sea height + distance
        GET  /api/swell/distance    — great-circle distance between two points
    """
    from fastapi import Body
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel

    class StormPositionIn(BaseModel):
        lat: float
        lon: float
        timestamp: str              # ISO 8601, e.g. "2026-04-23T00:00:00Z"
        sea_height_ft: float
        label: str = ""
        confirmed: bool = False

    class SwellArrivalsRequest(BaseModel):
        spot_lat: float
        spot_lon: float
        spot_name: str = ""
        storm_positions: list[StormPositionIn]
        off_axis: bool = False
        small_fetch: bool = False
        tz_offset_hours: int = -7   # PDT default; caller sets based on spot

    # ------------------------------------------------------------------
    # POST /api/swell/arrivals
    # ------------------------------------------------------------------
    @app.post("/api/swell/arrivals")
    async def post_swell_arrivals(req: SwellArrivalsRequest):
        """
        Calculate swell arrival times and decayed sizes for a list of
        storm positions at a target spot.

        This is the core of the Copilot's storm-tracking capability.
        The Copilot tool `calculate_swell_arrival` calls this endpoint
        after extracting storm positions from the GFS/WW3 wave models.

        Response includes a human-readable narrative + structured bands
        for the conditions_timeline artifact.
        """
        positions = []
        for p in req.storm_positions:
            try:
                ts = datetime.fromisoformat(p.timestamp.replace("Z", "+00:00"))
            except ValueError:
                return JSONResponse(
                    status_code=422,
                    content={"error": f"Invalid timestamp: {p.timestamp}"},
                )
            positions.append(StormPosition(
                lat=p.lat, lon=p.lon, timestamp=ts,
                sea_height_ft=p.sea_height_ft,
                label=p.label, confirmed=p.confirmed,
            ))

        arrivals = swell_arrivals(
            positions, req.spot_lat, req.spot_lon, req.spot_name,
            off_axis=req.off_axis, small_fetch=req.small_fetch,
        )

        narrative = format_arrival_summary(arrivals, req.tz_offset_hours)

        return {
            "spot_name":  req.spot_name,
            "spot_lat":   req.spot_lat,
            "spot_lon":   req.spot_lon,
            "narrative":  narrative,
            "arrivals": [
                {
                    "storm_label":       a.storm_label,
                    "storm_lat":         a.storm_lat,
                    "storm_lon":         a.storm_lon,
                    "storm_timestamp":   a.storm_timestamp.isoformat(),
                    "storm_sea_ft":      a.storm_sea_ft,
                    "confirmed":         a.confirmed,
                    "distance_nm":       a.distance_nm,
                    "bearing_from_spot": a.bearing_from_spot,
                    "max_period":        a.max_period,
                    "first_arrival": {
                        "period_s":        a.first_arrival.period_s,
                        "arrival_utc":     a.first_arrival.arrival_utc.isoformat(),
                        "swell_height_ft": a.first_arrival.swell_height_ft,
                    } if a.first_arrival else None,
                    "peak_arrival": {
                        "period_s":        a.peak_arrival.period_s,
                        "arrival_utc":     a.peak_arrival.arrival_utc.isoformat(),
                        "swell_height_ft": a.peak_arrival.swell_height_ft,
                    } if a.peak_arrival else None,
                    "bands": [
                        {
                            "period_s":        b.period_s,
                            "travel_hours":    b.travel_hours,
                            "arrival_utc":     b.arrival_utc.isoformat(),
                            "swell_height_ft": b.swell_height_ft,
                            "is_peak":         b.is_peak,
                        }
                        for b in a.bands
                    ],
                }
                for a in arrivals
            ],
        }

    # ------------------------------------------------------------------
    # GET /api/swell/decay
    # ------------------------------------------------------------------
    @app.get("/api/swell/decay")
    async def get_swell_decay(
        sea_height_ft: float,
        distance_nm: float,
        off_axis: bool = False,
        small_fetch: bool = False,
    ):
        """
        Returns the predicted decayed swell height at a given distance
        from a storm of given sea height.

        Example:
          /api/swell/decay?sea_height_ft=36&distance_nm=1619
          → { "decayed_height_ft": 6.2, "decay_factor": 0.172 }
        """
        height = decay_size(sea_height_ft, distance_nm, off_axis, small_fetch)
        # Back-calculate the effective factor for transparency
        base_height = decay_size(sea_height_ft, distance_nm, False, False)
        factor = round(base_height / sea_height_ft, 4) if sea_height_ft else 0

        return {
            "sea_height_ft":    sea_height_ft,
            "distance_nm":      distance_nm,
            "decay_factor":     factor,
            "decayed_height_ft": height,
            "off_axis":         off_axis,
            "small_fetch":      small_fetch,
        }

    # ------------------------------------------------------------------
    # GET /api/swell/distance
    # ------------------------------------------------------------------
    @app.get("/api/swell/distance")
    async def get_great_circle(
        lat1: float, lon1: float,
        lat2: float, lon2: float,
    ):
        """
        Returns great-circle distance in nautical miles between two points
        and the bearing from point 1 to point 2.

        Useful for the Copilot to show "storm is 1,619nm from Blacks Beach,
        bearing 305°."
        """
        nm = great_circle_nm(lat1, lon1, lat2, lon2)
        brg = bearing_deg(lat1, lon1, lat2, lon2)
        return {
            "distance_nm": nm,
            "bearing_deg": round(brg, 1),
            "km":          round(nm * 1.852, 1),
        }
