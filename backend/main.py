from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import json
import math
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Optional
from netCDF4 import Dataset
import numpy as np

app = FastAPI()

# Simple in-memory cache
cache: Dict[str, Dict] = {}
CACHE_DURATION = timedelta(minutes=5)  # NDBC updates every ~10 min, cache for 5

# Load wind station mapping
WIND_MAPPING_FILE = Path(__file__).parent.parent / "buoy_to_wind_station_map.json"
try:
    with open(WIND_MAPPING_FILE, 'r') as f:
        WIND_STATION_MAP = json.load(f)
except FileNotFoundError:
    WIND_STATION_MAP = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BUOY_LIST = [
    {"id": "46266", "lat": 32.933, "lon": -117.317, "name": "Del Mar Nearshore", "wind_fallback": "LJAC1"},
    {"id": "46225", "lat": 32.866, "lon": -117.283, "name": "Torrey Pines Outer", "wind_fallback": "LJAC1"},
    {"id": "46259", "lat": 32.749, "lon": -117.258, "name": "Mission Bay", "wind_fallback": "SDBC1"},
    {"id": "46232", "lat": 32.65,  "lon": -117.3,   "name": "Point Loma South", "wind_fallback": "SDBC1"},
    {"id": "46236", "lat": 32.55,  "lon": -117.15,  "name": "Imperial Beach", "wind_fallback": "TIXC1"},
    {"id": "46258", "lat": 33.475, "lon": -118.533, "name": "San Pedro Channel", "wind_fallback": "LJAC1"},
    {"id": "46222", "lat": 33.75,  "lon": -118.833, "name": "Santa Monica Basin", "wind_fallback": "AGXC1"},
    {"id": "46086", "lat": 34.25,  "lon": -120.45,  "name": "Pt. Dume / Santa Barbara", "wind_fallback": None},
    {"id": "46011", "lat": 34.935, "lon": -121.93,  "name": "Santa Maria", "wind_fallback": None},
    {"id": "46027", "lat": 40.75,  "lon": -124.5,   "name": "Cape Mendocino", "wind_fallback": None},
    {"id": "46014", "lat": 39.22,  "lon": -123.97,  "name": "Pt. Arena", "wind_fallback": None},
    {"id": "46026", "lat": 37.75,  "lon": -122.83,  "name": "San Francisco Bar", "wind_fallback": "FTPC1"},
    {"id": "46012", "lat": 36.75,  "lon": -122.43,  "name": "Monterey Bay", "wind_fallback": "MEYC1"},
    {"id": "46013", "lat": 38.24,  "lon": -123.31,  "name": "Bodega Bay", "wind_fallback": "PRYC1"}
]

async def fetch_wind_from_station(station_id: str) -> Dict:
    """Fetch wind data from a fallback station (NOS CO-OPS)."""
    try:
        url = f"https://www.ndbc.noaa.gov/data/realtime2/{station_id}.txt"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            lines = response.text.splitlines()

        headers = []
        for line in lines:
            if line.startswith("#"):
                if not headers and "WDIR" in line and "WSPD" in line:
                    headers = line.lstrip("#").split()
                continue

            if not line.strip():
                continue

            values = line.split()
            if len(headers) == 0 or len(values) != len(headers):
                continue

            parsed = dict(zip(headers, values))

            # Parse wind data
            try:
                wind_dir = float(parsed.get("WDIR", "0"))
                if wind_dir == 999 or wind_dir == 0:
                    wind_dir = None
            except:
                wind_dir = None

            try:
                wind_speed_ms = float(parsed.get("WSPD", "0"))
                if wind_speed_ms == 99:
                    wind_speed_ms = None
            except:
                wind_speed_ms = None

            try:
                wind_gust_ms = float(parsed.get("GST", "0"))
                if wind_gust_ms == 99:
                    wind_gust_ms = None
            except:
                wind_gust_ms = None

            return {
                "wind_dir": wind_dir,
                "wind_speed_ms": wind_speed_ms,
                "wind_gust_ms": wind_gust_ms,
                "wind_source": station_id
            }

        return {"wind_dir": None, "wind_speed_ms": None, "wind_gust_ms": None, "wind_source": None}
    except:
        return {"wind_dir": None, "wind_speed_ms": None, "wind_gust_ms": None, "wind_source": None}


