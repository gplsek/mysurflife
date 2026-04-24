from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Optional
from datetime import datetime

router = APIRouter()

try:
    from database import supabase, get_supabase_admin_client
except ImportError:
    supabase = None
    get_supabase_admin_client = lambda: None

try:
    from auth import optional_auth
except ImportError:
    optional_auth = None


class SessionCreateRequest(BaseModel):
    spot_id: str
    spot_name: str
    session_date: str
    start_time: Optional[str] = None
    duration_min: Optional[int] = None
    perceived_size: Optional[str] = None
    perceived_quality: Optional[int] = None
    perceived_wind: Optional[str] = None
    perceived_crowd: Optional[int] = None
    waves_caught: Optional[int] = None
    board_display: Optional[str] = None
    perceived_note: Optional[str] = None
    log_method: str = "manual"


def _session_to_row(session: Dict) -> Dict:
    """Normalize a DB session row to the shape SessionJournal.jsx expects."""
    quality = session.get("perceived_quality")
    return {
        "id":                session.get("id"),
        "date":              session.get("session_date"),
        "spot":              session.get("spot_name"),
        "spot_id":           session.get("spot_id"),
        "rating":            min(5, round(quality / 2)) if quality else 0,
        "perceived_quality": quality,
        "duration":          session.get("duration_min"),
        "waves":             session.get("waves_caught"),
        # actual conditions (populated by background job after logging)
        "swell":             session.get("actual_wvht_ft"),
        "wind":              session.get("actual_wspd_mph"),
        # perceived / subjective labels
        "size":              session.get("perceived_size"),
        "wind_label":        session.get("perceived_wind"),
        "note":              session.get("perceived_note"),
        "board":             session.get("board_display"),
        "start_time":        session.get("start_time"),
        "log_method":        session.get("log_method"),
        "created_at":        session.get("created_at"),
    }


@router.post("/api/sessions")
async def create_session(
    body: SessionCreateRequest,
    user: Optional[Dict] = Depends(optional_auth) if optional_auth else None,
):
    """Create a new surf session log entry."""
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not supabase:
        return {"error": "Database not configured"}

    try:
        admin_client = get_supabase_admin_client()
        if not admin_client:
            return {"error": "Database admin client unavailable"}

        row = {k: v for k, v in {
            "user_id":           user["user_id"],
            "spot_id":           body.spot_id,
            "spot_name":         body.spot_name,
            "session_date":      body.session_date,
            "start_time":        body.start_time,
            "duration_min":      body.duration_min,
            "perceived_size":    body.perceived_size,
            "perceived_quality": body.perceived_quality,
            "perceived_wind":    body.perceived_wind,
            "perceived_crowd":   body.perceived_crowd,
            "waves_caught":      body.waves_caught,
            "board_display":     body.board_display,
            "perceived_note":    body.perceived_note,
            "log_method":        body.log_method,
        }.items() if v is not None}

        result = admin_client.table("sessions").insert(row).execute()
        if not result.data:
            return {"error": "Failed to create session"}

        session = result.data[0]
        print(f"✅ Session logged: {session['id']} — {body.spot_name} {body.session_date}")
        return {"success": True, "session": _session_to_row(session)}

    except Exception as e:
        print(f"❌ Create session error: {e}")
        return {"error": str(e)}


@router.get("/api/sessions")
async def list_sessions(
    limit: int = 50,
    offset: int = 0,
    spot_id: Optional[str] = None,
    user: Optional[Dict] = Depends(optional_auth) if optional_auth else None,
):
    """List the authenticated user's sessions, newest first."""
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not supabase:
        return {"error": "Database not configured"}

    try:
        client = get_supabase_admin_client() or supabase
        if not client:
            return {"sessions": [], "total": 0, "limit": limit, "offset": offset}

        query = (
            client.table("sessions")
            .select("*")
            .eq("user_id", user["user_id"])
            .order("session_date", desc=True)
            .limit(limit)
            .offset(offset)
        )
        if spot_id:
            query = query.eq("spot_id", spot_id)

        result = query.execute()
        rows = result.data or []
        return {
            "sessions": [_session_to_row(r) for r in rows],
            "total":    len(rows),
            "limit":    limit,
            "offset":   offset,
        }

    except Exception as e:
        print(f"❌ List sessions error: {e}")
        return {"error": str(e)}
