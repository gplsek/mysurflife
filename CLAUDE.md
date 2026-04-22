# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MySurfLife is a real-time surf forecasting dashboard combining NOAA buoy observations with wave/wind model forecasts. The application features an interactive map with animated overlays showing wind and wave conditions across California's coast.

**Architecture**: React frontend + FastAPI backend, deployed via Apache reverse proxy on Ubuntu server.

**Live Site**: https://mysurflife.com

## Development Commands

### Backend (FastAPI)

```bash
# Setup
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run development server
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Run tests
pytest

# Test specific endpoint
curl "http://localhost:8000/api/buoy-status/all"
```

### Frontend (React)

```bash
# Setup
cd frontend
npm install

# Development server (proxies to backend on port 8000)
npm start

# Production build
npm run build

# Run tests
npm test
```

### Deployment

```bash
# Automated deployment (from project root)
./deploy.sh

# Manual backend restart
sudo systemctl restart mysurflife-backend

# View backend logs
sudo journalctl -u mysurflife-backend -f

# View Apache logs
sudo tail -f /var/log/apache2/mysurflife-error.log
```

## Project Conventions & Standards

### Non-Negotiables
- Prefer small, reviewable diffs; avoid "mega PRs"
- Keep React in JavaScript (no TypeScript)
- Avoid breaking API contracts; version or feature-flag when needed
- Log and handle external data failures (timeouts, 404s, missing fields)
- Correctness > cleverness

### Code Style

**Python**:
- Type hints where practical; clear docstrings on public functions
- Use f-strings for logging: `print(f"✅ Redis connected")`
- Descriptive variable names: `hs_values` not `h`, `rounded_bbox` not `rbb`
- Group imports: stdlib → third-party → local
- Use `Path` from `pathlib` for file operations

**JavaScript**:
- Functional components with hooks (no classes)
- Use `useRef` for canvas elements and field instances
- Use `useEffect` with proper cleanup (return cleanup function)
- Descriptive constants: `ALPHA_BASE`, `MIN_ALPHA`, `PIXEL_STRIDE`
- Use early returns for guard clauses
- Template literals: `` `rgba(${r}, ${g}, ${b}, ${a})` ``

### Review Priorities
1. **Correctness** (timestamps, units, station mapping, forecast alignment)
2. **Resilience** (timeouts, retries, partial outages, fallbacks)
3. **Performance** (caching; avoid rerender storms on map/slider)
4. **Maintainability** (testable parsing/merge logic; clear contracts)

## Architecture

### Backend (FastAPI + Python)

**Core Pattern**: Async-first with multi-level caching and request deduplication.

- **Entry Point**: `backend/main.py` (all API endpoints in single file)
- **Data Sources**:
  - NDBC real-time buoys (text file parsing) - 18 stations
  - NOAA WaveWatch III (WW3) via OPeNDAP - global/regional/nearshore domains
  - NOAA GFS/HRRR/NAM wind models via OPeNDAP - 3-25km resolution
  - NOS CO-OPS wind stations (fallback) - 9 coastal stations
  - CDIP ECMWF forecasts (infrastructure ready, URLs being verified)

**Caching Strategy (3-tier)**:
1. **L1 (In-Memory)**: Python dict with TTL, per-worker, short-lived (5 min buoys, 10 min wind)
2. **L2 (Redis)**: Optional shared cache across workers (gracefully degrades if unavailable)
3. **L3 (Disk)**: Raw NetCDF responses and WW3 grid registry (`ww3_grid_registry.json`)

**Concurrency Control**:
- `NDBC_SEM = asyncio.Semaphore(6)` - limits concurrent buoy requests
- `WIND_SEM = asyncio.Semaphore(2)` - limits wind overlay processing
- Request deduplication (Task D pattern) prevents duplicate in-flight requests

**Key Endpoints**:
- `/api/buoy-status/all` - All 18 buoys with current conditions
- `/api/buoy-history/{station_id}?hours=48` - Historical time series (30 min cache)
- `/api/buoy-forecast/{station_id}?hours=120` - 5-day forecast (trend + CDIP)
- `/api/wind-overlay?model={gfs|hrrr|nam}&forecast_hour={0-384}&bounds={...}` - Wind vector field
- `/api/waves-overlay?source={global|regional|nearshore}&forecast_hour={0-180}&bounds={...}` - Wave height field
- `/api/wind/frames?model=gfs` - Available forecast hours
- `/api/waves/run-availability` - WW3 run date and hours
- `/api/overlays/models` - Available model metadata

