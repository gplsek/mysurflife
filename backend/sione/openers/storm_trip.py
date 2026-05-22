"""
storm_trip.py — Template-driven opening message for storm_trip Sione sessions.

Zero LLM calls. Assembled from storm data + user context. Returns a string
that the sessions endpoint sends back immediately on click.
"""
from __future__ import annotations
from typing import Dict, List, Optional

_TYPE_LABELS = {
    "LOW":                  "low pressure system",
    "TROPICAL_DEPRESSION":  "tropical depression",
    "TROPICAL_STORM":       "tropical storm",
    "HURRICANE":            "hurricane",
    "TYPHOON":              "typhoon",
    "HIGH":                 "high pressure system",
}

_BASIN_LABELS = {
    "north-pacific":  "the North Pacific",
    "north-atlantic": "the North Atlantic",
    "east-pacific":   "the East Pacific",
    "south-pacific":  "the South Pacific",
    "south-atlantic": "the South Atlantic",
    "south-indian":   "the South Indian Ocean",
    "north-indian":   "the North Indian Ocean",
}

# Tiers we consider "impactful enough to mention"
_RELEVANT_TIERS = {"firing", "solid", "good", "fair"}

# Fetch quadrant → swell arrives from opposite direction
_OPPOSITE = {
    "N": "S", "S": "N", "E": "W", "W": "E",
    "NE": "SW", "SW": "NE", "NW": "SE", "SE": "NW",
    "NNE": "SSW", "SSW": "NNE", "NNW": "SSE", "SSE": "NNW",
    "ENE": "WSW", "WSW": "ENE", "ESE": "WNW", "WNW": "ESE",
}


def _type_label(t: str) -> str:
    return _TYPE_LABELS.get((t or "").upper(), "low pressure system")


def _basin(ocean: str) -> str:
    return _BASIN_LABELS.get(ocean or "", "the open ocean")


def _best_arrival(arrivals: List[Dict]) -> Optional[Dict]:
    relevant = [a for a in arrivals if a.get("tier") in _RELEVANT_TIERS]
    return max(relevant, key=lambda a: a.get("peak_ft") or 0, default=None)


def _swell_dir_text(storm: Dict) -> str:
    """Best-effort swell direction label from fetch quadrant or movement."""
    fetch = storm.get("fetch") or {}
    q = (fetch.get("peak_quadrant") or fetch.get("quadrant") or "").upper()
    if q:
        return _OPPOSITE.get(q, q)
    mov_dir = ((storm.get("movement") or {}).get("direction") or "").upper()
    return mov_dir or "WNW"


def _location_phrase(storm: Dict) -> str:
    """Human location for the storm — evocative at high latitudes."""
    lat = storm.get("lat")
    if isinstance(lat, (int, float)):
        if lat <= -55:
            return "in the Southern Ocean off Antarctica"
        if lat >= 60:
            return f"in the far-northern {_basin(storm.get('ocean', '')).replace('the ', '')}"
    return f"in {_basin(storm.get('ocean', ''))}"


def _fmt_days(hours) -> str:
    if hours is None:
        return "—"
    h = float(hours)
    return f"~{round(h)}h" if h < 36 else f"~{round(h / 24)}d"


def generate_storm_trip_opener(
    storm: Dict,
    user_ctx: Optional[Dict],
    arrivals: List[Dict],
) -> str:
    """
    Structured storm briefing for the chat opener — vitals + most-affected regions
    + suggested prompts. No LLM call (the card already shows the LLM trajectory).
    """
    type_label = _type_label(storm.get("type", "LOW"))
    location   = _location_phrase(storm)

    # ── Vitals line ──
    vitals: List[str] = []
    if storm.get("pressure_mb"):
        vitals.append(f"central pressure ~{int(storm['pressure_mb'])} mb")
    wind = storm.get("wind_kts") or storm.get("peak_wind_kts")
    if wind:
        vitals.append(f"peak winds {int(wind)} kt")
    mov = storm.get("movement") or {}
    if mov.get("direction"):
        spd = mov.get("speed_kts") or mov.get("speed_kt")
        vitals.append(f"moving {mov['direction']}" + (f" at {int(spd)} kt" if spd else ""))
    seas_ft = storm.get("sea_height_ft")
    if not seas_ft and storm.get("peak_sea_m"):
        seas_ft = round(storm["peak_sea_m"] * 3.281)
    if seas_ft:
        vitals.append(f"seas to ~{int(seas_ft)} ft")
    fetch  = storm.get("fetch") or {}
    radius = fetch.get("peak_radius_nm") or fetch.get("radius_nm")
    quad   = fetch.get("peak_quadrant") or fetch.get("quadrant")
    if radius and quad:
        vitals.append(f"~{int(radius)} nm fetch to the {quad}")

    intro = f"I'm tracking a {type_label} {location}."
    if vitals:
        v = ", ".join(vitals)
        intro += " " + v[0].upper() + v[1:] + "."
    lines = [intro]

    # ── Most-affected regions (from the precomputed timeline) ──
    timeline = storm.get("region_timeline") or []
    if timeline:
        parts = []
        for t in timeline[:3]:
            extra = []
            if t.get("size_ft")  is not None: extra.append(f"{t['size_ft']}ft")
            if t.get("period_s") is not None: extra.append(f"{round(t['period_s'])}s")
            detail = f" {' @ '.join(extra)}" if extra else ""
            parts.append(f"{t.get('region', '?')} ({_fmt_days(t.get('peak_hours'))}{detail})")
        lines.append("Regions most affected: " + "; ".join(parts) + ".")

    # ── Suggested prompts ──
    if (user_ctx or {}).get("favorite_slugs"):
        lines.append("What else would you like to know — how it lines up with your spots, "
                     "a specific region or spot it might hit, or the best day to score it?")
    else:
        lines.append("What else would you like to know — want me to look at a specific region "
                     "or spot it might affect, or break down the timing?")

    return "\n\n".join(lines)


