# Storm Detail Card — Functional Specification

**Source:** `mysurflife-storm-card.html`
**Companions:** `ClaudeDesign/project/SPEC-map.md` §7.3 (storm marker on map), `notes/MAP_V2_IMPLEMENTATION_PLAN.md` Phase 4, `notes/MAP_V2_DATA_GAPS.md`
**Audience:** Claude Code / implementation engineers
**Purpose:** Every visible element of the storm click-to-reveal card, its data binding, interactive behavior, map reactions, and wiring requirements. If it's in the prototype, it's here.

This spec is the contract. If a behavior in the prototype is not listed here, ask before dropping it; if something here is not in the prototype, it's an intentional production addition and must be built.

---

## 0. Page-level

| Property | Value |
|---|---|
| Surface | Click-to-reveal card that overlays the `/map` page when a storm marker is clicked |
| Route | No new route. URL updates via history state: `/map?storm={id}` so the card is deep-linkable |
| Theme | Dark, `data-theme="ocean"` — inherits from map page |
| Fonts | Geist (300–700), Geist Mono (300–600), Instrument Serif (italic) |
| Container | `.storm-card` — absolutely positioned panel, 420px wide, `z-index: 20`. Desktop: pinned left at `380px` (clear of `.left-rail` + `.region-bar`), `top: 92px`, `bottom: 96px`. Scrolls internally. |
| Backdrop interaction | Map stays fully interactive. When an L2 row is selected, the rest of the map dims (§9). |
| Storm marker behavior changes | Storm marker (SPEC-map.md §7.3) must become `interactive: true` when the storm-card feature ships. Click opens this card and assigns `.selected` (warn-storm color) or `.hurr` (warn-hurricane color) to the marker. |

### Data loaded on open

```ts
type StormDetail = {
  // Core (from bulletin parser / NHC feed)
  id: string;
  type: 'LOW' | 'TROPICAL_STORM' | 'TROPICAL_DEPRESSION' | 'HURRICANE' | 'TYPHOON';
  typeLabel: string;                // "Low Pressure" / "Hurricane Delta"
  name: string;                     // "Low Pressure · Gulf of Alaska"
  lat: number; lon: number;
  posLabel: string;                 // "42.5°N, 155.0°W"
  pressure_mb: number;
  wind_kt: number;
  wind_mph: number;                 // provider-computed or kt × 1.15078
  seas_ft: number;
  seas_range: string;               // "18–22"
  movement_dir: number;             // compass degrees 0–360 (FROM center moving TO)
  movement_dir_label: string;       // "NE" / "WNW"
  movement_speed_kt: number;
  warning_tier: 'none' | 'gale' | 'storm' | 'hurricane';
  fetch: {
    quadrant: string;               // "W semicircle" | "NE quadrant" | etc. Known values: §5.2
    radius_nm: number;
    severity: 'gale-force' | 'storm-force' | 'hurricane-force';
  } | null;
  track: Array<{
    t_plus: 24 | 48 | 72;
    lat: number; lon: number;
    mb: number; kt: number;
  }> | null;
  issued_minutes_ago: number;
  nhc_official: boolean;            // true for NHC tropical systems with official cone data
  bulletin: string;                 // raw text

  // Arrivals (from /api/storms/{id}/arrivals)
  arrivals: Arrival[];
};

type Arrival = {
  region_id: string;                // "mx-main" / "baja-n"
  name: string;                     // "Mainland Mexico"
  parent: string;                   // "MX · Pacific" — flag-style context
  peak_ft: number;                  // best spot's peak in this sub-region
  peak_when: string;                // "Fri 5a" (localized to user tz)
  window_h: number;                 // surfable window length in hours
  tier: 'firing' | 'solid' | 'good' | 'fair' | 'flat';  // derived from peak_ft
  spots?: SpotArrival[];            // present if expanded / loaded; lazy-fetched
  total_spots?: number;             // full count for "See all N" CTA
};

type SpotArrival = {
  id: string;
  name: string;
  ft: number;
  period: number;                   // seconds
  dir: string;                      // compass text "WNW" / "SSW"
  first: string;                    // "Fri 5:00a" local to destination
  peak: string;                     // "Sat 9:00a" local to destination
  wind: string;                     // "4 mph SE"
  wind_class: 'offshore' | 'onshore' | '';
  tide: string;                     // "0.8 ft rising"
  tide_class: 'rising' | 'falling' | '';
  score: 1 | 2 | 3 | 4 | 5;         // Score (0 hidden)
};
```

### Z-index stack (relative to map page)

```
20  .storm-card-wrap        (the panel itself)
21  .map-arc / .arc-pin     (dashed great-circle overlay — above markers, below card)
30  .topbar                 (unchanged)
40  .state-bar              (demo-only control in prototype — NOT shipped)
```

---

## 1. Three-level disclosure

The card progressively discloses three levels. All three share one container and stack vertically — the card scrolls internally (`overflow-y: auto` on `.storm-card-body`). **Do not split into separate surfaces / drawers.**

