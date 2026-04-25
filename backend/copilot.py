"""
MySurfLife Copilot — LLM orchestration engine.

Keeps all Claude API concerns isolated from FastAPI routing.
Tool execution is injected via a registry so this module has no
imports from main.py (avoids circular deps).

Usage (from main.py):
    from copilot import handle_chat
    result = await handle_chat(messages, context, tool_registry)
"""

import asyncio
import json
import os
import time
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional

from anthropic import AsyncAnthropic

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = "claude-sonnet-4-6"
MAX_TOOL_ITERATIONS = 8  # prevent infinite loops

# ── Tool definitions ──────────────────────────────────────────────────────────

TOOL_DEFS: List[Dict] = [
    {
        "name": "get_spot_conditions",
        "description": (
            "Get current real-time surf conditions at a specific spot. "
            "Returns wave height, period, direction, wind speed/direction, "
            "surf quality score (0-10), and rating. Use this first for any "
            "question about current conditions at a named spot."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "spot_id": {
                    "type": "string",
                    "description": "Spot slug, e.g. 'blacks-beach', 'cardiff-reef', 'swamis'"
                }
            },
            "required": ["spot_id"]
        }
    },
    {
        "name": "get_conditions_window",
        "description": (
            "Get a forecast window showing how conditions will change over time at a spot. "
            "Returns hourly wave height, surf height, wind speed, and wind direction "
            "for the next N hours. Use this for questions about best time to surf, "
            "upcoming swell, or multi-hour planning."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "spot_id": {
                    "type": "string",
                    "description": "Spot slug"
                },
                "hours": {
                    "type": "integer",
                    "description": "How many hours to forecast (6-72). Default 24.",
                    "default": 24
                }
            },
            "required": ["spot_id"]
        }
    },
    {
        "name": "get_buoy_history",
        "description": (
            "Get recent buoy readings for a spot (last 24-48 hours). "
            "Shows actual observed wave height, period, and swell direction trend. "
            "Use this to understand recent swell trend or whether swell is building/dropping."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "spot_id": {
                    "type": "string",
                    "description": "Spot slug (used to look up primary buoy)"
                },
                "hours": {
                    "type": "integer",
                    "description": "Hours of history to return (12-48). Default 24.",
                    "default": 24
                }
            },
            "required": ["spot_id"]
        }
    },
    {
        "name": "compare_spots",
        "description": (
            "Compare current surf conditions at 2-5 spots side by side. "
            "Returns each spot's score, wave height, wind, and a recommendation "
            "for which is best right now. Use this when the user asks to compare spots "
            "or wants to know which of several options is best."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "spot_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of 2-5 spot slugs to compare",
                    "minItems": 2,
                    "maxItems": 5
                }
            },
            "required": ["spot_ids"]
        }
    },
    {
        "name": "rank_spots",
        "description": (
            "Rank all surf spots in a region by current conditions. "
            "Returns a sorted list of spots from best to worst right now. "
            "Use this when the user asks 'where should I surf?' or "
            "'what's the best spot in [area]?'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "region": {
                    "type": "string",
                    "description": (
                        "Region name, e.g. 'san-diego', 'orange-county', 'los-angeles', "
                        "'santa-barbara', 'central-coast', 'san-francisco', 'north-coast'. "
                        "Use null to rank all spots."
                    )
                }
            },
            "required": []
        }
    },
    {
        "name": "calculate_swell_arrival",
        "description": (
            "Calculate when a storm's swell will arrive at a surf spot and how big "
            "it will be, using the Stormsurf methodology (great circle distance, "
            "period-based travel speed, empirical decay tables). "
            "Use this when the user asks about an incoming swell, 'when will it hit', "
            "'how big will it be', or 'is there anything coming this week'. "
            "You must provide at least one storm position with lat, lon, timestamp, "
            "and sea_height_ft. If you don't know the storm position, ask the user "
            "or check WW3 model output first."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "spot_slug": {
                    "type": "string",
                    "description": "The spot slug to calculate arrivals for, e.g. 'blacks-beach'"
                },
                "storm_positions": {
                    "type": "array",
                    "description": "Storm positions from the wave model (1 or more)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "lat":           {"type": "number", "description": "Storm center latitude"},
                            "lon":           {"type": "number", "description": "Storm center longitude"},
                            "timestamp":     {"type": "string", "description": "ISO 8601 UTC timestamp of the storm position"},
                            "sea_height_ft": {"type": "number", "description": "Storm sea height in feet"},
                            "label":         {"type": "string", "description": "Optional label, e.g. 'NW Pacific storm'"},
                            "confirmed":     {"type": "boolean", "description": "Whether storm is confirmed by buoy observations"}
                        },
                        "required": ["lat", "lon", "timestamp", "sea_height_ft"]
                    },
                    "minItems": 1
                },
                "off_axis":    {"type": "boolean", "description": "Storm is >30° off great circle to spot (reduces size ×0.75)"},
                "small_fetch": {"type": "boolean", "description": "Storm has a small fetch area (reduces size ×0.75)"}
            },
            "required": ["spot_slug", "storm_positions"]
        }
    },
    {
        "name": "save_session",
        "description": (
            "Save a surf session to the user's session journal. "
            "Call this when the user describes a session they just completed or want to log. "
            "Extract all available details from the conversation. After saving, "
            "include a 'session_log' artifact in your respond call with saved=true. "
            "If the user is not authenticated, explain they need to sign in to save sessions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "spot_id":           {"type": "string", "description": "Spot slug, e.g. 'blacks-beach'"},
                "spot_name":         {"type": "string", "description": "Human-readable spot name"},
                "session_date":      {"type": "string", "description": "Date in YYYY-MM-DD format"},
                "duration_min":      {"type": "integer", "description": "Session duration in minutes"},
                "perceived_size":    {"type": "string", "description": "Subjective size description, e.g. '3-4ft', 'head high'"},
                "perceived_quality": {"type": "integer", "description": "Overall quality 1-10 (maps to rating)"},
                "perceived_wind":    {"type": "string", "description": "Wind description, e.g. 'offshore', 'light onshore'"},
                "perceived_crowd":   {"type": "integer", "description": "Crowd level 1-5 (1=empty, 5=packed)"},
                "waves_caught":      {"type": "integer", "description": "Number of waves caught"},
                "board_display":     {"type": "string", "description": "Board used, e.g. '6'2 shortboard'"},
                "perceived_note":    {"type": "string", "description": "Free-form session notes"},
            },
            "required": ["spot_id", "spot_name", "session_date"]
        }
    },
    {
        "name": "respond",
        "description": (
            "Submit your final answer to the user. Always call this tool last "
            "after gathering any data you need. Never skip this — it is required "
            "to deliver your response."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": (
                        "Conversational response to the user. Be specific with data: "
                        "mention actual wave heights, scores, timing. Keep it under 3 paragraphs."
                    )
                },
                "artifacts": {
                    "type": "array",
                    "description": "Structured data cards to render in the UI alongside your message.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": [
                                    "spot_summary", "spot_comparison", "conditions_timeline",
                                    "why", "equipment", "wind_chart", "session_log",
                                    "swell_arrival"
                                ],
                                "description": (
                                    "spot_summary: single-spot snapshot card with score ring and metrics. "
                                    "spot_comparison: side-by-side ranked table of 2+ spots. "
                                    "conditions_timeline: hourly forecast rows (wave/wind/tide). "
                                    "why: explanation panel — list of plus/minus bullet factors. "
                                    "equipment: board/wetsuit recommendation from user's quiver. "
                                    "wind_chart: SVG wind timeline with onshore shading. "
                                    "session_log: post-session log form with rating dots and compare block. Add saved=true when save_session succeeded."
                                )
                            },
                            "title": {"type": "string"},
                            "data": {
                                "type": "object",
                                "description": "The raw tool result data to render."
                            }
                        },
                        "required": ["type", "data"]
                    }
                },
                "follow_ups": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "2-3 short suggested follow-up questions the user might ask next.",
                    "maxItems": 3
                }
            },
            "required": ["message"]
        }
    }
]

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are the MySurfLife Copilot — a knowledgeable surf conditions assistant for California.

