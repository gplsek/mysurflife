"""
/api/storms/active          — live storm positions for the map page.
/api/storms/{id}/arrivals   — swell arrival forecast per surf region.

Wraps high_seas.py bulletin parsing and storm_arrivals.py physics.
"""
import asyncio
import json
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from high_seas import get_high_seas, _format_type
from storm_arrivals import compute_arrivals

router = APIRouter()

_SURF_TYPES = {"LOW", "TROPICAL STORM", "TROPICAL DEPRESSION", "HURRICANE", "TYPHOON"}

_OCEAN_KEYS = ["north-pacific", "north-atlantic", "south-pacific"]

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "storms_config.json"

_DEFAULT_CONFIG = {
    "min_pressure_mb": 1020,
    "min_wind_kts":    0,
    "include_highs":   False,
    "oceans":          _OCEAN_KEYS,
}


def load_storms_config() -> dict:
    try:
        return json.loads(_CONFIG_PATH.read_text())
    except Exception:
        return _DEFAULT_CONFIG.copy()


def save_storms_config(cfg: dict) -> None:
    _CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


def _storm_id(ocean: str, lat: float, lon: float) -> str:
    prefix = {"north-pacific": "np", "north-atlantic": "na", "south-pacific": "sp"}.get(ocean, ocean[:2])
    return f"{prefix}-{lat:.1f}-{abs(lon):.1f}"


def _format_label(s: dict) -> str:
    parts = []
    if s.get("pressure_mb"):
        parts.append(f"{s['pressure_mb']} mb")
    if s.get("wind_kts"):
        parts.append(f"{s['wind_kts']} kt")
    if s.get("sea_height_ft"):
        parts.append(f"{s['sea_height_ft']}ft seas")
    return " · ".join(parts) if parts else "—"


@router.get("/api/storms/active")
async def get_active_storms(
    oceans: Optional[str]  = Query(None, description="Comma-separated ocean keys (overrides config)"),
    min_wind_kts: Optional[int]  = Query(None, description="Min wind kt (overrides config)"),
    min_pressure_mb: Optional[int] = Query(None, description="Max central pressure mb (overrides config)"),
    include_highs: Optional[bool]  = Query(None, description="Include HIGH systems (overrides config)"),
):
    """
    Returns a flat list of active storm/low-pressure systems suitable for
    map markers and the StormCard. Aggregates from all requested ocean basins.
    Filters are read from /config/storms_config.json; query params override per-request.
    Cached at the bulletin level (TTL 3–6h in high_seas.py).
    """
    cfg = load_storms_config()

    # Query params override config when explicitly provided
    if min_pressure_mb is None:
        min_pressure_mb = cfg.get("min_pressure_mb", 1020)
    if min_wind_kts is None:
        min_wind_kts = cfg.get("min_wind_kts", 0)
    if include_highs is None:
        include_highs = cfg.get("include_highs", False)

    if oceans is not None:
        ocean_list = [o.strip() for o in oceans.split(",") if o.strip() in _OCEAN_KEYS]
    else:
        ocean_list = [o for o in cfg.get("oceans", _OCEAN_KEYS) if o in _OCEAN_KEYS]
    if not ocean_list:
        ocean_list = _OCEAN_KEYS

    out = []
    freshness = []

    for ocean in ocean_list:
        hs = await get_high_seas(ocean)
        if hs.get("issued_utc"):
            freshness.append(hs["issued_utc"])

        for s in hs.get("systems", []):
            sys_type = s.get("type", "").upper()

            # Type filter
            if sys_type == "HIGH" and not include_highs:
                continue
            if sys_type not in _SURF_TYPES and sys_type != "HIGH":
                continue

            # Pressure filter (lower pressure = stronger storm)
            if s.get("pressure_mb") and s["pressure_mb"] > min_pressure_mb:
                continue

            # Wind filter
            if s.get("wind_kts") and s["wind_kts"] < min_wind_kts:
                continue

            basin  = s.get("basin_label") or hs.get("label", ocean.replace("-", " ").title())
            name   = f"{_format_type(sys_type)} · {basin}"
            storm_id = _storm_id(ocean, s["lat"], s["lon"])

            out.append({
                "id":             storm_id,
                "type":           sys_type,
                "name":           name,
                "lat":            s["lat"],
                "lon":            s["lon"],
                "pressure_mb":    s.get("pressure_mb"),
                "wind_kts":       s.get("wind_kts"),
                "sea_height_ft":  s.get("sea_height_ft"),
                "sea_range_ft":   s.get("sea_range_ft"),
                "movement":       s.get("movement"),
                "warning_tier":   s.get("warning_tier", "none"),
                "fetch":          s.get("fetch"),
                "forecast_track": s.get("forecast_track"),
                "label":          _format_label(s),
                "issued_utc":     hs.get("issued_utc"),
                "raw_text":       s.get("raw_text"),
            })

    updated_at = max(freshness) if freshness else None

    return {
        "storms":     out,
        "count":      len(out),
        "updated_at": updated_at,
        "cached":     True,
    }


# ── Storm arrivals ────────────────────────────────────────────────────────────

_OCEAN_PREFIX = {"np": "north-pacific", "na": "north-atlantic", "sp": "south-pacific"}


async def _find_storm(storm_id: str) -> Optional[dict]:
    """Look up a storm from the high_seas cache by its encoded ID."""
    prefix = storm_id.split("-")[0]
    ocean  = _OCEAN_PREFIX.get(prefix)
    if not ocean:
        # Unknown prefix — search all oceans
        oceans = list(_OCEAN_PREFIX.values())
    else:
        oceans = [ocean]

    for o in oceans:
        hs = await get_high_seas(o)
        for s in hs.get("systems", []):
            if _storm_id(o, s["lat"], s["lon"]) == storm_id:
                return {**s, "ocean": o, "issued_utc": hs.get("issued_utc")}
    return None


async def _fetch_db_spots():
    """Fetch spots + current ratings for arrivals spot breakdown."""
    try:
        from database import get_supabase_admin_client, supabase
        client = get_supabase_admin_client() or supabase
        if not client:
            return []
        spots_resp   = client.table("spots").select(
            "slug, name, region, subregion, latitude, longitude"
        ).execute()
        ratings_resp = client.table("spot_ratings").select(
            "spot_slug, rating, wind_mph"
        ).execute()
        ratings = {r["spot_slug"]: r for r in (ratings_resp.data or [])}
        out = []
        for s in (spots_resp.data or []):
            r = ratings.get(s["slug"], {})
            out.append({**s, "rating": r.get("rating"), "wind_mph": r.get("wind_mph")})
        return out
    except Exception as e:
        print(f"⚠️  storms/arrivals: DB fetch failed: {e}")
        return []


@router.get("/api/storms/{storm_id}/arrivals")
async def get_storm_arrivals(storm_id: str):
    """
    Compute swell arrival forecast for a specific storm.

    Returns {arrivals: [...]} with one entry per reachable surf region
    (peak_ft ≥ 3 ft). Each entry includes a spot breakdown.
    """
    storm, db_spots = await asyncio.gather(
        _find_storm(storm_id),
        _fetch_db_spots(),
    )

    if storm is None:
        # Storm ID not found in current bulletins — may have dissipated
        return {"arrivals": [], "storm_id": storm_id, "note": "storm not found in current bulletins"}

    arrivals = compute_arrivals(storm, db_spots)

    return {
        "arrivals":   arrivals,
        "storm_id":   storm_id,
        "computed_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }
