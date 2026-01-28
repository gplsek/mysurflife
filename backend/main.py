from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import json
import math
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Optional, List, Tuple, Any
from functools import lru_cache
from netCDF4 import Dataset
import numpy as np
import tempfile
import os
import time  # For performance timing

app = FastAPI()

# Simple in-memory cache (L1 - per worker, short TTL)
cache: Dict[str, Dict] = {}
CACHE_DURATION = timedelta(minutes=5)  # NDBC updates every ~10 min, cache for 5

# L2 Redis cache (shared across workers, longer TTL)
# Optional - will gracefully degrade if Redis not available
_redis_client = None
try:
    import redis
    redis_host = os.getenv('REDIS_HOST', 'localhost')
    redis_port = int(os.getenv('REDIS_PORT', 6379))
    redis_password = os.getenv('REDIS_PASSWORD', None)
    redis_db = int(os.getenv('REDIS_DB', 0))

    _redis_client = redis.Redis(
        host=redis_host,
        port=redis_port,
        password=redis_password if redis_password else None,
        db=redis_db,
        decode_responses=False
    )
    _redis_client.ping()
    print(f"✅ Redis connected: {redis_host}:{redis_port} (L2 cache enabled)")
except Exception as e:
    print(f"⚠️  Redis not available: {e} (L2 cache disabled)")
    _redis_client = None

# Supabase database connection (optional)
# Import after environment variables are loaded
try:
    from database import supabase
    if supabase:
        print("✅ Supabase database ready")
except ImportError:
    print("⚠️  Supabase not configured (database.py not imported)")
    supabase = None
except Exception as e:
    print(f"⚠️  Supabase initialization failed: {e}")
    supabase = None

# Authentication middleware
try:
    from auth import require_admin, optional_auth, is_admin
    print("✅ Authentication middleware loaded")
except ImportError as e:
    print(f"⚠️  Authentication not configured: {e}")
    require_admin = None
    optional_auth = None
    is_admin = None

# Buoy registry (loads from database with fallback to hardcoded list)
try:
    from buoy_registry import get_all_buoys, get_buoy_by_id
except ImportError as e:
    print(f"⚠️  Failed to import buoy_registry: {e}")
    get_all_buoys = None
    get_buoy_by_id = None

# Disk cache directory for raw responses (optional)
DISK_CACHE_DIR = Path(__file__).parent / "cache" / "ww3"
DISK_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Shared HTTP client for connection pooling
_http_client: Optional[httpx.AsyncClient] = None

# Semaphores for concurrency control
NDBC_SEM = asyncio.Semaphore(12)  # Limit concurrent NDBC requests (increased for 35 buoys)
WIND_SEM = asyncio.Semaphore(2)  # Limit concurrent wind overlay processing

# Dataset cache for xarray (Task C)
_dataset_cache: Dict[str, Dict] = {}

# In-flight request deduplication (Task D)
_in_flight_requests: Dict[str, asyncio.Task] = {}

# WW3 Grid Registry (loaded from JSON)
_ww3_registry: Optional[Dict] = None

def _load_ww3_registry() -> Dict:
    """Load WW3 grid registry from JSON file."""
    global _ww3_registry
    if _ww3_registry is None:
        registry_path = Path(__file__).parent / "ww3_grid_registry.json"
        try:
            with open(registry_path, 'r') as f:
                _ww3_registry = json.load(f)
            print(f"✅ Loaded WW3 grid registry: {len(_ww3_registry.get('domains', []))} domains")
        except Exception as e:
            print(f"⚠️  Failed to load WW3 registry: {e}, using defaults")
            _ww3_registry = {"domains": []}
    return _ww3_registry

def _select_ww3_domain(bbox: Tuple[float, float, float, float], zoom: Optional[int] = None, source: str = "global") -> Dict:
    """
    Select the best WW3 domain based on bbox, zoom, and source preference.
    
    Args:
        bbox: (min_lat, min_lon, max_lat, max_lon)
        zoom: Map zoom level (optional, for zoom-based selection)
        source: Source preference ("global", "regional", "nearshore")
    
    Returns:
        Domain configuration dict with 'domain', 'id', 'resolution', etc.
    """
    registry = _load_ww3_registry()
    domains = registry.get("domains", [])
    
    if not domains:
        # Fallback to default
        return {
            "id": "global_0p16",
            "domain": "global",
            "resolution": {"lat_step": 0.16, "lon_step": 0.16}
        }
    
    min_lat, min_lon, max_lat, max_lon = bbox
    center_lat = (min_lat + max_lat) / 2
    center_lon = (min_lon + max_lon) / 2
    
    # Filter domains by status (exclude "planned" unless explicitly requested)
    available_domains = [d for d in domains if d.get("status") != "planned" or source == "nearshore"]
    
    # Strategy 1: Zoom-based selection (if zoom provided)
    if zoom is not None:
        zoom_rules = registry.get("zoom_selection", {})
        if zoom <= 6:
            recommended_id = zoom_rules.get("0-6", {}).get("recommended", "global_0p16")
        elif zoom <= 9:
            recommended_id = zoom_rules.get("7-9", {}).get("recommended", "epacif_0p16")
        else:
            recommended_id = zoom_rules.get("10+", {}).get("recommended", "epacif_0p16")
        
        # Find domain by ID
        for domain in available_domains:
            if domain["id"] == recommended_id:
                return domain
    
    # Strategy 2: Bbox-based selection (check which domain bounds contain the bbox)
    best_domain = None
    best_score = 0
    
    for domain in available_domains:
        bounds = domain.get("bounds", {})
        d_min_lat = bounds.get("min_lat", -90)
        d_max_lat = bounds.get("max_lat", 90)
        d_min_lon = bounds.get("min_lon", -180)
        d_max_lon = bounds.get("max_lon", 180)
        
        # Check if bbox fits within domain bounds
        # Use >= and <= for inclusive bounds check
        bbox_fits = (min_lat >= d_min_lat and max_lat <= d_max_lat and
                     min_lon >= d_min_lon and max_lon <= d_max_lon)
        
        if bbox_fits:
            # Calculate coverage score (how well the domain covers the bbox)
            domain_area = (d_max_lat - d_min_lat) * (d_max_lon - d_min_lon)
            bbox_area = (max_lat - min_lat) * (max_lon - min_lon)
            score = bbox_area / domain_area if domain_area > 0 else 0  # Higher score = better fit (less wasted coverage)
            
            if score > best_score:
                best_score = score
                best_domain = domain
    
    if best_domain:
        return best_domain
    
    # Strategy 3: Source preference matching
    if source == "regional":
        # Prefer regional domains (epacif, atlocn) over global
        # But only if the bbox fully fits within the domain bounds
        for domain in available_domains:
            if domain["domain"] in ["epacif", "atlocn"]:
                # Check if bbox fully fits within domain bounds (not just overlaps)
                bounds = domain.get("bounds", {})
                d_min_lat = bounds.get("min_lat", -90)
                d_max_lat = bounds.get("max_lat", 90)
                d_min_lon = bounds.get("min_lon", -180)
                d_max_lon = bounds.get("max_lon", 180)
                
                # Only use regional domain if bbox fully fits
                if (min_lat >= d_min_lat and max_lat <= d_max_lat and
                    min_lon >= d_min_lon and max_lon <= d_max_lon):
                    return domain
    
    # Strategy 4: Fallback to global
    for domain in available_domains:
        if domain["domain"] == "global":
            return domain
    
    # Final fallback
    return available_domains[0] if available_domains else {
        "id": "global_0p16",
        "domain": "global",
        "resolution": {"lat_step": 0.16, "lon_step": 0.16}
    }

# JSON-safe sanitizer to eliminate NaN/Inf from responses
def json_sanitize(obj: Any) -> Any:
    """Recursively replace NaN/Inf with None so JSON serialization never fails."""
    if obj is None:
        return None
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (int, str, bool)):
        return obj
    if isinstance(obj, (np.integer, np.floating)):
        # Convert numpy types to Python native types
        try:
            val = float(obj) if isinstance(obj, np.floating) else int(obj)
            if math.isnan(val) or math.isinf(val):
                return None
            return val
        except (ValueError, OverflowError):
            return None
    if isinstance(obj, dict):
        return {k: json_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_sanitize(v) for v in obj]
    # fallback: try stringifying unknown objects (but preserve datetime, etc.)
    if isinstance(obj, datetime):
        return obj.isoformat() + "Z" if obj.tzinfo is None else obj.isoformat()
    return str(obj)

def calculate_surf_height(wave_height_m: float, dpd_sec: float) -> float:
    """
    Calculate theoretical surf face height from offshore wave parameters.

    Uses a period-based multiplier (linear, clamped) instead of √period
    to avoid unrealistic values for long-period swells.

    Formula: surf_height = WVHT × multiplier
    Where multiplier = max(1.0, min(2.2, 0.6 + 0.08 × DPD))

    Multiplier examples:
    - 10s period: 1.4x (0.6 + 0.08*10)
    - 15s period: 1.8x (0.6 + 0.08*15)
    - 20s+ period: 2.2x (capped)

    This is a heuristic for "generic beach" conditions without bathymetry/shadowing.
    For spot-specific accuracy, use per-spot calibration coefficients.

    Args:
        wave_height_m: Significant wave height in meters (WVHT)
        dpd_sec: Dominant period in seconds (DPD)

    Returns:
        Theoretical surf face height in meters

    References:
        - Wave energy flux scales with height² and period
        - Linear period multiplier is more physically realistic than √period
        - Capped at 2.2x to prevent over-estimation for very long period swells
    """
    # Period-based multiplier: increases with period, clamped at 2.2x
    mult = max(1.0, min(2.2, 0.6 + 0.08 * dpd_sec))
    return round(wave_height_m * mult, 2)

# LRU cache for timestamp generation (Task A)
@lru_cache(maxsize=64)
def _times_utc_for_run(run_iso: str, hours: Tuple[int, ...]) -> List[str]:
    """Generate UTC timestamps for a run and list of hours. Cached with LRU."""
    # Parse ISO format like "2025-12-12T18:00:00Z"
    run_iso_clean = run_iso.replace('Z', '').replace(' ', 'T')
    try:
        base = datetime.fromisoformat(run_iso_clean)
    except ValueError:
        # Fallback: try parsing with strptime
        base = datetime.strptime(run_iso_clean, "%Y-%m-%dT%H:%M:%S")
    return [(base + timedelta(hours=int(h))).isoformat(timespec="seconds") + "Z" for h in hours]

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

# Startup/shutdown for shared HTTP client
@app.on_event("startup")
async def startup():
    global _http_client
    _http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=5.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=20)
    )

@app.on_event("shutdown")
async def shutdown():
    global _http_client
    if _http_client:
        await _http_client.aclose()
        _http_client = None

# BUOY_LIST now loaded from Supabase database (see buoy_registry.py)
# Fallback list is in buoy_registry.py if database unavailable

async def fetch_wind_from_station(station_id: str) -> Dict:
    """Fetch wind data from a fallback station (NOS CO-OPS)."""
    try:
        url = f"https://www.ndbc.noaa.gov/data/realtime2/{station_id}.txt"
        async with NDBC_SEM:
            response = await _http_client.get(url)
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
            except (ValueError, TypeError):
                wind_dir = None

            try:
                wind_speed_ms = float(parsed.get("WSPD", "0"))
                if wind_speed_ms == 99:
                    wind_speed_ms = None
            except (ValueError, TypeError):
                wind_speed_ms = None

            try:
                wind_gust_ms = float(parsed.get("GST", "0"))
                if wind_gust_ms == 99:
                    wind_gust_ms = None
            except (ValueError, TypeError):
                wind_gust_ms = None

            return {
                "wind_dir": wind_dir,
                "wind_speed_ms": wind_speed_ms,
                "wind_gust_ms": wind_gust_ms,
                "wind_source": station_id
            }

        return {"wind_dir": None, "wind_speed_ms": None, "wind_gust_ms": None, "wind_source": None}
    except (httpx.HTTPError, httpx.RequestError, Exception) as e:
        print(f"⚠️  Error fetching wind from station {station_id}: {e}")
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
        async with NDBC_SEM:
            response = await _http_client.get(url)
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
            except (ValueError, TypeError):
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
        except (ValueError, TypeError):
            wave_height_m = None
        
        # Parse dominant period for calculations
        try:
            dpd_sec = float(parsed.get("DPD", "0"))
            if dpd_sec == 0:
                dpd_sec = None
        except (ValueError, TypeError):
            dpd_sec = None
        
        # Calculate surf face height and wave energy
        surf_height_m = None
        wave_energy = None

        if wave_height_m and dpd_sec:
            # Surf face height: WVHT × period_multiplier (clamped 1.0-2.2x)
            surf_height_m = calculate_surf_height(wave_height_m, dpd_sec)

            # Wave Energy Index: WVHT² × DPD (physically meaningful ranking metric)
            wave_energy = round(wave_height_m ** 2 * dpd_sec, 1)

        # Parse water temperature (in Celsius)
        try:
            water_temp_c = float(parsed.get("WTMP", "0"))
        except (ValueError, TypeError):
            water_temp_c = None

        # Parse air temperature (in Celsius)
        try:
            air_temp_c = float(parsed.get("ATMP", "0"))
        except (ValueError, TypeError):
            air_temp_c = None

        # Parse wind direction (in degrees)
        try:
            wind_dir = float(parsed.get("WDIR", "0"))
            if wind_dir == 999 or wind_dir == 0:  # NDBC uses 999 for missing data
                wind_dir = None
        except (ValueError, TypeError):
            wind_dir = None

        # Parse wind speed (in m/s)
        try:
            wind_speed_ms = float(parsed.get("WSPD", "0"))
            if wind_speed_ms == 99:  # NDBC uses 99 for missing data
                wind_speed_ms = None
        except (ValueError, TypeError):
            wind_speed_ms = None

        # Parse wind gust (in m/s)
        try:
            wind_gust_ms = float(parsed.get("GST", "0"))
            if wind_gust_ms == 99:  # NDBC uses 99 for missing data
                wind_gust_ms = None
        except (ValueError, TypeError):
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


# ============================================================================
# Authentication Endpoints
# ============================================================================

@app.get("/api/auth/check-admin")
async def check_admin_status(user: Optional[Dict] = Depends(optional_auth)):
    """
    Check if the current user has admin privileges.
    Returns: {"is_admin": true/false, "user_id": "...", "email": "..."}
    """
    if not user:
        return {"is_admin": False, "authenticated": False}

    user_id = user.get("user_id")
    email = user.get("email")

    # Check admin status
    admin_status = is_admin(user_id) if is_admin else False

    return {
        "is_admin": admin_status,
        "authenticated": True,
        "user_id": user_id,
        "email": email
    }


# ============================================================================
# AI Personas Management Endpoints
# ============================================================================

@app.get("/api/admin/personas")
async def list_personas(user: Dict = Depends(require_admin) if require_admin else None):
    """
    List all AI personas (admin only).
    Returns all personas with their configurations.
    """
    from database import get_supabase_admin_client
    admin_client = get_supabase_admin_client()

    if not admin_client:
        return {"error": "Database not configured"}

    try:
        result = admin_client.table("ai_personas") \
            .select("*") \
            .order("name") \
            .execute()

        return {
            "success": True,
            "personas": result.data
        }

    except Exception as e:
        print(f"❌ Error listing personas: {e}")
        return {"error": str(e)}