async def fetch_buoy_data(buoy_id: str, use_cache: bool = True, wind_fallback_station: Optional[str] = None) -> Dict:
    """Fetch buoy data from NDBC with caching and timeout handling."""
    
    # Check cache first
    if use_cache and buoy_id in cache:
        cached_data = cache[buoy_id]
        if datetime.now() - cached_data["cached_at"] < CACHE_DURATION:
            return cached_data["data"]
    
    try:
        url = f"https://www.ndbc.noaa.gov/data/realtime2/{buoy_id}.txt"
        async with httpx.AsyncClient(timeout=10.0) as client:  # 10 second timeout
            response = await client.get(url)
            response.raise_for_status()  # Raise error for bad status codes
            lines = response.text.splitlines()

        headers = []
        wave_heights = []  # Store last few wave heights for trend
        first_valid_row = None
        
        for line in lines:
            # Skip all comment lines (both header and units rows)
            if line.startswith("#"):
                # Parse the header line (first # line with column names)
                if not headers and all(k in line for k in ("WVHT", "DPD", "MWD")):
                    headers = line.lstrip("#").split()
                continue

            # Skip empty lines
            if not line.strip():
                continue

            values = line.split()
            if len(headers) == 0 or len(values) != len(headers):
                continue

            parsed = dict(zip(headers, values))
            
            # Skip rows with missing critical data (MM = missing)
            if parsed.get("WVHT") in ["MM", "NaN", None] or parsed.get("DPD") in ["MM", "NaN", None]:
                continue
            
            # Store wave height for trend calculation (collect up to 5 readings)
            try:
                wh = float(parsed.get("WVHT", "0"))
                if wh > 0 and len(wave_heights) < 5:
                    wave_heights.append(wh)
            except:
                pass
            
            # Keep the first valid row for current conditions
            if first_valid_row is None:
                first_valid_row = parsed

        # Use the first valid row for current conditions
        if first_valid_row is None:
            return {"station": buoy_id, "error": "No valid data rows found"}
            
        parsed = first_valid_row
        
        # Calculate wave height trend
        wave_trend = "holding"  # default
        if len(wave_heights) >= 3:
            # Compare most recent vs older readings (newest is index 0)
            recent_avg = sum(wave_heights[:2]) / 2  # Last 2 readings
            older_avg = sum(wave_heights[2:4]) / min(2, len(wave_heights[2:4]))  # Previous 2 readings
            diff_percent = ((recent_avg - older_avg) / older_avg) * 100
            
            if diff_percent > 10:  # More than 10% increase
                wave_trend = "rising"
            elif diff_percent < -10:  # More than 10% decrease
                wave_trend = "falling"
            else:
                wave_trend = "holding"
        
        # Handle different possible column names
        year = parsed.get("YY") or parsed.get("yr")
        month = parsed.get("MM") or parsed.get("mo")
        day = parsed.get("DD") or parsed.get("dy")
        hour = parsed.get("hh") or parsed.get("hr")
        minute = parsed.get("mm") or parsed.get("mn")

        # Parse wave height (keep in meters, let frontend convert)
        try:
            wave_height_m = float(parsed.get("WVHT", "0"))
        except:
            wave_height_m = None
        
        # Parse dominant period for calculations
        try:
            dpd_sec = float(parsed.get("DPD", "0"))
            if dpd_sec == 0:
                dpd_sec = None
        except:
            dpd_sec = None
        
        # Calculate surf face height and wave energy
        surf_height_m = None
        wave_energy = None
        
        if wave_height_m and dpd_sec:
            # Surf face height: 0.7 × WVHT × √DPD
            surf_height_m = round(0.7 * wave_height_m * math.sqrt(dpd_sec), 2)
            
            # Wave Energy Index: WVHT² × DPD
            wave_energy = round(wave_height_m ** 2 * dpd_sec, 1)

        # Parse water temperature (in Celsius)
        try:
            water_temp_c = float(parsed.get("WTMP", "0"))
        except:
            water_temp_c = None

        # Parse air temperature (in Celsius)
        try:
            air_temp_c = float(parsed.get("ATMP", "0"))
        except:
            air_temp_c = None

        # Parse wind direction (in degrees)
        try:
            wind_dir = float(parsed.get("WDIR", "0"))
            if wind_dir == 999 or wind_dir == 0:  # NDBC uses 999 for missing data
                wind_dir = None
        except:
            wind_dir = None

        # Parse wind speed (in m/s)
        try:
            wind_speed_ms = float(parsed.get("WSPD", "0"))
            if wind_speed_ms == 99:  # NDBC uses 99 for missing data
                wind_speed_ms = None
        except:
            wind_speed_ms = None

        # Parse wind gust (in m/s)
        try:
            wind_gust_ms = float(parsed.get("GST", "0"))
            if wind_gust_ms == 99:  # NDBC uses 99 for missing data
                wind_gust_ms = None
        except:
            wind_gust_ms = None

        # Format timestamp in ISO format (UTC) for easy frontend parsing
        timestamp_utc = f"{year}-{month.zfill(2)}-{day.zfill(2)}T{hour.zfill(2)}:{minute.zfill(2)}:00Z"

        result = {
            "station": buoy_id,
            "timestamp_utc": timestamp_utc,
            "wave_height_m": wave_height_m,
            "wave_trend": wave_trend,
            "surf_height_m": surf_height_m,
            "wave_energy": wave_energy,
            "dominant_period_sec": dpd_sec or parsed.get("DPD", "N/A"),
            "mean_wave_dir": parsed.get("MWD", "N/A"),
            "water_temp_c": water_temp_c,
            "air_temp_c": air_temp_c,
            "wind_dir": wind_dir,
            "wind_speed_ms": wind_speed_ms,
            "wind_gust_ms": wind_gust_ms,
            "wind_source": "buoy"
        }
        
        # If wind data is missing and we have a fallback station, try to fetch from it
        if (wind_dir is None or wind_speed_ms is None) and wind_fallback_station:
            fallback_wind = await fetch_wind_from_station(wind_fallback_station)
            result["wind_dir"] = fallback_wind.get("wind_dir")
            result["wind_speed_ms"] = fallback_wind.get("wind_speed_ms")
            result["wind_gust_ms"] = fallback_wind.get("wind_gust_ms")
            result["wind_source"] = fallback_wind.get("wind_source") or "N/A"
        
        # Cache the successful result
        cache[buoy_id] = {
            "data": result,
            "cached_at": datetime.now()
        }
        
        return result
        
    except httpx.TimeoutException:
        return {"station": buoy_id, "error": "Request timeout"}
    except httpx.HTTPStatusError as e:
        return {"station": buoy_id, "error": f"HTTP {e.response.status_code}"}
    except Exception as e:
        return {"station": buoy_id, "error": str(e)}

