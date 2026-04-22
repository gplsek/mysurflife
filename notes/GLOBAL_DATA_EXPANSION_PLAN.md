# Global Data Expansion Plan

**Status:** 📋 Planning
**Owner:** George (handoff to Claude Code for execution)
**Companion to:** [`WAVE_PERFORMANCE_V2_PLAN.md`](./WAVE_PERFORMANCE_V2_PLAN.md)
**Goal:** Scale MySurfLife's data layer from California/Pacific-centric to truly global, so the V2 tile/WebGL overlays can render storm movement, wind, and waves anywhere on Earth.

---

## 1. Why this plan exists

The V2 performance plan assumes we're rendering overlays globally — but the current data layer is still heavily California-weighted:

- Wave model grids cover Eastern Pacific and Atlantic well, but fall back to a lower-quality global grid elsewhere (and that fallback hasn't been exercised).
- Wind models work globally via GFS, but the HRRR/NAM shortcuts assume North America.
- Buoys are 100% US (California, Pacific NW, Hawaii). No Australia, no UK, no Japan, no Brazil.
- Land masking is hardcoded to California/Baja coastlines in JS.
- Surf spots are California-dominant with two international test pins.

If Phase 2 of the V2 plan pre-bakes global raster tiles today, they'll look fine in Pacific/Atlantic and empty-or-blotchy everywhere else. This plan fills those gaps **before or alongside** V2 Phase 2.

---

## 2. Current inventory (what we audited)

### Wave model coverage — `backend/ww3_grid_registry.json`

| Domain | Bounds | Resolution | Status |
|---|---|---|---|
| `global_0p16` | -90..90, -180..180 | 0.16° (~18 km) | Registered, unclear if actively used |
| `epacif_0p16` | 0..60°N, -180..-80°W | 0.16° | ✅ Active |
| `atlocn_0p16` | 0..60°N, -100..20°E | 0.16° | ✅ Active |
| `wcoast_0p08` | 25..50°N, -130..-110°W | 0.08° (~9 km) | 🚧 Planned, not implemented |

**Gaps:** Nothing for Southern Hemisphere (Australia, New Zealand, Indonesia, South America, Southern Africa). Indian Ocean and Western Pacific rely on the coarse global grid. No Mediterranean, no Baltic, no Caribbean regional.

### Wind model coverage — `backend/main.py`

| Model | Resolution | Coverage | Forecast |
|---|---|---|---|
| GFS | 0.25° (~25 km) | **Global** | 384 h |
| HRRR | 3 km | CONUS (US only) | 48 h |
| NAM | 12 km | North America | 84 h |

**Gaps:** Only GFS is global. HRRR/NAM won't help international users. Missing: ECMWF HRES/ERA5 (best-quality global), ICON (German DWD, 0.125° global, free), arpège (Météo-France, Europe), GEM (Canada).

### Buoy coverage — `backend/buoy_registry.py`

36 stations, all US:
- California: 22 stations
- Oregon: 3
- Washington: 1
- Hawaii: 6
- Offshore Pacific: 2

**Gaps:** No East Coast / Gulf. No Alaska. No international (Canada, UK, Europe, Australia, Japan, Brazil).

### Wind station fallback — `backend/buoy_to_wind_station_map.json`

Uses NOS CO-OPS network — **US coastal only**. Stations: SDBC1, LJAC1, FTPC1, etc. Not useful internationally.

### Land mask — `frontend/src/WaveCanvasLayer.js` lines 13–79

JavaScript function `isLikelyLand(lat, lon)` with hardcoded California (32–42°N, -125..-117°W) and Baja (23..32°N, -118..-110°W) coastline approximations. Returns `false` (= water) for everywhere else, which means data happily paints over Russia, Africa, Australia.

### Surf spots — Supabase `spots` table (per `notes/SURF_SPOTS_COMPLETE.md`)

Primarily California. Two international test pins exist (Uluwatu, Pipeline) but aren't exercised. Drop-pin-to-create-spot feature is scoped in `GLOBAL_SPOT_ANALYSIS.md` Phase 3 but not built.

---

## 3. Target end state

When this plan is complete:

- A user in Portugal, Australia, Japan, or Indonesia opens the app and sees the same visual quality of wind and wave overlays that California users see today.
- Buoy markers appear on every populated coastline where a public buoy feed exists.
- Zooming into any ocean worldwide picks the highest-resolution model available for that region automatically.
- Land masking is accurate globally, not just for California.
- Drop a pin anywhere in the world → create a spot → get AI analysis → ride the wave.

---

## 4. Phased Execution

Four phases, sequenced so each unblocks the next.

---

### PHASE 0 — Audit & verify

**Effort:** ~1–2 days
**Goal:** Confirm what's wired up vs just registered. No code changes.

**Tasks:**

1. Hit `/api/waves-overlay?source=global&forecast_hour=0` with a bbox over the Indian Ocean (e.g. `-30,90,0,120`) and confirm data returns. If it errors or returns all-NaN, the `global_0p16` domain is broken and needs fixing first.
2. Exercise `global_0p16` at zoom 2–5 globally. Capture screenshots for a before/after baseline.
3. Verify GFS wind works in Europe, SE Asia, Southern Ocean. It's global so this should just work — confirm.
4. Document the actual OPeNDAP URL patterns in use (may have drifted from `ww3_grid_registry.json`).
5. Write findings into `notes/GLOBAL_DATA_AUDIT.md` — concrete facts, not speculation.

**Deliverable:** `notes/GLOBAL_DATA_AUDIT.md` listing what works today, what's broken, what's missing.

---

### PHASE 1 — Global wave grid: make it first-class

**Effort:** ~3–5 days
**Goal:** Make the `global_0p16` wave domain the reliable default fallback, with correct zoom-selection logic for every ocean basin.

**Tasks:**

1. **Fix zoom-selection beyond Pacific/Atlantic.**
   - File: `backend/main.py` wave overlay endpoint (~line 2931)
   - Current logic (per `ww3_grid_registry.json` `bbox_selection`) only knows California, Pacific NW, East Coast. A user looking at Indonesia gets… unclear behavior. Fix: any bbox outside the known regional grids falls back to `global_0p16`, regardless of zoom.
   - Add `bbox_selection` entries to `ww3_grid_registry.json` for:
     - `indian_ocean` → `global_0p16`
     - `western_pacific` → `global_0p16`
     - `southern_ocean` → `global_0p16`
     - `mediterranean` → `global_0p16`

2. **Normalize longitude handling for global grid.**
   - Per `CLAUDE.md`, WW3 global delivers 0–360° longitudes. Confirm the existing normalization (`backend/main.py` `(((hs.lon + 180) % 360) - 180)`) actually works for the global domain. If the data is cached with 0–360 coords somewhere, the tile renderer will produce wrong tiles at the antimeridian.

3. **Add Western Pacific regional grid (if available).**
   - NOAA GFSWave publishes `gfswave.wc_4m.{HH}z` (West Coast) and possibly `wpac.0p16` (Western Pacific). Research and add to registry if present. Same for `tropics_0p10` if it exists.
   - These are optional quality upgrades; they are *not* blocking for global coverage since the 0.16° global domain is adequate.

4. **Antimeridian seam test.**
   - Generate tiles/images for bbox spanning the 180°/-180° line (e.g. -175..175 over Fiji). Confirm no seam or duplication. This is a common WW3 gotcha.

**Acceptance:**
- `curl "http://localhost:8000/api/waves-overlay?source=global&bounds=-30,90,0,120&forecast_hour=24"` returns non-NaN data.
- Visual check of Indonesian, Australian, European coastlines at zoom 4–7 shows sensible wave heights.
- No empty swath at the antimeridian.

---

### PHASE 2 — Wind model expansion

**Effort:** ~1 week
**Goal:** Deliver better-than-GFS wind quality outside the US, where possible; always gracefully fall back to GFS.

**Tasks:**

1. **Fix HRRR/NAM gating.**
   - File: `backend/main.py` `/api/wind-overlay` (~line 1910)
   - When `model=hrrr` or `model=nam` is requested outside those models' native domains (HRRR: CONUS, NAM: North America), transparently fall back to GFS rather than returning an error or sample data. Log the fallback.
   - Frontend side: `MapOverlay.js` should only *offer* HRRR/NAM when the viewport is inside their domain. Otherwise hide the button or grey it out.

2. **Add ICON (German DWD).**
   - Optional but high-value: ICON Global is 0.125°, free, updated 6-hourly, and noticeably better than GFS in Europe.
   - Dataset: https://opendata.dwd.de/weather/nwp/icon/grib/
   - New model config entry `"icon"` alongside GFS/HRRR/NAM. Fetcher can live in a new `backend/wind_models/icon.py`.
   - Acceptance: can fetch 10 m wind for any point on Earth; validates against GFS to ±30% speed.

3. **Document ECMWF as future option.**
   - ECMWF Open Data Initiative has free public ERA5 + IFS HRES wind. License is open but requires attribution. Parameter set is richer. Deferred to a future phase; just document path in `notes/`.

4. **Expose model choice per region in the UI.**
   - File: `frontend/src/MapOverlay.js`
   - Model selector should show available options based on viewport. Europe → GFS + ICON. US → GFS + HRRR + NAM + ICON. Elsewhere → GFS + ICON.

**Acceptance:**
- User pans to Europe, ICON wind renders cleanly.
- User pans to Africa, GFS wind renders cleanly (no error from HRRR attempt).
- HRRR/NAM model buttons hide or disable outside North America.

---

### PHASE 3 — Buoy network expansion

**Effort:** ~1.5–2 weeks
**Goal:** Buoy markers and observations on populated coastlines worldwide, via a pluggable adapter pattern.

**Tasks:**

1. **Generalize NDBC ingestion to worldwide stations.**
   - NDBC actually hosts hundreds of buoys beyond California, including international partners (TAO array, JAMSTEC, KMA). The existing parser should work for any NDBC-hosted station — the constraint is the registry, not the code.
   - Expand `backend/buoy_registry.py` fallback list **and** the Supabase `buoys` table:
     - East Coast: 44013, 44017, 44025, 44065, 41002, 41008, 41009, 41013, 41025, 41046 (Bermuda)
     - Gulf: 42001, 42002, 42003, 42012, 42019, 42020, 42036, 42040
     - Alaska: 46001, 46035, 46066, 46073
     - Great Lakes: 45001, 45002, 45003 (if within scope)
     - Caribbean: 42058, 42059, 42060
     - International (NDBC-hosted): 41100-series (TAO), 51-series (Pacific), 62000-series (UK Met Office via NDBC)
   - Target: ~150 stations globally by end of Phase 3.

2. **Add international data adapters (pluggable).**
   - New module: `backend/buoy_adapters/`
     - `ndbc.py` (existing logic, refactored)
     - `cefas_wavenet.py` — UK Met Office WaveNet. Public REST API, ~30 stations around UK/Ireland.
     - `bom_australia.py` — Australian BOM wave buoys. Stations off NSW, QLD, WA. Public data but XML/CSV feeds.
     - `dfo_canada.py` — DFO Canada East/West buoys. ECCC feeds.
     - `emodnet_europe.py` — Aggregated EU buoys via EMODnet Physics. Covers Mediterranean, Baltic, North Sea.
   - Each adapter implements a common interface: `async def fetch_station(station_id) -> StationReading` with fields matching NDBC (WVHT, DPD, MWD, WSPD, WDIR, etc.).
   - Register adapter per buoy in the database via a `source` column: `'ndbc'`, `'cefas'`, `'bom'`, `'dfo'`, `'emodnet'`.

3. **Database schema migration.**
   - Add columns to Supabase `buoys` table: `source TEXT NOT NULL DEFAULT 'ndbc'`, `country CHAR(2)`, `region TEXT`.
   - Backfill existing rows with `source='ndbc', country='US'`.
   - Migration lives in `backend/migrations/`.

4. **Frontend filtering.**
   - File: `frontend/src/MapOverlay.js`
   - Add region / country filter to the buoy panel (dropdown or search).
   - Clustering at low zooms so the map isn't overwhelmed with 150+ markers globally.

5. **Rate limiting and courtesy headers.**
   - Each adapter needs its own semaphore (don't hammer the UK Met Office at 6 req/s just because that's our NDBC limit).
   - Include `User-Agent: MySurfLife/1.0 (https://mysurflife.com)` in all outbound HTTP to these services.

**Acceptance:**
- Buoy markers appear on UK, Australian, and Eastern Canadian coastlines with live data.
- Clicking any international buoy opens the same detail panel with the same metrics, just labeled with the data source.
- Global buoy load does not exceed 3s (cold) / 300ms (warm) via caching.

**Risks:**
- International data feeds are less stable than NDBC; error handling must be per-adapter.
- License restrictions vary — document per adapter.

---

### PHASE 4 — Global land mask + spot seed data

**Effort:** ~1 week
**Goal:** Accurate land masking worldwide, and enough seed surf spots that the map doesn't feel empty outside California.

**Tasks:**

1. **Global land mask raster.**
   - Source: Natural Earth 10m `land` polygon, or GSHHG `full` resolution.
   - Pre-bake a global raster at 0.05° resolution (7200×3600 px) — ~26 MB as single-channel PNG. Gzip to ~5 MB.
   - File target: `frontend/public/landmask.png` (served as static asset) and `backend/data/landmask.npy` (for server-side tile rendering in V2 Phase 2).
   - Replace `frontend/src/WaveCanvasLayer.js` lines 13–79 `isLikelyLand()` with an O(1) texture lookup. Same mask is used by the V2 WebGL particle shader as an alpha channel.
   - This task **coordinates with** V2 Phase 1 task 5 and V2 Phase 3 UV PNG task. Execute once, consume from three places.

2. **Seed surf spots globally.**
   - Current DB: mostly California, 2 international test pins.
   - Seed list options:
     - Wannasurf.com has an open spot DB (~8k spots); license permits non-commercial usage — check.
     - OpenStreetMap `sport=surfing` POIs — several thousand spots, open license.
     - Curated list: World Surf League tour stops (~100), Stormrider Guide regions (~500).
   - Recommended: start with OSM `sport=surfing` extract (Overpass API query), ~1000 spots with coords and names. Run through the AI analysis pipeline in background to populate `ai_spot_analysis` for each.
   - New script: `backend/scripts/seed_global_spots.py`.

3. **Drop-pin-to-create-spot feature.**
   - Long-deferred from `GLOBAL_SPOT_ANALYSIS.md` Phase 3.
   - Map click (authenticated admin or user) → modal with coords pre-filled → submit → background AI analysis → spot appears.
   - Frontend: `frontend/src/MapOverlay.js` + new modal component `frontend/src/DropPinSpot.js`.
   - Backend: existing `POST /api/spots/` + `POST /api/spots/{slug}/ai-analysis/generate` — just wire them up.

4. **Regional spot clustering.**
   - With 1000+ spots on the map, clustering is required. Use `react-leaflet-markercluster` or Leaflet.markercluster.
   - Cluster colors indicate average current score for the region.

**Acceptance:**
- Land mask accurate within ~0.05° of true coastline worldwide.
- Map shows 500+ spots outside California within a month of seed import completing.
- Admin can drop a pin anywhere and produce an AI-analyzed spot in < 30 seconds.

---

## 5. Interaction with V2 plan

These two plans share ground. The dependencies:

| V2 task | Depends on |
|---|---|
| V2 Phase 1 task 5 (pre-baked land mask) | This plan Phase 4 task 1 (global mask raster) |
| V2 Phase 2 task 5 (server tile renderer) | This plan Phase 0 + Phase 1 (working global wave data) |
| V2 Phase 3 task 1 (UV texture for particles) | This plan Phase 2 (global wind confirmed) + Phase 4 task 1 (land mask) |

**Recommended execution order:**

1. This plan Phase 0 (audit) — 1 week
2. This plan Phase 1 + V2 Phase 1 in parallel (different files, no conflict) — 1–2 weeks
3. This plan Phase 4 task 1 (land mask raster) — 2 days, blocks V2 Phase 2 and 3
4. V2 Phase 2 (tile renderer) + this plan Phase 2 (wind models) in parallel — 2 weeks
5. V2 Phase 3 (WebGL particles) + this plan Phase 3 (buoy expansion) in parallel — 2 weeks
6. This plan Phase 4 tasks 2–4 (spot seeding, drop pin) — 1 week

Total: ~8–10 weeks of focused work to reach full global V2.

---

## 6. Data source licensing & attribution

None of the recommended data sources require payment, but attribution rules vary. When we go global, the footer or an "about data" page should credit:

- NOAA (NDBC, GFS, GFSWave, HRRR, NAM) — public domain, attribution appreciated.
- NOAA NOMADS OPeNDAP — same.
- Deutscher Wetterdienst (ICON) — CC BY 4.0, attribution required.
- ECMWF Open Data — CC BY 4.0 (when used).
- UK Met Office CEFAS WaveNet — Open Government Licence.
- Bureau of Meteorology Australia — CC BY 4.0.
- DFO Canada — Open Government Licence – Canada.
- EMODnet — CC BY 4.0.
- Natural Earth — public domain.
- OpenStreetMap — ODbL (surf spot POIs).
- Wannasurf (if used) — license TBD, check before import.

Add a `frontend/src/Attribution.js` or `/about/data` route that lists all sources in use.

---

## 7. Storage and cost impact

Rough estimates, no external hosting yet:

| Asset | Size | Storage |
|---|---|---|
| Global land mask raster | ~5 MB gzipped | Static asset |
| Global WW3 daily cache (180h × 3 vars) | ~400 MB per run | `backend/cache/` (disk) |
| Global wind tile cache (GFS + ICON) | ~3–5 GB per run | `backend/cache/tiles/` (disk) |
| Buoy observations | ~50 MB/month | Supabase (cheap) |
| Seed spot metadata | ~1 MB for 1000 spots | Supabase |
| AI analyses for 1000 new spots | ~5 MB, ~$8 in API calls | Supabase + one-time cost |

Nothing here is expensive. Disk cache at ~10 GB fits on the current Ubuntu server. If we add CDN fronting (V2 plan question #1), tile egress costs become the meaningful line item, probably $10–50/month depending on traffic.

---

## 8. Open questions

1. **Wave model priority.** Does ECMWF waves (via CMEMS) belong in Phase 1, or defer until V3? CMEMS requires registration but is free — lightweight to pilot.
2. **Buoy observability scope.** Should Phase 3 go all-in on 5 adapters, or start with 1–2 (NDBC worldwide + EMODnet) and prove the pattern?
3. **Seed spot legal review.** Can we import Wannasurf spot data? Their ToS is ambiguous. OSM is definitely safe. Depending on answer, seed count varies from ~1000 to ~8000.
4. **User-generated spots.** Drop-pin produces "user-owned" spots — are these public by default, admin-moderated, or private-to-user? Ties to future Supabase realtime + permissions work.
5. **Country-of-origin inference.** Do we want reverse geocoding (coords → country) at spot/buoy creation? Useful for filtering but adds dependency on a geocoding service. Alternative: ship a local `countries.geojson` and do point-in-polygon server-side.

---

## 9. Execution notes for Claude Code

Phase 0 is mandatory — do not skip. The audit's findings will adjust downstream phase estimates.

Each adapter in Phase 3 should ship with:
- A unit test that hits a known-good station and validates the schema.
- An integration test that exercises the end-to-end flow (adapter → API response → frontend panel).
- A `README.md` in its directory explaining the data source, license, rate limits, and known issues.

For Phase 4 task 1 (land mask), prefer **GSHHG** over Natural Earth if both are considered — GSHHG has better small-island fidelity which matters for Indonesia and the Pacific.

Use Supabase migrations (SQL files in `backend/migrations/`) for all schema changes. Never edit the schema via the Supabase dashboard in production.

---

## 10. Success measures

At project completion, these queries should return sensible data:

```bash
# Wave data for a random point in the Mozambique Channel
curl "http://localhost:8000/api/waves-overlay?source=global&bounds=-20,35,-15,42&forecast_hour=24"

# Wind for Perth, Australia
curl "http://localhost:8000/api/wind-overlay?model=icon&bounds=-33,114,-31,117&forecast_hour=6"

# Nearest buoy to Cornwall, UK
curl "http://localhost:8000/api/buoy-status/all?near=50.2,-5.3&radius_km=100"
```

And visually:
- Pan the map to Sydney → see wind streamlines, wave heatmap, buoy markers.
- Pan to Biarritz → see ICON wind, EMODnet buoys.
- Pan to Kauai → see HRRR-equivalent detail if available, else GFS, plus Hawaii buoys.

---

**Created:** 2026-04-19
**Last updated:** 2026-04-19
**Depends on:** None (this plan is standalone)
**Blocks:** Full global rollout of `WAVE_PERFORMANCE_V2_PLAN.md`
**Related:** `GLOBAL_SPOT_ANALYSIS.md` (AI side of global expansion), `CDIP_INTEGRATION_STATUS.md`, `WIND_STATION_MAPPING.md`
