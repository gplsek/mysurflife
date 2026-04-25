# Global Map Page — Functional Specification

**Source:** `mysurflife-map.html` + `map-view.js`
**Audience:** Claude Code / implementation engineers
**Purpose:** Every visible element, its data binding, interactive behavior, and wiring requirement for the full-screen world-map view. If it's on the page, it's in this doc.

This spec is the contract. If a behavior in the prototype is not listed here, ask before dropping it; if something here is not in the prototype, it's an intentional production addition and must be built.

---

## 0. Page-level

| Property | Value |
|---|---|
| Route | `/map` |
| Title (`<title>`) | `Map · mysurflife` |
| Theme | Dark, `data-theme="ocean"` |
| Fonts | Geist (300–700), Geist Mono (300–600), Instrument Serif (italic) |
| Viewport | Full-screen; `html, body { height: 100%; overflow: hidden; }` |
| Map engine | **Leaflet 1.9.4** (raster tiles, no WebGL) |
| Base tiles | CARTO **Dark Matter** — `dark_nolabels` + `dark_only_labels` overlay at 60% opacity |
| Initial view | Center `[25, -50]`, zoom `2` |
| Zoom range | `minZoom: 2`, `maxZoom: 15` |
| Map options | `worldCopyJump: true`, `zoomControl: false` (custom), `preferCanvas: false`, `attributionControl: true` |

### Z-index stack (critical — do not change)

```
0   #map (Leaflet tile pane + panes)
1   #map .leaflet-pane, .leaflet-top, .leaflet-bottom
2   #map .leaflet-control-container
20  .status-bar
24  .left-rail
25  .region-bar, .zoom-controls
26  .preview-card
28  .timeline
30  .topbar
```

All chrome must stay **above** Leaflet's own panes. The CSS overrides (`#map .leaflet-pane { z-index: 1 !important }`, etc.) are intentional — do not remove.

### Companion specs

- **`SPEC-map-timeline.md`** — the bottom-anchored forecast scrubber (compact pill + expanded panel). Drives `curH` (hours from NOW), and **everything time-aware on this page must react to it**: spot ratings/colors, the legend counts, storm marker positions and intensities, the spot/storm preview cards, and (v2) overlay layers. Don't ship the map without reading that spec — most of the static "now-only" behavior described below is actually a function of `curH`, defaulting to `curH=0`.
- **`SPEC-spot-detail.md`** — the per-spot page that opens from the preview card.
- **`SPEC-storm-card.md`** — the storm detail card that opens from a storm marker.
- **`SPEC-profile-drawer.md`** — the user drawer behind the avatar.

### Data loaded on mount

```ts
type MapBundle = {
  spots: Spot[];       // ~48 in prototype, could grow to 1000s
  buoys: Buoy[];       // NDBC stations
  storms: Storm[];     // active low-pressure systems
  regions: Region[];   // editorial groupings
  user?: { favorites: string[] };  // spot IDs
};

type Spot = {
  id: string;
  name: string;
  region: string;       // "Oahu, HI"
  lat: number;
  lon: number;
  rating: number;       // 0–5, live-scored per §14
  swell: number;        // primary swell height (ft)
  period: number;       // primary period (s)
  wind: number;         // mph
  water: number;        // °F
  fav?: boolean;        // derived from user.favorites
};

type Buoy = {
  id: string;           // NDBC station ID (e.g. "51001")
  name: string;
  lat: number; lon: number;
  wave: number;         // significant wave height (ft)
  period: number;       // dominant period (s)
};

type Storm = {
  id: string;
  name: string;         // "Low Pressure · North Pacific"
  lat: number; lon: number;
  label: string;        // "980 mb · 55 kt"
};

type Region = {
  id: string;           // "all" | "hawaii" | …
  label: string;
  bbox: [[south, west], [north, east]] | null;  // null for "all"
};
```

See §14 for what must be **live** vs. static.

---

## 1. Top bar (`<nav class="topbar">`)

Absolute, `top: 14px`, full-width minus 14px gutters. `z-index: 30`. Flex, 10px gap. `pointer-events: none` on the nav; `auto` on direct children.

