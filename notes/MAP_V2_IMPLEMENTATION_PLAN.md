# Map V2 — Implementation Plan

**Audience:** Claude Code
**Purpose:** Phased, shippable plan for the new `/map` route per `ClaudeDesign/project/SPEC-map.md`, incorporating the data gaps and storm-characterization work from `notes/MAP_V2_DATA_GAPS.md`.
**Companion docs:**
- `notes/MAP_V2_DATA_GAPS.md` — the "why" behind new endpoints
- `notes/STORM-card.md` — design spec for the storm card (supersedes `STORM_CARD_DESIGN_BRIEF.md`)
- `notes/SIONE_CAPABILITIES.md` — Sione modes, endpoints, prompt migration — **required reading before Phase 5**

---

## 0. Approach

Six phases. Each is independently shippable and merges behind a feature flag (`FF_MAP_V2`). Order is load-bearing — don't reorder without talking to the author.

```
Phase 0  Map shell with existing endpoints + mocked storms     ~3 days
    ↓
Phase 1  /api/storms/active + enhanced bulletin parsing         ~2 days
    ↓
Phase 2  spot_ratings table + /api/map/bundle (one-shot)        ~3 days
    ↓
Phase 3  Favorites CRUD + `fav` flag                            ~1 day
    ↓
Phase 4  Storm → swell arrival (scorecard + spot breakdown)     ~4 days
    ↓
Phase 5  Sione stand-up (rename + modes + handoffs)             ~8 days
         5a rename & scaffold · 5b analyze endpoint · 5c sessions
         5d spot-detail card · 5e admin panel migration
         (see notes/SIONE_CAPABILITIES.md §7 for sub-phase detail)
```

Phase 4 depends on Phase 1 (storm data) and Phase 2 (spot coverage). Phase 5 depends on Phase 4. The rename from "Copilot" to **Sione** is locked in — see `notes/SIONE_CAPABILITIES.md` for the full Sione spec. Phase 3 can slot between any others after Phase 2.

Global expansion (WannaSurf import, buoy network extension) is a separate track — not required to ship Phase 0–5, enables it at scale afterward.

---

## 1. Phase 0 — Map shell with existing endpoints

**Goal:** Stand up the new `/map` route with the chrome, markers, clustering, and preview card, using data we already have. Validates the Leaflet + divIcon pattern and the z-index stack before any backend work. Storms are mocked.

### New files

```
frontend/src/pages/Map.jsx                          # Top-level route component
frontend/src/components/map/
    Chrome.jsx                                      # Wraps topbar, region bar, left rail, status bar, zoom controls
    RegionChips.jsx
    LeftRail.jsx                                    # Markers legend + Layers toggles
    StatusBar.jsx
    ZoomControls.jsx
    PreviewCard.jsx
    SpotMarker.jsx                                  # divIcon generator
    BuoyMarker.jsx
    StormMarker.jsx                                 # with CSS pulse animation
    ClusterMarker.jsx
    useMapBundle.js                                 # React Query data hook (temporary multi-endpoint)
    useMapState.js                                  # state object per SPEC §9
    clusterGrid.js                                  # 55px grid clustering per SPEC §8
frontend/src/styles/map-v2.css                      # Dark Matter overrides, z-index stack, marker CSS
```

### Modified files

- `frontend/src/App.js` — register `/map` route behind `FF_MAP_V2` flag; keep old `MapOverlay.js` route available at `/old-map` until Phase 5 ships
- `frontend/src/config/featureFlags.js` — add `FF_MAP_V2`
- `frontend/package.json` — confirm `leaflet: ^1.9.4` pinned; no `react-leaflet` needed (spec uses vanilla Leaflet for marker control)

### No backend work this phase

- Spots: call existing `/api/surf-spots?with_scores=true`. Accept the 5–15s cold load — this will be replaced in Phase 2.
- Buoys: call existing `/api/buoy-status/all`.
- Storms: inline mock array of 3 storms in `useMapBundle.js`. Production source lights up in Phase 1.
- Favorites: hardcoded 7-spot list per SPEC §15.

### Acceptance criteria

