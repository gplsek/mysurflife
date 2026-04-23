# Map V2 — Data Gap Review

**Source docs:** `ClaudeDesign/project/SPEC-map.md`, `ClaudeDesign/project/CLAUDE.md`, `ClaudeDesign/project/MapBackground.jsx`
**Context:** Replacing/augmenting the current `MapOverlay.js` with the new Leaflet + CARTO Dark Matter world map page (`/map`). User has signaled that the Windy-style wind/wave canvas overlays (`WindCanvasLayer`, `WindParticlesLayer`, `WaveCanvasLayer`, `WaveParticlesLayer`) may be shelved until rendering is solved.
**Verdict in one sentence:** The new spec is mostly already feasible with backend data we have — the hard part is (a) a `/api/map/bundle` endpoint that returns everything in one round-trip, (b) a live `rating` per spot without N+1 scoring calls, and (c) productionizing the storm feed we already parse.

---

## 1. What the design expects (MapBundle shape)

Per §0 of SPEC-map.md, the page loads a single bundle on mount:

```ts
type MapBundle = {
  spots: Spot[];       // id, name, region, lat, lon, rating, swell, period, wind, water, fav
  buoys: Buoy[];       // id, name, lat, lon, wave, period
  storms: Storm[];     // id, name, lat, lon, label (e.g. "980 mb · 55 kt")
  regions: Region[];   // id, label, bbox
  user?: { favorites: string[] };
};
```

Plus §14 calls out what must be **live** in production:

| # | Field | Current state |
|--:|---|---|
| 1 | `SPOTS[]` | ✅ Have (`/api/surf-spots`) |
| 2 | `spot.rating` | ⚠️ Only available via `with_scores=true` — slow, N+1, no `ORDER BY rating` index |
| 3 | `BUOYS[]` + live wave/period | ✅ Registry + `/api/buoy-status/all` |
| 4 | `STORMS[]` | ⚠️ `high_seas.py` parses it but no public endpoint returning storm coords |
| 5 | `REGIONS[]` | 🆕 Hardcoded in frontend — fine as-is |
| 6 | Legend buoy/storm counts | ✅ Derived (`BUOYS.length`/`STORMS.length`) |
| 7 | "Updated 2m ago" | ⚠️ Need freshness timestamp in response envelope |
| 8 | `locateMe` | 🆕 Pure frontend (`navigator.geolocation`) |
| 12 | Search across spots/buoys/storms | 🆕 Frontend substring filter — no backend work unless 1000+ spots |

---

## 2. Gap analysis per element

### 2.1 `spot.rating` (the big one)

**Design contract:** Every spot marker carries a `rating` 0–5 at page load. Clustering colors (avg rating), legend bins (Firing/Solid/Fun/Fair/Flat), preview card, search ranking — all depend on it being present and current.

**Reality today:**
- `/api/surf-spots?with_scores=true` *does* compute it, but it:
  - Fetches every buoy inline (18 HTTP round-trips even with cache).
  - Calls `calculate_spot_score` per spot (no concurrency limit).
  - Returns in 5–15s cold — unacceptable for map mount.
- With North America + Hawaii + globe, `n` goes from ~48 → 500 → 5000. N+1 dies.

**Proposed solution — pre-baked `spot_ratings` table refreshed on a cadence:**

```sql
CREATE TABLE public.spot_ratings (
  spot_slug      text PRIMARY KEY REFERENCES spots(slug) ON DELETE CASCADE,
  rating         numeric(3,1) NOT NULL,              -- 0.0 – 5.0
  primary_swell_ft  numeric(4,1),
  primary_period_s  numeric(4,1),
  wind_mph       numeric(4,1),
  water_temp_f   numeric(4,1),
  computed_at    timestamptz NOT NULL DEFAULT now(),
  forecast_hour  smallint NOT NULL DEFAULT 0,        -- 0 = now-cast
  source         text NOT NULL                       -- 'buoy' | 'openmeteo' | 'blended'
);

CREATE INDEX idx_spot_ratings_rating ON public.spot_ratings (rating DESC);
```

Refresh job (`backend/jobs/rate_spots.py`): every 15 min for tier-1 spots (CA + Hawaii + editorial picks), every 60 min for tier-2 (rest of NA), every 3–6 h globally. Uses the same `calculate_spot_score` + Open-Meteo point fetch already scaffolded. Writes rows in one transaction; map endpoint just does:

```sql
SELECT s.slug, s.name, s.subregion, s.lat, s.lon,
       r.rating, r.primary_swell_ft, r.primary_period_s, r.wind_mph, r.water_temp_f
FROM spots s LEFT JOIN spot_ratings r ON r.spot_slug = s.slug
WHERE r.computed_at > now() - interval '6 hours';
```