# ── Storm_trip system prompt ───────────────────────────────────────────────────

STORM_TRIP_SYSTEM_PROMPT = """\
You are Sione, the MySurfLife surf planner — a knowledgeable assistant helping surfers decide \
whether and where to surf based on an incoming swell from a specific storm system.

You have been given the storm's full data profile (position, track, fetch, intensity) and the \
user's surfing profile (favorite spots, recent journal, active alerts). You are in storm_trip mode.

## Core rules

1. **Anchor to the user's spots first.** Don't lead with abstract "best global exposure" — \
start from the user's favorites and whether this storm reaches them. If it does, focus there. \
If it doesn't, say so clearly, then offer trip alternatives only if the user asks.

2. **Offer concrete actions.** Don't just describe — propose: compare Friday vs Saturday timing, \
set an alert, look at a specific tide window. End responses with a clear next-step offer.

3. **Be honest about misses.** If the storm doesn't help the user's spots, say so: \
"this one's a miss for Blacks and Trestles, but NorCal will see something." \
Never oversell marginal swells to sound helpful.

4. **No fabricated precision.** Never give times or heights with false exactness. \
"Head-high to overhead Friday morning" is honest. "8.3 ft at Blacks at 7:42 AM" \
is a fabricated promise — don't do it. Use the data's natural resolution.

## Tool usage
- `get_storm_arrivals` — refresh region impact data if the user asks about a different region.
- `get_conditions_window` — when the user asks "is Friday or Saturday better?".
- `compare_spots` — rank user's favorites for this storm's conditions.
- `get_tides` — when tide timing matters for specific spots.
- `list_active_storms` — if the user asks about competing swells.
- `calculate_swell_arrival` — custom math for private spots.
- `create_alert` — ask for confirmation before creating; a write tool.

Always work from storm + arrival data already in context before calling tools. \
Only re-fetch if data is stale or the user asks about something outside the handoff payload. \
Flag model data vs. observed data when it matters.

## Output format
Follow the artifact protocol from the base instructions above: return your answer through \
the `respond` tool with structured artifacts — `spot_comparison` to rank spots, \
`conditions_timeline` for forecasts, `swell_arrival` for arrival timing/size, `wind_chart` \
for wind, plus `follow_ups`. Do NOT hand-write markdown tables or bullet lists in the message \
body; the UI renders artifacts, not raw markdown.
"""


def format_storm_context_block(storm: Dict, arrivals: List[Dict], user_ctx: Optional[Dict]) -> str:
    """
    Format storm + user data as a readable system-prompt context block.
    Injected after STORM_TRIP_SYSTEM_PROMPT.
    """
    lines = ["## Storm data"]
    if storm.get("id"):
        lines.append(f"- ID: {storm['id']}")
    if storm.get("name"):
        lines.append(f"- Name: {storm['name']}")
    s_type = (storm.get("type") or "LOW").title()
    lines.append(f"- Type: {s_type}")
    if storm.get("ocean"):
        lines.append(f"- Basin: {_basin(storm['ocean'])}")
    lat, lon = storm.get("lat"), storm.get("lon")
    if lat is not None and lon is not None:
        lines.append(
            f"- Position: {abs(lat):.1f}°{'N' if lat >= 0 else 'S'}, "
            f"{abs(lon):.1f}°{'E' if lon >= 0 else 'W'}"
        )
    if storm.get("pressure_mb"):
        lines.append(f"- Central pressure: {storm['pressure_mb']} mb")
    if storm.get("wind_kts"):
        lines.append(f"- Peak winds: {storm['wind_kts']} kt")
    if storm.get("sea_height_ft"):
        lines.append(f"- Seas: {storm['sea_height_ft']} ft")
    if storm.get("movement"):
        m = storm["movement"]
        lines.append(f"- Movement: {m.get('direction', '?')} at {m.get('speed_kts') or m.get('speed_kt', '?')} kt")
    if storm.get("issued_utc"):
        lines.append(f"- Bulletin issued: {storm['issued_utc']}")

    if arrivals:
        lines.append("\n## Regional impacts")
        for arr in sorted(arrivals, key=lambda a: -(a.get("peak_ft") or 0))[:6]:
            tier = arr.get("tier", "")
            if tier not in _RELEVANT_TIERS:
                continue
            lines.append(
                f"- {arr['name']} ({tier}): peaks {arr.get('peak_when', '?')}, "
                f"~{arr.get('peak_ft', '?')}ft, window {arr.get('window_h', '?')}h"
            )

    if user_ctx and user_ctx.get("favorite_slugs"):
        lines.append("\n## User favorites")
        names = user_ctx.get("favorite_names", {})
        for slug in user_ctx["favorite_slugs"]:
            lines.append(f"- {names.get(slug, slug)}")
        if user_ctx.get("home_region_label"):
            lines.append(f"\nUser home region: {user_ctx['home_region_label']}")

    return "\n".join(lines)
