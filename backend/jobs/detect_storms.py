"""
jobs/detect_storms.py — GFS-pressure-based global cyclone detector.

Addresses Bugs 5 & 6: the bulletin pipeline misses weak NH lows and has
zero Southern Hemisphere coverage. This detector finds pressure minima
directly from the GFS MSL pressure field (globally, every 6h out to 168h),
builds forecast tracks, and merges the result into /api/storms/active.

No scipy dependency — local minima found via numpy roll comparison.
Requires: cfgrib, xarray, numpy (all present in the existing venv).

Cache: in-memory dict `_model_storms_cache` with a 6h TTL, aligned to
GFS run availability. Background job fires every 6h via startup().
"""
from __future__ import annotations

import asyncio
import math
import tempfile
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import httpx
import numpy as np

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
# GFS run resolution
# ---------------------------------------------------------------------------

_NOMADS_BASE = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl"
_NOMADS_DIR  = "/gfs.{date}/{cycle}/atmos"

# Forecast hours to scan: every 6h out to 168h
_FORECAST_HOURS = list(range(0, 174, 6))

# Detection thresholds
_MAX_PRESSURE_MB  = 1005   # reject minima above this (no storm)
_CLUSTER_RADIUS_KM = 200   # merge minima within this radius
_TRACK_RADIUS_KM   = 600   # max distance between track links per 6h step
_TRACK_PRESSURE_DELTA = 20 # max mb change between linked steps


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
    print(f"⚠️  storm detector: could not resolve run; using {fallback} 00z")
    return fallback, "00"


# ---------------------------------------------------------------------------
# GRIB fetch — global 1° PRMSL + UGRD + VGRD
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
            print(f"⚠️  storm detector: GRIB too small at f{fh:03d} ({len(content)} bytes)")
            return None

        import xarray as xr

        with tempfile.NamedTemporaryFile(delete=False, suffix=".grib2") as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        # Open pressure layer
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
            print(f"⚠️  storm detector: no PRMSL variable at f{fh:03d}; vars={list(ds_pres.data_vars)}")
            return None
        pres_arr = ds_pres[prmsl_name].values   # Pa, shape (lat, lon)
        lat_arr  = ds_pres["latitude"].values
        lon_arr  = ds_pres["longitude"].values

        # Open wind layer
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

        print(f"✅ storm detector: fetched f{fh:03d} ({len(content)//1024}KB)")
        return pres_arr, u_arr, v_arr, lat_arr, lon_arr

    except ImportError as e:
        print(f"⚠️  storm detector: missing dep ({e}); skipping")
        return None
    except Exception as e:
        print(f"❌ storm detector: fetch failed at f{fh:03d}: {e}")
        return None


# ---------------------------------------------------------------------------
# Cyclone detection
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
    """
    Find local pressure minima — cells lower than all 8 neighbours.
    Returns list of {lat, lon, pressure_mb}.
    Wraps longitude (periodic boundary); clamps latitude edges.
    """
    p = pres_pa / 100.0   # Pa → mb

    # 8-neighbour comparison using numpy roll (no scipy needed)
    is_min = np.ones(p.shape, dtype=bool)
    for di in [-1, 0, 1]:
        for dj in [-1, 0, 1]:
            if di == 0 and dj == 0:
                continue
            neighbour = np.roll(np.roll(p, di, axis=0), dj, axis=1)
            is_min &= (p <= neighbour)

    # Mask edges (poles) and above threshold
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
    """
    Merge pressure minima within radius_km into a single center.
    Keeps the lowest-pressure (strongest) member as the representative.
    """
    used = [False] * len(minima)
    clusters: List[Dict] = []

    # Sort by pressure ascending so we process strongest first
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
        # Best = lowest pressure in group
        best = min(group, key=lambda x: x["pressure_mb"])
        clusters.append(best)

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
    gale_threshold_ms: float = 17.0,   # ~33 kt
    max_radius_deg: float = 12.0,
) -> Dict:
    """
    Walk outward from center in 8 quadrants; record radius (in nm) where
    wind drops below gale_threshold_ms.  Returns fetch dict compatible with
    the bulletin pipeline shape.
    """
    quadrants = {
        "N":   ( 1,  0), "NE": ( 1,  1), "E":  ( 0,  1), "SE": (-1,  1),
        "S":   (-1,  0), "SW": (-1, -1), "W":  ( 0, -1), "NW": ( 1, -1),
    }
    nlat = len(lat_1d)
    nlon = len(lon_1d)
    # lon_1d may be 0..360 — normalise center_lon for grid lookup
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
        radii[q] = round(steps * 60)   # 1° ≈ 60 nm

    if not any(radii.values()):
        return {"quadrants_nm": radii, "peak_quadrant": None, "peak_radius_nm": 0}

    peak_q = max(radii, key=lambda q: radii[q])
    # Swell travels from opposite direction of peak fetch quadrant
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
    """Coarse basin assignment from lat/lon. Good enough for v1 labelling."""
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


