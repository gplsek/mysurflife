"""routes/copilot.py — Copilot chat endpoint and tool helpers."""
import asyncio
import functools
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

try:
    from auth import optional_auth, is_admin
except ImportError:
    optional_auth = None
    is_admin = None

try:
    from database import supabase
except ImportError:
    supabase = None

from copilot import handle_chat as _copilot_handle_chat

router = APIRouter()


class CopilotMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class CopilotChatRequest(BaseModel):
    messages: List[CopilotMessage]
    context: Optional[Dict[str, Any]] = None


# ── Tool helpers (called by the Copilot tool registry) ────────────────────────

async def _copilot_get_spot_conditions(spot_id: str, user_id: Optional[str] = None) -> Dict:
    """Fetch current scored conditions for a spot.

    user_id is propagated so private-spot owners can see their own spots —
    the underlying endpoint enforces admin || owner before reading any
    visibility='private' row.
    """
    try:
        from main import get_surf_spot_conditions  # temp: moves in Phase 4
        synthetic_user = {"user_id": user_id} if user_id else None
        result = await get_surf_spot_conditions(spot_id, user=synthetic_user)
        if "error" in result:
            return result

        # Separate live buoy readings from model data so the Copilot
        # can lead with observed data and flag model-only conditions.
        buoys_used = result.get("buoys_used", [])
        live_buoys  = [b for b in buoys_used if not b.get("is_model")]
        model_buoys = [b for b in buoys_used if b.get("is_model")]

        return {
            "spot_id":          spot_id,
            "spot_name":        result.get("spot_name"),
            "score":            result.get("overall_score"),
            "rating":           result.get("rating"),

            # Blended summary
            "wave_height_ft":   result.get("wave_height_ft"),
            "surf_height_ft":   result.get("surf_height_ft"),
            "period_sec":       result.get("period_sec"),
            "swell_direction":  result.get("swell_direction"),
            "wind_speed_mph":   result.get("wind_speed_mph"),
            "wind_direction":   result.get("wind_direction"),
            "confidence":       result.get("confidence"),

            # Raw live buoy readings — use these for "right now" reporting
            "live_buoys":       live_buoys,
            "model_data":       model_buoys,
            "has_live_buoy":    len(live_buoys) > 0,
            "data_note":        (
                "Live NDBC buoy observations" if live_buoys
                else "Model-only (no live buoy data)"
            ),
        }
    except Exception as e:
        return {"error": str(e), "spot_id": spot_id}