Your job is to help surfers decide where to surf, when conditions will be best, and what to expect.
Always fetch real data with tools before answering — never guess at wave heights or scores.

## Tool usage
- get_spot_conditions → use for any question about current conditions at a named spot.
- get_conditions_window → use when asked about best timing, upcoming swell, or hourly planning.
- compare_spots → use when given 2+ spots to compare.
- rank_spots → use when asked "where should I surf?" or "best spot in [region]?".
  NOTE: rank_spots region filtering requires the spots database to have primary_buoy_id populated
  (migration 007). If results are sparse, mention that more spot data may be loading.
- get_buoy_history → use when asked about recent trend, whether swell is building/dropping.

## CRITICAL: Live buoy vs. model data
The get_spot_conditions tool returns both `live_buoys` (actual NDBC observations) and
`model_data` (WW3 model estimates). These rules are non-negotiable:

1. **Current conditions = live buoy readings only.**
   When describing what it is like RIGHT NOW, always lead with `live_buoys` values.
   Report the actual buoy station name and its WVHT/period/direction directly.
   Example: "Buoy 46225 (Torrey Pines) is reading 4.2ft @ 14s from the NW."

2. **Forecast hours = model data.**
   Use get_conditions_window for anything in the future. Model data for hour 0
   is a cross-check, not the primary source.

