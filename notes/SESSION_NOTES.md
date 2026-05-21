# 🌊 MySurfLife - Session Notes

---

## 📍 Current Status (Apr 23–27, 2026) — Session 3

### Session Summary — Design V2 merge, Sione streaming + storm handoff, global storm detector

The biggest stretch of work since the module split. Reconstructed here from git (`32ee1bc`…`6d8f256`) and the storm doc cluster; SESSION_NOTES had skipped it.

**Design V2 + responsive shell (Apr 23)**
Merged the `design-v2-integration` branch (`32ee1bc`): V2 app shell, theme provider (auto Ocean/Dawn/Daylight), screen-level mobile reflow (Dashboard, Copilot, SpotDetail, Storm card), hamburger drawer + region dropdown. Added `locateMe` geolocation fly-in, region persistence to `localStorage`, private user spots + SpotDetail favorite chip. Removed leftover `overflow:hidden` from html/body/index.html that was blocking homepage scroll (see memory: body-scroll deferred).

**SpotDetail / AI / dashboard / profile (Apr 24–25)**
AISpotAnalysis V2 refactor + RLS fix + move-pin edit mode; alerts backend (`015_user_alerts.sql`); buoy detail panel + layer exclusivity + storm timeline on the map; full dashboard redesign; profile drawer (identity, preferences, admin links) with empty-string→NULL coercion for constrained columns.

**Sione (Apr 25–26)**
Renamed Scout → Sione throughout (trademark-cleared, see memory). Streaming chat via SSE (token-by-token + live tool events); typing-dots fixes; `storm_trip` handoff — `/api/sione/sessions` endpoint + server-side opener templater + storm context in chat. Backend refactor Phase 1+2 (`1d6ea84`): `services/` foundation + extracted Sione/AI/Copilot route modules. Several `http_client` name-binding / config-dedup fixes.

**Storm detection — bulletin fixes then the model detector (Apr 26–27)**
Bulletin pipeline fixes first: parse sea heights / fetch / max winds; forecast-track regex (Bug 2); `east-pacific` rename (Bug 1); `max_pressure_mb` rename + storm-ID collision (Bugs 3, 4); complex-low dedupe + LLM value-bleed guard (Bugs 8c, 9a).

Then the durable fix shipped: **GFS-pressure global cyclone detector** (`12318e2`, Bugs 5 & 6) and **global GFS+WW3 model detection + region impact + DB persistence** (`fe499f7`). New: `backend/jobs/detect_storms.py` (detector loop, WW3 cone confirmation, track dynamics, landfall), `backend/services/{region_impact,storm_reconciliation}.py`, `backend/config/{region_swell_windows,storm_detector_config}.json`, migration `018_derived_storms.sql`, endpoint `GET /api/storms/{id}/detail`, tests `test_detect_storms_ww3.py` + `test_storm_reconciliation.py`. Frontend: model-storm visual differentiation + dashboard storm UI (`9c7839e`, `fe6620d`, `fcf1488`, `6d8f256`).

See `notes/STORM_DETECTION_EXECUTION_PLAN.md` audit table for per-phase status, and `notes/STORM_SIONE_HANDOFF.md` for the drawer→Sione design.

### What's Next

- Confirm storm detection loop is launched in `main.py` startup(); verify `global-land-mask` installed in prod
- Wire the "Ask Sione about this storm" chip end-to-end (handoff doc §"Engineering work")
- Continue Design V2 remaining phases
- Optional interim: Bug 8 option (c) output-side dedupe if Atlantic count inflation resurfaces

---

## 📍 Current Status (Apr 21, 2026) — Session 2

### Session Summary — Surf Scoring Fixes + Schema Validation

Short follow-up session. Completed the three remaining priorities from the previous session.

**Priority 3 — Surf scoring: swell table formula + size_perception_bias**

Fixed a circular import that had been lurking since the module split: `surf_scoring.py` was importing `calculate_surf_height` from `main` instead of `utils`. Changed to `from utils import calculate_surf_height`.

Added `size_bias: float = 1.0` parameter to `calculate_spot_score()` and threaded it through to `calculate_surf_height()`. The bias is now applied at the `surf_height_ft` output field, so authenticated users with a `user_spot_profiles` record get a personalized estimate (e.g. Blacks Beach canyon bias of 1.35 adds ~35% to the face height output).

