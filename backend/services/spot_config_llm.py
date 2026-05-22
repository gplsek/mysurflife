"""services/spot_config_llm.py — LLM-assisted swell-window proposal (A2).

Proposes a spot's swell-exposure windows (which compass directions wrap in, weighted,
with a min usable period). Grounded by the geo-derived facing (services.spot_orientation)
so the model refines a physically-sane arc rather than inventing one. Falls back to a
pure-geo arc (facing ± 80°) when no API key / on error.

Cheap model (Haiku) — this is structured proposal, not reasoning. Output is reviewable
and source-tagged 'llm' (or 'geo' for the fallback) so human edits always win.
"""
from __future__ import annotations

import json
import os
from typing import Dict, List, Optional

_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
_MODEL = "claude-haiku-4-5-20251001"


def _geo_arc_windows(facing_deg: Optional[float]) -> Optional[List[Dict]]:
    """Fallback: a single swell window across the seaward arc (facing ± 80°)."""
    if facing_deg is None:
        return None
    return [{
        "dir_min": round((facing_deg - 80) % 360),
        "dir_max": round((facing_deg + 80) % 360),
        "weight": 1.0,
        "period_min_sec": 8,
        "source": "geo",
    }]


_SYSTEM = """\
You are a surf-forecasting assistant proposing swell-exposure windows for a surf spot. \
A swell window is the compass arc (degrees the swell travels FROM) that the spot is open to. \
Return ONLY valid JSON, no markdown fences, no prose.\
"""

_PROMPT = """\
Propose 1-3 swell windows for this spot as a JSON array. Each item:
{{"dir_min": <int 0-360>, "dir_max": <int 0-360>, "weight": <0.1-1.0>, "period_min_sec": <int>}}

Rules:
- Bearings are the direction swell arrives FROM.
- The spot's coastline faces roughly {facing}° (seaward), so realistic windows sit within
  about ±90° of that — refine for headlands/point setups, don't invent offshore-of-land arcs.
- weight 1.0 = primary/best exposure; lower for secondary angles.
- period_min_sec = minimum period that meaningfully reaches it (longer for shadowed/wrapped spots).
- 1 window for a simple beach; 2-3 for points/reefs that take multiple swells.

Spot: {name}, {region}, {country}. Coordinates {lat}, {lon}. Break: {break_type}.
Geo-derived facing: {facing}° ({facing_compass}).
"""


async def generate_swell_windows(
    spot: Dict,
    facing_deg: Optional[float],
    facing_compass: Optional[str] = None,
    *,
    client=None,
) -> Optional[List[Dict]]:
    """Return swell-window dicts (with `source`), or None if nothing can be proposed."""
    if not _ANTHROPIC_API_KEY:
        return _geo_arc_windows(facing_deg)

    try:
        prompt = _PROMPT.format(
            name=spot.get("name", "?"),
            region=spot.get("region", "?"),
            country=spot.get("country", "?"),
            lat=spot.get("latitude"),
            lon=spot.get("longitude"),
            break_type=spot.get("break_type") or "unknown",
            facing=round(facing_deg) if facing_deg is not None else "unknown",
            facing_compass=facing_compass or "?",
        )
        if client is None:
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=_ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model=_MODEL, max_tokens=400, system=_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        windows = json.loads(raw)
        out = []
        for w in windows:
            if "dir_min" in w and "dir_max" in w:
                out.append({
                    "dir_min": int(w["dir_min"]) % 360,
                    "dir_max": int(w["dir_max"]) % 360,
                    "weight": float(w.get("weight", 1.0)),
                    "period_min_sec": int(w.get("period_min_sec", 8)),
                    "source": "llm",
                })
        return out or _geo_arc_windows(facing_deg)
    except Exception as e:
        print(f"⚠️  spot_config_llm: swell-window generation failed for {spot.get('name')}: {e}")
        return _geo_arc_windows(facing_deg)