def detect_at_hour(
    pres_pa: np.ndarray,
    u_ms: np.ndarray,
    v_ms: np.ndarray,
    lat_1d: np.ndarray,
    lon_1d: np.ndarray,
    hours_ahead: int,
) -> List[Dict]:
    """Run full detection pipeline for a single forecast hour."""
    raw = find_pressure_minima(pres_pa, lat_1d, lon_1d)
    centers = cluster_minima(raw)
    detections = []
    for c in centers:
        fetch = compute_fetch_geometry(u_ms, v_ms, lat_1d, lon_1d, c["lat"], c["lon"])

        # Peak wind from fetch geometry (rough: gale radius > 0 → at least gale-force)
        # Compute actual max wind speed within 500km of center
        clat_idx = int(np.argmin(np.abs(lat_1d - c["lat"])))
        clon_raw = c["lon"] + 360.0 if c["lon"] < 0 and lon_1d[-1] > 180 else c["lon"]
        clon_idx = int(np.argmin(np.abs(lon_1d - clon_raw)))
        radius_cells = 5   # ~5° ≈ 500km at 1° grid
        r1 = max(0, clat_idx - radius_cells)
        r2 = min(len(lat_1d), clat_idx + radius_cells)
        c1 = (clon_idx - radius_cells) % len(lon_1d)
        c2 = (clon_idx + radius_cells) % len(lon_1d)
        if c1 < c2:
            wind_box_u = u_ms[r1:r2, c1:c2]
            wind_box_v = v_ms[r1:r2, c1:c2]
        else:
            # wraps dateline
            wind_box_u = np.concatenate([u_ms[r1:r2, c1:], u_ms[r1:r2, :c2]], axis=1)
            wind_box_v = np.concatenate([v_ms[r1:r2, c1:], v_ms[r1:r2, :c2]], axis=1)

        wind_spd = np.sqrt(wind_box_u ** 2 + wind_box_v ** 2)
        peak_wind_kts = round(_ms_to_kts(float(wind_spd.max())), 1) if wind_spd.size else None

        ocean = _assign_ocean_basin(c["lat"], c["lon"])
        detections.append({
            "hours_ahead":   hours_ahead,
            "lat":           round(c["lat"], 2),
            "lon":           round(c["lon"], 2),
            "pressure_mb":   int(c["pressure_mb"]),
            "peak_wind_kts": peak_wind_kts,
            "warning_tier":  _warning_tier(peak_wind_kts),
            "ocean":         ocean,
            "fetch":         fetch,
        })
    return detections


# ---------------------------------------------------------------------------
# Track matching
# ---------------------------------------------------------------------------