Contents left-to-right:

### 1.1 Brand (`<a class="brand">`)
- Links to `/` (`mysurflife.html`)
- 22×22 `mark` SVG (color `--fire`, `--mark-dot: --aqua`) + wordmark "mysurflife"
- 9×14 padding, 10px radius, `--panel` bg with `backdrop-filter: saturate(180%) blur(14px)`, 1px `--border`
- Weight 700, letter-spacing `-0.02em`, font-size 14px

### 1.2 Primary tabs (`.tabs`)
Pill-group of 5 tabs. 4px padding, 2px gap, same `--panel` chrome.

Each `.tab`: 7×12 padding, 7px radius, 13px weight-500 `--fg-2`. `.on` → `--bg-3` bg + `--fg` text. Hover (non-active) → `--fg`.

| Tab | Icon | Route | Notes |
|---|---|---|---|
| Map | tent/compass | `/map` | **Active** on this page (`.on`) |
| Dashboard | 4-pane grid | `/dashboard` | |
| Journal | doc-lines | `/journal` | |
| Alerts | bell | `/alerts` | Show a dot badge when unread |
| Copilot | chat bubble | `/copilot` | |

**Prototype: tabs are not wired** — only visual. Production: each tab navigates.

### 1.3 Search (`.search-wrap` / `#searchInput`)
- Flex-1, max-width 480px. Same `--panel` chrome. `:focus-within` → border `--aqua`.
- Magnifier SVG (14px, muted), placeholder "Search spots, regions, buoys, or storms…"
- `.search-kbd` pill on the right shows `⌘K`
- **Shortcut:** `⌘K` / `Ctrl+K` (global) focuses + selects the input. `Esc` blurs it and closes any open preview.
- **Debounce:** 250ms after last keystroke, then:
    1. Set `state.query = trimmed`
    2. Find first match (spot whose `name` or `region` contains query, case-insensitive)
    3. `map.flyTo(match, 8, duration: 0.9)` if found
    4. Re-`render()` (filters markers to matches)
- Placeholder hints 4 entity types, but prototype only searches spots. **Production:** extend to buoys (by id/name) and storms (by name). Return the first match ranked Spot > Region > Buoy > Storm.

### 1.4 Right cluster (`.topbar-right`, `margin-left: auto`)
- **Layers icon button** — stacked squares SVG, 40×40, opens a layer panel. *(Prototype: no-op. The left rail already has toggles. Production: on mobile this button should open a sheet with the same toggles since the left rail is hidden.)*
- **Avatar** — 36×36 circle, aqua→fire gradient, initials "DS" in Geist Mono. Click → user menu. *(Prototype: no-op.)*

---

## 2. Region chips (`.region-bar` / `#regionBar`)

Absolute, `top: 72px`, `left: 14px`, `z-index: 25`. Flex-wrap, 6px gap. Built programmatically from `REGIONS[]`.

**Chip structure:** `{label} <span class="ct">{count}</span>`
- Default: `--panel` bg, 1px `--border`, 7×12 padding, 20px radius, 12px `--fg-2`, weight 500
- Hover: `--fg` text, `--border-2` border
- `.on`: `--aqua` bg, dark text, aqua border, weight 600
- `.ct`: Geist Mono 10px muted; when `.on` becomes dark at 70% opacity

**Counts** are computed once at init:
- `all` → `SPOTS.length`
- others → `SPOTS.filter(s => inBbox(s.lat, s.lon, r.bbox)).length`

**Click behavior (`selectRegion(id)`):**
1. Set `state.region = id`
2. Toggle `.on` class on all chips
3. If `bbox`: `map.fitBounds(bbox, { padding: [80, 80], maxZoom: 8, animate: true })`
4. If `all`: `map.flyTo([20, -50], 2, { duration: 1 })`
5. `moveend` → `render()` will re-filter spots by new region

**Region list (prototype):**
`all`, `hawaii`, `ca`, `pnw`, `mex` (Mexico · CA), `europe`, `indo`, `aus`, `sa` (South America). Production may extend — see §14 note.