@app.get("/api/buoy-status")
async def get_primary_buoy():
    """Get data for the primary buoy (Del Mar Nearshore)."""
    primary_buoy = next((b for b in BUOY_LIST if b["id"] == "46266"), None)
    wind_fallback = primary_buoy.get("wind_fallback") if primary_buoy else None
    return await fetch_buoy_data("46266", wind_fallback_station=wind_fallback)

@app.get("/api/buoy-status/all")
async def get_all_buoys():
    """Get data for all buoys concurrently with caching and wind fallback."""
    # Fetch all buoys concurrently with their wind fallback stations
    tasks = [
        fetch_buoy_data(buoy["id"], wind_fallback_station=buoy.get("wind_fallback")) 
        for buoy in BUOY_LIST
    ]
    results = await asyncio.gather(*tasks)
    
    # Merge with buoy metadata
    for i, buoy in enumerate(BUOY_LIST):
        results[i].update({
            "lat": buoy["lat"], 
            "lon": buoy["lon"], 
            "name": buoy["name"]
        })
    
    return results

@app.get("/api/cache/clear")
async def clear_cache():
    """Clear the buoy data cache (useful for debugging)."""
    cache.clear()
    return {"message": "Cache cleared", "timestamp": datetime.now().isoformat()}

@app.get("/api/buoy-history/{station_id}")
async def get_buoy_history(station_id: str, hours: int = 48):
    """
    Fetch historical wave data for a buoy from NDBC.
    Returns time series of wave height, period, direction, wind, etc.
    """
    cache_key = f"history_{station_id}_{hours}"
    
    # Check cache (longer TTL for historical data - 30 minutes)
    if cache_key in cache:
        cached_time = cache[cache_key].get("cached_at")
        if cached_time and datetime.now() - cached_time < timedelta(minutes=30):
            return cache[cache_key]["data"]
    
    url = f"https://www.ndbc.noaa.gov/data/realtime2/{station_id}.txt"
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            text = response.text
    except Exception as e:
        return {
            "error": f"Failed to fetch data: {str(e)}",
            "station_id": station_id,
            "data": []
        }
    
    lines = text.strip().split("\n")
    headers = None
    data_points = []
    cutoff_time = datetime.utcnow() - timedelta(hours=hours)
    
    for line in lines:
        # Skip comment lines (headers and units)
        if line.startswith("#"):
            if not headers:
                # Extract header from first # line
                headers = line.lstrip("#").split()
            continue
        
        if not line.strip():
            continue
        
        # Parse data row
        parts = line.split()
        if len(parts) < 5:
            continue
        
        try:
            # Parse timestamp: YY MM DD hh mm
            year = int(parts[0])
            month = int(parts[1])
            day = int(parts[2])
            hour = int(parts[3])
            minute = int(parts[4])
            
            # Handle 2-digit year (NDBC uses YY format)
            if year < 100:
                year += 2000
            
            timestamp = datetime(year, month, day, hour, minute)
            
            # Skip data older than requested hours
            if timestamp < cutoff_time:
                continue
            
            # Parse wave data
            def safe_float(val):
                try:
                    f = float(val)
                    return None if f == 99.0 or f == 999.0 or f == 9999.0 or f == 99.0 else f
                except:
                    return None
            
            # Map data based on headers
            data_dict = {}
            for i, header in enumerate(headers):
                if i < len(parts):
                    data_dict[header] = parts[i]
            
            # Extract key wave metrics
            wvht_m = safe_float(data_dict.get("WVHT"))
            dpd_sec = safe_float(data_dict.get("DPD"))
            mwd_deg = safe_float(data_dict.get("MWD"))
            wspd_ms = safe_float(data_dict.get("WSPD"))
            wdir_deg = safe_float(data_dict.get("WDIR"))
            gst_ms = safe_float(data_dict.get("GST"))
            atmp_c = safe_float(data_dict.get("ATMP"))
            wtmp_c = safe_float(data_dict.get("WTMP"))
            
            # Convert to imperial
            wvht_ft = round(wvht_m * 3.28084, 2) if wvht_m is not None else None
            
            # Calculate surf height and energy if we have data
            surf_height_m = None
            wave_energy = None
            if wvht_m is not None and dpd_sec is not None:
                surf_height_m = round(0.7 * wvht_m * math.sqrt(dpd_sec), 2)
                wave_energy = round(wvht_m ** 2 * dpd_sec, 1)
            
            data_point = {
                "timestamp": timestamp.isoformat() + "Z",
                "wvht_m": wvht_m,
                "wvht_ft": wvht_ft,
                "dpd_sec": dpd_sec,
                "mwd_deg": mwd_deg,
                "surf_height_m": surf_height_m,
                "wave_energy": wave_energy,
                "wspd_ms": wspd_ms,
                "wdir_deg": wdir_deg,
                "gst_ms": gst_ms,
                "atmp_c": atmp_c,
                "wtmp_c": wtmp_c
            }
            
            data_points.append(data_point)
            
        except (ValueError, IndexError) as e:
            # Skip malformed rows
            continue
    
    # Sort by timestamp (oldest first)
    data_points.sort(key=lambda x: x["timestamp"])
    
    result = {
        "station_id": station_id,
        "hours": hours,
        "data_points": len(data_points),
        "data": data_points
    }
    
    # Cache the result
    cache[cache_key] = {
        "cached_at": datetime.now(),
        "data": result
    }
    
    return result