- `/map` loads, centers at `[25, -50]` zoom `2`, shows CARTO Dark Matter tiles
- Spot markers render with correct tier class per `rating` (firing/solid/good/fair/flat)
- Clustering kicks in at zoom <5 with 55px grid
- Clicking a spot opens `PreviewCard`, `flyTo` at `max(currentZoom, 7)`
- Region chips filter via `fitBounds` + `moveend` re-render
- Layers toggles work (spots / buoys / storms / favorites-only)
- ⌘K focuses search, Esc closes preview
- Mobile: ≤900px hides left rail, region chips become horizontal scroller
- No canvas overlays imported — verify `WindCanvasLayer` etc. are not in the Map.jsx tree
- Console clean in dev and prod builds

### Out of scope for Phase 0

Server-side search. Real storm data. Favorites persistence. Performance tuning of spot ratings. Live "Updated Xm ago."

---

## 2. Phase 1 — `/api/storms/active` + enhanced parsing

**Goal:** Replace the 3-storm mock with real data from `backend/high_seas.py`, and extract fields we need for the storm card (fetch geometry, forecast track, warnings).

### New files

```
backend/routes/storms.py                            # /api/storms/active
backend/migrations/010_storm_observations.sql       # Append-only history table
```

### Modified files

```
backend/high_seas.py
    + _parse_fetch_quadrant(section)                # "STORM FORCE WINDS FROM W QUADRANT 150 NM"
    + _parse_forecast_positions(section)            # "WILL MOVE NE TO 47N 148W BY 12Z WED"
    + _parse_warning_tier(section)                  # gale / storm / hurricane
    + _basin_label_from_text(section)               # "GULF OF ALASKA" vs generic "N. PACIFIC"
backend/main.py                                     # register routes/storms.py
```

### API contract — `/api/storms/active`

```
GET /api/storms/active
    ?oceans=north-pacific,north-atlantic,south-pacific
    &min_pressure_mb=1000
    &min_wind_kts=35

Response:
{
  "storms": [
    {
      "id": "np-42.5-155.0",
      "type": "LOW",                  // LOW | HURRICANE | TYPHOON | TROPICAL STORM | TROPICAL DEPRESSION
      "name": "Low Pressure · Gulf of Alaska",
      "lat": 42.5, "lon": -155.0,
      "pressure_mb": 985,
      "wind_kts": 55,
      "sea_height_ft": 22,
      "sea_range_ft": [18, 22],
      "movement": { "direction": "NE", "speed_kts": 15 },
      "warning_tier": "storm",        // none | gale | storm | hurricane
      "fetch": {
        "quadrant": "W",              // N | NE | E | SE | S | SW | W | NW | semicircle designators
        "radius_nm": 150,
        "wind_kts_in_fetch": 50
      },
      "forecast_track": [
        { "hours_ahead": 24, "lat": 44.0, "lon": -151.0, "pressure_mb": 990, "wind_kts": 50 },
        { "hours_ahead": 48, "lat": 45.5, "lon": -146.0, "pressure_mb": 995, "wind_kts": 40 },
        { "hours_ahead": 72, "lat": 46.0, "lon": -140.0, "pressure_mb": 1002, "wind_kts": 30 }
      ],
      "issued_utc": "2026-04-22T12:00:00Z",
      "raw_text": "…bulletin section verbatim…"
    }
  ],
  "updated_at": "2026-04-22T12:00:00Z",
  "cached": true
}
```

Fields `forecast_track` and `fetch` may be `null` if the bulletin didn't have parseable data for that storm — frontend must handle gracefully (no track line, no wedge). Always populate `lat/lon/pressure_mb/wind_kts/movement` from what we parse today.

### Storm history

On every `get_high_seas()` call that refreshes the cache, insert observed positions into `storm_observations` so we accrue a history:

```sql
CREATE TABLE public.storm_observations (
    id             bigserial PRIMARY KEY,
    storm_key      text NOT NULL,             -- basin + rough position hash
    observed_utc   timestamptz NOT NULL,
    lat            numeric(6,3),
    lon            numeric(7,3),
    type           text,
    pressure_mb    smallint,
    wind_kts       smallint,
    sea_height_ft  smallint,
    raw_entry      jsonb
);

CREATE INDEX idx_storm_obs_key_time
    ON public.storm_observations (storm_key, observed_utc DESC);
```

`storm_key` format: `{basin}-{round(lat,0)}-{round(lon,0)}` — loose enough to associate re-parses of the same system despite small position drift. Not perfect — a dedicated tracker is a larger project and not needed for v1.

### Acceptance criteria