| Level | When visible | Contents |
|---|---|---|
| **L1 — Characterization** | Always when card is open | Storm title, badges, primary stats, movement, fetch wedge, forecast track, quick chip, bulletin |
| **L2 — Regional scorecard** | Renders below L1 once `arrivals` loads; shows loading state or empty state when appropriate | Ranked list of sub-regions where this storm delivers surf |
| **L3 — Spot breakdown** | Expands below the selected L2 row | Ranked list of spots within that sub-region |

Only one L2 row can be selected at a time. Selecting toggles — a second click on the selected row collapses L3 and clears the map-reaction state.

---

## 2. Card container & animation

### 2.1 Container (`.storm-card`)
- `background: var(--panel-strong)` (≈ 98.5% opacity on dark panel)
- `backdrop-filter: saturate(180%) blur(20px)`
- 1px `--border-2` border, 18px radius
- `overflow: hidden` on the outer; `.storm-card-body` is the scrollable child
- Shadow: `0 24px 80px oklch(0 0 0 / 0.55), 0 2px 10px oklch(0 0 0 / 0.3)`

### 2.2 Entry animation
- From `opacity: 0, translateY(8px)` → `opacity: 1, translateY(0)` over 280ms `cubic-bezier(.2, .8, .2, 1)`.
- **Only on initial open.** State transitions within the card (L2 selection, L3 expansion) use their own animations — do not replay the container entry.

### 2.3 Scrollbar
- Thin (6px), `--border-2` thumb, transparent track. Must be visible on long cards (mobile especially).

### 2.4 Dismissal (see §11 for interactions)
- Close button, click-away on bare map, `Esc` key.
- Exit: reverse of entry over 180ms. After animation, the history state drops `?storm={id}`.

---

## 3. Level 1 — Storm characterization

Rendered by `renderL1(storm)`. Visible whenever the card is open.

### 3.1 Warning bar (`.l1-warn-bar`)
- 3px high strip across the top of the card.
- Color map:
  | `warning_tier` | Color var |
  |---|---|
  | `none` | **Hidden** (`display: none`) |
  | `gale` | `--warn-gale` (gold) |
  | `storm` | `--warn-storm` (coral) |
  | `hurricane` | `--warn-hurricane` (red) |

### 3.2 Header row (`.l1-head`)
Grid: `[badge] [title block — flex: 1] [close button]`. 18px top / 20px horizontal / 14px bottom padding, 12px gap.

**Type badge (`.storm-type-badge`):** Geist Mono 9.5px uppercase weight 600, 5×8 padding, 5px radius, 1px colored border, translucent colored bg. Variant class on the badge drives color:
| Class | Source `type` | Color family |
|---|---|---|
| `.low` | `LOW` | gale-gold |
| `.td` | `TROPICAL_DEPRESSION` | gale-gold |
| `.ts` | `TROPICAL_STORM` | storm-coral |
| `.hurricane` | `HURRICANE` | hurricane-red |
| `.typhoon` | `TYPHOON` | hurricane-red |

**Title block:**
- `.l1-title` — 19px weight 600, letter-spacing `-0.015em`, line-height 1.2. Value: `storm.name`.
- `.l1-sub` — Geist Mono 11px muted. Contents: `{posLabel}` · `{freshness}`.
    - Freshness text: `< 60 min` → `"issued {n}m ago"`. `>= 60` → `"issued {n}h ago"`.
    - **Stale flag:** when `issued_minutes_ago > 12 * 60`, the freshness span takes `.stale` (`--warn-storm` color) and the text becomes `"issued 14h ago — may be stale"`.

**Close button (`.l1-close`):** 28×28 / 7px radius / muted → `--fg` on hover. SVG `×`. Dismisses the card (§11).

### 3.3 Primary stats row (`.l1-primary`)

3-column grid, 1px gap showing the `--border` seam, top+bottom borders. Each `.cell`:

| Cell | Label | Value | Unit | Sub-text |
|---|---|---|---|---|
| 1 (`1.1fr`) | `PRESSURE` | `storm.pressure_mb` | `mb` | **Pressure gauge** (see below) |
| 2 (`1fr`) | `MAX WINDS` | `storm.wind_kt` | `kt` | `{wind_mph} mph` |
| 3 (`1fr`) | `MAX SEAS` | `storm.seas_ft` | `ft` | `{seas_range} ft range` |

- `.k` label — Geist Mono 9.5px uppercase muted letter-spacing 0.14em
- `.v` value — 22px weight 700 letter-spacing `-0.02em`, tabular-nums, with the `.u` unit as a small muted subscript (11px, weight 400)
- `.sub` secondary — Geist Mono 10px `--fg-2`

**Pressure gauge (`.pressure-gauge`):**
- 4px tall bar, full width of cell, below the numeric value (6px margin)
- Gradient L→R: hurricane-red → storm-coral → gale-gold → muted (representing 950 → 1020 mb)
- 2px white vertical marker positioned at `((pressure - 950) / (1020 - 950)) * 100%`, clamped 0–100
- `::before` / `::after` labels under the bar: `"950"` / `"1020"` (Geist Mono 8.5px muted-2)
- Marker has a 2px dark box-shadow to cut out of the gradient cleanly

