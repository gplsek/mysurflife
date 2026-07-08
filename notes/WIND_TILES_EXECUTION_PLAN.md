# Wind Tiles Execution Plan — Windy-Class Wind Map on Map V2

**Status:** 📋 Ready to execute
**Owner:** George (execution by Claude Code)
**Created:** 2026-07-07
**Supersedes nothing — reconciles:** [`WAVE_PERFORMANCE_V2_PLAN.md`](./WAVE_PERFORMANCE_V2_PLAN.md) (architecture source of truth for tiles + WebGL) with the post-Map-V2 reality: the wind overlay never migrated off the deprecated `/old-map` route.
**Companions:** [`GLOBAL_STORM_DETECTION_PLAN.md`](./GLOBAL_STORM_DETECTION_PLAN.md) (storm dots this plan puts a wind field under), [`GLOBAL_DATA_EXPANSION_PLAN.md`](./GLOBAL_DATA_EXPANSION_PLAN.md)

---

## 1. Why this plan exists (July 2026 review findings)

A full-code review (2026-07-07) of "why can't we render wind flows like windy.com / wavemaps.com" found:

### The wind overlay is stranded

- The live map (`frontend/src/pages/Map.jsx`) has **no wind or wave overlay at all**. All overlay code lives in the 3,655-line `frontend/src/MapOverlay.js` monolith, reachable only at the unlinked `/old-map` route (`App.js:260`).
- Storm dots (which ARE GFS pressure minima — `backend/jobs/detect_storms.py:493-521`) therefore render with no wind field under them. On wavemaps.com the low centers are obvious because the wind heatmap swirls around them; ours float on a bare basemap.

### The old pipeline can't be tuned into Windy quality — it's the wrong shape

| # | Limiter | Evidence |
|---|---------|----------|
| 1 | Backend decimates GFS 0.25° to a hard cap of **~3,000 vectors** (`step = sqrt(N/3000)`) — effective 0.5–1.0° at wide zoom | `backend/main.py:1315-1327` |
| 2 | Raw unrounded bbox in cache keys (client + server) → every sub-degree pan is a full NOMADS GRIB refetch | `MapOverlay.js:429`, `main.py:1597` |
| 3 | Wind cache is L1-memory-only, 10-min TTL (Redis/disk multilevel is waves-only) | `main.py:1599-1604` |
| 4 | `WIND_CONCURRENCY = 2` global semaphore serializes all users' wind processing | `backend/config.py:14` |
| 5 | Canvas 2D low-res offscreen + upscale → soft/muddy heatmap | `WindCanvasLayer.js:161-221` |
| 6 | 1,500 monochrome CPU particles, paused during pan/zoom | `WindParticlesLayer.js:198` |
| 7 | Timeline frames **pop** — `setWindData` swap tears down field + heatmap + particles; no temporal blending | `MapOverlay.js:1218` |
| 8 | Only `UGRD/VGRD` @10m fetched — **no gusts** (`var_GUST` never requested), no pressure on the overlay path | `main.py:1200-1201` |
| 9 | HRRR/NAM silently fall back to GFS — model picker is cosmetic | `main.py:1123-1125` |
| 10 | Frame cadence hardcoded (hourly 0–120, 3-hourly to 384); OPeNDAP discovery written but disabled | `main.py:1498-1514` |

Windy/wavemaps do the inverse: render each model run **once** server-side into raster tiles / u-v textures, serve from CDN, and do all animation on the GPU with crossfade between forecast hours. That is exactly what `WAVE_PERFORMANCE_V2_PLAN.md` Phases 2–3 specify. This plan executes them, wind-first, targeted at Map V2.

### What already exists and is kept

