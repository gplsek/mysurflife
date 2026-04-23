"""
/api/map/bundle — single endpoint powering the map page.

Returns spots (with pre-baked ratings), buoys, storms, and user favorites
in one parallel-fetched, 60s-cached response. p95 target: <400ms.
"""
import asyncio
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends

router = APIRouter()

try:
    from auth import optional_auth
except ImportError:
    optional_auth = None

try:
    from database import get_supabase_admin_client, supabase
except ImportError:
    get_supabase_admin_client = lambda: None
    supabase = None

try:
    from buoy_service import get_map_buoys
except ImportError:
    async def get_map_buoys():
        return []

try:
    from high_seas import get_high_seas
    from routes.storms import load_storms_config, _storm_id, _format_label, _OCEAN_KEYS, _SURF_TYPES
    from high_seas import _format_type
    _STORMS_AVAILABLE = True
except ImportError:
    _STORMS_AVAILABLE = False

_bundle_cache: Dict = {}
_BUNDLE_TTL = 60  # seconds


# ── Component fetchers ────────────────────────────────────────────────────────

async def _fetch_spots() -> List[Dict]:
    """Spots LEFT JOIN spot_ratings — returns map-bundle shape."""
    try:
        admin = get_supabase_admin_client()
        client = admin or supabase
        if not client:
            return []

        # spots table
        spots_resp = client.table("spots").select(
            "slug, name, region, subregion, latitude, longitude"
        ).execute()
        spots = {s["slug"]: s for s in (spots_resp.data or [])}

        # spot_ratings table
        ratings_resp = client.table("spot_ratings").select(
            "spot_slug, rating, primary_swell_ft, primary_period_s, "
            "primary_swell_dir, wind_mph, wind_dir, water_temp_f, computed_at"
        ).execute()
        ratings = {r["spot_slug"]: r for r in (ratings_resp.data or [])}

        out = []
        for slug, spot in spots.items():
            r = ratings.get(slug, {})
            region_str = ", ".join(
                filter(None, [spot.get("subregion"), spot.get("region")])
            ) or ""
            out.append({
                "slug":      slug,
                "name":      spot["name"],
                "region":    region_str,
                "latitude":  spot["latitude"],
                "longitude": spot["longitude"],
                "rating":  r.get("rating"),        # 0-5; None if not yet rated
                "swell":   r.get("primary_swell_ft"),
                "period":  r.get("primary_period_s"),
                "wind":    r.get("wind_mph"),
                "water":   r.get("water_temp_f"),
                "rated_at": r.get("computed_at"),
            })
        return out
    except Exception as e:
        print(f"❌ map/bundle: spots fetch failed: {e}")
        return []


async def _fetch_storms() -> tuple:
    """Returns (storm_list, freshness_str)."""
    if not _STORMS_AVAILABLE:
        return [], None
    try:
        cfg = load_storms_config()
        min_pressure_mb = cfg.get("min_pressure_mb", 1020)
        min_wind_kts    = cfg.get("min_wind_kts", 0)
        include_highs   = cfg.get("include_highs", False)
        ocean_list      = [o for o in cfg.get("oceans", _OCEAN_KEYS) if o in _OCEAN_KEYS]

        out = []
        freshness = []

        for ocean in ocean_list:
            hs = await get_high_seas(ocean)
            if hs.get("issued_utc"):
                freshness.append(hs["issued_utc"])
            for s in hs.get("systems", []):
                sys_type = s.get("type", "").upper()
                if sys_type == "HIGH" and not include_highs:
                    continue
                if sys_type not in _SURF_TYPES and sys_type != "HIGH":
                    continue
                if s.get("pressure_mb") and s["pressure_mb"] > min_pressure_mb:
                    continue
                if s.get("wind_kts") and s["wind_kts"] < min_wind_kts:
                    continue

                basin = s.get("basin_label") or hs.get("label", ocean.replace("-", " ").title())
                out.append({
                    "id":            _storm_id(ocean, s["lat"], s["lon"]),
                    "type":          sys_type,
                    "name":          f"{_format_type(sys_type)} · {basin}",
                    "lat":           s["lat"],
                    "lon":           s["lon"],
                    "pressure_mb":   s.get("pressure_mb"),
                    "wind_kts":      s.get("wind_kts"),
                    "sea_height_ft": s.get("sea_height_ft"),
                    "sea_range_ft":  s.get("sea_range_ft"),
                    "movement":      s.get("movement"),
                    "warning_tier":  s.get("warning_tier", "none"),
                    "fetch":         s.get("fetch"),
                    "forecast_track": s.get("forecast_track"),
                    "label":         _format_label(s),
                    "issued_utc":    hs.get("issued_utc"),
                    "raw_text":      s.get("raw_text"),
                    "ocean":         ocean,
                })

        updated = max(freshness) if freshness else None
        return out, updated
    except Exception as e:
        print(f"⚠️  map/bundle: storms fetch failed: {e}")
        return [], None


