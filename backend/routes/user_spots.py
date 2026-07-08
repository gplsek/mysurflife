"""
/api/user/spots — CRUD for user-created private spots.

GET    /api/user/spots          → {spots: [...]}
POST   /api/user/spots          → body → {spot: {...}}
PUT    /api/user/spots/{id}     → body → {spot: {...}}
DELETE /api/user/spots/{id}     → {ok: true}

After migration 022 (M3 convergence), private spots are ordinary rows in the
unified `spots` table with `owner_id` set and `visibility='private'`. They
inherit all of the scoring, characteristics, windows, and editor machinery
that public spots get. The synthetic `usr_<id>` slug is preserved so private
URLs stay stable; we don't try to mint friendly slugs because two users
naming their spot "Secret Reef" would collide on a unique global slug.
"""
import math
import uuid
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

try:
    from auth import require_auth
except ImportError:
    require_auth = None

try:
    from database import get_supabase_admin_client, supabase
except ImportError:
    get_supabase_admin_client = lambda: None
    supabase = None

try:
    from buoy_registry import get_all_buoys
except ImportError:
    get_all_buoys = None


def _client():
    return get_supabase_admin_client() or supabase


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _auto_buoy_blend(lat: float, lon: float, n: int = 3) -> Dict[str, Dict]:
    """Inverse-distance-weighted blend of the N closest registered buoys.

    Returns the shape spot_forecast_tuning.buoy_blend expects, e.g.
        {"46225": {"weight": 0.52, "role": "primary"},
         "46266": {"weight": 0.31, "role": "secondary"},
         "46259": {"weight": 0.17, "role": "tertiary"}}

    `role` is cosmetic ordering only — the scorer reads `weight` and ignores
    role names. We pick the top N by raw distance, then weight by 1/d² so
    very-near buoys dominate without completely starving secondaries.
    """
    if not get_all_buoys:
        return {}
    buoys = get_all_buoys() or []
    if not buoys:
        return {}
    scored = [(b, _haversine_km(lat, lon, b["lat"], b["lon"])) for b in buoys]
    scored.sort(key=lambda t: t[1])
    top = scored[:n]
    inv = [(b, 1.0 / max(d * d, 0.01)) for b, d in top]
    total = sum(w for _, w in inv) or 1.0
    roles = ["primary", "secondary", "tertiary"]
    return {
        b["id"]: {"weight": round(w / total, 3), "role": roles[i] if i < len(roles) else "extra"}
        for i, (b, w) in enumerate(inv)
    }


def _fmt(row: dict) -> dict:
    """Match the legacy shape so existing frontend keeps working."""
    chars = row.get("spot_characteristics") or {}
    if isinstance(chars, list):
        chars = chars[0] if chars else {}
    return {
        "id":          row["id"],
        "name":        row["name"],
        "latitude":    row["latitude"],
        "longitude":   row["longitude"],
        "break_type":  chars.get("break_type") if chars else None,
        "description": row.get("location_description"),
        "is_shared":   row.get("visibility") == "public",
        "created_at":  row.get("created_at"),
        "updated_at":  row.get("updated_at"),
        "is_user_spot": True,
        "slug":        row.get("slug") or f"usr_{row['id']}",
    }


async def _list(user_id: str) -> List[dict]:
    c = _client()
    if not c:
        return []
    resp = (
        c.table("spots")
         .select("*, spot_characteristics(break_type)")
         .eq("owner_id", user_id)
         .eq("visibility", "private")
         .order("created_at", desc=True)
         .execute()
    )
    return [_fmt(r) for r in (resp.data or [])]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/user/spots")
async def get_user_spots(
    user: Dict = Depends(require_auth) if require_auth else None,
):
    return {"spots": await _list(user["user_id"])}


class _SpotBody(BaseModel):
    name:        str = Field(..., min_length=1, max_length=120)
    latitude:    float
    longitude:   float
    break_type:  Optional[str] = None
    description: Optional[str] = None