**Data Processing**:
- All responses use `json_sanitize()` to remove NaN/Inf values (CRITICAL)
- Bilinear interpolation for smooth field visualization
- Zoom-based model selection (global at zoom 0-6, regional 7-9, nearshore 10+)
- Surf face height formula: `0.7 × WVHT × √DPD`
- Wave energy index: `WVHT² × DPD`
- Wind fallback system when buoy wind data missing

### Frontend (React + Leaflet)

**Entry Points**:
- `App.js` - Top-level component, view toggle (Buoys/Wind/Waves)
- `MapOverlay.js` - Central map orchestrator (1500+ lines), manages all state and data flows

**Canvas Rendering Architecture**:

All visualization layers use **offscreen canvas pattern** for performance:
1. Create low-resolution offscreen canvas (stride-based sampling)
2. Render data to offscreen ImageData with per-pixel alpha
3. Scale up smoothly to full size with `imageSmoothingEnabled: true`
4. Use `'source-over'` compositing (NOT multiply)

**Key Components**:
- `WindCanvasLayer.js` - Wind speed heatmap with gamma correction
- `WindParticlesLayer.js` - Animated particle streams (3000 particles, Windy-style)
- `WaveCanvasLayer.js` - Wave height overlay (Windy.com style colors)
- `WaveParticlesLayer.js` - Wave direction particles (2500 particles)
- `WindField.js` / `WaveField.js` - Bilinear interpolation grids
- `WindSpeedLegend.js` / `WaveHeightLegend.js` - Color scale legends

**Z-Index Hierarchy** (critical for proper layering):
```
200  - Map tiles
400  - Heatmaps (wind/wave canvas)
401  - Particles
500  - Buoys/markers
650+ - Labels/UI
```

**State Management**:
- All in `MapOverlay.js` component state (no Redux/Context)
- `localStorage` for user preferences (units, timezone)
- Polling intervals for real-time buoy updates (5-10 min)
- Frame-based animation for forecast progression (time slider 0-384 hours)
- Overlay data cached by model/bbox/hour combination

**Data Flow Example (Wind Overlay)**:
1. User selects wind overlay + model (HRRR/GFS/NAM)
2. Fetch `/api/wind/frames` → discover available forecast hours
3. User scrubs timeline slider → fetch `/api/wind-overlay?model=hrrr&forecast_hour=6&bounds=...`
4. Backend returns vector field → frontend caches by model/bbox/hour
5. `WindField` builds bilinear interpolation grid
6. `WindCanvasLayer` renders heatmap (offscreen pattern)
7. `WindParticlesLayer` animates particles following wind flow
8. User clicks map → probe displays interpolated value at location

### Configuration Files

**`ww3_grid_registry.json`**:
- Defines WW3 wave model domains (global 0.16°, epacif, atlocn)
- OPeNDAP URL patterns and forecast ranges (180 hours)
- Zoom level → domain mapping
- Variable metadata (htsgwsfc, dirpwsfc, perpwsfc)

**`buoy_to_wind_station_map.json`**:
- Maps 18 NDBC buoy IDs to NOS CO-OPS wind stations
- Used for fallback when buoy wind data missing
- Example: `"46266": "LJAC1"` (Del Mar → La Jolla)

**`cdip_station_mapping.json`**:
- CDIP station metadata (13 of 14 buoys mapped)
- Alternative wave data source for ECMWF forecasts
- Infrastructure complete, URLs being verified

**`backend/config/ramps.json`** (design system bridge):
- Source of truth for all color in the app — three top-level keys:
  - `ramps` — theme-neutral data ramps (wind_speed, wave_height, wave_period) baked into overlay PNG tiles and read by frontend legends
  - `theme_accents` — per-theme chrome colors for Ocean / Dawn / Daylight themes, consumed at runtime via CSS custom properties
  - `brand` — universal D1 logo brand tokens (paper/ink, wordmark/tagline specs, mark anatomy, pulse animation)
- Symlinked from `frontend/src/config/ramps.json` for build-time sync with frontend
- **Rule:** No hex color literals in `frontend/src/**/*Legend.js`, `*Layer*.js`, or `design/Logo*.{js,jsx}`. Always import from `frontend/src/design/ramps.js`. CI-enforced.
- See [`notes/DESIGN_V2_INTEGRATION_PLAN.md`](./notes/DESIGN_V2_INTEGRATION_PLAN.md) §3.5 for the logo spec and `notes/WAVE_PERFORMANCE_V2_PLAN.md` Phase 2 for the tile ramp consumer.