That's a single indexed query that returns in <200ms for 5000 rows.

**Fallback when a spot has no rating yet (new spot, job hasn't run):** return `rating: null` and render the "Flat" bin (muted ring, no badge). Don't block the map.

### 2.2 Storms endpoint (small work, big visual impact)

**Design contract:** 3 `Storm` markers rendered as animated pulses (120×120 concentric rings). Requires `{ id, name, lat, lon, label: "980 mb · 55 kt" }`.

**Reality today:** `backend/high_seas.py` already parses NWS High Seas bulletins for N. Pacific + N. Atlantic + S. Pacific and extracts `type`, `lat`, `lon`, `pressure_mb`, `wind_kts`, `sea_height_ft`, `movement`. It's used by Copilot's `scan_active_storms` tool but there's no public HTTP endpoint.

**Proposed: `/api/storms/active`**

```python
@app.get("/api/storms/active")
async def get_active_storms(
    oceans: str = "north_pacific,north_atlantic,south_pacific",
    min_pressure_mb: int = 1000,     # only low-pressure systems
    min_wind_kts: int = 35,          # gale force and up
):
    """Returns a flat list ready for the Map bundle."""
    out = []
    for ocean in oceans.split(","):
        hs = await get_high_seas(ocean.strip())
        for s in hs.get("systems", []):
            if s.get("type") not in ("LOW", "HURRICANE", "TYPHOON", "TROPICAL STORM"):
                continue
            if s.get("pressure_mb") and s["pressure_mb"] > min_pressure_mb:
                continue
            if s.get("wind_kts") and s["wind_kts"] < min_wind_kts:
                continue
            out.append({
                "id": f"{ocean}-{s['lat']:.1f}-{s['lon']:.1f}",
                "name": f"{s['type'].title()} · {_ocean_label(ocean)}",
                "lat": s["lat"], "lon": s["lon"],
                "label": _format_label(s),   # "985 mb · 50 kt"
            })
    return {"storms": out, "issued_utc": ..., "cached": ...}
```

Cache 6h (bulletins refresh every 6h). Zero new data sources needed.

**Optional extension:** derive storms from WW3 where `htsgwsfc > 20ft` clusters (per §14 suggestion). Not needed for v1 — the NWS bulletins cover the top-3 basins already.

### 2.3 Buoys — filter to "coastal/shelf stations relevant to surf"

**Design note in §14:** "Pull live from NDBC. Filter to coastal/shelf stations relevant to surf."

**Reality:** `get_all_buoys()` returns ~50 stations in the current registry (CA + OR + WA + HI). `/api/buoy-status/all` returns wave height + period per station. This maps cleanly to `Buoy { id, name, lat, lon, wave, period }`.

**Gap at scale:** NDBC has ~200 active coastal buoys globally. We only have ~50 in our fallback list. To go worldwide, we need:

1. Ingest the NDBC station table — `https://www.ndbc.noaa.gov/activestations.xml` (public, updated daily). Filter `type="buoy"` and `met="y"` or `currents="y"`. Keep only stations within ~50nm of coast (filter by a coastline GeoJSON or a `min_depth` heuristic).
2. Store in `public.buoys` table with `surf_relevant boolean` flag so we can exclude deep offshore sentinels (e.g. mid-Pacific weather buoys).
3. Internationally, extend with CDIP for Mexico/Central America, UK's Cefas network, Australia's MHL/BOM, NZ's MetService buoys — all have public feeds, none have a single aggregator. This is its own mini-project; punt to Tier 3.

**For v1:** Use current registry. Ship it. Expand when the global spot rollout happens (see DATA_ARCHITECTURE_SCALING discussion).

### 2.4 Regions

Hardcoded in the frontend. Design says "may stay hardcoded OR derive dynamically from user's favorites." **Recommendation:** keep hardcoded for v1 — 9 editorial regions map cleanly to the global spot distribution. The `bbox` values in the prototype are fine. If we grow past 20 regions, move to a `regions.json` config file, not a DB table.

### 2.5 Live freshness timestamp

Design §5.1 wants "Updated {N}m ago" — bind to actual data-freshness timestamp.

**Simple fix:** the `/api/map/bundle` envelope returns `updated_at`:

```json
{
  "spots": [...],
  "buoys": [...],
  "storms": [...],
  "updated_at": "2026-04-22T18:03:00Z",
  "components": {
    "spots_freshness":  "2026-04-22T17:58:00Z",
    "buoys_freshness":  "2026-04-22T18:02:30Z",
    "storms_freshness": "2026-04-22T12:00:00Z"
  }
}
```

Frontend renders the oldest-of or spots-freshness. Cheap.

### 2.6 User favorites

Design §7.2 "Favorites only" toggle requires `spot.fav: true` flag per spot.

**Reality:** `user_favorites` table exists in migration 006 (`user_id` + `spot_id` + `sort_order` + RLS policies). No CRUD endpoint yet.

**Need to add:**
- `GET  /api/user/favorites` → `["pipeline", "mavericks", "rincon", ...]`
- `POST /api/user/favorites` → `{ spot_slug }`
- `DELETE /api/user/favorites/{spot_slug}`

Frontend reads the list once, derives `spot.fav` client-side. Does not need server-side join. (Same as SPOT_DETAIL_V2_PLAN §5.6.)

### 2.7 Search (server-side for scale)

Per §14 item 12: "Extend search to buoys (id/name) and storms (name). Rank Spot > Region > Buoy > Storm."

**Under 500 spots:** keep client-side substring match. Free.

**500–5000 spots:** add `/api/search?q=foo&scope=spots,buoys,storms`. Postgres `ILIKE` on `spots.name`, `spots.subregion`, `buoys.name`, `buoys.id`. Sub-10ms with a `pg_trgm` GIN index. No full-text engine needed.

---

## 3. The one-shot endpoint

Ship this and the map page loads in one HTTP request:

```python
@app.get("/api/map/bundle")
async def get_map_bundle(
    user_id: Optional[str] = Depends(get_current_user_optional),
    include_storms: bool = True,
    include_buoys: bool = True,
):
    spots_task   = _fetch_spots_with_ratings()           # <200ms (pre-baked)
    buoys_task   = get_all_buoys_with_conditions()       # L1/L2 cached
    storms_task  = get_active_storms() if include_storms else _no_storms()
    favs_task    = _get_user_favorites(user_id) if user_id else _no_favs()

    spots, buoys, storms, favs = await asyncio.gather(
        spots_task, buoys_task, storms_task, favs_task
    )

    favs_set = set(favs)
    for s in spots:
        s["fav"] = s["slug"] in favs_set

    return json_sanitize({
        "spots": spots,
        "buoys": buoys,
        "storms": storms,
        "user": {"favorites": favs},
        "updated_at": _newest_timestamp([spots, buoys, storms]),
    })
```

Target: **<400ms p95** for 500 spots, <800ms for 5000. Cache the bundle at 60s TTL — map data doesn't change minute-to-minute.

---

## 4. What's NOT a gap (reassurance)

These were on my worry list before reading the spec — the design explicitly dodges them:

- **No wind/wave overlay on the map.** §16 "Out of scope" explicitly says no heatmap overlay for swell energy. This matches your call to shelve the Windy-style layers. 🎉 No WaveCanvasLayer, no GFS/HRRR/WW3 fetches on the map page. Kill `MapOverlay.js`'s overlay code on this route (keep it in a branch — it's still useful for a future dedicated `/waves` or `/wind` view).
- **No bathymetry layer.** Continents/coastlines come from CARTO's Dark Matter raster tiles. Zero data work on our side.
- **No tide grid.** Tides are per-spot on the detail page, not on the world map.
- **No forecast scrubber.** "Lives on spot detail" per §16.
- **No clustering library.** §8/§15: hand-rolled grid clustering at `zoom < 5` with `CLUSTER_GRID_PX=55`. This is a design choice to control marker visuals; don't swap in `leaflet.markercluster`.
- **No raster tile caching on our end.** CARTO's tiles are public and fast; only worry about it if you get rate-limited past ~75k tile loads/day (unlikely with DAU <10k).

