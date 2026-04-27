"""
/api/storms/active          — live storm positions for the map page.
/api/storms/{id}/arrivals   — swell arrival forecast per surf region.
/api/storms/parse-bulletin  — AI-powered structured extraction from raw bulletin text.
/api/storms/_debug          — per-bulletin pipeline diagnostic.

Wraps high_seas.py bulletin parsing and storm_arrivals.py physics.
"""
import asyncio
import hashlib
import json
import math
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from high_seas import get_high_seas, _format_type
from storm_arrivals import compute_arrivals

router = APIRouter()

_SURF_TYPES = {"LOW", "TROPICAL STORM", "TROPICAL DEPRESSION", "HURRICANE", "TYPHOON"}

_OCEAN_KEYS = ["north-pacific", "north-atlantic", "east-pacific"]

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "storms_config.json"

_DEFAULT_CONFIG = {
    "max_pressure_mb": 1020,
    "min_wind_kts":    0,
    "include_highs":   False,
    "oceans":          _OCEAN_KEYS,
}


def load_storms_config() -> dict:
    try:
        return json.loads(_CONFIG_PATH.read_text())
    except Exception:
        return _DEFAULT_CONFIG.copy()


def save_storms_config(cfg: dict) -> None:
    _CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


def _storm_id(ocean: str, lat: float, lon: float, pressure_mb: Optional[int] = None) -> str:
    prefix = {"north-pacific": "np", "north-atlantic": "na", "east-pacific": "ep"}.get(ocean, ocean[:2])
    base = f"{prefix}-{lat:.1f}-{abs(lon):.1f}"
    # Include pressure as tiebreaker so two storms at the same rounded position
    # (e.g. 0.05° apart) get distinct IDs (Bug 4).
    return f"{base}-{pressure_mb}" if pressure_mb else base


_DEDUPE_RADIUS_KM = 400  # merge complex-low fragments within this radius (Bug 8c)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _dedupe_complex_lows(storms: List[Dict]) -> List[Dict]:
    """
    Merge LOW systems within _DEDUPE_RADIUS_KM of each other into one record
    (the strongest center by pressure).  Interim fix for Bug 8 — KWBC complex-low
    sections produce multiple parsed centers that are fragments of one system.
    Drops cleanly once the GFS detector replaces the bulletin pipeline.
    """
    kept: List[Dict] = []
    merged = [False] * len(storms)

    for i, s in enumerate(storms):
        if merged[i] or s.get("type", "").upper() != "LOW":
            if not merged[i]:
                kept.append(s)
            continue

        group = [s]
        for j in range(i + 1, len(storms)):
            if merged[j] or storms[j].get("type", "").upper() != "LOW":
                continue
            if _haversine_km(s["lat"], s["lon"], storms[j]["lat"], storms[j]["lon"]) <= _DEDUPE_RADIUS_KM:
                group.append(storms[j])
                merged[j] = True

        if len(group) == 1:
            kept.append(s)
        else:
            # Keep the strongest center (lowest pressure); fall back to first
            best = min(group, key=lambda x: x.get("pressure_mb") or 9999)
            kept.append(best)
            dropped = [g for g in group if g is not best]
            best_label = best.get("id") or f"{best['lat']},{best['lon']}"
            print(f"🔀 dedupe: merged {len(dropped)} fragment(s) into {best_label} "
                  f"(pressure {best.get('pressure_mb')} mb)")

    return kept


def _format_label(s: dict) -> str:
    parts = []
    if s.get("pressure_mb"):
        parts.append(f"{s['pressure_mb']} mb")
    if s.get("wind_kts"):
        parts.append(f"{s['wind_kts']} kt")
    if s.get("sea_height_ft"):
        parts.append(f"{s['sea_height_ft']}ft seas")
    return " · ".join(parts) if parts else "—"