Wired the lookup into `get_surf_spot_conditions()` in `main.py`:
- Added `optional_auth` as a FastAPI dependency (already available from prior auth work)
- If user is authenticated, queries `user_spot_profiles` for `(user_id, spot_id)` → pulls `size_perception_bias`
- Defaults to 1.0 if no profile (< 3 sessions logged) or no auth
- `size_bias` included in the conditions response so the frontend can show it

**Priority 4 — Sessions schema validation**

Confirmed all tables are already live in Supabase:
- `public.sessions` ✅
- `public.user_favorites` ✅
- `public.user_spot_profiles` ✅ (including `size_perception_bias` column)
- `session_deltas` view ✅
- `session-photos` storage bucket ✅

Migration `backend/migrations/006_sessions_core.sql` had been applied in a prior session. No action needed.

**Priority 5 — Homepage**

Homepage was already fully implemented in `frontend/src/screens/Home.jsx` (663 lines) and `Home.css` (653 lines), and already wired in `App.js` as the unauthenticated root route (`/` → `<Home />` when logged out, `<Shell />` when logged in). Production build compiles clean at 308kB gzip.

### Files Changed

| File | Change |
|---|---|
| `backend/surf_scoring.py` | Fixed `from main` → `from utils` import; added `size_bias` param to `calculate_spot_score()` |
| `backend/main.py` | `get_surf_spot_conditions()`: added `optional_auth` dep; size_perception_bias lookup; passes `size_bias` to scoring |

### What's Next

- Build `scan_active_storms` Copilot tool (reads `high_seas.py` output + WW3 to auto-surface storm positions)
- Continue Design V2 phases B → C → D
- Quick-log UI for session journal (tap spot → rate → 30s done)
- `conditions_timeline` artifact: tide track chart render (data merge already wired in backend)

---

## 📍 Current Status (Apr 21, 2026) — Session 1

### Session Summary — Backend Hardening + Module Split

Eight backend tasks completed across two context sessions. The codebase is now structurally clean: `main.py` went from a 4550-line monolith to ~4260 lines (with real logic extracted into separate modules), the wind model roster has expanded to four sources, and the Copilot has new data hooks for storm tracking.

### Tasks Completed

**#16 — Remove duplicate AI route trees**
Audited `main.py` and removed the dead old `/api/ai/*` route tree that had been superseded by the persona-based system. No breaking change — only the stale routes were removed.

**#13 — Parallelize forecast-timeline endpoint**
`get_surf_spot_forecast_timeline()` previously fired 60 sequential OPeNDAP calls (one per hour). Rewrote with `asyncio.gather()` + two helpers (`_closest_vector()`, `_fetch_timeline_hour()`). Latency dropped from ~60s to ~2s. Identical response shape — no API contract change.

**#15 — Point-lookup for /conditions WW3 call**
`get_surf_spot_conditions()` was calling the full wave overlay endpoint (bounding box, thousands of points) just to get the wave height at one lat/lon. Replaced with `_get_wave_overlay_impl()` + `_closest_vector()` — fetches the same WW3 grid but extracts a single point rather than returning the whole field to the caller.

**#21 — Invite-only: remove signup from frontend**
Stripped the signup tab and `supabase.auth.signUp` branch from `Login.js`. App now shows sign-in only with an "Access is by invitation only" note. Supabase dashboard left untouched — no need to lock it there since users have no direct access path.

**#17 — Split main.py into modules**
Extracted three logical slices into `backend/routes/`:
- `routes/auth.py` — `GET /api/auth/check-admin`
- `routes/admin.py` — AI personas CRUD + user management (list, invite, role, delete)
- `routes/sessions.py` — `POST /api/sessions`, `GET /api/sessions`

All three registered on `app` via `include_router()`. Route files import directly from `database.py` / `auth.py` — never from `main.py` — to avoid circular imports.

Also moved `json_sanitize`, `calculate_surf_height`, and `_times_utc_for_run` into `backend/utils.py` so they're importable by route modules without pulling in all of main.py.

**#14 — Background buoy refresh + Open-Meteo fallback**
Created `backend/jobs/buoy_refresh.py`: a background loop (20s startup delay, 5-min interval) that pre-warms the buoy cache via `asyncio.gather`. Started via `asyncio.create_task()` in the `startup` lifespan handler.

