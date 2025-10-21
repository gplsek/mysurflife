from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Optional

app = FastAPI()

# Simple in-memory cache
cache: Dict[str, Dict] = {}
CACHE_DURATION = timedelta(minutes=5)  # NDBC updates every ~10 min, cache for 5

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BUOY_LIST = [
    {"id": "46266", "lat": 32.933, "lon": -117.317, "name": "Del Mar Nearshore"},
    {"id": "46225", "lat": 32.866, "lon": -117.283, "name": "Torrey Pines Outer"},
    {"id": "46259", "lat": 32.749, "lon": -117.258, "name": "Mission Bay"},
    {"id": "46232", "lat": 32.65,  "lon": -117.3,   "name": "Point Loma South"},
    {"id": "46236", "lat": 32.55,  "lon": -117.15,  "name": "Imperial Beach"},
    {"id": "46258", "lat": 33.475, "lon": -118.533, "name": "San Pedro Channel"},
    {"id": "46222", "lat": 33.75,  "lon": -118.833, "name": "Santa Monica Basin"},
    {"id": "46086", "lat": 34.25,  "lon": -120.45,  "name": "Pt. Dume / Santa Barbara"},
    {"id": "46011", "lat": 34.935, "lon": -121.93,  "name": "Santa Maria"},
    {"id": "46027", "lat": 40.75,  "lon": -124.5,   "name": "Cape Mendocino"},
    {"id": "46014", "lat": 39.22,  "lon": -123.97,  "name": "Pt. Arena"},
    {"id": "46026", "lat": 37.75,  "lon": -122.83,  "name": "San Francisco Bar"},
    {"id": "46012", "lat": 36.75,  "lon": -122.43,  "name": "Monterey Bay"},
    {"id": "46013", "lat": 38.24,  "lon": -123.31,  "name": "Bodega Bay"}
]

async def fetch_buoy_data(buoy_id: str, use_cache: bool = True) -> Dict:
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

            # Format timestamp in ISO format (UTC) for easy frontend parsing
            timestamp_utc = f"{year}-{month.zfill(2)}-{day.zfill(2)}T{hour.zfill(2)}:{minute.zfill(2)}:00Z"

            result = {
                "station": buoy_id,
                "timestamp_utc": timestamp_utc,
                "wave_height_m": wave_height_m,
                "dominant_period_sec": parsed.get("DPD", "N/A"),
                "mean_wave_dir": parsed.get("MWD", "N/A"),
                "water_temp_c": water_temp_c,
                "air_temp_c": air_temp_c,
            }
            
            # Cache the successful result
            cache[buoy_id] = {
                "data": result,
                "cached_at": datetime.now()
            }
            
            return result

        error_result = {"station": buoy_id, "error": "No valid data rows found"}
        return error_result
        
    except httpx.TimeoutException:
        return {"station": buoy_id, "error": "Request timeout"}
    except httpx.HTTPStatusError as e:
        return {"station": buoy_id, "error": f"HTTP {e.response.status_code}"}
    except Exception as e:
        return {"station": buoy_id, "error": str(e)}

@app.get("/api/buoy-status")
async def get_primary_buoy():
    """Get data for the primary buoy (Del Mar Nearshore)."""
    return await fetch_buoy_data("46266")

@app.get("/api/buoy-status/all")
async def get_all_buoys():
    """Get data for all buoys concurrently with caching."""
    # Fetch all buoys concurrently instead of sequentially
    tasks = [fetch_buoy_data(buoy["id"]) for buoy in BUOY_LIST]
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