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


def generate_storm_trip_opener(
    storm: Dict,
    user_ctx: Optional[Dict],
    arrivals: List[Dict],
) -> str:
    """
    Assemble the opening message for a storm_trip session.
    No LLM call — pure template logic.
    """
    type_label  = _type_label(storm.get("type", "LOW"))
    basin       = _basin(storm.get("ocean", ""))
    best        = _best_arrival(arrivals)

    # Landfall takes priority — short swell window is critical info
    landfall_h = storm.get("landfall_eta_hours")
    if landfall_h and isinstance(landfall_h, (int, float)) and landfall_h > 0:
        window_note = (
            f"There may be a short pulse reaching {best['name']} before that."
            if best
            else "Swell generation cuts off before meaningful energy reaches the coast."
        )
        return (
            f"Heads up — this storm tracks onto land in about {int(landfall_h)}h, "
            f"which closes the swell window early. {window_note} "
            f"Worth checking if your spots see anything before that. Want me to check?"
        )

    # Anonymous / no favorites
    fav_slugs = set((user_ctx or {}).get("favorite_slugs", []))
    if not fav_slugs:
        if best:
            return (
                f"I'm tracking a {type_label} in {basin}. "
                f"Best exposure is {best['name']} starting {best['peak_when']}. "
                f"Want me to break down which coasts this hits and when?"
            )
        return (
            f"I'm tracking a {type_label} in {basin}. "
            f"The system looks weak for direct surf impact right now. "
            f"Want me to walk through the forecast track?"
        )

    # Match favorites against arrivals spot lists
    fav_names: Dict[str, str] = (user_ctx or {}).get("favorite_names", {})
    hit_spots: List[Dict] = []
    hit_arrival: Optional[Dict] = None
    relevant = sorted(
        [a for a in arrivals if a.get("tier") in _RELEVANT_TIERS],
        key=lambda a: -(a.get("peak_ft") or 0),
    )
    for arr in relevant:
        arr_spot_ids = {s["id"] for s in arr.get("spots", [])}
        matched = [
            {"slug": slug, "name": fav_names.get(slug, slug)}
            for slug in fav_slugs
            if slug in arr_spot_ids
        ]
        if matched:
            hit_spots.extend(matched)
            if hit_arrival is None:
                hit_arrival = arr

    if hit_spots and hit_arrival:
        names_str  = ", ".join(s["name"] for s in hit_spots[:2])
        dir_text   = _swell_dir_text(storm)
        period_str = (
            f"{hit_arrival['peak_period_s']}s"
            if hit_arrival.get("peak_period_s")
            else "—"
        )
        return (
            f"I'm tracking a {type_label} in {basin} that'll send swell into your area. "
            f"{names_str} {'sit' if len(hit_spots) > 1 else 'sits'} in the "
            f"{hit_arrival['name']} window — peaking around {hit_arrival['peak_when']}. "
            f"Swell direction looks like {dir_text} at {period_str}. "
            f"Want me to break down which of your spots will work best, or look at "
            f"conditions for a specific day?"
        )

    # Favorites don't intersect with storm path
    home_label = (user_ctx or {}).get("home_region_label") or "your area"
    if best:
        return (
            f"I'm tracking a {type_label} in {basin}. "
            f"Best exposure is {best['name']} starting {best['peak_when']}. "
            f"Your home spots in {home_label} are mostly out of the direct window for this one. "
            f"Want a deeper look at whether it's worth a trip, or how this compares to past "
            f"swells in your journal?"
        )
    return (
        f"I'm tracking a {type_label} in {basin}. "
        f"This system doesn't look like a direct hit for your spots. "
        f"Want me to walk through the track and see if anything reaches your area?"
    )


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
