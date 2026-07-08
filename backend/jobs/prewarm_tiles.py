"""
jobs/prewarm_tiles.py — pre-bake wind tiles after each GFS run lands.

Fetches float grids for every hour in the tile cadence, renders the low-zoom
PNG pyramid (z0..PREWARM_MAX_Z) plus the uv texture per hour, and purges
caches for stale runs. Run from cron ~5 minutes after GFS availability
(aligned with the storm detector timer), or manually:

    cd backend && source venv/bin/activate && python -m jobs.prewarm_tiles
"""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import overlay_tiles as ot

PREWARM_MAX_Z = 3       # z0-3 globally = 85 tiles per hour per variable
PREWARM_VARS = ("speed",)  # gust bakes on demand (~13 ms/tile); keeps disk <1 GB/run
FETCH_CONCURRENCY = 3   # simultaneous NOMADS GRIB downloads


async def prewarm_hour(model: str, run_id: str, hour: int) -> bool:
    grids = await ot.get_grids(model, run_id, hour)
    if grids is None:
        print(f"⚠️ prewarm: no data for f{hour:03d}, skipping")
        return False

    baked = 0
    for var in PREWARM_VARS:
        for z in range(0, PREWARM_MAX_Z + 1):
            for x in range(2 ** z):
                for y in range(2 ** z):
                    path = ot.png_tile_path(model, run_id, hour, var, z, x, y, scale=1)
                    if path.exists():
                        continue
                    png = ot.render_png_tile(grids, z, x, y, variable=var)
                    if png is None:
                        break  # variable absent from this run
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(png)
                    baked += 1

    uv_path = ot.uv_texture_path(model, run_id, hour)
    if not uv_path.exists():
        png, _ = ot.render_uv_texture(grids)
        uv_path.parent.mkdir(parents=True, exist_ok=True)
        uv_path.write_bytes(png)
        baked += 1

    print(f"✅ prewarm: f{hour:03d} done ({baked} artifacts)")
    return True


async def main(model: str = "gfs") -> None:
    started = time.time()
    run_id = await ot.resolve_latest_run(model)
    if not run_id:
        print("❌ prewarm: could not resolve latest run")
        return

    print(f"🔥 prewarm: {model} run {run_id}, {len(ot.TILE_HOURS)} hours, z0-{PREWARM_MAX_Z}")

    sem = asyncio.Semaphore(FETCH_CONCURRENCY)

    async def _one(hour: int) -> bool:
        async with sem:
            return await prewarm_hour(model, run_id, hour)

    results = await asyncio.gather(*[_one(h) for h in ot.TILE_HOURS])
    ok = sum(1 for r in results if r)

    purged = ot.purge_old_runs(model, keep_runs=2)
    stats = ot.cache_stats()
    print(
        f"🏁 prewarm: {ok}/{len(ot.TILE_HOURS)} hours in {time.time() - started:.0f}s; "
        f"purged {purged} stale runs; "
        f"disk: grids {stats['grids']['bytes'] // 2**20} MB, png {stats['png']['bytes'] // 2**20} MB"
    )


if __name__ == "__main__":
    asyncio.run(main())
