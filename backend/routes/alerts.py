"""
/api/alerts — CRUD for per-user surf condition alerts.

GET    /api/alerts               → {alerts: [...]}
POST   /api/alerts               → body {spot_id, spot_name, condition_text, channel} → {alert: {...}}
PATCH  /api/alerts/{id}          → body {active} → {alert: {...}}
DELETE /api/alerts/{id}          → {ok: true}

All endpoints require a valid JWT.
"""
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

router = APIRouter()

try:
    from auth import require_auth
except ImportError:
    require_auth = None

try:
    from database import get_supabase_admin_client
except ImportError:
    get_supabase_admin_client = lambda: None


def _client():
    return get_supabase_admin_client()


def _shape(row: Dict) -> Dict:
    return {
        "id":           row.get("id"),
        "spot":         row.get("spot_name") or row.get("spot_id"),
        "spot_id":      row.get("spot_id"),
        "condition":    row.get("condition_text"),
        "channel":      row.get("channel", "push"),
        "active":       row.get("active", True),
        "ai":           row.get("ai_generated", False),
        "lastTriggered": row.get("last_triggered"),
        "created_at":   row.get("created_at"),
    }


@router.get("/api/alerts")
async def get_alerts(
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        return {"alerts": []}
    resp = (
        c.table("user_alerts")
        .select("*")
        .eq("user_id", user["user_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return {"alerts": [_shape(r) for r in (resp.data or [])]}


class _CreateBody(BaseModel):
    spot_id:        str
    spot_name:      Optional[str] = None
    condition_text: str
    channel:        Optional[str] = "push"


@router.post("/api/alerts")
async def create_alert(
    body: _CreateBody,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        raise HTTPException(status_code=500, detail="Database unavailable")

    resp = c.table("user_alerts").insert({
        "user_id":        user["user_id"],
        "spot_id":        body.spot_id,
        "spot_name":      body.spot_name,
        "condition_text": body.condition_text,
        "channel":        body.channel or "push",
        "active":         True,
    }).execute()

    if not resp.data:
        raise HTTPException(status_code=500, detail="Insert failed")
    return {"alert": _shape(resp.data[0])}


class _PatchBody(BaseModel):
    active: bool


@router.patch("/api/alerts/{alert_id}")
async def toggle_alert(
    alert_id: str,
    body: _PatchBody,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        raise HTTPException(status_code=500, detail="Database unavailable")

    resp = (
        c.table("user_alerts")
        .update({"active": body.active})
        .eq("id", alert_id)
        .eq("user_id", user["user_id"])
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"alert": _shape(resp.data[0])}


@router.delete("/api/alerts/{alert_id}")
async def delete_alert(
    alert_id: str,
    user: Dict = Depends(require_auth) if require_auth else None,
):
    c = _client()
    if not c:
        raise HTTPException(status_code=500, detail="Database unavailable")

    c.table("user_alerts").delete().eq("id", alert_id).eq("user_id", user["user_id"]).execute()
    return {"ok": True}
