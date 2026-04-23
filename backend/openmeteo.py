"""
backend/openmeteo.py
====================
Point-forecast fetcher using Open-Meteo Marine + Weather APIs.
Data: Open-Meteo (CC-BY-4.0) — https://open-meteo.com

Two HTTP requests per spot vs 58 GRIB downloads from NOMADS:
  - Marine API:  wave_height, wave_period, swell_1/2 partitions, wind_sea
  - Forecast API: wind_speed_10m, wind_direction_10m

Cache strategy:
  Redis key: openmeteo:point:{lat:.2f}:{lon:.2f}:{hours}
  TTL: 1 hour (aligns with Open-Meteo model update cadence)
  Rounded to 2 decimals so nearby spots share the cache (~1km radius).

Fallback for the /forecast-timeline endpoint in main.py.
GFS-Wave GRIB pipeline is kept intact for 2D map overlay use.
"""

import asyncio
import pickle
from datetime import datetime, timedelta, timezone

import httpx

from utils import calculate_surf_height

_MARINE_URL  = "https://marine-api.open-meteo.com/v1/marine"
_WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
_CACHE_TTL_S = 3600  # 1 hour


async def fetch_spot_forecast(
    lat: float,
    lon: float,
    hours: int = 168,
    redis_client=None,
) -> list:
    """
    Return a list of forecast dicts at 6-hour intervals.

    Each dict: {
        "hour":  int,          # offset from now (0, 6, 12, ...)
        "wave":  {
            "height_m", "height_ft", "direction", "period",
            "surf_height_m", "surf_height_ft",
            "swell_1": {"height_m", "height_ft", "period", "direction"},  # primary swell
            "swell_2": {"height_m", "height_ft", "period", "direction"},  # secondary swell (when present)
            "wind_sea": {"height_m", "height_ft", "period", "direction"}, # local chop (when present)
        },
        "wind":  {"speed_ms", "speed_mph", "direction"},
    }

    Attribution required: "Data: Open-Meteo (CC-BY-4.0) | open-meteo.com"
    """
    lat_r = round(lat, 2)
    lon_r = round(lon, 2)
    cache_key = f"openmeteo:point:{lat_r:.2f}:{lon_r:.2f}:{hours}"

    if redis_client:
        try:
            raw = redis_client.get(cache_key.encode())
            if raw:
                return pickle.loads(raw)
        except Exception:
            pass

    result = await _fetch_from_api(lat_r, lon_r, hours)

    if redis_client and result:
        try:
            redis_client.setex(cache_key.encode(), _CACHE_TTL_S, pickle.dumps(result))
        except Exception:
            pass

    return result


async def _fetch_from_api(lat: float, lon: float, hours: int) -> list:
    forecast_days = min(10, hours // 24 + 2)

    async with httpx.AsyncClient(timeout=15.0) as client:
        marine_r, wind_r = await asyncio.gather(
            client.get(
                _MARINE_URL,
                params={
                    "latitude":  lat,
                    "longitude": lon,
                    "hourly": (
                        "wave_height,wave_direction,wave_period,"
                        "swell_wave_height,swell_wave_direction,swell_wave_period,"
                        "secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,"
                        "wind_wave_height,wind_wave_direction,wind_wave_period"
                    ),
                    "forecast_days": forecast_days,
                    "format": "json",
                },
            ),
            client.get(
                _WEATHER_URL,
                params={
                    "latitude":        lat,
                    "longitude":       lon,
                    "hourly":          "wind_speed_10m,wind_direction_10m",
                    "forecast_days":   forecast_days,
                    "wind_speed_unit": "ms",
                    "format":          "json",
                },
            ),
        )
    marine_r.raise_for_status()
    wind_r.raise_for_status()

    marine = marine_r.json().get("hourly", {})
    wind_j = wind_r.json().get("hourly", {})

    times = marine.get("time", [])
    time_idx = {t: i for i, t in enumerate(times)}

    now_utc = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    def _v(src: dict, key: str, i: int):
        vals = src.get(key, [])
        return vals[i] if i < len(vals) else None

    result = []
    for h in range(0, hours + 1, 6):
        t_str = (now_utc + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00")
        i = time_idx.get(t_str)
        if i is None:
            continue

        wh = _v(marine, "wave_height", i)
        wd = _v(marine, "wave_direction", i)
        wp = _v(marine, "wave_period", i)

        sw1_h = _v(marine, "swell_wave_height", i)
        sw1_d = _v(marine, "swell_wave_direction", i)
        sw1_p = _v(marine, "swell_wave_period", i)

        sw2_h = _v(marine, "secondary_swell_wave_height", i)
        sw2_d = _v(marine, "secondary_swell_wave_direction", i)
        sw2_p = _v(marine, "secondary_swell_wave_period", i)

        ws_h = _v(marine, "wind_wave_height", i)
        ws_d = _v(marine, "wind_wave_direction", i)
        ws_p = _v(marine, "wind_wave_period", i)

        surf_m = calculate_surf_height(wh, wp) if wh and wp else None
        wave_data: dict = {
            "height_m":       wh,
            "height_ft":      round(wh * 3.28084, 2) if wh else None,
            "direction":      wd,
            "period":         wp,
            "surf_height_m":  surf_m,
            "surf_height_ft": round(surf_m * 3.28084, 1) if surf_m else None,
        }

        if sw1_h and sw1_h > 0.1:
            wave_data["swell_1"] = {
                "height_m":  sw1_h,
                "height_ft": round(sw1_h * 3.28084, 1),
                "period":    sw1_p,
                "direction": sw1_d,
            }
        if sw2_h and sw2_h > 0.1:
            wave_data["swell_2"] = {
                "height_m":  sw2_h,
                "height_ft": round(sw2_h * 3.28084, 1),
                "period":    sw2_p,
                "direction": sw2_d,
            }
        if ws_h and ws_h > 0.1:
            wave_data["wind_sea"] = {
                "height_m":  ws_h,
                "height_ft": round(ws_h * 3.28084, 1),
                "period":    ws_p,
                "direction": ws_d,
            }

        wind_ms = _v(wind_j, "wind_speed_10m", i)
        wind_dir = _v(wind_j, "wind_direction_10m", i)
        wind_data = {
            "speed_ms":  round(wind_ms, 1) if wind_ms is not None else None,
            "speed_mph": round(wind_ms * 2.23694, 1) if wind_ms is not None else None,
            "direction": wind_dir,
        }

        result.append({"hour": h, "wave": wave_data, "wind": wind_data})

    return result