@router.get("/api/storms/active")
async def get_active_storms(
    oceans: Optional[str]  = Query(None, description="Comma-separated ocean keys (overrides config)"),
    min_wind_kts: Optional[int]  = Query(None, description="Min wind kt (overrides config)"),
    max_pressure_mb: Optional[int] = Query(None, description="Max central pressure mb (overrides config)"),
    include_highs: Optional[bool]  = Query(None, description="Include HIGH systems (overrides config)"),
):
    """
    Returns a flat list of active storm/low-pressure systems suitable for
    map markers and the StormCard. Aggregates from all requested ocean basins.
    Filters are read from /config/storms_config.json; query params override per-request.
    Cached at the bulletin level (TTL 3–6h in high_seas.py).
    """
    cfg = load_storms_config()

    # Query params override config when explicitly provided
    if max_pressure_mb is None:
        max_pressure_mb = cfg.get("max_pressure_mb", 1020)
    if min_wind_kts is None:
        min_wind_kts = cfg.get("min_wind_kts", 0)
    if include_highs is None:
        include_highs = cfg.get("include_highs", False)

    if oceans is not None:
        ocean_list = [o.strip() for o in oceans.split(",") if o.strip() in _OCEAN_KEYS]
    else:
        ocean_list = [o for o in cfg.get("oceans", _OCEAN_KEYS) if o in _OCEAN_KEYS]
    if not ocean_list:
        ocean_list = _OCEAN_KEYS

    out = []
    freshness = []

    for ocean in ocean_list:
        hs = await get_high_seas(ocean)
        if hs.get("issued_utc"):
            freshness.append(hs["issued_utc"])

        for s in hs.get("systems", []):
            sys_type = s.get("type", "").upper()

            # Type filter
            if sys_type == "HIGH" and not include_highs:
                continue
            if sys_type not in _SURF_TYPES and sys_type != "HIGH":
                continue

            # Pressure filter (lower pressure = stronger storm)
            if s.get("pressure_mb") and s["pressure_mb"] > max_pressure_mb:
                continue

            # Wind filter
            if s.get("wind_kts") and s["wind_kts"] < min_wind_kts:
                continue

            basin  = s.get("basin_label") or hs.get("label", ocean.replace("-", " ").title())
            name   = f"{_format_type(sys_type)} · {basin}"
            storm_id = _storm_id(ocean, s["lat"], s["lon"], s.get("pressure_mb"))

            out.append({
                "id":             storm_id,
                "ocean":          ocean,
                "type":           sys_type,
                "name":           name,
                "lat":            s["lat"],
                "lon":            s["lon"],
                "pressure_mb":    s.get("pressure_mb"),
                "wind_kts":       s.get("wind_kts"),
                "sea_height_ft":  s.get("sea_height_ft"),
                "sea_range_ft":   s.get("sea_range_ft"),
                "movement":       s.get("movement"),
                "warning_tier":   s.get("warning_tier", "none"),
                "fetch":          s.get("fetch"),
                "forecast_track": s.get("forecast_track"),
                "label":          _format_label(s),
                "issued_utc":     hs.get("issued_utc"),
                "raw_text":       s.get("raw_text"),
            })

    updated_at = max(freshness) if freshness else None
    out = _dedupe_complex_lows(out)

    # Merge model-derived storms (Bugs 5 & 6 — Southern Hemisphere + weak NH lows).
    # Bulletin storms take priority: suppress any model storm whose center is within
    # 400 km of an already-confirmed bulletin storm (avoid double-markers).
    try:
        from jobs.detect_storms import get_cached_model_storms
        model_storms = get_cached_model_storms() or []
        if model_storms:
            for ms in model_storms:
                too_close = any(
                    _haversine_km(ms["lat"], ms["lon"], bs["lat"], bs["lon"]) < 400
                    for bs in out
                )
                if not too_close:
                    out.append({**ms, "source": "model"})
            # Tag bulletin storms with source field for frontend differentiation
            for s in out:
                s.setdefault("source", "bulletin")
    except Exception as e:
        print(f"⚠️  storms/active: model merge failed: {e}")

    return {
        "storms":     out,
        "count":      len(out),
        "updated_at": updated_at,
        "cached":     True,
    }


# ── Storm arrivals ────────────────────────────────────────────────────────────

_OCEAN_PREFIX = {"np": "north-pacific", "na": "north-atlantic", "ep": "east-pacific"}


