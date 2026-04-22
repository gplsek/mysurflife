"""
backend/tides.py
================
NOAA CO-OPS tide predictions for MySurfLife.

Provides:
  fetch_tide_timeline(station_id, start_dt, end_dt) -> list[TidePoint]
  derive_tide_state(points) -> augmented with 'state' field
  register_routes(app) -> mounts /api/tides/timeline on the FastAPI app

CO-OPS API used:
  https://api.tidesandcurrents.noaa.gov/api/prod/datagetter
  product=predictions  (harmonic tide predictions, available for any future date)
  interval=h           (hourly — matches our 6-hour forecast cadence)
  datum=MLLW           (standard surf reference)
  units=english        (feet)
  time_zone=lst_ldt    (local standard/daylight time at the station)

Caching:
  Tide predictions are deterministic (harmonic) — they don't change.
  Cache TTL is 6 hours in L1 (memory). Redis L2 if available.
  Key: tides:{station_id}:{date_range}

No API key required. Include application= param as courtesy to NOAA.
"""

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COOPS_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
APP_NAME   = "MySurfLife"
TIDE_TTL   = timedelta(hours=6)

# Vernacular tide state bands (feet, MLLW).
# Derived from the hi/lo cycle rather than absolute height — see derive_tide_state().
# These are *not* used for absolute height classification; they label the phase.
TIDE_STATES = ("low", "rising_low", "mid", "rising_high", "high", "falling")


# ---------------------------------------------------------------------------
# In-memory cache (mirrors pattern in main.py)
# ---------------------------------------------------------------------------

_tide_cache: dict[str, dict] = {}


def _cache_get(key: str) -> Any | None:
    entry = _tide_cache.get(key)
    if entry and datetime.now(timezone.utc) - entry["ts"] < TIDE_TTL:
        return entry["data"]
    return None


def _cache_set(key: str, data: Any) -> None:
    _tide_cache[key] = {"ts": datetime.now(timezone.utc), "data": data}


# ---------------------------------------------------------------------------
# Core fetch
# ---------------------------------------------------------------------------