- `/api/storms/active` returns live parsed data from current bulletins; storms appear on `/map` in their real positions
- At least 80% of storms have a non-null `forecast_track`; log warnings for ones that parse empty
- `fetch.quadrant` + `radius_nm` populated when bulletin uses standard wording
- `storm_observations` table accrues rows — verify by re-calling the endpoint at 6h boundaries
- Response cached 6h; recompute when bulletins refresh
- Storms filter respects `min_pressure_mb` and `min_wind_kts`
- Golden-file test covering 3 real bulletins (capture live text into `backend/tests/fixtures/high_seas/`)

---

## 3. Phase 2 — `spot_ratings` table + `/api/map/bundle`

**Goal:** Eliminate the N+1 scoring problem. One endpoint returns everything the map needs in <400ms.

### New files

```
backend/migrations/011_spot_ratings.sql             # Pre-baked ratings table
backend/jobs/rate_spots.py                          # Scheduled refresh job
backend/routes/map.py                               # /api/map/bundle
```

### Migration 011

```sql
CREATE TABLE public.spot_ratings (
    spot_slug          text PRIMARY KEY REFERENCES spots(slug) ON DELETE CASCADE,
    rating             numeric(3,1) NOT NULL CHECK (rating >= 0 AND rating <= 5),
    primary_swell_ft   numeric(4,1),
    primary_period_s   numeric(4,1),
    primary_swell_dir  smallint,
    wind_mph           numeric(4,1),
    wind_dir           smallint,
    water_temp_f       numeric(4,1),
    computed_at        timestamptz NOT NULL DEFAULT now(),
    forecast_hour      smallint NOT NULL DEFAULT 0,
    source             text NOT NULL                -- 'buoy' | 'openmeteo' | 'blended'
);

CREATE INDEX idx_spot_ratings_rating ON public.spot_ratings (rating DESC);
CREATE INDEX idx_spot_ratings_computed_at ON public.spot_ratings (computed_at DESC);
```

### `rate_spots.py` tiers

| Tier | Spots | Cadence | Source |
|---|---|---|---|
| 1 | CA + HI + editorial picks (~100) | 15 min | Buoy → surf_scoring |
| 2 | Rest of North America + MX (~500) | 60 min | Open-Meteo point fetch + surf_scoring |
| 3 | Global (~5000 target) | 6 hours | Open-Meteo point fetch + surf_scoring |

Run as three separate systemd timers or a single job with `--tier` argument. Use `WIND_SEM = asyncio.Semaphore(6)` for tier-3 bulk fetches (Open-Meteo rate limit safe at ~10k/day per IP; batch with 0.02° bbox rounding per CLAUDE.md caching pattern).

### API contract — `/api/map/bundle`

```
GET /api/map/bundle
    ?include_storms=true
    ?include_buoys=true

Response:
{
  "spots": [
    {
      "slug": "mavericks", "name": "Mavericks", "region": "Half Moon Bay, CA",
      "lat": 37.494, "lon": -122.502,
      "rating": 4.2,
      "swell": 14.2, "period": 17, "wind": 8, "water": 54,
      "fav": true
    }
  ],
  "buoys": [
    { "id": "46026", "name": "San Francisco Bar",
      "lat": 37.75, "lon": -122.83, "wave": 12.3, "period": 16 }
  ],
  "storms": [ /* shape from Phase 1 */ ],
  "user": { "favorites": ["mavericks", "pipeline", "rincon", ...] },
  "updated_at": "2026-04-22T18:03:00Z",
  "components": {
    "spots_freshness":  "2026-04-22T17:58:00Z",
    "buoys_freshness":  "2026-04-22T18:02:30Z",
    "storms_freshness": "2026-04-22T12:00:00Z"
  },
  "cached": true
}
```

Compose in parallel with `asyncio.gather`. Cache 60s. Serve even if one component fails (return empty list + warning in logs — do NOT 500).

### Modified files

```
frontend/src/components/map/useMapBundle.js         # Swap from 3 endpoints to /api/map/bundle
frontend/src/components/map/StatusBar.jsx           # Bind "Updated Xm ago" to bundle.updated_at
backend/main.py                                     # Register routes/map.py
```

### Acceptance criteria

- `/api/map/bundle` p95 <400ms when `spot_ratings` is fresh (<6h old)
- When a spot has no row in `spot_ratings` (new spot), it returns with `rating: null` — map renders it in "flat" bin, does not crash
- `rate_spots.py` successful run writes rows, log captures count + tier + duration
- Status bar shows real minute-ago countdown, updates every 60s
- Failure of `/api/storms/active` does not fail the bundle — bundle returns with `storms: []` and a warning

