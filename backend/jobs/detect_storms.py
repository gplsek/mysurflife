"""
jobs/detect_storms.py — GFS-pressure-based global cyclone detector.

Addresses Bugs 5 & 6: the bulletin pipeline misses weak NH lows and has
zero Southern Hemisphere coverage. This detector finds pressure minima
directly from the GFS MSL pressure field (globally, every 6h out to 168h),
builds forecast tracks, enriches them with WW3 wave data and landfall checks,
scores region impact, and persists to derived_storms in Postgres.

No scipy dependency — local minima found via numpy roll comparison.
Requires: cfgrib, xarray, numpy (all present in the existing venv).

Phase notes:
  Phase 4: WW3 confirmation pass + intensification dynamics
  Phase 5: Landfall check on forecast tracks
  Phase 7: Region impact scoring + narrative (via services.region_impact)
  Phase 8: Persistence to derived_storms table
"""
from __future__ import annotations

import asyncio
import json
import math
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import numpy as np

# ---------------------------------------------------------------------------
# Land mask (Phase 5) — graceful degradation if package not installed
# ---------------------------------------------------------------------------
try:
    from global_land_mask import globe as _globe_land
    _LAND_MASK_AVAILABLE = True
except ImportError:
    _globe_land = None
    _LAND_MASK_AVAILABLE = False

# ---------------------------------------------------------------------------
# JSON sanitization helper
# ---------------------------------------------------------------------------

