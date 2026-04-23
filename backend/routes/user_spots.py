"""
/api/user/spots — CRUD for user-created private spots.

GET    /api/user/spots          → {spots: [...]}
POST   /api/user/spots          → body → {spot: {...}}
PUT    /api/user/spots/{id}     → body → {spot: {...}}
DELETE /api/user/spots/{id}     → {ok: true}

All endpoints require a valid JWT. Spots are private by default (is_shared=false).
"""
from typing import Dict, Optional

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


def _client():
    return get_supabase_admin_client() or supabase


def _fmt(row: dict) -> dict:
    return {
        "id":          row["id"],
        "name":        row["name"],
        "latitude":    row["latitude"],
        "longitude":   row["longitude"],
        "break_type":  row.get("break_type"),
        "description": row.get("description"),
        "is_shared":   row.get("is_shared", False),
        "created_at":  row.get("created_at"),
        "updated_at":  row.get("updated_at"),
        "is_user_spot": True,
        # Synthetic slug for map/detail routing
        "slug":        f"usr_{row['id']}",
    }


async def _list(user_id: str):
    c = _client()
    if not c:
        return []
    resp = (
        c.table("user_spots")
        .select("*")
        .eq("user_id", user_id)
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

    resp = (
        c.table("user_spots")
        .insert({
            "user_id":     user["user_id"],
            "name":        body.name,
            "latitude":    body.latitude,
            "longitude":   body.longitude,
            "break_type":  body.break_type,
            "description": body.description,
        })
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=500, detail="Insert failed")
    return {"spot": _fmt(resp.data[0])}


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

    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")

    resp = (
        c.table("user_spots")
        .update(patch)
        .eq("id", spot_id)
        .eq("user_id", user["user_id"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Spot not found")
    return {"spot": _fmt(resp.data[0])}


@router.delete("/api/user/spots/{spot_id}")
async def delete_user_spot(
    spot_id: str,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        raise HTTPException(status_code=500, detail="Database unavailable")

    c.table("user_spots").delete().eq("id", spot_id).eq("user_id", user["user_id"]).execute()
    return {"ok": True}