**Mobile (≤900px):** `.region-bar` becomes `top: 68px`, full-width, `overflow-x: auto`, `flex-wrap: nowrap`, scrollbar hidden. Chips `flex-shrink: 0`.

---

## 3. Left filter rail (`<aside class="left-rail">`)

Absolute, `top: 130px`, `left: 14px`, `width: 240px`, `z-index: 24`. Column, 10px gap. Two cards.

**Hidden at ≤900px** — replaced by the top-bar Layers button (§1.4).

### 3.1 Markers legend card (`.rail-card` #1)

Title: `Markers` (Geist Mono 10px uppercase muted, letter-spacing 0.14em).

Grid template: `24px 1fr auto` (icon / label / count).

| Row | Icon | Label | Count id | Rating range |
|---|---|---|---|---|
| 1 | 18px coral-ringed dot | `Firing · 4.5+` | `#ctFiring` | `r >= 4.5` |
| 2 | gold-ringed dot | `Solid · 3.5–4.5` | `#ctSolid` | `3.5 <= r < 4.5` |
| 3 | good-ringed dot | `Fun · 2.5–3.5` | `#ctGood` | `2.5 <= r < 3.5` |
| 4 | aqua-ringed dot | `Fair · 1.5–2.5` | `#ctFair` | `1.5 <= r < 2.5` |
| 5 | muted-ringed dot | `Flat` | `#ctFlat` | `r < 1.5` |
| sep | 1px `--border` divider, 10px margin |
| 6 | dashed aqua ring + aqua dot | `NOAA buoy` | hard-coded `62` | *(Prototype: static. Production: `BUOYS.length`.)* |
| 7 | `--storm` filled dot | `Active storm` | hard-coded `3` | *(Prototype: static. Production: `STORMS.length`.)* |

**`updateLegendCounts()`** bins `SPOTS` into `ratingClass()` buckets and writes the five `#ct*` spans. Runs on every `render()`. Counts reflect the **full** spot inventory, not just visible — intentional (gives sense of global scale).

### 3.2 Layers toggles card (`.rail-card` #2)

Title: `Layers`.

4 toggle rows (`.filter-toggle`). Each: label left, `.toggle` switch right.

| Toggle | id | State key | Default |
|---|---|---|---|
| Surf spots | `#togSpots` | `state.showSpots` | `true` |
| NOAA buoys | `#togBuoys` | `state.showBuoys` | `true` |
| Storm systems | `#togStorms` | `state.showStorms` | `true` |
| Favorites only | `#togFavs` | `state.favsOnly` | `false` |

**Toggle visual:** 32×18 pill, 10px radius, 14×14 knob. Off: `--bg-3` bg, muted knob, 2px left. On: `aqua/25%` bg, aqua knob, 15px left. 150ms transition.

**Click → `bindToggle`:** flips `state[key]`, toggles `.on` class, calls `render()`.

---

## 4. Custom zoom controls (`.zoom-controls`)

Absolute, `right: 14px`, `bottom: 120px`, `z-index: 25`. Vertical stack inside `--panel` container, 10px radius.

| Button | id | Icon | Action |
|---|---|---|---|
| Zoom in | `#zoomIn` | `+` | `map.zoomIn()` |
| Zoom out | `#zoomOut` | `−` | `map.zoomOut()` |
| Locate me | `#locateMe` | crosshair | `map.flyTo([35.5, -120.5], 6, duration: 0.9)` *(hard-coded CA)* |

**Production wiring:**
- `locateMe` must call `navigator.geolocation.getCurrentPosition` with permission-prompt handling. On grant → `flyTo(coords, 8)`. On deny → toast "Location permission required" and fall back to the user's saved home region (if any) or no-op.
- Leaflet's own zoom control is hidden via `.leaflet-control-zoom { display: none !important }`.

---

## 5. Bottom status bar (`.status-bar`)

Absolute, `bottom: 14px`, full-width minus gutters, `z-index: 20`. Flex, 10px gap, `align-items: flex-end`. `pointer-events: none` on container.