async def fetch_cdip_ecmwf_forecast(cdip_id: str, hours: int = 120):
    """
    Fetch ECMWF model forecast from CDIP THREDDS server using OPeNDAP.
    Returns forecast data or None if unavailable.
    """
    try:
        # CDIP model forecast URL (trying different possible patterns)
        possible_urls = [
            f"https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/{cdip_id}/{cdip_id}_rt.nc",
            f"https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_validation/{cdip_id}/{cdip_id}_rt.nc",
            f"https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/{cdip_id}_rt.nc",
        ]
        
        dataset = None
        successful_url = None
        
        # Try each URL pattern
        for url in possible_urls:
            try:
                dataset = Dataset(url)
                successful_url = url
                break
            except Exception:
                continue
        
        if not dataset:
            return None
        
        # Extract variables (CDIP uses these variable names)
        # Common CDIP variables: waveTime, waveHs (significant height), waveTp (peak period), waveDp (peak direction)
        time_var = None
        hs_var = None
        tp_var = None
        dp_var = None
        
        # Try to find the correct variable names
        var_names = list(dataset.variables.keys())
        
        # Look for time variable
        for name in ['waveTime', 'time', 'wave_time']:
            if name in var_names:
                time_var = dataset.variables[name]
                break
        
        # Look for significant wave height
        for name in ['waveHs', 'Hs', 'wave_height', 'hs']:
            if name in var_names:
                hs_var = dataset.variables[name]
                break
        
        # Look for peak period
        for name in ['waveTp', 'Tp', 'wave_period', 'tp']:
            if name in var_names:
                tp_var = dataset.variables[name]
                break
        
        # Look for peak direction
        for name in ['waveDp', 'Dp', 'wave_direction', 'dp', 'meanDirection']:
            if name in var_names:
                dp_var = dataset.variables[name]
                break
        
        if not time_var or not hs_var:
            dataset.close()
            return None
        
        # Read data
        times = time_var[:]
        wave_heights = hs_var[:]
        
        # Read optional variables
        periods = tp_var[:] if tp_var else None
        directions = dp_var[:] if dp_var else None
        
        # Convert time to datetime objects
        # CDIP typically uses Unix timestamp or days since epoch
        time_units = time_var.units if hasattr(time_var, 'units') else 'seconds since 1970-01-01'
        
        forecast_points = []
        now = datetime.utcnow()
        cutoff = now + timedelta(hours=hours)
        
        for i in range(len(times)):
            try:
                # Convert CDIP time to datetime
                if 'since' in time_units.lower():
                    # Parse "seconds/days since YYYY-MM-DD"
                    base_time = datetime(1970, 1, 1)  # Common epoch
                    if 'days' in time_units.lower():
                        forecast_time = base_time + timedelta(days=float(times[i]))
                    else:
                        forecast_time = base_time + timedelta(seconds=float(times[i]))
                else:
                    forecast_time = datetime.fromtimestamp(float(times[i]))
                
                # Only include future times within the requested window
                if forecast_time < now or forecast_time > cutoff:
                    continue
                
                wvht_m = float(wave_heights[i])
                dpd_sec = float(periods[i]) if periods is not None and not np.isnan(periods[i]) else None
                mwd_deg = float(directions[i]) if directions is not None and not np.isnan(directions[i]) else None
                
                # Skip invalid data
                if np.isnan(wvht_m) or wvht_m < 0:
                    continue
                
                # Calculate derived metrics
                surf_height_m = None
                wave_energy = None
                
                if dpd_sec and dpd_sec > 0:
                    surf_height_m = round(0.7 * wvht_m * math.sqrt(dpd_sec), 2)
                    wave_energy = round(wvht_m ** 2 * dpd_sec, 1)
                
                forecast_point = {
                    "timestamp": forecast_time.isoformat() + "Z",
                    "wvht_m": round(wvht_m, 2),
                    "wvht_ft": round(wvht_m * 3.28084, 2),
                    "dpd_sec": round(dpd_sec, 1) if dpd_sec else None,
                    "mwd_deg": round(mwd_deg, 1) if mwd_deg else None,
                    "surf_height_m": surf_height_m,
                    "wave_energy": wave_energy,
                    "source": "CDIP_ECMWF",
                    "confidence": "high"
                }
                
                forecast_points.append(forecast_point)
                
            except Exception as e:
                continue
        
        dataset.close()
        
        if forecast_points:
            return {
                "source_url": successful_url,
                "data": forecast_points
            }
        
        return None
        
    except Exception as e:
        print(f"CDIP forecast fetch error for {cdip_id}: {str(e)}")
        return None

