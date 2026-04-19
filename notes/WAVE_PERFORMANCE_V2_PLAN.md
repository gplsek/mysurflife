# Wave & Wind Overlay Performance V2 — Windy-Class Animation Plan

**Status:** 📋 Planning
**Owner:** George (handoff to Claude Code for execution)
**Target quality:** Windy.com smoothness — instant zoom/pan, fluid slider scrubbing, GPU-accelerated particles
**Estimated effort:** 3 phases, ~4–6 weeks of focused work if executed sequentially
**Companion plan:** [`GLOBAL_DATA_EXPANSION_PLAN.md`](./GLOBAL_DATA_EXPANSION_PLAN.md) — expands the data layer so V2's global tiles actually have data worldwide. Should be executed in parallel; see that plan's section 5 for interaction details.

---

## 1. Goal

Transform the current wind/wave overlay system from per-frame CPU rasterization into a tile-based, GPU-accelerated pipeline that can visualize storm movement across the globe with the fluidity users expect from Windy.com.

**Success criteria (measurable):**

- Time slider scrubbing at ≥ 30 fps on a mid-range laptop (MacBook Air M1 or equivalent) across the full 0–384 hour GFS range
- Zoom-out to global view paints in < 500 ms (currently ~3–6 s)
- Pan does not block the UI — new tiles stream in progressively
- Particle animation remains smooth (≥ 45 fps) with ≥ 10,000 particles at any zoom level
- Works on mobile (iOS Safari, Android Chrome) at ≥ 30 fps for heatmap, ≥ 20 fps for particles
- No regression in overlay correctness (colors, directions, NaN/land masking)

---

## 2. Current State — Why It's Slow

### Frontend bottlenecks (measured in line counts)

| File | Lines | Bottleneck |
|------|------:|------------|
| `frontend/src/WaveCanvasLayer.js` | 892 | Per-pixel CPU loop, JS-side land masking, ImageData build every redraw |
| `frontend/src/WindCanvasLayer.js` | 255 | Same pattern as Wave layer |
| `frontend/src/WindParticlesLayer.js` | 265 | 3000 particles, `map.containerPointToLatLng()` called per particle per frame (~180k calls/sec) |
| `frontend/src/WaveParticlesLayer.js` | 269 | Same issue |
| `frontend/src/WaveField.js` | 336 | CPU bilinear interpolation on every sample |
| `frontend/src/WindField.js` | 188 | CPU bilinear interpolation on every sample |

Key pain points identified from code inspection:

- **WaveCanvasLayer.js lines 13–79**: a JS function `isLikelyLand()` runs per-pixel at every redraw. Manual coastline approximation in JS. Should be a pre-baked raster mask, not a live function call.
- **WindParticlesLayer.js lines 25–63**: `Particle.update()` calls `map.containerPointToLatLng()` then `windField.getVector()` for every one of 3000 particles per frame. This is the single largest CPU sink.
- **No request cancellation**: the backend deduplicates in-flight requests (`backend/main.py` ~line 1943), but the frontend never aborts a fetch when the user scrubs the slider. Stale responses arrive and trigger redraws.
- **No render token**: if the user scrubs fast, multiple `draw()` calls queue up. Each one builds a full ImageData before the next slider tick is honored.
- **Fixed stride (`PIXEL_STRIDE = 6`)**: does not scale with zoom. Global view samples a 2560×1440 viewport at stride 6 = ~102k samples per frame. Even a single redraw blocks the main thread for ~200 ms at global zoom.

### Backend state (good foundations to keep)

- `backend/main.py` line 1910 (`/api/wind-overlay`): has caching (10 min TTL), in-flight dedup, `WIND_SEM=2` concurrency limit.
- `backend/main.py` line 2931 (`/api/waves-overlay`): similar pattern, disk cache for NetCDF.
- `backend/main.py` line 1697 (`/api/wind/frames`): frame discovery.
- Returns raw JSON vectors. This is the wrong shape for a fast pipeline — we want images or typed float arrays.

---

## 3. Target Architecture

Three layers, mirroring Windy's approach:

### Layer A — Heatmap as raster tiles