## Brand Assets (D1 Logo System)

The "D1" logo is a complete brand identity system — mark, lockups, favicons, apparel, animated loading. Full export pack in `ClaudeDesign/logo/mysurflife-logo-export.html`.

### Logo component — always use, never inline SVG

The D1 mark must always be rendered via the React component, never by copy-pasting SVG paths. This guarantees theme-aware retinting at runtime.

```jsx
import { Logo, LogoPulse } from '@/design/Logo';

// Header
<Logo variant="horizontal" size={28} />

// Favicon-scale mark (inner ring + dot only)
<Logo variant="mark" size={16} />

// Loading state
<LogoPulse size={96} />
```

**Valid `variant` values:** `mark | horizontal | horizontal-tagline | stacked | app-icon`
**Valid `surface` values:** `auto (default) | dark | light` — controls dot color on Daylight theme where accent drops to `#0a8a9e` for AA contrast.

### Mark anatomy (do not improvise — use ramps.json `brand.mark_d1`)

- viewBox: `0 0 64 64`
- Dot at (32, 40), radius 4, fill `var(--accent)`
- Three half-rings radiating upward from the dot; stroke `var(--fire)`:
  - Inner: r=14, stroke-width=2.0, opacity=1.00
  - Middle: r=21, stroke-width=1.6, opacity=0.50
  - Outer: r=28, stroke-width=1.2, opacity=0.25
- Below 24px, drop the outer two rings (keep only inner ring + dot).
- Minimum size: 16px.
- Clear space: equal to dot radius (4px at native).

### Brand color palette

| Token | Value | Role |
|---|---|---|
| `--accent` (Ocean) | `oklch(0.82 0.16 195)` ≈ `#3EC9D4` | Logo dot — aqua |
| `--accent` (Daylight, logo only) | `#0a8a9e` | AA-safe aqua on paper background |
| `--fire` (Ocean) | `oklch(0.75 0.19 45)` ≈ `#E5743D` | Logo rings — sunset orange |
| `--paper` | `#f4f1ea` | Light surface background (universal) |
| `--ink` | `#0a1218` | Dark surface background (universal) |

Per-theme accent/fire values live in `backend/config/ramps.json` `theme_accents`. Paper/ink are universal — same in all 3 themes.

### Typography (from `ramps.json brand`)

- **Wordmark:** `Geist` weight 800, tracking `-0.04em`, lowercase — literal text `mysurflife`
- **Tagline:** `Geist Mono` weight 500, 10px, tracking `+0.24em`, uppercase — literal text `AI SURF FORECAST`
- **Editorial accents:** `Instrument Serif` italic (session notes, hero headlines)

All three are OFL-1.1 licensed, self-hosted in `frontend/public/fonts/`. Do not load from Google Fonts CDN in production.

### File locations

- SVG mark variants: `frontend/public/logo/{mark,lockup,app-icon}-*.svg` (11 files)
- Raster favicons: `frontend/public/logo/favicon-{16,32,64,96,180,512}.png`
- Legacy icon: `frontend/public/logo/favicon.ico`
- PWA manifest: `frontend/public/logo/site.webmanifest`
- React components: `frontend/src/design/Logo.jsx`, `LogoPulse.jsx`
- Favicon build script: `frontend/scripts/generate-favicons.js` (run `npm run favicons` after mark changes)
- Design reference: `ClaudeDesign/logo/mysurflife-logo-export.html`
- Spec source of truth: `backend/config/ramps.json` `brand.*`

### When adding a UI surface that needs the logo

