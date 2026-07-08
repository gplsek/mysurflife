"""
/api/map/bundle — single endpoint powering the map page.

Returns spots (with pre-baked ratings), buoys, storms, and user favorites
in one parallel-fetched, 60s-cached response. p95 target: <400ms.
"""
import asyncio
import math
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends

router = APIRouter()

try:
    from auth import optional_auth
except ImportError:
    optional_auth = None

try:
    from database import get_supabase_admin_client, supabase, only_public_spots
except ImportError:
    get_supabase_admin_client = lambda: None
    supabase = None
    only_public_spots = lambda q: q

try:
    from buoy_service import get_map_buoys
except ImportError:
    async def get_map_buoys():
        return []

try:
    from routes.storms import get_active_storms
    _STORMS_AVAILABLE = True
except ImportError:
    _STORMS_AVAILABLE = False

_bundle_cache: Dict = {}
_BUNDLE_TTL = 60  # seconds


def _sanitize(obj: Any) -> Any:
    """Recursively replace NaN/Inf with None for JSON serialization."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj


# ── Component fetchers ────────────────────────────────────────────────────────

async def _fetch_spots() -> tuple:
    """Spots LEFT JOIN spot_ratings — returns (spot_list, spots_freshness_str)."""
    try:
        admin = get_supabase_admin_client()
        client = admin or supabase
        if not client:
            return [], None

        # spots table — public catalog only (admin client bypasses RLS; M2 gate)
        spots_resp = only_public_spots(
            client.table("spots").select(
                "slug, name, region, subregion, latitude, longitude"
            )
        ).execute()
        spots = {s["slug"]: s for s in (spots_resp.data or [])}

        # spot_ratings table
        ratings_resp = client.table("spot_ratings").select(
            "spot_slug, rating, primary_swell_ft, primary_period_s, "
            "primary_swell_dir, wind_mph, wind_dir, water_temp_f, computed_at"
        ).execute()
        ratings = {r["spot_slug"]: r for r in (ratings_resp.data or [])}
        spots_freshness = max(
            (r["computed_at"] for r in ratings.values() if r.get("computed_at")),
            default=None,
        )

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
                "rating":    r.get("rating"),        # 0-5; None if not yet rated
                "swell":     r.get("primary_swell_ft"),
                "swell_dir": r.get("primary_swell_dir"),
                "period":    r.get("primary_period_s"),
                "wind":      r.get("wind_mph"),
                "wind_dir":  r.get("wind_dir"),
                "water":     r.get("water_temp_f"),
                "rated_at":  r.get("computed_at"),
            })
        return out, spots_freshness
    except Exception as e:
        print(f"❌ map/bundle: spots fetch failed: {e}")
        return [], None


async def _fetch_storms() -> tuple:
    """Returns (storm_list, freshness_str) via the shared get_active_storms pipeline."""
    if not _STORMS_AVAILABLE:
        return [], None
    try:
        result = await get_active_storms(
            oceans=None, min_wind_kts=None, max_pressure_mb=None, include_highs=None
        )
        storms = result.get("storms", [])
        updated_at = result.get("updated_at")
        return storms, updated_at
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
    """Returns the authenticated user's private spots, shaped for the map bundle.

    After M3 convergence private spots are ordinary rows in `spots` with
    visibility='private'. We pull break_type from the joined characteristics
    so the existing 'My Spots' card on the map shows it.
    """
    if not user:
        return []
    try:
        user_id = user.get("user_id")
        client = get_supabase_admin_client() or supabase
        if not client or not user_id:
            return []
        resp = (
            client.table("spots")
            .select("id, slug, name, latitude, longitude, location_description, created_at, "
                    "spot_characteristics(break_type)")
            .eq("owner_id", user_id)
            .eq("visibility", "private")
            .execute()
        )
        out = []
        for r in (resp.data or []):
            chars = r.get("spot_characteristics") or {}
            if isinstance(chars, list):
                chars = chars[0] if chars else {}
            out.append({
                "slug":        r.get("slug") or f"usr_{r['id']}",
                "name":        r["name"],
                "latitude":    r["latitude"],
                "longitude":   r["longitude"],
                "break_type":  chars.get("break_type"),
                "description": r.get("location_description"),
                "is_shared":   False,
                "is_user_spot": True,
                "region":      "My Spots",
                "rating":      None,
            })
        return out
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

    (spots, spots_ts), (storms, storms_ts), (buoys, buoys_ts) = await asyncio.gather(
        spots_coro, storms_coro, buoys_coro,
        return_exceptions=False,
    )

    # Normalize exceptions from gather (if return_exceptions were True)
    if isinstance(spots,  Exception): spots  = []
    if isinstance(storms, Exception): storms = []
    storms = _sanitize(storms)
    if isinstance(buoys,  Exception): buoys  = []

    updated_at = storms_ts or spots_ts or None

    shared = {
        "spots":      spots,
        "buoys":      buoys,
        "storms":     storms,
        "updated_at": updated_at,
        "components": {
            "storms_freshness": storms_ts,
            "buoys_freshness":  buoys_ts,
            "spots_freshness":  spots_ts,
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