3. **Flag model-vs-buoy divergence.**
   If the model at hour 0 shows significantly different wave height than the live buoy
   (>50% difference), call it out explicitly:
   "The WW3 model shows 6ft but buoy 46225 is only reading 3.5ft right now — the model
   may be picking up a swell that hasn't fully arrived yet, or it's overestimating."

4. **No data = say so.**
   If `has_live_buoy` is False, tell the user: "No live buoy readings available right
   now — conditions are model-estimated only, treat with caution."

5. **Minimum surf threshold.**
   If the `live_buoys` data shows wave_height_ft < 1.5ft, do not describe it as
   anything better than "essentially flat." Long-period energy below 1.5ft Hs does
   not produce meaningful surf at beach breaks regardless of what the swell category
   math might suggest.

## Example: correct buoy-vs-model reasoning
User: "How are conditions at Blacks right now?"

CORRECT response pattern:
→ Call get_spot_conditions("blacks-beach")
→ See live_buoys: [{id: "46225", wave_height_ft: 4.2, period_sec: 14, swell_dir: 310}]
→ See model_data: [{id: "WW3", wave_height_ft: 5.1}]
→ Say: "Buoy 46225 is reading 4.2ft @ 14s from 310° (NW). That's shoulder-to-head high at Blacks
   with the canyon amplification. Wind is light offshore at 8mph. Score: 7.2/10."
→ Note model divergence if significant: "WW3 is showing 5ft — if that leading energy
   fills in through the morning you could see it bump up another foot."

WRONG response pattern (causes overstatement):
→ Report WW3 model values as current conditions
→ Add canyon amplification on top of already-amplified model output

## Logging sessions
When a user describes a session they just had OR asks to log/record a session:
1. Extract all available details (spot, date, duration, size, quality, waves, board, notes).
2. If session_date is not given, use today's date.
3. Call save_session first to persist the entry.
4. Then call respond with a session_log artifact (set saved=true in the data).
5. If save_session returns an error about auth, tell the user to sign in to save sessions.
6. Keep the message warm and specific: mention actual conditions they described.

Examples of triggers: "just got back from a session at Swamis", "log my session today",
"/log 2h at Cardiff, head high, offshore", "I surfed Blacks this morning, caught 8 waves".

## Artifact mapping — always include relevant artifacts
When you call a tool, pass its **full result object** as the artifact `data` field:
- get_spot_conditions result → artifact type "spot_summary"
- compare_spots result → artifact type "spot_comparison"
- get_conditions_window result → artifact type "conditions_timeline"
- Explanation of recommendation → artifact type "why" with {title, bullets: [{sign: "+"|"-", text}]}
- Board/wetsuit rec → artifact type "equipment" with {boards: [{name, is_primary, rationale, confidence, condition}], expect_note}
- Wind timeline → artifact type "wind_chart" with {spot_name, best_window, now_index, points: [{wind_mph, is_onshore, hour_label}]}
- Session log → artifact type "session_log" with {spot_name, date, duration_str, board, rating, wind_quality, wave_size, shape, crowd, fun_factor, saved: true|false, compare: {predicted, actual, note}}
- calculate_swell_arrival result → artifact type "swell_arrival" (pass the full result)
Include artifact titles like "Cardiff Reef — Right Now" or "Forecast: Next 24h".

## Swell decomposition
When get_conditions_window returns timeline points with `swell_1`, `swell_2`, `swell_3`,
and/or `wind_sea` sub-objects, use them to describe conditions more precisely:
- `swell_1` = dominant swell partition (longest period, most energy, usually NW or WNW)
- `swell_2` = secondary swell (shorter period, different direction — cross-swell)
- `swell_3` = tertiary swell (minor background energy)
- `wind_sea` = locally generated chop (shortest period, messiest, kills shape when strong)
- Example: "3.2ft @ 15s from 305° NW (swell_1) + 1.8ft @ 9s from 250° W (swell_2) + 1.5ft @ 6s chop.
           The dominant NW is in the window for Cardiff — expect occasional head-high sets between
           the chop. Minus tide in the morning will help shape on the inside."
