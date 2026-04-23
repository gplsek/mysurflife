# Pre-Bake Forecast Job — Implementation Spec

**Status:** ✅ Implemented — `backend/jobs/fetch_forecasts.py`
**Owner:** Claude Code
**Created:** 2026-04-21
**Implemented:** 2026-04-21
**Related:**
- [`DATA_SOURCES_AND_INGESTION.md`](./DATA_SOURCES_AND_INGESTION.md) — Section 4
- [`BACKEND_EFFICIENCY_AUDIT.md`](./BACKEND_EFFICIENCY_AUDIT.md) — Problem 1
- `backend/jobs/buoy_refresh.py` — existing pattern to follow
- `backend/tides.py` — `fetch_tide_timeline()` and `_FALLBACK_STATIONS`

---

## Why This Exists

The forecast-timeline endpoint is currently parallelized but still live —
first request after cache expiry hits NOMADS in real time. The pre-bake job
eliminates that entirely. Data is ready before any user asks for it.

The scheduler cadence is the critical design decision. A fixed-interval loop
wastes fetches and doesn't align with when NOMADS actually has fresh data.
Model-run-aligned triggers are the right pattern.

---

## Exact Implementation

### 1. `backend/jobs/fetch_forecasts.py`

#### `prebake_spot(spot_slug, spot_lat, spot_lon, tide_station_id)`

Fetches and caches the full forecast for one spot from the current GFS run.

```python
async def prebake_spot(
    spot_slug: str,
    spot_lat: float,
    spot_lon: float,
    tide_station_id: str,
) -> bool:
    """
    Pre-fetches and caches the complete forecast for one spot.
    Called by run_forecast_prebake_loop() for every spot in the DB.

    Writes to Redis:
      forecast:{slug}:{run_date}:{run_cycle}  TTL=7 hours
      tides:{station_id}:{begin}:{end}         TTL=24 hours (via tides.py cache)

    Returns True on success, False on failure (caller logs and continues).
    """
```

**Wave fetch strategy:**
- Resolve current run date + cycle (use the same heuristic already in main.py)
- Build Grib Filter URL for `epacif.0p16` if spot is in Eastern Pacific,
  `global.0p16` otherwise (use `_select_ww3_domain()` from main.py)
- Fetch ONE GRIB2 file per domain — it contains all forecast hours
- Parse with cfgrib, extract nearest lat/lon grid point for ALL time steps at once
- No loop over hours — one fetch, one parse, all 64 time steps

**Wind fetch strategy:**
- Same pattern — one GFS GRIB2 file per forecast run covers all hours
- Extract U10/V10 at spot lat/lon for all time steps

**Timeline assembly:**
```python
timeline = []
for hour in range(0, 385, 6):  # 0 to 384 inclusive
    timeline.append({
        "hour": hour,
        "wave": wave_by_hour.get(hour),   # {hs, period, direction}
        "wind": wind_by_hour.get(hour),   # {speed_mph, direction}
        # tide added separately via tides.py
    })
```

**Redis key format:**
```
forecast:{slug}:{YYYYMMDD}:{HH}
e.g. forecast:blacks-beach:20260422:06
TTL: 7 hours (covers until next run's data lands)
```

#### `run_forecast_prebake_loop(get_all_spots)`

Model-run-aligned scheduler. Runs 4× per day only.

```python
async def run_forecast_prebake_loop(get_all_spots):
    """
    Waits until the next model-run-aligned trigger, then pre-bakes
    forecast data for all spots.

    Trigger times (UTC):
      04:15 — GFS 00Z run, available on NOMADS ~04:00Z
      10:15 — GFS 06Z run, available ~10:00Z
      16:15 — GFS 12Z run, available ~16:00Z
      22:15 — GFS 18Z run, available ~22:00Z

    The 15-minute buffer ensures NOMADS has finished publishing
    before we start fetching.
    """
    TRIGGERS_UTC = [4.25, 10.25, 16.25, 22.25]  # hours

    # Startup: small delay to let the app initialize, then check
    # if we missed a recent trigger (e.g. app restarted at 10:30Z —
    # we should run immediately rather than waiting until 16:15Z)
    await asyncio.sleep(30)

    while True:
        now_utc = datetime.now(timezone.utc)
        now_h = now_utc.hour + now_utc.minute / 60

        # Find the next trigger time
        next_h = next((t for t in TRIGGERS_UTC if t > now_h), TRIGGERS_UTC[0] + 24)
        wait_s = (next_h - now_h) * 3600

        print(f"⏰ Forecast pre-bake: next run in {wait_s/3600:.1f}h "
              f"at {int(next_h % 24):02d}:{int((next_h % 1) * 60):02d}Z")

        await asyncio.sleep(wait_s)

        # Run the pre-bake
        spots = get_all_spots()
        print(f"🔮 Pre-baking forecasts for {len(spots)} spots...")

        results = await asyncio.gather(
            *[
                prebake_spot(
                    s["slug"], s["lat"], s["lon"],
                    s.get("tide_station_id") or _fallback_tide_station(s["slug"])
                )
                for s in spots
            ],
            return_exceptions=True
        )

        ok = sum(1 for r in results if r is True)
        print(f"✅ Pre-bake complete: {ok}/{len(spots)} spots succeeded")
```

#### `_fallback_tide_station(spot_slug)`

```python
def _fallback_tide_station(spot_slug: str) -> str:
    """
    Returns the fallback tide station for a spot slug.
    Uses _FALLBACK_STATIONS from tides.py.
    Import at top of file:
      from tides import _FALLBACK_STATIONS, _DEFAULT_STATION
    """
    station_id, _ = _FALLBACK_STATIONS.get(spot_slug, _DEFAULT_STATION)
    return station_id
```

