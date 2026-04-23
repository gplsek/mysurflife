"""
rate_spots.py — Pre-bake spot ratings into the spot_ratings table.

Usage:
    python -m jobs.rate_spots --tier 1        # CA + HI (buoy-based, ~100 spots)
    python -m jobs.rate_spots --tier 2        # Rest of NA + MX (~500 spots, Open-Meteo)
    python -m jobs.rate_spots --tier 3        # Global (~5000 spots, Open-Meteo)
    python -m jobs.rate_spots --tier all      # Run all tiers sequentially

Cadence (systemd timer or cron):
    Tier 1: every 15 min
    Tier 2: every 60 min
    Tier 3: every 6 hours

The score stored in spot_ratings.rating is 0-5 (overall_score / 2).
"""
import argparse
import asyncio
import time
from typing import Dict, List, Optional

import httpx

# ── Semaphore (Open-Meteo safe at ~10k/day per IP) ───────────────────────────
_OM_SEM = asyncio.Semaphore(6)

# ── Tier 1 region tags (CA + HI editorial picks) ─────────────────────────────
_TIER1_REGIONS = {
    "California", "Southern California", "Central California", "Northern California",
    "Hawaii", "San Diego", "Los Angeles", "Santa Barbara",
}

_TIER2_REGIONS = {
    "Oregon", "Washington", "Pacific Northwest",
    "Baja California", "Mexico", "Central America",
    "US East Coast", "Florida", "Puerto Rico",
}


async def _fetch_all_spots(client) -> List[Dict]:
    resp = client.table("spots").select(
        "slug, name, region, latitude, longitude"
    ).execute()
    return resp.data or []


async def _upsert_ratings(client, rows: List[Dict]) -> None:
    if not rows:
        return
    client.table("spot_ratings").upsert(rows, on_conflict="spot_slug").execute()


# ── Tier 1 — buoy-based scoring (CA / HI) ────────────────────────────────────

async def run_tier1() -> None:
    t0 = time.time()
    from database import get_supabase_admin_client, supabase
    from buoy_service import get_buoy_data_cache
    from surf_scoring import calculate_spot_score

    client = get_supabase_admin_client() or supabase
    if not client:
        print("❌ rate_spots tier1: no DB client")
        return

    all_spots = await _fetch_all_spots(client)
    tier1_spots = [
        s for s in all_spots
        if any(r in (s.get("region") or "") for r in _TIER1_REGIONS)
    ]

    if not tier1_spots:
        print("⚠️  rate_spots tier1: no tier-1 spots found")
        return

    print(f"🌊 rate_spots tier1: scoring {len(tier1_spots)} spots")
    buoy_cache = await get_buoy_data_cache()

    rows = []
    for spot in tier1_spots:
        try:
            result = await calculate_spot_score(spot["slug"], buoy_cache)
            if not result or result.get("error"):
                continue

            score_0_5 = round(result["overall_score"] / 2, 1)
            water_c   = result.get("water_temp_c")
            swell_dir = result.get("swell_direction")
            wind_dir  = result.get("wind_direction")
            rows.append({
                "spot_slug":        spot["slug"],
                "rating":           score_0_5,
                "primary_swell_ft": result.get("wave_height_ft"),
                "primary_period_s": result.get("period_sec"),
                "primary_swell_dir": int(swell_dir) if swell_dir is not None else None,
                "wind_mph":         result.get("wind_speed_mph"),
                "wind_dir":         int(wind_dir) if wind_dir is not None else None,
                "water_temp_f":     round(water_c * 9/5 + 32, 1) if water_c is not None else None,
                "forecast_hour":    0,
                "source":           "buoy",
            })
        except Exception as e:
            print(f"⚠️  rate_spots tier1: {spot['slug']}: {e}")

    await _upsert_ratings(client, rows)
    print(f"✅ rate_spots tier1: {len(rows)} rows upserted in {time.time()-t0:.1f}s")


# ── Tiers 2 & 3 — Open-Meteo point scoring ───────────────────────────────────