@app.get("/api/admin/personas/{slug}")
async def get_persona(slug: str, user: Dict = Depends(require_admin) if require_admin else None):
    """
    Get a specific persona by slug (admin only).
    """
    from database import get_supabase_admin_client
    admin_client = get_supabase_admin_client()

    if not admin_client:
        return {"error": "Database not configured"}

    try:
        result = admin_client.table("ai_personas") \
            .select("*") \
            .eq("slug", slug) \
            .single() \
            .execute()

        if not result.data:
            return {"error": f"Persona '{slug}' not found"}

        return {
            "success": True,
            "persona": result.data
        }

    except Exception as e:
        print(f"❌ Error fetching persona: {e}")
        return {"error": str(e)}


@app.put("/api/admin/personas/{slug}")
async def update_persona(
    slug: str,
    persona_data: Dict[str, Any],
    user: Dict = Depends(require_admin) if require_admin else None
):
    """
    Update a persona (admin only).
    Allowed fields: name, description, system_prompt, model, max_tokens, temperature, is_active
    """
    from database import get_supabase_admin_client
    admin_client = get_supabase_admin_client()

    if not admin_client:
        return {"error": "Database not configured"}

    # Fields that can be updated
    allowed_fields = ['name', 'description', 'system_prompt', 'model', 'max_tokens', 'temperature', 'is_active']
    update_data = {k: v for k, v in persona_data.items() if k in allowed_fields}

    if not update_data:
        return {"error": "No valid fields to update"}

    # Add updated_at timestamp
    update_data['updated_at'] = datetime.utcnow().isoformat()

    try:
        result = admin_client.table("ai_personas") \
            .update(update_data) \
            .eq("slug", slug) \
            .execute()

        if not result.data:
            return {"error": f"Persona '{slug}' not found"}

        print(f"✅ Persona '{slug}' updated by {user.get('email', 'unknown')}")

        return {
            "success": True,
            "persona": result.data[0]
        }

    except Exception as e:
        print(f"❌ Error updating persona: {e}")
        return {"error": str(e)}


@app.post("/api/admin/personas")
async def create_persona(
    persona_data: Dict[str, Any],
    user: Dict = Depends(require_admin) if require_admin else None
):
    """
    Create a new persona (admin only).
    Required fields: slug, name, description, system_prompt
    """
    from database import get_supabase_admin_client
    admin_client = get_supabase_admin_client()

    if not admin_client:
        return {"error": "Database not configured"}

    required_fields = ['slug', 'name', 'description', 'system_prompt']
    for field in required_fields:
        if field not in persona_data:
            return {"error": f"Missing required field: {field}"}

    try:
        result = admin_client.table("ai_personas") \
            .insert(persona_data) \
            .execute()

        print(f"✅ Persona '{persona_data['slug']}' created by {user.get('email', 'unknown')}")

        return {
            "success": True,
            "persona": result.data[0]
        }

    except Exception as e:
        print(f"❌ Error creating persona: {e}")
        return {"error": str(e)}


# ============================================================================
# Buoy Data Endpoints
# ============================================================================

@app.get("/api/buoy-status")
async def get_primary_buoy():
    """Get data for the primary buoy (Del Mar Nearshore)."""
    primary_buoy = get_buoy_by_id("46266") if get_buoy_by_id else None
    wind_fallback = primary_buoy.get("wind_fallback") if primary_buoy else None
    return await fetch_buoy_data("46266", wind_fallback_station=wind_fallback)