---

## 5. Recommended phasing

**Phase 0 — Strip overlays from the map route** (1–2 days)
Standalone `/map` React route using Leaflet 1.9.4 + CARTO Dark Matter. No WaveCanvasLayer/WindCanvasLayer imports. Renders spots/buoys/storms from the existing endpoints called in parallel. Storms use a dev-mode stub until §2.2 ships. Validates the new chrome + clustering + z-index stack before any backend work.

**Phase 1 — `/api/storms/active`** (half day)
Wire `high_seas.py` to an HTTP route. Add the filter params. Cache 6h. Frontend pulls from it instead of the stub.

**Phase 2 — `spot_ratings` table + `/api/map/bundle`** (2–3 days)
- Migration for `spot_ratings`.
- `backend/jobs/rate_spots.py` — uses Open-Meteo point fetch + `calculate_spot_score`, writes the table.
- Systemd timer or cron: 15m for tier-1, 60m for tier-2, 6h for global.
- `/api/map/bundle` composes the four data sources in parallel.
- Frontend swaps from multi-endpoint fetch to single bundle fetch.

**Phase 3 — Favorites CRUD + `fav` flag** (half day)
Three endpoints, RLS already in place from migration 006.

**Phase 4 — Global spot expansion** (tracked separately)
Import the WannaSurf list (or licensed equivalent), populate `spots` + `spot_characteristics`, kick off rate-job. This is where buoy coverage also needs extending (§2.3) — paired work.

