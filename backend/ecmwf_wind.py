"""
ECMWF Open Data wind fetcher.

Uses the `ecmwf-opendata` Python package (pip install ecmwf-opendata) to
download U10/V10 wind components from ECMWF's free IFS forecast data.

No API key required. Data is available at 0.25° resolution, updated 00z/12z,
forecast range 0–144h at 3h steps then 6h steps to 360h.

Gracefully returns None if:
  - ecmwf-opendata is not installed
  - The requested run/step is not yet available
  - Any download/parse error occurs

The caller (main.py get_wind_overlay) will fall back to GFS on None.
"""
import asyncio
import math
import os
import tempfile
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import numpy as np


def _ecmwf_step_hours() -> List[int]:
    """ECMWF IFS forecast hours: 0-144 at 3h, then 150-360 at 6h."""
    steps = list(range(0, 144 + 1, 3))
    steps += list(range(150, 360 + 1, 6))
    return steps


def _nearest_ecmwf_step(forecast_hour: int) -> int:
    """Round forecast_hour down to the nearest valid ECMWF step."""
    steps = _ecmwf_step_hours()
    for s in reversed(steps):
        if s <= forecast_hour:
            return s
    return 0


def _latest_ecmwf_run() -> tuple[str, str]:
    """
    Return the most recent ECMWF run (date, cycle) that should be published.
    ECMWF publishes ~4-5 hours after run time. Runs at 00z and 12z.
    """
    now = datetime.utcnow()
    # Try most-recent available cycle first
    for hrs_back in [5, 11, 17, 23]:
        candidate = now - timedelta(hours=hrs_back)
        cycle = 12 if candidate.hour >= 12 else 0
        run_dt = candidate.replace(hour=cycle, minute=0, second=0, microsecond=0)
        return run_dt.strftime("%Y%m%d"), f"{cycle:02d}"
    return now.strftime("%Y%m%d"), "00"


async def fetch_ecmwf_wind(
    bounds: tuple,
    forecast_hour: int = 0,
    run: Optional[str] = None,
) -> Optional[List[Dict]]:
    """
    Fetch ECMWF IFS 10m wind (U10/V10) for the given bbox.

    Args:
        bounds:        (min_lat, min_lon, max_lat, max_lon) in degrees
        forecast_hour: Forecast lead time in hours (0-360)
        run:           Optional ISO run string "YYYY-MM-DDTHH:00Z"

    Returns:
        List of vector dicts or None on failure.
    """
    try:
        from ecmwf.opendata import Client
    except ImportError:
        print("⚠️  ecmwf-opendata not installed — skipping ECMWF wind")
        return None

    min_lat, min_lon, max_lat, max_lon = bounds

    # Resolve run
    if run:
        try:
            run_dt = datetime.fromisoformat(run.replace("Z", ""))
            run_date = run_dt.strftime("%Y%m%d")
            run_cycle = f"{(run_dt.hour // 12) * 12:02d}"
        except Exception:
            run_date, run_cycle = _latest_ecmwf_run()
    else:
        run_date, run_cycle = _latest_ecmwf_run()

    step = _nearest_ecmwf_step(forecast_hour)

    try:
        loop = asyncio.get_event_loop()

        def _download() -> Optional[str]:
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".grib2")
            tmp.close()
            try:
                client = Client("ecmwf")
                client.retrieve(
                    date=run_date,
                    time=int(run_cycle),
                    step=step,
                    stream="oper",
                    type="fc",
                    param=["10u", "10v"],
                    target=tmp.name,
                )
                return tmp.name
            except Exception as e:
                print(f"⚠️  ECMWF download failed: {e}")
                try:
                    os.unlink(tmp.name)
                except Exception:
                    pass
                return None

        tmp_path = await asyncio.wait_for(
            loop.run_in_executor(None, _download),
            timeout=60.0,
        )
        if not tmp_path:
            return None

        try:
            import xarray as xr

            ds = xr.open_dataset(
                tmp_path,
                engine="cfgrib",
                backend_kwargs={"indexpath": ""},
            )

            u_name = next((n for n in ds.data_vars if n.lower() in ("u10", "10u")), None)
            v_name = next((n for n in ds.data_vars if n.lower() in ("v10", "10v")), None)

            if not u_name or not v_name:
                print(f"❌ ECMWF GRIB: U/V not found. vars={list(ds.data_vars)}")
                return None

            u_da = ds[u_name]
            v_da = ds[v_name]
            lat_name = "latitude" if "latitude" in u_da.coords else "lat"
            lon_name = "longitude" if "longitude" in u_da.coords else "lon"

            u_values = np.array(u_da.values, dtype=np.float64)
            v_values = np.array(v_da.values, dtype=np.float64)
            lats = u_da[lat_name].values
            lons = u_da[lon_name].values

            # Ensure south→north
            if len(lats) >= 2 and lats[0] > lats[-1]:
                u_values = np.flipud(u_values)
                v_values = np.flipud(v_values)
                lats = np.flip(lats)

            lon_grid, lat_grid = np.meshgrid(lons, lats)
            # 0-360 → -180-180
            lon_grid = np.where(lon_grid > 180, lon_grid - 360, lon_grid)

            speed_ms = np.sqrt(u_values ** 2 + v_values ** 2)
            speed_kts = speed_ms * 1.94384
            direction_deg = (270 - np.degrees(np.arctan2(v_values, u_values))) % 360

            # Bbox filter + 0.5° margin
            margin = 0.5
            bbox_mask = (
                (lat_grid >= min_lat - margin) & (lat_grid <= max_lat + margin) &
                (lon_grid >= min_lon - margin) & (lon_grid <= max_lon + margin)
            )
            valid_mask = np.isfinite(speed_ms) & bbox_mask

            total_pts = int(np.sum(valid_mask))
            step_s = max(1, int(math.sqrt(total_pts / 3000))) if total_pts > 3000 else 1
            if step_s > 1:
                u_values     = u_values[::step_s, ::step_s]
                v_values     = v_values[::step_s, ::step_s]
                speed_kts    = speed_kts[::step_s, ::step_s]
                direction_deg = direction_deg[::step_s, ::step_s]
                lat_grid     = lat_grid[::step_s, ::step_s]
                lon_grid     = lon_grid[::step_s, ::step_s]
                valid_mask   = valid_mask[::step_s, ::step_s]

            vectors: List[Dict] = []
            for i in range(lat_grid.shape[0]):
                for j in range(lat_grid.shape[1]):
                    if valid_mask[i, j]:
                        vectors.append({
                            "lat":           round(float(lat_grid[i, j]), 2),
                            "lon":           round(float(lon_grid[i, j]), 2),
                            "speed_kts":     round(float(speed_kts[i, j]), 1),
                            "direction_deg": round(float(direction_deg[i, j]), 0),
                            "u_component":   round(float(u_values[i, j]), 2),
                            "v_component":   round(float(v_values[i, j]), 2),
                        })

            print(f"✅ ECMWF IFS: {len(vectors)} wind vectors ({run_date} {run_cycle}z +{step}h)")
            return vectors if vectors else None

        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    except asyncio.TimeoutError:
        print("❌ ECMWF wind fetch timeout (60s)")
        return None
    except Exception as e:
        print(f"❌ ECMWF wind error: {e}")
        return None
