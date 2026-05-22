"""jobs/generate_spot_configs.py — batch spot-config generator (A2).

For spots missing swell/wind windows, propose:
  - wind windows from coastline geometry (services.spot_orientation, source='geo')
  - swell windows from the LLM grounded by that facing (services.spot_config_llm, source='llm'/'geo')

Safe by design: only fills MISSING window types — never touches existing rows, so any
hand-tuned ('human') config is preserved. Dry-run by default; --apply writes.

Usage:
    python -m jobs.generate_spot_configs                # dry-run, all spots missing config
    python -m jobs.generate_spot_configs --spot swamis  # one spot
    python -m jobs.generate_spot_configs --apply        # write to DB
    python -m jobs.generate_spot_configs --limit 50 --apply
"""
from __future__ import annotations

import asyncio
from typing import Dict, List, Optional


async def run(apply: bool = False, spot_slug: Optional[str] = None, limit: Optional[int] = None) -> None:
    from database import get_supabase_admin_client
    from services.spot_orientation import derive_offshore_direction, suggest_wind_windows
    from services.spot_config_llm import generate_swell_windows

    client = get_supabase_admin_client()
    if not client:
        print("❌ no DB client")
        return

    q = client.table("spots").select("id,slug,name,region,country,latitude,longitude")
    if spot_slug:
        q = q.eq("slug", spot_slug)
    spots = (q.execute().data or [])
    if limit:
        spots = spots[:limit]

    # Existing window coverage (any row of a type ⇒ skip that type, preserve it).
    wind_have  = {w["spot_id"] for w in (client.table("spot_wind_windows").select("spot_id").execute().data or [])}
    swell_have = {w["spot_id"] for w in (client.table("spot_swell_windows").select("spot_id").execute().data or [])}

    mode = "APPLY" if apply else "DRY-RUN"
    print(f"🧭 generate_spot_configs [{mode}] — {len(spots)} spot(s)\n")
    n_wind = n_swell = n_skip = 0

    for s in spots:
        sid, name = s["id"], s["name"]
        has_wind, has_swell = sid in wind_have, sid in swell_have
        if has_wind and has_swell:
            n_skip += 1
            continue

        o = derive_offshore_direction(s["latitude"], s["longitude"])
        facing = o["facing_deg"] if o else None
        facing_c = o["facing_compass"] if o else None

        wind_rows: List[Dict] = []
        if not has_wind:
            ww = suggest_wind_windows(s["latitude"], s["longitude"])
            if ww:
                wind_rows = [{**w, "source": "geo", "spot_id": sid} for w in ww]

        swell_rows: List[Dict] = []
        if not has_swell:
            sw = await generate_swell_windows(s, facing, facing_c)
            if sw:
                swell_rows = [{**w, "spot_id": sid} for w in sw]

        if not wind_rows and not swell_rows:
            print(f"  • {name}: no orientation derivable (open ocean / landlocked) — skipped")
            n_skip += 1
            continue

        off = o["offshore_compass"] if o else "?"
        print(f"  • {name} (facing {facing_c or '?'}, offshore {off}):")
        for w in wind_rows:
            print(f"      wind  [{w['category']:13s}] {w['dir_min']:>3}–{w['dir_max']:>3}°  w={w['weight']} [{w['source']}]")
        for w in swell_rows:
            print(f"      swell {w['dir_min']:>3}–{w['dir_max']:>3}°  ≥{w['period_min_sec']}s  w={w['weight']} [{w['source']}]")

        if apply:
            if wind_rows:
                client.table("spot_wind_windows").insert(wind_rows).execute()
                n_wind += len(wind_rows)
            if swell_rows:
                client.table("spot_swell_windows").insert(swell_rows).execute()
                n_swell += len(swell_rows)

    print(f"\n{'✅ wrote' if apply else 'would write'}: {n_wind} wind + {n_swell} swell windows; "
          f"skipped {n_skip} spot(s).")
    if not apply:
        print("(dry-run — re-run with --apply to write)")


if __name__ == "__main__":
    import argparse
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass

    p = argparse.ArgumentParser(description="Generate spot swell/wind windows")
    p.add_argument("--apply", action="store_true", help="Write to DB (default: dry-run)")
    p.add_argument("--spot", help="Only this spot slug")
    p.add_argument("--limit", type=int, help="Cap number of spots processed")
    args = p.parse_args()
    asyncio.run(run(apply=args.apply, spot_slug=args.spot, limit=args.limit))