def match_tracks(detections_by_hour: List[List[Dict]]) -> List[Dict]:
    """
    Link detections across forecast hours into continuous storm tracks.
    Returns a list of storm dicts each with a full forecast_track array.
    """
    if not detections_by_hour:
        return []

    # Each detection starts as its own track seed
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

        # Unmatched detections start new tracks
        for j, det in enumerate(hour_dets):
            if not matched[j]:
                new_tracks.append([det])

        active_tracks = new_tracks

    # Build storm dicts from completed tracks (require ≥2 points for a track)
    storms = []
    for track in active_tracks:
        if len(track) < 2:
            continue
        h0 = track[0]

        # Movement from hour 0 → 6
        h6 = track[1]
        dt_km = _haversine_km(h0["lat"], h0["lon"], h6["lat"], h6["lon"])
        speed_kts = round(_ms_to_kts(dt_km * 1000 / (6 * 3600)), 1)  # km → m/s → kts
        direction = _bearing_deg(h6["lat"] - h0["lat"], h6["lon"] - h0["lon"])

        forecast_track = [
            {"hours_ahead": d["hours_ahead"], "lat": d["lat"], "lon": d["lon"],
             "pressure_mb": d["pressure_mb"], "peak_wind_kts": d["peak_wind_kts"]}
            for d in track
        ]

        ocean  = h0["ocean"]
        basin  = _BASIN_LABELS.get(ocean, ocean.replace("-", " ").title())
        storms.append({
            "id":             f"gfs-{h0['lat']:.1f}-{abs(h0['lon']):.1f}-{h0['pressure_mb']}",
            "source":         "model",
            "ocean":          ocean,
            "type":           "LOW",
            "name":           f"Low · {basin} (model)",
            "lat":            h0["lat"],
            "lon":            h0["lon"],
            "pressure_mb":    h0["pressure_mb"],
            "wind_kts":       h0["peak_wind_kts"],
            "sea_height_ft":  None,
            "sea_range_ft":   None,
            "movement":       {"direction": direction, "speed_kts": speed_kts},
            "warning_tier":   h0["warning_tier"],
            "fetch":          h0["fetch"],
            "forecast_track": forecast_track,
            "label":          f"{h0['pressure_mb']} mb" + (f" · {h0['peak_wind_kts']} kt" if h0["peak_wind_kts"] else ""),
            "issued_utc":     None,
            "raw_text":       None,
        })

    return storms


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def run_detection(run_date: Optional[str] = None, run_cycle: Optional[str] = None) -> List[Dict]:
    """
    Full detection pipeline for the given (or latest) GFS run.
    Downloads PRMSL+UGRD+VGRD for each forecast hour sequentially
    (to avoid hammering NOMADS), detects cyclone centers, builds tracks.
    Returns a flat list of storm dicts ready for /api/storms/active.
    """
    if not run_date or not run_cycle:
        run_date, run_cycle = await resolve_latest_gfs_run()

    print(f"🌀 storm detector: starting detection for run {run_date} {run_cycle}z")
    detections_by_hour: List[List[Dict]] = []

    for fh in _FORECAST_HOURS:
        result = await fetch_gfs_global_field(run_date, run_cycle, fh)
        if result is None:
            # Pad with empty list so hour indices stay aligned
            detections_by_hour.append([])
            continue

        pres_pa, u_ms, v_ms, lat_1d, lon_1d = result
        hour_dets = detect_at_hour(pres_pa, u_ms, v_ms, lat_1d, lon_1d, fh)
        detections_by_hour.append(hour_dets)
        print(f"  f{fh:03d}: {len(hour_dets)} detections")

        # Small yield to avoid blocking the event loop during heavy processing
        await asyncio.sleep(0)

    storms = match_tracks(detections_by_hour)
    print(f"✅ storm detector: {len(storms)} tracked storms from run {run_date} {run_cycle}z")
    set_cached_model_storms(storms)
    return storms


# ---------------------------------------------------------------------------
# Background job loop
# ---------------------------------------------------------------------------

REFRESH_INTERVAL  = 6 * 3600   # seconds — align with GFS run cadence
STARTUP_DELAY_SEC = 90          # give other startup tasks a head start


async def run_storm_detection_loop() -> None:
    """Long-running background task. Start with asyncio.create_task() in startup()."""
    await asyncio.sleep(STARTUP_DELAY_SEC)
    while True:
        try:
            await run_detection()
        except Exception as e:
            print(f"❌ storm detector loop error: {e}")
        await asyncio.sleep(REFRESH_INTERVAL)
