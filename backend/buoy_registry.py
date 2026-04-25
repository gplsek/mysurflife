"""
Buoy registry - loads buoy metadata from Supabase database.
Falls back to hardcoded list if database unavailable.
"""

from typing import List, Dict, Optional
from database import supabase

# Hardcoded fallback buoy list (used if database unavailable)
FALLBACK_BUOY_LIST = [
    # Southern California (San Diego County)
    {"id": "46266", "lat": 32.933, "lon": -117.317, "name": "Del Mar Nearshore", "wind_fallback": "LJAC1"},
    {"id": "46225", "lat": 32.866, "lon": -117.283, "name": "Torrey Pines Outer", "wind_fallback": "LJAC1"},
    {"id": "46259", "lat": 32.749, "lon": -117.258, "name": "Mission Bay", "wind_fallback": "SDBC1"},
    {"id": "46232", "lat": 32.517, "lon": -117.425, "name": "Point Loma South", "wind_fallback": "SDBC1"},
    {"id": "46236", "lat": 32.55,  "lon": -117.15,  "name": "Imperial Beach", "wind_fallback": "TIXC1"},

    # Southern California (Orange/LA County)
    {"id": "46224", "lat": 33.178, "lon": -117.472, "name": "Oceanside Offshore", "wind_fallback": "SDBC1"},
    {"id": "46275", "lat": 33.291, "lon": -117.501, "name": "Red Beach Nearshore", "wind_fallback": "SDBC1"},
    {"id": "46277", "lat": 33.336, "lon": -117.659, "name": "Green Beach Offshore", "wind_fallback": "SDBC1"},
    {"id": "46285", "lat": 33.445, "lon": -117.68,  "name": "Capistrano Beach", "wind_fallback": "SDBC1"},
    {"id": "46258", "lat": 33.475, "lon": -118.533, "name": "San Pedro Channel", "wind_fallback": "LJAC1"},
    {"id": "46222", "lat": 33.75,  "lon": -118.833, "name": "Santa Monica Basin", "wind_fallback": "AGXC1"},
    {"id": "46086", "lat": 32.504, "lon": -118.029, "name": "San Clemente Basin", "wind_fallback": "SDBC1"},
    {"id": "46025", "lat": 33.749, "lon": -119.053, "name": "Santa Monica Offshore", "wind_fallback": "AGXC1"},
    {"id": "46069", "lat": 33.67,  "lon": -120.21,  "name": "San Nicolas Island", "wind_fallback": None},

    # Central California
    {"id": "46053", "lat": 34.245, "lon": -120.015, "name": "Santa Barbara", "wind_fallback": None},
    {"id": "46011", "lat": 34.935, "lon": -121.93,  "name": "Santa Maria", "wind_fallback": None},
    {"id": "46054", "lat": 35.167, "lon": -120.983, "name": "Point Buchon (SLO)", "wind_fallback": None},
    {"id": "46028", "lat": 35.741, "lon": -121.884, "name": "Cape San Martin", "wind_fallback": None},
    {"id": "46012", "lat": 36.75,  "lon": -122.43,  "name": "Monterey Bay", "wind_fallback": "MEYC1"},

    # Northern California
    {"id": "46026", "lat": 37.75,  "lon": -122.83,  "name": "San Francisco Bar", "wind_fallback": "FTPC1"},
    {"id": "46013", "lat": 38.24,  "lon": -123.31,  "name": "Bodega Bay", "wind_fallback": "PRYC1"},
    {"id": "46014", "lat": 39.22,  "lon": -123.97,  "name": "Pt. Arena", "wind_fallback": None},
    {"id": "46022", "lat": 40.713, "lon": -124.531, "name": "Eel River (Humboldt)", "wind_fallback": None},
    {"id": "46027", "lat": 40.75,  "lon": -124.5,   "name": "Cape Mendocino", "wind_fallback": None},

    # Pacific Northwest (Oregon)
    {"id": "46050", "lat": 44.656, "lon": -124.524, "name": "Newport, OR", "wind_fallback": None},
    {"id": "46089", "lat": 45.866, "lon": -124.003, "name": "Tillamook, OR", "wind_fallback": None},
    {"id": "46029", "lat": 46.144, "lon": -124.511, "name": "Columbia River, OR", "wind_fallback": None},

    # Pacific Northwest (Washington)
    {"id": "46041", "lat": 47.353, "lon": -124.731, "name": "Cape Elizabeth, WA", "wind_fallback": None},

    # Offshore Pacific
    {"id": "46002", "lat": 42.614, "lon": -130.516, "name": "Oregon Offshore", "wind_fallback": None},
    # 46005 (Washington Offshore) decommissioned — covered by 46041 + 46002

    # Hawaii (Popular surf spots)
    {"id": "51001", "lat": 23.445, "lon": -162.279, "name": "NW Hawaii", "wind_fallback": None},
    {"id": "51002", "lat": 17.208, "lon": -157.754, "name": "South of Oahu", "wind_fallback": None},
    {"id": "51202", "lat": 21.414, "lon": -157.681, "name": "Mokapu Point, Oahu", "wind_fallback": None},
    {"id": "51004", "lat": 17.531, "lon": -152.363, "name": "SE Oahu", "wind_fallback": None},
    {"id": "51101", "lat": 22.183, "lon": -159.481, "name": "Hanalei, Kauai", "wind_fallback": None},
    {"id": "51211", "lat": 21.297, "lon": -157.959, "name": "Pearl Harbor Entrance, Oahu", "wind_fallback": None},
]

# Cache for buoy list to avoid repeated database queries
_buoy_cache: Optional[List[Dict]] = None


def load_buoys_from_db() -> List[Dict]:
    """
    Load active buoys from Supabase database.
    Returns list of buoy dicts with keys: id, lat, lon, name, wind_fallback
    """
    global _buoy_cache

    # Return cached list if available
    if _buoy_cache is not None:
        return _buoy_cache

    # Try loading from database
    if supabase:
        try:
            result = supabase.table("buoys") \
                .select("id, name, latitude, longitude, wind_fallback_station, region") \
                .eq("active", True) \
                .order("region", desc=False) \
                .order("latitude", desc=True) \
                .execute()

            if result.data:
                # Convert database format to application format
                buoys = []
                for row in result.data:
                    buoys.append({
                        "id": row["id"],
                        "lat": row["latitude"],
                        "lon": row["longitude"],
                        "name": row["name"],
                        "wind_fallback": row.get("wind_fallback_station")
                    })

                _buoy_cache = buoys
                print(f"✅ Loaded {len(buoys)} buoys from database")
                return buoys

        except Exception as e:
            print(f"⚠️  Failed to load buoys from database: {e}")
            print("⚠️  Falling back to hardcoded buoy list")

    # Fallback to hardcoded list
    print(f"⚠️  Using fallback buoy list ({len(FALLBACK_BUOY_LIST)} buoys)")
    _buoy_cache = FALLBACK_BUOY_LIST
    return FALLBACK_BUOY_LIST


def get_buoy_by_id(buoy_id: str) -> Optional[Dict]:
    """Get buoy metadata by ID."""
    buoys = load_buoys_from_db()
    for buoy in buoys:
        if buoy["id"] == buoy_id:
            return buoy
    return None


def get_all_buoys() -> List[Dict]:
    """Get all active buoys."""
    return load_buoys_from_db()


def refresh_buoy_cache():
    """Force refresh of buoy cache from database."""
    global _buoy_cache
    _buoy_cache = None
    return load_buoys_from_db()