async def fetch_tide_timeline(
    station_id: str,
    start_dt: datetime,
    end_dt: datetime,
) -> list[dict]:
    """
    Fetch hourly tide predictions from NOAA CO-OPS.

    Returns a list of dicts:
      {
        "t":      "2026-04-23 06:00",   # local time string from CO-OPS
        "v":      4.32,                 # tide height in feet (MLLW)
        "state":  "rising_low",         # derived from hi/lo cycle
        "is_high": False,
        "is_low":  False,
      }

    Raises httpx.HTTPError on network failure.
    Raises ValueError if CO-OPS returns an error payload.
    """
    begin = start_dt.strftime("%Y%m%d")
    end   = end_dt.strftime("%Y%m%d")
    cache_key = f"tides:{station_id}:{begin}:{end}"

    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    params = {
        "station":     station_id,
        "product":     "predictions",
        "datum":       "MLLW",
        "time_zone":   "lst_ldt",
        "interval":    "h",           # hourly
        "units":       "english",     # feet
        "application": APP_NAME,
        "format":      "json",
        "begin_date":  begin,
        "end_date":    end,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(COOPS_BASE, params=params)
        resp.raise_for_status()
        payload = resp.json()

    if "error" in payload:
        raise ValueError(f"CO-OPS error for station {station_id}: {payload['error']}")

    raw_points = payload.get("predictions", [])
    if not raw_points:
        return []

    # Parse heights
    points = []
    for p in raw_points:
        try:
            points.append({"t": p["t"], "v": float(p["v"])})
        except (KeyError, ValueError):
            continue

    # Augment with hi/lo and state
    points = _derive_tide_state(points)

    _cache_set(cache_key, points)
    return points


async def fetch_hilo(
    station_id: str,
    start_dt: datetime,
    end_dt: datetime,
) -> list[dict]:
    """
    Fetch high/low tide events only (for session log display).
    Returns list of {t, v, type: 'H'|'L'}.
    """
    begin = start_dt.strftime("%Y%m%d")
    end   = end_dt.strftime("%Y%m%d")
    cache_key = f"tides_hilo:{station_id}:{begin}:{end}"

    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    params = {
        "station":     station_id,
        "product":     "predictions",
        "datum":       "MLLW",
        "time_zone":   "lst_ldt",
        "interval":    "hilo",        # high/low only
        "units":       "english",
        "application": APP_NAME,
        "format":      "json",
        "begin_date":  begin,
        "end_date":    end,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(COOPS_BASE, params=params)
        resp.raise_for_status()
        payload = resp.json()

    if "error" in payload:
        raise ValueError(f"CO-OPS hi/lo error for {station_id}: {payload['error']}")

    result = []
    for p in payload.get("predictions", []):
        try:
            result.append({
                "t":    p["t"],
                "v":    float(p["v"]),
                "type": p.get("type", ""),   # 'H' or 'L'
            })
        except (KeyError, ValueError):
            continue

    _cache_set(cache_key, result)
    return result


# ---------------------------------------------------------------------------
# Tide state derivation
# ---------------------------------------------------------------------------

def _derive_tide_state(points: list[dict]) -> list[dict]:
    """
    Annotate each hourly point with:
      is_high (bool)  — local maximum within ±3h window
      is_low  (bool)  — local minimum within ±3h window
      state   (str)   — one of TIDE_STATES

    State logic (based on position in hi/lo cycle, not absolute height):
      Within 1h of a low:               "low"
      Rising, bottom third of range:    "rising_low"
      Rising, top third of range:       "rising_high"  (common "incoming" feeling)
      Within 1h of a high:              "high"
      Falling (any height):             "falling"
      Mid-range rising:                 "mid"
    """
    if not points:
        return points

    heights = [p["v"] for p in points]
    n = len(heights)

    # Find local extrema (simple ±3h window)
    highs = set()
    lows  = set()
    window = 3
    for i in range(n):
        lo = max(0, i - window)
        hi = min(n - 1, i + window)
        neighborhood = heights[lo:hi + 1]
        if heights[i] == max(neighborhood) and heights[i] > sum(neighborhood) / len(neighborhood):
            highs.add(i)
        if heights[i] == min(neighborhood) and heights[i] < sum(neighborhood) / len(neighborhood):
            lows.add(i)

    # Range for this window
    h_min = min(heights)
    h_max = max(heights)
    h_range = max(h_max - h_min, 0.1)   # avoid /0

    def _range_third(v):
        """Which third of the tidal range is this height in? 0=low, 1=mid, 2=high"""
        return min(int((v - h_min) / h_range * 3), 2)

    # Derive state for each point
    for i, p in enumerate(points):
        p["is_high"] = i in highs
        p["is_low"]  = i in lows

        # Is this point within 1 index (~1h) of a known extreme?
        near_high = any(abs(i - h) <= 1 for h in highs)
        near_low  = any(abs(i - l) <= 1 for l in lows)

        if near_low:
            state = "low"
        elif near_high:
            state = "high"
        else:
            # Determine direction: is the next point higher or lower?
            rising = (i < n - 1) and (heights[i + 1] > heights[i])
            third  = _range_third(p["v"])

            if rising:
                state = ("rising_low" if third == 0 else
                         "mid"        if third == 1 else
                         "rising_high")
            else:
                state = "falling"

        p["state"] = state

    return points


# ---------------------------------------------------------------------------
# FastAPI route registration
# ---------------------------------------------------------------------------

def register_routes(app):
    """
    Call this from main.py after the app is created:

        from tides import register_routes as register_tide_routes
        register_tide_routes(app)

    Mounts:
        GET /api/tides/timeline   — hourly predictions for a spot
        GET /api/tides/hilo       — hi/lo events for a spot or station
    """
    from fastapi import Query
    from fastapi.responses import JSONResponse

    # ------------------------------------------------------------------
    # GET /api/tides/timeline
    # ------------------------------------------------------------------
    @app.get("/api/tides/timeline")
    async def get_tides_timeline(
        spot_slug: str | None  = Query(None,  description="Spot slug — resolves tide_station_id from DB"),
        station:   str | None  = Query(None,  description="Override: explicit NOAA CO-OPS station ID"),
        days:      int         = Query(7,     ge=1, le=30, description="Days of predictions to return"),
    ):
        """
        Returns hourly tide predictions for a spot.

        Priority:
          1. If station= provided, use it directly.
          2. Else look up spot_slug in Supabase spots.tide_station_id.
          3. Fall back to the nearest hardcoded station if DB lookup fails.

        Response shape:
          {
            "station_id": "9410230",
            "station_name": "La Jolla, CA",
            "spot_slug": "blacks-beach",
            "unit": "ft",
            "datum": "MLLW",
            "timeline": [
              { "t": "2026-04-23 06:00", "v": 2.34, "state": "rising_low",
                "is_high": false, "is_low": false },
              ...
            ],
            "hilo": [
              { "t": "2026-04-23 08:12", "v": 4.56, "type": "H" },
              ...
            ]
          }

        The conditions_timeline artifact should merge this response with
        the wave/wind data from /api/surf-spots/{slug}/forecast-timeline
        using the "t" timestamp as the join key.
        """
        # ── Resolve station ID ─────────────────────────────────────────
        station_id   = station
        station_name = None

        if not station_id and spot_slug:
            station_id, station_name = await _resolve_station(spot_slug)

        if not station_id:
            return JSONResponse(
                status_code=422,
                content={"error": "Provide spot_slug or station param."},
            )

        # ── Date range ────────────────────────────────────────────────
        now   = datetime.now(timezone.utc)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end   = start + timedelta(days=days)

        # ── Fetch ─────────────────────────────────────────────────────
        try:
            timeline, hilo = await asyncio.gather(
                fetch_tide_timeline(station_id, start, end),
                fetch_hilo(station_id, start, end),
            )
        except ValueError as e:
            return JSONResponse(status_code=502, content={"error": str(e)})
        except httpx.HTTPError as e:
            return JSONResponse(
                status_code=502,
                content={"error": f"CO-OPS unavailable: {e}"},
            )

        return {
            "station_id":   station_id,
            "station_name": station_name or station_id,
            "spot_slug":    spot_slug,
            "unit":         "ft",
            "datum":        "MLLW",
            "days":         days,
            "timeline":     timeline,
            "hilo":         hilo,
        }

    # ------------------------------------------------------------------
    # GET /api/tides/hilo
    # Used by session log auto-population to get tide state at a past time.
    # ------------------------------------------------------------------
    @app.get("/api/tides/hilo")
    async def get_tides_hilo(
        station:    str = Query(..., description="NOAA CO-OPS station ID"),
        begin_date: str = Query(..., description="YYYYMMDD"),
        end_date:   str = Query(..., description="YYYYMMDD"),
    ):
        """
        Returns hi/lo tide events for a date range.
        Used by the session auto-population job to determine tide state
        at a historical session time.
        """
        try:
            start = datetime.strptime(begin_date, "%Y%m%d").replace(tzinfo=timezone.utc)
            end   = datetime.strptime(end_date,   "%Y%m%d").replace(tzinfo=timezone.utc)
        except ValueError:
            return JSONResponse(
                status_code=422,
                content={"error": "begin_date/end_date must be YYYYMMDD"},
            )

        try:
            hilo = await fetch_hilo(station, start, end)
        except (ValueError, httpx.HTTPError) as e:
            return JSONResponse(status_code=502, content={"error": str(e)})

        return {"station": station, "hilo": hilo}


# ---------------------------------------------------------------------------
# Internal: station ID resolution
# ---------------------------------------------------------------------------

# Fallback map: spot slug → (station_id, station_name)
# Used when the DB lookup fails or tide_station_id is NULL.
# Source: NOAA CO-OPS station list, cross-referenced with 007 migration.
_FALLBACK_STATIONS: dict[str, tuple[str, str]] = {
    # San Diego County
    "blacks-beach":       ("9410230", "La Jolla, CA"),
    "cardiff-reef":       ("9410230", "La Jolla, CA"),
    "del-mar":            ("9410230", "La Jolla, CA"),
    "scripps":            ("9410230", "La Jolla, CA"),
    "windansea":          ("9410230", "La Jolla, CA"),
    "ocean-beach":        ("9410170", "San Diego, CA"),
    "imperial-beach":     ("9410170", "San Diego, CA"),
    "oceanside":          ("9410660", "Oceanside, CA"),
    # Orange County
    "lowers":             ("9410660", "Oceanside, CA"),
    "uppers":             ("9410660", "Oceanside, CA"),
    "trestles":           ("9410660", "Oceanside, CA"),
    "san-onofre":         ("9410660", "Oceanside, CA"),
    "salt-creek":         ("9410840", "Los Angeles, CA"),
    "the-wedge":          ("9410840", "Los Angeles, CA"),
    # Los Angeles County
    "malibu":             ("9410840", "Los Angeles, CA"),
    "zuma":               ("9410840", "Los Angeles, CA"),
    "el-porto":           ("9410840", "Los Angeles, CA"),
    "manhattan-beach":    ("9410840", "Los Angeles, CA"),
    "hermosa-beach":      ("9410840", "Los Angeles, CA"),
    "redondo-beach":      ("9410840", "Los Angeles, CA"),
    # Ventura County
    "rincon":             ("9411340", "Santa Barbara, CA"),
    "ventura-pier":       ("9411340", "Santa Barbara, CA"),
    # Santa Barbara County
    "hammonds":           ("9411340", "Santa Barbara, CA"),
    "leadbetter":         ("9411340", "Santa Barbara, CA"),
    # Central Coast
    "pismo-beach":        ("9412110", "Port San Luis, CA"),
    "morro-bay":          ("9412110", "Port San Luis, CA"),
    # San Francisco Bay Area
    "ocean-beach-sf":     ("9414290", "San Francisco, CA"),
    "pacifica":           ("9414290", "San Francisco, CA"),
    "linda-mar":          ("9414290", "San Francisco, CA"),
    # North Coast
    "pleasure-point":     ("9413745", "Monterey, CA"),
    "steamer-lane":       ("9413745", "Monterey, CA"),
    "santa-cruz":         ("9413745", "Monterey, CA"),
    # Hawaii
    "pipeline":           ("1612340", "Honolulu, HI"),
    "sunset-beach":       ("1612340", "Honolulu, HI"),
    "waimea-bay":         ("1612340", "Honolulu, HI"),
}

# Default fallback if slug not in map
_DEFAULT_STATION = ("9410170", "San Diego, CA")


async def _resolve_station(spot_slug: str) -> tuple[str, str]:
    """
    1. Try Supabase DB: spots.tide_station_id (populated by migration 007)
    2. Fall back to _FALLBACK_STATIONS dict
    3. Fall back to _DEFAULT_STATION
    Returns (station_id, station_name).
    """
    # Import here to avoid circular import with main.py
    try:
        from main import supabase  # type: ignore
        if supabase:
            result = (
                supabase.table("spots")
                .select("tide_station_id, name")
                .eq("slug", spot_slug)
                .single()
                .execute()
            )
            if result.data and result.data.get("tide_station_id"):
                return result.data["tide_station_id"], result.data.get("name", spot_slug)
    except Exception:
        pass  # DB unavailable — fall through to hardcoded map

    if spot_slug in _FALLBACK_STATIONS:
        return _FALLBACK_STATIONS[spot_slug]

    return _DEFAULT_STATION
