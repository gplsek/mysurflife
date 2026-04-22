# Backend Efficiency Audit & Refactor Plan

**Status:** 📋 Planning
**Created:** 2026-04-21
**Based on:** Full audit of `backend/main.py` (4,431 lines)
**Related:**
- [`DATA_SOURCES_AND_INGESTION.md`](./DATA_SOURCES_AND_INGESTION.md) — source migration (OPeNDAP → Grib Filter)
- [`SWELL_ARRIVAL_PHYSICS.md`](./SWELL_ARRIVAL_PHYSICS.md)
- `backend/tides.py`, `backend/swell_physics.py` — new modules

---

## Executive Summary

`main.py` has grown to 4,431 lines and has several serious efficiency problems.
The worst offender by far is `forecast-timeline`, which makes **60 sequential
upstream API calls per user request** — one per forecast hour. On a cold cache
this takes 3-10 minutes and almost certainly times out in production.

The second critical issue is the **OPeNDAP shutdown** (February 23, 2026) which
broke the entire WW3 wave data pipeline — `fetch_real_noaa_ww3_opendap()` is
calling dead URLs.

Beyond those two blockers, there are several medium-priority issues: redundant
duplicate endpoints, a surf height formula that should use the Stormsurf
Category Table, unnecessary WW3 model calls on every `/conditions` request,
and a monolithic file that makes everything hard to test and maintain.

---

## Problem 1: `forecast-timeline` Makes 60 Sequential API Calls 🔴

**File:** `main.py` lines 3632–3761
**Endpoint:** `GET /api/surf-spots/{slug}/forecast-timeline`

### What it does (wrong way)
```python
forecast_hours = list(range(0, 181, 6))  # [0, 6, 12, 18, ..., 180] = 31 points

for forecast_hour in forecast_hours:        # ← SEQUENTIAL LOOP
    wave_response = await get_waves_overlay(...)   # upstream API call
    wind_response = await get_wind_overlay(...)    # another upstream API call
    forecast_timeline.append(...)
```

Two upstream calls × 31 hours = **62 sequential upstream API calls per request.**
Each call hits NOMADS (or the dead OPeNDAP server) with a new HTTP request.
At 2-5 seconds per call cold, this is 2-10 minutes per user request.

Even with caching, the cache miss on first request or after expiry is brutal.

### Root cause
The architecture is **pull-on-demand** instead of **push-on-schedule**.
Every user request triggers upstream fetches instead of serving pre-fetched data.

### The fix: Pre-baked forecast cache
GFS-Wave and GFS wind models run 4 times per day (00Z, 06Z, 12Z, 18Z).
The entire 384-hour forecast for a given spot is knowable at model run time.
There is no reason to fetch it piecemeal on user requests.

**New architecture:**
```
[Background job — runs 4x/day, 4 hours after each model run]
  → Fetch GFS-Wave for all favorite spots (single GRIB2 file covers all hours)
  → Fetch GFS wind for all favorite spots
  → Parse all 31 forecast hours at once from the single GRIB2 response
  → Store full timeline in Redis: key="forecast:{slug}:{run_date}:{run_cycle}"
  → TTL: 6 hours (until next model run)

[/api/surf-spots/{slug}/forecast-timeline]
  → Read from Redis cache (< 5ms)
  → If cache miss: trigger background fetch, return 202 + partial data
  → Never make synchronous upstream calls
```

**Implementation:** `backend/jobs/fetch_forecasts.py`

```python
async def prefetch_spot_forecast(slug: str, lat: float, lon: float):
    """
    Fetch the complete forecast timeline for one spot from one GFS-Wave run.
    Called by the background scheduler, not by user requests.

    Single GRIB2 file per variable per run covers ALL forecast hours.
    Parse once → store all 31 time steps → serve from cache instantly.
    """
    run_date, run_cycle = await _resolve_latest_gfs_run()

    # Fetch wave GRIB2 for entire run (all hours at once via GRIB filter)
    # This is ONE network request that covers hours 0-384
    wave_url = build_gfswave_url(run_date, run_cycle, hour="all", ...)
    wave_grib = await httpx.get(wave_url)
    wave_by_hour = parse_grib_all_hours(wave_grib, lat, lon)

    # Same for wind
    wind_url = build_gfs_wind_url(run_date, run_cycle, hour="all", ...)
    wind_grib = await httpx.get(wind_url)
    wind_by_hour = parse_grib_all_hours(wind_grib, lat, lon)

    # Merge and store
    timeline = merge_wave_wind_by_hour(wave_by_hour, wind_by_hour)
    await redis.setex(
        f"forecast:{slug}:{run_date}:{run_cycle}",
        21600,  # 6 hour TTL
        json.dumps(timeline)
    )
```