Backend pre-bakes forecast-hour data into a tile pyramid on first request, cached to disk and served as static PNGs. Leaflet consumes them as a regular `TileLayer`. Browser does nothing but blit pre-colored pixels.

```
GET /api/tiles/waves/{model}/{run}/{hour}/{z}/{x}/{y}.png
GET /api/tiles/wind/{model}/{run}/{hour}/{z}/{x}/{y}.png
```

Color ramp is applied server-side at render time. A secondary "raw float" tile endpoint supports precise probe values:

```
GET /api/tiles/waves/{model}/{run}/{hour}/{z}/{x}/{y}.f32  # 32-bit float grid per tile
```

### Layer B — Particles in WebGL

Replace CPU particle loop with a WebGL shader based on the [WindGL](https://github.com/mapbox/webgl-wind) reference implementation (Mapbox, MIT licensed, ~600 lines). Vector field is encoded as a 2-channel texture (R=u, G=v, plus a land-mask alpha channel). Particles live in a texture; update and draw passes run on GPU.

Expected throughput: 100k+ particles at 60 fps on a mid-range laptop.

### Layer C — Coordinator (orchestration)

A `OverlayController` that:

- Debounces slider changes (≥ 100 ms)
- Holds a render-token so stale data is discarded
- Uses `AbortController` for every fetch
- Prefetches adjacent hours when slider is idle
- Coordinates `WaveTileLayer` + `WaveParticlesLayerGL` lifecycle

---

## 4. Phased Execution

Three phases designed to be independently shippable. Phase 1 is a quick win on the existing architecture; Phases 2 and 3 replace it.

---

### PHASE 1 — Quick Wins on Current Pipeline

**Goal:** 3–5× perceived smoothness on the existing 2D canvas path, without introducing new tech.
**Effort:** ~1 week
**Risk:** Low — additive, easy to roll back

#### Tasks

1. **Add render tokens and abort controllers.**
   - File: `frontend/src/MapOverlay.js`
   - Add a `renderTokenRef` that increments on every slider change.
   - Every async overlay fetch stores the token at call time; on completion, compare to current token and bail if stale.
   - Wrap all overlay `fetch()` calls in `AbortController`. Abort on token increment.

2. **Debounce slider input.**
   - File: `frontend/src/MapOverlay.js`
   - Throttle time-slider updates to at most 1 per 120 ms while scrubbing.
   - Commit immediately on slider release.

3. **Zoom-aware `PIXEL_STRIDE`.**
   - Files: `frontend/src/WaveCanvasLayer.js`, `frontend/src/WindCanvasLayer.js`
   - Replace the constant `PIXEL_STRIDE = 6` with a function of zoom:
     ```js
     const strideForZoom = (z) => z <= 5 ? 16 : z <= 7 ? 10 : z <= 9 ? 6 : 4;
     ```
   - Cap total samples at ~60k per frame (compute `offWidth * offHeight` before building ImageData and bail early with a coarser stride if over budget).

4. **Internal resolution scaling.**
   - When zoom ≤ 6, render to an internal canvas at 0.5× screen resolution and upscale with `ctx.drawImage`.
   - Already partially supported (offscreen canvas exists); just change the stride ratio.

5. **Precompute land mask as raster.**
   - Replace `isLikelyLand()` in `WaveCanvasLayer.js` lines 13–79 with a lookup into a pre-baked PNG or Uint8Array at ~0.1° resolution.
   - Generate once at build time: `frontend/src/landMask.png` (Natural Earth 10m land polygon → raster). Load into an OffscreenCanvas on mount.
   - Drop the per-pixel function call entirely.

6. **Cancel in-flight redraws.**
   - On `moveend` or `zoomend` during an active redraw, abort the current ImageData build (check token inside the sample loop every ~1000 iterations).

7. **Prefetch adjacent hours.**
   - File: `frontend/src/MapOverlay.js`
   - When slider idles for > 400 ms, fire background fetches for hour ± 3 and hour ± 6. Store in overlay cache.

#### Acceptance criteria for Phase 1

- Slider scrubbing at zoom 6 holds ≥ 24 fps on a MacBook Air M1.
- No stale data ever paints (verify by rapid scrubbing + console log token mismatches).
- Land mask lookup is O(1), not per-pixel function calls.
- No visible regression in color/alpha/direction rendering.

#### Testing

- Record a 20-second scrub session with Chrome DevTools Performance panel. Main-thread blocking time should drop by ≥ 60%.
- Run `/design-review` workflow to capture before/after screenshots.
- Spot-check: Del Mar, San Pedro, SF Bar buoys at zoom 6, 8, 10.

#### Rollback

All changes are local to three files. A short-lived ship flag `USE_V2_PERF` may be used during the Phase 1 PR window to stage the change, but is removed before Phase 1 is declared complete. Rollback beyond that is `git revert`.

---

### PHASE 2 — Server-Side Raster Tiles

**Goal:** Replace the JSON-vector + client-side rasterize flow with a tile-pyramid approach. This is where zoom-out becomes instant.
**Effort:** ~2 weeks
**Risk:** Medium — new backend endpoints, new dependencies, disk I/O considerations

#### Backend tasks

1. **Add tile rendering module.**
   - New file: `backend/overlay_tiles.py`
   - Dependencies to add to `requirements.txt`: `Pillow>=10.0`, `mercantile>=1.2`, `rasterio>=1.3` (or `numpy` + manual Web Mercator math).
   - Core function:
     ```python
     async def render_overlay_tile(
         model: str, run: str, hour: int, z: int, x: int, y: int,
         variable: str,  # "waves" | "wind_speed"
         color_ramp: str  # "windy" | "classic"
     ) -> bytes:  # PNG bytes
     ```

2. **New endpoints in `backend/main.py`:**
   - `GET /api/tiles/waves/{model}/{run}/{hour}/{z}/{x}/{y}.png` (256×256 base)
   - `GET /api/tiles/waves/{model}/{run}/{hour}/{z}/{x}/{y}@2x.png` (512×512 retina)
   - `GET /api/tiles/wind/{model}/{run}/{hour}/{z}/{x}/{y}.png` (+ `@2x` variant)
   - `GET /api/tiles/waves/{model}/{run}/{hour}/{z}/{x}/{y}.f32` (raw 256×256 float grid for probes + particle source)
   - All endpoints must emit: `Cache-Control`, `ETag`, `Access-Control-Allow-Origin: *` (for CDN edge caching).

3. **Tile cache on disk.**
   - Path: `backend/cache/tiles/{model}/{run}/{hour}/{z}/{x}/{y}.png`
   - Purge tiles older than latest run on every new run ingest.
   - Add an endpoint `GET /api/tiles/_stats` for monitoring cache size and hit rate.

4. **HTTP cache headers (CDN-ready).**
   - `Cache-Control: public, max-age=21600, immutable` for past runs.
   - `Cache-Control: public, max-age=600, stale-while-revalidate=1800` for current run.
   - `ETag` per tile so CDN conditional requests work cleanly.
   - `Vary: Accept-Encoding` only (no auth, no cookies on tile routes).

5. **CDN fronting (configured in Phase 2, not deferred).**
   - Pick Cloudflare (free tier sufficient for start) or Bunny (cheaper per-GB at scale).
   - Set origin pull URL to `/api/tiles/*`. Cache everything. Respect origin `Cache-Control`.
   - Add `mysurflife.com/tiles/*` subpath or dedicated subdomain `tiles.mysurflife.com` — decide in Phase 2 kickoff.
   - Verify: edge cache hit rate ≥ 90% after 24h of warm traffic.

6. **Render pipeline.**
   - On tile request: (a) ensure parent forecast hour's float grid is decoded & cached in memory (existing OPeNDAP cache); (b) subset to tile's Web Mercator bounds; (c) resample to 256×256 (or 512 for `@2x`) with bilinear interp; (d) apply color ramp from `backend/config/ramps.json`; (e) encode PNG; (f) write to disk and return.
   - Color ramp is loaded once at process start from the shared JSON and held in memory. Ramp lookup is a pre-computed 256-entry LUT.
   - The existing `/api/wind-overlay` and `/api/waves-overlay` JSON endpoints stay alive through Phase 2 shipping, then get removed in the Phase 2 cleanup commit (per Decision #5).

7. **Prewarm cron.**
   - Optional: add `backend/prewarm_tiles.py` that, after each WW3/GFS run lands, pre-renders z=0..6 tiles globally (that's only ~5400 tiles at z≤6 — fast).
   - Makes zoom-out instant on first load.

#### Frontend tasks

1. **New `WaveTileLayer.js` + `WindTileLayer.js`.**
   - Replace `WaveCanvasLayer.js` mount with a Leaflet `L.TileLayer`:
     ```js
     L.tileLayer(`https://tiles.mysurflife.com/api/tiles/waves/${model}/${run}/${hour}/{z}/{x}/{y}.png`, {
       opacity: 0.55,
       maxZoom: 12,
       tileSize: 256,
       detectRetina: true,
       crossOrigin: true,
     }).addTo(map);
     ```
   - `detectRetina: true` tells Leaflet to request `@2x.png` on hi-DPI displays automatically.
   - Use the CDN-fronted URL (tiles subdomain) directly, not the backend origin.

2. **Update `MapOverlay.js` to swap layer type.**
   - When `forecast_hour` or `model` changes: remove old tile layer, add new one with new URL pattern. Leaflet handles tile lifecycle.
   - Probe logic (click-to-get-value) switches to `/api/wave-point` for accuracy (already exists, `main.py` line 3111) or fetches the `.f32` tile to interpolate locally.

3. **Shared color ramp module.**
   - New file: `backend/config/ramps.json`. Two top-level keys:
     - `ramps` — theme-neutral data ramps (`wind_speed`, `wave_height`, `wave_period`). Baked into PNG tiles by the server and read by the frontend legends. One tile pyramid serves all three themes.
     - `theme_accents` — per-theme chrome colors (`accent`, `accent_2`, `fire`, `good`) for the three Claude Design themes (Ocean / Dawn / Daylight). Each entry carries both the OKLCH source-of-truth and a pre-computed RGB triple for server-side consumers that can't do OKLCH math cheaply.
   - Abbreviated schema:
     ```json
     {
       "version": 1,
       "ramps": {
         "wind_speed":  { "domain": [0, 50],  "unit": "knots",   "interpolation": "linear_rgba", "stops": [ { "value": 0, "rgba": [120,200,220,0.15], "label": "Calm" }, ... ] },
         "wave_height": { "domain": [0, 30],  "unit": "feet",    "interpolation": "linear_rgba", "stops": [ ... ] },
         "wave_period": { "domain": [4, 22],  "unit": "seconds", "interpolation": "linear_rgba", "stops": [ ... ] }
       },
       "theme_accents": {
         "ocean":    { "accent": { "oklch": "0.82 0.16 195", "rgb": [75,220,220] }, "fire": { ... }, ... },
         "dawn":     { ... },
         "daylight": { ... }
       }
     }
     ```
   - Backend: `backend/overlay_tiles.py` loads `ramps.*` once at process start, pre-computes a 256-entry LUT per ramp from `domain` + `stops` + `interpolation`. `_interpolate_ramp(ramp, value)` performs linear RGBA interpolation between bracketing stops and returns an 8-bit RGBA tuple for PNG encoding.
   - Frontend: `frontend/src/design/ramps.js` is a build-time JSON import (symlink from `backend/config/ramps.json` → `frontend/src/config/ramps.json`, copied by `npm run build`). Exposes `rampStops(name)`, `rampDomain(name)`, `sampleRamp(name, value)` for `WaveHeightLegend.js` and `WindSpeedLegend.js`. Legend colors and tile colors cannot drift — they read the same file.
   - `theme_accents` is consumed at runtime by particle shaders and marker code. Theme switching reads the active value from CSS custom properties (`--accent`, `--fire`) on `document.documentElement`; the `ramps.json` copy is for server-side rendering (OG images, cron'd artifacts) where DOM isn't available.
   - No ramp constants duplicated anywhere else. Add a CI check that rejects hex color literals (`#[0-9a-f]{3,8}`) in any `*Legend.js` or `*Layer*.js` file.
   - Full schema and backend/frontend reference implementations live in `DESIGN_V2_INTEGRATION_PLAN.md`.

4. **Legend stays.**
   - `WaveHeightLegend.js` / `WindSpeedLegend.js` now pull their palette from the shared JSON. Presentational only.

5. **Delete legacy canvas layers (end of Phase 2).**
   - `rm frontend/src/WaveCanvasLayer.js frontend/src/WindCanvasLayer.js`
   - `rm frontend/src/WindGrid.js` (unused after tile swap)
   - Remove all imports in `MapOverlay.js`.
   - Done as the final commit of Phase 2 once tile rendering is verified in prod.

#### Acceptance criteria for Phase 2

- Global zoom-out paints in < 500 ms (tile fetch + decode, all parallel).
- Slider scrubbing feels instant for forecast hours that are cached; reveals network-bound time only for fresh hours.
- Disk cache size for a full GFS run + WW3 run stays under 2 GB.
- Backend CPU usage during slider scrub drops to near-zero after warm (tiles served from disk).
- No visible seams at tile boundaries.

#### Testing

- Load test: issue 1000 parallel tile requests across random z/x/y; all succeed < 2s p99.
- Visual: diff tile output vs current canvas output side-by-side at zoom 6 + zoom 10. Must match within ~2% per-channel.
- Cross-browser: Chrome, Safari, Firefox, iOS Safari.

#### Rollback

Per Decision #5, no permanent fallback. Within the Phase 2 PR window, a short-lived `localStorage.overlayMode` flag may toggle between tile and canvas modes while soaking in staging. It is removed in the final cleanup commit along with the legacy canvas layer files. If tiles misbehave after cleanup, rollback is `git revert` of the Phase 2 merge commit.

---

### PHASE 3 — WebGL Particles

**Goal:** Replace CPU particle layer with GPU shaders. Enables 10k+ particles smoothly and eliminates the `containerPointToLatLng()` bottleneck.
**Effort:** ~2 weeks
**Risk:** Medium-High — new tech surface (WebGL), debugging is harder

#### Reference implementation

- **Primary reference:** [mapbox/webgl-wind](https://github.com/mapbox/webgl-wind) — MIT licensed, ~600 lines, by Vladimir Agafonkin. Reads a 2-channel PNG (u/v), animates up to 1M particles in a fragment shader.
- **Blog post:** [How I built a wind map with WebGL](https://blog.mapbox.com/how-i-built-a-wind-map-with-webgl-b63022b5537f) — canonical explanation.
- **Leaflet integration example:** [leaflet-velocity](https://github.com/onaci/leaflet-velocity) does the 2D canvas version (reference for Leaflet layer structure, not for rendering).

#### Tasks

1. **Vector field as texture.**
   - Backend: extend `/api/tiles/wind/.../{z}/{x}/{y}.f32` or add a companion `.uv` PNG endpoint that packs u into R, v into G, land-mask into A. 256×256 per tile.
   - For Phase 3, probably simpler to serve one large UV PNG per forecast hour at a fixed global resolution (e.g. 2048×1024) rather than tiling. The GPU samples it regardless of map zoom.

2. **New `WindParticlesLayerGL.js` + `WaveParticlesLayerGL.js`.**
   - Based on WindGL. Custom Leaflet layer extending `L.Layer`.
   - Uses a single WebGL canvas overlaid at z-index 401.
   - Three shaders: `update` (advects particles in RT), `draw` (renders particles with color ramp), `screen` (motion-blur trail).
   - Lifecycle:
     ```js
     onAdd(map) {
       this._canvas = createGLCanvas(map.getSize());
       this._gl = this._canvas.getContext('webgl', { antialias: false });
       this._windGL = new WindGL(this._gl);
       this._windGL.setWind(uvImage);  // the 2048×1024 PNG
       map.on('moveend zoomend', this._updateTransform);
       this._frame();
     }
     ```

3. **Handle Leaflet + WebGL coordinate transforms.**
   - Particles live in normalized [0,1]×[0,1] texture space.
   - Vertex shader transforms to Web Mercator pixels via uniforms fed from Leaflet's current view.
   - On pan/zoom, update the transform uniforms without resetting particle positions.

4. **Adapt WindGL to wave direction.**
   - Wave direction is a single angle, not a u/v vector. Convert server-side: `u = sin(dir), v = cos(dir)`. Particle speed for waves can be height-weighted.

5. **Land masking.**
   - Encode in alpha channel of the UV PNG. Fragment shader discards particles where alpha == 0.

6. **WebGL unavailability handling.**
   - Detect WebGL 1.0 support on mount. If unavailable, show a small banner: *"Your browser does not support animated overlays. Heatmap view remains available."*
   - No 2D canvas fallback (per Decision #5). The tile heatmap still works — only the particle layer is hidden.
   - Target browsers (all support WebGL 1): Chrome 98+, Safari 15+, Firefox 97+, iOS Safari 15+, Android Chrome 98+.

7. **Particle count setting.**
   - New UI control in map settings panel: slider 1k / 5k / 10k (default) / 25k / 50k.
   - Persist via `localStorage.particleCount`.
   - Mobile hard-caps at 5k regardless of setting (detect via `window.matchMedia('(max-width: 768px)')`).
   - Document defaults in `CLAUDE.md` constants section.

#### Acceptance criteria for Phase 3

- 10,000 wind particles at ≥ 55 fps on MacBook Air M1, zoom 6.
- No stutter on pan/zoom.
- Works on iOS Safari 16+ (WebGL 1).
- Particles correctly masked over land.
- Visually indistinguishable in flow-pattern accuracy from current layer (verified by overlay screenshots with identical seeds).

#### Testing

- FPS overlay in dev (stats.js). Must stay above 45 fps during worst-case global pan.
- Memory: GPU memory should not grow unbounded. Verify no leaks across 10 minutes of continuous interaction.
- Device matrix: MacBook M1, MacBook Intel 2019, iPhone 13, Android Pixel 6.

#### Rollback

Per Decision #5, no permanent fallback. Short-lived ship flag `USE_GL_PARTICLES` may be used during the Phase 3 PR window for staged rollout. Flag removed and legacy `WindParticlesLayer.js` + `WaveParticlesLayer.js` + `WindParticles.js` + `WaveParticles.js` files deleted in the final cleanup commit. Post-cleanup rollback is `git revert`.

---

## 5. Cross-Cutting Concerns

### Backward compatibility

- Per Decision #5, legacy canvas + particle layers are deleted as each phase ships. No permanent fallback path.
- The backend JSON overlay endpoints (`/api/wind-overlay`, `/api/waves-overlay`) are removed in the Phase 2 cleanup commit, since tiles + `.f32` tile format replace their function. Probe logic migrates to `/api/wave-point` (already exists) and the new `.f32` endpoint before the legacy endpoints are removed.
- Spot-specific forecast endpoints (`/api/surf-spots/{slug}/forecast-timeline`) are unaffected — they use their own data path.

### Color correctness

- Source of truth: `backend/config/ramps.json` (per Decision #3). Add before anything in Phase 2 is coded.
- Two-key schema: `ramps` (theme-neutral, baked into tiles, read by legends) and `theme_accents` (per-theme chrome: accent, accent_2, fire, good for Ocean / Dawn / Daylight).
- **Tiles are theme-neutral, chrome is theme-driven.** One tile pyramid serves all three Claude Design themes; theme switching only updates CSS custom properties + particle shader uniforms, never re-fetches tiles.
- Port the existing palette verbatim from `WaveCanvasLayer.js` (lines ~100–160) and `WindCanvasLayer.js` into the JSON, then delete the inline constants.
- CI pixel-diff test: render a known tile, compare to a baseline image, assert < 2 per-channel delta.
- CI lint: reject hex color literals (`#[0-9a-f]{3,8}`) in any `*Legend.js` or `*Layer*.js` file to prevent ramp drift.
- **Copyright note:** we match Windy's visual style for user familiarity but re-implement from scratch. No asset or code copied from Windy.

### NaN / missing data

- Preserve the existing `json_sanitize()` contract. In tile renderer, NaN cells render fully transparent (alpha=0), not black.

### Run availability & time slider

- The `run` parameter in URLs must always match the latest available run for that model (`/api/waves/run-availability`, `/api/wind/frames`). Leaflet's `TileLayer.setUrl()` handles model/run/hour swaps cleanly.

---

## 6. File Targets Summary

### New files
- `backend/overlay_tiles.py` — Phase 2
- `backend/config/ramps.json` — Phase 2 (shared color ramp, per Decision #3)
- `backend/prewarm_tiles.py` — Phase 2 (optional)
- `frontend/src/shared/ramps.js` — Phase 2 (build-time JSON import of the shared ramp)
- `frontend/src/WaveTileLayer.js` — Phase 2
- `frontend/src/WindTileLayer.js` — Phase 2
- `frontend/src/WindParticlesLayerGL.js` — Phase 3
- `frontend/src/WaveParticlesLayerGL.js` — Phase 3
- `frontend/src/overlayController.js` — Phase 1 (render tokens, debounce, abort)
- `frontend/src/landMask.png` — Phase 1 (pre-baked raster)

### Modified files
- `backend/main.py` — new tile endpoints (Phase 2), remove legacy overlay JSON endpoints in Phase 2 cleanup
- `backend/requirements.txt` — add Pillow, mercantile
- `frontend/src/MapOverlay.js` — wire controller (Phase 1), swap layer types (Phase 2, 3), add particle-count setting (Phase 3)
- `frontend/src/WaveHeightLegend.js` — pull palette from shared ramp (Phase 2)
- `frontend/src/WindSpeedLegend.js` — pull palette from shared ramp (Phase 2)
- `CLAUDE.md` — update constants and canvas-pattern section when legacy layers are deleted

### Deleted files (per Decision #5, no fallback retained)
- `frontend/src/WaveCanvasLayer.js` — end of Phase 2
- `frontend/src/WindCanvasLayer.js` — end of Phase 2
- `frontend/src/WindGrid.js` — end of Phase 2 (unused after tile swap)
- `frontend/src/WindParticlesLayer.js` — end of Phase 3
- `frontend/src/WaveParticlesLayer.js` — end of Phase 3
- `frontend/src/WindParticles.js` — end of Phase 3
- `frontend/src/WaveParticles.js` — end of Phase 3

### Preserved intact
- `backend/ww3_grid_registry.json`
- `backend/buoy_to_wind_station_map.json`
- `frontend/src/WindField.js` / `WaveField.js` (still used for click-to-probe accuracy against the raw `.f32` tile grid)

---

## 7. Decisions Log

All five open questions resolved on **2026-04-19**:

| # | Decision | Implication |
|---|---|---|
| 1 | **CDN fronting: YES.** Cloudflare or Bunny in front of `/api/tiles/*` from day one of Phase 2. | Phase 2 tile endpoint must serve with correct `Cache-Control`, `ETag`, and `Access-Control-Allow-Origin: *` headers. CDN configured before Phase 2 ship, not after. Target origin shield: single data center, tiles cached at edge globally. |
| 2 | **Tile resolution: 256×256 base, `detectRetina: true` for 2× displays.** | Progressive enhancement — base tiles at 256, Leaflet automatically requests `@2x` tiles on retina devices. Server must handle both `z/x/y.png` and `z/x/y@2x.png` (render at 512 when the suffix is present). |
| 3 | **Color ramp authority: shared JSON, two-key schema.** | Single file `backend/config/ramps.json` is source of truth, split into two top-level keys: (a) `ramps` — theme-neutral data ramps (`wind_speed`, `wave_height`, `wave_period`) baked into PNG tiles and read by frontend legends, so one tile pyramid serves all three Claude Design themes; (b) `theme_accents` — per-theme chrome colors (OKLCH + pre-computed RGB) for Ocean / Dawn / Daylight, consumed by particle shaders and markers. Backend loads once at process start, pre-computes 256-entry LUT per ramp. Frontend imports via symlink + build-time copy to `frontend/src/config/ramps.json`. CI rejects hex color literals in `*Legend.js` / `*Layer*.js`. Full schema in `DESIGN_V2_INTEGRATION_PLAN.md`. |
| 4 | **Particle count: 10k default, user-toggleable up to 50k.** | Phase 3 ships a settings control (localStorage-persisted) under map controls. Mobile hard-caps at 5k regardless of setting. Defaults documented in `CLAUDE.md`. |
| 5 | **Existing canvas layers: delete, no fallback.** | Phase 2 deletes `WaveCanvasLayer.js` and `WindCanvasLayer.js` when tiles ship. Phase 3 deletes `WindParticlesLayer.js` and `WaveParticlesLayer.js` when WebGL ships. No permanent legacy branch. WebGL unavailability in the browser shows an "Your browser does not support this view" message rather than falling back. |

---

## 8. Acceptance Test Script (runs after each phase)

```bash
# Backend smoke
curl -I "http://localhost:8000/api/tiles/waves/global/latest/6/5/10/25.png"
# Expect 200, image/png, < 500ms cold, < 50ms warm

# Frontend smoke (manual via Chrome DevTools Performance recording)
1. Open mysurflife.com
2. Toggle Waves overlay
3. Scrub timeline from 0 to 180 hours over 3 seconds
4. Record performance
5. Assert: main thread blocking < 500ms total, no frames > 50ms

# Visual diff
./scripts/visual_regression.sh   # to be written in Phase 1
# Captures screenshots at zoom 6, 8, 10 for waves + wind, diffs against baseline.
```

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| WebGL unsupported on target device | Low | Low | Feature detect + banner message, heatmap still works (per Decision #5, no 2D fallback) |
| Tile cache fills disk | Medium | Medium | Purge old runs, monitor with `_stats` endpoint |
| Color ramp drift | Low | Low | Single source of truth in `backend/config/ramps.json` (Decision #3) + pixel-diff CI test |
| CDN misconfigured, origin hammered | Medium | High | Bake correct cache headers before Phase 2 ship; smoke test hit rate after 24h |
| WW3 `run` coordinate changes mid-forecast-hour | Low | High | Embed `run` in URL; client always passes explicit run |
| Leaflet + WebGL z-index / pan interaction bugs | Medium | Medium | Early spike: prototype WindGL Leaflet integration in week 1 of Phase 3 |
| Mobile GPU memory limits | Medium | Medium | Hard-cap particle count at 5k on mobile (per Decision #4), lower UV PNG resolution (1024×512) |
| Legacy layers deleted too early, issue surfaces post-cleanup | Low | Medium | Final cleanup commit lands only after 1 week of stable production tiles (Phase 2) / particles (Phase 3) |

---

## 10. Execution Notes for Claude Code

When implementing, proceed phase by phase. Do not start Phase 2 until Phase 1 acceptance criteria are met and merged. Each phase should produce a standalone PR.

Recommended commit discipline:
- Phase 1: 1 commit per task, 7 total.
- Phase 2: 3–5 commits (backend module, endpoints, frontend layer, tests, prewarm).
- Phase 3: 4–6 commits (UV data path, core layer, wind flavor, wave flavor, mobile caps, docs).

Always run:
```bash
./deploy.sh --dry-run     # before any backend PR
npm run build              # before any frontend PR
```

Run `/review` after each phase.
Run `/design-review` after Phase 1 and Phase 3 (visual-change phases).

---

**Created:** 2026-04-19
**Last updated:** 2026-04-19 — Decision #3 expanded with two-key `ramps.json` schema (`ramps` for theme-neutral tile colors + `theme_accents` for per-theme chrome) to integrate with the Claude Design 3-theme system. Full schema lives in `DESIGN_V2_INTEGRATION_PLAN.md`.
**Supersedes:** `performance-ideas.md` (keep as historical reference)
**Related:** `GLOBAL_DATA_EXPANSION_PLAN.md` (companion), `DESIGN_V2_INTEGRATION_PLAN.md` (design system + ramps.json schema), `WAVE_PERFORMANCE_PLAN.md` (original plan, pre-V2), `WIND_ANIMATION_GUIDE.md`, `CLAUDE.md` (canvas layer pattern)
