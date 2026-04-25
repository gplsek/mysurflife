# Spot Detail Page — Functional Specification

**Source:** `mysurflife-spot-detail.html`
**Audience:** Claude Code / implementation engineers
**Purpose:** Every visible element, its data binding, interactive behavior, and wiring requirement. If it's on the page, it's in this doc.

This spec is the contract. If a behavior in the prototype is not listed here, ask before dropping it; if something here is not in the prototype, it's an intentional production addition and must be built.

---

## 0. Page-level

| Property | Value |
|---|---|
| Route | `/spots/:spotId` (or `?id=<spotId>` on prototype page) |
| Title (`<title>`) | `{spot.name} · mysurflife` |
| Theme | Dark, `data-theme="ocean"` |
| Fonts | Geist (300–700), Geist Mono (300–600), Instrument Serif (italic) |
| Max content width | 1280px |
| Breakpoints | `≤1000px` (tablet), `≤640px` (mobile) |

### Data loaded on mount

The page must fetch a **spot bundle** for `spotId`:

```ts
type SpotBundle = {
  spot: {
    id: string;
    name: string;           // "Seaside Reef"
    region: string;         // "Seaside · Cardiff, CA"
    lat: number;
    lon: number;
    breakType: string;      // "Reef · right + left peaks"
    bestSwellDir: string;   // "270–300° WNW"
    bestTide: string;       // "Mid rising"
    hazards: string;        // "Rocks on inside, localism"
    favorited: boolean;
    waterTempF: number;
    wetsuitRec: string;     // "3/2 wetsuit"
  };
  forecast: ForecastHour[]; // 168+ hourly points, see §6
  storms: Storm[];          // referenced in AI insight
  userHistory?: {           // optional, for AI personalization
    sessions: { date: string; rating: number; spotId: string }[];
  };
};
```

Page must handle loading, empty, and error states. If `spotId` is missing or invalid, render a 404-style card linking back to the map.

---

## 1. Map hero (`<section class="map-hero">`)

Full-width banner, `62vh` (min 520px). Desktop; `52vh` (min 420px) on tablet.

### 1.1 Base layers (bottom → top)

| # | Element | What it is | Production requirement |
|---|---|---|---|
| 1 | `.map-img` | Stylized CSS coastline **placeholder** | **REPLACE** with real satellite tile centered on `spot.lat`/`spot.lon` (see CLAUDE.md). `.map-img` div must remain as a single `<img>` or map canvas positioned `inset:0`. |
| 2 | `<svg class="map-detail">` | Decorative SVG coastline/streets | **REMOVE** in production once the real tile is in. |
| 3 | `.map-grid` | Faint crosshatch grid (decorative) | Optional — keep if satellite reads busy, drop otherwise. |
| 4 | `.map-vignette` | Inner shadow darkening edges | **KEEP** — gives focus to the compass. |
| 5 | `.map-dim` | Bottom-to-top dark gradient | **KEEP** — blends map into the dark content panel below. |

**Tile requirements (critical):** satellite/aerial, north-up, zoom ~15–16 for reef/point breaks, ~14 for beach breaks, `@2x`/`scale=2` for retina, `spot.lat`/`spot.lon` centered (the compass is absolutely centered on `.map-hero`, so the tile must also be centered).

**Attribution:** small 10–11px line bottom-right of `.map-hero`, muted color, per provider terms.

### 1.2 Top chrome (`<nav class="topbar">`)

Absolute, z-index 30. Horizontal row with `pointer-events: none` on the nav and `auto` on children.

| Element | Text / Icon | Behavior |
|---|---|---|
| `.chip.ghost` Back | `← Back to Map` | Navigates to `/map` (or `mysurflife-map.html`). Left-arrow glyph translates `-3px` on hover via `.arr`. |
| `.brand` | mark SVG + `mysurflife` | Links to home. Mark uses `--fire` + `--mark-dot: var(--aqua)`. |
| `.chip.edit.star` Edit | pencil icon + `Edit` | Margin-left: auto pushes it right. Opens an edit panel for user notes on the spot (session tags, custom break markers). *(Prototype: no-op)* |
| `.chip` Favorite | 🔥 emoji | Toggle `spot.favorited`. Should swap visual state (fill vs. outline). *(Prototype: no-op)* |

### 1.3 Spot title (`.spot-title`)