Added `fetch_wind_from_open_meteo(lat, lon)` as a third-tier wind fallback in `fetch_buoy_data()`: NDBC buoy → NOS CO-OPS station → Open-Meteo free API. Open-Meteo requires no API key and covers any global lat/lon.

**#12 — WW3 OPeNDAP → GRIB filter**
Added `fetch_real_noaa_ww3_grib()` (~170 lines) that hits the NOMADS GRIB2 filter service instead of OPeNDAP. Faster and more reliable under high load. `_get_wave_overlay_impl()` tries GRIB first, falls back to OPeNDAP on failure. Updated `ww3_grid_registry.json` with `grib_filter_script`, `grib_file_prefix`, and `grib_dir_pattern` for all three domains (global, epacif, atlocn).

**#18 — ECMWF Open Data wind + High Seas bulletin parser**
Two new backend modules:

`backend/ecmwf_wind.py` — fetches ECMWF IFS 10m wind (U10/V10) via the free `ecmwf-opendata` Python package (no API key required). 0.25° resolution, 00z/12z runs, 0–360h forecast. Synchronous download wrapped in `run_in_executor` with 60s timeout. Parses with cfgrib/xarray into the same vector dict format as GFS. Graceful `ImportError` — if the package isn't installed, returns `None` and the wind overlay falls back to GFS silently.

`backend/high_seas.py` — fetches and parses NOAA NWS High Seas Forecasts from the NWS Products API (no key required) for North Pacific, South Pacific, and North Atlantic. Extracts structured storm/system entries: type, lat/lon, pressure_mb, wind_kts, sea_height_ft, movement. 3-hour cache. Registers `GET /api/high-seas/{ocean}`. Intended as the data source for a future `scan_active_storms` Copilot tool.

ECMWF wired into `_do_fetch_wind_overlay()` as `model="ecmwf"` (GFS fallback if ECMWF download fails). Added to `GET /api/overlays/models`. `ecmwf-opendata>=0.3.3` added to `requirements.txt`.

### New Files

| File | Purpose |
|---|---|
| `backend/utils.py` | `json_sanitize`, `calculate_surf_height`, `_times_utc_for_run` |
| `backend/routes/__init__.py` | Package marker |
| `backend/routes/auth.py` | `GET /api/auth/check-admin` |
| `backend/routes/admin.py` | Persona + user management endpoints |
| `backend/routes/sessions.py` | Session log endpoints |
| `backend/jobs/__init__.py` | Package marker |
| `backend/jobs/buoy_refresh.py` | Background buoy cache-warming loop |
| `backend/ecmwf_wind.py` | ECMWF IFS wind fetcher |
| `backend/high_seas.py` | NOAA High Seas bulletin parser + `/api/high-seas/{ocean}` |

### API Surface (new endpoints)

```
GET  /api/high-seas/{ocean}          north-pacific | south-pacific | north-atlantic
GET  /api/swell/arrivals             (from swell_physics — wired in prior session)
GET  /api/swell/decay
GET  /api/swell/distance
GET  /api/swell/category             (from swell_tables — wired in prior session)
GET  /api/swell/sea-height
GET  /api/tides/timeline             (from tides — wired in prior session)
GET  /api/tides/hilo
```

Wind models now: `gfs | hrrr | nam | ecmwf`

### What's Next

- Wire `calculate_swell_arrival` Copilot tool in `backend/copilot.py` (see `ClaudeSuggestions /SWELL_ARRIVAL_PHYSICS.md`)
- Build `scan_active_storms` tool that reads High Seas bulletin output + WW3 to auto-surface storm positions for Copilot
- Add `swell_arrival` artifact renderer in `Copilot.jsx`
- Merge tide data into `conditions_timeline` artifact (see `ClaudeSuggestions /TIDES_ENDPOINT.md` §3)
- Continue Design V2 phases B → C → D (see `notes/DESIGN_V2_INTEGRATION_PLAN.md`)

---

## 📍 Current Status (Oct 21, 2025)

### ✅ Completed Features

