"""
Background buoy refresh job.

Pre-warms the L1 cache for all buoys every REFRESH_INTERVAL seconds so
/api/buoy-status/all responses are served from cache with near-zero latency.
NDBC updates data every ~10 minutes; we refresh every 5 minutes.
"""
import asyncio
from typing import Callable, List, Dict

REFRESH_INTERVAL = 5 * 60   # seconds between refreshes
STARTUP_DELAY    = 20        # seconds after app start before first refresh


async def run_buoy_refresh_loop(
    fetch_buoy_data: Callable,
    get_all_buoys: Callable,
) -> None:
    """
    Long-running background task. Start with asyncio.create_task() in startup().
    Fetches all buoys with use_cache=False so each run writes fresh data to cache.
    """
    await asyncio.sleep(STARTUP_DELAY)

    while True:
        try:
            buoy_list: List[Dict] = get_all_buoys() or []
            if not buoy_list:
                await asyncio.sleep(REFRESH_INTERVAL)
                continue

            tasks = [
                fetch_buoy_data(
                    b["id"],
                    use_cache=False,
                    wind_fallback_station=b.get("wind_fallback"),
                )
                for b in buoy_list
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            ok    = sum(1 for r in results if isinstance(r, dict) and "error" not in r)
            errs  = len(results) - ok
            print(f"✅ Buoy refresh: {ok}/{len(buoy_list)} OK" + (f", {errs} errors" if errs else ""))

        except Exception as e:
            print(f"⚠️  Buoy refresh loop error: {e}")

        await asyncio.sleep(REFRESH_INTERVAL)