async def _score_from_openmeteo(lat: float, lon: float, http: httpx.AsyncClient) -> Optional[Dict]:
    """Fetch Open-Meteo current-hour data and return a simple score dict."""
    try:
        async with _OM_SEM:
            marine_url = (
                "https://marine-api.open-meteo.com/v1/marine"
                f"?latitude={lat:.3f}&longitude={lon:.3f}"
                "&hourly=wave_height,wave_period,wave_direction"
                "&forecast_days=1&timezone=UTC"
            )
            wind_url = (
                "https://api.open-meteo.com/v1/forecast"
                f"?latitude={lat:.3f}&longitude={lon:.3f}"
                "&hourly=windspeed_10m,winddirection_10m"
                "&forecast_days=1&timezone=UTC"
            )
            marine_r, wind_r = await asyncio.gather(
                http.get(marine_url, timeout=15.0),
                http.get(wind_url,   timeout=15.0),
            )
            marine_r.raise_for_status()
            wind_r.raise_for_status()
            m = marine_r.json().get("hourly", {})
            w = wind_r.json().get("hourly", {})

            wvht_m  = (m.get("wave_height",    [None]) or [None])[0]
            period  = (m.get("wave_period",     [None]) or [None])[0]
            wvdir   = (m.get("wave_direction",  [None]) or [None])[0]
            wspd_ms = (w.get("windspeed_10m",   [None]) or [None])[0]
            wdir    = (w.get("winddirection_10m",[None]) or [None])[0]

            if wvht_m is None:
                return None

            wvht_ft = wvht_m * 3.28084
            wspd_ms_v = wspd_ms / 3.6 if wspd_ms is not None else None  # km/h → m/s

            # Generic scoring heuristic (no per-spot windows)
            if wvht_ft < 1.0:
                score = 0.5
            elif wvht_ft < 2.0:
                score = 1.5 + min(0.5, (period or 0) / 20)
            elif wvht_ft < 3.5:
                score = 2.5 + min(0.5, (period or 0) / 20)
            elif wvht_ft < 5.0:
                score = 3.5 + min(0.5, (period or 0) / 20)
            else:
                score = 4.5

            # Wind penalty (strong onshore ~ unknown direction here, just penalize >20 knots)
            if wspd_ms_v and wspd_ms_v > 10:
                score = max(0, score - 0.5)

            return {
                "rating":           round(min(5.0, score), 1),
                "primary_swell_ft": round(wvht_ft, 1),
                "primary_period_s": period,
                "primary_swell_dir": int(wvdir) if wvdir is not None else None,
                "wind_mph":          round(wspd_ms_v * 2.237, 1) if wspd_ms_v else None,
                "wind_dir":          int(wdir) if wdir is not None else None,
                "water_temp_f":      None,
                "forecast_hour":     0,
                "source":            "openmeteo",
            }
    except Exception as e:
        return None


async def run_tier2_or_3(tier: int) -> None:
    t0 = time.time()
    from database import get_supabase_admin_client, supabase
    client = get_supabase_admin_client() or supabase
    if not client:
        print(f"❌ rate_spots tier{tier}: no DB client")
        return

    all_spots = await _fetch_all_spots(client)
    target_regions = _TIER2_REGIONS if tier == 2 else None
    candidates = [
        s for s in all_spots
        if (target_regions is None or any(r in (s.get("region") or "") for r in target_regions))
        and not any(r in (s.get("region") or "") for r in _TIER1_REGIONS)
    ]

    if not candidates:
        print(f"⚠️  rate_spots tier{tier}: no spots found")
        return

    print(f"🌊 rate_spots tier{tier}: scoring {len(candidates)} spots via Open-Meteo")

    rows = []
    async with httpx.AsyncClient() as http:
        sem = asyncio.Semaphore(8)

        async def _score_spot(spot):
            async with sem:
                result = await _score_from_openmeteo(spot["latitude"], spot["longitude"], http)
                if result:
                    rows.append({"spot_slug": spot["slug"], **result})

        await asyncio.gather(*[_score_spot(s) for s in candidates])

    await _upsert_ratings(client, rows)
    print(f"✅ rate_spots tier{tier}: {len(rows)} rows upserted in {time.time()-t0:.1f}s")


# ── CLI entrypoint ────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Pre-bake spot ratings")
    parser.add_argument("--tier", default="1", choices=["1", "2", "3", "all"])
    args = parser.parse_args()

    if args.tier in ("1", "all"):
        await run_tier1()
    if args.tier in ("2", "all"):
        await run_tier2_or_3(2)
    if args.tier in ("3", "all"):
        await run_tier2_or_3(3)


if __name__ == "__main__":
    asyncio.run(main())