async def _fetch_buoys() -> tuple:
    """Returns (buoy_list, freshness_str)."""
    try:
        buoys = await get_map_buoys()
        return buoys, None
    except Exception as e:
        print(f"⚠️  map/bundle: buoys fetch failed: {e}")
        return [], None


async def _get_favorites(user: Optional[Dict]) -> List[str]:
    if not user:
        return []
    try:
        user_id = user.get("user_id")
        client = get_supabase_admin_client() or supabase
        if not client or not user_id:
            return []
        resp = client.table("user_favorites").select("spot_id").eq("user_id", user_id).execute()
        return [r["spot_id"] for r in (resp.data or [])]
    except Exception as e:
        print(f"⚠️  map/bundle: favorites fetch failed: {e}")
        return []


async def _fetch_user_spots(user: Optional[Dict]) -> List[Dict]:
    """Returns the authenticated user's private spots, shaped for the map bundle."""
    if not user:
        return []
    try:
        user_id = user.get("user_id")
        client = get_supabase_admin_client() or supabase
        if not client or not user_id:
            return []
        resp = (
            client.table("user_spots")
            .select("id, name, latitude, longitude, break_type, description, is_shared, created_at")
            .eq("user_id", user_id)
            .execute()
        )
        return [
            {
                "slug":        f"usr_{r['id']}",
                "name":        r["name"],
                "latitude":    r["latitude"],
                "longitude":   r["longitude"],
                "break_type":  r.get("break_type"),
                "description": r.get("description"),
                "is_shared":   r.get("is_shared", False),
                "is_user_spot": True,
                "region":      "My Spots",
                "rating":      None,
            }
            for r in (resp.data or [])
        ]
    except Exception as e:
        print(f"⚠️  map/bundle: user_spots fetch failed: {e}")
        return []


# ── Bundle endpoint ───────────────────────────────────────────────────────────

@router.get("/api/map/bundle")
async def get_map_bundle(
    include_storms: bool = True,
    include_buoys:  bool = True,
    user: Optional[Dict] = Depends(optional_auth) if optional_auth else None,
):
    """
    One-shot map data endpoint. Aggregates spots+ratings, buoys, storms,
    and user favorites in parallel. Cached 60s (user favorites excluded).
    """
    now = time.time()

    # Serve cached shared data (sans per-user data) if fresh
    cached = _bundle_cache.get("data")
    if cached and (now - _bundle_cache.get("ts", 0)) < _BUNDLE_TTL:
        favorites, user_spots = await asyncio.gather(
            _get_favorites(user), _fetch_user_spots(user)
        )
        spots = [
            {**s, "fav": s["slug"] in favorites}
            for s in cached["spots"]
        ]
        return {
            **cached,
            "spots":      spots,
            "user_spots": user_spots,
            "user":       {"favorites": favorites},
            "cached":     True,
        }

    async def _empty():
        return [], None

    # Parallel fetch of all components
    storms_coro  = _fetch_storms() if include_storms else _empty()
    buoys_coro   = _fetch_buoys()  if include_buoys  else _empty()
    spots_coro   = _fetch_spots()

    (spots, (storms, storms_ts), (buoys, buoys_ts)) = await asyncio.gather(
        spots_coro, storms_coro, buoys_coro,
        return_exceptions=False,
    )

    # Normalize exceptions from gather (if return_exceptions were True)
    if isinstance(spots,  Exception): spots  = []
    if isinstance(storms, Exception): storms = []
    if isinstance(buoys,  Exception): buoys  = []

    updated_at = storms_ts or None

    shared = {
        "spots":      spots,
        "buoys":      buoys,
        "storms":     storms,
        "updated_at": updated_at,
        "components": {
            "storms_freshness": storms_ts,
            "buoys_freshness":  buoys_ts,
            "spots_freshness":  None,  # driven by spot_ratings.computed_at
        },
        "cached": False,
    }

    _bundle_cache["data"] = shared
    _bundle_cache["ts"]   = now

    favorites, user_spots = await asyncio.gather(
        _get_favorites(user), _fetch_user_spots(user)
    )
    spots_with_favs = [{**s, "fav": s["slug"] in favorites} for s in spots]

    return {
        **shared,
        "spots":      spots_with_favs,
        "user_spots": user_spots,
        "user":       {"favorites": favorites},
    }
