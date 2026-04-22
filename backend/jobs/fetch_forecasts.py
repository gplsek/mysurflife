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
  1. Open GFSWave global OPeNDAP dataset (all forecast hours in one request)
  2. Extract nearest grid point → full wave timeline (hs, period, direction)
  3. Open GFS 0.25° OPeNDAP dataset (same single-request approach)
  4. Extract nearest point → wind timeline (u10, v10)
  5. Merge wave + wind at 6-hour steps (0h, 6h, …, 180h)
  6. Write to Redis:  forecast:{slug}:{run_date}:{run_cycle}   TTL=7h

For tide stations:
  Pre-warm the 7-day prediction cache for all stations in _FALLBACK_STATIONS.
  The tides module handles its own TTL; we just pre-populate it.

Redis key consumed by get_surf_spot_forecast_timeline() in main.py,
which checks this key first and falls back to live fetch on miss.
"""

import asyncio
import math
import pickle
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

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
# OPeNDAP point extraction (blocking, run in executor)
# ---------------------------------------------------------------------------

def _nearest_idx(arr: np.ndarray, val: float) -> int:
    return int(np.argmin(np.abs(arr - val)))


def _extract_wave_point(url: str, spot_lat: float, spot_lon: float) -> Optional[List[Dict]]:
    """
    Synchronous: open GFSWave OPeNDAP dataset, extract all forecast times
    at the nearest grid point.  Run via run_in_executor.
    """
    try:
        import xarray as xr
        from utils import calculate_surf_height

        ds = xr.open_dataset(url, engine="pydap")

        lat_name = next((d for d in ds.dims if "lat" in d.lower()), None)
        lon_name = next((d for d in ds.dims if "lon" in d.lower()), None)
        tim_name = next((d for d in ds.dims if "tim" in d.lower() or d == "time"), None)
        if not lat_name or not lon_name:
            ds.close()
            return None

        lats = ds[lat_name].values
        lons = ds[lon_name].values

        # GFSWave uses 0-360 longitude
        lon_norm = spot_lon % 360.0
        li = _nearest_idx(lats, spot_lat)
        loi = _nearest_idx(lons, lon_norm)

        vnames = list(ds.data_vars)
        hs_nm  = next((v for v in vnames if "htsgw" in v.lower() or ("swh" in v.lower() and "sfc" in v.lower())), None)
        per_nm = next((v for v in vnames if "perpw" in v.lower() or "pp1d" in v.lower()), None)
        dir_nm = next((v for v in vnames if "dirpw" in v.lower() or ("mwd" in v.lower()) or "wvdir" in v.lower()), None)

        if not hs_nm:
            ds.close()
            return None

        sel = {lat_name: li, lon_name: loi}
        hs_arr  = ds[hs_nm].isel(**sel).values.flatten()
        per_arr = ds[per_nm].isel(**sel).values.flatten() if per_nm else np.full(len(hs_arr), np.nan)
        dir_arr = ds[dir_nm].isel(**sel).values.flatten() if dir_nm else np.full(len(hs_arr), 270.0)
        ds.close()

        points = []
        for i, (hs, per, dr) in enumerate(zip(hs_arr, per_arr, dir_arr)):
            # GFSWave steps: 0-180h at 3h intervals → i*3
            h   = i * 3
            hsv = float(hs)  if np.isfinite(hs)  and float(hs)  > 0 else None
            perv = float(per) if np.isfinite(per) and float(per) > 0 else None
            dirv = float(dr)  if np.isfinite(dr)               else 270.0
            surf = calculate_surf_height(hsv, perv) if hsv and perv else None
            points.append({
                "hour":           h,
                "height_m":       round(hsv,  3)               if hsv  else None,
                "height_ft":      round(hsv  * 3.28084, 2)     if hsv  else None,
                "period":         round(perv, 1)               if perv else None,
                "direction":      round(dirv, 0),
                "surf_height_m":  round(surf, 3)               if surf else None,
                "surf_height_ft": round(surf * 3.28084, 1)     if surf else None,
            })
        return points

    except Exception as e:
        print(f"❌ Wave OPeNDAP extract error ({spot_lat},{spot_lon}): {e}")
        return None


def _extract_wind_point(url: str, spot_lat: float, spot_lon: float) -> Optional[List[Dict]]:
    """
    Synchronous: open GFS 0.25° OPeNDAP dataset, extract all forecast times
    at the nearest grid point.  Run via run_in_executor.
    """
    try:
        import xarray as xr

        ds = xr.open_dataset(url, engine="pydap")

        lat_name = next((d for d in ds.dims if "lat" in d.lower()), None)
        lon_name = next((d for d in ds.dims if "lon" in d.lower()), None)
        if not lat_name or not lon_name:
            ds.close()
            return None

        lats = ds[lat_name].values
        lons = ds[lon_name].values

        lon_norm = spot_lon % 360.0
        li  = _nearest_idx(lats, spot_lat)
        loi = _nearest_idx(lons, lon_norm)

        vnames = list(ds.data_vars)
        # GFS var names: ugrd10m / vgrd10m (most common in DODS)
        u_nm = next((v for v in vnames if v.lower() in ("ugrd10m", "u10", "u10m")), None)
        v_nm = next((v for v in vnames if v.lower() in ("vgrd10m", "v10", "v10m")), None)
        if not u_nm:
            u_nm = next((v for v in vnames if "ugrd" in v.lower() and "10" in v), None)
            v_nm = next((v for v in vnames if "vgrd" in v.lower() and "10" in v), None)

        if not u_nm or not v_nm:
            ds.close()
            return None

        sel = {lat_name: li, lon_name: loi}
        u_arr = ds[u_nm].isel(**sel).values.flatten()
        v_arr = ds[v_nm].isel(**sel).values.flatten()
        ds.close()

        points = []
        for i, (u, v) in enumerate(zip(u_arr, v_arr)):
            h = i * 3
            if not (np.isfinite(u) and np.isfinite(v)):
                points.append({"hour": h, "speed_ms": None, "speed_mph": None, "direction": None})
                continue
            speed = float((float(u) ** 2 + float(v) ** 2) ** 0.5)
            direction = float((270 - math.degrees(math.atan2(float(v), float(u)))) % 360)
            points.append({
                "hour":      h,
                "speed_ms":  round(speed, 1),
                "speed_mph": round(speed * 2.23694, 1),
                "direction": round(direction, 0),
            })
        return points

    except Exception as e:
        print(f"❌ Wind OPeNDAP extract error ({spot_lat},{spot_lon}): {e}")
        return None


# ---------------------------------------------------------------------------
# Pre-bake one spot
# ---------------------------------------------------------------------------

async def prebake_spot(
    spot_slug:   str,
    spot_lat:    float,
    spot_lon:    float,
    run_date:    str,
    run_cycle:   str,
    redis_client: Any,
) -> bool:
    """
    Fetch wave + wind for one spot from a single OPeNDAP open per model,
    merge, and write to Redis.  Returns True on success.
    """
    redis_key = f"forecast:{spot_slug}:{run_date}:{run_cycle}".encode()

    if redis_client:
        try:
            if redis_client.exists(redis_key):
                return True   # already cached from this run
        except Exception:
            pass

    wave_url = (
        f"https://nomads.ncep.noaa.gov/dods/wave/gfswave/{run_date}"
        f"/gfswave.global.0p16_{run_cycle}z"
    )
    wind_url = (
        f"https://nomads.ncep.noaa.gov/dods/gfs_0p25"
        f"/gfs{run_date}/gfs_0p25_{run_cycle}z"
    )

    loop = asyncio.get_event_loop()

    wave_points, wind_points = await asyncio.gather(
        asyncio.wait_for(
            loop.run_in_executor(None, _extract_wave_point, wave_url, spot_lat, spot_lon),
            timeout=90.0,
        ),
        asyncio.wait_for(
            loop.run_in_executor(None, _extract_wind_point, wind_url, spot_lat, spot_lon),
            timeout=90.0,
        ),
        return_exceptions=True,
    )

    if isinstance(wave_points, Exception):
        print(f"⚠️  Wave fetch exception for {spot_slug}: {wave_points}")
        wave_points = None
    if isinstance(wind_points, Exception):
        print(f"⚠️  Wind fetch exception for {spot_slug}: {wind_points}")
        wind_points = None

    if not wave_points and not wind_points:
        return False

    wave_by_h: Dict[int, Dict] = {}
    for p in (wave_points or []):
        wave_by_h[p["hour"]] = p
        # Also index at the nearest 6h boundary so the merge step finds it
        h6 = (p["hour"] // 6) * 6
        if h6 not in wave_by_h:
            wave_by_h[h6] = p

    wind_by_h: Dict[int, Dict] = {}
    for p in (wind_points or []):
        wind_by_h[p["hour"]] = p
        h6 = (p["hour"] // 6) * 6
        if h6 not in wind_by_h:
            wind_by_h[h6] = p

    # Build 6-hourly timeline (matches get_surf_spot_forecast_timeline cadence)
    forecast_hours = list(range(0, 181, 6))
    timeline = []
    for h in forecast_hours:
        wave = wave_by_h.get(h)
        wind = wind_by_h.get(h)
        timeline.append({
            "hour": h,
            "wave": {
                "height_m":       wave.get("height_m")       if wave else None,
                "height_ft":      wave.get("height_ft")      if wave else None,
                "period":         wave.get("period")         if wave else None,
                "direction":      wave.get("direction")      if wave else None,
                "surf_height_m":  wave.get("surf_height_m")  if wave else None,
                "surf_height_ft": wave.get("surf_height_ft") if wave else None,
            },
            "wind": {
                "speed_ms":  wind.get("speed_ms")  if wind else None,
                "speed_mph": wind.get("speed_mph") if wind else None,
                "direction": wind.get("direction") if wind else None,
            },
        })

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
