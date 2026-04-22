"""
MySurfLife Copilot — LLM orchestration engine.

Keeps all Claude API concerns isolated from FastAPI routing.
Tool execution is injected via a registry so this module has no
imports from main.py (avoids circular deps).

Usage (from main.py):
    from copilot import handle_chat
    result = await handle_chat(messages, context, tool_registry)
"""

import json
import os
import time
from typing import Any, Callable, Dict, List, Optional

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
                                    "session_log: post-session log form with rating dots and compare block."
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

## Artifact mapping — always include relevant artifacts
When you call a tool, pass its **full result object** as the artifact `data` field:
- get_spot_conditions result → artifact type "spot_summary"
- compare_spots result → artifact type "spot_comparison"
- get_conditions_window result → artifact type "conditions_timeline"
- Explanation of recommendation → artifact type "why" with {title, bullets: [{sign: "+"|"-", text}]}
- Board/wetsuit rec → artifact type "equipment" with {boards: [{name, is_primary, rationale, confidence, condition}], expect_note}
- Wind timeline → artifact type "wind_chart" with {spot_name, best_window, now_index, points: [{wind_mph, is_onshore, hour_label}]}
- Session log → artifact type "session_log" with {spot_name, date, duration_str, board, rating, wind_quality, wave_size, shape, crowd, fun_factor, compare: {predicted, actual, note}}
- calculate_swell_arrival result → artifact type "swell_arrival" (pass the full result)
Include artifact titles like "Cardiff Reef — Right Now" or "Forecast: Next 24h".

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
    return ""