**Phase 5 — Server-side search** (defer until 500+ spots or ≥2 complaints)
Only worth it past the scale threshold.

---

## 6. Decisions I assumed — override if wrong

| # | Assumption | Alternative |
|--:|---|---|
| 1 | Pre-bake `spot_ratings` via a job (15m tier-1, 1h tier-2, 6h global) rather than compute live | Compute live with aggressive Redis cache — riskier, more moving parts |
| 2 | Keep hardcoded `REGIONS[]` in the frontend | Move to a DB table if editorial team wants to manage them |
| 3 | `/api/storms/active` filters to `LOW/HURRICANE/TYPHOON/TROPICAL STORM`, `pressure ≤ 1000mb`, `wind ≥ 35kt`. Design shows 3 storms; these thresholds typically yield 3–6 globally. | Loosen filters to show anticyclones too — probably not useful for surf |
| 4 | Shelve Windy-style wave/wind overlays on this route entirely (per your direction). Keep the code in `main` but unused on `/map`. | Revive later as separate `/ocean-view` route if value emerges |
| 5 | Buoy coverage stays at current ~50 stations for v1. Global expansion happens alongside global spot rollout (Phase 4). | Expand buoys first — higher effort, less user-visible |
| 6 | Clustering stays hand-rolled at `CLUSTER_GRID_PX=55` per design §15 — no `leaflet.markercluster` | Switch to Supercluster at 5000+ spots |
| 7 | `rating` source of truth is Open-Meteo point forecast + `calculate_spot_score`, not Surfline's rating (which would require scraping/license) | Blend: show Open-Meteo primary, Surfline optional premium tier |

---

## 7. Files to create / modify

**New:**
- `backend/routes/map.py` — `/api/map/bundle`, `/api/storms/active` (or inline in `main.py`, your call on the split)
- `backend/routes/favorites.py` — CRUD for `user_favorites`
- `backend/jobs/rate_spots.py` — scheduled rating refresh
- `backend/migrations/00X_spot_ratings.sql` — the table above
- `frontend/src/pages/Map.jsx` — new route (replaces the map part of `MapOverlay.js`)
- `frontend/src/components/map/{SpotMarker,BuoyMarker,StormMarker,ClusterMarker,PreviewCard,RegionChips,LeftRail,StatusBar,ZoomControls}.jsx` — mirrors `spot/` primitives folder from SPOT_DETAIL_V2_PLAN §4
- `frontend/src/hooks/useMapBundle.js` — React Query fetcher for the bundle

**Modify:**
- `backend/main.py` — register new routes
- `backend/high_seas.py` — add `get_active_storms_flat(filters)` helper if not inlined
- `backend/buoy_registry.py` — expose `get_all_buoys_with_conditions()` that joins status
- `frontend/src/App.js` — add `/map` route; leave legacy `MapOverlay.js` behind feature flag until ready to retire

**Retire (on `/map` only, keep in `/old-map` behind flag):**
- `WindCanvasLayer.js`, `WindParticlesLayer.js`, `WaveCanvasLayer.js`, `WaveParticlesLayer.js`
- Their API consumers: `/api/wind-overlay`, `/api/waves-overlay`, `/api/wind/frames`, `/api/waves/run-availability` (leave backend endpoints alive for the parked overlay work)

---

## 8. References

- **Spec:** `ClaudeDesign/project/SPEC-map.md` (this review's anchor)
- **Prototype wiring notes:** `ClaudeDesign/project/CLAUDE.md`
- **Existing endpoints:** `backend/main.py` §§3250, 602, 3896 (spots, buoys, overlays-models)
- **Storm parser:** `backend/high_seas.py` lines 104–225
- **Favorites schema:** `backend/migrations/006_sessions_core.sql` lines 155–177
- **Companion:** `notes/SPOT_DETAIL_V2_PLAN.md` (spot detail side of the rebuild)
- **Out-of-scope on this page per §16:** forecast scrubber, session logging, comments, route planning, heatmaps

---

**Bottom line:** The map design asks for one `MapBundle` on mount with `spots`, `buoys`, `storms`, `favorites`. We already have 3 of those 4; the only real backend work is (a) a `spot_ratings` pre-bake table so ratings come back in one query, (b) a public `/api/storms/active` wrapper around `high_seas.py`, and (c) favorites CRUD. That's ~4–6 days of backend. Shelving the Windy-style overlays simplifies the frontend considerably — the map route becomes a clean Leaflet + divIcon page with no canvas.