---

## 4. Phase 3 — Favorites CRUD

**Goal:** Wire the `user_favorites` table from migration 006 to three endpoints, drive the `fav` flag + favorites-only toggle.

### New files

```
backend/routes/favorites.py                         # CRUD for user_favorites
frontend/src/components/spot/FavoriteButton.jsx    # Star toggle (also used on SpotDetail)
```

### API contract

```
GET    /api/user/favorites
    → { "favorites": ["mavericks", "pipeline", ...] }

POST   /api/user/favorites
    Body: { "spot_slug": "mavericks" }
    → 201 Created + { "favorites": [...] }

DELETE /api/user/favorites/{spot_slug}
    → 204 No Content + { "favorites": [...] }
```

Auth via existing session/JWT — RLS policies already in migration 006. Return the full list on every mutation so the frontend doesn't need to re-fetch.

### Acceptance criteria

- Unauthenticated user: `/api/map/bundle` returns `user: { favorites: [] }`, favorites-only toggle is hidden or disabled with tooltip "Sign in to use favorites"
- Authenticated user: toggle persists across sessions
- Star on `PreviewCard` optimistically updates, rolls back on error
- Favorites-only filter (`state.favsOnly`) correctly hides non-favorite spots

---

## 5. Phase 4 — Storm swell-arrival

**Goal:** Click a storm → see which regions it delivers surf to → drill into spot-level arrivals. Implements Levels 1 & 2 of the storm card design.

### New files

```
backend/migrations/012_spot_subregions.sql          # Add sub-regions column
backend/routes/storms.py                            # (extend) /api/storms/{id}/arrivals
backend/storm_arrivals.py                           # Service layer — pre-computes storm × spot
frontend/src/components/map/
    StormCard.jsx                                   # The click-to-reveal card
    RegionalScorecard.jsx                           # Level 1 regional summary
    ArrivalSpotList.jsx                             # Level 2 per-region spot breakdown
    ArrivalRow.jsx                                  # Single spot × arrival cell
    StormFetchWedge.jsx                             # SVG wedge over Leaflet, not canvas
    StormForecastTrack.jsx                          # Polyline + waypoint circles
```

### Migration 012 — sub-regions

```sql
ALTER TABLE public.spots
    ADD COLUMN subregion_key text;                  -- 'so_cal_south', 'baja_norte', ...

CREATE INDEX idx_spots_subregion ON public.spots (subregion_key);

CREATE TABLE public.subregions (
    key               text PRIMARY KEY,             -- 'baja_norte'
    label             text NOT NULL,                -- 'Baja Norte'
    parent_region     text NOT NULL,                -- 'mex'
    centroid_lat      numeric(6,3),
    centroid_lon      numeric(7,3),
    display_order     smallint DEFAULT 100
);
```

Seed 20–30 sub-regions: `nor_cal`, `central_coast`, `so_cal_north`, `so_cal_south`, `baja_norte`, `baja_sur`, `mainland_mx`, `oaxaca`, `c_america`, `peru`, `n_chile`, `c_chile`, `brazil_ne`, `brazil_s`, `oahu_north`, `oahu_south`, `maui`, `kauai`, `big_island`, `w_sumatra`, `bali`, `java`, `mentawais`, `sumbawa`, `lombok`, `east_oz`, `west_oz`, `nz_north`, `nz_south`, `europe_atlantic`.

Tag existing spots (one-pass migration data script). New spots get tagged at import.

### Arrivals service

```python
# backend/storm_arrivals.py

@cached(ttl=21600)  # 6h, matches bulletin refresh cadence
async def compute_storm_arrivals(storm_id: str) -> Dict:
    """
    For a given storm, compute arrival at every spot globally.
    Aggregate by sub-region. Return both.
    """
    storm = await get_storm(storm_id)
    spots = await get_all_spots_with_windows()

    # Build storm_positions list from current + forecast_track
    positions = [current] + forecast_track

    arrivals = []
    for spot in spots:
        arrival = swell_arrivals(positions, spot.lat, spot.lon, spot.name)
        if arrival and arrival.peak_size_ft >= 3.0:
            # Score the arrival against spot swell/wind windows
            score = score_arrival_for_spot(arrival, spot)
            arrivals.append({ **arrival, "spot": spot, "score": score })

    # Aggregate by subregion
    subregion_summary = aggregate_by_subregion(arrivals)

    return {
        "storm_id": storm_id,
        "subregions": subregion_summary,     # Level 1 data
        "spots": arrivals                    # Level 2 data
    }
```

