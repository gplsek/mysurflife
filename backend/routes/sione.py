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


# ── Storm-trip session assembly (shared by create + cross-worker rebuild) ───────

_OCEAN_PREFIX = {
    "np": "north-pacific", "na": "north-atlantic",
    "ep": "east-pacific",  "sp": "south-pacific",
}


def _ocean_from_id(storm_id: Optional[str]) -> Optional[str]:
    if not storm_id:
        return None
    return _OCEAN_PREFIX.get(storm_id.split("-")[0])


def _coerce_storm_obj(d: Optional[Dict]) -> Optional[Dict]:
    """Normalize a storm into the /active object shape.

    `get_storm_detail` returns either the object shape (in-memory cache / bulletin
    hits) or a derived_storms DB row (current_lat, peak_wind_kts, …). The opener and
    `format_storm_context_block` expect the object shape, so map DB rows across.
    """
    if not d:
        return None
    if d.get("lat") is not None or d.get("type") or d.get("ocean"):
        return d  # already object shape
    sid = d.get("storm_id") or d.get("id")
    return {
        "id":                  sid,
        "name":                d.get("basin_label") or d.get("name"),
        "source":              d.get("source"),
        "lat":                 d.get("current_lat"),
        "lon":                 d.get("current_lon"),
        "pressure_mb":         d.get("current_pressure_mb"),
        "wind_kts":            d.get("peak_wind_kts"),
        "warning_tier":        d.get("warning_tier"),
        "forecast_track":      d.get("forecast_track"),
        "region_impacts":      d.get("region_impacts"),
        "narrative":           d.get("narrative"),
        "ocean":               _ocean_from_id(sid),
        "peak_sea_m":          d.get("peak_sea_m"),
        "peak_period_s":       d.get("peak_period_s"),
        "swell_direction_deg": d.get("swell_direction_deg"),
        "raw_text":            d.get("raw_bulletin_text"),
    }


async def _load_storm_object(storm_id: str) -> Optional[Dict]:
    """Resolve a storm by id across all sources (DB → model cache → bulletin),
    normalized to the object shape. Worker-agnostic — every worker can reach the
    DB and the (6h-cached) bulletins."""
    try:
        from routes.storms import get_storm_detail
        detail = await get_storm_detail(storm_id)
        if detail and not detail.get("error"):
            return _coerce_storm_obj(detail)
    except Exception as e:
        print(f"⚠️  sione: _load_storm_object({storm_id}) failed: {e}")
    return None


async def _user_storm_ctx(user: Optional[Dict]) -> Optional[Dict]:
    """Personalized storm context (favorites) for a signed-in user; None otherwise."""
    if not user:
        return None
    try:
        from routes.favorites import _list as _list_favorites
        fav_slugs = await _list_favorites(user["user_id"])
        return await _fetch_user_storm_context(user["user_id"], fav_slugs)
    except Exception as e:
        print(f"⚠️  sione: could not fetch user context: {e}")
        return None


def _build_storm_session(mode: str, storm: Dict, arrivals: List[Dict],
                         user_ctx: Optional[Dict], now: float) -> Dict:
    """Assemble a session dict (opener + system_prompt_override) from a storm object."""
    from sione.openers.storm_trip import (
        generate_storm_trip_opener,
        format_storm_context_block,
        STORM_TRIP_SYSTEM_PROMPT,
    )
    opening_message     = generate_storm_trip_opener(storm, user_ctx, arrivals)
    storm_context_block = format_storm_context_block(storm, arrivals, user_ctx)
    return {
        "mode":                   mode,
        "storm":                  storm,
        "arrivals":               arrivals,
        "user_ctx":               user_ctx,
        "opening_message":        opening_message,
        "system_prompt_override": STORM_TRIP_SYSTEM_PROMPT + "\n\n" + storm_context_block,
        "created_at":             now,
    }


async def _rebuild_storm_session(ctx: Dict, user: Optional[Dict]) -> Optional[Dict]:
    """Reconstruct a storm_trip session when the in-memory session is missing —
    e.g. the chat request landed on a different uvicorn worker than the one that
    created the session, or the backend restarted. Resolves the storm by id from the
    DB/bulletin path (fresh), falling back to the storm object the client carried in
    context (covers bulletin-only storms not yet in derived_storms)."""
    carried  = ctx.get("storm")
    storm_id = ctx.get("storm_id") or (carried or {}).get("id")
    resolved = await _load_storm_object(storm_id) if storm_id else None
    storm    = resolved or carried
    if not storm or storm.get("lat") is None:
        return None
    arrivals = ctx.get("arrivals") or storm.get("arrivals") or []
    user_ctx = await _user_storm_ctx(user)
    return _build_storm_session("storm_trip", storm, arrivals, user_ctx, time.time())


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

    # Enrich context with session data when session_id is present.
    # Sessions are per-worker in-memory; with `uvicorn --workers 4` a follow-up chat
    # often lands on a different worker than the one that created the session (or the
    # backend restarted). On a miss, rebuild the storm_trip context from the DB/bulletin
    # so storm details are never silently lost, and cache it on this worker.
    ctx = dict(request.context or {})
    session_id = ctx.get("session_id")
    session = _sione_sessions.get(session_id) if session_id else None
    if not session and (ctx.get("storm") or ctx.get("storm_id")):
        session = await _rebuild_storm_session(ctx, user)
        if session and session_id:
            _sione_sessions[session_id] = session
    if session:
        ctx["session"] = session

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

    # Expire old sessions to avoid unbounded growth
    now = time.time()
    expired = [sid for sid, s in _sione_sessions.items() if now - s.get("created_at", 0) > _SESSION_TTL]
    for sid in expired:
        del _sione_sessions[sid]

    session_id = uuid.uuid4().hex[:12]
    storm      = request.storm or {}
    arrivals   = storm.get("arrivals") or []
    user_ctx   = await _user_storm_ctx(user)

    session = _build_storm_session(request.mode, storm, arrivals, user_ctx, now)
    _sione_sessions[session_id] = session

    print(f"✅ Sione session {session_id} created (mode={request.mode}, source={request.source})")
    return {
        "session_id":      session_id,
        "opening_message": session["opening_message"],
        "url":             f"/sione?session={session_id}",
    }