1. Pick a variant from the 5 canonical ones — do not create a new lockup.
2. Use the `<Logo>` component. Never hardcode SVG, never hardcode hex.
3. For loading/splash states, use `<LogoPulse>` (see policy below).
4. For OG social cards or email templates (where CSS custom properties don't resolve), use the pre-rendered PNG from `frontend/public/logo/` at the appropriate size.

### LogoPulse — universal loading indicator

**Every loading state in the app uses `<LogoPulse>`.** No emoji spinners, no `.spinner` divs, no text-only "Loading..." placeholders, no ad-hoc dot animations. The pulse-rings animation IS the brand — reusing it everywhere reinforces the mark and replaces 5+ one-off indicators with one component. This is enforced via CI lint.

```jsx
import { LogoPulse } from '@/design/Logo';

// Full-page splash, MapLoadingOverlay, route gate
<LogoPulse size={96} label="loading your surf" />

// Panel/card loading (PanelSkeleton hero, dashboard tile, AI analysis)
<LogoPulse size={48} />

// Inline (chart cell, list row, table cell)
<LogoPulse size={24} compact />

// Button inline, AI "thinking", eyebrow tag (replaces .ai-pulse)
<LogoPulse size={12} compact />

// AI streaming response — runs indefinitely while streaming
<LogoPulse size={12} compact continuous />
```

**Size recipes:**

| Size | Rings | Pulse | Stagger | Where |
|--:|---|--:|--:|---|
| 96 | 3 + dot | 2400ms | 0 / 800 / 1600 | Full-page splash |
| 48 | 3 + dot | 1800ms | 0 / 600 / 1200 | Panel / card |
| 24 | inner+middle + dot | 1200ms | 0 / 400 | Inline |
| 12 | inner + dot | 900ms | 0 | Button / AI thinking |

**Rules:**

1. No new spinner components. Need a loading indicator? Use LogoPulse. Pick the size from the recipe table.
2. Never pair LogoPulse with another spinner in the same surface — reads as "double loading".
3. No emoji in loading states. Ever. `🌊 Loading...` is forbidden — the mark IS the wave.
4. AI thinking states use `continuous`. Loading states don't.
5. For pages with multiple parallel loading regions (e.g., SpotDetail with buoy + model + timeline), use `size=24 compact` for each. Don't hoist to a single `size=96` overlay — it hides granular progress.

See [`notes/DESIGN_V2_INTEGRATION_PLAN.md`](./notes/DESIGN_V2_INTEGRATION_PLAN.md) §3.5.9 for the full migration checklist mapping every existing loading indicator to its LogoPulse target.

## Buoy Coverage

**18 California Stations**:
- Southern: 46266 (Del Mar), 46225 (Torrey Pines), 46259 (Mission Bay), 46232 (Point Loma), 46236 (Imperial Beach), 46258 (San Pedro), 46222 (Santa Monica), 46086 (Pt. Dume), 46011 (Santa Maria), 46224, 46275, 46277, 46285
- Central/Northern: 46027 (Cape Mendocino), 46014 (Pt. Arena), 46026 (SF Bar), 46012 (Monterey), 46013 (Bodega Bay)

## Critical Implementation Patterns

### Backend: OPeNDAP Data Fetching

```python
import xarray as xr
import numpy as np

# Open dataset (xarray caches internally)
ds = xr.open_dataset(opendap_url)

# Select variables
hs = ds['htsgwsfc']  # Significant wave height
dir = ds['dirpwsfc']  # Wave direction

# Handle longitude normalization (0-360 → -180-180)
if lon_max > 180:
    hs = hs.assign_coords(lon=(((hs.lon + 180) % 360) - 180))
    dir = dir.assign_coords(lon=(((dir.lon + 180) % 360) - 180))

# Filter NaN/Inf at source
hs_values = np.where(np.isfinite(hs_values), hs_values, np.nan)
valid_mask = np.isfinite(hs_values)
```

### Backend: JSON Sanitization (REQUIRED)

```python
def json_sanitize(obj: Any) -> Any:
    """Recursively replace NaN/Inf with None for JSON serialization."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (np.integer, np.floating)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, dict):
        return {k: json_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_sanitize(v) for v in obj]
    return obj

# ALWAYS use before returning from API endpoint:
result = json_sanitize(result)
return result
```

### Backend: Caching Pattern

```python
# Bbox rounding for cache sharing
def _round_bbox(bbox):
    return {
        'min_lat': math.floor(bbox['min_lat'] * 2) / 2,
        'max_lat': math.ceil(bbox['max_lat'] * 2) / 2,
        'min_lon': math.floor(bbox['min_lon'] * 2) / 2,
        'max_lon': math.ceil(bbox['max_lon'] * 2) / 2,
    }

# Cache key format
cache_key = f"wave-overlay:{_round_bbox(bbox)}:{forecast_hour}"

# Cache lookup order: L1 (memory) → L2 (Redis) → L3 (disk) → Fetch
```

### Backend: Error Handling

```python
try:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        response.raise_for_status()
except httpx.TimeoutError:
    print(f"⏱️ Timeout fetching {url}")
    return fallback_data
except httpx.HTTPStatusError as e:
    print(f"❌ HTTP {e.response.status_code} for {url}")
    return fallback_data
except OSError as e:  # NetCDF/OPeNDAP errors
    print(f"💥 OPeNDAP error: {e}")
    return fallback_data
```

### Frontend: Canvas Layer Pattern

```javascript
const MyCanvasLayer = ({ data, visible }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const fieldRef = useRef(null);

  useEffect(() => {
    if (!visible || !data) {
      // Cleanup canvas
      if (canvasRef.current?.parentNode) {
        canvasRef.current.remove();
      }
      return;
    }

    // Build interpolation field
    fieldRef.current = new MyField(data.vectors);

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '400';
    canvas.style.background = 'transparent';
    map.getContainer().appendChild(canvas);
    canvasRef.current = canvas;

    const draw = () => {
      // Offscreen canvas pattern
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;

      const PIXEL_STRIDE = 6; // Zoom-aware
      const offWidth = Math.ceil(size.x / PIXEL_STRIDE);
      const offHeight = Math.ceil(size.y / PIXEL_STRIDE);

      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = offWidth;
      offscreenCanvas.height = offHeight;
      const offCtx = offscreenCanvas.getContext('2d');
      const offImageData = offCtx.createImageData(offWidth, offHeight);
      const offData = offImageData.data;

      // Sample data at stride intervals
      for (let y = 0; y < offHeight; y++) {
        for (let x = 0; x < offWidth; x++) {
          const mapX = x * PIXEL_STRIDE;
          const mapY = y * PIXEL_STRIDE;
          const latLng = map.containerPointToLatLng([mapX, mapY]);
          const value = fieldRef.current.interpolate(latLng.lat, latLng.lng);

          if (value && isFinite(value.speed)) {
            const color = getColor(value.speed); // Returns {r, g, b, a}
            const idx = (y * offWidth + x) * 4;
            offData[idx] = color.r;
            offData[idx + 1] = color.g;
            offData[idx + 2] = color.b;
            offData[idx + 3] = Math.round(color.a * 255); // Per-pixel alpha
          }
        }
      }

      offCtx.putImageData(offImageData, 0, 0);

      // Scale up smoothly
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, size.x, size.y);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(offscreenCanvas, 0, 0, offWidth, offHeight, 0, 0, size.x, size.y);
    };

    draw();

    // Event handlers
    const handleUpdate = () => { draw(); };
    map.on('moveend', handleUpdate);
    map.on('zoomend', handleUpdate);

    // Cleanup
    return () => {
      map.off('moveend', handleUpdate);
      map.off('zoomend', handleUpdate);
      if (canvasRef.current?.parentNode) {
        canvasRef.current.remove();
      }
    };
  }, [map, data, visible]);

  return null;
};
```

### Frontend: Alpha Calculation (CRITICAL)

```javascript
// CORRECT: Embed alpha in pixel data
const ALPHA_BASE = 0.55;
const MIN_ALPHA = 0.15;
const GAMMA = 0.65;

function getWindSpeedColor(speedKts) {
  // Normalize to 0-1
  const normalized = Math.min(speedKts / 50, 1);
  const boosted = Math.pow(normalized, GAMMA);

  // Color scale (example)
  let r, g, b;
  if (speedKts < 5) {
    r = 0; g = 255; b = 0; // Green
  } else if (speedKts < 15) {
    r = 255; g = 255; b = 0; // Yellow
  } else if (speedKts < 25) {
    r = 255; g = 165; b = 0; // Orange
  } else {
    r = 255; g = 0; b = 0; // Red
  }

  // Calculate alpha based on intensity
  const alpha = MIN_ALPHA + (ALPHA_BASE - MIN_ALPHA) * boosted;

  return { r, g, b, a: alpha };
}

// INCORRECT: Do NOT use ctx.globalAlpha (causes double-alpha)
// INCORRECT: Do NOT use multiply blending (causes darkening issues)
```

### Frontend: Particle Animation Pattern

```javascript
// WindParticlesLayer.js pattern
const numParticles = 3000;
const maxAge = 100;
const fadeOpacity = 0.96;

// Initialize particles
const particles = Array.from({ length: numParticles }, () => ({
  x: Math.random() * canvas.width,
  y: Math.random() * canvas.height,
  age: Math.floor(Math.random() * maxAge),
}));

// Animation loop
const animate = () => {
  // Fade effect (trail)
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = `rgba(0, 0, 0, ${fadeOpacity})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalCompositeOperation = 'source-over';

  particles.forEach(particle => {
    // Get wind at particle position
    const latLng = map.containerPointToLatLng([particle.x, particle.y]);
    const wind = windField.interpolate(latLng.lat, latLng.lng);

    if (wind) {
      // Move particle
      const scale = 0.8;
      particle.x += wind.u * scale;
      particle.y += wind.v * scale;

      // Draw particle
      const color = getWindColor(wind.speed);
      ctx.fillStyle = color;
      ctx.fillRect(particle.x, particle.y, 2, 2);
    }

    // Age and reset
    particle.age++;
    if (particle.age > maxAge) {
      particle.x = Math.random() * canvas.width;
      particle.y = Math.random() * canvas.height;
      particle.age = 0;
    }
  });

  animationFrameId = requestAnimationFrame(animate);
};
```

## Important Constants

**Frontend**:
- `ALPHA_BASE = 0.55` - Base overlay transparency
- `MIN_ALPHA = 0.15` - Minimum alpha floor
- `GAMMA = 0.65` - Gamma boost for color scaling
- `PIXEL_STRIDE = 6` - Zoom-aware sampling stride (4-8)

**Backend**:
- `CACHE_DURATION = timedelta(minutes=5)` - NDBC cache TTL
- `NDBC_SEM = asyncio.Semaphore(6)` - Max concurrent NDBC requests
- `WIND_SEM = asyncio.Semaphore(2)` - Max wind overlay processing

## Data Units & Formulas

- **Wave height**: Store in meters (`hs_m`), convert to feet in UI
- **Wind speed**: Store in m/s, convert to knots/mph in UI
- **Coordinates**: Always use `lat/lon` (not `lng`)
- **Time**: ISO format (UTC) from backend, convert to local in frontend
- **Surf face height**: `WVHT × max(1.0, min(2.2, 0.6 + 0.08 × DPD))`
  - Theoretical estimate for "generic beach" conditions
  - Linear period multiplier (not √period) prevents unrealistic values for long-period swells
  - Examples: 10s → 1.4x, 15s → 1.8x, 20s+ → 2.2x (capped)
  - Note: Does not account for bathymetry, refraction, or spot-specific characteristics
  - For production accuracy, implement per-spot calibration coefficients
- **Wave energy index**: `WVHT² × DPD`
  - Physically meaningful metric (wave energy flux scales with height² × period)
  - Better for ranking/comparing conditions than surf height
  - Use this for scoring and alerts

## Common Pitfalls

1. **Double alpha**: Don't use both per-pixel alpha AND `ctx.globalAlpha`
2. **Multiply blending**: Use `'source-over'` not `'multiply'` for heatmaps
3. **NaN in JSON**: Always sanitize responses with `json_sanitize()`
4. **Canvas cleanup**: Always remove canvas from DOM in useEffect cleanup
5. **Longitude normalization**: Handle 0-360 → -180-180 conversion for WW3 data
6. **Empty slices**: Check for empty arrays before min/max operations
7. **Context scope**: Get canvas context inside draw function, not outer scope
8. **Z-index conflicts**: Follow the hierarchy (tiles < heatmaps < particles < markers)

## Review Workflows

### Design Review

When doing a design review, provide:

1. **Executive summary** (5-8 bullets): What's being built, who it's for, what changes in data flow/UI
2. **Assumptions & constraints**: External dependencies, rate limits, data freshness requirements
3. **Proposed architecture**: Components, data contracts, caching strategy (diagram in text)
4. **UX flow**: Key screens/states, loading/error states, slider behavior
5. **Risks & mitigations**: Data gaps, 404s, mismatched timestamps, performance pitfalls
6. **Milestones**: 3-6 incremental slices with acceptance criteria
7. **Open questions**: Only if truly blocking

### Code Review

When doing a code review, structure as:

1. **Summary**: What changed and why (1-3 sentences)
2. **High-severity issues** (must fix): Incorrect results, breaking changes, unhandled failures, race conditions
3. **Medium severity** (should fix): Performance regressions, maintainability issues, missing tests
4. **Low severity** (nice to have): Naming, formatting, minor refactors
5. **Tests & verification**: What tests exist/missing, suggested test cases
6. **Suggested patch** (optional): Concrete diffs if changes are small

Use output format: MUST FIX / SHOULD FIX / NICE TO HAVE

### Bug Fixes

Follow Bugbot guidelines:
- Include repro steps or evidence for each MUST FIX
- Validate schemas for external data
- Cache external fetches with TTL + jitter
- Log fetch duration + failures with station identifiers
- Avoid unnecessary map re-renders
- Make loading/degraded states explicit

## Wind & Wave Models

### Wind Models Available

**GFS (Global Forecast System)**:
- Resolution: 25 km
- Updates: Every 6 hours
- Forecast: 16 days (384 hours)
- Best for: General conditions, long-range planning

**HRRR (High-Resolution Rapid Refresh)**:
- Resolution: 3 km (highest)
- Updates: Every hour (most frequent)
- Forecast: 48 hours
- Best for: California coast, short-term accuracy

**NAM (North American Mesoscale)**:
- Resolution: 12 km
- Updates: Every 6 hours
- Forecast: 84 hours (3.5 days)
- Best for: Medium-range regional forecasts

### Wave Models

**WaveWatch III (WW3)**:
- Resolution: 0.16° (global), regional domains
- Updates: Every 6 hours
- Forecast: 180 hours (7.5 days)
- Domains: global, epacif (Eastern Pacific), atlocn (Atlantic)
- Best for: Ocean swell tracking and forecasting

## Testing & Debugging

### Frontend Debug Flags

- `DEBUG_HARD_COLORS` - Use 3-band palette for testing
- `DEBUG_VIEW` - Render lat/lng gradients instead of data
- `DEBUG_GRAYSCALE` - Render as grayscale to isolate color issues

### Debug Logging

- Use `console.log()` with emoji prefixes: `🌊`, `🌬️`, `✅`, `⚠️`, `❌`
- Log field stats: `waveFieldRef.current.debugStats()`
- Log sample values: `window.__waveSampleDebug`

### Testing Commands

```bash
# Backend endpoint tests
curl "http://localhost:8000/api/buoy-status/all"
curl "http://localhost:8000/api/wind-overlay?model=hrrr"
curl "http://localhost:8000/api/waves-overlay?source=global"
curl "http://localhost:8000/api/overlays/models"

