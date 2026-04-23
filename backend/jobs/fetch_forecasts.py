"""
backend/jobs/fetch_forecasts.py
================================
Pre-bake forecast timelines for all spots on the GFS model run cadence.

Runs 4× per day, triggered ~4 hours after each GFS run when NOMADS data
is reliably available:
  GFS 00Z → fires at 04:15Z
  GFS 06Z → fires at 10:15Z
  GFS 12Z → fires at 16:15Z
  GFS 18Z → fires at 22:15Z

For each spot in the DB:
  1. Call local /api/surf-spots/{slug}/forecast-timeline (handles GRIB fetching)
  2. Write the returned timeline to Redis under forecast:{slug}:{run_date}:{run_cycle}  TTL=7h

For tide stations:
  Pre-warm the 7-day prediction cache for all stations in _FALLBACK_STATIONS.

Redis key consumed by get_surf_spot_forecast_timeline() in main.py,
which checks this key first and falls back to live fetch on miss.

Note: NOMADS retired OPeNDAP service (SCN25-81). This job previously used
pydap/OPeNDAP directly; it now calls the local API which uses the GRIB filter.
"""

import asyncio
import pickle
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

PREBAKE_CONCURRENCY = 3   # parallel spot fetches (NOMADS friendly)
REDIS_TTL_S        = 7 * 3600   # 7 hours — covers until next model run data is ready
STARTUP_DELAY      = 60          # seconds after app start before first attempt

# Trigger times in UTC fractional hours: 04:15, 10:15, 16:15, 22:15
_TRIGGER_HOURS = [4.25, 10.25, 16.25, 22.25]


# ---------------------------------------------------------------------------
# Run resolution
# ---------------------------------------------------------------------------