@router.post("/api/user/spots")
async def create_user_spot(
    body: _SpotBody,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        raise HTTPException(status_code=500, detail="Database unavailable")

    # 1. Pre-allocate the id so we can set slug=usr_<id> in a single insert.
    spot_id = str(uuid.uuid4())
    slug = f"usr_{spot_id}"
    insert = (
        c.table("spots")
         .insert({
             "id":                   spot_id,
             "slug":                 slug,
             "name":                 body.name,
             "latitude":             body.latitude,
             "longitude":            body.longitude,
             "location_description": body.description,
             "region":               "Personal",
             "source":               "user",
             "owner_id":             user["user_id"],
             "visibility":           "private",
             "is_published":         False,
         })
         .execute()
    )
    if not insert.data:
        raise HTTPException(status_code=500, detail="Insert failed")
    row = insert.data[0]

    # 2. Always seed a characteristics row. `skill_level` is NOT NULL on the
    # table so we default to 'intermediate' for new private spots — the owner
    # tunes this (and break_type, etc.) later via the editor.
    chars_row = {
        "spot_id":     spot_id,
        "skill_level": "intermediate",
    }
    if body.break_type:
        chars_row["break_type"] = body.break_type
    c.table("spot_characteristics").insert(chars_row).execute()
    row["spot_characteristics"] = chars_row

    # 3. Auto buoy blend so /conditions works immediately. Owner can tune
    # later via the editor.
    blend = _auto_buoy_blend(body.latitude, body.longitude)
    if blend:
        c.table("spot_forecast_tuning").insert({
            "spot_id":    spot_id,
            "buoy_blend": blend,
        }).execute()

    return {"spot": _fmt(row)}


class _SpotPatch(BaseModel):
    name:        Optional[str] = None
    latitude:    Optional[float] = None
    longitude:   Optional[float] = None
    break_type:  Optional[str] = None
    description: Optional[str] = None


@router.put("/api/user/spots/{spot_id}")
async def update_user_spot(
    spot_id: str,
    body: _SpotPatch,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        raise HTTPException(status_code=500, detail="Database unavailable")

    # Map editable fields to the spots table.
    spot_patch = {}
    if body.name        is not None: spot_patch["name"] = body.name
    if body.latitude    is not None: spot_patch["latitude"] = body.latitude
    if body.longitude   is not None: spot_patch["longitude"] = body.longitude
    if body.description is not None: spot_patch["location_description"] = body.description

    if spot_patch:
        resp = (
            c.table("spots")
             .update(spot_patch)
             .eq("id", spot_id)
             .eq("owner_id", user["user_id"])
             .eq("visibility", "private")
             .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Spot not found")
        row = resp.data[0]
    else:
        # No spot-level change — just verify ownership before any side-edits.
        verify = (
            c.table("spots").select("*")
             .eq("id", spot_id)
             .eq("owner_id", user["user_id"])
             .eq("visibility", "private")
             .limit(1).execute()
        )
        if not verify.data:
            raise HTTPException(status_code=404, detail="Spot not found")
        row = verify.data[0]

    # break_type lives on spot_characteristics — upsert separately.
    if body.break_type is not None:
        c.table("spot_characteristics").upsert(
            {"spot_id": spot_id, "break_type": body.break_type},
            on_conflict="spot_id",
        ).execute()
        row["spot_characteristics"] = {"break_type": body.break_type}

    # If coords moved meaningfully, refresh the auto-buoy blend so /conditions
    # keeps pointing at sensible neighbors. Only when latitude or longitude
    # was actually patched.
    if body.latitude is not None or body.longitude is not None:
        blend = _auto_buoy_blend(row["latitude"], row["longitude"])
        if blend:
            c.table("spot_forecast_tuning").upsert(
                {"spot_id": spot_id, "buoy_blend": blend},
                on_conflict="spot_id",
            ).execute()

    return {"spot": _fmt(row)}


@router.delete("/api/user/spots/{spot_id}")
async def delete_user_spot(
    spot_id: str,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        raise HTTPException(status_code=500, detail="Database unavailable")

    # ON DELETE CASCADE on the child tables (characteristics, swell/wind
    # windows, forecast tuning) handles cleanup.
    c.table("spots").delete() \
        .eq("id", spot_id) \
        .eq("owner_id", user["user_id"]) \
        .eq("visibility", "private") \
        .execute()
    return {"ok": True}