@app.get("/api/buoy-forecast/{station_id}")
async def get_buoy_forecast(station_id: str, hours: int = 120):
    """
    Fetch forecast wave data for a buoy from CDIP/model sources.
    Returns forecasted wave conditions for next 5 days (120 hours by default).
    """
    cache_key = f"forecast_{station_id}_{hours}"
    
    # Check cache (longer TTL for forecast - 3 hours)
    if cache_key in cache:
        cached_time = cache[cache_key].get("cached_at")
        if cached_time and datetime.now() - cached_time < timedelta(hours=3):
            return cache[cache_key]["data"]
    
    # Load CDIP mapping
    cdip_mapping_file = Path(__file__).parent.parent / "cdip_station_mapping.json"
    try:
        with open(cdip_mapping_file, 'r') as f:
            cdip_map = json.load(f)
    except FileNotFoundError:
        cdip_map = {}
    
    # Check if this station has CDIP equivalent
    station_info = cdip_map.get(station_id, {})
    cdip_id = station_info.get("cdip_id")
    
    if not cdip_id:
        return {
            "error": f"No CDIP forecast available for station {station_id}",
            "station_id": station_id,
            "cdip_available": False,
            "data": []
        }
    
    # PHASE 2: Try to fetch real CDIP ECMWF model forecast first
    cdip_forecast = await fetch_cdip_ecmwf_forecast(cdip_id, hours)
    
    if cdip_forecast and cdip_forecast.get("data"):
        # Successfully got CDIP ECMWF forecast!
        result = {
            "station_id": station_id,
            "cdip_id": cdip_id,
            "cdip_available": True,
            "forecast_hours": hours,
            "data_points": len(cdip_forecast["data"]),
            "note": "Real CDIP ECMWF model forecast from THREDDS server",
            "source_url": cdip_forecast.get("source_url"),
            "data": cdip_forecast["data"]
        }
        
        # Cache the result
        cache[cache_key] = {
            "cached_at": datetime.now(),
            "data": result
        }
        
        return result
    
    # FALLBACK: If CDIP data unavailable, use trend projection (Phase 1 method)
    try:
        # Fetch current NDBC data to establish baseline
        ndbc_url = f"https://www.ndbc.noaa.gov/data/realtime2/{station_id}.txt"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(ndbc_url)
            response.raise_for_status()
            text = response.text
        
        lines = text.strip().split("\n")
        headers = None
        recent_readings = []
        
        for line in lines[:20]:  # Get recent readings
            if line.startswith("#"):
                if not headers:
                    headers = line.lstrip("#").split()
                continue
            
            if not line.strip():
                continue
            
            parts = line.split()
            if len(parts) < 5:
                continue
            
            try:
                def safe_float(val):
                    try:
                        f = float(val)
                        return None if f in [99.0, 999.0, 9999.0] else f
                    except:
                        return None
                
                data_dict = {}
                for i, header in enumerate(headers):
                    if i < len(parts):
                        data_dict[header] = parts[i]
                
                wvht_m = safe_float(data_dict.get("WVHT"))
                dpd_sec = safe_float(data_dict.get("DPD"))
                
                if wvht_m and dpd_sec:
                    recent_readings.append({"wvht": wvht_m, "period": dpd_sec})
                
                if len(recent_readings) >= 5:
                    break
                    
            except (ValueError, IndexError):
                continue
        
        if not recent_readings:
            return {
                "error": "Insufficient data for forecast",
                "station_id": station_id,
                "data": []
            }
        
        # Calculate simple trend-based forecast (placeholder)
        avg_wvht = sum(r["wvht"] for r in recent_readings) / len(recent_readings)
        avg_period = sum(r["period"] for r in recent_readings) / len(recent_readings)
        
        # Generate forecast points (simplified - will be replaced with CDIP model data)
        forecast_points = []
        now = datetime.utcnow()
        
        for i in range(0, hours, 3):  # Every 3 hours
            forecast_time = now + timedelta(hours=i)
            
            # Simple sine wave variation for demonstration
            # Real implementation will use CDIP ECMWF model data
            variation = 0.1 * math.sin(i / 12.0)
            forecast_wvht = avg_wvht * (1 + variation)
            forecast_period = avg_period * (1 + variation * 0.5)
            
            forecast_point = {
                "timestamp": forecast_time.isoformat() + "Z",
                "wvht_m": round(forecast_wvht, 2),
                "wvht_ft": round(forecast_wvht * 3.28084, 2),
                "dpd_sec": round(forecast_period, 1),
                "surf_height_m": round(0.7 * forecast_wvht * math.sqrt(forecast_period), 2) if forecast_wvht and forecast_period else None,
                "wave_energy": round(forecast_wvht ** 2 * forecast_period, 1) if forecast_wvht and forecast_period else None,
                "source": "trend_projection",  # Will be "CDIP_ECMWF" when real data integrated
                "confidence": "low"  # Placeholder
            }
            
            forecast_points.append(forecast_point)
        
        result = {
            "station_id": station_id,
            "cdip_id": cdip_id,
            "cdip_available": True,
            "forecast_hours": hours,
            "data_points": len(forecast_points),
            "note": "Fallback: Trend projection (CDIP ECMWF data temporarily unavailable)",
            "source": "trend_fallback",
            "data": forecast_points
        }
        
        # Cache the result
        cache[cache_key] = {
            "cached_at": datetime.now(),
            "data": result
        }
        
        return result
        
    except Exception as e:
        return {
            "error": f"Failed to generate forecast: {str(e)}",
            "station_id": station_id,
            "data": []
        }