### 5.1 Left status card (`.status-card`)
- Blinking green `.dot` (2.4s ease-in-out `@keyframes blink`, opacity 1 ↔ 0.45)
- `Live` label · `NOAA · WW3` value
- 1px `.status-sep` divider
- `Updated` label · `2m ago` value — **prototype: static**. Production: bind to actual data-freshness timestamp; update every 60s.

### 5.2 Right status card (`.spot-count`, `margin-left: auto`)
- `In view` · `#inViewCount` (live count of spots whose `lat/lon` falls within current `map.getBounds()`)
- `Total` · `#totalCount` (`SPOTS.length`)
- `updateStatusCounts()` runs on every `render()`

**Key/value style:** `.k` Geist Mono 10px uppercase muted letter-spacing 0.14em; `.v` weight 600 `--fg`.

---

## 6. Spot preview card (`#previewCard`)

Absolute, `bottom: 70px`, centered via `left: 50%; transform: translateX(-50%)`. 360px wide, `z-index: 26`.

`--panel` bg, 1px `--border-2`, 14px radius, 14/16 padding, shadow `0 24px 60px black/55%`.

**Enter/exit:**
- Default: `opacity: 0`, `translateX(-50%) translateY(10px)`, `pointer-events: none`
- `.show`: `opacity: 1`, `translateX(-50%) translateY(0)`, `pointer-events: auto`
- 180ms ease transition on both

### 6.1 Head (`.preview-head`)
- **Title block** — `#pvName` (15px weight 700, letter-spacing `-0.01em`) + `#pvRegion` below (11px `--fg-2`, weight 400)
- **Close button** (`#pvClose`) — 14px × SVG, muted → `--fg` on hover. Click → remove `.show`.

### 6.2 Rating strip (`.rating-strip`)
- **`#pvPill`** — Geist Mono 10px uppercase weight 600, 3×8 padding, 4px radius, dark text. Background set inline via `ratingColor(r)`. Text set via `ratingLabel(r)`: `FIRING` / `SOLID` / `FUN` / `FAIR` / `FLAT`.
- **`#pvTag`** — muted context string `{rating.toFixed(1)} / 5.0 · {swell}ft primary swell`

### 6.3 Metrics grid (`.preview-metrics`)
`grid-template-columns: repeat(4, 1fr)`, 8px gap. Each `.m`: `--bg-3` bg, 1px `--border`, 8px radius, 8×10 padding.

| id | Label (`.k`) | Value (`.v`) | Unit (`.u`) |
|---|---|---|---|
| `#pvSwell` | `Swell` | `spot.swell.toFixed(1)` | `ft` |
| `#pvPer` | `Period` | `spot.period` | `s` |
| `#pvWind` | `Wind` | `spot.wind` | `mph` |
| `#pvTemp` | `Water` | `spot.water` | `°F` |

### 6.4 Open spot button (`.preview-open`)
- Full-width, 10px padding, `--aqua` bg, dark text, 8px radius, weight 600 13px
- Text `Open spot` + arrow SVG
- Hover: background `oklch(0.88 0.16 195)` (brighter aqua)
- **Prototype:** static `href="mysurflife-spot-detail.html"`. **Production:** `href` must include the spot id — `/spots/{spot.id}`. Set dynamically in `showPreview()`.

### 6.5 Interactions
- **Opens** on spot-marker click. `showPreview(spot)` fills all fields and calls `map.flyTo([lat, lon], max(currentZoom, 7), duration: 0.6)`.
- **Closes** on: `#pvClose` click, bare map click (`map.on('click')`), `Esc` key.
- **Mobile (≤900px):** full-width minus 14px gutters, `bottom: 80px`, no horizontal centering transform.

---

## 7. Map markers

All markers are `L.divIcon` (HTML) — **not** bitmap sprites. CSS lives in the `<style>` block; JS in `map-view.js` (`makeSpotIcon`, `makeBuoyIcon`, `makeStormIcon`, `makeClusterIcon`). This pattern is intentional — the design team iterates on marker visuals without touching JS.

### 7.1 Surf spot marker (`.marker-spot`)

38×38. Centered on its lat/lon via `translate(-50%, -50%)` + Leaflet `iconAnchor: [19, 19]`.