**Backend Capabilities:**
- ✅ 14 California buoys (Imperial Beach → Cape Mendocino)
- ✅ Concurrent data fetching (asyncio.gather)
- ✅ 5-minute intelligent caching
- ✅ Wind fallback system (9 buoys use NOS CO-OPS stations)
- ✅ Surf face height calculation: `0.7 × WVHT × √DPD`
- ✅ Wave energy index: `WVHT² × DPD`
- ✅ Wave trend detection (rising/holding/falling)
- ✅ Temperature data (water & air)
- ✅ 3 API endpoints

**Frontend Features:**
- ✅ Interactive Leaflet map
- ✅ 4 basemap options (OSM, Satellite, Terrain, Ocean)
- ✅ Smart scoring (0-3) with color-coded markers
- ✅ Detailed buoy panel with all metrics
- ✅ Visual energy bar (0-500 scale, 5 tiers)
- ✅ Direction arrows (wave & wind)
- ✅ Trend indicators (↑↓→)
- ✅ Auto-refresh every 5 minutes
- ✅ Unit selection (Imperial/Metric)
- ✅ Timezone selection (Local/UTC)
- ✅ Persistent settings (localStorage)

**UI/UX:**
- ✅ Map controls in bottom-left
- ✅ Control panel in top-right
- ✅ Buoy detail panel in top-left (on click)
- ✅ Tooltips on trend indicators
- ✅ Wind source attribution
- ✅ Smooth animations
- ✅ 48-hour historical charts with Recharts
- ✅ 5-day forecast overlay (trend-based, Phase 1)

---

## 🎯 Next Session Priorities

### ✅ 1. 📈 Historical Wave Charts (COMPLETED!)

**Goal:** Show 24-48 hour wave height trends

**Backend Tasks:**
- ✅ Create `/api/buoy-history/{station_id}?hours=48` endpoint
- ✅ Fetch historical NDBC data (last 2 days)
- ✅ Parse and return time-series data
- ✅ Cache historical data (30 min TTL)

**Frontend Tasks:**
- ✅ Install Recharts: `npm install recharts`
- ✅ Create WaveChart components (3 charts total!)
- ✅ Display in buoy detail panel with expand/collapse
- ✅ Line chart: Wave height & face height (dual-line)
- ✅ Period chart with trend
- ✅ Energy index chart
- ✅ Responsive sizing (fits panel width)
- ✅ Loading states and error handling

**Implementation Details:**
- Endpoint: `/api/buoy-history/{station_id}?hours={24|48|etc}`
- 3 separate charts: Wave heights, Period, Energy
- Toggle button: "Show Wave History"
- Lazy loading: only fetches when user clicks
- Scrollable detail panel for long content
- Unit conversion support (imperial/metric)

---

### ✅ 1b. 🔮 5-Day Wave Forecast (COMPLETED - Phase 1!)

**Goal:** Add forecast overlay to historical charts

**Phase 1 Implementation (COMPLETED):**
- ✅ Create `/api/buoy-forecast/{station_id}?hours=120` endpoint
- ✅ Trend-based projection using recent NDBC data
- ✅ 40 forecast points (every 3 hours for 5 days)
- ✅ Checkbox toggle: "5-day forecast"
- ✅ Dotted lines distinguish forecast from observed
- ✅ Lighter colors for forecast vs observed data
- ✅ 3-hour cache TTL
- ✅ CDIP station mapping integration
- ✅ All 3 charts support forecast (Wave, Period, Energy)

**Phase 2 Implementation (Infrastructure Complete!):**
- ✅ Integrate CDIP THREDDS server for ECMWF model data
- ✅ NetCDF4/OPeNDAP integration with intelligent fallback
- ✅ Multi-URL pattern matching for CDIP server
- ✅ Intelligent variable name detection (waveHs, waveTp, waveDp)
- ✅ Time conversion handling (Unix timestamps, CF-compliant formats)
- ✅ Source attribution and confidence levels
- 🔍 **Pending:** Verify correct CDIP THREDDS URLs
- [ ] Add confidence intervals/error bars (future)
- [ ] Support multiple forecast models (CDIP, NOAA WW3) (future)
- [ ] Forecast accuracy indicators (future)

**Implementation Details:**
- Endpoint: `/api/buoy-forecast/{station_id}?hours={hours}`
- Uses `cdip_station_mapping.json` for buoy → CDIP mapping
- 13 of 14 buoys support CDIP (Mission Bay excluded)
- Simple sine wave variation for demo (±10% from avg)
- Returns: `wvht_m`, `wvht_ft`, `dpd_sec`, `surf_height_m`, `wave_energy`
- Metadata: `source`, `confidence`, `cdip_available`