**Expected improvement:** 62 sequential calls → 2 parallel calls → serve from cache.
Response time: minutes → milliseconds.

---

## Problem 2: OPeNDAP URLs Are Dead 🔴

**File:** `main.py` line ~2400
```python
opendap_url = f"https://nomads.ncep.noaa.gov/dods/wave/gfswave/{run_date}/..."
```

**This URL format was shut down February 23, 2026.**

The wind fetch (`fetch_real_noaa_wind`) already uses the Grib Filter correctly.
The wave fetch (`fetch_real_noaa_ww3_opendap`) still uses OPeNDAP and is broken.

**Fix:** Migrate `fetch_real_noaa_ww3_opendap()` to use Grib Filter,
matching the pattern already established in `fetch_real_noaa_wind()`.
New home: `backend/data_sources/gfs_wave.py`.

See `DATA_SOURCES_AND_INGESTION.md` Section 3.1 for exact URL patterns.

---

## Problem 3: `calculate_surf_height` Uses Wrong Formula 🟡

**File:** `main.py` lines 244–278

```python
def calculate_surf_height(wave_height_m: float, dpd_sec: float) -> float:
    mult = max(1.0, min(2.2, 0.6 + 0.08 * dpd_sec))
    return round(wave_height_m * mult, 2)
```

This is a homemade linear multiplier. It's not wrong in direction but
it lacks the period-specific accuracy of the Stormsurf Category Table.

**The problem:** A 6ft @ 9s swell and a 6ft @ 17s swell both get multiplied
by different factors, but the Stormsurf table tells us those are Category 2
and Category 4 swells respectively — a 2-category difference in actual
face height (5-7.5ft vs 10-15ft). The current formula understates the
difference between short and long period swells at the same height.

**Fix:** Replace with `swell_category()` lookup from `swell_physics.py`.
The category gives a face height range, not a single number — which is more
honest and more useful for the Copilot's natural language output anyway.

```python
# Replace calculate_surf_height() calls with:
from swell_physics import swell_category, category_face_height

cat = swell_category(wave_height_ft, period_s)
face_min, face_max = category_face_height(cat)
face_mid = (face_min + face_max) / 2
```

---

## Problem 4: `/conditions` Makes a Redundant WW3 Overlay Call 🟡

**File:** `main.py` lines 3413–3523
**Endpoint:** `GET /api/surf-spots/{slug}/conditions`

On every request this endpoint:
1. Fetches all buoys in the blend ✅ (correct, cached)
2. Calls `get_waves_overlay()` to add WW3 as a "synthetic buoy" at 20% weight

The overlay call fetches a full spatial grid just to extract one point.
That's pulling an entire GRIB2 region to get a single lat/lon value.

**Fix:** Add a `/api/wave-point` endpoint (or use the existing one at line 3111)
that fetches only the nearest grid point at the spot's coordinates, not a full
overlay. The `wave-point` endpoint already exists — use it here instead.

```python
# Instead of get_waves_overlay() with a tiny bbox:
wave_point = await get_wave_point(lat=lat, lon=lon, model="ww3", forecast_hour=0)
```

Better yet, once the forecast pre-bake job is running, pull the `hour=0`
value directly from the pre-baked cache — no upstream call at all.

---

## Problem 5: Duplicate/Redundant Endpoints 🟡

There are two near-identical AI analysis endpoint trees:

**Tree A** (buoy-based, older):
- `GET /api/ai/spot-analysis/{buoy_id}`
- `POST /api/ai/spot-analysis/{buoy_id}/generate`
- `POST /api/ai/spot-analysis/batch-generate`
- `GET /api/ai/analyses/all`
- `DELETE /api/ai/spot-analysis/{analysis_id}`
- `POST /api/ai/spot-analysis/{analysis_id}/feedback`
- `GET /api/ai/stats`

**Tree B** (slug-based, newer):
- `GET /api/spots/{spot_slug}/ai-analysis/all`
- `GET /api/spots/{spot_slug}/ai-analysis`
- `POST /api/spots/{spot_slug}/ai-analysis/generate`
- `POST /api/spots/{spot_slug}/ai-analysis/generate-openai`
- `POST /api/spots/ai-analysis/batch-generate`

Tree A uses `buoy_id` as the key. Tree B uses `spot_slug`. They likely
write to different tables or overlap. The frontend probably uses Tree B.

**Fix:** Audit which tree the Copilot and frontend actually call. Deprecate
Tree A. Consolidate to Tree B. Remove ~200 lines of dead code.