async def _find_storm(storm_id: str) -> Optional[dict]:
    """Look up a storm from the high_seas cache by its encoded ID."""
    prefix = storm_id.split("-")[0]
    ocean  = _OCEAN_PREFIX.get(prefix)
    if not ocean:
        # Unknown prefix — search all oceans
        oceans = list(_OCEAN_PREFIX.values())
    else:
        oceans = [ocean]

    for o in oceans:
        hs = await get_high_seas(o)
        for s in hs.get("systems", []):
            if _storm_id(o, s["lat"], s["lon"], s.get("pressure_mb")) == storm_id:
                return {**s, "ocean": o, "issued_utc": hs.get("issued_utc")}
    return None


async def _fetch_db_spots():
    """Fetch spots + current ratings for arrivals spot breakdown."""
    try:
        from database import get_supabase_admin_client, supabase
        client = get_supabase_admin_client() or supabase
        if not client:
            return []
        spots_resp   = client.table("spots").select(
            "slug, name, region, subregion, latitude, longitude"
        ).execute()
        ratings_resp = client.table("spot_ratings").select(
            "spot_slug, rating, wind_mph"
        ).execute()
        ratings = {r["spot_slug"]: r for r in (ratings_resp.data or [])}
        out = []
        for s in (spots_resp.data or []):
            r = ratings.get(s["slug"], {})
            out.append({**s, "rating": r.get("rating"), "wind_mph": r.get("wind_mph")})
        return out
    except Exception as e:
        print(f"⚠️  storms/arrivals: DB fetch failed: {e}")
        return []