- If no swell_N keys are present (only combined wave data), describe it as "combined swell".
- Always lead with the highest-energy / longest-period swell partition when describing conditions.

## Response style
- Be specific: mention actual wave heights (ft), scores (/10), wind speed (mph), period (s).
- Translate buoy data: "4.2ft @ 14s NW = solid chest-to-head at Swamis".
- Keep it under 3 paragraphs. Surfers read on mobile.
- Always end by calling the respond tool with message + artifacts + 2-3 follow-ups.
- For spot comparisons, include a "why" artifact explaining the key decision factors.
- For "what board should I ride?" questions, use "equipment" artifact.
- For "when will the swell hit / how big will it be?" questions, use calculate_swell_arrival tool then show "swell_arrival" artifact.

Tone: knowledgeable surf local — direct, honest, data-backed. No hype if it's mediocre; genuine stoke if it's firing.
"""


# ── Chat handler ──────────────────────────────────────────────────────────────

async def handle_chat(
    messages: List[Dict[str, Any]],
    context: Optional[Dict[str, Any]],
    tool_registry: Dict[str, Callable],
) -> Dict[str, Any]:
    """
    Run the Copilot tool loop and return the final structured response.

    Args:
        messages:      List of {role, content} dicts (the conversation so far).
        context:       Optional {spot_id, region} from the frontend.
        tool_registry: Dict mapping tool name → async callable.

    Returns:
        {message: str, artifacts: list, follow_ups: list, tools_called: list}
    """
    if not ANTHROPIC_API_KEY:
        return {
            "message": "Copilot is not configured (missing ANTHROPIC_API_KEY).",
            "artifacts": [], "follow_ups": [], "tools_called": []
        }

    client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

    system = SYSTEM_PROMPT
    if context:
        if context.get("spot_id"):
            system += f"\n\nContext: the user is currently viewing the '{context['spot_id']}' spot page."
        elif context.get("region"):
            system += f"\n\nContext: the user is browsing the '{context['region']}' region."

    current_messages = list(messages)
    tools_called: List[Dict[str, Any]] = []

    for _ in range(MAX_TOOL_ITERATIONS):
        response = await client.messages.create(
            model=MODEL,
            max_tokens=1500,
            system=system,
            tools=TOOL_DEFS,
            messages=current_messages,
        )

        if response.stop_reason == "end_turn":
            text = " ".join(
                block.text for block in response.content
                if hasattr(block, "text")
            ).strip()
            return {
                "message": text or "I'm not sure how to help with that.",
                "artifacts": [], "follow_ups": [], "tools_called": tools_called
            }

        if response.stop_reason != "tool_use":
            break

        # Process tool calls
        tool_results = []
        respond_payload = None

        for block in response.content:
            if block.type != "tool_use":
                continue

            if block.name == "respond":
                respond_payload = block.input
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": "Response submitted."
                })
                continue

            # Execute data tool with timing
            tool_fn = tool_registry.get(block.name)
            t0 = time.monotonic()
            if tool_fn:
                try:
                    result = await tool_fn(**block.input)
                except Exception as e:
                    result = {"error": f"Tool {block.name} failed: {str(e)}"}
            else:
                result = {"error": f"Unknown tool: {block.name}"}
            ms = round((time.monotonic() - t0) * 1000)

            tools_called.append({
                "name": block.name,
                "params_summary": _params_summary(block.name, block.input),
                "ms": ms,
            })

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(result, default=str)
            })

        if respond_payload:
            return {
                "message": respond_payload.get("message", ""),
                "artifacts": respond_payload.get("artifacts", []),
                "follow_ups": respond_payload.get("follow_ups", []),
                "tools_called": tools_called,
            }

        current_messages = current_messages + [
            {"role": "assistant", "content": response.content},
            {"role": "user", "content": tool_results},
        ]

    return {
        "message": "I had trouble processing that request. Please try again.",
        "artifacts": [], "follow_ups": [], "tools_called": tools_called
    }


def _params_summary(name: str, inp: Dict[str, Any]) -> str:
    """Build a short human-readable summary of tool call params for the UI."""
    if name in ("get_spot_conditions", "get_buoy_history", "get_conditions_window"):
        parts = [inp.get("spot_id", "")]
        if "hours" in inp:
            parts.append(f"{inp['hours']}h")
        return " ".join(filter(None, parts))
    if name == "compare_spots":
        return ", ".join(inp.get("spot_ids", []))
    if name == "rank_spots":
        return inp.get("region") or "all regions"
    if name == "calculate_swell_arrival":
        slug = inp.get("spot_slug", "")
        n = len(inp.get("storm_positions", []))
        return f"{slug} · {n} storm{'s' if n != 1 else ''}"
    if name == "save_session":
        return f"{inp.get('spot_name', inp.get('spot_id', ''))} · {inp.get('session_date', '')}"
    return ""


# ── SSE streaming ─────────────────────────────────────────────────────────────

def _sse_event(data: Dict) -> str:
    return f"data: {json.dumps(data, default=str)}\n\n"


async def handle_chat_stream(
    messages: List[Dict[str, Any]],
    context: Optional[Dict[str, Any]],
    tool_registry: Dict[str, Callable],
) -> AsyncGenerator[str, None]:
    """
    Async generator yielding SSE data strings for streaming responses.

    Frame types:
      {"type":"tool_start","name":"...","params":"..."}
      {"type":"tool_done","name":"...","ms":123}
      {"type":"token","text":"..."}
      {"type":"done","artifacts":[...],"follow_ups":[...],"tools_called":[...]}
      {"type":"error","message":"..."}
    """
    if not ANTHROPIC_API_KEY:
        yield _sse_event({"type": "error", "message": "Sione is not configured (missing API key)."})
        return

    client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

    system = SYSTEM_PROMPT
    if context:
        if context.get("spot_id"):
            system += f"\n\nContext: the user is currently viewing the '{context['spot_id']}' spot page."
        elif context.get("region"):
            system += f"\n\nContext: the user is browsing the '{context['region']}' region."

    current_messages = list(messages)
    tools_called: List[Dict[str, Any]] = []

    for _ in range(MAX_TOOL_ITERATIONS):
        async with client.messages.stream(
            model=MODEL,
            max_tokens=2000,
            system=system,
            tools=TOOL_DEFS,
            messages=current_messages,
        ) as stream:
            # Stream text tokens as they arrive (present on end_turn steps)
            async for event in stream:
                if (event.type == "content_block_delta"
                        and hasattr(event.delta, "type")
                        and event.delta.type == "text_delta"
                        and event.delta.text):
                    yield _sse_event({"type": "token", "text": event.delta.text})

            final = await stream.get_final_message()

        if final.stop_reason == "end_turn":
            yield _sse_event({
                "type": "done",
                "artifacts": [],
                "follow_ups": [],
                "tools_called": tools_called,
            })
            return

        if final.stop_reason != "tool_use":
            break

        # Process tool calls in this turn
        tool_results = []
        respond_payload = None

        for block in final.content:
            if block.type != "tool_use":
                continue

            if block.name == "respond":
                respond_payload = block.input
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": "Response submitted.",
                })
                continue

            # Emit tool_start before executing
            yield _sse_event({
                "type": "tool_start",
                "name": block.name,
                "params": _params_summary(block.name, block.input),
            })

            tool_fn = tool_registry.get(block.name)
            t0 = time.monotonic()
            if tool_fn:
                try:
                    result = await tool_fn(**block.input)
                except Exception as e:
                    result = {"error": f"Tool {block.name} failed: {str(e)}"}
            else:
                result = {"error": f"Unknown tool: {block.name}"}
            ms = round((time.monotonic() - t0) * 1000)

            tools_called.append({
                "name": block.name,
                "params_summary": _params_summary(block.name, block.input),
                "ms": ms,
            })

            yield _sse_event({"type": "tool_done", "name": block.name, "ms": ms})

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(result, default=str),
            })

        if respond_payload:
            # Stream the respond message word-by-word so users see text appear
            msg = respond_payload.get("message", "")
            words = msg.split(" ")
            for i, word in enumerate(words):
                chunk = word + ("" if i == len(words) - 1 else " ")
                yield _sse_event({"type": "token", "text": chunk})
                await asyncio.sleep(0.018)  # ~55 words/sec — readable without feeling slow

            yield _sse_event({
                "type": "done",
                "artifacts": respond_payload.get("artifacts", []),
                "follow_ups": respond_payload.get("follow_ups", []),
                "tools_called": tools_called,
            })
            return

        current_messages = current_messages + [
            {"role": "assistant", "content": final.content},
            {"role": "user", "content": tool_results},
        ]

    yield _sse_event({
        "type": "error",
        "message": "I had trouble processing that request. Please try again.",
    })
