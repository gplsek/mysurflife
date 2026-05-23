"""routes/spot_config.py — read/write a spot's swell + wind windows (config editor B).

GET is public (powers the SwellWindRose visualization on SpotDetail).
PUT is admin-gated and authoritative: it replaces the spot's windows and tags them
source='human' (so a human edit always wins over generated geo/llm config).
"""
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

try:
    from auth import require_auth, optional_auth, is_admin
except ImportError:  # pragma: no cover
    require_auth = None
    optional_auth = None
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


def _spot_meta(client, slug: str):
    """Return (id, owner_id, visibility) for a spot, or None if it doesn't exist."""
    r = client.table("spots").select("id, owner_id, visibility").eq("slug", slug).maybe_single().execute()
    if not r or not r.data:
        return None
    return r.data["id"], r.data.get("owner_id"), r.data.get("visibility", "public")


def _can_edit(user, owner_id) -> bool:
    """A spot's windows are editable by an admin or by the spot's owner."""
    uid = (user or {}).get("user_id")
    return bool(uid) and (is_admin(uid) or (owner_id is not None and owner_id == uid))


@router.get("/api/spots/{slug}/windows")
async def get_spot_windows(
    slug: str,
    user: Optional[Dict] = Depends(optional_auth) if optional_auth else None,
):
    """Returns the spot's swell + wind windows for the rose visualization.

    Public spots are readable by anyone; a private spot's windows are visible only
    to its owner or an admin (otherwise 404 — don't reveal the spot exists). The
    admin client bypasses RLS, so this gate is enforced in code (M2).
    """
    from database import get_supabase_admin_client
    client = get_supabase_admin_client()
    if not client:
        raise HTTPException(503, "database unavailable")
    meta = _spot_meta(client, slug)
    if not meta:
        raise HTTPException(404, "spot not found")
    sid, owner_id, visibility = meta
    if visibility != "public" and not _can_edit(user, owner_id):
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
    """Replace the spot's windows with the supplied set (tagged 'human').

    Editable by an admin or by the spot's owner (private spots). The admin client
    bypasses RLS, so ownership is enforced in code (M2).
    """
    from database import get_supabase_admin_client
    client = get_supabase_admin_client()
    if not client:
        raise HTTPException(503, "database unavailable")
    meta = _spot_meta(client, slug)
    if not meta:
        raise HTTPException(404, "spot not found")
    sid, owner_id, _visibility = meta
    if not _can_edit(user, owner_id):
        raise HTTPException(403, "admin or owner privileges required")

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