@app.get("/api/wind-overlay")
async def get_wind_overlay(
    model: str = "gfs",  # gfs, hrrr, nam
    bounds: Optional[str] = None  # Format: "min_lat,min_lon,max_lat,max_lon"
):
    """
    Get wind overlay data for the map.
    Supports multiple forecast models: GFS, HRRR, NAM
    Returns wind vectors for visualization.
    """
    # Default to Pacific Ocean area west of California (ocean only, not land)
    if not bounds:
        # Extended west into Pacific Ocean, covering surfing area
        # West: -130°, East: -117° (stops before land)
        # South: 30°, North: 42° (covers CA coast)
        bounds = "30.0,-130.0,42.0,-117.0"
    
    try:
        min_lat, min_lon, max_lat, max_lon = map(float, bounds.split(','))
    except:
        return {"error": "Invalid bounds format. Use: min_lat,min_lon,max_lat,max_lon"}
    
    cache_key = f"wind_{model}_{bounds}"
    
    # Check cache (10 minute TTL for wind data)
    if cache_key in cache:
        cached_time = cache[cache_key].get("cached_at")
        if cached_time and datetime.now() - cached_time < timedelta(minutes=10):
            return cache[cache_key]["data"]
    
    # NOAA wind data URLs (GRIB2 format)
    model_configs = {
        "gfs": {
            "name": "Global Forecast System",
            "url": "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl",
            "resolution": "0.25 degree (~25km)",
            "update_frequency": "6 hours",
            "forecast_range": "384 hours"
        },
        "hrrr": {
            "name": "High-Resolution Rapid Refresh",
            "url": "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl",
            "resolution": "3 km",
            "update_frequency": "1 hour",
            "forecast_range": "48 hours"
        },
        "nam": {
            "name": "North American Mesoscale",
            "url": "https://nomads.ncep.noaa.gov/cgi-bin/filter_nam.pl",
            "resolution": "12 km",
            "update_frequency": "6 hours",
            "forecast_range": "84 hours"
        }
    }
    
    if model not in model_configs:
        return {"error": f"Invalid model. Choose from: {', '.join(model_configs.keys())}"}
    
    config = model_configs[model]
    
    # For Phase 1, return model info and DENSE GRID of sample data for particle animation
    # Phase 2 will fetch actual GRIB2 data
    
    # Generate a dense grid of wind vectors for particle animation
    # Using 0.5 degree spacing (about 50km) for smooth particle flow
    import math
    vectors = []
    lat_step = 0.5
    lon_step = 0.5
    
    lat = min_lat
    while lat <= max_lat:
        lon = min_lon
        while lon <= max_lon:
            # Generate varying wind patterns for visual effect
            # Base wind from west/northwest (typical for California)
            base_dir = 290 + (lat - 35) * 10  # Varies with latitude
            base_speed = 10 + abs(lat - 35) * 2  # Stronger winds north
            
            # Add some spatial variation for interesting patterns
            dir_variation = math.sin(lat * 0.5) * 20 + math.cos(lon * 0.5) * 15
            speed_variation = abs(math.sin(lat * lon * 0.1)) * 5
            
            direction = (base_dir + dir_variation) % 360
            speed = max(3, base_speed + speed_variation)
            
            # Convert to u/v components (meteorological convention: "from" direction)
            dir_rad = math.radians(direction)
            u_component = -speed * math.sin(dir_rad)
            v_component = -speed * math.cos(dir_rad)
            
            vectors.append({
                "lat": round(lat, 2),
                "lon": round(lon, 2),
                "speed_kts": round(speed, 1),
                "direction_deg": round(direction, 0),
                "u_component": round(u_component, 2),
                "v_component": round(v_component, 2)
            })
            
            lon += lon_step
        lat += lat_step
    
    result = {
        "model": model,
        "model_name": config["name"],
        "resolution": config["resolution"],
        "bounds": {
            "min_lat": min_lat,
            "min_lon": min_lon,
            "max_lat": max_lat,
            "max_lon": max_lon
        },
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "note": f"Phase 1: Dense grid with {len(vectors)} sample vectors for particle animation. Phase 2: Fetch actual GRIB2 wind data",
        "vectors": vectors
    }
    
    # Cache the result
    cache[cache_key] = {
        "cached_at": datetime.now(),
        "data": result
    }
    
    return result