Absolutely positioned at `top: 12%`, horizontally centered. Two stacked lines:
- **`.tag`** — Geist Mono 10px, uppercase, letter-spacing 0.14em, color `--aqua` → `{spot.region.toUpperCase()}`
- **Main** — 26px, weight 700, letter-spacing `-0.02em`, drop-shadow `0 2px 12px black/60` → `{spot.name}`

### 1.4 Radial compass (`.compass-wrap` / `#compass`)

Absolute, grid-centered in the map hero. 520px × 520px desktop, 360px × 360px on ≤1000px.

Single SVG with `viewBox="-260 -260 520 520"` (origin at center).

**Static elements (do not data-bind):**
- Three concentric rings: r=240 (outer), r=175 (mid), r=110 (inner), strokes at `white/12%`, `white/18%`, `white/22%`.
- Cardinal labels N/E/S/W in Geist Mono 11px at r≈246.
- Cardinal tick marks (4 short radial lines).
- Center icon: dark disc (r=30) with `--aqua` halo (r=22) and a lightning `bolt` SVG filled `--fire`.

**Dynamic arrow groups (rotated every tick of the slider):**

Each arrow is a `<g>` rotated by its `FROM` bearing minus 180° so its arrowhead points toward center. A translate places the group on a specific ring; inside it, the arrowhead + a rounded rect label pinned just outside.

| ID | Ring radius | Binds to forecast hour | Fill | Label |
|---|---|---|---|---|
| `#windArrow` | 240 (outermost) | `d.windDir` / `d.wind` | `--wind` | `{wind} mph` |
| `#swell1` | 175 | `d.d1` / `d.s1` / `d.period1` | `--s1` | `{s1}ft · {period}s` |
| `#swell2` | 175 | `d.d2` / `d.s2` | `--s2` | `{s2}ft · 12s` |
| `#swell3` | 110 (innermost) | `d.d3` / `d.s3` | `--s3` | `{s3}ft · 9s` |

**Rotation rule:** `transform="rotate({direction - 180})"` for groups whose children sit at `translate(0 -r)`. Direction is **FROM** (meteorological). If your feed uses "TO," invert with `+ 180`.

