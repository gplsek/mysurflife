"""
buoy_service.py — Lightweight NDBC buoy fetcher for the map bundle.

Maintains its own 5-minute cache separate from main.py's per-endpoint cache.
Returns data in the same keyed format that surf_scoring.blend_buoy_data expects,
plus a simplified map-bundle shape (id, name, lat, lon, wave_ft, period_s).
"""
import asyncio
import re
import time
from typing import Dict, List, Optional

import httpx

from buoy_registry import FALLBACK_BUOY_LIST, get_all_buoys as get_buoy_list

_NDBC_RT_URL = "https://www.ndbc.noaa.gov/data/realtime2/{}.txt"

_cache: Dict[str, Dict] = {}      # {station_id: {ts, data}}
_CACHE_TTL = 300                   # 5 minutes


def _parse_ndbc_text(text: str) -> Optional[Dict]:
    """Parse NDBC real-time text file, return current-observation dict."""
    lines = [l for l in text.splitlines() if l and not l.startswith("##")]
    if len(lines) < 3:
        return None

    header = lines[0].lstrip("#").split()
    try:
        data_line = next(l for l in lines[2:] if not l.startswith("#"))
        vals = data_line.split()
    except StopIteration:
        return None

    def _col(name: str):
        try:
            idx = header.index(name)
            v = vals[idx]
            return None if v in ("MM", "999", "9999", "99.0", "999.0") else float(v)
        except (ValueError, IndexError):
            return None

    wvht  = _col("WVHT")
    dpd   = _col("DPD")
    mwd   = _col("MWD")
    wspd  = _col("WSPD")
    wdir  = _col("WDIR")
    wtmp  = _col("WTMP")

    return {
        "wave_height_m":       wvht,
        "wave_height_ft":      round(wvht * 3.28084, 1) if wvht is not None else None,
        "dominant_period_sec": dpd,
        "mean_wave_dir":       mwd,
        "wind_speed_ms":       wspd,
        "wind_dir":            wdir,
        "water_temp_c":        wtmp,
    }


async def _fetch_one(session: httpx.AsyncClient, station_id: str) -> Optional[Dict]:
    now = time.time()
    cached = _cache.get(station_id)
    if cached and (now - cached["ts"]) < _CACHE_TTL:
        return cached["data"]

    try:
        url = _NDBC_RT_URL.format(station_id)
        resp = await session.get(url, timeout=10.0)
        resp.raise_for_status()
        parsed = _parse_ndbc_text(resp.text)
        if parsed:
            parsed["station"] = station_id
            _cache[station_id] = {"ts": now, "data": parsed}
        return parsed
    except Exception as e:
        print(f"⚠️  buoy_service: fetch failed for {station_id}: {e}")
        cached = _cache.get(station_id)
        return cached["data"] if cached else None


async def get_buoy_data_cache() -> Dict[str, Dict]:
    """Return {station_id: data_dict} for all known buoys (surf_scoring format)."""
    buoys = get_buoy_list() or FALLBACK_BUOY_LIST
    async with httpx.AsyncClient() as session:
        results = await asyncio.gather(
            *[_fetch_one(session, b["id"]) for b in buoys],
            return_exceptions=True,
        )
    return {
        b["id"]: r
        for b, r in zip(buoys, results)
        if r and not isinstance(r, Exception)
    }


async def get_map_buoys() -> List[Dict]:
    """Return simplified buoy list for /api/map/bundle."""
    buoys = get_buoy_list() or FALLBACK_BUOY_LIST
    cache = await get_buoy_data_cache()
    out = []
    for b in buoys:
        d = cache.get(b["id"]) or {}
        out.append({
            "id":     b["id"],
            "name":   b.get("name", b["id"]),
            "lat":    b["lat"],
            "lon":    b["lon"],
            "wave":   d.get("wave_height_ft"),
            "period": d.get("dominant_period_sec"),
        })
    return out