# Check running processes
lsof -i :3000  # Frontend
lsof -i :8000  # Backend

# Production tests
curl "https://mysurflife.com/api/buoy-status/all"
```

## Project Notes & Documentation

All project development notes are stored in `./notes/` directory:
- `SESSION_NOTES.md` - Development session history and current status
- `WIND_SWELL_OVERLAY_STATUS.md` - Wind/wave overlay implementation status
- `OVERLAY_UI_READY.md` - UI testing guide for overlays
- `WIND_ANIMATION_GUIDE.md` - Particle animation documentation
- `mysurflife-project-plan.md` - Original project planning
- `README.md` - Project overview and feature list

Screenshots from testing/development stored in `.playwright-mcp/` directory.

## Cursor Rules

Custom workflows defined in `.cursor/rules/`:
- `00-mysurflife-foundation.mdc` - Project baseline and conventions
- `10-design-review.mdc` - Design review workflow template
- `20-code-review.mdc` - Code review workflow template
- `BUGBOT.md` - Bug fix prioritization guidelines

## MCP Servers

### Playwright MCP Server

The project is configured with Playwright MCP server for browser automation and testing.

**Configuration**: `.mcp.json` in project root
- Server: `@playwright/mcp` (official Playwright MCP)
- Auto-enabled via `.claude/settings.local.json`

**Available Capabilities**:
- Browser automation (Chrome, Firefox, Safari)
- Screenshot capture and visual testing
- Page navigation and interaction
- Element selection and manipulation
- Network interception and monitoring
- Mobile device emulation

**Usage**:
The Playwright MCP tools are automatically available in Claude Code sessions. Use them for:
- Testing UI changes visually
- Capturing screenshots for documentation
- Automating browser-based testing workflows
- Debugging frontend issues

**Screenshots Directory**: `.playwright-mcp/` contains test screenshots and visual regression artifacts

## Custom Workflows & Slash Commands

MySurfLife implements custom Claude Code workflows adapted from professional patterns for automated code and design reviews.

### Code Review Workflow

**Slash Command**: `/review`
**Agent**: `mysurflife-code-reviewer`
**Purpose**: Comprehensive code reviews focused on MySurfLife's specific architectural patterns

**Usage**:
```
/review
```

**What It Reviews**:
- **Backend**: Async patterns, JSON sanitization (NaN/Inf), caching strategy, OPeNDAP integration
- **Frontend**: Canvas lifecycle, alpha handling, Z-index hierarchy, field interpolation
- **Data Processing**: Unit consistency, formula correctness, coordinate handling
- **Common Pitfalls**: Double alpha, multiply blending, missing cleanup, longitude normalization

**Output Format**:
- [Critical/Blocker]: Security, NaN/Inf issues, memory leaks, canvas cleanup violations
- [Improvement]: MySurfLife pattern adherence, performance optimizations
- [Nit]: Minor polish, optional refactors

**Configuration Files**:
- `.claude/slash-commands/review.md` - Slash command definition
- `.claude/agents/mysurflife-code-reviewer.md` - Subagent configuration

### Design Review Workflow

**Slash Command**: `/design-review`
**Agent**: `mysurflife-design-reviewer`
**Purpose**: UI/UX reviews for geospatial visualization, canvas rendering, and responsive design

**Usage**:
```
/design-review
```

**What It Reviews**:
- **Interaction Flow**: Map controls, buoy selection, time slider usability
- **Visual Hierarchy**: Information prioritization, data clarity
- **Responsive Behavior**: Mobile/tablet/desktop adaptations (uses Playwright)
- **Canvas Rendering**: Particle animations, heatmap quality, alpha blending
- **Data Visualization**: Legend clarity, direction indicators, buoy markers
- **Polish**: Transitions, micro-interactions, loading states
- **Accessibility**: WCAG AA compliance, touch targets, keyboard navigation

**Playwright Integration**:
When visual changes are detected, the workflow uses Playwright MCP to:
- Navigate to localhost:3000 or mysurflife.com
- Capture screenshots at multiple breakpoints (375px, 768px, 1920px, 2560px)
- Test interactions (clicks, hovers, toggles)
- Verify responsive behavior
- Check console for errors

**Output Format**:
- [Critical]: Visual bugs, broken interactions, accessibility violations
- [Improvement]: UX enhancements, visual consistency, professional polish
- [Nit]: Minor spacing, color tweaks, optional refinements

**Configuration Files**:
- `.claude/slash-commands/design-review.md` - Slash command definition
- `.claude/agents/mysurflife-design-reviewer.md` - Subagent configuration

### MySurfLife-Specific Review Criteria

**Backend Critical Checks**:
1. JSON Sanitization - MUST use `json_sanitize()` before API responses
2. Async Patterns - All I/O must use `async/await`
3. OPeNDAP Longitude - MUST normalize 0-360 → -180-180 for WW3
4. Error Handling - Must catch `httpx.TimeoutError`, `HTTPStatusError`, `OSError`
5. Caching - Verify TTL, bbox rounding, cache key format
6. Semaphores - Check `NDBC_SEM` (6), `WIND_SEM` (2) usage

**Frontend Critical Checks**:
1. Canvas Cleanup - MUST remove canvas from DOM in useEffect cleanup
2. Alpha Calculation - MUST use per-pixel alpha, NOT `ctx.globalAlpha`
3. Composite Operation - MUST use `'source-over'`, NOT `'multiply'`
4. Z-Index - Follow tiles(200) < heatmaps(400) < particles(401) < markers(500)
5. Animation Frames - MUST cancel `requestAnimationFrame` in cleanup
6. Field Interpolation - Proper bilinear interpolation with boundary checks

### Using the Workflows

**For Code Changes**:
1. Make your changes (backend or frontend)
2. Commit changes to git
3. Run `/review` to get comprehensive code review
4. Address Critical/Blocker issues before merging
5. Consider Improvements for code quality
6. Optional: Address Nits for polish

**For UI Changes**:
1. Make visual/interaction changes
2. Ensure dev server running (npm start)
3. Run `/design-review` to get UX/visual review
4. Playwright will automatically capture screenshots if server accessible
5. Address Critical issues (visual bugs, broken interactions)
6. Implement Improvements for professional polish
7. Optional: Refine based on Nits

**Best Practices**:
- Run `/review` before creating pull requests
- Run `/design-review` for any frontend component changes
- Both workflows can be run together for full-stack changes
- Workflows preserve context and don't consume main thread tokens
- Reviews reference MySurfLife's CLAUDE.md and .cursorrules patterns

### Workflow Source

These workflows are adapted from Patrick Ellis' professional Claude Code workflows:
- [Claude Code Workflows Repository](https://github.com/patrickellis/claude-code-workflows)
- [YouTube Tutorial: Code Review](https://www.youtube.com/watch?v=nItsfXwujjg)
- [YouTube Tutorial: Design Review](https://www.youtube.com/watch?v=xOO8Wt_i72s)

Customizations for MySurfLife include:
- Ocean data processing patterns
- Canvas rendering best practices
- Geospatial visualization standards
- Real-time forecasting UX patterns
- Mobile surf forecast optimization
