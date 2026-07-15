"""
services/point_forecast.py — model point forecasts from the tile grid cache.

The wind/wave overlays already keep global GFS (u/v/gust) and GFSWave
(height/period/direction + partition-1 swell) grids on disk for every
3-hourly step out to 240h (self-warmed on map use, prewarmed by cron).
Sampling those grids gives Sione the full model dataset at any lat/lon
with zero new data infrastructure.

Fast by construction: only hours whose grids are ALREADY cached (RAM or
disk) are sampled — a missing hour is reported in `missing_hours` rather
than triggering a 15-30s NOMADS fetch inside a chat tool call.
"""
import math
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

import overlay_tiles as ot
import wave_tiles as wt
from overlay_tiles import GRID_CACHE_DIR, MS_TO_KTS, _bilinear_sample

M_TO_FT = 3.28084


def _best_cached_run(model_dir: Path, preferred: Optional[str]) -> Optional[str]:
    """Prefer the latest run, but fall back to the newest run with cached
    grids — right after a run flips, the new one hasn't warmed yet and a chat
    tool answering from the previous run beats answering with nothing."""
    if preferred and any((model_dir / preferred).glob("f*.npz")):
        return preferred
    if model_dir.exists():
        for run in sorted((p.name for p in model_dir.iterdir() if p.is_dir()), reverse=True):
            if any((model_dir / run).glob("f*.npz")):
                return run
    return preferred


def _sample(grids: Dict[str, np.ndarray], key: str, lat: float, lon: float) -> Optional[float]:
    """Bilinear sample; near the coast (NaN cells — wave direction/period are
    left unfilled for the particle textures) fall back to the nearest finite
    cell within ~1°, which is the open-water value a surfer actually wants."""
    field = grids.get(key)
    if field is None:
        return None
    lats, lons = grids["lats"], grids["lons"]
    val = float(_bilinear_sample(field, lats, lons,
                                 np.array([[lat]], dtype=float),
                                 np.array([[lon]], dtype=float))[0, 0])
    if math.isfinite(val):
        return val

    # Expanding-ring scan around the nearest grid index (lon wraps).
    i = int(np.clip(np.searchsorted(lats, lat), 0, len(lats) - 1))
    j = int(np.argmin(np.abs(((lons - (lon % 360.0)) + 180.0) % 360.0 - 180.0)))
    n_lat, n_lon = field.shape
    for ring in range(1, 5):
        best = None
        for di in range(-ring, ring + 1):
            for dj in range(-ring, ring + 1):
                if max(abs(di), abs(dj)) != ring:
                    continue
                ii = i + di
                if not (0 <= ii < n_lat):
                    continue
                v = float(field[ii, (j + dj) % n_lon])
                if math.isfinite(v):
                    best = v if best is None else best
        if best is not None:
            return best
    return None


def _wind_from_deg(u: float, v: float) -> float:
    """Meteorological FROM-direction of the wind vector (u east, v north)."""
    return round(math.degrees(math.atan2(-u, -v)) % 360.0, 0)


async def sample_point_forecast(
    lat: float,
    lon: float,
    start_hour: int = 0,
    end_hour: int = 120,
    step_hours: int = 6,
) -> Dict[str, Any]:
    """Sampled wind + wave model series at one point.

    Per step: wind speed/gust (kt) + FROM-direction, significant wave height
    (ft) + primary period/direction, partition-1 swell height/period/direction.
    Direction values follow the project FROM-direction convention.
    """
    start_hour = max(0, int(start_hour))
    end_hour = min(int(end_hour), ot.TILE_HOURS[-1])
    step_hours = max(3, int(step_hours))
    hours = [h for h in ot.TILE_HOURS if start_hour <= h <= end_hour and h % step_hours == 0]
    hours = hours[:40]  # hard cap on tool payload

    wind_run = _best_cached_run(GRID_CACHE_DIR / "gfs", await ot.resolve_latest_run("gfs"))
    wave_run = _best_cached_run(GRID_CACHE_DIR / wt.WAVE_MODEL, await wt.resolve_latest_run())

    points: List[Dict] = []
    missing: List[int] = []
    for h in hours:
        entry: Dict[str, Any] = {"hour": h}
        have_any = False

        if wind_run and ot._grid_path("gfs", wind_run, h).exists():
            grids = await ot.get_grids("gfs", wind_run, h)
            if grids is not None:
                u = _sample(grids, "u", lat, lon)
                v = _sample(grids, "v", lat, lon)
                gust = _sample(grids, "gust", lat, lon)
                if u is not None and v is not None:
                    entry["wind_kts"] = round(math.hypot(u, v) * MS_TO_KTS, 1)
                    entry["wind_from_deg"] = _wind_from_deg(u, v)
                    have_any = True
                if gust is not None:
                    entry["gust_kts"] = round(gust * MS_TO_KTS, 1)

        if wave_run and wt._grid_path(wave_run, h).exists():
            wgrids = await wt.get_grids(wave_run, h)
            if wgrids is not None:
                hs = _sample(wgrids, "hs", lat, lon)
                if hs is not None:
                    entry["wave_height_ft"] = round(hs * M_TO_FT, 1)
                    entry["wave_period_s"] = _sample(wgrids, "per", lat, lon)
                    entry["wave_from_deg"] = _sample(wgrids, "dir", lat, lon)
                    have_any = True
                sw_h = _sample(wgrids, "sw_h", lat, lon)
                if sw_h is not None:
                    entry["swell_height_ft"] = round(sw_h * M_TO_FT, 1)
                    entry["swell_period_s"] = _sample(wgrids, "sw_per", lat, lon)
                    entry["swell_from_deg"] = _sample(wgrids, "sw_dir", lat, lon)

        if have_any:
            for k in ("wave_period_s", "wave_from_deg", "swell_period_s", "swell_from_deg"):
                if entry.get(k) is not None:
                    entry[k] = round(entry[k], 1)
            points.append(entry)
        else:
            missing.append(h)

    return {
        "lat": lat,
        "lon": lon,
        "wind_model": "GFS 0.25deg" if wind_run else None,
        "wave_model": "GFSWave 0.25deg" if wave_run else None,
        "wind_run": wind_run,
        "wave_run": wave_run,
        "points": points,
        "missing_hours": missing,
        "note": ("Directions are FROM-direction (deg true). wave_height = total sea; "
                 "swell_* = primary swell partition. Land points return wind only."),
    }