**Rendering rules:**
- Show 1–3 swell arrows. **Hide** an arrow entirely if its component height < 0.3 ft or the component is missing (don't render a zero-length stub).
- Wind arrow is always shown (even at 0 mph).
- All labels must update their numeric text on slider change — currently the SVG `<text>` for labels is **static** in the prototype. In production, bind these: `#windArrow text`, `#swell1 text`, `#swell2 text`, `#swell3 text`.

---

## 2. Content area (`<main class="content">`)

Position `relative`, z-index 5, `margin-top: -80px` to overlap the map-dim fade. Max-width 1280px, horizontal padding 22px.

Each card: `.card` → `bg-2` fill, 1px `--border`, 16px radius, 22–24px padding, drop-shadow `0 18px 50px black/40`. Cards are stacked 18px apart.

---

## 3. Forecast Timeline card (`.card.timeline-card`)

### 3.1 Header row (`.timeline-head`)

Flex, space-between, 16px gap. Left block:
- **Card title** — "Forecast Timeline"
- **Subtitle** — 12px, muted: `Scrub through the next 7 days · 168h` (the `168h` span is Geist Mono).

Right block: **Day picker** (§3.2).

### 3.2 Day picker (`.day-picker`)

A dropdown that replaces the old static pill.

**Button (`.pill-btn` / `#pillBtn`)** — pill-shaped, aqua background, dark text, box-shadow `0 4px 14px aqua/28%`. Contents:
- Clock SVG (13px, stroke 2)
- `#pillText` span: `{dayLabel} · {ahead} · {timeOnly}`, e.g. `Today · +6hrs · 02:11 PM`
- Chevron SVG — rotates 180° when `aria-expanded="true"` via `.pill-btn[aria-expanded="true"] .chev { transform: rotate(180deg); }`

**Menu (`.day-menu` / `#dayMenu`)**
- Absolute, `top: calc(100% + 8px)`, right-aligned, min-width 260px
- `bg-2` background, 1px `--border-2`, 12px radius, 6px padding, z-index 50
- **Enter**: `opacity 0 → 1`, `translateY(-6px) scale(0.98) → none`, 150ms ease
- **ARIA**: `role="listbox"`, `aria-hidden` mirrors open state; button has `aria-haspopup="listbox"` and `aria-expanded`

**Day options (`.day-opt`)** — 7 rows, one per day (days 0–6 from `startDate`).

Row grid: `auto 1fr auto` — `.dow`, `.label`, `.rating`.

| Column | Content | Style |
|---|---|---|
| `.dow` | 3-letter weekday (`SUN`/`MON`/…) | Geist Mono 10px, uppercase, muted; **aqua when row is selected** |
| `.label` | `Today` / `Tomorrow` / weekday-name + `.date` (e.g. `Apr 24`) | Weight 500; `.date` is Geist Mono 11px, muted |
| `.rating` | 5 rounded squares (`.sq`, 8×12px) filled with `--s1` up to `r`, empty slots `white/8%` | Derived from `dayRating(i)` in prototype; **replace with real per-day rating from provider or your scoring** |

**Row states:**
- default: transparent
- `:hover`: background `--bg-3`
- `.on` (selected): background `aqua/12%` + `.dow` turns aqua

**Interactions:**
- Click button → toggles menu (`.open` class)
- Click outside `.day-picker` → close
- **Click a day option:**
    1. Compute `hourInDay = range.value % 24`
    2. Set `range.value = min(168, day * 24 + hourInDay)` — snap to same hour-of-day on selected day
    3. Update `currentDay = day`
    4. Close menu
    5. Call `update()` (recomputes everything)
- **Keyboard (required in production, not in prototype):** Enter/Space on button opens; ↑/↓ within menu moves focus; Enter selects; Esc closes + returns focus to button.

### 3.3 Slider (`.slider`)

**Track row (`.track-row`)** — 12px tall, relative.
- `.track`: absolute `inset: 4px 0`, 4px border-radius, gradient left→right `good → aqua → gold → fire` at `0% / 40% / 70% / 100%`, 85% opacity. This gradient is **aesthetic**, not data-driven.
- `input[type=range]`: absolute inset 0, width/height 100%, transparent. Covers the track as the hit target.

**Range input (`#tRange`):**
- `min=0`, `max=168`, `step=1`, `value=6` (initial)
- Thumb: 22×22 circle, `bg-2` fill, 3px aqua border, glow ring `box-shadow: 0 0 0 4px aqua/18%, 0 2px 8px black/40%`
- Firefox (`::-moz-range-thumb`): matches, minus the outer black shadow

**Ticks (`.ticks`)** — 8 spans, space-between, Geist Mono 10px, muted uppercase.
Labels: `Now`, `24h`, `48h`, `72h`, `96h`, `120h`, `144h`, `168h`.
`#tick0` re-labels to `Now` on every update (reserved for future "live time" label if you want to change it).
`.ticks span.current` exists in CSS (aqua) but is **not yet wired** — production should add `.current` to the tick nearest `range.value` bucket for a subtle highlight.

**Slider events:**
- `input` fires every drag pixel → `update()` runs immediately
- Keyboard: ← → step 1; PgUp/PgDn step 10 (browser default); Home/End snap 0/168 (browser default) — do not override.

### 3.4 Mini strip chart (in same card, below slider)

A 46px-tall SVG showing 7-day primary-swell height.

Grid: 90px label `7-DAY WAVE` (Geist Mono 10px muted uppercase) + SVG `#miniStrip`.

SVG viewBox `0 0 700 46`, rendered by `buildMiniStrip()`:
- 8 vertical gridlines (day dividers at x = `(d * 24 / 168) * 700`, `white/8%`)
- Filled area path under the line, fill `aqua/18%`
- Line path in `--s1`, stroke 1.6
- `#miniCursor`: vertical dashed gold line at `x = (t / 168) * 700`, updates on every slider change

Scale: `max = max(s1 + s2 * 0.4)` across all 168 hours, padded 2px top and bottom. **In production, use real primary-swell height**; drop the `+ s2*0.4` (that was a visual fudge).

### 3.5 Legend row (`.legend-row`)

4 entries, Geist Mono 10px uppercase muted, each preceded by an 8×8 colored dot.

- `[--s1] NW 290° primary`
- `[--s2] S 185° secondary`
- `[--s3] SW 220° wind swell`
- `[--wind] Wind (from dir)`

Currently **static** — in production, replace directions with the *current* dominant bearing of each component (rounded to 5°) or with a static convention if your product treats swell slots as fixed.

---

## 4. Forecast Conditions card

### 4.1 Header

Flex row, align-end, space-between.

Left:
- **Title** — `Forecast Conditions (<span id="condWhen">+6hrs</span>)`
- **Subtitle** — `<span id="condDate">Apr 22, 02:11 PM</span> · Category 3 · shoulder-to-head`
    - `condWhen` updates to `Now` at t=0, else `+{t}hrs`
    - `condDate` updates to `fmtTime(t)` (e.g. `Apr 22, 02:11 PM`)
    - `Category 3 · shoulder-to-head` is currently **static** — in production, derive from Surfline category (0–5) or compute from wave face + break character.

Right: **Tabs** (`.tabs`) — 4 buttons `Wave / Wind / Tide / All`, Geist Mono 12px uppercase letter-spacing 0.1em. `.on` gets `bg-2` background and soft shadow. **Prototype: not wired.** In production the tabs filter the 6-cell grid below (or swap which strip chart is emphasized) — define the filter map or remove the tabs.

### 4.2 Conditions grid (`.cond-grid`)

6 columns desktop, 3 at ≤1000px, 2 at ≤640px. Each cell `.cond`: bg-3, 1px border, 12px radius, 14px padding.

Cell structure: `.k` (key label, Geist Mono 10px muted uppercase) + `.v` (value 22px bold `tabular-nums` + `.u` unit 11px muted) + `.s` (context 11px `--fg-2`).

| Cell | Value span id | Value source | Unit | Context line |
|---|---|---|---|---|
| Wave face | `#mFace` | `d.s1.toFixed(1)` | `ft` | `Cat 3 · chest-to-shoulder` *(static — derive in prod)* |
| Dom. period | `#mPer` | `round(d.period1)` | `s` | `Groundswell` *(static — derive: period > 12s → "Groundswell", else "Windswell")* |
| Primary dir | `#mDir` | `round(d.d1)` | `°` | `WNW` *(static — derive compass segment from bearing)* |
| Wind | `#mWind` | `round(d.wind)` | `mph` | `Light E · offshore` *(static — derive magnitude + onshore/offshore relative to coastline orientation)* |
| Tide | `#mTide` | `d.tide.toFixed(1)` | `ft ↑` | `Rising · mid` *(static — compare `d.tide` to `d[t-1].tide` for direction; low/mid/high from range)* |
| Water | (static `61`) | **not wired in prototype** | `°F` | `3/2 wetsuit` — pull `spot.waterTempF` + `spot.wetsuitRec`. |

**Every `.s` context line currently hard-coded** must be computed in production. Don't ship static strings.

### 4.3 Break facts (`.facts`)

4-column grid desktop, 2 at ≤640px. Each `.fact`: bg-3, 1px border, 10px radius, 12×14 padding. `.k` label + `.v` value.

| Label | Value | Source |
|---|---|---|
| Break type | `Reef · right + left peaks` | `spot.breakType` |
| Best direction | `270–300° WNW` | `spot.bestSwellDir` |
| Best tide | `Mid rising` | `spot.bestTide` |
| Hazards | `Rocks on inside, localism` | `spot.hazards` |

---

## 5. Two-column row (`.cols-2`)

Grid `1.3fr 1fr` desktop, single column at ≤1000px, 18px gap.

### 5.1 Swells-in-the-water card (left)

**Title line:** `Swells in the water` + mono badge `3 detected` (11px muted uppercase, letter-spacing 0.14em). Production: badge reflects the active-swell count (1–3).

**Description paragraph:** `.fg-2` 13px line-height 1.55: explains the compass link. Keep as-is.

**Swell rows (`.swell-rows` → `.swell-row` ×N)**

Grid `24px 1fr auto auto auto auto`, 14px gap, 12×14 padding, bg-3.

| Column | Content | Notes |
|---|---|---|
| Swatch | `.swatch` 16×16 rounded 4px, bg is `--s1`/`--s2`/`--s3` | 3px black outer shadow |
| Name | `.name` (weight 600, 14px) + `.sub` on line 2 (Geist Mono 11px muted, letter-spacing 0.08em) | `.sub` example: `290° · LOW-442 · 1,240nm` → `{dir}° · {stormId} · {distanceFromSpot}nm` |
| Met: SIZE | `.met` with `.lbl` SIZE + value `{h}ft` | Geist Mono 12px, right-aligned, 72px min-width |
| Met: PERIOD | `{p} s` |  |
| Met: DIR | compass segment (`WNW`, `S`, `SW`) |  |
| Met: CAT | category 0–5 |  |

Rows must be generated from the active-hour `d`, not hard-coded. Hide rows for components with height < 0.3 ft. If no components meet the threshold (flat day), show an empty state row: "No rideable swell at this time."

### 5.2 AI insight callout (`.ai-note`)

Inside the same card (left column), margin-top 18px.

Layout: flex, 14px gap. 16×18 padding, 12px radius. Gradient background aqua → fire at low opacity. 1px aqua/25% border.

- **`.ai-dot`** — 10px aqua dot with glow, `pulseDot` 2.4s ease-in-out infinite (opacity 1 ↔ 0.5 + shadow shifts 10px ↔ 18px).
- **`.eyebrow`** — Geist Mono 10px uppercase aqua: `AI Insight · Confidence {0–100}%`
- **`<h3>`** — 15px weight 600, letter-spacing `-0.01em`: one-sentence headline
- **`<p>`** — 13px `--fg-2`, line-height 1.55: 1–2 sentences with `<em>` (Instrument Serif italic) for emphasis

**Production wiring:**
- Headline + body come from your AI backend (same one powering the Copilot page).
- Confidence is model-reported; if absent, hide the `· Confidence N%` suffix.
- Reference real past sessions from `userHistory.sessions`, filtered to this spot, highest-rated. If no history, swap to a generic explanatory paragraph.
- Storm ID (`LOW-442`) must link out to the storm detail view (or a tooltip with pressure/winds).

### 5.3 Strip-chart card (right column)

**Title:** `Wave + Wind + Tide · 7-day strip`
**Description:** `Unified view. Yellow dashed line marks the time you've selected on the slider.`

**`.strip-rows`** — 3 rows, each `.strip` = `100px 1fr` grid (label + SVG).

| Label | Color var | SVG id | Data key | Fill opacity |
|---|---|---|---|---|
| Wave | `--s1` | `#stripWave` | `s1` | 0.20 |
| Wind | `--wind` | `#stripWind` | `wind` | 0.18 |
| Tide | `--aqua` | `#stripTide` | `tide` | 0.14 |

Each chart:
- viewBox `0 0 700 34`, preserveAspectRatio=none, width 100%, height 34px
- y-axis: normalize `(val - min)/(max - min)`, pad 3px top+bottom
- 8 vertical gridlines (day dividers, `white/7%`, stroke 0.8)
- Filled area under the line (fill = color, opacity above)
- Line: stroke 1.5, color
- `.cursor`: dashed gold vertical line at `x = (t/168) * 700`

**Day legend below** — 7 labels `Sun Mon Tue Wed Thu Fri Sat`, `space-between`. Currently **static** — in production, compute actual weekday labels starting from `startDate.getDay()`.

---

## 6. Data model: `ForecastHour`

Each entry in `data[]` (prototype has 169 entries, index 0..168).

```ts
type ForecastHour = {
  t: number;           // hour offset from startDate, 0..168+
  s1: number;          // primary swell height (ft)
  s2: number;          // secondary swell height (ft)
  s3: number;          // tertiary / wind swell height (ft)
  d1: number;          // primary FROM direction (deg, 0–360)
  d2: number;          // secondary FROM direction
  d3: number;          // tertiary FROM direction
  period1: number;     // primary dominant period (s)
  // Production should also include period2, period3
  wind: number;        // wind speed (mph)
  windDir: number;     // wind FROM direction (deg)
  tide: number;        // tide height (ft)
  // Production additions:
  // gust: number;
  // waterTempF: number;   // if it changes hour-to-hour
  // category: 0|1|2|3|4|5;
};
```

**Prototype `startDate`:** `new Date('2026-04-22T08:11:00')` — replace with `now()` rounded to nearest hour on page load.

**Helpers in prototype:**
- `fmtTime(hourOffset)` → `"Apr 22, 02:11 PM"` — replace with i18n/locale-aware formatter.
- `dayRating(dayIdx)` → 1..5 integer. Replace with real provider rating.
- `ratingSquares(r)` → 5 HTML spans. Keep, but cap `r` at 5.

---

## 7. `update()` — the single source of truth

Called on: initial page load; every `range` `input` event; every day-option click.

Responsibilities **in order**:

1. Parse `t = parseInt(range.value, 10)` and grab `d = data[t]`
2. Derive `currentDay = Math.floor(t / 24)`
3. Compute `dateStr`, `timeOnly`, `dayLabel`, `ahead` strings
4. Update `#pillText` → `{dayLabel} · {ahead} · {timeOnly}`
5. Update `#condWhen` → `"Now"` or `"+{t}hrs"`
6. Update `#condDate` → `dateStr`
7. Update `#tick0` → `"Now"` (reserved — see §3.3 note on `.current`)
8. **Re-render the day menu** (rating squares may change; `.on` must move)
9. Update 6 conditions cells (`#mFace`, `#mPer`, `#mDir`, `#mWind`, `#mTide`; water is static)
10. Rotate 4 compass groups via `transform="rotate({dir - 180})"` — and in production, also update their label `<text>` contents
11. Update cursor `x` on 3 strip charts (`.strip-chart .cursor`) and on `#miniCursor`
12. *(production additions)* derive context strings for each conditions cell (§4.2), update legend row (§3.5), update the "Category 3 · shoulder-to-head" subtitle, update swell-row contents and visibility (§5.1), re-score and re-render the AI insight if the selected hour materially changes the best-window narrative.

---

## 8. Accessibility checklist

- [ ] All buttons have accessible labels (Edit/Favorite chips need `aria-label`).
- [ ] Range input: add `aria-label="Forecast time offset in hours"` and announce `aria-valuetext` as the human time string (e.g. "Saturday, April 24, 10:00 AM").
- [ ] Day menu: arrow-key navigation, Esc to close, focus trap while open, restore focus on close.
- [ ] Compass SVG: `aria-label="Swell and wind direction compass"` is present. Add `<title>` children on each arrow group with its component's current values so screen readers can inspect them.
- [ ] Color contrast: `--fg-2` on `--bg-2` must pass AA (verify in QA).
- [ ] `prefers-reduced-motion`: disable `pulseDot` and chevron/day-menu transitions.
- [ ] Tab order: Back → Brand → Edit → Favorite → Day picker → Slider → Tabs → (anything interactive below).

---

## 9. Responsive behavior

**≤1000px:**
- `.cond-grid` → 3 columns
- `.cols-2` → single column (swells stack above strip charts)
- Compass → 360×360
- Map hero → 52vh min 420px

**≤640px:**
- `.cond-grid` → 2 columns
- `.facts` → 2 columns
- Day menu: constrain right offset so it stays within viewport
- Top chip labels may shorten ("Back", brand shrinks to mark only) — **not in prototype**, add in production

---

## 10. Known prototype stand-ins (recap — full list here, not elsewhere)

Ranked by severity.

| # | Element | Prototype | Production |
|---|---|---|---|
| 1 | Map tile | CSS/SVG coastline | Real satellite tile (Mapbox / Google / ESRI) centered on spot lat/lon |
| 2 | Forecast data | Synthetic sinusoids in `data[]` | Real provider (Surfline / Stormglass / NOAA / Open-Meteo) |
| 3 | Compass label text | Static `<text>` nodes | Bind to forecast hour |
| 4 | Conditions context strings (`.s`) | Hard-coded English | Derived from numeric values |
| 5 | Subtitle `Category 3 · shoulder-to-head` | Static | Derived from wave face / category |
| 6 | Water temp + wetsuit cell | Hard-coded `61°F / 3/2` | `spot.waterTempF`, `spot.wetsuitRec` |
| 7 | Day rating squares | `dayRating()` from mock `s1` avg | Provider rating or your scoring |
| 8 | Swell row sub-line (`LOW-442 · 1,240nm`) | Static | Storm ID + computed great-circle distance |
| 9 | Tabs (Wave/Wind/Tide/All) | Not wired | Filter conditions grid or strip charts |
| 10 | AI insight | Static copy | Your AI backend + session history |
| 11 | Day legend below strip charts | Static Sun–Sat | Computed from `startDate.getDay()` |
| 12 | Edit / Favorite chips | No-op | Wire to user notes + favorites |
| 13 | `.slider .ticks span.current` | CSS defined, not applied | Highlight nearest tick |
| 14 | Keyboard nav on day menu | Not implemented | Arrow keys + Esc |

---

## 11. Out of scope for this page

Things the spot detail page does **not** do (so Claude Code doesn't invent them):
- No commenting / social feed
- No session logging (lives on a separate page)
- No webcam embed (could be a future addition; if added, place it below `.facts`, full-width, 16:9)
- No purchase / lesson booking flow