Also: `GET /api/buoy-status` (line 948) returns only the primary buoy — 
this appears to be a legacy single-buoy endpoint superseded by
`GET /api/buoy-status/all`. Verify it's unused and remove it.

---

## Problem 6: `get_all_buoys_endpoint` Has No Rate Protection 🟡

**File:** `main.py` lines 956–988

```python
tasks = [
    fetch_buoy_data(buoy[\"id\"], ...)
    for buoy in buoy_list    # 36 buoys
]
results = await asyncio.gather(*tasks, return_exceptions=True)
```

This fires 36 concurrent NDBC requests. `NDBC_SEM = asyncio.Semaphore(12)`
limits it to 12 at a time, which is fine. But there's no background
pre-fetching — every call to `/api/buoy-status/all` that hits a cold
cache fires 36 HTTP requests.

**Fix:** Add a background job that refreshes buoy data every 10 minutes
(matching NDBC's update frequency). The endpoint then always serves from
cache and the pre-fetch job handles the upstream load.

```python
# backend/jobs/fetch_buoys.py
async def refresh_all_buoys():
    """Runs every 10 minutes. Pre-populates the buoy cache."""
    buoys = get_all_buoys()
    tasks = [fetch_buoy_data(b["id"], use_cache=False) for b in buoys]
    await asyncio.gather(*tasks, return_exceptions=True)
    print(f"✅ Refreshed {len(buoys)} buoys")
```

---

## Problem 7: xarray/OPeNDAP in a ThreadPoolExecutor 🟡

**File:** `main.py` lines ~2560–2620

```python
loop = asyncio.get_event_loop()
with ThreadPoolExecutor(max_workers=1) as executor:
    result = await asyncio.wait_for(
        loop.run_in_executor(executor, fetch_opendap_data),
        timeout=90.0
    )
```

Running xarray OPeNDAP fetches in a thread executor was a reasonable
workaround for blocking I/O, but:
1. OPeNDAP is dead (Problem 2) — this whole code path is moot
2. The 90-second timeout is too long for a user-facing request
3. cfgrib (the Grib Filter replacement) is designed for async use

Once the Grib Filter migration happens, this thread executor pattern
can be removed. The new `gfs_wave.py` module uses `httpx.AsyncClient`
natively, which is non-blocking by design.

---

## Problem 8: `main.py` Is Too Large to Maintain 🟡

4,431 lines is too much for one file. No single function should need to
scroll 500 lines to understand. It makes testing impossible (can't import
one function without importing everything), debugging slow, and
onboarding Claude Code sessions confusing.

**Proposed module split:**

```
backend/
├── main.py              ← Keep: FastAPI app, startup/shutdown, route registration only (~200 lines)
│
├── data_sources/        ← All upstream API fetches
│   ├── ndbc.py          ← fetch_buoy_data(), fetch_wind_from_station()
│   ├── gfs_wave.py      ← fetch_gfs_wave(), parse_grib_wave() [NEW - replaces OPeNDAP]
│   ├── gfs_wind.py      ← fetch_real_noaa_wind() [MOVE from main.py]
│   └── cdip.py          ← fetch_cdip_ecmwf_forecast() [MOVE from main.py]
│
├── routes/              ← API endpoint handlers, thin wrappers
│   ├── buoys.py         ← /api/buoy-status/*, /api/buoy-history/*
│   ├── waves.py         ← /api/waves-overlay, /api/wave-point, /api/waves/run-availability
│   ├── wind.py          ← /api/wind-overlay, /api/wind/frames
│   ├── spots.py         ← /api/surf-spots/*, /api/spots/*
│   ├── ai.py            ← /api/spots/*/ai-analysis/* (Tree B only)
│   ├── copilot.py       ← /api/copilot/* [already separate]
│   ├── tides.py         ← [already separate]
│   └── admin.py         ← /api/admin/*
│
├── services/            ← Business logic
│   ├── surf_scoring.py  ← [already separate] + update to use swell_category()
│   ├── swell_physics.py ← [already separate]
│   ├── forecast_cache.py← pre-bake + serve forecast timelines
│   └── spot_service.py  ← spot lookup, buoy blend logic
│
└── jobs/                ← Background tasks
    ├── fetch_buoys.py   ← refresh_all_buoys() every 10 min
    ├── fetch_forecasts.py← prefetch_spot_forecast() every 6 hours
    ├── populate_sessions.py← session auto-pop [planned]
    └── recompute_profiles.py← user_spot_profiles [planned]
```

---

## Prioritized Action List for Claude Code

### 🔴 Must fix now (app is broken or severely degraded)

1. **Migrate WW3 from OPeNDAP to Grib Filter**
   - Replace `fetch_real_noaa_ww3_opendap()` (line 2220) with Grib Filter fetch
   - Create `backend/data_sources/gfs_wave.py`
   - Update `ww3_grid_registry.json` URL patterns
   - Smoke test: confirm wave data returns for Blacks Beach

2. **Fix `forecast-timeline` sequential loop**
   - Replace the `for forecast_hour in forecast_hours` loop with parallel fetches
   - Minimum fix: `asyncio.gather()` all hours in parallel instead of sequential
   - Better fix: pre-bake cache job (see Problem 1 above)
   - This is the single biggest user-facing performance problem

### 🟡 Fix soon (significant quality or efficiency issues)

3. **Replace `calculate_surf_height()` with swell category lookup**
   - Import `swell_category()` from `swell_physics.py`
   - Update all call sites in `main.py` and `surf_scoring.py`
   - Verify Copilot output uses face height ranges not raw multiplied values

4. **Replace WW3 overlay call in `/conditions` with point lookup**
   - Use `get_wave_point()` (already exists at line 3111) instead of `get_waves_overlay()`
   - Or pull from pre-baked forecast cache once job is running

5. **Audit and consolidate AI analysis endpoint trees**
   - Determine which endpoints the frontend + Copilot actually call
   - Remove Tree A (buoy_id-based) if unused
   - Remove `/api/buoy-status` single-buoy legacy endpoint if unused

6. **Add background buoy refresh job**
   - Extract buoy fetching to `backend/jobs/fetch_buoys.py`
   - Schedule every 10 minutes via APScheduler or similar
   - `/api/buoy-status/all` becomes a pure cache read

### 🟢 Refactor when bandwidth allows (maintainability)

7. **Split `main.py` into modules** (Problem 8)
   - Start with extracting `data_sources/ndbc.py` — least risky
   - Then `routes/buoys.py`
   - Don't try to do everything at once — extract one module per PR

8. **Remove ThreadPoolExecutor for xarray** (Problem 7)
   - Obsolete once OPeNDAP → Grib Filter migration is done
   - Delete ~60 lines of dead code

---

## Quick Wins Claude Code Can Do Right Now

These are safe, isolated, high-value changes that don't require the big refactor:

```python
# 1. Parallelize forecast-timeline (15-minute fix, huge UX improvement)
# Replace:
for forecast_hour in forecast_hours:
    wave_response = await get_waves_overlay(...)
    wind_response = await get_wind_overlay(...)

# With:
async def fetch_hour(hour):
    wave = await get_waves_overlay(model="ww3", bounds=bounds, forecast_hour=hour, source="global")
    wind = await get_wind_overlay(model="gfs", bounds=bounds, forecast_hour=hour, real_data=True)
    return hour, wave, wind

results = await asyncio.gather(*[fetch_hour(h) for h in forecast_hours], return_exceptions=True)
# Then process results


# 2. Add Open-Meteo as wind fallback (30-minute fix, resilience)
# In fetch_real_noaa_wind(), after the Grib Filter attempt fails:
async def _fetch_openmeteo_wind_fallback(lat, lon, hours=168):
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}"
        f"&hourly=wind_speed_10m,wind_direction_10m"
        f"&wind_speed_unit=mph&forecast_days=7"
    )
    resp = await _http_client.get(url)
    return resp.json()


# 3. Add swell_category() to surf scoring (1-hour fix, accuracy improvement)
# In surf_scoring.py calculate_spot_score():
from swell_physics import swell_category, category_face_height
wave_height_ft = wave_height_m * 3.28084
cat = swell_category(wave_height_ft, dpd_sec)
face_min, face_max = category_face_height(cat)
# Use face_mid for scoring, face_min/max for display range
```

---

## What We Don't Need

After auditing all endpoints, these appear unused or redundant:

- `/api/buoy-status` — single primary buoy, superseded by `/api/buoy-status/all`
- `/api/ai/spot-analysis/{buoy_id}` tree — buoy_id-based AI, superseded by slug-based
- `/api/ai/spot-analysis/batch-generate` — old batch endpoint
- `/api/swell-overlay` (line 2921) — appears to be an alias for `/api/waves-overlay`

Before deleting any of these, verify with frontend code that nothing calls them.
A quick grep of `frontend/src/` for each endpoint path will confirm.

**Recommended:** Add `@app.get("/api/buoy-status", deprecated=True)` tags first,
watch logs for calls, then remove after 1-2 weeks.

---

**Last updated:** 2026-04-21
**Estimated effort:**
- Problems 1+2 (critical fixes): 2-3 days
- Problems 3-6 (quality fixes): 2-3 days
- Problems 7-8 (refactor): 1-2 weeks (do incrementally)