### API contract — `/api/storms/{id}/arrivals`

```
GET /api/storms/np-42.5-155.0/arrivals

Response:
{
  "storm_id": "np-42.5-155.0",
  "subregions": [
    {
      "key": "mainland_mx",
      "label": "Mainland Mexico",
      "parent_region": "mex",
      "peak_size_ft": 11,
      "peak_period_s": 17,
      "peak_utc": "2026-04-25T13:00:00Z",
      "first_arrival_utc": "2026-04-25T05:00:00Z",
      "window_hours": 48,
      "spot_count": 12,
      "top_spots": ["pascuales", "puerto-escondido", "salina-cruz"]
    }
  ],
  "spots": [
    {
      "slug": "pascuales",
      "first_arrival_utc": "2026-04-25T05:00:00Z",
      "peak_utc": "2026-04-26T09:00:00Z",
      "peak_size_ft": 11, "peak_period_s": 17, "peak_dir": 298,
      "window_hours": 40,
      "score": 4.3,
      "wind_at_peak_mph": 4, "wind_at_peak_dir": 135,
      "tide_at_peak_ft": 0.8
    }
  ],
  "computed_at": "2026-04-22T18:03:00Z"
}
```

### Acceptance criteria

- Clicking a storm opens `StormCard` with Levels 1 + 2 visible (scorecard + spot list)
- Switching sub-region in scorecard updates spot list + dims non-region spots on map + draws great-circle arc
- Sub-regions with no spots above 3 ft floor do not appear — list stays honest and short
- `/api/storms/{id}/arrivals` p95 <800ms cold, <50ms warm
- Fetch wedge renders on map when `fetch.quadrant` present, hidden otherwise
- Forecast track polyline renders with 24/48/72h waypoint circles
- Physics sanity-check: N. Atlantic storm never shows Hawaii sub-regions

---

## 6. Phase 5 — Sione stand-up

**Goal:** Replace Copilot with Sione, a single assistant operating in three modes (Geometry Analyst, Storm Planner, Generalist). Storm card "Plan trip with Sione" deep-links into a session with context pre-loaded; spot detail page gains a Sione-powered inline card. Subsumes the pre-existing `ai_personas*` library.

**Full spec:** `notes/SIONE_CAPABILITIES.md` — modes, endpoints, prompt migration, workplan broken into sub-phases 5a–5e. This section is a summary pointer; don't duplicate contents.

### Key deliverables (summary)

- **5a — Rename & scaffold.** `backend/routes/copilot.py` → `sione.py`; `Copilot.jsx` → `Sione.jsx`; new `backend/sione/modes/` directory; `ai_personas_spots.py` prompt migrates verbatim into `sione/modes/spot_geometry.py`.
- **5b — Analyze endpoint.** `POST /api/sione/analyze` with 30-day cache in `sione_analyses` table (migration 013). Powers the spot-detail card. Versioned output schema `sione.analyze.spot.v1`.
- **5c — Sessions endpoint.** `POST /api/sione/sessions` for conversational handoffs. Context body per STORM-card.md §8. Session rows in `sione_sessions` (migration 014). Deep link `/sione/:session_id`.
- **5d — Spot detail card.** New `SioneReadCard.jsx` on spot detail page; "Ask Sione about this spot" chip handoff. Un-drops the AI section that was removed in SPOT_DETAIL_V2_PLAN.
- **5e — Admin panel.** Fixed 3-mode list; per-mode prompt editor; schema picker; cache-invalidation on save.

### Acceptance criteria (Phase 5 rollup)

- Storm card "Plan trip with Sione" CTA creates session with full context, lands user in `/sione/:session_id` with opening message rendered
- Spot detail page shows Sione card with structured analysis above the fold; graceful empty state on LLM failure
- `/api/sione/analyze` p95 <300ms cached, <5s cold; 30-day cache hit rate >95% in steady state
- Admin editing a mode prompt invalidates cached analyses and takes effect on next call
- Old `/copilot` URL 301-redirects to `/sione`; no Copilot references visible in product UI
- Sione session persists across browser refresh via URL `session_id`
- Three modes each verifiable via `/api/sione/test` admin endpoint with sample contexts

### What *not* to generate in Sione