def _sanitize_row(obj: Any) -> Any:
    """Recursively replace NaN/Inf with None so rows are JSON-safe for Supabase."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize_row(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_row(v) for v in obj]
    if isinstance(obj, np.floating):
        return None if (np.isnan(obj) or np.isinf(obj)) else float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    return obj


# ---------------------------------------------------------------------------
# Config loader (Phase 4)
# ---------------------------------------------------------------------------

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "storm_detector_config.json"


def _load_config() -> Dict:
    """Load detector tunables from JSON. Raises if file missing; falls back per-key."""
    if not _CONFIG_PATH.exists():
        raise FileNotFoundError(f"storm_detector_config.json not found at {_CONFIG_PATH}")
    with open(_CONFIG_PATH) as f:
        raw = json.load(f)
    # Strip comment keys
    return {k: v for k, v in raw.items() if not k.startswith("$")}


try:
    _CFG = _load_config()
except Exception as _cfg_err:
    print(f"⚠️  storm detector: config load failed ({_cfg_err}); using defaults")
    _CFG = {}

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

_model_storms_cache: Dict[str, object] = {}
_CACHE_TTL = 6 * 3600   # seconds — align with GFS run cadence


def get_cached_model_storms() -> Optional[List[Dict]]:
    entry = _model_storms_cache.get("storms")
    if not entry:
        return None
    age = time.time() - entry["fetched_at"]
    if age > _CACHE_TTL:
        return None
    return entry["data"]


def set_cached_model_storms(storms: List[Dict]) -> None:
    _model_storms_cache["storms"] = {
        "data":       storms,
        "fetched_at": time.time(),
    }


# ---------------------------------------------------------------------------
# Detection thresholds — read from config, fall back to hardcoded defaults
# ---------------------------------------------------------------------------

_MAX_PRESSURE_MB       = _CFG.get("max_pressure_mb",          1005)
_CLUSTER_RADIUS_KM     = _CFG.get("cluster_radius_km",          200)
_TRACK_RADIUS_KM       = _CFG.get("track_radius_km",            600)
_TRACK_PRESSURE_DELTA  = _CFG.get("track_pressure_delta_mb",     20)
_HS_CONFIRM_MIN_M      = _CFG.get("hs_confirm_min_m",           3.0)
_CONE_HALF_ANGLE_DEG   = _CFG.get("cone_half_angle_deg",          45)
_CONE_RANGE_NM         = tuple(_CFG.get("cone_range_nm",    [100, 800]))
_CONFIRM_REQUIRED      = _CFG.get("confirm_required",          False)

# ---------------------------------------------------------------------------
# GFS run resolution
# ---------------------------------------------------------------------------

_NOMADS_BASE = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl"
_NOMADS_DIR  = "/gfs.{date}/{cycle}/atmos"

# Forecast hours to scan: every 6h out to 168h
_FORECAST_HOURS = list(range(0, 174, 6))


async def _head_ok(url: str, client: httpx.AsyncClient) -> bool:
    try:
        resp = await client.head(url, timeout=8.0, follow_redirects=True)
        return resp.status_code == 200
    except Exception:
        return False


async def resolve_latest_gfs_run() -> Tuple[str, str]:
    """Return (date_yyyymmdd, cycle_hh) for the most recently available GFS run."""
    now = datetime.utcnow()
    async with httpx.AsyncClient(timeout=10.0) as client:
        for day_offset in [0, 1]:
            d = (now - timedelta(days=day_offset)).strftime("%Y%m%d")
            for hh in ["18", "12", "06", "00"]:
                probe = (
                    f"{_NOMADS_BASE}?file=gfs.t{hh}z.pgrb2.1p00.f000"
                    "&lev_mean_sea_level=on&var_PRMSL=on"
                    "&leftlon=0&rightlon=1&toplat=1&bottomlat=0"
                    f"&dir={_NOMADS_DIR.format(date=d, cycle=hh).replace('/', '%2F')}"
                )
                if await _head_ok(probe, client):
                    print(f"🌀 storm detector: resolved GFS run {d} {hh}z")
                    return d, hh
    fallback = now.strftime("%Y%m%d")
    print(f"⚠️  storm detector: could not resolve GFS run; using {fallback} 00z")
    return fallback, "00"


# ---------------------------------------------------------------------------
# GRIB fetch — global 1° GFS PRMSL + UGRD + VGRD
# ---------------------------------------------------------------------------

async def fetch_gfs_global_field(
    run_date: str,
    run_cycle: str,
    forecast_hour: int,
) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]]:
    """
    Download global GFS 1° GRIB2 for a single forecast hour.
    Returns (pres_pa, u_ms, v_ms, lat_1d, lon_1d) numpy arrays, or None on failure.
    Pressure in Pa (divide by 100 for mb), winds in m/s.
    lon_1d is 0..360; callers normalise to -180..180.
    """
    fh = max(0, int(forecast_hour))
    file_name = f"gfs.t{run_cycle}z.pgrb2.1p00.f{fh:03d}"
    dir_param = _NOMADS_DIR.format(date=run_date, cycle=run_cycle).replace("/", "%2F")

    url = (
        f"{_NOMADS_BASE}?file={file_name}"
        "&lev_mean_sea_level=on&var_PRMSL=on"
        "&lev_10_m_above_ground=on&var_UGRD=on&var_VGRD=on"
        "&leftlon=0&rightlon=360&toplat=90&bottomlat=-90"
        f"&dir={dir_param}"
    )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content = resp.content

        if len(content) < 4096:
            print(f"⚠️  storm detector: GFS GRIB too small at f{fh:03d} ({len(content)} bytes)")
            return None

        import xarray as xr

        with tempfile.NamedTemporaryFile(delete=False, suffix=".grib2") as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        ds_pres = xr.open_dataset(
            tmp_path,
            engine="cfgrib",
            backend_kwargs={
                "indexpath": "",
                "filter_by_keys": {"typeOfLevel": "meanSea"},
            },
        )
        prmsl_name = next((v for v in ["prmsl", "msl", "PRMSL"] if v in ds_pres.data_vars), None)
        if prmsl_name is None:
            print(f"⚠️  storm detector: no PRMSL at f{fh:03d}; vars={list(ds_pres.data_vars)}")
            return None
        pres_arr = ds_pres[prmsl_name].values
        lat_arr  = ds_pres["latitude"].values
        lon_arr  = ds_pres["longitude"].values

        ds_wind = xr.open_dataset(
            tmp_path,
            engine="cfgrib",
            backend_kwargs={
                "indexpath": "",
                "filter_by_keys": {"typeOfLevel": "heightAboveGround", "level": 10},
            },
        )
        u_name = next((v for v in ["u10", "ugrd10m", "u"] if v in ds_wind.data_vars), None)
        v_name = next((v for v in ["v10", "vgrd10m", "v"] if v in ds_wind.data_vars), None)
        u_arr = ds_wind[u_name].values if u_name else np.zeros_like(pres_arr)
        v_arr = ds_wind[v_name].values if v_name else np.zeros_like(pres_arr)

        import os
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

        print(f"✅ storm detector: fetched GFS f{fh:03d} ({len(content)//1024}KB)")
        return pres_arr, u_arr, v_arr, lat_arr, lon_arr

    except ImportError as e:
        print(f"⚠️  storm detector: missing dep ({e}); skipping")
        return None
    except Exception as e:
        print(f"❌ storm detector: GFS fetch failed at f{fh:03d}: {e}")
        return None


# ---------------------------------------------------------------------------
# WW3 run resolution + global Hs fetch (Phase 4)
# ---------------------------------------------------------------------------

_WW3_FILTER   = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl"
_WW3_FILE_PAT = "gfswave.t{HH}z.global.0p16.f{FFF}.grib2"
_WW3_DIR_PAT  = "%2Fgfs.{DATE}%2F{HH}%2Fwave%2Fgridded"


async def resolve_latest_ww3_run() -> Tuple[str, str]:
    """Return (date_yyyymmdd, cycle_hh) for the most recently available GFSWave run."""
    now = datetime.utcnow()
    async with httpx.AsyncClient(timeout=10.0) as client:
        for day_offset in [0, 1]:
            d = (now - timedelta(days=day_offset)).strftime("%Y%m%d")
            for hh in ["18", "12", "06", "00"]:
                fn    = _WW3_FILE_PAT.format(HH=hh, FFF="000")
                gdir  = _WW3_DIR_PAT.format(DATE=d, HH=hh)
                probe = (
                    f"{_WW3_FILTER}?file={fn}&var_HTSGW=on"
                    "&leftlon=0&rightlon=1&toplat=1&bottomlat=0"
                    f"&dir={gdir}"
                )
                if await _head_ok(probe, client):
                    print(f"🌊 storm detector: resolved WW3 run {d} {hh}z")
                    return d, hh
    fallback = now.strftime("%Y%m%d")
    print(f"⚠️  storm detector: could not resolve WW3 run; using {fallback} 00z")
    return fallback, "00"


async def fetch_ww3_global_hs(
    run_date: str,
    run_cycle: str,
    forecast_hour: int,
) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]]:
    """
    Download global GFSWave 0.16° GRIB2 for one forecast hour.
    Returns (hs_m, period_s, dir_deg, lat_1d, lon_1d) or None on failure.
    lon_1d is 0..360; callers normalise.  Land cells come back as NaN.
    """
    fh   = max(0, int(forecast_hour))
    fn   = _WW3_FILE_PAT.format(HH=run_cycle, FFF=f"{fh:03d}")
    gdir = _WW3_DIR_PAT.format(DATE=run_date, HH=run_cycle)

    url = (
        f"{_WW3_FILTER}?file={fn}"
        "&var_HTSGW=on&var_PERPW=on&var_DIRPW=on"
        "&leftlon=0&rightlon=360&toplat=90&bottomlat=-90"
        f"&dir={gdir}"
    )

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content = resp.content

        if len(content) < 4096:
            print(f"⚠️  WW3: GRIB too small at f{fh:03d} ({len(content)} bytes)")
            return None

        import xarray as xr

        with tempfile.NamedTemporaryFile(delete=False, suffix=".grib2") as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        # Wave height
        ds_hs = xr.open_dataset(
            tmp_path, engine="cfgrib",
            backend_kwargs={"indexpath": "", "filter_by_keys": {"shortName": "swh"}},
        )
        hs_name = next(
            (v for v in ["swh", "htsgwsfc", "HTSGW", "htsgw"] if v in ds_hs.data_vars),
            list(ds_hs.data_vars)[0] if ds_hs.data_vars else None,
        )
        if hs_name is None:
            return None
        hs_arr  = ds_hs[hs_name].values.astype(float)
        lat_arr = ds_hs["latitude"].values
        lon_arr = ds_hs["longitude"].values

        # Period
        try:
            ds_per = xr.open_dataset(
                tmp_path, engine="cfgrib",
                backend_kwargs={"indexpath": "", "filter_by_keys": {"shortName": "perpw"}},
            )
            per_name = next(
                (v for v in ["perpw", "pp1d", "PERPW"] if v in ds_per.data_vars), None
            )
            per_arr = ds_per[per_name].values.astype(float) if per_name else np.full_like(hs_arr, 12.0)
        except Exception:
            per_arr = np.full_like(hs_arr, 12.0)

        # Direction
        try:
            ds_dir = xr.open_dataset(
                tmp_path, engine="cfgrib",
                backend_kwargs={"indexpath": "", "filter_by_keys": {"shortName": "dirpw"}},
            )
            dir_name = next(
                (v for v in ["dirpw", "DIRPW", "wvdir"] if v in ds_dir.data_vars), None
            )
            dir_arr = ds_dir[dir_name].values.astype(float) if dir_name else np.full_like(hs_arr, np.nan)
        except Exception:
            dir_arr = np.full_like(hs_arr, np.nan)

        import os
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

        # NaN-out fill values (WW3 land cells)
        hs_arr  = np.where(np.isfinite(hs_arr)  & (hs_arr  < 30),  hs_arr,  np.nan)
        per_arr = np.where(np.isfinite(per_arr) & (per_arr < 60), per_arr, np.nan)
        dir_arr = np.where(np.isfinite(dir_arr),                    dir_arr, np.nan)

        print(f"✅ storm detector: fetched WW3 f{fh:03d} ({len(content)//1024}KB)")
        return hs_arr, per_arr, dir_arr, lat_arr, lon_arr

    except ImportError as e:
        print(f"⚠️  WW3: missing dep ({e})")
        return None
    except Exception as e:
        print(f"❌ WW3: fetch failed at f{fh:03d}: {e}")
        return None


# ---------------------------------------------------------------------------
# Cone sampler (Phase 4)
# ---------------------------------------------------------------------------

def sample_hs_cone(
    hs_arr: np.ndarray,
    lat_1d: np.ndarray,
    lon_1d: np.ndarray,
    center_lat: float,
    center_lon: float,
    peak_quadrant: Optional[str],
    half_angle_deg: float = _CONE_HALF_ANGLE_DEG,
    range_nm: Tuple[int, int] = _CONE_RANGE_NM,
) -> Dict:
    """
    Sample WW3 Hs in a downwind cone from (center_lat, center_lon).
    Cone axis = direction storm fetch is pointing (peak_quadrant).
    Returns {max_hs_m, mean_hs_m, ocean_cells, total_cells, samples}.
    Land cells (NaN) are excluded from stats.
    """
    # Map 8-point compass to bearing degrees
    _Q_BEARING = {
        "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5,
        "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
        "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
        "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5,
    }

    empty = {"max_hs_m": float("nan"), "mean_hs_m": float("nan"),
             "ocean_cells": 0, "total_cells": 0, "samples": []}

    if peak_quadrant is None or peak_quadrant not in _Q_BEARING:
        return empty

    cone_bearing = _Q_BEARING[peak_quadrant]
    range_min_km = range_nm[0] * 1.852
    range_max_km = range_nm[1] * 1.852

    # Normalise center longitude to 0..360 (WW3 grid)
    clon_grid = center_lon % 360.0

    found_hs: List[float] = []
    samples: List[Dict] = []

    nlat = len(lat_1d)
    nlon = len(lon_1d)

    for ri in range(nlat):
        for ci in range(nlon):
            g_lat = float(lat_1d[ri])
            g_lon = float(lon_1d[ci])
            g_lon_180 = g_lon - 360.0 if g_lon > 180 else g_lon

            dist = _haversine_km(center_lat, center_lon, g_lat, g_lon_180)
            if dist < range_min_km or dist > range_max_km:
                continue

            # Bearing from center to grid cell
            dlon_r = math.radians(g_lon_180 - center_lon)
            lat1_r = math.radians(center_lat)
            lat2_r = math.radians(g_lat)
            x = math.sin(dlon_r) * math.cos(lat2_r)
            y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon_r)
            bearing = (math.degrees(math.atan2(x, y)) + 360) % 360

            # Angular distance from cone axis (handle 0/360 wrap)
            angle_diff = abs((bearing - cone_bearing + 180) % 360 - 180)
            if angle_diff > half_angle_deg:
                continue

            hs_val = float(hs_arr[ri, ci])
            if not math.isfinite(hs_val):
                continue  # land cell

            found_hs.append(hs_val)
            if len(samples) < 8 or hs_val > min(s["hs_m"] for s in samples):
                samples.append({"lat": round(g_lat, 2), "lon": round(g_lon_180, 2), "hs_m": round(hs_val, 2)})
                samples.sort(key=lambda s: -s["hs_m"])
                samples = samples[:8]

    ocean_cells = len(found_hs)
    if ocean_cells == 0:
        return {**empty, "ocean_cells": 0, "total_cells": 0}

    return {
        "max_hs_m":    round(max(found_hs), 2),
        "mean_hs_m":   round(sum(found_hs) / ocean_cells, 2),
        "ocean_cells": ocean_cells,
        "total_cells": ocean_cells,  # only ocean cells counted
        "samples":     samples,
    }


# ---------------------------------------------------------------------------
# Cyclone detection helpers
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(min(1.0, a)))


def find_pressure_minima(
    pres_pa: np.ndarray,
    lat_1d: np.ndarray,
    lon_1d: np.ndarray,
    max_pressure_mb: float = _MAX_PRESSURE_MB,
) -> List[Dict]:
    """Find local pressure minima — cells lower than all 8 neighbours."""
    p = pres_pa / 100.0   # Pa → mb

    is_min = np.ones(p.shape, dtype=bool)
    for di in [-1, 0, 1]:
        for dj in [-1, 0, 1]:
            if di == 0 and dj == 0:
                continue
            neighbour = np.roll(np.roll(p, di, axis=0), dj, axis=1)
            is_min &= (p <= neighbour)

    is_min[0, :]  = False
    is_min[-1, :] = False
    is_min &= (p <= max_pressure_mb)

    rows, cols = np.where(is_min)
    minima = []
    for r, c in zip(rows, cols):
        lat = float(lat_1d[r])
        lon_raw = float(lon_1d[c])
        lon = lon_raw - 360.0 if lon_raw > 180.0 else lon_raw
        minima.append({"lat": lat, "lon": lon, "pressure_mb": round(float(p[r, c]), 1)})
    return minima


def cluster_minima(minima: List[Dict], radius_km: float = _CLUSTER_RADIUS_KM) -> List[Dict]:
    """Merge pressure minima within radius_km into a single center (lowest pressure wins)."""
    used = [False] * len(minima)
    clusters: List[Dict] = []
    sorted_m = sorted(enumerate(minima), key=lambda x: x[1]["pressure_mb"])
    for idx, m in sorted_m:
        if used[idx]:
            continue
        group = [m]
        used[idx] = True
        for j, other in enumerate(minima):
            if used[j]:
                continue
            if _haversine_km(m["lat"], m["lon"], other["lat"], other["lon"]) <= radius_km:
                group.append(other)
                used[j] = True
        clusters.append(min(group, key=lambda x: x["pressure_mb"]))
    return clusters


def _wind_speed_ms(u: float, v: float) -> float:
    return math.sqrt(u * u + v * v)


def _ms_to_kts(ms: float) -> float:
    return ms * 1.94384


def _bearing_deg(dlat: float, dlon: float) -> str:
    angle = math.degrees(math.atan2(dlon, dlat)) % 360
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    return dirs[round(angle / 22.5) % 16]


def compute_fetch_geometry(
    u_arr: np.ndarray,
    v_arr: np.ndarray,
    lat_1d: np.ndarray,
    lon_1d: np.ndarray,
    center_lat: float,
    center_lon: float,
    gale_threshold_ms: float = 17.0,
    max_radius_deg: float = 12.0,
) -> Dict:
    """Walk outward from center in 8 quadrants; record gale-force extent."""
    quadrants = {
        "N":   ( 1,  0), "NE": ( 1,  1), "E":  ( 0,  1), "SE": (-1,  1),
        "S":   (-1,  0), "SW": (-1, -1), "W":  ( 0, -1), "NW": ( 1, -1),
    }
    nlat = len(lat_1d)
    nlon = len(lon_1d)
    clat_idx = int(np.argmin(np.abs(lat_1d - center_lat)))
    clon_raw = center_lon + 360.0 if center_lon < 0 and lon_1d[-1] > 180 else center_lon
    clon_idx = int(np.argmin(np.abs(lon_1d - clon_raw)))

    radii: Dict[str, int] = {}
    for q, (dlat_dir, dlon_dir) in quadrants.items():
        steps = 0
        r, c = clat_idx, clon_idx
        for step in range(1, int(max_radius_deg) + 1):
            r2 = max(0, min(nlat - 1, r + dlat_dir * step))
            c2 = (c + dlon_dir * step) % nlon
            spd = _wind_speed_ms(float(u_arr[r2, c2]), float(v_arr[r2, c2]))
            if spd >= gale_threshold_ms:
                steps = step
            else:
                break
        radii[q] = round(steps * 60)

    if not any(radii.values()):
        return {"quadrants_nm": radii, "peak_quadrant": None, "peak_radius_nm": 0}

    peak_q = max(radii, key=lambda q: radii[q])
    _opposite = {
        "N": "S", "S": "N", "E": "W", "W": "E",
        "NE": "SW", "SW": "NE", "NW": "SE", "SE": "NW",
        "NNE": "SSW", "SSW": "NNE", "NNW": "SSE", "SSE": "NNW",
    }
    return {
        "quadrants_nm":   radii,
        "peak_quadrant":  peak_q,
        "peak_radius_nm": radii[peak_q],
        "swell_from":     _opposite.get(peak_q, peak_q),
    }


def _warning_tier(wind_kts: Optional[float]) -> str:
    if wind_kts is None:
        return "none"
    if wind_kts >= 64:
        return "hurricane"
    if wind_kts >= 48:
        return "storm"
    if wind_kts >= 34:
        return "gale"
    return "none"


def _assign_ocean_basin(lat: float, lon: float) -> str:
    if lat >= 0:
        if -100 <= lon <= 0:
            return "north-atlantic"
        if lon < -100 or lon > 120:
            return "north-pacific"
        if 40 <= lon <= 100:
            return "north-indian"
        return "east-pacific" if lat < 30 else "north-pacific"
    else:
        if lon < -20 or lon > 290:
            return "south-pacific"
        if lon < 20:
            return "south-atlantic"
        if lon < 135:
            return "south-indian"
        return "south-pacific"


_BASIN_LABELS = {
    "north-pacific":   "North Pacific",
    "north-atlantic":  "North Atlantic",
    "east-pacific":    "East Pacific",
    "south-pacific":   "South Pacific",
    "south-atlantic":  "South Atlantic",
    "north-indian":    "North Indian Ocean",
    "south-indian":    "South Indian Ocean",
}


# ---------------------------------------------------------------------------
# Single-hour detection  (Phase 4: WW3 confirmation added)
# ---------------------------------------------------------------------------

def detect_at_hour(
    pres_pa: np.ndarray,
    u_ms: np.ndarray,
    v_ms: np.ndarray,
    lat_1d: np.ndarray,
    lon_1d: np.ndarray,
    hours_ahead: int,
    *,
    hs_arr: Optional[np.ndarray] = None,
    per_arr: Optional[np.ndarray] = None,
    dir_arr: Optional[np.ndarray] = None,
    ww3_lat: Optional[np.ndarray] = None,
    ww3_lon: Optional[np.ndarray] = None,
    config: Optional[Dict] = None,
) -> List[Dict]:
    """Run full detection pipeline for a single forecast hour."""
    cfg = config or _CFG
    hs_confirm_min = cfg.get("hs_confirm_min_m", _HS_CONFIRM_MIN_M)
    confirm_required = cfg.get("confirm_required", _CONFIRM_REQUIRED)

    raw     = find_pressure_minima(pres_pa, lat_1d, lon_1d)
    centers = cluster_minima(raw)
    detections = []
    would_drop = 0

    for c in centers:
        fetch = compute_fetch_geometry(u_ms, v_ms, lat_1d, lon_1d, c["lat"], c["lon"])

        # Peak wind within 500 km of center
        clat_idx = int(np.argmin(np.abs(lat_1d - c["lat"])))
        clon_raw = c["lon"] + 360.0 if c["lon"] < 0 and lon_1d[-1] > 180 else c["lon"]
        clon_idx = int(np.argmin(np.abs(lon_1d - clon_raw)))
        radius_cells = 5
        r1 = max(0, clat_idx - radius_cells)
        r2 = min(len(lat_1d), clat_idx + radius_cells)
        c1 = (clon_idx - radius_cells) % len(lon_1d)
        c2 = (clon_idx + radius_cells) % len(lon_1d)
        if c1 < c2:
            wind_box_u = u_ms[r1:r2, c1:c2]
            wind_box_v = v_ms[r1:r2, c1:c2]
        else:
            wind_box_u = np.concatenate([u_ms[r1:r2, c1:], u_ms[r1:r2, :c2]], axis=1)
            wind_box_v = np.concatenate([v_ms[r1:r2, c1:], v_ms[r1:r2, :c2]], axis=1)
        wind_spd = np.sqrt(wind_box_u ** 2 + wind_box_v ** 2)
        peak_wind_kts = round(_ms_to_kts(float(wind_spd.max())), 1) if wind_spd.size else None

        # --- WW3 confirmation (Phase 4) ---
        peak_sea_m = None
        peak_period_s = None
        swell_direction_deg = None
        max_cone_hs_m = None
        confirmation_status = "ww3_unavailable"

        if hs_arr is not None and ww3_lat is not None and ww3_lon is not None:
            # Sample WW3 at storm center (single grid lookup)
            clat_ww3 = int(np.argmin(np.abs(ww3_lat - c["lat"])))
            clon_ww3_raw = c["lon"] % 360.0
            clon_ww3 = int(np.argmin(np.abs(ww3_lon - clon_ww3_raw)))
            hs_center = float(hs_arr[clat_ww3, clon_ww3])
            if math.isfinite(hs_center):
                peak_sea_m = round(hs_center, 2)
            if per_arr is not None:
                per_center = float(per_arr[clat_ww3, clon_ww3])
                if math.isfinite(per_center):
                    peak_period_s = round(per_center, 1)
            if dir_arr is not None:
                dir_center = float(dir_arr[clat_ww3, clon_ww3])
                if math.isfinite(dir_center):
                    swell_direction_deg = round(dir_center, 1)

            # Cone confirmation
            cone = sample_hs_cone(
                hs_arr, ww3_lat, ww3_lon,
                c["lat"], c["lon"],
                fetch.get("peak_quadrant"),
            )
            max_cone_hs_m = cone.get("max_hs_m")
            if cone["ocean_cells"] == 0:
                confirmation_status = "land_only"
            elif (max_cone_hs_m is None or not math.isfinite(max_cone_hs_m)
                  or max_cone_hs_m < hs_confirm_min):
                confirmation_status = "weak_fetch"
                would_drop += 1
            else:
                confirmation_status = "confirmed"

        ocean = _assign_ocean_basin(c["lat"], c["lon"])
        det = {
            "hours_ahead":          hours_ahead,
            "lat":                  round(c["lat"], 2),
            "lon":                  round(c["lon"], 2),
            "pressure_mb":          int(c["pressure_mb"]),
            "peak_wind_kts":        peak_wind_kts,
            "warning_tier":         _warning_tier(peak_wind_kts),
            "ocean":                ocean,
            "fetch":                fetch,
            "peak_sea_m":           peak_sea_m,
            "peak_period_s":        peak_period_s,
            "swell_direction_deg":  swell_direction_deg,
            "max_cone_hs_m":        max_cone_hs_m,
            "confirmation_status":  confirmation_status,
        }

        if confirm_required and confirmation_status not in ("confirmed", "ww3_unavailable"):
            continue

        detections.append(det)

    if would_drop > 0:
        print(f"🌊 confirm: would-drop {would_drop} storms (confirm_required={confirm_required})")

    return detections


# ---------------------------------------------------------------------------
# Track matching + annotations (Phase 4: dynamics; Phase 5: landfall; Phase 7: regions)
# ---------------------------------------------------------------------------

def _annotate_track_dynamics(storm: Dict) -> None:
    """Compute intensification fields from forecast_track. Mutates storm in place."""
    track = storm.get("forecast_track") or []
    if len(track) < 2:
        storm["intensification_rate_mb_per_6h"] = None
        storm["peak_intensity_hour"] = None
        storm["is_deepening"] = None
        return

    pressures = [t.get("pressure_mb") for t in track if t.get("pressure_mb") is not None]
    if not pressures:
        storm["intensification_rate_mb_per_6h"] = None
        storm["peak_intensity_hour"] = None
        storm["is_deepening"] = None
        return

    # Rate over first 24h (up to 4 steps of 6h each)
    n_steps = min(4, len(pressures) - 1)
    if n_steps > 0:
        rate = (pressures[n_steps] - pressures[0]) / n_steps  # mb per 6h; negative = deepening
        storm["intensification_rate_mb_per_6h"] = round(rate, 2)
    else:
        storm["intensification_rate_mb_per_6h"] = None

    # Hour of peak intensity (minimum pressure)
    min_idx = int(np.argmin(pressures))
    storm["peak_intensity_hour"] = track[min_idx].get("hours_ahead") if min_idx < len(track) else None

    # Deepening: is next step lower pressure than current?
    storm["is_deepening"] = bool(pressures[1] < pressures[0]) if len(pressures) >= 2 else None


def _annotate_landfall(storm: Dict) -> None:
    """Walk forecast_track; set will_make_landfall + landfall_eta_hours.
    Mutates storm in place. No-op if global_land_mask is unavailable."""
    if not _LAND_MASK_AVAILABLE or _globe_land is None:
        storm["will_make_landfall"] = None
        storm["landfall_eta_hours"] = None
        storm["landfall_before_peak"] = None
        return

    track = storm.get("forecast_track") or []
    peak_hour = storm.get("peak_intensity_hour")

    for wp in track:
        try:
            is_land = _globe_land.is_land(float(wp["lat"]), float(wp["lon"]))
        except Exception:
            continue
        if not is_land:
            continue
        storm["will_make_landfall"] = True
        storm["landfall_eta_hours"] = wp.get("hours_ahead")
        storm["landfall_before_peak"] = (
            peak_hour is not None and wp["hours_ahead"] < peak_hour
        )
        return

    storm["will_make_landfall"] = False
    storm["landfall_eta_hours"] = None
    storm["landfall_before_peak"] = False


def match_tracks(detections_by_hour: List[List[Dict]]) -> List[Dict]:
    """
    Link detections across forecast hours into continuous storm tracks.
    Annotates each storm with dynamics, landfall, region impacts, and narrative.
    """
    if not detections_by_hour:
        return []

    active_tracks: List[List[Dict]] = [[d] for d in detections_by_hour[0]]

    for hour_dets in detections_by_hour[1:]:
        matched = [False] * len(hour_dets)
        new_tracks: List[List[Dict]] = []

        for track in active_tracks:
            last = track[-1]
            best_j, best_dist = None, _TRACK_RADIUS_KM + 1

            for j, det in enumerate(hour_dets):
                if matched[j]:
                    continue
                dist = _haversine_km(last["lat"], last["lon"], det["lat"], det["lon"])
                dp   = abs((det["pressure_mb"] or 1000) - (last["pressure_mb"] or 1000))
                if dist < best_dist and dp <= _TRACK_PRESSURE_DELTA:
                    best_dist = dist
                    best_j    = j

            if best_j is not None:
                track.append(hour_dets[best_j])
                matched[best_j] = True

            new_tracks.append(track)

        for j, det in enumerate(hour_dets):
            if not matched[j]:
                new_tracks.append([det])

        active_tracks = new_tracks

    storms = []
    for track in active_tracks:
        if len(track) < 2:
            continue
        h0 = track[0]
        h6 = track[1]

        dt_km     = _haversine_km(h0["lat"], h0["lon"], h6["lat"], h6["lon"])
        speed_kts = round(_ms_to_kts(dt_km * 1000 / (6 * 3600)), 1)
        direction = _bearing_deg(h6["lat"] - h0["lat"], h6["lon"] - h0["lon"])

        forecast_track = [
            {"hours_ahead": d["hours_ahead"], "lat": d["lat"], "lon": d["lon"],
             "pressure_mb": d["pressure_mb"], "peak_wind_kts": d["peak_wind_kts"]}
            for d in track
        ]

        ocean = h0["ocean"]
        basin = _BASIN_LABELS.get(ocean, ocean.replace("-", " ").title())
        storm = {
            "id":                   f"gfs-{h0['lat']:.1f}-{abs(h0['lon']):.1f}-{h0['pressure_mb']}",
            "source":               "model",
            "ocean":                ocean,
            "type":                 "LOW",
            "name":                 f"Low · {basin} (model)",
            "lat":                  h0["lat"],
            "lon":                  h0["lon"],
            "pressure_mb":          h0["pressure_mb"],
            "wind_kts":             h0["peak_wind_kts"],
            "sea_height_ft":        None,
            "sea_range_ft":         None,
            "movement":             {"direction": direction, "speed_kts": speed_kts},
            "warning_tier":         h0["warning_tier"],
            "fetch":                h0["fetch"],
            "forecast_track":       forecast_track,
            "label":                (f"{h0['pressure_mb']} mb"
                                     + (f" · {h0['peak_wind_kts']} kt" if h0["peak_wind_kts"] else "")),
            "issued_utc":           None,
            "raw_text":             None,
            # Phase 4 WW3 fields (from h0 detection)
            "peak_sea_m":           h0.get("peak_sea_m"),
            "peak_period_s":        h0.get("peak_period_s"),
            "swell_direction_deg":  h0.get("swell_direction_deg"),
            "max_cone_hs_m":        h0.get("max_cone_hs_m"),
            "confirmation_status":  h0.get("confirmation_status", "ww3_unavailable"),
        }

        # Phase 4: intensification dynamics
        _annotate_track_dynamics(storm)

        # Phase 5: landfall check
        _annotate_landfall(storm)

        # Phase 7: region impact scoring + narrative
        try:
            from services.region_impact import score_storm_against_regions, compose_narrative
            storm["region_impacts"] = score_storm_against_regions(storm)
            storm["narrative"]      = compose_narrative(storm, storm["region_impacts"])
        except Exception as e:
            print(f"⚠️  storm {storm['id']}: region impact failed: {e}")
            storm["region_impacts"] = []
            storm["narrative"] = None

        storms.append(storm)

    return storms


# ---------------------------------------------------------------------------
# Phase 8 — DB persistence
# ---------------------------------------------------------------------------

def _storm_to_row(storm: Dict, detected_at: datetime, expires_at: str) -> Dict:
    """Map storm dict to derived_storms table columns."""
    fetch = storm.get("fetch") or {}
    return {
        "storm_id":                     storm["id"],
        "source":                       storm.get("source", "model"),
        "bulletin_storm_id":            storm.get("bulletin_storm_id"),
        "detected_at":                  detected_at.isoformat(),
        "current_lat":                  storm["lat"],
        "current_lon":                  storm["lon"],
        "current_pressure_mb":          int(storm["pressure_mb"]) if storm.get("pressure_mb") is not None else None,
        "peak_wind_kts":                int(v) if (v := (storm.get("wind_kts") or storm.get("peak_wind_kts"))) is not None else None,
        "warning_tier":                 storm.get("warning_tier"),
        "basin_label":                  storm.get("name"),
        "is_deepening":                 storm.get("is_deepening"),
        "intensification_rate_mb_per_6h": storm.get("intensification_rate_mb_per_6h"),
        "peak_intensity_hour":          storm.get("peak_intensity_hour"),
        "will_make_landfall":           storm.get("will_make_landfall"),
        "landfall_eta_hours":           storm.get("landfall_eta_hours"),
        "landfall_before_peak":         storm.get("landfall_before_peak"),
        "forecast_track":               storm.get("forecast_track") or [],
        "fetch_quadrants":              fetch.get("quadrants_nm") or {},
        "peak_sea_m":                   storm.get("peak_sea_m"),
        "peak_period_s":                storm.get("peak_period_s"),
        "swell_direction_deg":          storm.get("swell_direction_deg"),
        "max_cone_hs_m":                storm.get("max_cone_hs_m"),
        "confirmation_status":          storm.get("confirmation_status"),
        "region_impacts":               storm.get("region_impacts") or [],
        "narrative":                    storm.get("narrative"),
        "raw_bulletin_text":            storm.get("raw_text"),
        "expires_at":                   expires_at,
    }


async def _persist_derived_storms(storms: List[Dict], detected_at: datetime) -> None:
    """Upsert each storm into derived_storms with expires_at = detected_at + 18h."""
    try:
        from database import get_supabase_admin_client
        client = get_supabase_admin_client()
    except Exception as e:
        print(f"⚠️  detect_storms: DB client unavailable ({e}); skipping persistence")
        return

    if not client:
        print("⚠️  detect_storms: no DB client; skipping persistence")
        return

    expires_at = (detected_at + timedelta(hours=18)).isoformat()
    # Deduplicate by storm_id (keep last occurrence — most recent forecast hour wins)
    seen: Dict[str, Dict] = {}
    for s in storms:
        row = _sanitize_row(_storm_to_row(s, detected_at, expires_at))
        seen[row["storm_id"]] = row
    rows = list(seen.values())

    try:
        client.table("derived_storms").upsert(rows, on_conflict="storm_id").execute()
        print(f"✅ detect_storms: persisted {len(rows)} storms to derived_storms")
    except Exception as e:
        print(f"❌ detect_storms: persistence failed: {e}")


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def run_detection(run_date: Optional[str] = None, run_cycle: Optional[str] = None) -> List[Dict]:
    """
    Full detection pipeline for the given (or latest) GFS run.
    Downloads GFS (and WW3 when available) for each forecast hour,
    detects cyclone centers, builds tracks, annotates, and persists.
    """
    if not run_date or not run_cycle:
        run_date, run_cycle = await resolve_latest_gfs_run()

    # Resolve WW3 run (may lag GFS by one cycle)
    ww3_date, ww3_cycle = await resolve_latest_ww3_run()

    print(f"🌀 storm detector: starting detection for GFS {run_date} {run_cycle}z  "
          f"/ WW3 {ww3_date} {ww3_cycle}z")

    detections_by_hour: List[List[Dict]] = []

    for fh in _FORECAST_HOURS:
        # Fetch GFS
        gfs_result = await fetch_gfs_global_field(run_date, run_cycle, fh)
        if gfs_result is None:
            detections_by_hour.append([])
            continue

        pres_pa, u_ms, v_ms, lat_1d, lon_1d = gfs_result

        # Fetch WW3 for same forecast hour (graceful degradation on failure)
        ww3_result = await fetch_ww3_global_hs(ww3_date, ww3_cycle, fh)
        if ww3_result is not None:
            hs_arr, per_arr, dir_arr, ww3_lat, ww3_lon = ww3_result
        else:
            hs_arr = per_arr = dir_arr = ww3_lat = ww3_lon = None

        hour_dets = detect_at_hour(
            pres_pa, u_ms, v_ms, lat_1d, lon_1d, fh,
            hs_arr=hs_arr, per_arr=per_arr, dir_arr=dir_arr,
            ww3_lat=ww3_lat, ww3_lon=ww3_lon,
            config=_CFG,
        )
        detections_by_hour.append(hour_dets)
        print(f"  f{fh:03d}: {len(hour_dets)} detections")

        await asyncio.sleep(0)

    storms = match_tracks(detections_by_hour)
    print(f"✅ storm detector: {len(storms)} tracked storms from run {run_date} {run_cycle}z")

    set_cached_model_storms(storms)

    # Phase 8: persist to DB
    detected_at = datetime.utcnow().replace(tzinfo=timezone.utc)
    await _persist_derived_storms(storms, detected_at)

    return storms


# ---------------------------------------------------------------------------
# Background job loop
# ---------------------------------------------------------------------------

REFRESH_INTERVAL  = 6 * 3600
STARTUP_DELAY_SEC = 90


async def run_storm_detection_loop() -> None:
    """Long-running background task. Start with asyncio.create_task() in startup()."""
    await asyncio.sleep(STARTUP_DELAY_SEC)
    while True:
        try:
            await run_detection()
        except Exception as e:
            print(f"❌ storm detector loop error: {e}")
        await asyncio.sleep(REFRESH_INTERVAL)
