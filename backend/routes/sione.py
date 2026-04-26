"""routes/sione.py — Sione AI streaming chat and session endpoints."""
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    from auth import optional_auth
except ImportError:
    optional_auth = None

from services.state import _sione_sessions, _SESSION_TTL
from routes.copilot import CopilotChatRequest, _build_tool_registry

router = APIRouter()


class SioneSessionRequest(BaseModel):
    mode: str                        # "storm_trip" | future modes
    storm: Optional[Dict[str, Any]] = None
    source: Optional[str] = None    # "storm-card" | "arrival-row" | etc.


async def _fetch_user_storm_context(user_id: str, favorite_slugs: List[str]) -> Dict:
    """
    Build the personalized user context for a storm_trip session.
    Returns {favorite_slugs, favorite_names, home_region_label} or {} on error.
    """
    try:
        from database import get_supabase_admin_client, supabase as _sb
        c = get_supabase_admin_client() or _sb
        if not c or not favorite_slugs:
            return {"favorite_slugs": favorite_slugs, "favorite_names": {}}

        # Fetch spot names for the favorites
        spots_resp = (
            c.table("spots")
             .select("slug,name,region,subregion")
             .in_("slug", favorite_slugs)
             .execute()
        )
        name_map = {row["slug"]: row["name"] for row in (spots_resp.data or [])}

        # Best-effort home region: most common region in favorites
        regions = [row["region"] for row in (spots_resp.data or []) if row.get("region")]
        home_region_label = max(set(regions), key=regions.count) if regions else None

        return {
            "favorite_slugs": favorite_slugs,
            "favorite_names":  name_map,
            "home_region_label": home_region_label,
        }
    except Exception as e:
        print(f"⚠️  _fetch_user_storm_context: {e}")
        return {"favorite_slugs": favorite_slugs, "favorite_names": {}}


@router.post("/api/sione/chat")
async def sione_chat_stream(
    request: CopilotChatRequest,
    user: Optional[Dict] = Depends(optional_auth) if optional_auth else None,
):
    """
    Sione streaming chat endpoint.
    Returns text/event-stream SSE frames: token | tool_start | tool_done | done | error
    """
    import json
    from copilot import handle_chat_stream

    user_id = user["user_id"] if user else None
    tool_registry = _build_tool_registry(user_id)

    messages = [{"role": m.role, "content": m.content} for m in request.messages]

    # Enrich context with session data when session_id is present
    ctx = dict(request.context or {})
    session_id = ctx.get("session_id")
    if session_id and session_id in _sione_sessions:
        ctx["session"] = _sione_sessions[session_id]

    async def generate():
        try:
            async for chunk in handle_chat_stream(messages, ctx, tool_registry):
                yield chunk
        except Exception as e:
            print(f"❌ Sione stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': 'Something went wrong. Please try again.'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/api/sione/sessions")
async def create_sione_session(
    request: SioneSessionRequest,
    user: Optional[Dict] = Depends(optional_auth) if optional_auth else None,
):
    """
    Create a Sione session and return a pre-rendered opening message.

    For mode=storm_trip the caller passes the storm object (from /api/storms/active)
    including an `arrivals` key populated from /api/storms/{id}/arrivals.
    The backend assembles the opener from templates — no LLM call, zero latency.
    """
    import uuid
    from sione.openers.storm_trip import (
        generate_storm_trip_opener,
        format_storm_context_block,
        STORM_TRIP_SYSTEM_PROMPT,
    )

    # Expire old sessions to avoid unbounded growth
    now = time.time()
    expired = [sid for sid, s in _sione_sessions.items() if now - s.get("created_at", 0) > _SESSION_TTL]
    for sid in expired:
        del _sione_sessions[sid]

    session_id = uuid.uuid4().hex[:12]
    storm      = request.storm or {}
    arrivals   = storm.get("arrivals") or []

    # Fetch user context if signed in
    user_ctx: Optional[Dict] = None
    if user:
        try:
            from routes.favorites import _list as _list_favorites
            fav_slugs = await _list_favorites(user["user_id"])
            user_ctx  = await _fetch_user_storm_context(user["user_id"], fav_slugs)
        except Exception as e:
            print(f"⚠️  sessions: could not fetch user context: {e}")

    opening_message = generate_storm_trip_opener(storm, user_ctx, arrivals)

    # Build a system prompt override that includes the storm data block
    storm_context_block = format_storm_context_block(storm, arrivals, user_ctx)
    system_prompt_override = STORM_TRIP_SYSTEM_PROMPT + "\n\n" + storm_context_block

    _sione_sessions[session_id] = {
        "mode":                   request.mode,
        "storm":                  storm,
        "arrivals":               arrivals,
        "user_ctx":               user_ctx,
        "opening_message":        opening_message,
        "system_prompt_override": system_prompt_override,
        "created_at":             now,
    }

    print(f"✅ Sione session {session_id} created (mode={request.mode}, source={request.source})")
    return {
        "session_id":      session_id,
        "opening_message": opening_message,
        "url":             f"/sione?session={session_id}",
    }