def latest_gfs_run() -> Tuple[str, str]:
    """
    Return (YYYYMMDD, HH) of the most recent GFS run that should be
    available on NOMADS (~3-4 hours after the model run time).
    """
    now = datetime.utcnow()
    for hrs_back in [4, 10, 16, 22]:
        candidate = now - timedelta(hours=hrs_back)
        cycle_h   = (candidate.hour // 6) * 6
        run_dt    = candidate.replace(hour=cycle_h, minute=0, second=0, microsecond=0)
        return run_dt.strftime("%Y%m%d"), f"{cycle_h:02d}"
    return now.strftime("%Y%m%d"), "00"


# ---------------------------------------------------------------------------
# Forecast timeline fetch (calls local API — avoids duplicating GRIB logic)
# ---------------------------------------------------------------------------

_LOCAL_API = "http://127.0.0.1:8000"


async def _fetch_timeline_from_api(slug: str, hours: int = 180) -> Optional[List[Dict]]:
    """
    Fetch the forecast timeline for one spot by calling the local API endpoint.
    This reuses all GRIB fetch, parse, and caching logic in main.py without
    duplicating it here.  The 60s startup delay ensures the server is ready.
    """
    try:
        import httpx
        url = f"{_LOCAL_API}/api/surf-spots/{slug}/forecast-timeline?hours={hours}"
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()
            return data.get("timeline")
    except Exception as e:
        print(f"❌ Timeline API fetch failed ({slug}): {e}")
        return None


# ---------------------------------------------------------------------------
# Pre-bake one spot
# ---------------------------------------------------------------------------

async def prebake_spot(
    spot_slug:    str,
    spot_lat:     float,
    spot_lon:     float,
    run_date:     str,
    run_cycle:    str,
    redis_client: Any,
) -> bool:
    """
    Pre-bake the forecast timeline for one spot by calling the local API.
    The API handles all GRIB fetching and parsing; this just caches the result
    in Redis under the run-keyed key so subsequent requests are instant.
    """
    redis_key = f"forecast:{spot_slug}:{run_date}:{run_cycle}".encode()

    if redis_client:
        try:
            if redis_client.exists(redis_key):
                return True  # already cached for this run
        except Exception:
            pass

    timeline = await _fetch_timeline_from_api(spot_slug, hours=180)

    if not timeline:
        return False

    if redis_client:
        try:
            redis_client.setex(redis_key, REDIS_TTL_S, pickle.dumps(timeline))
            print(f"✅ Pre-baked: {spot_slug} ({len(timeline)} pts, {run_date} {run_cycle}z)")
        except Exception as e:
            print(f"❌ Redis write failed ({spot_slug}): {e}")
            return False

    return True


# ---------------------------------------------------------------------------
# Tide pre-warm
# ---------------------------------------------------------------------------

async def prebake_tides() -> None:
    """Pre-warm tide predictions for all stations in the fallback map."""
    try:
        from tides import _FALLBACK_STATIONS, fetch_tide_timeline, fetch_hilo

        unique_stations = {sid for sid, _ in _FALLBACK_STATIONS.values()}
        now_utc = datetime.now(timezone.utc)
        start   = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        end     = start + timedelta(days=7)

        async def _warm(station_id: str) -> None:
            try:
                await asyncio.gather(
                    fetch_tide_timeline(station_id, start, end),
                    fetch_hilo(station_id, start, end),
                )
            except Exception as e:
                print(f"⚠️  Tide pre-warm {station_id}: {e}")

        await asyncio.gather(*[_warm(sid) for sid in unique_stations])
        print(f"✅ Tide pre-warm: {len(unique_stations)} stations")
    except Exception as e:
        print(f"❌ Tide pre-warm error: {e}")


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

async def prebake_all_spots(
    get_all_spots_fn: Callable[[], Optional[List[Dict]]],
    redis_client: Any,
) -> None:
    """Pre-bake all spots for the current GFS run."""
    run_date, run_cycle = latest_gfs_run()
    spots = get_all_spots_fn() or []

    if not spots:
        print("⚠️  Pre-bake: no spots in DB")
        return

    print(f"🔮 Pre-baking {len(spots)} spots — GFS {run_date} {run_cycle}z")
    sem = asyncio.Semaphore(PREBAKE_CONCURRENCY)

    async def _one(spot: Dict) -> bool:
        async with sem:
            slug = spot.get("slug") or spot.get("id", "")
            lat  = spot.get("latitude")
            lon  = spot.get("longitude")
            if not slug or lat is None or lon is None:
                return False
            return await prebake_spot(slug, float(lat), float(lon), run_date, run_cycle, redis_client)

    results = await asyncio.gather(*[_one(s) for s in spots], return_exceptions=True)
    ok = sum(1 for r in results if r is True)
    print(f"✅ Pre-bake done: {ok}/{len(spots)} spots ({run_date} {run_cycle}z)")

    await prebake_tides()


# ---------------------------------------------------------------------------
# Scheduler loop
# ---------------------------------------------------------------------------

def _seconds_until_next_trigger() -> float:
    """Seconds until the next pre-bake trigger (04:15, 10:15, 16:15, 22:15 UTC)."""
    now = datetime.utcnow()
    now_h = now.hour + now.minute / 60 + now.second / 3600
    for t in _TRIGGER_HOURS:
        if t > now_h:
            return (t - now_h) * 3600
    # All triggers passed today — next is tomorrow's first
    return (_TRIGGER_HOURS[0] + 24 - now_h) * 3600


async def run_forecast_prebake_loop(
    get_all_spots_fn: Callable[[], Optional[List[Dict]]],
    redis_client: Any,
) -> None:
    """
    Background coroutine: fires at 04:15, 10:15, 16:15, 22:15 UTC,
    always ~4h after a GFS run so NOMADS data is reliably available.
    """
    await asyncio.sleep(STARTUP_DELAY)

    # Run once at startup to warm cache for current run
    try:
        await prebake_all_spots(get_all_spots_fn, redis_client)
    except Exception as e:
        print(f"❌ Pre-bake startup error: {e}")

    while True:
        wait_s = _seconds_until_next_trigger()
        print(f"🕐 Next forecast pre-bake in {wait_s / 3600:.1f}h")
        await asyncio.sleep(wait_s)

        try:
            await prebake_all_spots(get_all_spots_fn, redis_client)
        except Exception as e:
            print(f"❌ Pre-bake loop error: {e}")

        await asyncio.sleep(60)  # buffer before recalculating
