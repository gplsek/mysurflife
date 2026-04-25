# mysurflife — Claude handoff notes

This project is a design prototype. Several visual elements are **stand-ins** that must be wired to real data sources during implementation. This file lists those wiring requirements so nothing gets shipped as-is.

---

## Spot Detail Page (`mysurflife-spot-detail.html`)

### 1. Map hero background — MUST be a real satellite tile

The hero at the top of the page currently uses a **CSS/SVG stylized coastline** (`.map-img` div + `<svg class="map-detail">`). This is a placeholder so the prototype is self-contained. In production it must be a live satellite image centered on the spot's coordinates.

**Requirements**
- Replace `.map-img` + `<svg class="map-detail">` with a single satellite tile image (static map snapshot OR a slippy map canvas). Keep everything else in the hero unchanged.
- The image must be **centered on the spot's `lat`/`lon`** with an appropriate zoom so the lineup, break, and nearshore bathymetry are all visible (zoom ~15–16 for most reef/point breaks; ~14 for beach breaks with longer stretches).
- Orientation: **north up** (don't rotate to match swell direction — the compass overlay handles direction).
- Style: satellite/aerial imagery (not road map). Acceptable sources include:
  - Mapbox Static Images API (`mapbox/satellite-v9` or `satellite-streets-v12`)
  - Google Static Maps (`maptype=satellite` or `hybrid`)
  - Apple MapKit snapshotter (for iOS/macOS clients)
  - ESRI World Imagery tiles
- Resolution: request at 2× for retina (e.g. `@2x` suffix on Mapbox, `scale=2` on Google).
- The spot's lat/lon must visually land at the **center of the compass** — the compass is absolutely centered on `.map-hero`, so the tile must also be centered there.

**Layers that stay as-is (do NOT remove these)**
- `.map-dim` — bottom-to-top gradient that fades the map into the dark panel below.
- `.map-vignette` — inner shadow that darkens the edges for focus.
- `.map-grid` — faint grid overlay (optional; can be removed if the satellite reads busy).
- The top chrome (`.topbar`), spot title (`.spot-title`), and compass (`.compass-wrap`) all sit in layers above the map and must remain untouched.

**Attribution**
- Mapbox, Google, and ESRI all require visible attribution. Add a small attribution line in the bottom-right of `.map-hero` (10–11px, muted color). Follow the provider's terms.

### 2. Radial compass — must reflect live forecast, not mock data

The compass currently reads from a synthetic `data[]` array generated in the inline script. In production:

- Pull hourly forecast (168+ hours / 7+ days) from your swell model provider (Surfline, Stormglass, Open-Meteo Marine, NOAA WaveWatch III, etc.).
- For each hour, the model must supply **at least**:
  - Up to 3 swell components, each with: significant height (ft), dominant period (s), direction FROM (°), and ideally wave energy or category
  - Wind speed (mph/kts), wind direction FROM (°), and gust
  - Tide height (ft) and rising/falling
- Arrow rotation convention used in the prototype: **`rotate(direction - 180)`** positions a group at bearing `direction` (FROM) with its arrowhead pointing toward center. If your data expresses direction as "TO," invert it (`dir + 180`) before applying.
- The compass supports **1–3 swell arrows**. If a swell component has height < ~0.3ft or is not reported, hide its arrow entirely (don't render a zero-length indicator). Wind arrow is always shown.

### 3. Timeline — should span at least 7 days

The slider is hard-coded to 168 hours (7 days). Do not reduce this. If the forecast provider returns more (Surfline: 16 days, Open-Meteo: 10), extend it — but keep the tick labels readable (show every 24h, or switch to day names beyond 72h).

### 4. Day dropdown — rating per day

The dropdown's 5-square rating indicator is currently derived from avg primary swell height. Replace with your actual per-day rating signal (star rating from the forecast provider, or your own scoring that factors wind + swell + tide).

---

## Testing checklist

Before merging, verify on the spot detail page:

- [ ] Map hero shows a real satellite tile for the spot's lat/lon, centered under the compass.
- [ ] Map attribution is visible and follows the provider's terms.
- [ ] Compass arrows rotate correctly as the slider moves — sanity check: at a time when wind is "onshore from W," the wind arrow should sit on the west side of the ring with its head pointing inward (east).
- [ ] Between 1 and 3 swell arrows render, hidden when that swell component is absent.
- [ ] Day dropdown lists 7 days: "Today," "Tomorrow," then weekday names. Clicking a row snaps the slider to the same hour on that day.
- [ ] Selecting a day updates the pill label to `{Day} · +{N}hrs · {Time}`.
- [ ] Conditions grid values update live as the slider moves.
- [ ] Strip charts (wave/wind/tide) show the yellow dashed cursor at the slider position.
- [ ] Page is keyboard-accessible: slider responds to arrow keys, dropdown opens on Enter/Space and closes on Escape.
- [ ] Mobile (≤640px): compass scales down, conditions grid reflows to 2 columns, day dropdown stays within viewport.

---

## Other prototype stand-ins in this project

- **Copilot session preview** (`mysurflife-copilot-session.html`) uses mocked assistant responses. Wire to your actual AI backend.
- **Home map view** (`mysurflife-home.html`) uses normalized `x`/`y` coords on a flat world rendering. Replace with a real slippy map (Mapbox GL JS or MapLibre) and project spots by true lat/lon.
- **Session log, alerts, sessions** (`data.jsx`) are mock arrays. Replace with your API/DB.

---

## Global Map View (`mysurflife-map.html` + `map-view.js`)

A full-screen world map with clustered surf spots, NOAA buoys, and active storm systems. Built on **Leaflet 1.9.4** with **CARTO Dark Matter** raster tiles.

### What's mocked vs. real

| Element | Current (prototype) | Production wiring |
|---|---|---|
| Base tiles | CARTO Dark Matter (free, no key) | Keep CARTO, or swap to Mapbox/Stadia dark vector for sharper glyph labels at high zoom |
| Surf spot list | Hardcoded `SPOTS[]` array (48 spots) in `map-view.js` | Your spots table/API. Minimum shape: `{id, name, region, lat, lon, rating (0–5), swell, period, wind, water, fav}` |
| Rating per spot | Static number on each spot | Should be a **live score** computed from that spot's current forecast (swell height × period × wind alignment × tide). Refresh on a cadence (every 15–30 min). |
| Buoys | Hardcoded `BUOYS[]` array with real NDBC station IDs | Pull live station data from NDBC (`https://www.ndbc.noaa.gov/data/realtime2/{id}.txt` — latest `.spec` file gives dominant wave height/period). Filter to stations meaningful for surf (coastal/shelf buoys, not offshore weather buoys). |
| Storm systems | Hardcoded `STORMS[]` array | Pull from NOAA OPC (Ocean Prediction Center) surface analysis — low-pressure centers with central pressure and max winds. Alternative: derive from WW3 wave model where seas > 20ft concentrate. Refresh every 6 hours. |
| Regions | Hardcoded `REGIONS[]` with bboxes | Can stay hardcoded (these are editorial groupings), OR derive dynamically from user's saved/favorite spots clustered by region. |

### Implementation notes

**Marker rendering.** All markers use `L.divIcon` with inline HTML (not bitmap sprites). The CSS classes `.marker-spot`, `.marker-buoy`, `.marker-cluster`, `.marker-storm` live in `mysurflife-map.html`. Rating tier class (`firing` / `solid` / `good` / `fair` / `flat`) is computed from `rating` via `ratingClass()` and sets the marker color via `currentColor` cascade. Keep this pattern — it lets the design team iterate on marker visuals without touching JS.

**Clustering.** Handrolled grid-based clustering in `render()` (below zoom 5). Not `leaflet.markercluster` — we avoid that dep because we want full control over cluster marker styling (the numeric + "spots" label + color tied to avg rating). If the spot count grows past ~500, swap to Supercluster for performance; keep our marker renderer.

**Performance.** `render()` tears down and rebuilds every marker on every `moveend`/`zoomend`, debounced 80ms. Fine up to ~500 spots. Past that, switch to a diffing approach: keep markers on the map, update only which are bound based on bounds + filters.

**Tile fade fix.** There's a `.leaflet-tile { opacity: 1 !important; }` override in the stylesheet. It exists because Leaflet's default tile fade-in can race initial layout in some embedded contexts and leave tiles at opacity 0. Leave it.

**Map init timing.** Initial `render()` is called inside `map.whenReady()` + `invalidateSize()` to avoid racing tile load. Don't move it back to a naive `setTimeout`.

### Features to preserve when re-implementing

- **Region chips** (top-left) — `fitBounds` with ~80px padding, capped at maxZoom 8. "All regions" flies back to `[20, -50]` zoom 2.
- **Search** (⌘K / Ctrl+K) — fuzzy match on spot name + region; flies to first match at zoom 8.
- **Layer toggles** (left rail) — four independent toggles: Spots / Buoys / Storms / Favorites-only. Re-render on change.
- **Legend** — counts per rating tier recompute from the full `SPOTS` array (not just visible ones). Intentional — gives the user a sense of global inventory.
- **Status bar** — "In view" recomputes from current bounds on every render; "Total" is static. "Updated 2m ago" is a mock — replace with actual data freshness timestamp.
- **Preview card** — appears on spot click. `pvPill` background is set inline via `ratingColor()`. The "Open spot" button links to `mysurflife-spot-detail.html` — in production, pass the spot id as a query param and have the detail page read it.
- **Storm markers** — `interactive: false` on purpose; they're ambient context, not clickable. The pulsing rings are pure CSS keyframes (`@keyframes stormPulse`).
- **Buoys hide below zoom 2** — intentional clutter-management. Don't lower further; at zoom 1 the world fits in ~400px and buoys overlap spots.

### Testing checklist

- [ ] Tiles render and are visible at initial load (zoom 2, world view) — not a black screen.
- [ ] All 3 storm markers visible with animated pulsing rings.
- [ ] Clicking a region chip fits bounds to that region with padding (doesn't overzoom).
- [ ] Clustering kicks in below zoom 5 and individual markers appear at zoom ≥ 5.
- [ ] Clicking a cluster zooms in ~2.5 levels toward its centroid.
- [ ] Clicking a spot marker opens the preview card with correct name/region/metrics and flies to the spot.
- [ ] Layer toggles remove/add the correct marker type.
- [ ] "Favorites only" shows only spots with `fav: true` (currently Pipeline, Mavericks, Rincon, Lower Trestles, Nazaré, Jeffreys Bay, Snapper Rocks).
- [ ] Search input filters spots and flies to the first match. Escape blurs the input and closes the preview card.
- [ ] Zoom controls (custom, bottom-right) work alongside trackpad/scroll zoom.
- [ ] Attribution is visible bottom-right and links out correctly.
- [ ] Mobile (≤900px): left rail hidden, region chips horizontally scrollable, preview card full-width at bottom.