@app.get("/api/swell-overlay")
async def get_swell_overlay(
    model: str = "ww3",  # wavewatch3
    bounds: Optional[str] = None
):
    """
    Get swell/wave overlay data for the map.
    Uses NOAA WaveWatch III model for global wave forecasts.
    """
    # Default to Pacific Ocean area west of California (ocean only, not land)
    if not bounds:
        # Extended west into Pacific Ocean, covering surfing area
        bounds = "30.0,-130.0,42.0,-117.0"
    
    try:
        min_lat, min_lon, max_lat, max_lon = map(float, bounds.split(','))
    except:
        return {"error": "Invalid bounds format"}
    
    cache_key = f"swell_{model}_{bounds}"
    
    # Check cache (30 minute TTL for swell data)
    if cache_key in cache:
        cached_time = cache[cache_key].get("cached_at")
        if cached_time and datetime.now() - cached_time < timedelta(minutes=30):
            return cache[cache_key]["data"]
    
    # NOAA WaveWatch III configuration
    ww3_config = {
        "name": "WaveWatch III",
        "url": "https://polar.ncep.noaa.gov/waves/",
        "resolution": "0.5 degree (~50km)",
        "update_frequency": "6 hours",
        "forecast_range": "180 hours"
    }
    
    # Phase 1: Return model info and DENSE GRID of sample data for particle animation
    
    # Generate a dense grid of wave/swell data for particle animation
    # Using 0.5 degree spacing (about 50km) for smooth particle flow
    import math
    wave_data = []
    lat_step = 0.5
    lon_step = 0.5
    
    lat = min_lat
    while lat <= max_lat:
        lon = min_lon
        while lon <= max_lon:
            # Generate varying swell patterns
            # Pacific swells typically come from W/NW (270-315 degrees)
            base_dir = 285 + (lat - 35) * 5  # Varies slightly with latitude
            base_height = 1.5 + abs(lat - 35) * 0.3  # Larger swells to the north
            base_period = 12 + abs(lat - 34) * 0.5  # Longer periods to the north
            
            # Add spatial variation for interesting patterns
            dir_variation = math.sin(lat * 0.3) * 15 + math.cos(lon * 0.4) * 10
            height_variation = abs(math.sin(lat * lon * 0.05)) * 0.8
            period_variation = abs(math.cos(lat + lon)) * 2
            
            direction = (base_dir + dir_variation) % 360
            height_m = max(0.5, base_height + height_variation)
            height_ft = height_m * 3.28084
            period = max(6, base_period + period_variation)
            
            # Calculate wave energy (simplified)
            energy = round(height_m ** 2 * period, 1)
            
            wave_data.append({
                "lat": round(lat, 2),
                "lon": round(lon, 2),
                "wave_height_m": round(height_m, 2),
                "wave_height_ft": round(height_ft, 1),
                "period_sec": round(period, 1),
                "direction_deg": round(direction, 0),
                "energy": energy
            })
            
            lon += lon_step
        lat += lat_step
    
    result = {
        "model": model,
        "model_name": ww3_config["name"],
        "resolution": ww3_config["resolution"],
        "bounds": {
            "min_lat": min_lat,
            "min_lon": min_lon,
            "max_lat": max_lat,
            "max_lon": max_lon
        },
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "note": f"Phase 1: Dense grid with {len(wave_data)} sample wave points for particle animation. Phase 2: Fetch actual WW3 wave data",
        "wave_data": wave_data
    }
    
    # Cache the result
    cache[cache_key] = {
        "cached_at": datetime.now(),
        "data": result
    }
    
    return result

@app.get("/api/overlays/models")
async def get_available_models():
    """
    Get list of available wind and swell forecast models.
    """
    return {
        "wind_models": [
            {
                "id": "gfs",
                "name": "GFS - Global Forecast System",
                "provider": "NOAA",
                "resolution": "25 km",
                "coverage": "Global",
                "update": "Every 6 hours",
                "forecast": "16 days"
            },
            {
                "id": "hrrr",
                "name": "HRRR - High-Res Rapid Refresh",
                "provider": "NOAA",
                "resolution": "3 km",
                "coverage": "Continental US",
                "update": "Every hour",
                "forecast": "48 hours"
            },
            {
                "id": "nam",
                "name": "NAM - North American Mesoscale",
                "provider": "NOAA",
                "resolution": "12 km",
                "coverage": "North America",
                "update": "Every 6 hours",
                "forecast": "84 hours"
            }
        ],
        "swell_models": [
            {
                "id": "ww3",
                "name": "WaveWatch III",
                "provider": "NOAA",
                "resolution": "50 km",
                "coverage": "Global",
                "update": "Every 6 hours",
                "forecast": "180 hours (7.5 days)"
            }
        ]
    }