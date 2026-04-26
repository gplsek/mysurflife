"""
storm_bulletin_parser.py — LLM-based structured extraction from NOAA High Seas bulletins.

Uses Claude Haiku for fast, cheap structured extraction. Falls back gracefully on any error.
Results are in-memory cached by section hash to avoid repeated API calls within a request cycle.
"""
import hashlib
import json
import os
from typing import Dict, Optional

_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# In-memory cache: section_hash → parsed dict
_cache: Dict[str, Optional[Dict]] = {}

_SYSTEM = """\
You are a structured data extractor for NOAA High Seas marine weather bulletins. \
Extract only what is explicitly stated in the text. \
Return valid JSON, no markdown fences, no extra prose.\
"""

_PROMPT = """\
Extract data from this NOAA High Seas bulletin section. Return a JSON object with:

{
  "pressure_mb": <integer or null>,
  "wind_kts": <max wind speed in knots as integer, or null — scan the ENTIRE section and take the highest value>,
  "sea_height_ft": <peak sea height in FEET as integer, or null — convert from metres if needed (1 m = 3.281 ft), scan ALL sea height mentions and return the highest>,
  "sea_range_ft": [<min_ft as integer>, <max_ft as integer>] or null,
  "fetch": {
    "radius_nm": <largest wind radius in nautical miles as integer>,
    "quadrant": "<primary direction e.g. SW or ALL>"
  } or null,
  "movement": {
    "direction": "<compass direction e.g. NE or STATIONARY>",
    "speed_kts": <integer>
  } or null
}

Rules:
- Convert all sea heights to feet. "SEAS 3 TO 5.5 M" → sea_height_ft=18, sea_range_ft=[10,18]
- wind_kts = the HIGHEST wind speed mentioned anywhere (e.g. "WINDS 45 TO 60 KT" → 60)
- For fetch: look for "WITHIN X NM [direction] QUADRANT" or "X NM RADIUS" — pick the largest X
- Return null for any field you cannot determine with confidence

Bulletin section:
"""


async def parse_bulletin_section(section: str) -> Optional[Dict]:
    """
    Use Claude Haiku to extract structured metrics from a High Seas bulletin section.
    Returns a dict with whichever fields were found, or None on failure.
    Results are cached in-memory by content hash.
    """
    if not _ANTHROPIC_API_KEY:
        return None

    h = hashlib.sha256(section.encode()).hexdigest()[:16]
    if h in _cache:
        return _cache[h]

    try:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=_ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            system=_SYSTEM,
            messages=[{"role": "user", "content": _PROMPT + section}],
        )
        raw = resp.content[0].text.strip()
        # Strip any accidental markdown fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw)
        _cache[h] = parsed
        return parsed
    except Exception as e:
        print(f"⚠️  storm_bulletin_parser: LLM extraction failed: {e}")
        _cache[h] = None
        return None
