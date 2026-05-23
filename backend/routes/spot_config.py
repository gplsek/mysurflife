"""routes/spot_config.py — read/write a spot's swell + wind windows (config editor B).

GET is public (powers the SwellWindRose visualization on SpotDetail).
PUT is admin-gated and authoritative: it replaces the spot's windows and tags them
source='human' (so a human edit always wins over generated geo/llm config).
"""
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

try:
    from auth import require_auth, is_admin
except ImportError:  # pragma: no cover
    require_auth = None
    def is_admin(_uid):  # type: ignore
        return False

router = APIRouter()


def _wrap(v: int) -> int:
    return int(v) % 360


class SwellWindow(BaseModel):
    dir_min: int
    dir_max: int
    weight: float = 1.0
    period_min_sec: Optional[int] = 8

    @field_validator("dir_min", "dir_max")
    @classmethod
    def _wrap_dir(cls, v):
        return _wrap(v)

    @field_validator("weight")
    @classmethod
    def _clamp_w(cls, v):
        return max(0.0, min(1.0, float(v)))


class WindWindow(BaseModel):
    category: str = "offshore"
    dir_min: int
    dir_max: int
    max_mph: Optional[int] = 15
    weight: float = 1.0

    @field_validator("dir_min", "dir_max")
    @classmethod
    def _wrap_dir(cls, v):
        return _wrap(v)

    @field_validator("weight")
    @classmethod
    def _clamp_w(cls, v):
        return max(0.0, min(1.0, float(v)))


class WindowsPayload(BaseModel):
    swell: List[SwellWindow] = []
    wind: List[WindWindow] = []


def _spot_id(client, slug: str) -> Optional[str]:
    r = client.table("spots").select("id").eq("slug", slug).single().execute()
    return r.data["id"] if r.data else None


@router.get("/api/spots/{slug}/windows")
async def get_spot_windows(slug: str):
    """Public — returns the spot's swell + wind windows for the rose visualization."""
    from database import get_supabase_admin_client
    client = get_supabase_admin_client()
    if not client:
        raise HTTPException(503, "database unavailable")
    sid = _spot_id(client, slug)
    if not sid:
        raise HTTPException(404, "spot not found")
    swell = client.table("spot_swell_windows").select("*").eq("spot_id", sid).execute().data or []
    wind  = client.table("spot_wind_windows").select("*").eq("spot_id", sid).execute().data or []
    return {"slug": slug, "swell": swell, "wind": wind}


@router.put("/api/spots/{slug}/windows")
async def put_spot_windows(
    slug: str,
    payload: WindowsPayload,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    """Admin-only. Replace the spot's windows with the supplied set (tagged 'human')."""
    if not user or not is_admin(user.get("user_id")):
        raise HTTPException(403, "admin privileges required")
    from database import get_supabase_admin_client
    client = get_supabase_admin_client()
    if not client:
        raise HTTPException(503, "database unavailable")
    sid = _spot_id(client, slug)
    if not sid:
        raise HTTPException(404, "spot not found")

    swell_rows = [{**w.model_dump(), "spot_id": sid, "source": "human"} for w in payload.swell]
    wind_rows  = [{**w.model_dump(), "spot_id": sid, "source": "human"} for w in payload.wind]

    # Authoritative replace.
    client.table("spot_swell_windows").delete().eq("spot_id", sid).execute()
    client.table("spot_wind_windows").delete().eq("spot_id", sid).execute()
    if swell_rows:
        client.table("spot_swell_windows").insert(swell_rows).execute()
    if wind_rows:
        client.table("spot_wind_windows").insert(wind_rows).execute()

    return {"slug": slug, "swell": swell_rows, "wind": wind_rows, "saved": True}
