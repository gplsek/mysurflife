"""
NOAA NWS High Seas bulletin fetcher and parser.

Fetches plain-text High Seas Forecasts from the NWS Products API and
extracts structured storm/system data for use by the Copilot's
scan_active_storms tool.

No API key required. NWS Products API is public.

Endpoints exposed (registered in main.py):
    GET /api/high-seas/{ocean}
        ocean: north-pacific | south-pacific | north-atlantic
"""
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx

# NWS Products API — issuance office + product type
# KWBC = Washington, DC — issues all High Seas products
_NWS_PRODUCTS_BASE = "https://api.weather.gov/products/types"

_OCEAN_PRODUCT_MAP = {
    "north-pacific": {
        "type": "HSFPAC",
        "label": "North Pacific High Seas Forecast",
        "office": "KWBC",
    },
    "south-pacific": {
        "type": "HSFEP2",
        "label": "South Pacific High Seas Forecast",
        "office": "KWBC",
    },
    "north-atlantic": {
        "type": "HSFAT1",
        "label": "North Atlantic High Seas Forecast",
        "office": "KWBC",
    },
}

# Simple in-memory cache: { ocean: { fetched_at, data } }
_hs_cache: Dict[str, Dict] = {}
_HS_CACHE_TTL = 3 * 3600  # 3-hour TTL — bulletins issued 4× daily


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

async def _fetch_latest_bulletin(ocean: str) -> Optional[str]:
    """Return the raw text of the most recent bulletin for *ocean*, or None."""
    cfg = _OCEAN_PRODUCT_MAP.get(ocean)
    if not cfg:
        return None

    list_url = f"{_NWS_PRODUCTS_BASE}/{cfg['type']}/locations/{cfg['office']}"
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
        # Type + coordinates + pressure
        r"(LOW|HIGH|TROPICAL\s+STORM|TROPICAL\s+DEPRESSION|HURRICANE|TYPHOON)"
        r"[\s,]+(\d+(?:\.\d+)?[NS])\s+(\d+(?:\.\d+)?[EW])"
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

                # Wind speed — look for "WINDS TO XX KT" or "MAX WINDS XX KT"
                wind_m = re.search(
                    r"(?:WINDS?\s+TO|MAX\s+WINDS?)\s+(\d+)\s*KT",
                    sec,
                    re.IGNORECASE,
                )
                wind_kts = int(wind_m.group(1)) if wind_m else None

                # Sea heights — "SEAS XX TO YY FT"
                seas_m = re.search(
                    r"SEAS?\s+(\d+)\s+TO\s+(\d+)\s*FT",
                    sec,
                    re.IGNORECASE,
                )
                sea_min_ft = int(seas_m.group(1)) if seas_m else None
                sea_max_ft = int(seas_m.group(2)) if seas_m else None

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

                entry: Dict = {
                    "type": sys_type,
                    "lat": lat,
                    "lon": lon,
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