---

### 2. 🌬️ Wind Overlay (NEXT PRIORITY)

**Goal:** Animated wind vector layer on map

**Options:**
- **Option A:** Windy API (easiest, pre-built)
  - Embed Windy iframe or use their API
  - Animated, beautiful, real-time
  
- **Option B:** NOAA GRIB2 Data (more control)
  - Fetch from NOAA GFS/WRF models
  - Parse GRIB2 files
  - Render with canvas or WebGL
  
- **Option C:** WMS Layer (middle ground)
  - Use NOAA WMS service
  - Overlay as tile layer
  - Less interactive

**Tasks:**
- [ ] Research best approach (Windy vs NOAA)
- [ ] Add toggle control to map
- [ ] Implement wind arrow animation
- [ ] Ensure performance on mobile

---

### 3. 🌊 Swell Overlay (PRIORITY #3)

**Goal:** Animated swell forecast layer

**Data Source:**
- NOAA WaveWatch III (WW3)
- 5-day forecast
- Wave height + direction

**Options:**
- **Option A:** WMS Layer from NOAA
- **Option B:** Custom heatmap from WW3 GRIB2
- **Option C:** Third-party service (Magic Seaweed API, etc.)

**Tasks:**
- [ ] Identify best WW3 data source
- [ ] Add swell overlay toggle
- [ ] Animate forecast (time slider?)
- [ ] Color code wave height (heatmap)
- [ ] Show swell direction arrows

---

## 🔧 Technical Notes

**Key Files:**
- `backend/main.py` - 326 lines, all API logic
- `frontend/src/MapOverlay.js` - 626 lines, main component
- `buoy_to_wind_station_map.json` - Wind fallback config
- `WIND_STATION_MAPPING.md` - Wind station docs

**Dependencies to Add:**
```bash
# Frontend
npm install recharts  # For historical charts
```

**API Endpoints:**
- `GET /api/buoy-status` - Single buoy (46266)
- `GET /api/buoy-status/all` - All 14 buoys
- `GET /api/cache/clear` - Clear cache
- `GET /api/buoy-history/{station}?hours=48` - NEW (to build)

---

## 💡 Future Ideas (After Core Features)

- [ ] Surf alerts (email/SMS when conditions meet criteria)
- [ ] Favorite buoys (save to localStorage)
- [ ] Comparison view (side-by-side buoys)
- [ ] Mobile app (React Native?)
- [ ] Tide integration
- [ ] Webcam links
- [ ] Spot-specific forecasts
- [ ] User accounts & preferences
- [ ] Social features (share conditions)

---

## 📊 Current Metrics

- **Buoys:** 14
- **States Covered:** California only
- **Update Frequency:** Every 5 minutes (auto-refresh)
- **Data Sources:** NDBC, NOS CO-OPS
- **Total API Calls per Refresh:** 14 concurrent (buoys) + up to 9 (wind fallback)
- **Cache Duration:** 5 minutes
- **Avg Response Time:** 1-2 seconds (with caching)

---

## 🐛 Known Issues / Tech Debt

- None currently! 🎉
- (Add any bugs or improvements here as discovered)

---

## 📝 Development Commands

**Backend:**
```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload
```

**Frontend:**
```bash
cd frontend
npm start
```

**Git:**
```bash
git status
git add .
git commit -m "Description"
git push
```

---

**Session Date:** Oct 21, 2025  
**Last Commit:** `1194ec9` - Phase 2: CDIP ECMWF forecast integration infrastructure  
**Current Status:**
- ✅ Historical charts (48 hours) - COMPLETE
- ✅ 5-day forecast overlay (Phase 1: trend-based) - COMPLETE
- ✅ CDIP ECMWF infrastructure (Phase 2: NetCDF/OPeNDAP) - COMPLETE
- 🔍 Next: Verify CDIP THREDDS URLs (see CDIP_INTEGRATION_STATUS.md)
- 📋 Queued: Wind overlay → Swell overlay

**New Files:**
- `CDIP_INTEGRATION_STATUS.md` - Detailed Phase 2 status and next steps

