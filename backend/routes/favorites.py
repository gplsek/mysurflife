"""
/api/user/favorites — CRUD for per-user favorited spots.

GET    /api/user/favorites          → {favorites: ["slug1", ...]}
POST   /api/user/favorites          → body {slug} → {favorites: [...]}
DELETE /api/user/favorites/{slug}   → {favorites: [...]}

All endpoints require a valid JWT (Authorization: Bearer <token>).
The service-role client bypasses RLS so the insert/delete works server-side.
"""
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

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


async def _list(user_id: str) -> List[str]:
    c = _client()
    if not c:
        return []
    resp = c.table("user_favorites").select("spot_id").eq("user_id", user_id).order("sort_order").execute()
    return [r["spot_id"] for r in (resp.data or [])]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/user/favorites")
async def get_favorites(
    user: Dict = Depends(require_auth) if require_auth else None,
):
    return {"favorites": await _list(user["user_id"])}


class _FavBody(BaseModel):
    slug: str


@router.post("/api/user/favorites")
async def add_favorite(
    body: _FavBody,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        raise HTTPException(status_code=500, detail="Database unavailable")

    user_id = user["user_id"]

    # Next sort position
    existing = (
        c.table("user_favorites")
        .select("sort_order")
        .eq("user_id", user_id)
        .order("sort_order", desc=True)
        .limit(1)
        .execute()
    )
    next_order = (existing.data[0]["sort_order"] + 1) if existing.data else 1

    c.table("user_favorites").upsert(
        {"user_id": user_id, "spot_id": body.slug, "sort_order": next_order},
        on_conflict="user_id,spot_id",
    ).execute()

    return {"favorites": await _list(user_id)}


@router.delete("/api/user/favorites/{slug}")
async def remove_favorite(
    slug: str,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        raise HTTPException(status_code=500, detail="Database unavailable")

    user_id = user["user_id"]
    c.table("user_favorites").delete().eq("user_id", user_id).eq("spot_id", slug).execute()

    return {"favorites": await _list(user_id)}