See `SIONE_CAPABILITIES.md §4`. In short: storm positions, swell arrivals, tier classifications, wind/tide at arrival, spot scores are all deterministic outputs from `high_seas.py` + `swell_physics.py` + `surf_scoring.py` + Open-Meteo/CO-OPS. Sione reads them as context, never computes them. Phase 4 produces the numbers; Phase 5 narrates them.

---

## 7. Non-phase tracks

**Global spot expansion** — Separate project. Import 5000+ spots from WannaSurf (or licensed alternative). Requires:
- Spot import ETL script
- Sub-region tagging for imported spots
- Buoy network expansion (ingest NDBC `activestations.xml`, tag coastal-surf-relevant subset)
- Tier 3 `rate_spots.py` job covering new spots

Not blocking v1. Map runs fine with current ~50 spots.

**Server-side search** — Defer until spot count >500 or perf complaints. Postgres `ILIKE` + `pg_trgm` GIN index when the time comes.

**Custom map area (long-press pin)** — Defer. Useful power-user feature, not v1.

**Ensemble forecast confidence cone** — Defer. GFS/ECMWF ensemble track plotting is advanced; NHC cone for tropical (built into Phase 4) covers the high-value case.

---

## 8. Copilot rename — RESOLVED: Sione

**Decision:** Rename Copilot → Sione throughout. Locked in per STORM-card.md §3.6 + §8 and confirmed with user 2026-04-22.

Rationale: natural AI-assistant framing ("ask Sione"), stays clear of surf-jargon cringe, works cleanly in product copy ("Sione found 3 storms aimed at Baja"), and dodges the Microsoft/GitHub Copilot collision. Sione also subsumes the pre-existing `ai_personas*` library — see `notes/SIONE_CAPABILITIES.md` for the full treatment (modes, endpoints, admin-panel migration, prompt migration).

**Still to confirm:**
- Trademark / domain clearance on "Sione" in the surf-app space — flag to counsel before Phase 5a merges
- Brand voice-and-tone doc from Design (one page); feeds into mode prompt wording

---

## 9. Decisions I assumed — override if wrong

| # | Assumption | Alternative |
|--:|---|---|
| 1 | Feature flag `FF_MAP_V2` gates the new route; legacy `/map` lives at `/old-map` until Phase 5 ships | Hard cutover on Phase 0 merge — riskier but simpler |
| 2 | Sub-regions are a new `subregion_key` column on `spots`, not a join table | Join table if we need many-to-many (e.g. a spot classified in two sub-regions) — unlikely |
| 3 | Storm arrivals computed server-side + cached, not client-side | Client-side would save 400ms but requires sending full spot list over the wire |
| 4 | Tier-based `rate_spots.py` cadence (15/60/360 min) rather than dynamic based on storm proximity | Could be smarter — spots near an active storm refresh faster — but adds complexity |
| 5 | NHC GeoJSON integration for tropical storms is a Phase 4 stretch goal, not a blocker | Could punt to v2 if bulletins cover the high-value case |
| 6 | Sione rename is locked before Phase 5a begins | ~~Defer rename~~ — already resolved, no longer an assumption |
| 7 | "Plan trip" handoff from storm card passes structured context, not a pre-baked prompt string | Pre-baked prompt is cheaper but loses composability (Sione can't re-query storm data) |
| 8 | Sione operates in 3 internal modes (Geometry Analyst, Storm Planner, Generalist) activated by context, not user-selected | Single mode with branching prompts — simpler but loses admin editability per capability |
| 9 | `ai_personas*` modules get migrated verbatim into `backend/sione/modes/` then deprecated | Full rewrite — safer long-term but loses the tuned Geometry Analyst prompt 

---

## 10. References

- **Design spec:** `ClaudeDesign/project/SPEC-map.md`
- **Design prototype notes:** `ClaudeDesign/project/CLAUDE.md`
- **Data gap analysis:** `notes/MAP_V2_DATA_GAPS.md`
- **Storm card spec (authoritative):** `notes/STORM-card.md` — supersedes `STORM_CARD_DESIGN_BRIEF.md`
- **Sione spec (Phase 5 source of truth):** `notes/SIONE_CAPABILITIES.md`
- **Spot detail companion:** `notes/SPOT_DETAIL_V2_PLAN.md`
- **Storm parsing:** `backend/high_seas.py`
- **Swell physics:** `backend/swell_physics.py` (Stormsurf calculator)
- **Surf scoring:** `backend/surf_scoring.py`
- **Favorites schema:** `backend/migrations/006_sessions_core.sql` lines 155–177

---

**Last updated:** 2026-04-22