### 3.4 Movement + fetch (`.l1-meta`)

Grid: `[movement block 1fr] [fetch wedge 96px]`. 14/18/16 padding, 16px gap, `align-items: center`.

**Movement block:**
- **Direction arrow** — 26×26 dark-filled circle, 1px `--border-2`. Inside: a 12×12 up-arrow SVG, `transform: rotate({storm.movement_dir}deg)` on the outer circle. Degrees follow compass convention (0 = north, 90 = east).
- **Line:** `Moving <b>{label}</b> at <mono>{speed} kt</mono>`
- **Fetch sentence (below):** 12.5px `--fg-2` line 1.45:
    - With data: `<em>{severity}</em> winds in <em>{quadrant}</em>, ~{radius_nm} nm radius` (where `<em>` is NOT italic — it's `--aqua` weight-500 Geist, inherited font family).
    - Missing: `Fetch geometry unavailable` (muted).

**Fetch wedge (`.fetch-wedge`):** 96×96 SVG compass-rose with the described quadrant filled. See §5.2 for geometry.

### 3.5 Forecast track (`.l1-track`)

Top border, 14/18/18 padding.

**Title row:**
- Left: `.title` — Geist Mono 10px uppercase muted, text `Forecast track · 72h`
- Right (conditional): `.official-badge` — shown when `nhc_official === true`. 9px uppercase aqua pill with aqua border, text `NHC Official`.

**Track viz (`.track-viz`):** see §5.3 for geometry. 52px tall, 6px horizontal margin, 16px bottom margin.

**When `track` is null:** replace the viz with `.track-missing`:
- 12/14 padding, 1px dashed `--border-2`, 10px radius, muted text 12px, center-aligned: `Forecast track unavailable`.
- **Also** hide the 3-waypoint card row entirely.

**Waypoint cards (`.track-rows`):** 3-column grid, 10px gap. Each `.track-row`:
- `--bg-3` bg, 1px `--border`, 10px radius, 10/11 padding, column layout, 4px gap
- Line 1 `.when` — Geist Mono 9.5px aqua uppercase: `+24h` / `+48h` / `+72h`
- Line 2 `.coord` — Geist Mono 11px `--fg` tabular: `{lat}°N {|lon|}°W` (1 decimal)
- Line 3 `.stat` — Geist Mono 10.5px muted: `{mb} mb · {kt} kt`

### 3.6 Quick chip — "Ask Sione about this storm" (`.l1-quick-chip`)

12px vertical / 18px horizontal margin, 8/10-12 padding, 8px radius.
- `background: oklch(0.82 0.16 195 / 0.08)` (aqua tint)
- 1px aqua-tinted border
- `--aqua` color, 12px weight 500, chat-bubble SVG + label `"Ask Sione about this storm"` + `.spark` trailing text `"Chat ↗"` (Geist Mono 10px muted)

**Click behavior (production):** Opens a new Sione session scoped to this storm context but **no specific spot**. The opening assistant message should summarize the storm and ask a general question like "Want me to break down which coasts this hits?" — contrast with per-spot "Plan trip" (§4.5) which is spot-scoped.

### 3.7 Raw bulletin disclosure (`.l1-bulletin`)

Top border, 10/18 padding. `<details>` element.

- **Summary:** Geist Mono 10px uppercase muted, with a custom `›` chevron that rotates 90° when open. Text: `View full bulletin`. Default `<summary>` marker is hidden.
- **Content (`.bulletin-text`):** Geist Mono 10.5px `--fg-2` on near-black (`oklch(0.10 0.02 235)`) bg, 1px `--border`, 8px radius, 12px padding, line-height 1.6, `white-space: pre-wrap`, `max-height: 160px`, `overflow-y: auto`.

---

## 4. Level 2 — Regional scorecard

Rendered by `renderL2(storm, { loading, selectedRegion })`. Top border separates from L1.

### 4.1 Header (`.l2-head`)
- 14/18/10 padding, flex, `justify-content: space-between`, 10px gap
- **Title:** Geist Mono 10px uppercase muted `Reachable surf` + Instrument Serif italic 13px `--fg` `— where it lands`
- **Sort toggle (`.sort-toggle`):** pill group of two 4/8 buttons, Geist Mono 9.5px uppercase.
  | Option | id | State key | Default |
  |---|---|---|---|
  | `Size` | `sort=size` | `state.l2Sort = 'size'` | **on** |
  | `Arrival` | `sort=arrival` | `state.l2Sort = 'arrival'` | |
    - Clicking flips the sort. When `size`: DESC by `peak_ft`. When `arrival`: ASC by parsed `peak_when` (Thu 2p < Fri 5a < Sat 9a).

### 4.2 Row (`.l2-row`)

Grid: `[3px tier strip] [1fr main] [auto peak]`. 2px row gap (margin-bottom), 10px radius, full-row click target. Cursor: pointer.

**States:**
- Default: no background, click hover = `oklch(1 0 0 / 0.03)` bg
- `.on`: `oklch(0.82 0.16 195 / 0.08)` bg (aqua tint). The peak `.when` line text becomes aqua.

**Tier strip:** 3px wide, radius 3, 10px top/bottom margin. Color comes from `data-tier` attribute on the row:
| `data-tier` | Color | Size value color |
|---|---|---|
| `firing` | `--coral` | `--coral` |
| `solid` | `--gold` | `--gold` |
| `good` | `--good` | `--fg` |
| `fair` | `--aqua` | `--fg` |
| `flat` | `--muted` | `--fg` |

`tier` comes from the server. If missing, derive in client via `tierFromPeak(peak_ft)`: `>=10 firing · >=8 solid · >=6 good · >=4 fair · <4 flat`.

**Main block:**
- `.name` — 13.5px weight 600, letter-spacing `-0.01em`. Text: `{arrival.name}`. Followed by `.flag` pill (9px Geist Mono uppercase, `--bg-3` bg, 1px border, 2/5 padding): `{arrival.parent}`.
- `.meta` — Geist Mono 10.5px muted, two chunks separated by middot: `first <b>{peak_when without weekday}</b>` · `<b>{window_h}h</b> window`.

**Peak block (right-aligned, min-width 78):**
- `.size` — 18px weight 700, tabular: `{peak_ft}<span class="u">ft</span>`. The `.u` is 10px muted weight 400.
- `.when` — Geist Mono 10px muted: `peak <span class="hi">{peak_when}</span>`. `.hi` is aqua (→ overridden brighter-aqua when row `.on`).

### 4.3 Loading state (`.l2-loading`)
Used when `arrivals` endpoint is in flight. 28/18 padding, center-aligned.
- 3-dot pulsing indicator (`.pulse i` with staggered 1.2s cubic keyframes — dots scale 0.6 → 1.0 and fade to aqua).
- Label below: Geist Mono 10px uppercase muted `Computing arrivals…`

Per CLAUDE.md convention, in production this could also use `<LogoPulse size={24} compact />` — but the 3-dot pattern is preserved for denser inline loading.

### 4.4 Empty state (`.l2-empty`)
Used when `arrivals.length === 0` (storm below 3ft floor everywhere).
- 4/14 margin, 20/18 padding, 1px dashed `--border-2`, 12px radius, center-aligned.
- Title (13px weight 600 `--fg-2`): `This storm isn't projected to deliver significant surf`
- Sub (11.5px muted, line-height 1.5, max-width 300, centered): `Below our 3 ft threshold across every sub-region. Either the fetch is too narrow, the storm is too weak, or the geometry points away from any coast.`

### 4.5 Error state (prod addition, not in prototype)
When `/api/storms/{id}/arrivals` fails: same shell as empty, but:
- Title: `Can't compute arrivals right now`
- Sub: `Try again in a moment.` + a small `Retry` button (9.5px uppercase Geist Mono, 4/10 padding, `--border-2` outline)
- Show L1 normally (never block L1 on arrivals failure).

---

## 5. Level 3 — Spot breakdown

Rendered by `renderL3(region, { highlightId })` when `state.selectedRegion !== null`. Placed directly under the selected L2 row (visually: inside the scrolling body, below all L2 rows; not between them).

**Background:** `oklch(0.10 0.02 235 / 0.7)` (slightly darker inset vs. card body), 1px top border, 14/16/16 padding. Entry animation `l3-in`: opacity 0→1 + translateY(-4→0) over 240ms `cubic-bezier(.2, .8, .2, 1)`.

### 5.1 Head (`.l3-head`)
- 10px gap, 12px bottom margin, flex
- Title (Geist Mono 10px uppercase aqua): `<b>{region.name}</b> · {spots.length} spots in range` (where `<b>` is `--fg` weight 600)
- Right-aligned count (Geist Mono 10px muted): `sorted by score`

### 5.2 Spot row (`.spot-row`)

`--bg-3` bg, 1px `--border`, 10px radius, 10/12 padding. Grid template `[1fr] [auto]`, 2px row / 10px column gap. Multiple content blocks span `grid-column: 1 / -1`.

**States:**
- Hover: border → `--border-2`
- `.highlight` (set when this spot was the one the user arrived at from an external link / highlight): `oklch(0.82 0.16 195 / 0.08)` bg + aqua-tinted border

**Content blocks (top to bottom):**

**(a) Name row:**
- `.name` — 13px weight 600
- `.score` right-aligned — 5 vertical bars (5px × 10px, 1px radius). Filled bars take `--aqua` by default; for `data-score="4"` → `--tier-solid` (gold); for `data-score="5"` → `--tier-firing` (coral).

**(b) Swell stats** (Geist Mono 11.5px `--fg-2`, flex, 10px gap, wrap): `<b>{ft} ft</b> · {period}s period · from {dir}` (size value `--fg` weight 500, separators muted-2).

**(c) When row** (Geist Mono 10px, flex, 14px gap, wrap, 2px top margin):
- `first <span class="v">{first}</span>` (`first` label muted-2, value `--fg-2`)
- `peak <span class="v peak">{peak}</span>` (peak value `--aqua`)

**(d) Wind/tide strip** (Geist Mono 10.5px `--fg-2`, flex, 14px gap, 4px top margin, 8px top padding, dashed `--border` top):
- Wind: arrow icon + `wind` label + `<span class="{wind_class}">{wind}{suffix}</span>` where suffix is ` off` for offshore, ` on` for onshore. Offshore = `--good` (green), onshore = `--coral`.
- Tide: wave icon + `tide` label + `<span class="{tide_class}">{tide}</span>`. Rising = `--aqua`.

**(e) CTA row (`.ctas`)** (6px gap, 8px top margin, 8px top padding, dashed `--border` top):
| Button | Class | Action |
|---|---|---|
| `Plan trip with Sione` | `.spot-cta.primary` | Hands off to Sione assistant with full context (storm + region + spot + arrivals + user home location). See §8. |
| `Open spot` | `.spot-cta` | Navigate to `/spots/{spot.id}` (prototype: static `mysurflife-spot-detail.html`) |
| `Set alert` | `.spot-cta` | Open Alerts form pre-filled with `{storm_id, spot_id, window: first→first+window_h}`. Direct form, not via Sione. |

**Button styling:**
- `.spot-cta` default: 11.5px weight 500, 7/10 padding, 7px radius, `--bg-4` bg, `--border-2`, `--fg-2`. Hover: brighter bg + `--fg` + `--border-3`.
- `.spot-cta.primary`: `--aqua` bg, dark text (`oklch(0.14 0.02 230)`), weight 600, no border. Hover: brighter aqua (`oklch(0.88 0.16 195)`).
- When user not signed in (prod add): `.primary` shows a lock icon (`.lock` class, 70% opacity) and tooltip `"Sign in to plan a trip"`; clicking routes to sign-in with an intent-return.

### 5.3 "See all N spots" CTA (`.see-all`)
Shown when `region.total_spots > region.spots.length` (i.e. more spots exist than the 5-row default).
- 8px top margin, 9/12 padding, 8px radius, dashed `--border-2`, transparent bg, Geist Mono 10.5px uppercase muted
- Hover: `--fg` + `--border-3` + `oklch(1 0 0 / 0.02)` bg
- Click: fetches and renders all spots for the region; replaces this button.

---

## 6. Fetch-wedge geometry (`renderFetchWedge`)

96×96 SVG, `viewBox="0 0 96 96"`, center at (48, 48), radius 38.

**Angle convention:** 0° = North (up), clockwise. Polar → cartesian:
```
angleRad = (deg - 90) * π / 180
x = cx + r * cos(angleRad)
y = cy + r * sin(angleRad)
```

**Quadrant → arc mapping (known values):**
| `fetch.quadrant` | From° | To° |
|---|---|---|
| `N quadrant` | -45 | 45 |
| `E quadrant` | 45 | 135 |
| `S quadrant` | 135 | 225 |
| `W quadrant` | 225 | 315 |
| `NE quadrant` | 0 | 90 |
| `SE quadrant` | 90 | 180 |
| `SW quadrant` | 180 | 270 |
| `NW quadrant` | 270 | 360 |
| `N semicircle` | -90 | 90 |
| `E semicircle` | 0 | 180 |
| `S semicircle` | 90 | 270 |
| `W semicircle` | 180 | 360 |

Unknown values fall back to `W semicircle`. Production: parse the bulletin's wedge description into one of these canonical values upstream.

**Path:** `M {cx} {cy} L {x1} {y1} A {r} {r} 0 {largeArc} 1 {x2} {y2} Z` where `largeArc = Math.abs(to - from) > 180 ? 1 : 0`.

**Visuals:**
- Outer circle: `fill: none`, `stroke: var(--border-2)`, 1px
- Wedge path: `fill: var(--warn-storm)` at 22% opacity, stroke at 1.2px with `stroke-linejoin: round`
- N/E/S/W tick marks: 3px outward at each cardinal, `--muted`, 1px
- `N` label: Geist Mono 8px muted, above the ring
- Core dot: 2px `--fg` circle at center
- Radius label: Geist Mono 8px muted below ring, e.g. `150 NM`

Accessibility: `<title>` child element with `"{quadrant} · {radius_nm} nm · {severity} winds"`.

---

## 7. Forecast track geometry (`renderTrackViz`)

52px tall, full card-body width (minus 6px gutter margin). Uses nested SVG (viewBox `0 0 100`, `preserveAspectRatio: none`) + absolute-positioned DOM dots.

**Projection:** linear to a 100×100 unit box, then scaled via SVG/CSS:
```
latMin = min(lats) - 1
latMax = max(lats) + 1
lonMin = min(lons) - 1
lonMax = max(lons) + 1
toX(lon) = ((lon - lonMin) / (lonMax - lonMin)) * 100
toY(lat) = 100 - ((lat - latMin) / (latMax - latMin)) * 100   // flip so N is up
```
Include the storm's current position (t_plus=0) as the first point of the polyline if you want the line to start from the storm; the prototype omits this for visual simplicity — track starts at +24h.

**Line:** `<polyline>`, `stroke: var(--warn-storm)`, 1.4px `stroke-dasharray="3 3"`, 65% opacity, `vector-effect: non-scaling-stroke`.

**Waypoint dots (`.wp`):** 10px round, `--bg-2` fill, 2px `--warn-storm` border, 2px dark box-shadow outline. Opacity fades with time: `1 - i * 0.25` (so +24h @ 1.0, +48h @ 0.75, +72h @ 0.5).

---

## 8. "Plan trip with Sione" handoff (§ spec)

When the L3 primary CTA is clicked:

1. POST `/api/sione/sessions` with:
   ```json
   {
     "context": {
       "source": "storm-card",
       "storm_id": "{id}",
       "storm_snapshot": { /* L1 fields */ },
       "region_id": "{selectedRegion}",
       "spot_id": "{spot.id}",
       "arrival": { "first": "...", "peak": "...", "ft": 11, "period": 17, "dir": "WNW" },
       "user_home": { "lat": "...", "lon": "..." }   // if signed in
     }
   }
   ```
2. Response returns `{ session_id, opening_message }`. The opening message is **pre-generated server-side** (not LLM-streamed on open) — template:
   > *"I see a storm forming in {region} that'll bring {ft} ft @ {period}s to {spot} starting {first}, peaking {peak}. Want me to help plan a trip?"*
3. Navigate to `/copilot?session={session_id}` (or in-prod final Sione route).
4. User not signed in → redirect to sign-in with `?return={encoded url}&intent=plan-trip`.

**Telemetry:** tag every handoff click with `storm_id`, `spot_id`, `arrival.first` so we can measure which alerts actually convert to planning sessions.

---

## 9. Map reactions (when L2 row selected)

Selecting an L2 row triggers three simultaneous map side-effects, each owned by the map-view code but orchestrated by the storm-card state:

### 9.1 Dim the map
- `document.body.classList.add('dimmed')`
- `#dim-layer` (absolute, pointer-events none) transitions `background` to `oklch(0.10 0.02 235 / 0.55)` over 320ms ease.
- Storm card + storm marker + forecast-track dots stay at full opacity (they're `z-index: 20+`, above `#dim-layer`'s level 10).

### 9.2 Draw great-circle arc
- `.map-arc` SVG `path`, `preserveAspectRatio="none"`, viewBox `0 0 100 100`, path is a quadratic bezier from `[storm.lat, storm.lon]` projected to container coords → `[region.centroid.lat, region.centroid.lon]` projected.
- Style: `stroke: var(--aqua)`, 1.6px, `stroke-dasharray: 5 5`, 60% opacity, no fill.
- Arrival pin: 14×14 circle, 2px aqua border, dark center, 5px aqua-tint halo, placed at the destination endpoint.
- Opacity transition 300ms on show/hide.

**Production:** use a real great-circle interpolation (Vincenty / haversine midpoint) with ~24 intermediate points, not a flat quadratic bezier. The prototype's bezier is visually close enough for the comp but projection distortion makes it inaccurate at high latitudes.

### 9.3 Fit map to storm + region
- `map.flyToBounds([[storm.lat, storm.lon], [region.centroid.lat, region.centroid.lon]], { padding: [140, 440], maxZoom: 4, duration: 0.9 })`
- Padding on the left side accounts for the 420px card + 380px gutter (≈ 800px); on the right allow breathing room for the arc.
- When card is in mobile bottom-sheet mode, padding flips to bottom.

### 9.4 Reverting
Clicking the selected L2 row again, clicking outside the card, or closing the card reverses all three:
- Remove `.dimmed` class
- Fade arc + pin to opacity 0 (hide after 300ms)
- Do **not** auto-reset zoom — leaves the user where they were.

---

## 10. State object

Lives in the card controller. Extends map-view state.

```js
storm_card = {
  open: false,
  storm_id: null,              // current storm
  storm: null,                 // full StormDetail bundle once fetched
  l2: 'idle' | 'loading' | 'ready' | 'error',
  l2Sort: 'size' | 'arrival',  // default 'size'
  selectedRegion: null,        // Arrival.region_id or null
  highlight: null,             // SpotArrival.id or null — draws highlight ring on L3 row
  mobile: boolean,             // derived from matchMedia('(max-width: 640px)')
  bulletinOpen: false,         // <details> state, persisted per-session
}
```

Every mutator ends by calling `render()`. URL sync (`history.replaceState`) on `open`/`close` and on `selectedRegion` change: `/map?storm={id}[&region={rid}]`.

---

## 11. Interactions & keyboard

### 11.1 Open the card
- **Storm marker click** on the map (marker must become `interactive: true`; update SPEC-map.md §7.3).
- **Direct URL hit:** `/map?storm={id}` on load — card auto-opens, fetches detail, scrolls to top.
- **From `/api/forecast-alerts`:** email/push link lands with the card pre-opened.

### 11.2 Close the card
- `.l1-close` button
- `Esc` key (global while card open)
- Click on map outside the card (bare map click handler)
- Clicking a different storm marker → card animates out and the new storm's card animates in

### 11.3 Select an L2 row
- Click anywhere on the row → sets `selectedRegion`, triggers map reactions (§9), renders L3.
- Click the already-selected row → clears `selectedRegion`, reverts map.

### 11.4 Select an L3 spot (set highlight)
- Click anywhere on the row that is **not** a CTA → sets `highlight` (visual only; does not navigate).
- Click a CTA → executes that CTA's action (§5.2e); does not change highlight.

### 11.5 Toggle bulletin
- `<details>` native open/close. Should not scroll-jump the card — use `scroll-margin-top: 0` on the element.

### 11.6 Keyboard

| Key | When | Action |
|---|---|---|
| `Esc` | Card open | Close card (revert map, clear selection) |
| `↑` / `↓` | Focus on L2 list | Move focus between L2 rows |
| `Enter` / `Space` | Focus on L2 row | Select row |
| `← Backspace` | Focus on L3 area | Collapse L3 (return focus to selected L2 row) |
| `Tab` | Global while card open | Cycle card elements before moving to map chrome |

**Focus trapping:** light-touch. Do NOT trap — the user must be able to Tab to map controls. But when card opens, focus moves to the close button; when card closes, focus returns to the storm marker.

---

## 12. Responsive behavior

### 12.1 Desktop (> 900px) — default
- Card pinned left: `left: 380px`, `top: 92px`, `bottom: 96px`, `width: 420px`
- Map occupies the rest. Region chips + left rail still visible.

### 12.2 Tablet (641–900px)
- Card drops to `left: 14px`, same vertical, `width: min(420px, calc(50vw - 28px))`
- Left rail hides (per SPEC-map.md §13); region chips scroll-wrap.

### 12.3 Mobile (≤640px)
- Card becomes bottom sheet: `left: 50%; transform: translateX(-50%); bottom: 90px; top: auto`, `width: min(380px, calc(100% - 24px))`, `max-height: 75vh`
- Radius changes to `18px 18px 10px 10px` (more aggressive top-rounding)
- Primary stats grid stays 3-column but cell padding drops to 12, value size to 18px
- Map reactions: fitBounds padding shifts to `[60, 60, 400, 60]` (bottom-heavy to clear the sheet)
- Keyboard open: card auto-reflows via `visualViewport` listener — keep the close button in view.

---

## 13. Theming (Ocean / Dawn / Daylight)

Prototype ships Ocean only. For Dawn / Daylight, swap:

| Token | Ocean | Dawn | Daylight |
|---|---|---|---|
| `--bg` | `oklch(0.13 0.02 230)` | `oklch(0.96 0.01 60)` | `oklch(0.98 0.008 90)` |
| `--fg` | `oklch(0.96 0.008 90)` | `oklch(0.22 0.03 235)` | `oklch(0.18 0.02 235)` |
| `--panel-strong` | `oklch(0.15 0.018 230 / 0.985)` | `oklch(0.98 0.012 80 / 0.97)` | `oklch(1 0 0 / 0.98)` |
| `--warn-gale` | gold | keep | keep |
| `--warn-storm` | coral | darker coral | darker coral |
| `--warn-hurricane` | red | deeper red | deeper red |

Ship comps in Ocean first. Dawn/Daylight are spot-checks — test that the pressure gauge gradient, fetch wedge translucency, and dim overlay all still read correctly on light backgrounds (the 22% wedge opacity likely needs a bump to 35% in light themes).

---

## 14. Accessibility checklist

- [ ] Card is `role="dialog"`, `aria-modal="false"` (map stays interactive), `aria-labelledby` pointing at the `.l1-title`.
- [ ] Close button `aria-label="Close storm card"`.
- [ ] L2 rows: `role="button"`, `aria-pressed` reflects `.on`, `aria-expanded` reflects whether L3 is open underneath.
- [ ] L3 CTAs: real `<a>` / `<button>` elements; no `<div role="button">`.
- [ ] Score bars: `aria-label="Score {score} of 5"` on the `.score` container.
- [ ] Freshness span: `<time datetime="{ISO}">` wrapping the visible text.
- [ ] Fetch wedge: SVG has `<title>` and `role="img"`, with descriptive label.
- [ ] Forecast track: SVG has `<title>` summary; the 3 `.track-row` cards are the screen-reader-accessible version.
- [ ] Bulletin: `<details>` / `<summary>` are native — screen-reader expand/collapse works by default.
- [ ] `prefers-reduced-motion`: disable card entry + L3 entry animations, dim transition, arc fade. Keep opacity changes instant.
- [ ] Tier colors on peak-size values: test `--coral` (firing) and `--gold` (solid) on `--panel-strong` for AA contrast. `--gold` is the edge case — verify ≥ 4.5:1 on 18px.
- [ ] Warning bar is decorative — must not be the only indicator of severity. The type badge + color is the semantic signal.

---

## 15. Known prototype stand-ins (ranked)

| # | Element | Prototype | Production |
|---|---|---|---|
| 1 | `STORM_A / HURR / WEAK` | Hardcoded 3 example storms | `/api/storms/{id}` — NOAA OPC bulletin parser + NHC GeoJSON. Refresh every 6h, or when bulletin timestamp changes. |
| 2 | `arrivals` | Embedded in storm fixture | `/api/storms/{id}/arrivals` — server-side computation per MAP_V2_DATA_GAPS.md. |
| 3 | `arrivals[].spots` | Embedded in fixture; Mainland Mexico has 5 of 12 | Lazy-fetch on L2-row-select: `/api/storms/{id}/arrivals/{region_id}/spots`. Page at 5 rows, expand via "See all". |
| 4 | Scores (1–5) | Arbitrary | Server-side: factors swell window alignment + wind alignment + tide state. Normalize per-spot so a "5" at beach break != "5" at heavy reef. |
| 5 | Time strings | Hardcoded `"Fri 5:00a"` | Produce from UTC ISO + user's timezone (L1, L2) and destination timezone (L3 only — clearer for trip planning). Format via `Intl.DateTimeFormat`. |
| 6 | Freshness | Static `issued_minutes_ago: 120` | Compute from `bulletin.issued_at`. Re-render freshness label every 60s while card is open. |
| 7 | `nhc_official` badge | Boolean hardcoded | `true` only for tropical systems with NHC AL/EP IDs and valid cone data. Extratropical lows never have this. |
| 8 | Pressure gauge range | `950–1020 mb` | Usable. Track whether any real storms fall outside (< 920 mb Cat-5, > 1020 mb weak lows) and extend if needed. |
| 9 | Fetch wedge quadrants | 12 known values | Full list may need more (`NNE quadrant`, `hemisphere` language). Add to the map in §6 or upstream-normalize. |
| 10 | "Ask Sione" chip | Button present, no route | Opens a Sione session scoped to the storm but not a spot. |
| 11 | "Plan trip with Sione" | Button present, no route | Full handoff per §8. |
| 12 | "Set alert" | Button present, no route | Opens Alerts form pre-filled. |
| 13 | "See all N spots" | Button shown once on Mainland Mexico row | Fetch remaining, re-render list; button collapses. |
| 14 | Track viz lat/lon box | Bezier with linear lat/lon projection | Use a proper great-circle polyline with 8–12 waypoints for tropical systems with NHC data. For extratropical lows, the 3-point polyline is acceptable. |
| 15 | Bulletin text | Hardcoded excerpts | Raw server-provided bulletin text. Must be pre-sanitized (HTML-escaped). |
| 16 | Region centroids | Not defined in prototype | Add `centroid: [lat, lon]` to each Arrival or derive from sub-region bbox. Required for §9.2–9.3. |
| 17 | Storm marker `interactive` | `false` in SPEC-map.md §7.3 | Must become `true` when this card ships; update map spec. |

---

## 16. Out of scope for this card

Things the storm card does **not** do (so Claude Code doesn't invent them):
- No inline chat UI — Sione handoff only. Conversations live in `/copilot`.
- No flight lookup / booking — future assistant capability, not baked into the card.
- No ensemble / cone-of-uncertainty overlay for extratropical lows — NHC cone for tropical systems is v1, extratropical ensembles are v2.
- No "draw custom area" or long-press-pin interaction — v2 map feature.
- No live buoy cross-reference — users can correlate via the map itself.
- No "share this storm" / social — future.
- No session logging from the storm card — that's on spot detail.

---

## 17. Preserve list (things to NOT change when reimplementing)

- **Three-level progressive disclosure in one scrolling container.** Do not split L2/L3 into a second panel. The mental model is "one card, one storm" — users shouldn't have to track two surfaces.
- **Only one L2 row selected at a time.** Avoids conflicting map reactions.
- **L3 is always sorted by `score`, L2 defaults to `size`.** This mirrors the user's question at each level: "which regions are biggest" → "within this region, which spots are BEST."
- **L3 default shows 5 rows** — not 3, not 10. 5 is the sweet spot for the comp density; adjust only with data.
- **Pressure gauge stays on the L1 pressure cell**, not as a separate row. Visual compactness matters.
- **Fetch wedge renders at L1** even when the card is in L1-only mode. It's the most important single visual for "which coast does this point at."
- **Forecast track waypoint cards** (§3.5) are kept even though the track is drawn on the map. The cards are the a11y + copy-paste version; the map is the spatial version.
- **Warning bar stays 3px.** It's a peripheral signal; larger competes with the type badge.
- **Storm marker on map keeps pulsing** after card opens. Do not freeze it.
- **Movement arrow is a real rotation** of the circle, not 8 pre-drawn arrow icons. Direction comes straight from `movement_dir` degrees.
- **Empty state wording** (§4.4) is specific — "isn't projected to deliver significant surf." Honest, not apologetic, tells the user why.

---

**Last updated:** 2026-04-22