@router.get("/api/storms/{storm_id}/arrivals")
async def get_storm_arrivals(storm_id: str):
    """
    Compute swell arrival forecast for a specific storm.

    Returns {arrivals: [...]} with one entry per reachable surf region
    (peak_ft ≥ 3 ft). Each entry includes a spot breakdown.
    """
    storm, db_spots = await asyncio.gather(
        _find_storm(storm_id),
        _fetch_db_spots(),
    )

    if storm is None:
        # Storm ID not found in current bulletins — may have dissipated
        return {"arrivals": [], "storm_id": storm_id, "note": "storm not found in current bulletins"}

    arrivals = compute_arrivals(storm, db_spots)

    return {
        "arrivals":   arrivals,
        "storm_id":   storm_id,
        "computed_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }


# ── Bulletin AI parser ─────────────────────────────────────────────────────────

try:
    import anthropic
    _ANTHROPIC_AVAILABLE = True
except ImportError:
    _ANTHROPIC_AVAILABLE = False

_BULLETIN_CACHE: dict[str, dict] = {}   # key → {"result": ..., "expires": float}
_BULLETIN_CACHE_TTL = 3600              # 1 hour

_PARSE_BULLETIN_MODEL = "claude-haiku-4-5-20251001"

_PARSE_BULLETIN_SYSTEM = """\
You are a marine meteorology data extractor. You receive raw NOAA high-seas forecast
bulletin text for a single storm system and return ONLY a valid JSON object — no markdown,
no prose, no code fences.

Extract the following fields. Use null for any field you cannot determine with confidence.

{
  "forecast_track": [
    {
      "hours": <integer — 0 = current, 24 = 24h, 36 = 36h, 48 = 48h, etc.>,
      "lat":  <decimal degrees, positive = N>,
      "lon":  <decimal degrees, negative = W>,
      "pressure_mb": <integer or null>,
      "wind_kts":    <integer or null>,
      "sea_m":       <float or null — convert from feet if needed: ft / 3.281>
    }
  ],
  "max_wind_kts":    <integer or null — highest wind speed mentioned>,
  "max_sea_m":       <float or null  — highest seas mentioned, in metres>,
  "max_sea_ft":      <float or null  — highest seas mentioned, in feet>,
  "direction":       <string or null — movement direction e.g. "NE", "NNW">,
  "speed_kts":       <integer or null — movement speed in knots>,
  "fetch_radius_nm": <integer or null — gale/storm force radius in nautical miles>
}

Rules:
- forecast_track MUST include an entry for hours=0 (current position) if lat/lon are determinable.
- Include 24h, 36h (if present), and 48h entries from the text.
- Latitudes like "45N" → 45.0; "45.5N" → 45.5; "30S" → -30.0.
- Longitudes like "140W" → -140.0; "140E" → 140.0.
- Sea heights: if only a range is given (e.g. "15 to 20 ft"), use the peak value.
- Output ONLY the JSON object. No other text.
"""


class BulletinParseRequest(BaseModel):
    raw_text: str
    storm_id: Optional[str] = None   # for logging only


def _bulletin_cache_key(raw_text: str) -> str:
    return hashlib.sha256(raw_text.encode()).hexdigest()


def _bulletin_cache_get(key: str) -> Optional[dict]:
    entry = _BULLETIN_CACHE.get(key)
    if entry and time.monotonic() < entry["expires"]:
        return entry["result"]
    if entry:
        del _BULLETIN_CACHE[key]
    return None


def _bulletin_cache_set(key: str, result: dict) -> None:
    _BULLETIN_CACHE[key] = {"result": result, "expires": time.monotonic() + _BULLETIN_CACHE_TTL}


@router.post("/api/storms/parse-bulletin")
async def parse_bulletin(req: BulletinParseRequest):
    """
    Use Claude Haiku to extract structured storm data from a raw NOAA bulletin snippet.
    Results are cached in-memory for 1 hour keyed by content hash.
    No auth required — bulletin data is public.
    """
    if not req.raw_text or not req.raw_text.strip():
        return {"ok": False, "error": "raw_text is empty"}

    if not _ANTHROPIC_AVAILABLE:
        return {"ok": False, "error": "anthropic SDK not installed"}

    cache_key = _bulletin_cache_key(req.raw_text)
    cached = _bulletin_cache_get(cache_key)
    if cached is not None:
        print(f"✅ parse-bulletin cache hit (storm_id={req.storm_id})")
        return cached

    print(f"🌊 parse-bulletin: calling Claude Haiku (storm_id={req.storm_id}, chars={len(req.raw_text)})")

    try:
        client = anthropic.Anthropic()

        message = client.messages.create(
            model=_PARSE_BULLETIN_MODEL,
            max_tokens=1024,
            system=_PARSE_BULLETIN_SYSTEM,
            messages=[
                {"role": "user", "content": req.raw_text.strip()}
            ],
        )

        raw_json = message.content[0].text.strip()

        # Strip accidental markdown fences if Claude wraps anyway
        if raw_json.startswith("```"):
            lines = raw_json.splitlines()
            raw_json = "\n".join(
                line for line in lines
                if not line.strip().startswith("```")
            )

        parsed = json.loads(raw_json)

        result = {
            "ok": True,
            "forecast_track":  parsed.get("forecast_track") or [],
            "max_wind_kts":    parsed.get("max_wind_kts"),
            "max_sea_m":       parsed.get("max_sea_m"),
            "max_sea_ft":      parsed.get("max_sea_ft"),
            "direction":       parsed.get("direction"),
            "speed_kts":       parsed.get("speed_kts"),
            "fetch_radius_nm": parsed.get("fetch_radius_nm"),
        }

    except json.JSONDecodeError as e:
        print(f"❌ parse-bulletin: JSON decode error: {e}")
        return {"ok": False, "error": f"Claude returned non-JSON response: {e}"}
    except Exception as e:
        print(f"❌ parse-bulletin: Claude API error: {e}")
        return {"ok": False, "error": str(e)}

    _bulletin_cache_set(cache_key, result)
    return result


# ── Pipeline diagnostic ───────────────────────────────────────────────────────

@router.get("/api/storms/_debug")
async def storms_debug(
    fresh: bool = Query(False, description="Force-refetch all bulletins, ignoring the 6h cache"),
):
    """
    Per-bulletin diagnostic for the storm pipeline.

    Returns, for each ocean basin we fetch:
      - bulletin issue/fetch timestamps and cache status
      - first line of each parsed section (so you can see what KWBC narrated)
      - keyword occurrence counts (LOW/HIGH/STORM/HURRICANE/etc.) — quick
        sanity check for "is this basin actually quiet?"
      - parse counts pre-filter, plus per-reason drop counts post-filter
      - a summary list of every parsed system

    Use this when the map shows "0 storms" for a basin to diagnose whether:
      (a) the bulletin is genuinely quiet,
      (b) the fetch is silently failing,
      (c) the parser is missing the systems, or
      (d) the filter thresholds are dropping them.

    Note: this endpoint is unauthenticated to mirror /api/storms/active.
    Add Depends(require_admin) before exposing publicly.
    """
    if fresh:
        # Bust the in-memory bulletin cache so we re-pull from NWS
        from high_seas import _hs_cache
        for k in list(_hs_cache.keys()):
            _hs_cache.pop(k, None)

    cfg             = load_storms_config()
    max_pressure_mb = cfg.get("max_pressure_mb", 1020)
    min_wind_kts    = cfg.get("min_wind_kts", 0)
    include_highs   = cfg.get("include_highs", False)

    results = await asyncio.gather(
        *[get_high_seas(o) for o in _OCEAN_KEYS],
        return_exceptions=True,
    )

    KEYWORDS = ("LOW", "HIGH", "GALE", "STORM", "HURRICANE", "TROPICAL")

    oceans_out:    List[Dict] = []
    totals_raw  = 0
    totals_kept = 0
    by_ocean:      Dict[str, int] = {}

    for ocean, hs in zip(_OCEAN_KEYS, results):
        if isinstance(hs, Exception):
            oceans_out.append({
                "ocean":   ocean,
                "fetch":   {"ok": False, "exception": str(hs)},
                "systems": [],
            })
            by_ocean[ocean] = 0
            continue

        sections = hs.get("sections") or []
        systems  = hs.get("systems") or []
        raw_text = "\n".join(sections)

        section_heads = [
            (sec.split("\n", 1)[0] or "").strip()[:120]
            for sec in sections[:24]
        ]

        keyword_counts = {
            k: len(re.findall(rf"\b{k}\b", raw_text, re.IGNORECASE))
            for k in KEYWORDS
        }

        by_type: Dict[str, int] = {}
        for s in systems:
            t = (s.get("type") or "").upper()
            by_type[t] = by_type.get(t, 0) + 1

        # Mirror the same filter logic /api/storms/active uses
        kept    = 0
        dropped = {"type": 0, "pressure": 0, "wind": 0}
        for s in systems:
            sys_type = (s.get("type") or "").upper()
            if sys_type == "HIGH" and not include_highs:
                dropped["type"] += 1
                continue
            if sys_type not in _SURF_TYPES and sys_type != "HIGH":
                dropped["type"] += 1
                continue
            if s.get("pressure_mb") and s["pressure_mb"] > max_pressure_mb:
                dropped["pressure"] += 1
                continue
            if s.get("wind_kts") and s["wind_kts"] < min_wind_kts:
                dropped["wind"] += 1
                continue
            kept += 1

        totals_raw      += len(systems)
        totals_kept     += kept
        by_ocean[ocean]  = kept

        oceans_out.append({
            "ocean": ocean,
            "label": hs.get("label"),
            "fetch": {
                "ok":             hs.get("error") is None,
                "issued_utc":     hs.get("issued_utc"),
                "fetched_at":     hs.get("fetched_at"),
                "cached":         hs.get("cached", False),
                "section_count":  len(sections),
                "bulletin_chars": len(raw_text),
                "error":          hs.get("error"),
            },
            "section_heads":  section_heads,
            "keyword_counts": keyword_counts,
            "parse": {
                "raw_count": len(systems),
                "by_type":   by_type,
            },
            "filter": {
                "kept":    kept,
                "dropped": dropped,
            },
            "systems": [
                {
                    "type":          s.get("type"),
                    "lat":           s.get("lat"),
                    "lon":           s.get("lon"),
                    "pressure_mb":   s.get("pressure_mb"),
                    "wind_kts":      s.get("wind_kts"),
                    "sea_height_ft": s.get("sea_height_ft"),
                    "basin":         s.get("basin_label"),
                    "warning_tier":  s.get("warning_tier"),
                    "track_pts":     len(s.get("forecast_track") or []),
                }
                for s in systems
            ],
        })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "max_pressure_mb": max_pressure_mb,
            "min_wind_kts":    min_wind_kts,
            "include_highs":   include_highs,
            "oceans":          _OCEAN_KEYS,
        },
        "oceans": oceans_out,
        "totals": {
            "raw":      totals_raw,
            "kept":     totals_kept,
            "by_ocean": by_ocean,
        },
    }