**Structure:**
```
.marker-spot.{tierClass}
  .halo          (absolute, 2px currentColor ring, glow + dark outer shadow)
  .inner         (absolute inset 4px, dark fill, 1px white/15% border,
                  contains 16×16 #surfer svg)
  .rating-num    (absolute top:-8 right:-8, 10px Geist Mono badge,
                  bg = currentColor, text via ::before from data-rating)
```

**Tier classes** — drive `currentColor`:
| Class | Condition | Color var |
|---|---|---|
| `firing` | `r >= 4.5` | `--coral` |
| `solid` | `3.5 <= r < 4.5` | `--gold` |
| `good` | `2.5 <= r < 3.5` | `--good` |
| `fair` | `1.5 <= r < 2.5` | `--aqua` |
| `flat` | `r < 1.5` | `--muted` |

**Rating badge gotcha (resolved):** `.rating-num` text is rendered via `::before { content: attr(data-rating); color: dark }` so that `background: currentColor` (inherited from `.marker-spot`) doesn't collide with the text color. Do not revert to an inline text node with `color: dark + background: currentColor` — that paints both black.

**Hover:** `.halo` scales to 1.1 (150ms).

**Click:** stop propagation, `showPreview(spot)`.

### 7.2 Buoy marker (`.marker-buoy`)

22×22. Aqua. `.ring` (dashed, 50% opacity, full opacity on hover) + `.dot` (inset 6, glowing).

Native browser `title` attribute: `Buoy {id} · {name} · {wave}ft @ {period}s`.

**Visibility:** rendered only when `zoom >= 2` and `bounds.contains(buoy)`. Never clustered.

*(Prototype comment says "only above zoom 3" but code uses `>= 2`. Ship `>= 2`. Hide buoys at zoom 1 when the world fits in ~400px and they overlap spots.)*

### 7.3 Storm marker (`.marker-storm`)

120×120. Ambient context — `interactive: false, keyboard: false`. Pure CSS animation.

- 3 `.ring` divs expanding from center to 120px over 4s, staggered 0s / 1.3s / 2.6s, opacity 0.7 → 0
- 1 `.core` — 8px `--storm` dot with glow at center
- Native `title`: `{name} · {label}`

### 7.4 Cluster marker (`.marker-cluster`)

44×44 round. Appears only at `zoom < 5`.

- Border color = `ratingColor(avgRating)` of spots in cluster
- Outer shadow ring tinted to that same color at 14% opacity
- Body: `{count}` (13px Geist Mono bold) + `"spots"` sub-label (8px uppercase muted)
- Hover: border brightens to `oklch(0.9 0.18 195)`
- **Click:** `map.flyTo([centroidLat, centroidLon], min(currentZoom + 2.5, 7), duration: 0.6)`

---

## 8. Clustering & render

**Grid-based, hand-rolled.** `CLUSTER_GRID_PX = 55`. Not `leaflet.markercluster` — we want full control over marker visuals.

**`render()` procedure (runs on every move/zoom end, debounced 80ms):**