### 2. Wire into `startup()` in `main.py`

```python
# In startup() lifespan handler, alongside the existing buoy refresh task:
from jobs.fetch_forecasts import run_forecast_prebake_loop

asyncio.create_task(
    run_forecast_prebake_loop(get_all_spots)
)
```

`get_all_spots` is the existing function from `buoy_registry.py` — it returns
all spots from the DB. The job uses the same spot list that buoy refresh uses.

### 3. Update `get_surf_spot_forecast_timeline()` in `main.py`

Add a Redis pre-bake cache check at the top of the function, before any
live fetch logic. The existing live fetch becomes the fallback on cache miss.

```python
@app.get("/api/surf-spots/{slug}/forecast-timeline")
async def get_surf_spot_forecast_timeline(slug: str, hours: int = 180):
    # 1. Try pre-baked cache first
    run_date, run_cycle = _resolve_current_gfs_run()
    prebake_key = f"forecast:{slug}:{run_date}:{run_cycle}"

    if _redis_client:
        cached = _redis_client.get(prebake_key)
        if cached:
            print(f"⚡ Serving pre-baked forecast for {slug}")
            return json.loads(cached)

    # 2. Cache miss — fall back to existing live fetch (already parallelized)
    print(f"⚠️  Pre-bake cache miss for {slug}, fetching live...")
    # ... existing asyncio.gather() logic unchanged ...
```

### 4. Tide pre-bake (same job file)

The tide pre-bake is a thin addition to `prebake_spot()`:

```python
# Inside prebake_spot(), after wave + wind are cached:
from tides import fetch_tide_timeline, fetch_hilo

start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)
end = start + timedelta(days=7)

# fetch_tide_timeline() has its own internal cache (_tide_cache dict in tides.py)
# Calling it here pre-warms that cache so the first user request is instant
await fetch_tide_timeline(tide_station_id, start, end)
await fetch_hilo(tide_station_id, start, end)
```

Tides don't need Redis — the in-memory `_tide_cache` in `tides.py` with 6-hour
TTL is sufficient since tide predictions are deterministic and slow-changing.

---

## What Does NOT Change

- All existing API contracts stay identical
- `get_surf_spot_forecast_timeline()` response shape is unchanged
- The live fetch fallback stays in place for cache misses
- `buoy_refresh.py` is untouched — this is a separate job
- No new dependencies — cfgrib is already in requirements.txt

---

## Redis Key Summary

After this job is running, Redis contains:

```
buoy:{station_id}                    TTL=5min   (buoy_refresh.py — existing)
forecast:{slug}:{date}:{cycle}       TTL=7hr    (fetch_forecasts.py — new)
tides:{station_id}:{begin}:{end}     TTL=6hr    (tides.py in-memory — existing)
wind_overlay:{...}                   TTL=10min  (main.py — existing)
ww3:{...}                            TTL=10min  (main.py — existing)
```

---

## Acceptance Criteria

- [ ] `prebake_spot()` runs without error for `blacks-beach`, `cardiff-reef`, `lowers`
- [ ] Redis contains `forecast:blacks-beach:{today}:{cycle}` after first trigger
- [ ] `GET /api/surf-spots/blacks-beach/forecast-timeline` logs "📦 Pre-baked cache hit"
      on second request (log message in implementation; spec said "⚡ Serving pre-baked")
- [ ] After app restart at any time, loop runs immediately (startup pre-bake, then
      trigger-aligned loop — no multi-hour gaps)
- [ ] If NOMADS is down during a scheduled run, job logs the error and continues
      to the next trigger without crashing
- [ ] Tide data pre-warmed for all stations in `_FALLBACK_STATIONS`

---

## Startup Behavior on App Restart

One edge case worth handling: if the app restarts at 10:30Z, the 10:15Z trigger
was missed. Without special handling, the loop would wait until 16:15Z — a 5.5
hour gap with stale cache.

**Fix:** On startup, after the 30-second delay, check if any trigger was missed
within the last 2 hours. If yes, run immediately.

```python
# After await asyncio.sleep(30) at startup:
now_h = now_utc.hour + now_utc.minute / 60
last_trigger = max((t for t in TRIGGERS_UTC if t <= now_h), default=TRIGGERS_UTC[-1])
time_since_last = (now_h - last_trigger) * 3600  # seconds

if time_since_last < 7200:  # missed a trigger within 2 hours
    print(f"⚡ Missed trigger at {last_trigger:.2f}Z — running pre-bake immediately")
    await _run_prebake(get_all_spots)
```

---

## Implementation Notes (actual vs spec)

**Wave/wind fetch:** Spec describes "one GRIB file containing all forecast hours".
In practice, the NOMADS GRIB filter serves one file per forecast hour — the correct
single-request approach is OPeNDAP/pydap (`xr.open_dataset(url, engine="pydap")`),
which opens the full dataset (all time steps) and extracts the nearest point across
all hours in one call. That's what's implemented.

**Tide placement:** Spec puts tide pre-warm inside `prebake_spot()`. Implementation
separates it as `prebake_tides()` called after all spots complete in `prebake_all_spots()`.
Same outcome — all tide station caches are pre-warmed before users make requests.

**Startup behavior:** Implementation runs a full pre-bake immediately on startup
(after 60s delay) before entering the trigger-aligned loop. This naturally handles
the missed-trigger-on-restart case — simpler than the explicit missed-trigger check
in the spec, same effect.

---

**Last updated:** 2026-04-21
**Build time estimate:** 3-4 hours (actual: ~1 hour)
**Risk:** Low — additive only, existing fallback stays in place