- `backend/config/ramps.json` — shared color ramp source of truth (V2 Decision #3). ✅ shipped.
- Storm detector + fetch geometry — 8-quadrant gale radii already computed (`detect_storms.py:559`) and rendered (`StormFetchWedge.jsx`). ✅ shipped.
- WW3 sea state (htsgwsfc/perpwsfc/dirpwsfc) ingestion + per-storm WW3 enrichment. ✅ shipped.
- Phase-1 quick wins partially in `MapOverlay.js` (AbortControllers, 120 ms debounce, ±3/±6 prefetch). Kept on `/old-map` until retirement; **no further investment there**.

---

## 2. Staging decision — where we build

**Decision (George, 2026-07-07): build on a dev route first, migrate to `/map` when close.**

Route strategy:

- **`/map-lab`** — new, unlinked dev route. A thin harness (~150 lines): minimal Leaflet map + the new tile layer + timeline scrubber + legend. Everything mounted here is built as **portable components** (`frontend/src/components/overlays/*`), so "migration" to `/map` is just mounting the same components inside `pages/Map.jsx` behind a NavDrawer toggle.
- **`/old-map`** stays untouched as a **visual reference** — open it side-by-side to A/B the legacy canvas rendering against tiles. We do NOT wire tiles into `MapOverlay.js`; anything built inside the monolith would have to be ported twice and inherits its state tangle.
- Backend tile work is route-agnostic — it serves both.

Rationale: the harness route costs half a day and produces zero throwaway code; wiring into `/old-map` is faster on day one but 100% throwaway.

---

## 3. Target architecture (recap from V2 plan, wind-first)

```
GFS run lands (every 6h)
   │  bake job: fetch UGRD+VGRD+GUST+PRMSL per forecast hour (GRIB filter, 0.25°)
   ▼
backend/overlay_tiles.py
   ├── float grids cached to disk per {model}/{run}/{hour}
   ├── PNG tile pyramid (color ramp from ramps.json, 256 LUT)   → /api/tiles/wind/...png
   ├── u-v texture PNG per hour (R=u, G=v, A=landmask)          → /api/tiles/wind/...uv.png
   └── raw float tiles for probes                                → /api/tiles/wind/....f32
   ▼
CDN (Cloudflare, per V2 Decision #1) — Cache-Control + ETag + immutable past runs
   ▼
frontend
   ├── WindTileLayer (L.TileLayer — browser just blits pixels)
   ├── WindParticlesLayerGL (mapbox/webgl-wind port; 10k+ colored particles)
   │     └── crossfades u-v textures between adjacent hours → smooth timeline morph
   └── OverlayTimeline (scrub = swap tile URL; prefetch adjacent hours)
```

---

## 3.5 Color scale decision (George, 2026-07-07)

Wind tiles use the **industry-standard Windy/wavemaps wind scale** (blue-purple calm → green trades → amber fresh → red-violet gale → violet storm → white hurricane), converted from Windy's public m/s table to knots, domain 0–90 kt. `wind_gust` uses the identical scale (as Windy does), so a 30 kt gust reads like 30 kt wind. Both live in `backend/config/ramps.json`; only labeled stops render legend marks. The old canvas layers/legends on `/old-map` keep their inline colors and are unaffected.

## 4. Phases

Each phase independently shippable, own PR, `/review` after each.

### Phase A — Backend tile pipeline (wind) — ~1 week

1. `backend/overlay_tiles.py` — per V2 plan §Phase 2, plus:
   - GRIB filter fetch adds **`var_GUST=on`** and **`var_PRMSL=on`** alongside UGRD/VGRD (same NOMADS URL pattern as `detect_storms.py:151`).
   - Variables: `wind_speed` (default ramp), `wind_gust` (new ramp in `ramps.json`), pressure grid stored for later isobars (no tile ramp yet).
2. Endpoints (V2 plan §Phase 2 backend task 2):
   - `GET /api/tiles/wind/{model}/{run}/{hour}/{z}/{x}/{y}.png` (+ `@2x`)
   - `GET /api/tiles/wind/{model}/{run}/{hour}/{z}/{x}/{y}.f32`
   - `GET /api/tiles/wind/{model}/{run}/{hour}/uv.png` — one global 2048×1024 u-v texture per hour (Phase C consumes; cheap to add now)
   - `GET /api/tiles/_stats`
3. Disk cache `backend/cache/tiles/...`, purge on new run; HTTP cache headers per V2 plan (immutable past runs, SWR current run).
4. Prewarm job: after each GFS run, pre-render z0–6 globally + the uv.png for every frame hour (so timeline scrubbing never hits a cold bake).
5. Frame hours: reuse the existing cadence list; serve as `GET /api/tiles/wind/{model}/runs` manifest (run id + hours) so the client never guesses.
6. requirements.txt: `Pillow`, `mercantile`.

**Accept:** cold tile < 500 ms, warm < 50 ms; full-run disk footprint measured and < 2 GB; NaN → transparent; `curl -I` shows correct cache headers.

### Phase B — `/map-lab` harness + tile layer — ~3–4 days

1. `frontend/src/components/overlays/WindTileLayer.js` — thin `L.TileLayer` wrapper (opacity from ramps alpha, `detectRetina: true`, `crossOrigin`).
2. `frontend/src/components/overlays/OverlayTimeline.jsx` — scrubber over the run manifest; hour change = `setUrl()` swap (Leaflet keeps old tiles until new ones load → no flash); prefetch ±1/±3 hours via `Image()` warmers.
3. `frontend/src/components/overlays/WindLegend.jsx` — reads `frontend/src/design/ramps.js` (no hex literals — CI rule).
4. `frontend/src/pages/MapLab.jsx` + route `/map-lab` in `App.js` (unlinked, dev only).
5. Probe: click → sample `.f32` tile locally (reuse `WindField.js` bilinear against the tile grid).
6. Variable toggle: wind speed ↔ gusts.

**Accept:** global zoom-out paints < 500 ms warm; scrubbing prefetched hours feels instant; side-by-side vs `/old-map` shows visibly crisper field; gust view renders.

### Phase C — WebGL particles + temporal morph — ~2 weeks

Per V2 plan §Phase 3 (mapbox/webgl-wind, MIT), plus the one upgrade that plan deferred:

1. `frontend/src/components/overlays/WindParticlesLayerGL.js` — particles advect against the current hour's uv.png; land mask in alpha.
2. **Hour crossfade:** hold textures for hour `h` and `h+1`; fragment shader samples both and lerps by scrub position → Windy-style continuous motion while scrubbing/playing. Tile heatmap swaps discretely underneath (acceptable; particles carry the motion illusion).
3. Particle count setting (10k default, 5k mobile cap — V2 Decision #4). WebGL-unavailable → banner, heatmap stays (Decision #5).

**Accept:** 10k particles ≥ 55 fps on M1 Air; play mode has no visible pop between hours; iOS Safari works.

### Phase D — Migrate to `/map` + storm integration — ~1 week

1. Mount `WindTileLayer` + `WindParticlesLayerGL` + `OverlayTimeline` in `pages/Map.jsx`; add **Wind** toggle to `NavDrawer` `LAYER_TOGGLES` (currently Spots/Buoys/Storms only — `NavDrawer.jsx:29-46`).
2. Storm dots over wind: dots + fetch wedges render above tiles (z-index per CLAUDE.md hierarchy); verify the visual "dot sits on the swirl" story. If 1° detection offsets are visible against the 0.25° field, add a snap-to-local-minimum refinement pass in `detect_storms.py` using the 0.25° PRMSL grid already fetched in Phase A.
3. **Storm dots ride the timeline:** replace the current first-waypoint interpolation (`Map.jsx:223-233`) with full `forecast_track` interpolation keyed to the shared overlay hour.
4. Feed **max gust** into the storm record (`detect_storms.py` box-max of GUST around center) → StormCard "Max gusts" line next to sustained wind.
5. Retire: remove `/map-lab` link-through, then (after 1 week stable) delete `/old-map` route + `WindCanvasLayer.js`, `WindParticlesLayer.js`, `WindGrid.js`, legacy `/api/wind-overlay` JSON path (V2 Decision #5).

**Accept:** wind + storms visible together on `/map`; scrubbing moves storms along tracks in sync with the wind field; gusts on StormCard; old route deleted.

### Later (not this plan)

- Wave tiles on the same pipeline (the V2 plan's original subject) — mostly config once `overlay_tiles.py` exists.
- Pressure isobars overlay from the PRMSL grids Phase A already stores.
- ECMWF as a second tile model (`backend/ecmwf_wind.py` exists; add gusts param `10fg`).
- CDN cutover (Cloudflare) — headers are ready from Phase A; front when origin load warrants.

---

## 5. Data upgrades summary (the "better data" ask)

| Datum | Today | After this plan |
|---|---|---|
| Wind speed field | ≤3,000 JSON vectors, GFS-effective 0.5–1° | Full 0.25° baked tiles, global |
| **Max gusts** | Point-only (NDBC GST, open-meteo) — absent from overlay + storms | GUST tiles + per-storm max gust |
| Sea state | ✅ WW3 already ingested; per-storm peak seas/period/dir | Unchanged; becomes visible next to wind on `/map`; wave tiles later |
| **Fetch** | ✅ Already computed (8-quadrant gale radii) + wedge rendered | Unchanged; finally has a wind field under it for context |
| Pressure | 1° PRMSL inside detector job only | 0.25° grids stored per run (isobars later); optional dot snap-to-minimum |

---

## 6. Execution notes

- Follow V2 plan's commit discipline; one PR per phase; `/review` each; `/design-review` after B and C.
- Color: everything through `ramps.json` — CI already rejects hex literals in `*Layer*`/`*Legend*` files.
- No changes to `/api/map/bundle`, spot, or buoy paths — this is additive until Phase D step 5.