1. `clearMarkers()` — remove all spot/buoy/storm/cluster markers, clear maps.
2. **Storms** — if `state.showStorms`, add all 3 (no visibility filter, they're global).
3. **Buoys** — if `state.showBuoys && zoom >= 2`, add each buoy whose lat/lon is in current bounds.
4. **Spots** — if `state.showSpots`:
    - Filter `SPOTS` by: `favsOnly` (require `s.fav`), `query` (substring in name/region), `region.bbox`, and `bounds.contains(s)`.
    - If `zoom < 5`: bucket spots into a `Map` keyed by `${floor(px/55)},${floor(py/55)}` using `map.latLngToContainerPoint`.
        - Cell size 1 → single spot marker.
        - Cell size >1 → cluster marker at the average lat/lon, avg rating drives color.
    - If `zoom >= 5`: render every visible spot as its own marker.
5. `updateLegendCounts()` + `updateStatusCounts()`.

**Performance note:** tearing down and rebuilding markers per move is fine up to ~500 spots. Past that, switch to Supercluster + diff-render. Keep the CSS marker renderer.

**Initial render:** inside `map.whenReady()`, then `setTimeout(() => map.invalidateSize(), 150)` to avoid racing tile load. Do not revert to a naïve `setTimeout(render, 0)`.

---

## 9. `state` object

Single source of truth in `map-view.js`:

```js
state = {
  region: 'all',           // current region chip id
  showSpots: true,
  showBuoys: true,
  showStorms: true,
  favsOnly: false,
  query: '',               // current search text (trimmed, lowercased on compare)
  spotMarkers: Map(),      // id → L.Marker
  buoyMarkers: Map(),
  stormMarkers: Map(),
  clusterMarkers: [],
}
```

Every mutator (toggle, region select, search, move/zoom) ends by calling `render()`.

---

## 10. Tile / Leaflet CSS overrides (do not remove)

| Rule | Why |
|---|---|
| `.leaflet-container { background: #0a1018 }` | Dark page blends with tiles while loading. |
| `.leaflet-tile { opacity: 1 !important }` | Default fade-in can race initial layout in embedded contexts and leave tiles stuck at opacity 0. |
| `.leaflet-fade-anim .leaflet-tile { will-change: auto }` | Minor GPU reduction — helps on weak devices. |
| `.leaflet-tile-pane { filter: saturate(0.85) contrast(1.05) }` | Dark Matter reads too flat/blue raw; this matches our palette. |
| `.leaflet-marker-icon, .leaflet-marker-shadow { background: transparent; border: none }` | divIcons inherit a default white bg from Leaflet otherwise. |
| `.leaflet-control-attribution { ...styled panel... }` | Matches chrome, offset 60/60px off bottom-right to avoid zoom controls. |
| `.leaflet-control-zoom { display: none }` | Custom zoom is used instead. |
| `#map .leaflet-pane { z-index: 1 !important }` (see §0) | Prevents Leaflet's own 400–700 z-indexes from punching through our chrome. |

---

## 11. Keyboard shortcuts

| Key | Context | Action |
|---|---|---|
| `⌘K` / `Ctrl+K` | Global | Focus + select search input |
| `Esc` | Global | Close preview card; blur search if focused |
| `← → ↑ ↓` | Map focused | Pan (Leaflet default) |
| `+` / `-` | Map focused | Zoom (Leaflet default) |
| (Prod add) `Tab` | Global | Cycle through chrome elements in order: brand → tabs → search → layers → avatar → region chips → toggles → zoom controls |

---

## 12. Accessibility checklist

- [ ] Every icon-only button has `aria-label` (Layers, Avatar, Zoom in/out, Locate, Close).
- [ ] Search input has `aria-label="Search spots, regions, buoys, or storms"`.
- [ ] Region chips are `role="button"`, `aria-pressed` reflects `.on` state.
- [ ] Layer toggles are `role="switch"`, `aria-checked` reflects state.
- [ ] Preview card: `role="dialog"`, `aria-labelledby` pointing at `#pvName`, focus moves to close button on open, returns to the triggering marker on close.
- [ ] Spot markers: `role="button"`, `aria-label="{name}, {region}, rating {r} of 5"`.
- [ ] `prefers-reduced-motion`: disable `.marker-storm .ring` pulse, `.status-card .dot` blink, all `flyTo` animations (use `setView` instead), preview enter/exit transitions.
- [ ] Color contrast: `--fg-2` on `--panel` must pass AA. Tier colors at their rating-pill usage (dark text on tier-colored bg) must pass AA.

---

## 13. Responsive behavior

**≤900px:**
- `.left-rail` → `display: none`; toggles move behind the top-bar Layers button (§1.4 prod note).
- `.region-bar` → full-width, `overflow-x: auto`, nowrap; hide scrollbar; chips `flex-shrink: 0`.
- `.search-wrap` → `max-width: none` (fills row).
- `.preview-card` → full-width, `bottom: 80px`, no centering transform.
- Primary tabs should collapse to icon-only (not implemented in prototype — add in prod).

**≤600px (prod add, not in prototype):**
- Top bar becomes 2 rows: brand + avatar row, search + tabs row.
- Zoom controls shrink to 2 buttons (no locate) or move to a FAB.

---

## 14. Known prototype stand-ins (full list, ranked)

| # | Element | Prototype | Production |
|---|---|---|---|
| 1 | `SPOTS[]` | Hardcoded 48-entry array | Spots API/DB. Min shape per §0. |
| 2 | `spot.rating` | Static per-entry | Live score from current forecast (swell × period × wind alignment × tide). Refresh every 15–30 min. |
| 3 | `BUOYS[]` | Hardcoded with real NDBC IDs | Pull live from NDBC (`ndbc.noaa.gov/data/realtime2/{id}.txt` — latest `.spec` gives dominant wave height/period). Filter to coastal/shelf stations relevant to surf. |
| 4 | `STORMS[]` | Hardcoded 3, frozen at "now" | Pull from NOAA OPC surface analysis (low-pressure centers with pressure + max winds). Or derive from WW3 where seas > 20ft concentrate. Refresh every 6h. **Also: each storm carries a track (6-hourly samples + best-track); position and intensity must interpolate as the timeline cursor moves.** See `SPEC-map-timeline.md` §6.2. |
| 5 | `REGIONS[]` | Hardcoded editorial | Can stay hardcoded OR derive dynamically from user's favorites clustered by region. |
| 6 | Legend buoy/storm counts | Static `62` / `3` | `BUOYS.length` / `STORMS.length`. |
| 7 | "Updated 2m ago" status | Static | Bind to actual data-freshness timestamp; update every 60s. |
| 8 | `#locateMe` | Flies to CA | Real `navigator.geolocation` with permission handling + fallback. |
| 9 | Top-bar tabs (Dashboard/Journal/Alerts/Copilot) | Not wired | Route to each page. |
| 10 | Top-bar Layers icon | No-op | On mobile (≤900px) opens a sheet with the same toggles from `.left-rail`. |
| 11 | Avatar | No-op | User menu. |
| 12 | Search scope | Spots only | Extend to buoys (id/name) and storms (name). Rank Spot > Region > Buoy > Storm. |
| 13 | `pvOpen` link | Static href | `/spots/{spot.id}` set dynamically in `showPreview`. |
| 14 | Alerts tab | No unread dot | Badge when user has unread alerts. |

---

## 15. Preserve list (things to NOT change when reimplementing)

- **Grid-based clustering** at `zoom < 5` with `CLUSTER_GRID_PX = 55`. Not `leaflet.markercluster`.
- **CSS divIcon markers** — do not switch to bitmap sprites.
- **Tile fade override** (`.leaflet-tile { opacity: 1 !important }`).
- **Map init inside `whenReady` + `invalidateSize`** — races tile load otherwise.
- **Storm markers `interactive: false`** — the OUTER container is non-interactive; the inner `.core` dot is clickable (it carries the click target with an invisible padded hit area). Don't make the rings interactive — they cover too much area.
- **Buoys hide below zoom 2** — clutter management.
- **Legend counts reflect full inventory**, not visible set — intentional. They DO update when the timeline cursor moves (see `SPEC-map-timeline.md` §6.1) — the inventory is the same but the ratings shift, so the per-tier counts shift.
- **Storms move with the timeline** — see `SPEC-map-timeline.md` §6.2. The marker position interpolates between forecast track points; intensity (ring opacity, preview-card metrics) reads at-cursor. Past the forecast horizon, marker dims to 50% and the preview card adds a "beyond forecast" chip.
- **"Favorites only" filter** requires `spot.fav: true`. Currently 7 spots: Pipeline, Mavericks, Rincon, Lower Trestles, Nazaré, Jeffreys Bay, Snapper Rocks.
- **Preview card flies to spot at `max(currentZoom, 7)`** — avoids zooming out.

---

## 16. Out of scope for this page

Things the map page does **not** do (so Claude Code doesn't invent them):
- No forecast scrubbing / time slider (lives on spot detail)
- No session logging, no commenting / feed
- No draw-your-own-region selection
- No route planning / directions
- No offline tile caching (could be a future PWA add)
- No heatmap overlay for swell energy (future — if added, as a separate Leaflet layer below markers)