async def _copilot_get_conditions_window(spot_id: str, hours: int = 24, user_id: Optional[str] = None) -> Dict:
    """Fetch forecast timeline + tide data simplified for Copilot."""
    try:
        from tides import _resolve_station, fetch_tide_timeline, fetch_hilo
        from main import get_surf_spot_forecast_timeline  # temp: moves in Phase 4

        hours = max(6, min(hours, 72))
        synthetic_user = {"user_id": user_id} if user_id else None

        # Resolve tide station in parallel with forecast fetch
        station_id, _ = await _resolve_station(spot_id)

        now_utc = datetime.now(timezone.utc)
        tide_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        tide_end = tide_start + timedelta(days=max(4, hours // 24 + 2))

        result, tide_points, hilo_points = await asyncio.gather(
            get_surf_spot_forecast_timeline(spot_id, hours=hours, user=synthetic_user),
            fetch_tide_timeline(station_id, tide_start, tide_end),
            fetch_hilo(station_id, tide_start, tide_end),
            return_exceptions=True,
        )

        if isinstance(result, Exception):
            return {"error": str(result), "spot_id": spot_id}
        if "error" in result:
            return result

        # Build tide lookup keyed by CO-OPS wall-clock string "YYYY-MM-DD HH:00"
        # CO-OPS returns lst_ldt (Pacific local) so we convert UTC→Pacific (UTC-7 PDT approx)
        PACIFIC_OFFSET_H = -7
        now_pacific = now_utc + timedelta(hours=PACIFIC_OFFSET_H)
        tide_by_hour: Dict[str, Dict] = {}
        if isinstance(tide_points, list):
            for tp in tide_points:
                tide_by_hour[tp["t"]] = tp

        timeline = result.get("timeline", [])
        points = []
        for pt in timeline:
            wave = pt.get("wave") or {}
            wind = pt.get("wind") or {}
            target_pacific = now_pacific + timedelta(hours=pt.get("hour", 0))
            tide = tide_by_hour.get(target_pacific.strftime("%Y-%m-%d %H:00"))
            row: Dict = {
                "hour": pt.get("hour"),
                "wave_height_ft": wave.get("height_ft"),
                "surf_height_ft": wave.get("surf_height_ft"),
                "period_sec": wave.get("period"),
                "swell_direction": wave.get("direction"),
                "wind_speed_mph": wind.get("speed_mph"),
                "wind_direction": wind.get("direction"),
            }
            if tide:
                row["tide_ft"] = round(tide["v"], 1) if tide.get("v") is not None else None
                row["tide_state"] = tide.get("state")
            # Swell partition decomposition (present when GRIB parsed swell vars)
            for k in range(1, 4):
                key = f"swell_{k}"
                if wave.get(key):
                    row[key] = wave[key]
            if wave.get("wind_sea"):
                row["wind_sea"] = wave["wind_sea"]
            points.append(row)

        # Next 8 hi/lo events from now
        tide_hilo: list = []
        if isinstance(hilo_points, list):
            now_str = now_pacific.strftime("%Y-%m-%d %H:%M")
            tide_hilo = [h for h in hilo_points if h.get("t", "") >= now_str][:8]

        return {
            "spot_id": spot_id,
            "spot_name": result.get("spot_name"),
            "hours": hours,
            "points": points,
            "tide_hilo": tide_hilo,
        }
    except Exception as e:
        return {"error": str(e), "spot_id": spot_id}


async def _copilot_get_buoy_history(spot_id: str, hours: int = 24, user_id: Optional[str] = None) -> Dict:
    """Fetch recent buoy observations for a spot's primary buoy."""
    try:
        from main import get_buoy_history  # temp: moves in Phase 4

        hours = max(12, min(hours, 48))

        if not supabase:
            return {"error": "Database not configured"}

        # Admin client so private spots are reachable; gate visibility in code.
        from database import get_supabase_admin_client
        client = get_supabase_admin_client() or supabase

        rows = (
            client.table("spots")
                  .select("name, primary_buoy_id, owner_id, visibility, spot_forecast_tuning(buoy_blend)")
                  .eq("slug", spot_id).limit(1).execute().data or []
        )
        if not rows:
            return {"error": f"Spot '{spot_id}' not found"}
        spot = rows[0]

        if spot.get("visibility", "public") != "public":
            admin_ok = bool(user_id and is_admin and is_admin(user_id))
            if not (user_id and (admin_ok or spot.get("owner_id") == user_id)):
                return {"error": f"Spot '{spot_id}' not found"}
        station_id = spot.get("primary_buoy_id")

        # Fallback: use highest-weight buoy from blend
        if not station_id:
            tuning = spot.get("spot_forecast_tuning") or {}
            blend = tuning.get("buoy_blend") or {}
            if blend:
                station_id = max(
                    blend.keys(),
                    key=lambda k: (blend[k].get("weight", 0) if isinstance(blend[k], dict) else blend[k])
                )

        if not station_id:
            return {"error": f"No buoy mapped for spot '{spot_id}'"}

        history = await get_buoy_history(station_id, hours=hours)
        if "error" in history:
            return history

        readings = history.get("readings", [])
        simplified = [
            {
                "timestamp": r.get("timestamp"),
                "wave_height_ft": round(r["wave_height_m"] * 3.28084, 1) if r.get("wave_height_m") else None,
                "period_sec": r.get("dominant_period_sec"),
                "direction": r.get("mean_wave_dir"),
            }
            for r in readings if r.get("wave_height_m")
        ]

        return {
            "spot_id": spot_id,
            "spot_name": spot.get("name"),
            "station_id": station_id,
            "hours": hours,
            "readings": simplified,
        }
    except Exception as e:
        return {"error": str(e), "spot_id": spot_id}


async def _copilot_compare_spots(spot_ids: List[str], user_id: Optional[str] = None) -> Dict:
    """Fetch conditions for each spot and rank them. user_id flows through so
    an owner's private spots resolve inside comparisons, not just alone."""
    try:
        results = await asyncio.gather(
            *[_copilot_get_spot_conditions(sid, user_id=user_id) for sid in spot_ids],
            return_exceptions=True
        )

        spots = []
        for sid, r in zip(spot_ids, results):
            if isinstance(r, Exception):
                spots.append({"spot_id": sid, "error": str(r)})
            elif "error" in r:
                spots.append(r)
            else:
                spots.append(r)

        ranked = sorted(
            [s for s in spots if "score" in s and s["score"] is not None],
            key=lambda x: x["score"],
            reverse=True
        )
        # Append any errored spots at the end
        ranked += [s for s in spots if "score" not in s or s["score"] is None]

        best = ranked[0] if ranked else None
        summary = (
            f"{best['spot_name']} leads with a {best['score']}/10 ({best['rating']})."
            if best and "spot_name" in best
            else "Could not determine a best spot."
        )

        return {
            "ranked_spots": ranked,
            "best_spot_id": best["spot_id"] if best else None,
            "summary": summary,
        }
    except Exception as e:
        return {"error": str(e)}


async def _copilot_rank_spots(region: Optional[str] = None, user_id: Optional[str] = None) -> Dict:
    """Rank all spots in a region by current score."""
    try:
        if not supabase:
            return {"error": "Database not configured"}

        query = supabase.table("spots").select("slug, name, region").eq("is_published", True)
        if region:
            query = query.ilike("region", f"%{region.replace('-', ' ')}%")

        spot_result = query.limit(20).execute()
        if not spot_result.data:
            return {"error": f"No spots found for region '{region}'"}

        slugs = [s["slug"] for s in spot_result.data]
        conditions = await asyncio.gather(
            *[_copilot_get_spot_conditions(slug, user_id=user_id) for slug in slugs],
            return_exceptions=True
        )

        spots = []
        for slug, cond in zip(slugs, conditions):
            if isinstance(cond, Exception) or "error" in (cond or {}):
                continue
            if cond and cond.get("score") is not None:
                spots.append(cond)

        ranked = sorted(spots, key=lambda x: x["score"], reverse=True)

        return {
            "region": region,
            "ranked_spots": ranked[:10],
            "total_scored": len(ranked),
        }
    except Exception as e:
        return {"error": str(e)}


async def _copilot_calculate_swell_arrival(
    spot_slug: str,
    storm_positions: list,
    off_axis: bool = False,
    small_fetch: bool = False,
) -> Dict:
    """
    Calculate swell arrival times and decayed sizes for a spot.
    Resolves spot lat/lon from DB, then runs swell_physics calculations.
    """
    try:
        from swell_physics import swell_arrivals, format_arrival_summary, StormPosition
        from datetime import datetime, timezone

        # Resolve spot coordinates from DB
        spot_lat, spot_lon, spot_name = None, None, spot_slug
        if supabase:
            res = supabase.table("spots").select("latitude,longitude,name").eq("slug", spot_slug).maybe_single().execute()
            if res.data:
                spot_lat = res.data.get("latitude")
                spot_lon = res.data.get("longitude")
                spot_name = res.data.get("name", spot_slug)

        if spot_lat is None or spot_lon is None:
            return {"error": f"Could not resolve coordinates for spot '{spot_slug}'"}

        positions = []
        for p in storm_positions:
            try:
                ts = datetime.fromisoformat(str(p.get("timestamp", "")).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                ts = datetime.now(timezone.utc)
            positions.append(StormPosition(
                lat=float(p["lat"]),
                lon=float(p["lon"]),
                timestamp=ts,
                sea_height_ft=float(p["sea_height_ft"]),
                label=p.get("label", ""),
                confirmed=bool(p.get("confirmed", False)),
            ))

        arrivals = swell_arrivals(
            positions, spot_lat, spot_lon, spot_name,
            off_axis=off_axis, small_fetch=small_fetch,
        )
        narrative = format_arrival_summary(arrivals)

        return {
            "spot_name": spot_name,
            "narrative": narrative,
            "arrivals": [
                {
                    "storm_label":    a.storm_label,
                    "distance_nm":    a.distance_nm,
                    "max_period":     a.max_period,
                    "bearing_from_spot": a.bearing_from_spot,
                    "first_arrival": {
                        "period_s":       a.first_arrival.period_s,
                        "arrival_utc":    a.first_arrival.arrival_utc.isoformat(),
                        "swell_height_ft": a.first_arrival.swell_height_ft,
                    } if a.first_arrival else None,
                    "peak_arrival": {
                        "period_s":       a.peak_arrival.period_s,
                        "arrival_utc":    a.peak_arrival.arrival_utc.isoformat(),
                        "swell_height_ft": a.peak_arrival.swell_height_ft,
                    } if a.peak_arrival else None,
                    "bands": [
                        {
                            "period_s":       b.period_s,
                            "travel_hours":   b.travel_hours,
                            "arrival_utc":    b.arrival_utc.isoformat(),
                            "swell_height_ft": b.swell_height_ft,
                            "is_peak":        b.is_peak,
                        }
                        for b in a.bands
                    ],
                }
                for a in arrivals
            ],
        }
    except Exception as e:
        return {"error": str(e)}


async def _copilot_save_session(
    user_id: Optional[str],
    spot_id: str,
    spot_name: str,
    session_date: str,
    duration_min: Optional[int] = None,
    perceived_size: Optional[str] = None,
    perceived_quality: Optional[int] = None,
    perceived_wind: Optional[str] = None,
    perceived_crowd: Optional[int] = None,
    waves_caught: Optional[int] = None,
    board_display: Optional[str] = None,
    perceived_note: Optional[str] = None,
) -> Dict:
    """Persist a session entry on behalf of the Copilot tool loop."""
    if not user_id:
        return {"error": "Not authenticated — user must be signed in to save sessions."}

    try:
        from database import get_supabase_admin_client
        admin_client = get_supabase_admin_client()
        if not admin_client:
            return {"error": "Database unavailable"}

        row = {k: v for k, v in {
            "user_id":           user_id,
            "spot_id":           spot_id,
            "spot_name":         spot_name,
            "session_date":      session_date,
            "duration_min":      duration_min,
            "perceived_size":    perceived_size,
            "perceived_quality": perceived_quality,
            "perceived_wind":    perceived_wind,
            "perceived_crowd":   perceived_crowd,
            "waves_caught":      waves_caught,
            "board_display":     board_display,
            "perceived_note":    perceived_note,
            "log_method":        "copilot",
        }.items() if v is not None}

        result = admin_client.table("sessions").insert(row).execute()
        if not result.data:
            return {"error": "Failed to save session"}

        session = result.data[0]
        print(f"✅ Copilot session saved: {session['id']} — {spot_name} {session_date}")
        return {"success": True, "session_id": session["id"]}

    except Exception as e:
        print(f"❌ Copilot save_session error: {e}")
        return {"error": str(e)}


def _build_tool_registry(user_id: Optional[str]) -> Dict:
    """Build the tool registry dict for a given user_id.

    Spot-data tools accept user_id so private-spot owners can ask Sione about
    their own spots — including inside compare/rank, which fan out to the
    single-spot tool. Public spots work for anyone; private ones gate on
    owner_id == user_id with an is_admin bypass.
    """
    def _with_user(fn):
        # The tool dispatcher in copilot.py calls fn(**input). Wrap fn so a
        # bound user_id is injected automatically without leaking into the
        # tool's input schema.
        async def _inner(**kwargs):
            return await fn(user_id=user_id, **kwargs)
        return _inner

    return {
        "get_spot_conditions":       _with_user(_copilot_get_spot_conditions),
        "get_conditions_window":     _with_user(_copilot_get_conditions_window),
        "get_buoy_history":          _with_user(_copilot_get_buoy_history),
        "compare_spots":             _with_user(_copilot_compare_spots),
        "rank_spots":                _with_user(_copilot_rank_spots),
        "calculate_swell_arrival":   _copilot_calculate_swell_arrival,
        "save_session":              functools.partial(_copilot_save_session, user_id),
    }


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/api/copilot/chat")
async def copilot_chat(
    request: CopilotChatRequest,
    user: Optional[Dict] = Depends(optional_auth) if optional_auth else None,
):
    """
    Copilot chat endpoint.
    Accepts a message thread and optional context (spot_id, region).
    Returns {message, artifacts, follow_ups}.
    """
    try:
        user_id = user["user_id"] if user else None
        tool_registry = _build_tool_registry(user_id)

        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        result = await _copilot_handle_chat(messages, request.context, tool_registry)
        return result

    except Exception as e:
        print(f"❌ Copilot chat error: {e}")
        return {
            "message": "Something went wrong. Please try again.",
            "artifacts": [],
            "follow_ups": []
        }
