from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Optional

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
            "dominant_period_sec": parsed.get("DPD", "N/A"),
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