@app.get("/api/buoy-status/all")
async def get_all_buoys_endpoint():
    """Get data for all buoys concurrently with caching and wind fallback."""
    # Load buoy list from database (or fallback to hardcoded list)
    buoy_list = get_all_buoys() if get_all_buoys else []

    # Fetch all buoys concurrently with their wind fallback stations
    # Use return_exceptions=True to prevent one slow request from blocking all others
    tasks = [
        fetch_buoy_data(buoy["id"], wind_fallback_station=buoy.get("wind_fallback"))
        for buoy in buoy_list
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Merge with buoy metadata and handle exceptions
    for i, buoy in enumerate(buoy_list):
        if isinstance(results[i], Exception):
            # Replace exception with error dict
            results[i] = {
                "station": buoy["id"],
                "error": f"Failed to fetch: {str(results[i])}",
                "lat": buoy["lat"],
                "lon": buoy["lon"],
                "name": buoy["name"]
            }
        else:
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
        async with NDBC_SEM:
            response = await _http_client.get(url)
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
                except (ValueError, TypeError):
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
                surf_height_m = calculate_surf_height(wvht_m, dpd_sec)
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
    Fetch wave data (observations + forecast) from CDIP THREDDS server using OPeNDAP.
    Uses the realtime files (e.g., 153p1_rt.nc) which contain recent observations and forecast.
    Returns forecast data or None if unavailable.
    """
    try:
        # CORRECT CDIP URL - realtime directory, not archive!
        # Format: https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/{station_id}_rt.nc
        # Note: cdip_id from mapping already includes 'p1' suffix (e.g., '153p1')
        url = f"https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/{cdip_id}_rt.nc"
        
        print(f"Attempting to fetch CDIP data from: {url}")
        
        try:
            dataset = Dataset(url)
            successful_url = url
        except Exception as e:
            print(f"Failed to open CDIP NetCDF: {e}")
            return None
        
        # CORRECT variable names for CDIP realtime files:
        # - waveTime: Timestamps (Unix epoch)
        # - waveHs: Significant wave height (meters)
        # - waveTp: Peak period (seconds)
        # - waveDp: Peak direction (degrees)
        
        var_names = list(dataset.variables.keys())
        print(f"✅ Opened CDIP file with {len(var_names)} variables")
        
        # Get required variables (using correct CDIP naming)
        if 'waveTime' not in var_names or 'waveHs' not in var_names:
            print(f"❌ Missing required variables. Available: {var_names[:10]}")
            dataset.close()
            return None
        
        time_var = dataset.variables['waveTime']
        hs_var = dataset.variables['waveHs']
        
        # Optional variables
        tp_var = dataset.variables.get('waveTp')
        dp_var = dataset.variables.get('waveDp')
        
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
                    surf_height_m = calculate_surf_height(wvht_m, dpd_sec)
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
        async with NDBC_SEM:
            response = await _http_client.get(ndbc_url)
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
                    except (ValueError, TypeError):
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
                "surf_height_m": calculate_surf_height(forecast_wvht, forecast_period) if forecast_wvht and forecast_period else None,
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

async def fetch_real_noaa_wind(
    model: str,
    bounds: tuple,
    run: Optional[str] = None,
    forecast_hour: int = 0,
) -> Optional[List[Dict]]:
    """Fetch real wind vectors for a bounding box.

    Primary (GFS): NOAA/NCEP NOMADS GRIB2 filter for gfs_0p25 with UGRD/VGRD at 10m.

    Notes:
    - Requires: eccodes + cfgrib + xarray installed on the backend.
    - `run` format: "YYYY-MM-DDTHH:00Z" (UTC). If omitted, probes for latest available run.
    - `forecast_hour`: 0..384 (GFS), typically multiples of 3.
    """
    min_lat, min_lon, max_lat, max_lon = bounds

    # Normalize bbox
    if min_lat > max_lat:
        min_lat, max_lat = max_lat, min_lat
    if min_lon > max_lon:
        min_lon, max_lon = max_lon, min_lon

    # Clamp
    min_lat = max(-90.0, min(90.0, min_lat))
    max_lat = max(-90.0, min(90.0, max_lat))
    min_lon = max(-180.0, min(180.0, min_lon))
    max_lon = max(-180.0, min(180.0, max_lon))

    # Only implement GRIB path for GFS in this MVP
    if model != "gfs":
        print(f"⚠️  GRIB fetch not implemented for {model}; using GFS")
        model = "gfs"

    def _format_dir_param(date_yyyymmdd: str, cycle_hh: str) -> str:
        # NOMADS expects URL-encoded dir like /gfs.YYYYMMDD/HH/atmos
        return f"%2Fgfs.{date_yyyymmdd}%2F{cycle_hh}%2Fatmos"

    def _parse_run(run_str: str) -> Optional[tuple]:
        try:
            r = run_str.replace("Z", "")
            dt = datetime.fromisoformat(r)
            return (dt.strftime("%Y%m%d"), dt.strftime("%H"))
        except Exception:
            return None

    async def _head_ok(url: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.head(url)
                return resp.status_code == 200
        except Exception:
            return False

    async def _resolve_latest_gfs_run() -> tuple:
        # Best-effort probe: try today then yesterday; cycles 18,12,06,00
        now = datetime.utcnow()
        for day_offset in [0, 1]:
            d = (now - timedelta(days=day_offset)).strftime("%Y%m%d")
            for hh in ["18", "12", "06", "00"]:
                file_name = f"gfs.t{hh}z.pgrb2.0p25.f000"
                probe_url = (
                    "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
                    f"?file={file_name}"
                    "&lev_10_m_above_ground=on&var_UGRD=on&var_VGRD=on"
                    "&leftlon=0&rightlon=1&toplat=1&bottomlat=0"
                    f"&dir={_format_dir_param(d, hh)}"
                )
                if await _head_ok(probe_url):
                    print(f"✅ Resolved latest GFS run: {d} {hh}z")
                    return (d, hh)
        fallback_d = now.strftime("%Y%m%d")
        print(f"⚠️  Could not probe latest run; using fallback {fallback_d} 00z")
        return (fallback_d, "00")

    def _bbox_to_nomads_lon(left: float, right: float) -> tuple:
        # Convert [-180,180] to [0,360]
        def to360(lon: float) -> float:
            return lon % 360.0

        l = to360(left)
        r = to360(right)
        # If it crosses dateline, expand to full globe for MVP
        if l > r:
            return (0.0, 360.0)
        return (l, r)

    run_date = None
    run_cycle = None
    if run:
        parsed = _parse_run(run)
        if parsed:
            run_date, run_cycle = parsed

    if not run_date or not run_cycle:
        run_date, run_cycle = await _resolve_latest_gfs_run()

    fh = max(0, int(forecast_hour))
    file_name = f"gfs.t{run_cycle}z.pgrb2.0p25.f{fh:03d}"

    leftlon, rightlon = _bbox_to_nomads_lon(min_lon, max_lon)
    toplat = max_lat
    bottomlat = min_lat

    grib_url = (
        "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
        f"?file={file_name}"
        "&lev_10_m_above_ground=on"
        "&var_UGRD=on&var_VGRD=on"
        f"&leftlon={leftlon}&rightlon={rightlon}"
        f"&toplat={toplat}&bottomlat={bottomlat}"
        f"&dir={_format_dir_param(run_date, run_cycle)}"
    )

    try:
        # Use shared HTTP client with timeout
        if not _http_client:
            print("❌ HTTP client not initialized")
            return None
        
        print(f"🌐 Fetching GRIB from NOMADS: {file_name} (forecast hour {fh})")
        async with NDBC_SEM:  # Limit concurrent requests
            resp = await _http_client.get(grib_url, timeout=30.0)
            resp.raise_for_status()
            content = resp.content

        if len(content) < 1024:
            print("❌ GRIB download too small; likely an error response")
            return None

        print(f"📥 Downloaded {len(content)} bytes, parsing with xarray...")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".grib2") as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            import xarray as xr

            # Open dataset with timeout protection
            ds = xr.open_dataset(
                tmp_path,
                engine="cfgrib",
                backend_kwargs={
                    "indexpath": "",
                    "filter_by_keys": {"typeOfLevel": "heightAboveGround", "level": 10},
                },
            )

            # Locate U/V variables (cfgrib naming can vary)
            u_name = None
            v_name = None
            for cand in ["u10", "ugrd10m", "u"]:
                if cand in ds.data_vars:
                    u_name = cand
                    break
            for cand in ["v10", "vgrd10m", "v"]:
                if cand in ds.data_vars:
                    v_name = cand
                    break

            if not u_name or not v_name:
                # Try infer by GRIB shortName attrs
                for name, da in ds.data_vars.items():
                    sn = (da.attrs.get("GRIB_shortName") or "").lower()
                    if sn in ["10u", "u10"]:
                        u_name = name
                    if sn in ["10v", "v10"]:
                        v_name = name

            if not u_name or not v_name:
                print(f"❌ Could not find U/V vars in GRIB dataset. Vars: {list(ds.data_vars.keys())}")
                return None

            u_da = ds[u_name]
            v_da = ds[v_name]

            lat_name = "latitude" if "latitude" in u_da.coords else ("lat" if "lat" in u_da.coords else None)
            lon_name = "longitude" if "longitude" in u_da.coords else ("lon" if "lon" in u_da.coords else None)
            if not lat_name or not lon_name:
                print("❌ Could not find lat/lon coordinates in GRIB dataset")
                return None

            # Use vectorized operations instead of nested loops
            print(f"🔄 Processing wind vectors (vectorized)...")
            u_values = u_da.values
            v_values = v_da.values
            lats = u_da[lat_name].values
            lons = u_da[lon_name].values

            # Handle reversed latitude order
            if len(lats) >= 2 and lats[0] > lats[-1]:
                u_values = np.flipud(u_values)
                v_values = np.flipud(v_values)
                lats = np.flip(lats)

            # Vectorized calculations
            speed_ms = np.sqrt(u_values ** 2 + v_values ** 2)
            speed_kts = speed_ms * 1.94384
            direction_rad = np.arctan2(v_values, u_values)
            direction_deg = (270 - np.degrees(direction_rad)) % 360

            # Create meshgrid for lat/lon
            lon_grid, lat_grid = np.meshgrid(lons, lats)

            # Convert lon from [0,360] to [-180,180]
            lon_grid = np.where(lon_grid > 180, lon_grid - 360, lon_grid)


            # Filter by bbox FIRST (with margin for GFS 0.25° grid), THEN subsample
            # This prevents subsampling from skipping over the requested region
            margin = 0.5
            bbox_mask = (
                (lat_grid >= (min_lat - margin)) & (lat_grid <= (max_lat + margin)) &
                (lon_grid >= (min_lon - margin)) & (lon_grid <= (max_lon + margin))
            )

            # Filter out NaN values AND points outside bbox
            valid_mask = ~(np.isnan(u_values) | np.isnan(v_values)) & bbox_mask

            total_points = np.sum(valid_mask)
            vectors: List[Dict] = []

            # Subsample if too many points (limit to ~3000 vectors for performance)
            step = 1
            if total_points > 3000:
                step = max(1, int(np.sqrt(total_points / 3000)))
                print(f"📊 Subsampling: {total_points} points -> ~{total_points // (step*step)} vectors (step={step})")
                # Subsample all arrays consistently
                u_values = u_values[::step, ::step]
                v_values = v_values[::step, ::step]
                speed_kts = speed_kts[::step, ::step]
                direction_deg = direction_deg[::step, ::step]
                lat_grid = lat_grid[::step, ::step]
                lon_grid = lon_grid[::step, ::step]
                valid_mask = valid_mask[::step, ::step]

            # Build vectors list (only valid points)
            for i in range(lat_grid.shape[0]):
                for j in range(lat_grid.shape[1]):
                    if valid_mask[i, j]:
                        vectors.append({
                            "lat": round(float(lat_grid[i, j]), 2),
                            "lon": round(float(lon_grid[i, j]), 2),
                            "speed_kts": round(float(speed_kts[i, j]), 1),
                            "direction_deg": round(float(direction_deg[i, j]), 0),
                            "u_component": round(float(u_values[i, j]), 2),
                            "v_component": round(float(v_values[i, j]), 2),
                        })

            print(f"✅ Fetched {len(vectors)} wind vectors via NOMADS GRIB filter ({run_date} {run_cycle}z f{fh:03d})")
            return vectors

        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    except asyncio.TimeoutError:
        print(f"❌ Timeout fetching GRIB data from NOMADS (30s)")
        return None
    except Exception as e:
        print(f"❌ Error fetching/parsing NOMADS GRIB: {e}")
        import traceback
        traceback.print_exc()
        return None

@app.get("/api/wind/frames")
async def get_wind_frames(model: str = "gfs"):
    """
    Get available forecast hours for a wind model using OPeNDAP metadata discovery.
    Returns the latest run and list of available forecast hours.
    Uses OPeNDAP/THREDDS to discover available times in one request (avoids rate limiting).
    """
    # Check cache first (30-60 minute TTL)
    cache_key = f"wind_frames_{model}"
    if cache_key in cache:
        cached_entry = cache[cache_key]
        cached_time = cached_entry.get("cached_at")
        if cached_time and datetime.now() - cached_time < timedelta(minutes=45):
            print(f"📦 Returning cached wind frames for {model}")
            return cached_entry["data"]
    
    # Only GFS is implemented for now
    if model != "gfs":
        return {"error": f"Model {model} not yet supported. Only 'gfs' is available."}
    
    async def _resolve_latest_gfs_run_simple() -> tuple:
        """
        Resolve latest GFS run using simple heuristic (current day, most recent cycle).
        Avoids slow OPeNDAP checks.
        """
        now = datetime.utcnow()
        current_hour = now.hour
        
        # Determine most likely available cycle based on current time
        # GFS runs at 00, 06, 12, 18Z and are available ~4-6 hours later
        # So if it's 02:00 UTC, the 18Z run from yesterday is most likely available
        if current_hour < 6:
            # Early morning: use yesterday's 18Z
            date = (now - timedelta(days=1)).strftime("%Y%m%d")
            cycle = "18"
        elif current_hour < 12:
            # Morning: use today's 00Z or yesterday's 18Z
            date = now.strftime("%Y%m%d")
            cycle = "00"
        elif current_hour < 18:
            # Afternoon: use today's 06Z
            date = now.strftime("%Y%m%d")
            cycle = "06"
        else:
            # Evening: use today's 12Z
            date = now.strftime("%Y%m%d")
            cycle = "12"
        
        print(f"📅 Using GFS run estimate: {date} {cycle}z (based on current time: {now.strftime('%Y-%m-%d %H:%M UTC')})")
        return (date, cycle)
    
    async def _get_forecast_hours_from_opendap(run_date: str, run_cycle: str) -> Optional[List[int]]:
        """
        Use OPeNDAP to discover available forecast hours from the time dimension.
        Uses a timeout (10 seconds) and fails fast if too slow.
        """
        opendap_url = f"https://nomads.ncep.noaa.gov/dods/gfs_0p25/gfs{run_date}/gfs_0p25_{run_cycle}z"
        try:
            import xarray as xr
            import numpy as np
            import asyncio
            from concurrent.futures import ThreadPoolExecutor
            
            print(f"🔍 Opening OPeNDAP dataset (10s timeout): {opendap_url}")
            
            # Use a thread pool with timeout to avoid hanging
            def open_dataset_and_read_times():
                try:
                    # Open dataset with large chunks to minimize requests
                    ds = xr.open_dataset(opendap_url, chunks={'time': 1000})
                    
                    if 'time' not in ds.dims:
                        ds.close()
                        return None
                    
                    # Get time coordinate - read values (this triggers actual data fetch)
                    time_coord = ds['time']
                    time_values = time_coord.values
                    
                    # Calculate run base time
                    run_dt = datetime.strptime(f"{run_date}{run_cycle}", "%Y%m%d%H")
                    run_base = run_dt.replace(tzinfo=None)
                    
                    # Convert time values to forecast hours
                    forecast_hours = []
                    for tv in time_values:
                        forecast_time = None
                        
                        if isinstance(tv, np.datetime64):
                            forecast_time = tv.astype('datetime64[s]').astype(datetime)
                        elif isinstance(tv, datetime):
                            forecast_time = tv.replace(tzinfo=None) if tv.tzinfo else tv
                        else:
                            try:
                                if hasattr(tv, 'to_pydatetime'):
                                    forecast_time = tv.to_pydatetime().replace(tzinfo=None)
                                elif hasattr(tv, 'timestamp'):
                                    forecast_time = datetime.fromtimestamp(tv.timestamp())
                            except Exception:
                                continue
                        
                        if forecast_time is None:
                            continue
                        
                        delta = forecast_time - run_base
                        hours = int(delta.total_seconds() / 3600)
                        
                        if 0 <= hours <= 384:
                            forecast_hours.append(hours)
                    
                    ds.close()
                    return sorted(set(forecast_hours))
                    
                except Exception as e:
                    raise Exception(f"OPeNDAP error: {e}")
            
            # Run in thread pool with 5 second timeout (fail very fast)
            loop = asyncio.get_event_loop()
            with ThreadPoolExecutor(max_workers=1) as executor:
                try:
                    forecast_hours = await asyncio.wait_for(
                        loop.run_in_executor(executor, open_dataset_and_read_times),
                        timeout=5.0
                    )
                    if forecast_hours:
                        print(f"✅ Discovered {len(forecast_hours)} forecast hours via OPeNDAP: {forecast_hours[:5]}...{forecast_hours[-5:]}")
                    return forecast_hours
                except asyncio.TimeoutError:
                    print(f"⏱️  OPeNDAP timeout (5s) - will use fallback")
                    return None
                except Exception as e:
                    print(f"❌ OPeNDAP error: {e}")
                    return None
            
        except Exception as e:
            print(f"❌ Error with OPeNDAP: {e}")
            return None
    
    def _get_fallback_hours() -> List[int]:
        """
        Fallback: Return standard GFS cadence assumption.
        Hourly 0-120, then 3-hourly 123-384.
        """
        hours = list(range(0, 121)) + list(range(123, 385, 3))
        print(f"⚠️  Using fallback cadence assumption: {len(hours)} hours")
        return hours
    
    # Resolve latest run using simple heuristic (fast, no OPeNDAP)
    run_date, run_cycle = await _resolve_latest_gfs_run_simple()
    
    # Skip OPeNDAP discovery for now - it's too slow and unreliable
    # Just use the standard GFS cadence assumption
    # TODO: Re-enable OPeNDAP discovery with better optimization if needed
    print(f"📋 Using standard GFS cadence assumption (hourly 0-120, 3-hourly 123-384)")
    available_hours = _get_fallback_hours()
    
    # Optional: Try OPeNDAP in background for future use, but don't wait
    # (commented out for now due to performance issues)
    # try:
    #     available_hours = await asyncio.wait_for(
    #         _get_forecast_hours_from_opendap(run_date, run_cycle),
    #         timeout=3.0
    #     )
    # except (asyncio.TimeoutError, Exception):
    #     pass
    
    if not available_hours:
        return {
            "error": f"Could not determine forecast hours for run {run_date} {run_cycle}z. The run may not be available yet.",
            "model": model,
            "run_date": run_date,
            "run_cycle": run_cycle,
            "suggestion": "GFS runs are typically published ~4-6 hours after the run time."
        }
    
    # Format run timestamp
    run_dt = datetime.strptime(f"{run_date}{run_cycle}", "%Y%m%d%H")
    run_iso = run_dt.strftime("%Y-%m-%dT%H:00:00Z")
    
    # Compute timestamps using LRU cache (Task A)
    hours_tuple = tuple(int(h) for h in available_hours)
    times_utc = _times_utc_for_run(run_iso, hours_tuple)
    
    # Determine cadence note
    if len(available_hours) > 120 and available_hours[120] <= 120:
        cadence_note = "hourly near-term, coarser farther out"
    elif all(h % 3 == 0 for h in available_hours):
        cadence_note = "3-hourly intervals"
    elif any(h % 1 == 0 and h <= 120 for h in available_hours[:121]):
        cadence_note = "hourly near-term, coarser farther out"
    else:
        cadence_note = "variable cadence"
    
    result = {
        "model": model,
        "run": run_iso,
        "date": run_date,
        "cycle": run_cycle,
        "hours": available_hours,
        "times_utc": times_utc,
        "cadence_note": cadence_note
    }
    
    # Cache the result
    cache[cache_key] = {
        "data": result,
        "cached_at": datetime.now()
    }
    
    print(f"✅ Returning {len(available_hours)} forecast hours for {run_date} {run_cycle}z")
    
    return result

@app.get("/api/wind-overlay")
async def get_wind_overlay(
    model: str = "gfs",  # gfs, hrrr, nam
    bounds: Optional[str] = None,  # Format: "min_lat,min_lon,max_lat,max_lon"
    real_data: bool = True,  # Toggle real vs sample data
    run: Optional[str] = None,  # Optional: "YYYY-MM-DDTHH:00Z"
    forecast_hour: int = 0  # e.g., 0, 3, 6 ...
):
    """
    Get wind overlay data for the map.
    Supports multiple forecast models: GFS, HRRR, NAM
    Returns wind vectors for visualization.
    
    MVP: Fetches real NOAA GFS data via OPeNDAP
    """
    # Default to global
    if not bounds:
        bounds = "-90.0,-180.0,90.0,180.0"
    
    try:
        min_lat, min_lon, max_lat, max_lon = _parse_and_validate_bounds(bounds)
    except ValueError as e:
        return {"error": str(e)}
    
    cache_key = f"wind_{model}_{bounds}_{real_data}_{run}_{forecast_hour}"
    
    # Check cache (10 minute TTL for wind data)
    if cache_key in cache:
        cached_time = cache[cache_key].get("cached_at")
        if cached_time and datetime.now() - cached_time < timedelta(minutes=10):
            print(f"📦 Returning cached wind data for {model}")
            return cache[cache_key]["data"]
    
    # Task D: Deduplicate in-flight requests
    if cache_key in _in_flight_requests:
        # Wait for the existing request to complete
        try:
            return await _in_flight_requests[cache_key]
        except Exception as e:
            # If the in-flight request failed, continue to make a new one
            del _in_flight_requests[cache_key]
    
    # Create the fetch task
    async def _fetch_wind_data():
        async with WIND_SEM:  # Limit concurrent wind overlay processing
            return await _do_fetch_wind_overlay(model, bounds, real_data, run, forecast_hour, min_lat, min_lon, max_lat, max_lon, cache_key)
    
    task = asyncio.create_task(_fetch_wind_data())
    _in_flight_requests[cache_key] = task
    
    try:
        result = await task
        return result
    finally:
        # Clean up in-flight request tracking
        if cache_key in _in_flight_requests:
            del _in_flight_requests[cache_key]

async def _do_fetch_wind_overlay(
    model: str,
    bounds: str,
    real_data: bool,
    run: Optional[str],
    forecast_hour: int,
    min_lat: float,
    min_lon: float,
    max_lat: float,
    max_lon: float,
    cache_key: str
) -> Dict:
    """Internal function to fetch wind overlay data (extracted for deduplication)."""
    
    # Model configurations
    model_configs = {
        "gfs": {
            "name": "Global Forecast System",
            "resolution": "0.25 degree (~25km)",
            "update_frequency": "6 hours",
            "forecast_range": "384 hours",
            "source": "NOAA NCEP"
        },
        "hrrr": {
            "name": "High-Resolution Rapid Refresh",
            "resolution": "3 km",
            "update_frequency": "1 hour",
            "forecast_range": "48 hours",
            "source": "NOAA NCEP"
        },
        "nam": {
            "name": "North American Mesoscale",
            "resolution": "12 km",
            "update_frequency": "6 hours",
            "forecast_range": "84 hours",
            "source": "NOAA NCEP"
        }
    }
    
    if model not in model_configs:
        return {"error": f"Invalid model. Choose from: {', '.join(model_configs.keys())}"}
    
    config = model_configs[model]
    
    # Try to fetch real NOAA data
    vectors = None
    if real_data:
        vectors = await fetch_real_noaa_wind(
            model,
            (min_lat, min_lon, max_lat, max_lon),
            run=run,
            forecast_hour=forecast_hour,
        )
    
    # Fallback to sample data if real data fetch fails
    if vectors is None:
        print(f"⚠️  Generating sample wind data for {model}")
        vectors = []
        # Denser grid for smooth coverage
        lat_step = 0.3
        lon_step = 0.3
        
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
        "source": "NOAA NCEP" if real_data and vectors else "Sample Data",
        "data_type": "real" if real_data and len([v for v in vectors if 'u_component' in v]) else "sample",
        "bounds": {
            "min_lat": min_lat,
            "min_lon": min_lon,
            "max_lat": max_lat,
            "max_lon": max_lon
        },
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "note": f"MVP: {'Real NOAA data via NOMADS GRIB filter' if real_data else 'Sample data'} - {len(vectors)} wind vectors",
        "vectors": vectors
    }
    
    # Cache the result
    cache[cache_key] = {
        "cached_at": datetime.now(),
        "data": result
    }
    
    return result

def _parse_and_validate_bounds(bounds: str) -> Tuple[float, float, float, float]:
    """
    Parse and validate bounding box string.
    
    Args:
        bounds: Comma-separated string "min_lat,min_lon,max_lat,max_lon"
    
    Returns:
        Tuple of (min_lat, min_lon, max_lat, max_lon)
    
    Raises:
        ValueError: If bounds format is invalid or values are out of range
    """
    try:
        parts = bounds.split(',')
        if len(parts) != 4:
            raise ValueError("Expected 4 comma-separated values: min_lat,min_lon,max_lat,max_lon")
        
        min_lat, min_lon, max_lat, max_lon = map(float, parts)
        
        # Validate ranges
        if not (-90 <= min_lat <= 90) or not (-90 <= max_lat <= 90):
            raise ValueError("Latitude must be between -90 and 90 degrees")
        if not (-180 <= min_lon <= 180) or not (-180 <= max_lon <= 180):
            raise ValueError("Longitude must be between -180 and 180 degrees")
        
        # Validate min < max
        if min_lat >= max_lat:
            raise ValueError(f"min_lat ({min_lat}) must be less than max_lat ({max_lat})")
        if min_lon >= max_lon:
            raise ValueError(f"min_lon ({min_lon}) must be less than max_lon ({max_lon})")
        
        return (min_lat, min_lon, max_lat, max_lon)
    except ValueError as e:
        # Re-raise ValueError with clear message
        raise ValueError(f"Invalid bounds format: {e}")
    except (TypeError, AttributeError) as e:
        raise ValueError(f"Invalid bounds format: expected comma-separated numbers, got {type(bounds).__name__}")

def _round_bbox(min_lat: float, min_lon: float, max_lat: float, max_lon: float, grid_size: float = 0.5) -> Tuple[float, float, float, float]:
    """
    Round bbox to grid_size (e.g., 0.5°) so many users share the same cached tile.
    This dramatically improves cache hit rates.
    """
    def round_down(val: float, step: float) -> float:
        return math.floor(val / step) * step
    
    def round_up(val: float, step: float) -> float:
        return math.ceil(val / step) * step
    
    return (
        round_down(min_lat, grid_size),
        round_down(min_lon, grid_size),
        round_up(max_lat, grid_size),
        round_up(max_lon, grid_size)
    )

async def _get_ww3_cache_key(run_date: str, run_cycle: str, forecast_hour: int, rounded_bbox: str, domain_id: str = "global_0p16") -> str:
    """Generate cache key for WW3 data (includes domain ID to prevent cache collisions)."""
    return f"ww3_{domain_id}_{run_date}_{run_cycle}_f{forecast_hour:03d}_{rounded_bbox}"

async def _get_ww3_from_cache(cache_key: str) -> Optional[List[Dict]]:
    """Multi-level cache lookup: L1 (memory) -> L2 (Redis) -> L3 (disk)."""
    # L1: In-memory cache (per worker, short TTL)
    if cache_key in cache:
        cached_entry = cache[cache_key]
        cached_time = cached_entry.get("cached_at")
        if cached_time and datetime.now() - cached_time < timedelta(minutes=10):
            print(f"📦 L1 cache hit: {cache_key}")
            return cached_entry.get("data")
    
    # L2: Redis cache (shared, longer TTL)
    if _redis_client:
        try:
            redis_key = f"ww3:{cache_key}"
            cached_data = _redis_client.get(redis_key)
            if cached_data:
                import pickle
                vectors = pickle.loads(cached_data)
                print(f"📦 L2 cache hit (Redis): {cache_key}")
                # Also populate L1 cache
                cache[cache_key] = {"cached_at": datetime.now(), "data": vectors}
                return vectors
        except Exception as e:
            print(f"⚠️  Redis cache error: {e}")
    
    # L3: Disk cache (optional, for raw responses)
    disk_cache_file = DISK_CACHE_DIR / f"{cache_key}.pkl"
    if disk_cache_file.exists():
        try:
            import pickle
            with open(disk_cache_file, 'rb') as f:
                cached_entry = pickle.load(f)
            cached_time = cached_entry.get("cached_at")
            if cached_time and datetime.now() - cached_time < timedelta(hours=1):
                vectors = cached_entry.get("data")
                print(f"📦 L3 cache hit (disk): {cache_key}")
                # Populate L1 and L2
                cache[cache_key] = {"cached_at": datetime.now(), "data": vectors}
                if _redis_client:
                    try:
                        _redis_client.setex(f"ww3:{cache_key}", 3600, pickle.dumps(vectors))
                    except Exception:
                        pass
                return vectors
        except Exception as e:
            print(f"⚠️  Disk cache error: {e}")
    
    return None

async def _set_ww3_cache(cache_key: str, vectors: List[Dict], ttl_l1: int = 600, ttl_l2: int = 3600):
    """Store in all cache levels."""
    # L1: In-memory
    cache[cache_key] = {"cached_at": datetime.now(), "data": vectors}
    
    # L2: Redis
    if _redis_client:
        try:
            import pickle
            _redis_client.setex(f"ww3:{cache_key}", ttl_l2, pickle.dumps(vectors))
        except Exception as e:
            print(f"⚠️  Redis cache write error: {e}")
    
    # L3: Disk (optional)
    try:
        import pickle
        disk_cache_file = DISK_CACHE_DIR / f"{cache_key}.pkl"
        with open(disk_cache_file, 'wb') as f:
            pickle.dump({"cached_at": datetime.now(), "data": vectors}, f)
    except Exception as e:
        print(f"⚠️  Disk cache write error: {e}")

async def fetch_real_noaa_ww3_opendap(
    model: str,
    bounds: tuple,
    run: Optional[str] = None,
    forecast_hour: int = 0,
    source: str = "global",
) -> Optional[List[Dict]]:
    """Fetch real WW3 wave vectors for a bounding box using OPeNDAP.
    
    Uses NOAA/NCEP NOMADS OPeNDAP for WW3 with HTSGW (significant wave height) and WVDIR (mean wave direction).
    
    Notes:
    - Requires: xarray installed on the backend.
    - `run` format: "YYYY-MM-DDTHH:00Z" (UTC). If omitted, uses latest available run.
    - `forecast_hour`: 0..180 (WW3), typically multiples of 3.
    - Uses multi-level caching: L1 (memory), L2 (Redis), L3 (disk).
    - Bbox is rounded to 0.5° grid for better cache sharing.
    """
    min_lat, min_lon, max_lat, max_lon = bounds

    # Normalize bbox
    if min_lat > max_lat:
        min_lat, max_lat = max_lat, min_lat
    if min_lon > max_lon:
        min_lon, max_lon = max_lon, min_lon

    # Clamp
    min_lat = max(-90.0, min(90.0, min_lat))
    max_lat = max(-90.0, min(90.0, max_lat))
    min_lon = max(-180.0, min(180.0, min_lon))
    max_lon = max(-180.0, min(180.0, max_lon))
    
    # Round bbox to 0.25° grid for cache sharing (finer than 0.5° for better coastline alignment)
    rounded_min_lat, rounded_min_lon, rounded_max_lat, rounded_max_lon = _round_bbox(min_lat, min_lon, max_lat, max_lon, 0.25)
    
    # Expand rounded bbox AGGRESSIVELY (0.75° = ~83km) to ensure full viewport coverage
    # OPeNDAP subsetting may return data at nearest grid points, which can be slightly inside requested bounds
    # WW3 global grid is 0.16° (~18km), so we need substantial padding to ensure interpolation works at edges
    # This prevents gaps where data bounds don't fully cover map bounds, especially for Windy-style full coverage
    expansion = 0.75  # Aggressive expansion for full viewport coverage
    rounded_min_lat = max(-90.0, rounded_min_lat - expansion)
    rounded_min_lon = max(-180.0, rounded_min_lon - expansion)
    rounded_max_lat = min(90.0, rounded_max_lat + expansion)
    rounded_max_lon = min(180.0, rounded_max_lon + expansion)
    
    rounded_bbox = f"{rounded_min_lat:.1f},{rounded_min_lon:.1f},{rounded_max_lat:.1f},{rounded_max_lon:.1f}"

    def _format_dir_param(date_yyyymmdd: str, cycle_hh: str) -> str:
        # WW3 uses: /wave.YYYYMMDD/multi_1.glo_30m.t{HH}z
        # Try both formats
        return f"%2Fwave.{date_yyyymmdd}%2Fmulti_1.glo_30m.t{cycle_hh}z"

    def _parse_run(run_str: str) -> Optional[tuple]:
        try:
            r = run_str.replace("Z", "")
            dt = datetime.fromisoformat(r)
            return (dt.strftime("%Y%m%d"), dt.strftime("%H"))
        except Exception:
            return None

    async def _resolve_latest_ww3_run() -> tuple:
        # WW3 runs at 00, 06, 12, 18Z
        now = datetime.utcnow()
        for day_offset in [0, 1]:
            d = (now - timedelta(days=day_offset)).strftime("%Y%m%d")
            for hh in ["18", "12", "06", "00"]:
                # Try to probe for WW3 file (use f000 for probing)
                file_name = f"multi_1.glo_30m.t{hh}z.wavdir.f000"
                probe_url = (
                    "https://nomads.ncep.noaa.gov/cgi-bin/filter_wave.pl"
                    f"?file={file_name}"
                    "&var_HTSGW=on&var_WVDIR=on"
                    "&leftlon=0&rightlon=1&toplat=1&bottomlat=0"
                    f"&dir={_format_dir_param(d, hh)}"
                )
                try:
                    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                        resp = await client.head(probe_url)
                        if resp.status_code == 200:
                            print(f"✅ Resolved latest WW3 run: {d} {hh}z")
                            return (d, hh)
                except Exception:
                    continue
        fallback_d = now.strftime("%Y%m%d")
        print(f"⚠️  Could not probe latest WW3 run; using fallback {fallback_d} 00z")
        return (fallback_d, "00")

    def _bbox_to_nomads_lon(left: float, right: float) -> tuple:
        # Convert [-180,180] to [0,360]
        def to360(lon: float) -> float:
            return lon % 360.0

        l = to360(left)
        r = to360(right)
        # If it crosses dateline, expand to full globe for MVP
        if l > r:
            return (0.0, 360.0)
        return (l, r)

    # Note: Cache check happens after domain selection (domain_id needed for cache key)

    run_date = None
    run_cycle = None
    if run:
        parsed = _parse_run(run)
        if parsed:
            run_date, run_cycle = parsed

    if not run_date or not run_cycle:
        # Simple heuristic for latest WW3 run
        now = datetime.utcnow()
        current_hour = now.hour
        if current_hour < 6:
            run_date = (now - timedelta(days=1)).strftime("%Y%m%d")
            run_cycle = "18"
        elif current_hour < 12:
            run_date = now.strftime("%Y%m%d")
            run_cycle = "00"
        elif current_hour < 18:
            run_date = now.strftime("%Y%m%d")
            run_cycle = "06"
        else:
            run_date = now.strftime("%Y%m%d")
            run_cycle = "12"

    fh = max(0, int(forecast_hour))
    
    # Select WW3 domain using registry (automatic selection based on bbox/zoom)
    # This must happen before cache lookup so we can include domain_id in cache key
    domain_config = _select_ww3_domain(
        (min_lat, min_lon, max_lat, max_lon),
        zoom=None,  # Could pass zoom if available from frontend
        source=source  # Use source parameter for domain selection
    )
    domain = domain_config.get("domain", "global")
    domain_id = domain_config.get("id", "global_0p16")
    
    # Safety check: If selected domain is regional (epacif/atlocn) but bbox is large,
    # fall back to global to ensure full coverage
    # Also, temporarily force global for California area until we verify epacif coverage
    bbox_width = max_lon - min_lon
    bbox_height = max_lat - min_lat
    center_lon = (min_lon + max_lon) / 2
    center_lat = (min_lat + max_lat) / 2
    
    # Force global if bbox is large OR if we're in California area (epacif may not have full coverage)
    # Also force global if bbox is moderately large (>= 10°) to ensure full coverage
    force_global = False
    if domain in ["epacif", "atlocn"]:
        if bbox_width >= 10 or bbox_height >= 10:  # Lowered threshold from 15° to 10° for better coverage
            force_global = True
            print(f"⚠️  Moderate/large bbox ({bbox_width:.1f}° x {bbox_height:.1f}°) with regional domain {domain}, falling back to global for full coverage")
        elif center_lon < -110 and center_lat > 25 and center_lat < 45:
            # California area - epacif may not have full coverage, use global
            force_global = True
            print(f"⚠️  California area with regional domain {domain}, using global for better coverage")
    
    if force_global:
        # Find global domain
        registry = _load_ww3_registry()
        for d in registry.get("domains", []):
            if d.get("domain") == "global":
                domain_config = d
                domain = "global"
                domain_id = d.get("id", "global_0p16")
                break
    
    resolution = domain_config.get("resolution", {})
    lat_step = resolution.get("lat_step", 0.16)
    
    # Update cache key with actual run info and domain ID
    cache_key = await _get_ww3_cache_key(run_date, run_cycle, forecast_hour, rounded_bbox, domain_id)
    
    # Check cache again with run info and domain
    cached_vectors = await _get_ww3_from_cache(cache_key)
    if cached_vectors:
        return cached_vectors
    
    # Build OPeNDAP URL using domain pattern from registry
    opendap_pattern = domain_config.get("opendap_pattern", f"gfswave.{domain}.0p16_{{HH}}z")
    opendap_url = f"https://nomads.ncep.noaa.gov/dods/wave/gfswave/{run_date}/{opendap_pattern.format(HH=run_cycle)}"
    
    print(f"🌊 Selected WW3 domain: {domain_config.get('name', domain)} (resolution: {lat_step}°)")

    print(f"🌊 Fetching WW3 via OPeNDAP: {opendap_url} (forecast hour {fh})")
    fetch_start_time = time.time()

    try:
        import xarray as xr
        import numpy as np
        from concurrent.futures import ThreadPoolExecutor

        def fetch_opendap_data():
            try:
                # Open OPeNDAP dataset (no chunks - dask not required)
                ds = xr.open_dataset(opendap_url)
                
                # Find time index for forecast_hour
                if 'time' not in ds.dims:
                    ds.close()
                    return None
                
                time_coord = ds['time']
                time_values = time_coord.values
                
                # Calculate run base time
                run_dt = datetime.strptime(f"{run_date}{run_cycle}", "%Y%m%d%H")
                run_base = run_dt.replace(tzinfo=None)
                
                # Find time index matching forecast_hour
                time_idx = None
                for i, tv in enumerate(time_values):
                    forecast_time = None
                    if isinstance(tv, np.datetime64):
                        forecast_time = tv.astype('datetime64[s]').astype(datetime)
                    elif isinstance(tv, datetime):
                        forecast_time = tv.replace(tzinfo=None) if tv.tzinfo else tv
                    
                    if forecast_time:
                        delta = forecast_time - run_base
                        hours = int(delta.total_seconds() / 3600)
                        if hours == fh:
                            time_idx = i
                            break
                
                if time_idx is None:
                    print(f"❌ Forecast hour {fh} not found in dataset")
                    ds.close()
                    return None
                
                # Debug: print available variables
                print(f"🔍 Available data variables: {list(ds.data_vars.keys())}")
                print(f"🔍 Available coordinates: {list(ds.coords.keys())}")
                
                # Find HTSGW (significant wave height), WVDIR (mean wave direction), and PERPW (peak period)
                hs_name = None
                dir_name = None
                per_name = None
                for name in ds.data_vars:
                    var_lower = name.lower()
                    if 'htsgw' in var_lower or 'swh' in var_lower or 'hs' in var_lower or 'wave_height' in var_lower:
                        hs_name = name
                        print(f"✅ Found wave height var: {name}")
                    if 'wvdir' in var_lower or 'wdir' in var_lower or 'dir' in var_lower or 'wave_direction' in var_lower:
                        dir_name = name
                        print(f"✅ Found wave direction var: {name}")
                    if 'perpw' in var_lower or 'period' in var_lower or 'wave_period' in var_lower:
                        per_name = name
                        print(f"✅ Found wave period var: {name}")
                
                if not hs_name:
                    # Try common names
                    for cand in ['htsgw', 'swh', 'hs', 'wave_height', 'sig_wav_ht']:
                        if cand in ds.data_vars:
                            hs_name = cand
                            print(f"✅ Found wave height var (fallback): {cand}")
                            break
                
                if not hs_name:
                    print(f"❌ Could not find wave height var. Available: {list(ds.data_vars.keys())}")
                    ds.close()
                    return None
                
                # Select data for the forecast hour and bbox
                hs_var = ds[hs_name]
                dir_var = ds[dir_name] if dir_name and dir_name in ds.data_vars else None
                per_var = ds[per_name] if per_name and per_name in ds.data_vars else None
                
                # Get lat/lon coordinates
                lat_name = "latitude" if "latitude" in hs_var.coords else ("lat" if "lat" in hs_var.coords else None)
                lon_name = "longitude" if "longitude" in hs_var.coords else ("lon" if "lon" in hs_var.coords else None)
                
                if not lat_name or not lon_name:
                    print("❌ Could not find lat/lon coordinates")
                    ds.close()
                    return None
                
                # Select subset for rounded bbox and time
                # Convert lon to 0-360 if needed for OPeNDAP
                opendap_min_lon = rounded_min_lon if rounded_min_lon >= 0 else rounded_min_lon + 360
                opendap_max_lon = rounded_max_lon if rounded_max_lon >= 0 else rounded_max_lon + 360
                
                # Select data slice
                if 'time' in hs_var.dims:
                    hs_slice = hs_var.isel(time=time_idx)
                    if dir_var is not None and 'time' in dir_var.dims:
                        dir_slice = dir_var.isel(time=time_idx)
                    else:
                        dir_slice = None
                    if per_var is not None and 'time' in per_var.dims:
                        per_slice = per_var.isel(time=time_idx)
                    else:
                        per_slice = None
                else:
                    hs_slice = hs_var
                    dir_slice = dir_var
                    per_slice = per_var
                
                # Check latitude order in the dataset
                lat_coord = hs_slice[lat_name]
                lat_values = lat_coord.values
                lat_ascending = len(lat_values) > 1 and lat_values[0] < lat_values[-1]
                
                # Select bbox (OPeNDAP slicing) - adjust for latitude order
                if lat_ascending:
                    # Latitudes are ascending (south to north)
                    lat_slice = slice(rounded_min_lat, rounded_max_lat)
                else:
                    # Latitudes are descending (north to south)
                    lat_slice = slice(rounded_max_lat, rounded_min_lat)
                
                hs_subset = hs_slice.sel(
                    {lat_name: lat_slice,
                     lon_name: slice(opendap_min_lon, opendap_max_lon)}
                )

                if dir_slice is not None:
                    dir_subset = dir_slice.sel(
                        {lat_name: lat_slice,
                         lon_name: slice(opendap_min_lon, opendap_max_lon)}
                    )
                else:
                    dir_subset = None

                if per_slice is not None:
                    per_subset = per_slice.sel(
                        {lat_name: lat_slice,
                         lon_name: slice(opendap_min_lon, opendap_max_lon)}
                    )
                else:
                    per_subset = None
                
                # Load data into memory
                print(f"🔍 Subset shape: {hs_subset.shape}, dims: {hs_subset.dims}")
                if hs_subset.size == 0:
                    print(f"⚠️  Empty subset! Lat order: {'ascending' if lat_ascending else 'descending'}, slice: {lat_slice}")
                    ds.close()
                    return None
                
                hs_values = hs_subset.values
                dir_values = dir_subset.values if dir_subset is not None else np.zeros_like(hs_values)
                per_values = per_subset.values if per_subset is not None else np.zeros_like(hs_values)
                lats = hs_subset[lat_name].values
                lons = hs_subset[lon_name].values

                # Force NaN/Inf to be finite (source-level cleanup)
                hs_values = np.array(hs_values, dtype=np.float64)
                dir_values = np.array(dir_values, dtype=np.float64) if dir_subset is not None else np.zeros_like(hs_values, dtype=np.float64)
                per_values = np.array(per_values, dtype=np.float64) if per_subset is not None else np.zeros_like(hs_values, dtype=np.float64)

                # Replace NaN/Inf with NaN (will be filtered out later)
                hs_values = np.where(np.isfinite(hs_values), hs_values, np.nan)
                dir_values = np.where(np.isfinite(dir_values), dir_values, np.nan)
                per_values = np.where(np.isfinite(per_values), per_values, np.nan)
                
                print(f"🔍 Loaded data: hs shape={hs_values.shape}, lats range={lats.min():.2f} to {lats.max():.2f}, lons range={lons.min():.2f} to {lons.max():.2f}")
                print(f"🔍 Requested bbox: lat {rounded_min_lat:.2f} to {rounded_max_lat:.2f}, lon {rounded_min_lon:.2f} to {rounded_max_lon:.2f}")

                # Debug period values
                valid_per = per_values[np.isfinite(per_values)] if per_values is not None else []
                if len(valid_per) > 0:
                    print(f"🔍 Period values: min={valid_per.min():.1f}s, max={valid_per.max():.1f}s, mean={valid_per.mean():.1f}s, count={len(valid_per)}")
                else:
                    print(f"⚠️  No valid period values found in dataset")

                ds.close()

                return (hs_values, dir_values, per_values, lats, lons)
                
            except Exception as e:
                print(f"❌ OPeNDAP fetch error: {e}")
                import traceback
                traceback.print_exc()
                return None
        
        # Run in thread pool with timeout
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=1) as executor:
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(executor, fetch_opendap_data),
                    timeout=30.0
                )
                
                if result is None:
                    return None

                hs_values, dir_values, per_values, lats, lons = result
                
                # Process data into vectors
                # Handle reversed latitude order
                if len(lats) >= 2 and lats[0] > lats[-1]:
                    hs_values = np.flipud(hs_values)
                    if dir_values is not None:
                        dir_values = np.flipud(dir_values)
                    if per_values is not None:
                        per_values = np.flipud(per_values)
                    lats = np.flip(lats)
                
                # Create meshgrid for lat/lon
                lon_grid, lat_grid = np.meshgrid(lons, lats)
                
                # Convert lon from [0,360] to [-180,180] - CRITICAL for correct mapping
                lon_grid = np.where(lon_grid > 180, lon_grid - 360, lon_grid)
                
                # Filter out NaN values
                valid_mask = ~np.isnan(hs_values)
                nan_count = np.sum(~valid_mask)
                total_points = hs_values.size
                nan_percent = (nan_count / total_points * 100) if total_points > 0 else 0
                
                # Diagnostic logging: resolution, NaN count, interpolation mode, bbox rounding
                if len(lats) > 1 and len(lons) > 1:
                    lat_step = abs(lats[1] - lats[0]) if len(lats) > 1 else 0
                    lon_step = abs(lons[1] - lons[0]) if len(lons) > 1 else 0
                    avg_lat = (lats.min() + lats.max()) / 2
                    print(f"🔍 WW3 Diagnostics:")
                    print(f"   Resolution: lat_step={lat_step:.4f}° (~{lat_step*111:.1f}km), lon_step={lon_step:.4f}° (~{lon_step*111*math.cos(math.radians(avg_lat)):.1f}km)")
                    print(f"   NaN count: {nan_count}/{total_points} ({nan_percent:.1f}%)")
                    print(f"   Interpolation: bilinear with NaN corner reweighting")
                    print(f"   Bbox rounding: 0.25° (was 0.5°)")
                
                vectors: List[Dict] = []
                
                # Subsample if too many points (limit to ~3000 vectors for performance - 40% reduction for faster rendering)
                valid_points = np.sum(valid_mask)
                step = 1
                if valid_points > 3000:
                    step = max(1, int(np.sqrt(valid_points / 3000)))
                    print(f"📊 Subsampling: {valid_points} valid points -> ~{valid_points // (step*step)} vectors (step={step})")
                    hs_values = hs_values[::step, ::step]
                    dir_values = dir_values[::step, ::step] if dir_values is not None else dir_values[::step, ::step]
                    per_values = per_values[::step, ::step] if per_values is not None else per_values[::step, ::step]
                    lat_grid = lat_grid[::step, ::step]
                    lon_grid = lon_grid[::step, ::step]
                    valid_mask = valid_mask[::step, ::step]
                
                # Build vectors list - include ALL grid points (even NaN) to ensure bounds cover full expanded bbox
                # This ensures WaveField bounds match the requested bbox, even if some points are NaN
                for i in range(lat_grid.shape[0]):
                    for j in range(lon_grid.shape[1]):
                        lat_val = float(lat_grid[i, j])
                        lon_val = float(lon_grid[i, j])
                        
                        # Include all points, but set hs to null if NaN/invalid
                        if valid_mask[i, j] and not np.isnan(hs_values[i, j]) and np.isfinite(hs_values[i, j]) and hs_values[i, j] >= 0:
                            hs_val = round(float(hs_values[i, j]), 2)
                        else:
                            hs_val = None  # null for NaN/invalid points
                        
                        # Handle direction - check for NaN and bounds
                        if dir_values is not None and i < dir_values.shape[0] and j < dir_values.shape[1]:
                            dir_raw = dir_values[i, j]
                            if not np.isnan(dir_raw) and np.isfinite(dir_raw):
                                dir_val = round(float(dir_raw), 0)
                            else:
                                dir_val = 270.0  # Default direction for NaN
                        else:
                            dir_val = 270.0

                        # Handle period - check for NaN and bounds
                        if per_values is not None and i < per_values.shape[0] and j < per_values.shape[1]:
                            per_raw = per_values[i, j]
                            if not np.isnan(per_raw) and np.isfinite(per_raw) and per_raw > 0:
                                per_val = round(float(per_raw), 1)
                            else:
                                per_val = None  # null for NaN/invalid period
                        else:
                            per_val = None

                        # Include ALL points (even with null hs) to ensure bounds cover full expanded bbox
                        vectors.append({
                            "lat": round(lat_val, 2),
                            "lon": round(lon_val, 2),
                            "hs": hs_val,  # Can be null for NaN/invalid points
                            "dir_deg": dir_val,
                            "period": per_val,  # Can be null for NaN/invalid period
                        })
                
                fetch_duration = time.time() - fetch_start_time
                print(f"✅ Fetched {len(vectors)} wave vectors via OPeNDAP ({run_date} {run_cycle}z f{fh:03d}) in {fetch_duration:.2f}s")

                # Cache the result
                await _set_ww3_cache(cache_key, vectors)
                
                return vectors
                
            except asyncio.TimeoutError:
                print(f"❌ OPeNDAP timeout (30s)")
                return None
            except Exception as e:
                print(f"❌ Error fetching WW3 via OPeNDAP: {e}")
                import traceback
                traceback.print_exc()
                return None
                
    except Exception as e:
        print(f"❌ Error in WW3 OPeNDAP fetch: {e}")
        import traceback
        traceback.print_exc()
        return None

async def _get_wave_overlay_impl(
    model: str = "ww3",  # wavewatch3
    bounds: Optional[str] = None,
    forecast_hour: int = 0,  # Forecast hour (0 = current/analysis)
    real_data: bool = True,  # Toggle real vs synthetic data
    source: str = "global"  # Source: "global", "regional", "nearshore"
):
    """
    Get swell/wave overlay data for the map.
    Uses NOAA WaveWatch III model for global wave forecasts.
    Returns normalized format matching wind overlay structure.
    
    Args:
        source: "global" (default, WW3/GFSWave for offshore context),
                "regional" (future: higher-res regional model),
                "nearshore" (future: coastal detail model)
    """
    # Default to Pacific Ocean area west of California (ocean only, not land)
    if not bounds:
        # Extended west into Pacific Ocean, covering surfing area
        bounds = "30.0,-130.0,42.0,-117.0"
    
    try:
        min_lat, min_lon, max_lat, max_lon = _parse_and_validate_bounds(bounds)
    except ValueError as e:
        return {"error": str(e)}

    # Round bbox to 0.25° grid for cache sharing - dramatically improves cache hit rates
    # This matches the rounding used in fetch_real_noaa_ww3_opendap
    rounded_min_lat, rounded_min_lon, rounded_max_lat, rounded_max_lon = _round_bbox(
        min_lat, min_lon, max_lat, max_lon, 0.25
    )
    rounded_bounds = f"{rounded_min_lat},{rounded_min_lon},{rounded_max_lat},{rounded_max_lon}"

    # Include source in cache key for future multi-source support
    # Use rounded bounds for better cache hit rate during zoom/pan
    cache_key = f"waves_{model}_{rounded_bounds}_{forecast_hour}_{real_data}_{source}"
    
    # Check cache (30 minute TTL for wave data)
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
    
    # Select WW3 domain using registry (for debug info and domain selection)
    domain_config = _select_ww3_domain(
        (min_lat, min_lon, max_lat, max_lon),
        zoom=None,  # Could pass zoom if available from frontend
        source=source  # Use source parameter for domain selection
    )
    domain = domain_config.get("domain", "global")
    domain_id = domain_config.get("id", "global_0p16")
    
    # Select data source based on source parameter
    # For now, all sources use global WW3 (future: add regional/nearshore models)
    vectors = None
    run_time_utc = None
    valid_time_utc = None
    
    if real_data:
        # Use registry-based domain selection (automatic based on bbox and source)
        # The fetch function will automatically select the best domain
        vectors = await fetch_real_noaa_ww3_opendap(
            model,
            (min_lat, min_lon, max_lat, max_lon),
            run=None,  # Auto-resolve latest run
            forecast_hour=forecast_hour,
            source=source,  # Pass source for domain selection
        )
    
    # Fallback to synthetic data if real data fetch fails or real_data=False
    if not vectors or len(vectors) == 0:
        print(f"⚠️  Using synthetic wave data (real_data={real_data}, vectors={len(vectors) if vectors else 0})")
        import math
        vectors = []
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
                period = max(6, base_period + period_variation)
                
                # Normalized format matching wind overlay
                vectors.append({
                    "lat": round(lat, 2),
                    "lon": round(lon, 2),
                    "hs": round(height_m, 2),  # Significant wave height in meters
                    "dir_deg": round(direction, 0)  # Mean wave direction in degrees
                })
                
                lon += lon_step
            lat += lat_step
    
    # Compute debug stats
    if vectors:
        # Filter out NaN and None values before computing stats
        hs_values = [v["hs"] for v in vectors if v.get("hs") is not None and not (isinstance(v.get("hs"), float) and (np.isnan(v.get("hs")) or not np.isfinite(v.get("hs"))))]
        dir_values = [v["dir_deg"] for v in vectors if v.get("dir_deg") is not None and not (isinstance(v.get("dir_deg"), float) and (np.isnan(v.get("dir_deg")) or not np.isfinite(v.get("dir_deg"))))]
        debug_info = {
            "ww3_domain": domain_config.get("name", domain),
            "ww3_domain_id": domain_id,
            "count": len(vectors),
            "hs_min_m": round(min(hs_values), 2) if hs_values else 0,
            "hs_max_m": round(max(hs_values), 2) if hs_values else 0,
            "dir_min_deg": round(min(dir_values), 0) if dir_values else 0,
            "dir_max_deg": round(max(dir_values), 0) if dir_values else 0,
            "bbox": f"{min_lat:.2f},{min_lon:.2f},{max_lat:.2f},{max_lon:.2f}",
            "sample_first_5": [
                {k: (v if not (isinstance(v, float) and (np.isnan(v) or not np.isfinite(v))) else 0) 
                 for k, v in v.items()} 
                for v in vectors[:5]
            ]
        }
    else:
        debug_info = {
            "count": 0,
            "hs_min_m": 0,
            "hs_max_m": 0,
            "dir_min_deg": 0,
            "dir_max_deg": 0,
            "bbox": f"{min_lat:.2f},{min_lon:.2f},{max_lat:.2f},{max_lon:.2f}",
            "sample_first_5": []
        }
    
    # Normalized result format (matching wind overlay structure)
    is_real = real_data and vectors and len(vectors) > 0 and any(v.get("hs", 0) > 0 for v in vectors[:10])
    
    # Sanitize vectors to remove any NaN values
    def sanitize_value(v):
        """Convert NaN/Inf to None for JSON serialization."""
        if isinstance(v, float):
            if np.isnan(v) or not np.isfinite(v):
                return None
        return v
    
    def sanitize_vector(v):
        """Sanitize a single vector dict."""
        return {k: sanitize_value(val) for k, val in v.items()}
    
    sanitized_vectors = [sanitize_vector(v) for v in vectors] if vectors else []
    
    result = {
        "model": model,
        "param": "waves",
        "model_name": ww3_config["name"] + (" (SYNTHETIC)" if not is_real else ""),
        "resolution": ww3_config["resolution"],
        "source": "NOAA NCEP" if is_real else "SYNTHETIC (not real NOAA NCEP)",
        "data_type": "real" if is_real else "synthetic",
        "vectors": sanitized_vectors,
        "units": {
            "hs": "m",  # meters
            "dir": "deg"  # degrees
        },
        "meta": {
            "run": datetime.utcnow().isoformat() + "Z",
            "forecast_hour": forecast_hour,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        },
        "bounds": {
            "min_lat": min_lat,
            "min_lon": min_lon,
            "max_lat": max_lat,
            "max_lon": max_lon
        },
        "debug": debug_info
    }
    
    # Cache the result
    cache[cache_key] = {
        "cached_at": datetime.now(),
        "data": result
    }
    
    return result

@app.get("/api/swell-overlay")
async def get_swell_overlay(
    model: str = "ww3",
    bounds: Optional[str] = None,
    forecast_hour: int = 0,
    real_data: bool = True
):
    """Legacy endpoint name - uses wave overlay implementation."""
    return await _get_wave_overlay_impl(model, bounds, forecast_hour, real_data)

@app.get("/api/waves-overlay")
async def get_waves_overlay(
    model: str = "ww3",
    bounds: Optional[str] = None,
    forecast_hour: int = 0,
    real_data: bool = True,  # Default to real data, synthetic only as fallback
    source: str = "global"  # Source: "global" (WW3/GFSWave), "regional" (future), "nearshore" (future)
):
    """
    Get wave overlay data (normalized format matching wind overlay).
    
    Args:
        source: Wave data source - "global" (default, WW3/GFSWave for offshore context),
                "regional" (future: higher-res regional model), "nearshore" (future: coastal detail)
    """
    return await _get_wave_overlay_impl(model, bounds, forecast_hour, real_data, source)

@app.get("/api/waves/run-availability")
async def get_ww3_run_availability():
    """
    Get WW3 run availability by reading OPeNDAP metadata once per run.
    Returns latest run and available forecast hours.
    Cached for 30 minutes.
    """
    cache_key = "ww3_run_availability"
    
    # Check cache
    if cache_key in cache:
        cached_entry = cache[cache_key]
        cached_time = cached_entry.get("cached_at")
        if cached_time and datetime.now() - cached_time < timedelta(minutes=30):
            return cached_entry["data"]
    
    try:
        import xarray as xr
        import numpy as np
        from concurrent.futures import ThreadPoolExecutor
        
        async def _resolve_latest_ww3_run_simple() -> tuple:
            """Simple heuristic for latest WW3 run."""
            now = datetime.utcnow()
            current_hour = now.hour
            
            if current_hour < 6:
                date = (now - timedelta(days=1)).strftime("%Y%m%d")
                cycle = "18"
            elif current_hour < 12:
                date = now.strftime("%Y%m%d")
                cycle = "00"
            elif current_hour < 18:
                date = now.strftime("%Y%m%d")
                cycle = "06"
            else:
                date = now.strftime("%Y%m%d")
                cycle = "12"
            
            return (date, cycle)
        
        run_date, run_cycle = await _resolve_latest_ww3_run_simple()
        # WW3 OPeNDAP URL format: /dods/wave/gfswave/{YYYYMMDD}/gfswave.{domain}.0p16_{HH}z
        domain = "global"  # Use "global" or "epacif" (Eastern Pacific)
        opendap_url = f"https://nomads.ncep.noaa.gov/dods/wave/gfswave/{run_date}/gfswave.{domain}.0p16_{run_cycle}z"
        
        def read_opendap_metadata():
            try:
                ds = xr.open_dataset(opendap_url)  # No chunks - dask not required
                
                if 'time' not in ds.dims:
                    ds.close()
                    return None
                
                time_coord = ds['time']
                time_values = time_coord.values
                
                run_dt = datetime.strptime(f"{run_date}{run_cycle}", "%Y%m%d%H")
                run_base = run_dt.replace(tzinfo=None)
                
                forecast_hours = []
                for tv in time_values:
                    forecast_time = None
                    if isinstance(tv, np.datetime64):
                        forecast_time = tv.astype('datetime64[s]').astype(datetime)
                    elif isinstance(tv, datetime):
                        forecast_time = tv.replace(tzinfo=None) if tv.tzinfo else tv
                    
                    if forecast_time:
                        delta = forecast_time - run_base
                        hours = int(delta.total_seconds() / 3600)
                        if 0 <= hours <= 180:
                            forecast_hours.append(hours)
                
                ds.close()
                return sorted(set(forecast_hours))
            except Exception as e:
                print(f"❌ OPeNDAP metadata read error: {e}")
                return None
        
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=1) as executor:
            try:
                forecast_hours = await asyncio.wait_for(
                    loop.run_in_executor(executor, read_opendap_metadata),
                    timeout=10.0
                )
                
                if forecast_hours:
                    run_iso = datetime.strptime(f"{run_date}{run_cycle}", "%Y%m%d%H").isoformat() + "Z"
                    times_utc = _times_utc_for_run(run_iso, tuple(forecast_hours))
                    
                    result = {
                        "model": "ww3",
                        "run": run_iso,
                        "run_date": run_date,
                        "run_cycle": run_cycle,
                        "hours": forecast_hours,
                        "times_utc": times_utc,
                        "source": "NOAA NOMADS OPeNDAP"
                    }
                    
                    # Cache the result
                    cache[cache_key] = {
                        "cached_at": datetime.now(),
                        "data": result
                    }
                    
                    return result
                else:
                    # Fallback: standard WW3 cadence
                    forecast_hours = list(range(0, 181, 3))  # 0-180 hours, 3-hourly
                    run_iso = datetime.strptime(f"{run_date}{run_cycle}", "%Y%m%d%H").isoformat() + "Z"
                    times_utc = _times_utc_for_run(run_iso, tuple(forecast_hours))
                    
                    result = {
                        "model": "ww3",
                        "run": run_iso,
                        "run_date": run_date,
                        "run_cycle": run_cycle,
                        "hours": forecast_hours,
                        "times_utc": times_utc,
                        "source": "NOAA NOMADS (fallback cadence)"
                    }
                    
                    cache[cache_key] = {
                        "cached_at": datetime.now(),
                        "data": result
                    }
                    
                    return result
                    
            except asyncio.TimeoutError:
                print(f"⏱️  OPeNDAP timeout (10s) - using fallback")
                # Fallback cadence
                forecast_hours = list(range(0, 181, 3))
                run_iso = datetime.strptime(f"{run_date}{run_cycle}", "%Y%m%d%H").isoformat() + "Z"
                times_utc = _times_utc_for_run(run_iso, tuple(forecast_hours))
                
                result = {
                    "model": "ww3",
                    "run": run_iso,
                    "run_date": run_date,
                    "run_cycle": run_cycle,
                    "hours": forecast_hours,
                    "times_utc": times_utc,
                    "source": "NOAA NOMADS (fallback cadence)"
                }
                
                cache[cache_key] = {
                    "cached_at": datetime.now(),
                    "data": result
                }
                
                return result
            except Exception as e:
                print(f"❌ Error getting WW3 run availability: {e}")
                return {"error": str(e)}
                
    except Exception as e:
        print(f"❌ Error in WW3 run availability: {e}")
        return {"error": str(e)}

@app.get("/api/wave-point")
async def get_wave_point(
    lat: float,
    lon: float,
    model: str = "ww3",
    forecast_hour: int = 0,
    real_data: bool = True
):
    """
    Debug endpoint: Get raw wave data at a specific point.
    Returns raw field values before any conversion.
    """
    # Normalize longitude to -180..180 if needed
    if lon > 180:
        lon = lon - 360
    
    # Get wave overlay data for a small area around the point
    bounds = f"{lat - 0.1},{lon - 0.1},{lat + 0.1},{lon + 0.1}"
    overlay_data = await _get_wave_overlay_impl(model, bounds, forecast_hour, real_data)
    
    if "error" in overlay_data:
        return overlay_data
    
    # Find the closest vector to the requested point
    vectors = overlay_data.get("vectors", [])
    if not vectors:
        return {
            "error": "No vectors found",
            "lat": lat,
            "lon": lon,
            "model": model,
            "forecast_hour": forecast_hour
        }
    
    # Find nearest vector
    min_dist = float('inf')
    closest = None
    for v in vectors:
        dist = ((v["lat"] - lat) ** 2 + (v["lon"] - lon) ** 2) ** 0.5
        if dist < min_dist:
            min_dist = dist
            closest = v
    
    # Get meta info
    meta = overlay_data.get("meta", {})
    
    result = {
        "requested": {
            "lat": lat,
            "lon": lon,
            "model": model,
            "forecast_hour": forecast_hour
        },
        "closest_vector": closest,
        "distance_deg": round(min_dist, 4),
        "raw_values": {
            "hs_m": closest.get("hs"),
            "hs_ft": round(closest.get("hs", 0) * 3.28084, 2) if closest.get("hs") else None,
            "dir_deg": closest.get("dir_deg"),
            "lat": closest.get("lat"),
            "lon": closest.get("lon")
        },
        "meta": {
            "model_run_utc": meta.get("run", "N/A"),
            "valid_time_utc": meta.get("timestamp", "N/A"),
            "forecast_hour": forecast_hour,
            "data_source": "SYNTHETIC (not real WW3 data)",
            "note": "Currently using synthetic data for testing. Real WW3 integration pending."
        },
        "debug": overlay_data.get("debug", {})
    }
    
    # Sanitize the entire response to eliminate any NaN/Inf
    result = json_sanitize(result)
    
    # Dev guard: assert no NaN
    try:
        json.dumps(result, allow_nan=False)
    except ValueError as e:
        print(f"❌ Wave-point JSON serialization failed: {e}")
        result = json_sanitize(result)  # Re-sanitize
    
    return result


# ============================================================================
# SURF SPOTS API
# ============================================================================

@app.get("/api/surf-spots")
async def get_surf_spots(
    region: Optional[str] = None,
    skill_level: Optional[str] = None,
    min_score: Optional[float] = None,
    with_scores: bool = False
):
    """
    Get all surf spots with optional filtering.

    Query params:
    - region: Filter by region (e.g., "San Diego County")
    - skill_level: Filter by skill level (beginner, intermediate, experienced, expert)
    - min_score: Minimum current score (requires with_scores=true)
    - with_scores: Include real-time conditions scores (slower)
    """
    if not supabase:
        return {"error": "Database not configured"}

    try:
        # Build query
        query = supabase.table("spots").select("""
            *,
            spot_characteristics(
                break_type,
                bottom_type,
                wave_quality,
                skill_level,
                crowd_level,
                best_swell_direction,
                works_from_swell_ft,
                works_to_swell_ft
            )
        """)

        # Apply filters
        if region:
            query = query.eq("subregion", region)

        result = query.execute()
        spots = result.data

        # Filter by skill level if specified
        if skill_level:
            spots = [
                s for s in spots
                if s.get('spot_characteristics', {}).get('skill_level') == skill_level
            ]

        # Calculate scores if requested
        if with_scores:
            # Import here to avoid circular dependency
            from surf_scoring import calculate_spot_score

            # Fetch all buoy data once
            buoy_cache = {}
            buoy_list = get_all_buoys() if get_all_buoys else []

            for buoy in buoy_list:
                try:
                    buoy_data = await fetch_buoy_data(buoy['id'], wind_fallback_station=buoy.get('wind_fallback'))
                    if buoy_data and 'station' in buoy_data:
                        buoy_cache[buoy_data['station']] = buoy_data
                except Exception as e:
                    print(f"⚠️  Failed to fetch buoy {buoy['id']}: {e}")
                    continue

            # Calculate scores for each spot
            spots_with_scores = []
            for spot in spots:
                try:
                    score_result = await calculate_spot_score(spot['slug'], buoy_cache)
                    if score_result:
                        spot['current_conditions'] = score_result
                        spots_with_scores.append(spot)
                except Exception as e:
                    print(f"⚠️  Failed to score {spot['slug']}: {e}")
                    spot['current_conditions'] = None
                    spots_with_scores.append(spot)

            spots = spots_with_scores

            # Apply min_score filter if specified
            if min_score is not None:
                spots = [
                    s for s in spots
                    if s.get('current_conditions', {}).get('overall_score', 0) >= min_score
                ]

        return {
            "spots": spots,
            "count": len(spots),
            "with_scores": with_scores
        }

    except Exception as e:
        print(f"❌ Error fetching surf spots: {e}")
        return {"error": str(e), "spots": [], "count": 0}


@app.get("/api/surf-spots/{slug}")
async def get_surf_spot_detail(slug: str):
    """
    Get detailed information for a single surf spot.
    Includes characteristics, swell/wind windows, and buoy mappings.
    """
    if not supabase:
        return {"error": "Database not configured"}

    try:
        result = supabase.table("spots").select("""
            *,
            spot_characteristics(*),
            spot_swell_windows(*),
            spot_wind_windows(*),
            spot_forecast_tuning(*)
        """).eq("slug", slug).single().execute()

        if not result.data:
            return {"error": "Spot not found"}

        return result.data

    except Exception as e:
        print(f"❌ Error fetching spot {slug}: {e}")
        return {"error": str(e)}


@app.put("/api/admin/surf-spots/{slug}")
async def update_surf_spot(
    slug: str,
    spot_data: Dict[str, Any],
    user: Dict = Depends(require_admin)
):
    """
    Update surf spot data (admin only).
    Updates both spots table (basic info) and spot_characteristics table.
    """
    from database import get_supabase_admin_client
    from datetime import datetime

    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not available")

    # Define which fields belong to which table
    spot_fields = [
        'name', 'region', 'subregion', 'latitude', 'longitude',
        'location_description', 'access_description', 'parking_info'
    ]

    char_fields = [
        'break_type', 'bottom_type', 'wave_quality', 'skill_level',
        'best_swell_direction', 'best_wind_direction', 'tide_position',
        'works_from_swell_ft', 'works_to_swell_ft', 'hazards'
    ]

    # Validation
    if 'name' in spot_data and not spot_data['name']:
        raise HTTPException(status_code=400, detail="Name is required")

    if 'region' in spot_data and not spot_data['region']:
        raise HTTPException(status_code=400, detail="Region is required")

    if 'skill_level' in spot_data and not spot_data['skill_level']:
        raise HTTPException(status_code=400, detail="Skill level is required")

    if 'latitude' in spot_data:
        lat = spot_data['latitude']
        if lat < -90 or lat > 90:
            raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90")

    if 'longitude' in spot_data:
        lon = spot_data['longitude']
        if lon < -180 or lon > 180:
            raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180")

    try:
        # Update spots table
        spot_update = {k: v for k, v in spot_data.items() if k in spot_fields}
        if spot_update:
            spot_update['updated_at'] = datetime.utcnow().isoformat()
            result = admin_client.table("spots") \
                .update(spot_update) \
                .eq("slug", slug) \
                .execute()

            if not result.data:
                raise HTTPException(status_code=404, detail=f"Spot '{slug}' not found")

        # Update characteristics table
        char_update = {k: v for k, v in spot_data.items() if k in char_fields}
        if char_update:
            char_update['updated_at'] = datetime.utcnow().isoformat()

            # Get spot ID
            spot = admin_client.table("spots").select("id").eq("slug", slug).single().execute()
            if spot.data:
                admin_client.table("spot_characteristics") \
                    .update(char_update) \
                    .eq("spot_id", spot.data['id']) \
                    .execute()

        print(f"✅ Spot '{slug}' updated by {user.get('email', 'unknown')}")
        return {"success": True, "message": "Spot updated successfully"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error updating spot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/surf-spots/{slug}/conditions")
async def get_surf_spot_conditions(slug: str):
    """
    Get real-time surf conditions and score for a spot.
    Returns current wave/wind data from blended buoys with 0-10 quality score.
    """
    if not supabase:
        return {"error": "Database not configured"}

    try:
        from surf_scoring import calculate_spot_score

        # Get spot to find buoy mappings
        spot_result = supabase.table("spots").select("""
            *,
            spot_forecast_tuning(buoy_blend)
        """).eq("slug", slug).single().execute()

        if not spot_result.data:
            return {"error": "Spot not found"}

        spot = spot_result.data
        tuning = spot.get('spot_forecast_tuning', {})
        buoy_blend = tuning.get('buoy_blend', {})

        if not buoy_blend:
            return {"error": "No buoys mapped for this spot"}

        # Make a copy of buoy_blend so we can modify it
        import copy
        buoy_blend_with_model = copy.deepcopy(buoy_blend)

        # Fetch buoy data for all buoys in the blend
        buoy_cache = {}
        for buoy_id in buoy_blend.keys():
            try:
                buoy_data = await fetch_buoy_data(buoy_id)
                if buoy_data and 'station' in buoy_data:
                    buoy_cache[buoy_id] = buoy_data
            except Exception as e:
                print(f"⚠️  Failed to fetch buoy {buoy_id}: {e}")
                continue

        # Fetch WW3 model data at spot coordinates
        try:
            lat = spot['latitude']
            lon = spot['longitude']
            bounds = f"{lat-0.1},{lon-0.1},{lat+0.1},{lon+0.1}"

            wave_response = await get_waves_overlay(
                model="ww3",
                bounds=bounds,
                forecast_hour=0,
                source="global"
            )

            if wave_response and 'vectors' in wave_response and len(wave_response['vectors']) > 0:
                # Find closest grid point to spot
                min_dist = float('inf')
                closest = None
                for v in wave_response['vectors']:
                    dist = ((v['lat'] - lat)**2 + (v['lon'] - lon)**2)**0.5
                    if dist < min_dist:
                        min_dist = dist
                        closest = v

                if closest and closest.get('hs'):
                    # Add WW3 as a synthetic buoy to the cache
                    buoy_cache['WW3'] = {
                        'station': 'WW3',
                        'wave_height_m': closest.get('hs'),
                        'dominant_period_sec': closest.get('per'),  # May be None
                        'mean_wave_dir': str(int(closest.get('dir_deg'))) if closest.get('dir_deg') else None,
                        'wind_speed_ms': None,
                        'wind_dir': None,
                        'timestamp_utc': datetime.utcnow().isoformat() + 'Z',
                        'name': 'WaveWatch III Model'
                    }

                    # Add WW3 to the buoy blend with 20% weight
                    # Reduce other buoy weights proportionally
                    ww3_weight = 0.2
                    scale_factor = (1.0 - ww3_weight)

                    # Scale existing weights in the copy
                    for buoy_id in buoy_blend_with_model.keys():
                        if isinstance(buoy_blend_with_model[buoy_id], dict):
                            buoy_blend_with_model[buoy_id]['weight'] = buoy_blend_with_model[buoy_id].get('weight', 0) * scale_factor
                        else:
                            buoy_blend_with_model[buoy_id] = {'weight': buoy_blend_with_model[buoy_id] * scale_factor}

                    # Add WW3
                    buoy_blend_with_model['WW3'] = {'weight': ww3_weight, 'role': 'model'}

                    print(f"✅ Added WW3 model data to {slug} blend (20% weight)")
        except Exception as e:
            print(f"⚠️  Failed to fetch WW3 for {slug}: {e}")

        # Calculate score with modified blend (includes WW3 if available)
        score_result = await calculate_spot_score(slug, buoy_cache, buoy_blend_override=buoy_blend_with_model)

        if not score_result:
            return {"error": "Unable to calculate conditions"}

        return score_result

    except Exception as e:
        print(f"❌ Error calculating conditions for {slug}: {e}")
        return {"error": str(e)}


@app.get("/api/surf-spots/{slug}/model-forecast")
async def get_surf_spot_model_forecast(slug: str):
    """
    Get current model forecast data at spot coordinates.
    Fetches WW3 wave and HRRR wind data at the exact spot location.
    """
    if not supabase:
        return {"error": "Database not configured"}

    try:
        # Get spot coordinates
        spot_result = supabase.table("spots").select("latitude, longitude, name").eq("slug", slug).single().execute()

        if not spot_result.data:
            return {"error": "Spot not found"}

        spot = spot_result.data
        lat = spot['latitude']
        lon = spot['longitude']

        # Create small bbox around spot (0.2° ~ 22km box)
        bounds = f"{lat-0.1},{lon-0.1},{lat+0.1},{lon+0.1}"

        model_data = {}

        # Fetch WW3 wave data (hour 0 = current)
        try:
            wave_response = await get_waves_overlay(
                model="ww3",
                bounds=bounds,
                forecast_hour=0,
                source="global"
            )

            if wave_response and 'vectors' in wave_response and len(wave_response['vectors']) > 0:
                # Find closest grid point to spot
                min_dist = float('inf')
                closest = None
                for v in wave_response['vectors']:
                    dist = ((v['lat'] - lat)**2 + (v['lon'] - lon)**2)**0.5
                    if dist < min_dist:
                        min_dist = dist
                        closest = v

                if closest:
                    model_data['ww3'] = {
                        'wave_height_m': closest.get('hs'),
                        'wave_height_ft': closest.get('hs') * 3.28084 if closest.get('hs') else None,
                        'direction': closest.get('dir_deg'),
                        'period_sec': closest.get('per'),  # May be None
                        'grid_distance_km': min_dist * 111,  # degrees to km
                        'model': 'WaveWatch III',
                        'resolution': '0.16° (~18km)'
                    }
        except Exception as e:
            print(f"⚠️  WW3 fetch failed for {slug}: {e}")
            model_data['ww3'] = {'error': str(e)}

        # Fetch HRRR wind data (hour 0 = current)
        try:
            wind_response = await get_wind_overlay(
                model="hrrr",
                bounds=bounds,
                forecast_hour=0,
                real_data=True
            )

            if wind_response and 'vectors' in wind_response and len(wind_response['vectors']) > 0:
                # Find closest grid point to spot
                min_dist = float('inf')
                closest = None
                for v in wind_response['vectors']:
                    dist = ((v['lat'] - lat)**2 + (v['lon'] - lon)**2)**0.5
                    if dist < min_dist:
                        min_dist = dist
                        closest = v

                if closest:
                    # Convert wind speed from m/s to mph
                    speed_ms = ((closest.get('u', 0)**2 + closest.get('v', 0)**2)**0.5)
                    speed_mph = speed_ms * 2.23694

                    model_data['hrrr'] = {
                        'wind_speed_ms': speed_ms,
                        'wind_speed_mph': speed_mph,
                        'wind_direction': closest.get('dir'),
                        'grid_distance_km': min_dist * 111,
                        'model': 'HRRR',
                        'resolution': '3km'
                    }
        except Exception as e:
            print(f"⚠️  HRRR fetch failed for {slug}: {e}")
            model_data['hrrr'] = {'error': str(e)}

        # Sanitize for JSON
        return json_sanitize({
            'spot_name': spot['name'],
            'spot_slug': slug,
            'latitude': lat,
            'longitude': lon,
            'models': model_data
        })

    except Exception as e:
        print(f"❌ Error fetching model forecast for {slug}: {e}")
        return {"error": str(e)}


@app.get("/api/surf-spots/{slug}/forecast-timeline")
async def get_surf_spot_forecast_timeline(slug: str, hours: int = 180):
    """
    Get forecast timeline for a spot showing wave and wind conditions over time.
    Returns data points every 3 hours from 0 to {hours}.
    """
    if not supabase:
        return {"error": "Database not configured"}

    try:
        # Get spot coordinates
        spot_result = supabase.table("spots").select("latitude, longitude, name").eq("slug", slug).single().execute()

        if not spot_result.data:
            return {"error": "Spot not found"}

        spot = spot_result.data
        lat = spot['latitude']
        lon = spot['longitude']

        # Create small bbox around spot
        bounds = f"{lat-0.1},{lon-0.1},{lat+0.1},{lon+0.1}"

        forecast_timeline = []

        # Fetch WW3 data for multiple forecast hours
        # We'll fetch every 6 hours to reduce load: 0, 6, 12, 18, 24, etc.
        forecast_hours = list(range(0, min(hours + 1, 181), 6))

        print(f"🔮 Fetching forecast timeline for {slug}: {len(forecast_hours)} points")

        for forecast_hour in forecast_hours:
            try:
                # Fetch WW3 wave data
                wave_response = await get_waves_overlay(
                    model="ww3",
                    bounds=bounds,
                    forecast_hour=forecast_hour,
                    source="global"
                )

                wave_data = None
                if wave_response and 'vectors' in wave_response and len(wave_response['vectors']) > 0:
                    # Find closest grid point
                    min_dist = float('inf')
                    closest = None
                    for v in wave_response['vectors']:
                        dist = ((v['lat'] - lat)**2 + (v['lon'] - lon)**2)**0.5
                        if dist < min_dist:
                            min_dist = dist
                            closest = v

                    if closest:
                        height_m = closest.get('hs')
                        period_sec = closest.get('period')

                        # Calculate surf face height if we have both height and period
                        surf_height_m = None
                        surf_height_ft = None
                        if height_m and period_sec:
                            surf_height_m = calculate_surf_height(height_m, period_sec)
                            surf_height_ft = round(surf_height_m * 3.28084, 1)

                        wave_data = {
                            'height_m': height_m,
                            'height_ft': height_m * 3.28084 if height_m else None,
                            'direction': closest.get('dir_deg'),
                            'period': period_sec,
                            'surf_height_m': surf_height_m,
                            'surf_height_ft': surf_height_ft
                        }

                # Fetch GFS wind data (HRRR not fully implemented yet)
                wind_data = None
                try:
                    wind_response = await get_wind_overlay(
                        model="gfs",
                        bounds=bounds,
                        forecast_hour=forecast_hour,
                        real_data=True
                    )

                    if wind_response and 'vectors' in wind_response and len(wind_response['vectors']) > 0:
                        min_dist = float('inf')
                        closest = None
                        for v in wind_response['vectors']:
                            dist = ((v['lat'] - lat)**2 + (v['lon'] - lon)**2)**0.5
                            if dist < min_dist:
                                min_dist = dist
                                closest = v

                        if closest:
                            # GFS wind vectors use u_component/v_component and direction_deg
                            u_comp = closest.get('u_component', 0)
                            v_comp = closest.get('v_component', 0)
                            speed_ms = ((u_comp**2 + v_comp**2)**0.5)
                            wind_data = {
                                'speed_ms': round(speed_ms, 1),
                                'speed_mph': round(speed_ms * 2.23694, 1),
                                'direction': closest.get('direction_deg')
                            }
                except Exception as e:
                    print(f"⚠️  Wind fetch failed for hour {forecast_hour}: {e}")

                # Add to timeline
                forecast_timeline.append({
                    'hour': forecast_hour,
                    'wave': wave_data,
                    'wind': wind_data
                })

            except Exception as e:
                print(f"⚠️  Failed to fetch hour {forecast_hour}: {e}")
                continue

        return json_sanitize({
            'spot_name': spot['name'],
            'spot_slug': slug,
            'latitude': lat,
            'longitude': lon,
            'forecast_hours': forecast_hours,
            'timeline': forecast_timeline,
            'total_points': len(forecast_timeline)
        })

    except Exception as e:
        print(f"❌ Error fetching forecast timeline for {slug}: {e}")
        return {"error": str(e)}


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


# ============================================================================
# AI SURF ANALYSIS PERSONAS
# ============================================================================

# Import AI modules
try:
    from ai_personas import analyze_spot_swell_geometry
    from ai_analysis_db import (
        save_analysis, get_analysis, get_all_analyses,
        delete_analysis, update_user_feedback, get_analysis_stats
    )
    print("✅ AI personas module loaded")
except ImportError as e:
    print(f"⚠️  AI personas not available: {e}")
    analyze_spot_swell_geometry = None


@app.get("/api/ai/spot-analysis/{buoy_id}")
async def get_spot_ai_analysis(buoy_id: str):
    """
    Get AI-powered swell geometry analysis for a buoy/spot.

    Returns cached analysis if available, otherwise returns 404.
    Use POST endpoint to generate new analysis.
    """
    if not supabase:
        return {"error": "Database not available"}

    try:
        from ai_analysis_db import get_analysis

        analysis = await get_analysis(buoy_id, "swell_geometry_analyst")

        if analysis:
            return {
                "success": True,
                "cached": True,
                "buoy_id": buoy_id,
                "analysis": analysis
            }
        else:
            return {
                "success": False,
                "cached": False,
                "message": "No analysis found - use POST to generate"
            }

    except Exception as e:
        print(f"❌ Error retrieving AI analysis: {e}")
        return {"error": str(e)}


@app.post("/api/ai/spot-analysis/{buoy_id}/generate")
async def generate_spot_ai_analysis(buoy_id: str, force: bool = False):
    """
    Generate new AI-powered swell geometry analysis for a buoy/spot.

    Query params:
    - force: If true, regenerate even if cached analysis exists

    This is the endpoint to trigger AI analysis on-demand or in background.
    """
    if not analyze_spot_swell_geometry:
        return {"error": "AI personas not configured (missing ANTHROPIC_API_KEY)"}

    try:
        # Check if analysis already exists (unless force=true)
        if not force:
            from ai_analysis_db import get_analysis
            existing = await get_analysis(buoy_id, "swell_geometry_analyst")

            if existing:
                return {
                    "success": True,
                    "cached": True,
                    "message": "Analysis already exists (use force=true to regenerate)",
                    "analysis": existing
                }

        # Get buoy metadata
        buoy = get_buoy_by_id(buoy_id)

        if not buoy:
            return {"error": f"Buoy {buoy_id} not found"}

        print(f"🤖 Generating AI analysis for {buoy['name']} ({buoy_id})...")

        # Generate AI analysis
        result = await analyze_spot_swell_geometry(
            lat=buoy['lat'],
            lon=buoy['lon'],
            spot_name=buoy['name'],
            buoy_id=buoy_id
        )

        if not result.get('success'):
            return {
                "success": False,
                "error": result.get('error', 'Unknown error'),
                "buoy_id": buoy_id
            }

        # Save to database
        from ai_analysis_db import save_analysis

        saved = await save_analysis(
            buoy_id=buoy_id,
            spot_name=buoy['name'],
            lat=buoy['lat'],
            lon=buoy['lon'],
            analysis_data=result['analysis'],
            persona_type="swell_geometry_analyst",
            model_used=result.get('model', 'claude-3-haiku-20240307'),
            analysis_version="1.0"
        )

        if saved:
            print(f"✅ AI analysis saved for {buoy['name']}")
            return {
                "success": True,
                "cached": False,
                "generated": True,
                "buoy_id": buoy_id,
                "analysis": saved
            }
        else:
            # Analysis generated but save failed - return the analysis anyway
            return {
                "success": True,
                "cached": False,
                "generated": True,
                "save_failed": True,
                "warning": "Analysis generated but not saved to database",
                "buoy_id": buoy_id,
                "analysis": result
            }

    except Exception as e:
        print(f"❌ Error generating AI analysis: {e}")
        return {"error": str(e)}


@app.post("/api/ai/spot-analysis/batch-generate")
async def batch_generate_ai_analysis(buoy_ids: List[str] = None, force: bool = False):
    """
    Generate AI analysis for multiple buoys (background job).

    Body params:
    - buoy_ids: List of buoy IDs (if empty, analyzes all buoys)
    - force: Regenerate even if cached

    Returns immediately with job status. Analyses run in background.
    """
    if not analyze_spot_swell_geometry:
        return {"error": "AI personas not configured"}

    # Get list of buoys to analyze
    if not buoy_ids:
        all_buoys = get_all_buoys()
        buoy_ids = [b['id'] for b in all_buoys]

    print(f"🚀 Starting batch AI analysis for {len(buoy_ids)} buoys...")

    results = []

    for buoy_id in buoy_ids:
        try:
            result = await generate_spot_ai_analysis(buoy_id, force)
            results.append({
                "buoy_id": buoy_id,
                "success": result.get('success', False),
                "cached": result.get('cached', False)
            })

            # Brief delay to avoid rate limits
            await asyncio.sleep(1)

        except Exception as e:
            print(f"❌ Failed to analyze {buoy_id}: {e}")
            results.append({
                "buoy_id": buoy_id,
                "success": False,
                "error": str(e)
            })

    successful = sum(1 for r in results if r['success'])

    return {
        "success": True,
        "total_requested": len(buoy_ids),
        "successful": successful,
        "failed": len(buoy_ids) - successful,
        "results": results
    }


@app.get("/api/ai/analyses/all")
async def get_all_ai_analyses(persona_type: str = "swell_geometry_analyst", limit: int = 50):
    """
    Get all AI analyses in database.

    Query params:
    - persona_type: Filter by persona (default: swell_geometry_analyst)
    - limit: Max results (default: 50)
    """
    if not supabase:
        return {"error": "Database not available"}

    try:
        from ai_analysis_db import get_all_analyses

        analyses = await get_all_analyses(persona_type, limit)

        return {
            "success": True,
            "count": len(analyses),
            "analyses": analyses
        }

    except Exception as e:
        print(f"❌ Error retrieving analyses: {e}")
        return {"error": str(e)}


@app.delete("/api/ai/spot-analysis/{analysis_id}")
async def delete_ai_analysis(analysis_id: str):
    """
    Delete (archive) an AI analysis.
    """
    if not supabase:
        return {"error": "Database not available"}

    try:
        from ai_analysis_db import delete_analysis

        success = await delete_analysis(analysis_id)

        return {
            "success": success,
            "analysis_id": analysis_id,
            "message": "Analysis archived" if success else "Failed to archive"
        }

    except Exception as e:
        print(f"❌ Error deleting analysis: {e}")
        return {"error": str(e)}


@app.post("/api/ai/spot-analysis/{analysis_id}/feedback")
async def submit_analysis_feedback(analysis_id: str, rating: int, notes: str = None):
    """
    Submit user feedback for an AI analysis.

    Body params:
    - rating: 1-5 stars
    - notes: Optional text feedback
    """
    if not supabase:
        return {"error": "Database not available"}

    if rating < 1 or rating > 5:
        return {"error": "Rating must be 1-5"}

    try:
        from ai_analysis_db import update_user_feedback

        success = await update_user_feedback(analysis_id, rating, notes)

        return {
            "success": success,
            "analysis_id": analysis_id,
            "message": "Feedback submitted" if success else "Failed to submit feedback"
        }

    except Exception as e:
        print(f"❌ Error submitting feedback: {e}")
        return {"error": str(e)}


@app.get("/api/ai/stats")
async def get_ai_analysis_stats():
    """
    Get statistics about AI analyses in database.
    """
    if not supabase:
        return {"error": "Database not available"}

    try:
        from ai_analysis_db import get_analysis_stats

        stats = await get_analysis_stats()

        return {
            "success": True,
            "stats": stats
        }

    except Exception as e:
        print(f"❌ Error getting stats: {e}")
        return {"error": str(e)}


# ============================================================================
# SPOT-BASED AI ANALYSIS (New: Works with actual surf spots)
# ============================================================================

try:
    from ai_personas_spots import analyze_spot_swell_geometry as analyze_spot_ai
    from ai_analysis_db_spots import save_spot_analysis, get_spot_analysis, get_all_spot_analyses
    print("✅ Spot-based AI personas loaded")
except ImportError as e:
    print(f"⚠️  Spot-based AI personas not available: {e}")
    analyze_spot_ai = None

try:
    from ai_personas_spots_openai import SpotSwellGeometryAnalystOpenAI
    analyze_spot_ai_openai = SpotSwellGeometryAnalystOpenAI.analyze
    print("✅ OpenAI spot personas loaded")
except ImportError as e:
    print(f"⚠️  OpenAI spot personas not available: {e}")
    analyze_spot_ai_openai = None


@app.get("/api/spots/{spot_slug}/ai-analysis/all")
async def get_all_spot_ai_analyses(spot_slug: str):
    """
    Get ALL AI analyses for a spot (Claude, OpenAI, etc.)
    Returns a dict with model names as keys.
    """
    if not supabase:
        return {"error": "Database not available"}

    try:
        analyses = {}

        # Fetch Claude analysis
        claude = await get_spot_analysis(spot_slug, "swell_geometry_analyst")
        if claude:
            analyses['claude'] = {
                **claude,
                'provider': 'Claude',
                'model_display': 'Sonnet 4'
            }

        # Fetch OpenAI analysis
        openai = await get_spot_analysis(spot_slug, "swell_geometry_analyst_openai")
        if openai:
            analyses['openai'] = {
                **openai,
                'provider': 'OpenAI',
                'model_display': 'GPT-4o'
            }

        return {
            "success": True,
            "spot_slug": spot_slug,
            "analyses": analyses,
            "available_models": list(analyses.keys())
        }

    except Exception as e:
        print(f"❌ Error retrieving spot AI analyses: {e}")
        return {"error": str(e)}


@app.get("/api/spots/{spot_slug}/ai-analysis")
async def get_spot_ai_analysis(spot_slug: str):
    """
    Get AI-powered swell geometry analysis for a surf spot.

    Returns cached analysis if available, otherwise returns 404.
    Use POST endpoint to generate new analysis.
    """
    if not supabase:
        return {"error": "Database not available"}

    try:
        analysis = await get_spot_analysis(spot_slug, "swell_geometry_analyst")

        if analysis:
            return {
                "success": True,
                "cached": True,
                "spot_slug": spot_slug,
                "analysis": analysis
            }
        else:
            return {
                "success": False,
                "cached": False,
                "message": "No analysis found - use POST to generate"
            }

    except Exception as e:
        print(f"❌ Error retrieving spot AI analysis: {e}")
        return {"error": str(e)}


@app.post("/api/spots/{spot_slug}/ai-analysis/generate")
async def generate_spot_ai_analysis(
    spot_slug: str,
    force: bool = False,
    user: Dict = Depends(require_admin) if require_admin else None
):
    """
    Generate new AI-powered swell geometry analysis for a surf spot.

    **Requires admin authentication.**

    Query params:
    - force: If true, regenerate even if cached analysis exists

    This endpoint analyzes the ACTUAL surf spot using its characteristics,
    break type, swell windows, and local geography from the database.
    """
    if not analyze_spot_ai:
        return {"error": "AI personas not configured (missing ANTHROPIC_API_KEY)"}

    try:
        # Check if analysis already exists (unless force=true)
        if not force:
            existing = await get_spot_analysis(spot_slug, "swell_geometry_analyst")

            if existing:
                return {
                    "success": True,
                    "cached": True,
                    "message": "Analysis already exists (use force=true to regenerate)",
                    "analysis": existing
                }

        admin_email = user.get('email', 'unknown') if user else 'unknown'
        print(f"🤖 Admin {admin_email} generating AI analysis for spot: {spot_slug}...")

        # Generate AI analysis using spot characteristics
        result = await analyze_spot_ai(spot_slug)

        if not result.get('success'):
            return {
                "success": False,
                "error": result.get('error', 'Unknown error'),
                "spot_slug": spot_slug
            }

        # Save to database
        saved = await save_spot_analysis(
            spot_id=result['spot_id'],
            spot_slug=spot_slug,
            spot_name=result['spot_name'],
            lat=result['lat'],
            lon=result['lon'],
            analysis_data=result['analysis'],
            persona_type="swell_geometry_analyst",
            model_used=result.get('model', 'claude-3-haiku-20240307'),
            analysis_version="1.0"
        )

        if saved:
            print(f"✅ AI analysis saved for {result['spot_name']}")
            return {
                "success": True,
                "cached": False,
                "generated": True,
                "spot_slug": spot_slug,
                "analysis": saved
            }
        else:
            # Analysis generated but save failed
            return {
                "success": True,
                "cached": False,
                "generated": True,
                "save_failed": True,
                "warning": "Analysis generated but not saved to database",
                "spot_slug": spot_slug,
                "analysis": result
            }

    except Exception as e:
        print(f"❌ Error generating spot AI analysis: {e}")
        return {"error": str(e)}


@app.post("/api/spots/{spot_slug}/ai-analysis/generate-openai")
async def generate_spot_ai_analysis_openai(
    spot_slug: str,
    user: Dict = Depends(require_admin) if require_admin else None
):
    """
    Generate new AI-powered swell geometry analysis for a surf spot using OpenAI GPT-4.

    **Requires admin authentication.**

    Saves with persona_type='swell_geometry_analyst_openai' to coexist with Claude analysis.
    """
    if not analyze_spot_ai_openai:
        return {"error": "OpenAI personas not configured (missing OPENAI_API_KEY)"}

    try:
        admin_email = user.get('email', 'unknown') if user else 'unknown'
        print(f"🤖 Admin {admin_email} generating OpenAI analysis for spot: {spot_slug}...")

        # Generate AI analysis using OpenAI
        result = await analyze_spot_ai_openai(spot_slug)

        if not result.get('success'):
            return {
                "success": False,
                "error": result.get('error', 'Unknown error'),
                "spot_slug": spot_slug
            }

        # Save to database with openai persona_type
        saved = await save_spot_analysis(
            spot_id=result['spot_id'],
            spot_slug=spot_slug,
            spot_name=result['spot_name'],
            lat=result['lat'],
            lon=result['lon'],
            analysis_data=result['analysis'],
            persona_type="swell_geometry_analyst_openai",  # Different from Claude
            model_used="gpt-4o",
            analysis_version="1.0"
        )

        if saved:
            print(f"✅ OpenAI analysis saved for {result['spot_name']}")
            return {
                "success": True,
                "cached": False,
                "generated": True,
                "provider": "openai",
                "model": "gpt-4o",
                "spot_slug": spot_slug,
                "analysis": saved
            }
        else:
            return {
                "success": True,
                "generated": True,
                "save_failed": True,
                "warning": "Analysis generated but not saved to database",
                "spot_slug": spot_slug,
                "analysis": result
            }

    except Exception as e:
        print(f"❌ Error generating OpenAI spot analysis: {e}")
        return {"error": str(e)}


@app.post("/api/spots/ai-analysis/batch-generate")
async def batch_generate_spot_analyses(
    spot_slugs: List[str] = None,
    force: bool = False,
    user: Dict = Depends(require_admin) if require_admin else None
):
    """
    Generate AI analysis for multiple surf spots (background job).

    **Requires admin authentication.**

    Body params:
    - spot_slugs: List of spot slugs (if empty, analyzes all published spots)
    - force: Regenerate even if cached

    Returns immediately with job status. Analyses run in background.
    """
    if not analyze_spot_ai:
        return {"error": "AI personas not configured"}

    try:
        # Get list of spots to analyze
        if not spot_slugs:
            # Get all published spots
            result = supabase.table("spots") \
                .select("slug") \
                .eq("is_published", True) \
                .execute()

            if result.data:
                spot_slugs = [s['slug'] for s in result.data]
            else:
                return {"error": "No published spots found"}

        print(f"🚀 Starting batch AI analysis for {len(spot_slugs)} spots...")

        results = []

        for slug in spot_slugs:
            try:
                result = await generate_spot_ai_analysis(slug, force)
                results.append({
                    "spot_slug": slug,
                    "success": result.get('success', False),
                    "cached": result.get('cached', False)
                })

                # Brief delay to avoid rate limits
                await asyncio.sleep(1)

            except Exception as e:
                print(f"❌ Failed to analyze {slug}: {e}")
                results.append({
                    "spot_slug": slug,
                    "success": False,
                    "error": str(e)
                })

        successful = sum(1 for r in results if r['success'])

        return {
            "success": True,
            "total_requested": len(spot_slugs),
            "successful": successful,
            "failed": len(spot_slugs) - successful,
            "results": results
        }

    except Exception as e:
        print(f"❌ Batch generation error: {e}")
        return {"error": str(e)}