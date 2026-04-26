"""
NOAA NWS High Seas bulletin fetcher and parser.

Fetches plain-text High Seas Forecasts from the NWS Products API and
extracts structured storm/system data for use by the Copilot's
scan_active_storms tool and the /api/storms/active map endpoint.

No API key required. NWS Products API is public.

Endpoints exposed (registered in main.py):
    GET /api/high-seas/{ocean}
        ocean: north-pacific | south-pacific | north-atlantic
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import httpx

# NWS Products API — issuance office + product type
# KWBC = Washington, DC — issues all High Seas products
_NWS_PRODUCTS_BASE = "https://api.weather.gov/products/types"

_OCEAN_PRODUCT_MAP = {
    "north-pacific": {
        "type": "HSF",
        "location": "NP",
        "label": "North Pacific High Seas Forecast",
    },
    "south-pacific": {
        "type": "HSF",
        "location": "EP2",
        "label": "East/South Pacific High Seas Forecast",
    },
    "north-atlantic": {
        "type": "HSF",
        "location": "AT1",
        "label": "North Atlantic High Seas Forecast",
    },
}

# Simple in-memory cache: { ocean: { fetched_at, data } }
_hs_cache: Dict[str, Dict] = {}
_HS_CACHE_TTL = 6 * 3600  # 6-hour TTL — bulletins issued 4× daily


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

async def _fetch_latest_bulletin(ocean: str) -> Optional[str]:
    """Return the raw text of the most recent bulletin for *ocean*, or None."""
    cfg = _OCEAN_PRODUCT_MAP.get(ocean)
    if not cfg:
        return None

    list_url = f"{_NWS_PRODUCTS_BASE}/{cfg['type']}/locations/{cfg['location']}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(list_url, headers={"Accept": "application/geo+json"})
            resp.raise_for_status()
            items = resp.json().get("@graph", [])
            if not items:
                print(f"⚠️  High Seas: no products returned for {ocean}")
                return None
            # Most-recent is first
            product_url = items[0].get("@id")
            if not product_url:
                return None

            prod_resp = await client.get(product_url, headers={"Accept": "application/geo+json"})
            prod_resp.raise_for_status()
            return prod_resp.json().get("productText", "")
    except httpx.TimeoutError:
        print(f"⏱️ High Seas fetch timeout for {ocean}")
        return None
    except Exception as e:
        print(f"❌ High Seas fetch error ({ocean}): {e}")
        return None


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------

def _parse_lat(s: str) -> Optional[float]:
    """Parse '42N' or '42.5S' → signed float."""
    m = re.match(r"(\d+(?:\.\d+)?)\s*([NS])", s.strip(), re.IGNORECASE)
    if not m:
        return None
    val = float(m.group(1))
    return -val if m.group(2).upper() == "S" else val


def _parse_lon(s: str) -> Optional[float]:
    """Parse '155W' or '142.5E' → signed float."""
    m = re.match(r"(\d+(?:\.\d+)?)\s*([EW])", s.strip(), re.IGNORECASE)
    if not m:
        return None
    val = float(m.group(1))
    return -val if m.group(2).upper() == "W" else val


_TYPE_LABELS = {
    "LOW":                  "Low Pressure",
    "HIGH":                 "High Pressure",
    "TROPICAL STORM":       "Tropical Storm",
    "TROPICAL DEPRESSION":  "Tropical Depression",
    "HURRICANE":            "Hurricane",
    "TYPHOON":              "Typhoon",
}

_BASIN_NAMES = [
    "GULF OF ALASKA", "BERING SEA", "ALEUTIAN ISLANDS",
    "NORTH PACIFIC", "NORTH CENTRAL PACIFIC", "NORTHEAST PACIFIC",
    "NORTHWEST PACIFIC", "SOUTH PACIFIC", "CENTRAL PACIFIC",
    "NORTH ATLANTIC", "NORTHWEST ATLANTIC", "NORTHEAST ATLANTIC",
    "SOUTH ATLANTIC", "CARIBBEAN", "GULF OF MEXICO",
]

_DAY_MAP = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}


def _format_type(sys_type: str) -> str:
    return _TYPE_LABELS.get(sys_type.upper(), sys_type.title())


def _warning_tier(wind_kts: Optional[int]) -> str:
    if not wind_kts:
        return "none"
    if wind_kts >= 64:
        return "hurricane"
    if wind_kts >= 48:
        return "storm"
    if wind_kts >= 34:
        return "gale"
    return "none"


def _basin_label(section: str) -> Optional[str]:
    """Extract a basin name from a bulletin section header or body."""
    upper = section.upper()
    for name in _BASIN_NAMES:
        if name in upper:
            return name.title()
    return None


def _parse_fetch_info(section: str) -> Optional[Dict]:
    """
    Parse wind-fetch geometry from NWS High Seas wording.

    Handles multiple formats:
      'STORM FORCE WINDS FROM W QUADRANT 150 NM'
      'GALE FORCE WINDS NE SEMICIRCLE 120 NM'
      'GALE FORCE WINDS 300 NM RADIUS'
      'WITHIN 240 NM SW AND W QUADRANTS WINDS 40 TO 50 KT'
      'WITHIN 360 NM S QUADRANT WINDS 30 TO 45 KT'

    Returns the entry with the largest radius_nm (peak storm footprint).
    """
    tier_map = {"GALE": 34, "STORM": 48, "HURRICANE": 64, "WHOLE GALE": 48}
    tier_pat = r"(WHOLE GALE|GALE|STORM|HURRICANE)\s+FORCE\s+WINDS"

    candidates = []

    # Pattern A: "STORM FORCE WINDS [FROM direction QUADRANT / direction SEMICIRCLE] X NM"
    for m in re.finditer(
        tier_pat + r"(?:\s+FROM\s+([\w/]+)\s+QUADRANT|\s+([\w/]+)\s+SEMICIRCLE)?"
        r"\s*(\d+)\s*NM",
        section, re.IGNORECASE,
    ):
        tier_str = m.group(1).upper()
        quadrant = (m.group(2) or m.group(3) or "ALL").upper()
        candidates.append({
            "quadrant": quadrant,
            "radius_nm": int(m.group(4)),
            "wind_kts_in_fetch": tier_map.get(tier_str, 34),
        })

    # Pattern B: "X NM RADIUS" after tier keyword
    for m in re.finditer(tier_pat + r"\s+(\d+)\s*NM\s+RADIUS", section, re.IGNORECASE):
        tier_str = m.group(1).upper()
        candidates.append({
            "quadrant": "ALL",
            "radius_nm": int(m.group(2)),
            "wind_kts_in_fetch": tier_map.get(tier_str, 34),
        })

    # Pattern C (NWS High Seas): "WITHIN X NM [direction] QUADRANT[S] WINDS Y TO Z KT"
    # e.g. "WITHIN 240 NM SW AND W QUADRANTS WINDS 40 TO 50 KT"
    # Note: "WITHIN 360 NM S AND 420 NM W QUADRANTS" is shorthand for two radii — iterate both
    for m in re.finditer(
        r"WITHIN\s+(\d+)\s*NM\s+([NSEW]{1,3})\b.*?QUADRANT[S]?[^.]*?WINDS?\s+\d+\s+TO\s+(\d+)\s*KT",
        section, re.IGNORECASE,
    ):
        radius_nm   = int(m.group(1))
        quadrant    = m.group(2).strip().upper()
        max_wind    = int(m.group(3))
        tier_str    = "HURRICANE" if max_wind >= 64 else "STORM" if max_wind >= 48 else "GALE"
        candidates.append({
            "quadrant": quadrant,
            "radius_nm": radius_nm,
            "wind_kts_in_fetch": tier_map.get(tier_str, 34),
        })

    if not candidates:
        return None

    # Return the entry with the largest radius (peak storm footprint)
    return max(candidates, key=lambda c: c["radius_nm"])


def _parse_forecast_track(section: str, issued_utc: Optional[str]) -> List[Dict]:
    """
    Parse NWS forecast position statements, e.g.:
      'WILL MOVE NE TO 44N 151W BY 12Z TUE THEN NE TO 46N 148W BY 12Z WED'
    Returns list of {hours_ahead, lat, lon} sorted by hours_ahead.
    """
    waypoints = []

    # Normalise whitespace
    text = " ".join(section.split())

    # Each waypoint: coords + optional BY {time}
    # Pattern handles "TO 44N 151W BY 12Z TUE" and "NEAR 44N 151W"
    wp_pat = re.compile(
        r"(?:TO|NEAR)\s+(\d+(?:\.\d+)?[NS])\s+(\d+(?:\.\d+)?[EW])"
        r"(?:[^\.]*?BY\s+(\d{1,2})Z\s+(\w{3}))?",
        re.IGNORECASE,
    )

    issued_dt = None
    if issued_utc:
        try:
            issued_dt = datetime.fromisoformat(issued_utc.replace("Z", "+00:00"))
        except Exception:
            pass

    for m in wp_pat.finditer(text):
        lat = _parse_lat(m.group(1))
        lon = _parse_lon(m.group(2))
        if lat is None or lon is None:
            continue

        hours_ahead = None
        if m.group(3) and m.group(4) and issued_dt:
            try:
                target_z    = int(m.group(3))
                day_abbr    = m.group(4).upper()[:3]
                target_wday = _DAY_MAP.get(day_abbr)
                if target_wday is not None:
                    issued_wday = issued_dt.weekday()
                    delta_days  = (target_wday - issued_wday) % 7 or 7
                    target_dt   = (issued_dt + timedelta(days=delta_days)).replace(
                        hour=target_z, minute=0, second=0, microsecond=0
                    )
                    hours_ahead = round((target_dt - issued_dt).total_seconds() / 3600)
            except Exception:
                pass

        waypoints.append({
            "hours_ahead": hours_ahead,
            "lat": lat,
            "lon": lon,
        })

    # Sort by hours_ahead (None last)
    waypoints.sort(key=lambda w: w["hours_ahead"] if w["hours_ahead"] is not None else 9999)
    return waypoints


def _parse_bulletin(text: str) -> Dict:
    """
    Parse a NWS High Seas bulletin text and extract:
      - issued_utc  : ISO timestamp of bulletin issuance
      - valid_utc   : ISO timestamp of forecast valid time
      - systems     : list of storm/pressure system dicts
      - raw_sections: the individual forecast sections (text)
    """
    systems: List[Dict] = []
    sections: List[str] = []

    # --- Issuance time ---
    issued_utc = None
    # Pattern: "1100 UTC MON APR 21 2026" or "1100 UTC TUE JAN 07 2025"
    m = re.search(
        r"(\d{3,4})\s+UTC\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})",
        text,
        re.IGNORECASE,
    )
    if m:
        try:
            hhmm, mon, day, yr = m.group(1), m.group(2), m.group(3), m.group(4)
            if len(hhmm) == 3:
                hhmm = "0" + hhmm
            dt_str = f"{yr} {mon} {day} {hhmm[:2]}:{hhmm[2:]}"
            issued_utc = datetime.strptime(dt_str, "%Y %b %d %H:%M").replace(
                tzinfo=timezone.utc
            ).isoformat()
        except Exception:
            pass

    # --- Split into sections (each starts with a capital-letter heading or dotted line) ---
    raw_sections = re.split(r"\n(?=\.[A-Z])", text)
    for sec in raw_sections:
        sec = sec.strip()
        if sec:
            sections.append(sec)

    # --- Extract storm/system entries ---
    # Look for phrases like:
    #   "LOW 42N 155W 985 MB MOVING NE 15 KT..."
    #   "HIGH 35N 142W 1022 MB NEARLY STATIONARY..."
    #   "TROPICAL STORM AT 18N 130W..."
    system_patterns = [
        # Type + optional NEAR/AT qualifier + coordinates (space optional) + pressure
        # Handles: "LOW NEAR 29N150W", "NEW LOW 39N69W", "TROPICAL STORM 18N 130W"
        r"(?:NEW\s+)?(LOW|HIGH|TROPICAL\s+STORM|TROPICAL\s+DEPRESSION|HURRICANE|TYPHOON)"
        r"[\s,]*(?:NEAR\s+|AT\s+)?(\d+(?:\.\d+)?[NS])\s*(\d+(?:\.\d+)?[EW])"
        r"(?:[\s,]+(\d+)\s*MB)?",
    ]

    for sec in sections:
        for pat in system_patterns:
            for match in re.finditer(pat, sec, re.IGNORECASE):
                sys_type = match.group(1).strip().upper()
                lat = _parse_lat(match.group(2))
                lon = _parse_lon(match.group(3))
                if lat is None or lon is None:
                    continue

                pressure_mb = int(match.group(4)) if match.group(4) else None

                # Wind speed — take maximum across all mentions in section:
                #   "WINDS X TO Y KT" (range → use max Y)
                #   "WINDS TO X KT" or "MAX WINDS X KT" (single ceiling)
                _wind_vals = [
                    int(w) for w in re.findall(
                        r"WINDS?\s+\d+\s+TO\s+(\d+)\s*KT", sec, re.IGNORECASE
                    )
                ] + [
                    int(w) for w in re.findall(
                        r"(?:WINDS?\s+TO|MAX\s+WINDS?)\s+(\d+)\s*KT", sec, re.IGNORECASE
                    )
                ]
                wind_kts = max(_wind_vals) if _wind_vals else None

                # Sea heights — accept FT or M (convert M→ft); take peak across whole section
                _seas_ft: list = [
                    float(v) for v in re.findall(
                        r"SEAS?\s+\d+(?:\.\d+)?\s+TO\s+(\d+(?:\.\d+)?)\s*FT",
                        sec, re.IGNORECASE,
                    )
                ]
                _seas_m_raw: list = re.findall(
                    r"SEAS?\s+\d+(?:\.\d+)?\s+TO\s+(\d+(?:\.\d+)?)\s*M\b",
                    sec, re.IGNORECASE,
                )
                _seas_ft += [float(v) * 3.281 for v in _seas_m_raw]
                sea_max_ft = round(max(_seas_ft)) if _seas_ft else None
                sea_min_ft = None  # kept for schema compat; peak is what matters

                # Movement — "MOVING NE 15 KT" or "NEARLY STATIONARY"
                move_m = re.search(
                    r"MOVING\s+([\w/]+)\s+(\d+)\s*KT",
                    sec,
                    re.IGNORECASE,
                )
                stat_m = re.search(r"NEARLY\s+STATIONARY|STATIONARY", sec, re.IGNORECASE)
                movement = None
                if move_m:
                    movement = {
                        "direction": move_m.group(1).upper(),
                        "speed_kts": int(move_m.group(2)),
                    }
                elif stat_m:
                    movement = {"direction": "STATIONARY", "speed_kts": 0}

                basin        = _basin_label(sec)
                fetch_info   = _parse_fetch_info(sec)
                track        = _parse_forecast_track(sec, issued_utc)
                warning      = _warning_tier(wind_kts)

                if not track:
                    print(f"⚠️  high_seas: no parseable forecast_track for {sys_type} at {lat},{lon}")

                entry: Dict = {
                    "type":         sys_type,
                    "lat":          lat,
                    "lon":          lon,
                    "warning_tier": warning,
                    "basin_label":  basin,
                    "fetch":        fetch_info,
                    "forecast_track": track if track else None,
                    "raw_text":     sec,
                }
                if pressure_mb:
                    entry["pressure_mb"] = pressure_mb
                if wind_kts:
                    entry["wind_kts"] = wind_kts
                if sea_min_ft or sea_max_ft:
                    entry["sea_height_ft"] = sea_max_ft or sea_min_ft
                    entry["sea_range_ft"] = [sea_min_ft, sea_max_ft]
                if movement:
                    entry["movement"] = movement

                # Avoid duplicate entries for same system at same location
                key = (round(lat, 1), round(lon, 1), sys_type)
                if not any(
                    (round(s["lat"], 1), round(s["lon"], 1), s["type"]) == key
                    for s in systems
                ):
                    systems.append(entry)

    return {
        "issued_utc": issued_utc,
        "systems": systems,
        "sections": sections,
    }


# ---------------------------------------------------------------------------
# Storm observations persistence
# ---------------------------------------------------------------------------

_OCEAN_PREFIX = {"north-pacific": "np", "north-atlantic": "na", "south-pacific": "sp"}


def _persist_storm_observations(ocean: str, systems: List[Dict], observed_utc: Optional[str]) -> None:
    """Insert freshly-parsed storm positions into storm_observations (best-effort)."""
    try:
        from database import get_supabase_admin_client
        admin_client = get_supabase_admin_client()
        if not admin_client or not systems:
            return
        prefix = _OCEAN_PREFIX.get(ocean, ocean[:2])
        obs_ts = observed_utc or (datetime.now(tz=timezone.utc).isoformat())
        rows = []
        for s in systems:
            lat, lon = s.get("lat"), s.get("lon")
            if lat is None or lon is None:
                continue
            storm_key = f"{prefix}-{round(lat)}-{round(abs(lon))}"
            rows.append({
                "storm_key":     storm_key,
                "observed_utc":  obs_ts,
                "lat":           lat,
                "lon":           lon,
                "type":          s.get("type"),
                "pressure_mb":   s.get("pressure_mb"),
                "wind_kts":      s.get("wind_kts"),
                "sea_height_ft": s.get("sea_height_ft"),
                "raw_entry":     s,
            })
        if rows:
            admin_client.table("storm_observations").insert(rows).execute()
            print(f"✅ storm_observations: inserted {len(rows)} rows ({ocean})")
    except Exception as e:
        print(f"⚠️  storm_observations insert failed ({ocean}): {e}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_high_seas(ocean: str) -> Dict:
    """
    Fetch and parse the latest High Seas bulletin for *ocean*.

    Returns:
        {
          "ocean": str,
          "label": str,
          "issued_utc": str | None,
          "systems": [ { type, lat, lon, pressure_mb?, wind_kts?,
                         sea_height_ft?, sea_range_ft?, movement? } ],
          "sections": [ raw_text_block, ... ],
          "cached": bool,
          "fetched_at": str,
        }
    """
    now_ts = datetime.now(tz=timezone.utc).timestamp()
    cached = _hs_cache.get(ocean)
    if cached and (now_ts - cached["fetched_at"]) < _HS_CACHE_TTL:
        return {**cached["data"], "cached": True}

    cfg = _OCEAN_PRODUCT_MAP.get(ocean)
    if not cfg:
        valid = list(_OCEAN_PRODUCT_MAP.keys())
        return {"error": f"Unknown ocean '{ocean}'. Valid: {valid}"}

    text = await _fetch_latest_bulletin(ocean)
    if not text:
        return {
            "ocean": ocean,
            "label": cfg["label"],
            "issued_utc": None,
            "systems": [],
            "sections": [],
            "cached": False,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
            "error": "Bulletin unavailable",
        }

    parsed = _parse_bulletin(text)

    # ── LLM enhancement pass ─────────────────────────────────────────────────
    # For any system still missing sea_height_ft or fetch, try Claude Haiku
    # to fill the gaps. Fires concurrently; failures are silently swallowed.
    try:
        from storm_bulletin_parser import parse_bulletin_section
        import asyncio as _asyncio

        async def _enhance(system: Dict) -> None:
            if system.get("sea_height_ft") is not None and system.get("fetch") is not None:
                return  # regex already got everything
            raw = system.get("raw_text", "")
            if not raw:
                return
            llm_data = await parse_bulletin_section(raw)
            if not llm_data:
                return
            if system.get("sea_height_ft") is None and llm_data.get("sea_height_ft"):
                system["sea_height_ft"] = llm_data["sea_height_ft"]
            if system.get("sea_range_ft") is None and llm_data.get("sea_range_ft"):
                system["sea_range_ft"] = llm_data["sea_range_ft"]
            if system.get("fetch") is None and llm_data.get("fetch"):
                system["fetch"] = llm_data["fetch"]
            if system.get("wind_kts") is None and llm_data.get("wind_kts"):
                system["wind_kts"] = llm_data["wind_kts"]
                system["warning_tier"] = _warning_tier(llm_data["wind_kts"])
            if system.get("movement") is None and llm_data.get("movement"):
                system["movement"] = llm_data["movement"]

        await _asyncio.gather(*[_enhance(s) for s in parsed["systems"]], return_exceptions=True)
    except ImportError:
        pass
    except Exception as e:
        print(f"⚠️  high_seas LLM enhancement error: {e}")
    # ─────────────────────────────────────────────────────────────────────────

    result = {
        "ocean": ocean,
        "label": cfg["label"],
        "issued_utc": parsed["issued_utc"],
        "systems": parsed["systems"],
        "sections": parsed["sections"],
        "cached": False,
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }

    _hs_cache[ocean] = {"fetched_at": now_ts, "data": result}
    _persist_storm_observations(ocean, parsed["systems"], parsed.get("issued_utc"))
    return result


def register_routes(app) -> None:
    """Register /api/high-seas/{ocean} on *app*."""
    from fastapi import Path as FPath

    @app.get("/api/high-seas/{ocean}")
    async def high_seas_endpoint(
        ocean: str = FPath(
            ...,
            description="Ocean basin: north-pacific | south-pacific | north-atlantic",
        ),
    ):
        """
        Latest NOAA NWS High Seas bulletin for the given ocean, parsed into
        structured storm/system data. Useful for Copilot storm tracking.
        """
        return await get_high_seas(ocean)
