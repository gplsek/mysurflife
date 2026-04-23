# Spot Detail V2 — Scoping & Implementation Plan
**Status:** 🚧 Planning → Ready for Claude Code
**Source design:** `ClaudeDesign/project/mysurflife-spot-detail.html` (848 lines)
**Current implementation:** `frontend/src/SpotDetail.js` (1,438 lines, monolithic)
**Author:** Claude Desktop · 2026-04-22
**Supersedes:** `SPOT_DETAIL_V1.md`

---

## 1. Executive summary

The new design is a dark, OKLCH-themed spot detail page with a radial compass overlaid on a map hero, a day-picker + 168h timeline scrubber, a 6-cell conditions grid, multi-swell breakdown rows, stacked wave/wind/tide strip charts, and break facts. It's a significant visual and informational upgrade over the current page — the main gains are the **decomposed swell view**, the **radial compass that rotates as you scrub time**, and the **unified 7-day strip chart** that lets a user see the full story in one glance.

The critical architectural win is that **~half of the new components are also the right shape for Sione artifacts**. If we build a `components/spot/` primitives folder that both `SpotDetail` and `Sione.jsx` import from, we get one canonical render for Compass, SwellBreakdown, ConditionsGrid, and StripChartStack — plus visual consistency between the spot page and Sione's artifacts, which is a real product value, not just DRY.

**Update 2026-04-22 — AI analysis is back in the plan.** The previous version of this doc dropped AI-driven spot analysis. That decision is reversed: the spot page will include a Sione-powered inline card (`<SioneReadCard>`) that calls `POST /api/sione/analyze` in Geometry Analyst mode. The existing `SpotSwellGeometryAnalyst` persona prompt migrates verbatim into Sione's mode library (no rewrite — it's well-tuned). Output is cached 30 days in `sione_analyses`, so steady-state cost is ~1 LLM call per spot per month. The Session Insight card still exists for signed-in users as a separate card below SioneReadCard — the two complement each other (Sione reads the geometry; Session Insight reads the user's logs). Full spec: `notes/SIONE_CAPABILITIES.md`.

**Scope:** 6 phases, ~2-3 weeks of focused work. Phase 1 and 2 are prerequisites; 3-5 are the visible build; 6 is polish.

---

## 2. The design — feature inventory

Every feature in `mysurflife-spot-detail.html`, numbered for cross-reference in the gap table below.

**Map hero (62vh, min 520px)**
1. Floating top bar (Back, Brand logo, Edit, Favorite) — backdrop-blur pills
2. Spot title + eyebrow tag (`SEASIDE · CARDIFF, CA`)
3. Stylized dark map backdrop with CSS-drawn coastline, bathymetry contours, freeway, streets
4. Grid pattern + vignette + bottom dim gradient
5. **Radial compass** (520px, centered) — 3 concentric rings with cardinal markers
6. **Up to 3 swell arrows** on compass, each with pill label (`4.2ft · 15s`), rotating to the FROM direction
7. **Wind arrow** on outer ring with pill label
8. Spot center icon (bolt, fire color)

**Forecast Timeline card**
9. Card title + "Scrub through the next 7 days · 168h"
10. **Day picker pill dropdown** — shows currently-selected day + time, expands to 7-day list with daily ratings (5 squares, filled by primary swell avg)
11. **Timeline slider** 0–168h with gradient track (good → gold → fire), 8 tick labels (Now, 24h…168h)
12. **Mini wave strip chart** under the slider — SVG area+line with day gridlines and cursor
13. Legend row (3 swells + wind)

**Forecast Conditions card**
14. Tabs: Wave / Wind / Tide / All
15. **6-cell conditions grid**: Wave face, Dom. period, Primary dir, Wind, Tide, Water temp — each with label, large number + unit, subtitle
16. **Break facts row** (4 cells): Break type, Best direction, Best tide, Hazards

**Swells in the water card**
17. Header with "3 detected" badge
18. **3 swell breakdown rows**: color swatch + name + source info + Size + Period + Dir + Cat
19. **AI Insight callout** — pulsing dot, eyebrow "AI Insight · Confidence 82%", short narrative *(we're replacing this with Session Insight)*

**7-day strip chart card**
20. 3 stacked SVG strip charts: Wave (s1 color), Wind (wind color), Tide (aqua)
21. Each strip has day gridlines + cursor dashed line synced to the timeline slider
22. Day-of-week legend row (Sun…Sat)

**Behavior**
23. Scrubbing the timeline updates: pill text, conditions grid numbers, compass arrow rotations, all strip chart cursors — in one `update()` call
24. Day picker snaps the slider to the same hour on the selected day
25. Click outside the day menu closes it

---

## 3. Gap analysis — design vs. current code

Grouped by card. ✅ = exists and reusable · ⚠️ = exists but needs refactor · ❌ = missing · 🔄 = exists in wrong place

| # | Feature | Status | Current location | Action |
|---|---|---|---|---|
| 1 | Top bar floating pills | ⚠️ | `SpotDetail.js` has Back button + edit mode, no blur-pill styling | Restyle with new tokens |
| 2 | Spot title + eyebrow | ⚠️ | Plain text title exists | Add eyebrow, restyle |
| 3 | Stylized map backdrop | 🔄 | Live Leaflet map in hero | **Keep Leaflet**, add dark vignette/grid/dim overlay on top |
| 4 | Map grid + vignette | ❌ | — | Build as CSS overlay pane |
| 5 | Radial compass rings | ⚠️ | `SpotDetail.js:687-811` has 2-ring CSS-div compass | **Rewrite as SVG component** `<Compass>`, 3 rings |
| 6 | Multi-swell arrows on compass | ❌ | Current shows 1 aggregate swell arrow | Compose from decomposed swell data |
| 7 | Wind arrow on outer ring | ⚠️ | Single wind arrow exists, different geometry | Rewrite in new Compass |
| 8 | Spot center icon | ❌ | — | Add to Compass |
| 9 | Timeline card header | ⚠️ | Header exists, different copy | Update |
| 10 | Day picker dropdown | ❌ | — | Build `<DayPicker>` |
| 11 | 168h slider with gradient | ⚠️ | Basic 0-48 `<input type=range>` | Upgrade to 0-168, styled track, styled thumb |
| 12 | Mini wave strip chart | ❌ | — | Build `<StripChart>` (shared, see §4) |
| 13 | Legend row | ⚠️ | Some legend exists | Restyle |
| 14 | Conditions tabs | ❌ | — | Build `<ConditionsTabs>` |
| 15 | 6-cell conditions grid | ⚠️ | Inline cards `SpotDetail.js:870-1010` | Extract to `<ConditionsGrid>` (shared) |
| 16 | Break facts row | ⚠️ | `info-grid` section at 1012-1187, wrong shape | Extract + restyle to `<BreakFacts>` |
| 17 | Swells header badge | ❌ | — | Part of `<SwellBreakdown>` |
| 18 | 3 swell breakdown rows | ❌ | Not decomposed anywhere | Build `<SwellBreakdown>` + `<SwellRow>` (shared) |
| 19 | AI Insight callout | ❌ | Not in SpotDetail | **Replace with `<SessionInsightCard>`** (reads `user_spot_profiles`) |
| 20 | Stacked strip charts | 🔄 | `SpotDetailPanel.jsx:38-68` has bar-chart version, wrong page | Build `<StripChartStack>` (shared) |
| 21 | Synced strip cursor | ❌ | — | Part of `<StripChartStack>` |
| 22 | Day-of-week legend | ❌ | — | Trivial |
| 23 | Scrub → everything updates | ⚠️ | Exists for current compass + a few cards | Reconnect to new components via shared `selectedHour` state |
| 24 | Day picker snap-to-hour | ❌ | — | Part of `<DayPicker>` logic |
| 25 | Click-outside closes menu | ❌ | — | Part of `<DayPicker>` |

**Things we have today that the mockup drops** (worth keeping):
- Admin edit mode (keep — gate behind edit chip in top bar)
- Buoy sources display (merge into break facts or put in a collapsed "Data sources" footer)
- Favorite toggle in top bar (star chip) — schema exists (`user_favorites`), no UI yet
- The current spot scoring breakdown (swell_direction_score, swell_size_score, etc.) — keep accessible but not in the main grid; put in an expandable "Why this score" panel

---

## 4. Architectural decision — `components/spot/` shared primitives

**The key call.** The 1,438-line monolithic `SpotDetail.js` is decomposed into reusable primitives, and `Copilot.jsx` imports the same primitives for its artifacts. This is what "reusable in Copilot" means in practice.

### 4.1. File layout

```
frontend/src/
├── components/
│   └── spot/                          ← new folder, lives here
│       ├── Compass.jsx                ← SVG radial, takes swells[] + wind
│       ├── Compass.css
│       ├── SwellBreakdown.jsx         ← container for SwellRows
│       ├── SwellRow.jsx               ← single row
│       ├── SwellBreakdown.css
│       ├── ConditionsGrid.jsx         ← 6-cell grid
│       ├── ConditionsGrid.css
│       ├── StripChart.jsx             ← single SVG sparkline with cursor
│       ├── StripChartStack.jsx        ← wave/wind/tide stacked, shared cursor
│       ├── StripChart.css
│       ├── DayPicker.jsx              ← pill dropdown with 7-day list
│       ├── DayPicker.css
│       ├── ForecastScrubber.jsx       ← 0-168h slider + ticks + mini chart
│       ├── ForecastScrubber.css
│       ├── SpotTitle.jsx              ← eyebrow + name
│       ├── BreakFacts.jsx             ← 4-cell facts row
│       ├── SessionInsightCard.jsx     ← reads user_spot_profiles
│       └── index.js                   ← barrel export
├── screens/
│   └── Copilot.jsx                    ← imports from components/spot/
└── SpotDetail.js                      ← refactored to import from components/spot/
```

### 4.2. Primitive catalog — contracts

Every shared component gets a stable prop contract documented in a JSDoc comment at the top of the file. These are the contracts:

**`<Compass>`** — SVG radial, accepts swells + wind, rotates per data
```js
<Compass
  swells={[
    { height_ft: 4.2, period_s: 15, direction_deg: 290, color: 'var(--s1)', ring: 'mid' },
    { height_ft: 2.1, period_s: 12, direction_deg: 185, color: 'var(--s2)', ring: 'mid' },
    { height_ft: 1.4, period_s:  9, direction_deg: 220, color: 'var(--s3)', ring: 'inner' },
  ]}
  wind={{ speed_mph: 6, direction_deg: 90, color: 'var(--wind)' }}
  size={520}                 // or "mini" for a Copilot artifact variant
  spotName="Seaside Reef"    // optional, shown in center if variant=="titled"
  variant="default"          // "default" | "mini" | "titled"
/>
```

**`<SwellBreakdown>`** — container + `<SwellRow>` child
```js
<SwellBreakdown
  swells={[
    { color: 'var(--s1)', name: 'NW groundswell', source_label: '290° · LOW-442 · 1,240nm',
      size_ft: 4.2, period_s: 15, direction_label: 'WNW', category: 3 },
    ...
  ]}
  detectedCount={3}
  compact={false}            // true in Copilot artifact
/>
```

**`<ConditionsGrid>`** — 6-cell grid, accepts a conditions snapshot
```js
<ConditionsGrid
  conditions={{
    wave_face_ft: 4.2, category: 3, category_label: 'chest-to-shoulder',
    period_s: 15, period_label: 'Groundswell',
    primary_dir_deg: 290, primary_dir_label: 'WNW',
    wind_mph: 6, wind_label: 'Light E · offshore',
    tide_ft: 2.1, tide_trend: 'rising', tide_position: 'mid',
    water_temp_f: 61, wetsuit: '3/2'
  }}
  showTabs={true}            // false in Copilot artifact
/>
```

**`<StripChart>`** — single sparkline
```js
<StripChart
  data={forecastPoints}      // [{ t: 0..168, value: 4.2 }, ...]
  valueKey="s1"
  color="var(--s1)"
  height={34}
  cursorHour={selectedHour}
  fillOpacity={0.2}
  dayGridlines={true}
/>
```

**`<StripChartStack>`** — wave/wind/tide stacked, shared cursor
```js
<StripChartStack
  data={forecastTimeline}    // unified timeline from backend
  cursorHour={selectedHour}
  tracks={['wave', 'wind', 'tide']}  // subset ok
/>
```

**`<ForecastScrubber>`** — slider + mini chart + ticks
```js
<ForecastScrubber
  totalHours={168}
  selectedHour={selectedHour}
  onChange={setSelectedHour}
  miniChartData={waveData}   // optional
  startDate={new Date(...)}
/>
```

**`<DayPicker>`** — pill dropdown
```js
<DayPicker
  startDate={new Date(...)}
  selectedHour={selectedHour}
  dailyRatings={[3, 4, 5, 4, 2, 2, 3]}   // 0-5 per day
  onSelectDay={(dayIdx) => ...}
/>
```

### 4.3. How Copilot artifacts reuse these

In `Copilot.jsx`, the existing 5 artifact renderers (SpotCard, Why, Comparison, ConditionsTimeline, Equipment) stay where they are. We **add** new artifact types that wrap the shared primitives:

- `conditions_snapshot` artifact → wraps `<ConditionsGrid showTabs={false} />` + `<Compass variant="mini" />`
- `swell_breakdown` artifact → wraps `<SwellBreakdown compact />`
- `forecast_strips` artifact → wraps `<StripChartStack />`
- `swell_arrival` artifact (from handoff priority #5) → wraps a timeline chart using `<StripChart>` primitives per period band

This lets the Copilot's system prompt emit rich artifacts with the same look as the spot page, and lets us improve both in one codebase change.

---

## 5. Backend prerequisites

These must ship before the frontend can render the mockup against real data. All are called out in the handoff as known work; they're bundled here because they directly gate Phase 3+.

### 5.1. Fix wind direction bug (Handoff Bug 1) — 🔴 critical, 1 line
One line in the GRIB parser. Without this the compass wind arrow will point 180° wrong. See `HANDOFF_2026-04-22.md` §"Known Bugs · BUG 1".

### 5.2. Decompose swells in `/conditions` and `/forecast-timeline` (Handoff Bug 2)
GFS-Wave GRIB2 already includes `SWELL`/`SWPER`/`SWDIR` alongside primary `HTSGW`/`PERPW`/`DIRPW`. Update backend to parse both and emit:

```json
// /api/surf-spots/{slug}/conditions
{
  ...existing fields...,
  "swells": [
    { "height_ft": 4.2, "period_s": 15, "direction_deg": 290, "source": "primary",   "category": 3 },
    { "height_ft": 2.1, "period_s": 12, "direction_deg": 185, "source": "secondary", "category": 1 },
    { "height_ft": 1.4, "period_s":  9, "direction_deg": 220, "source": "wind_swell","category": 0 }
  ]
}
```

Same shape in `/forecast-timeline` under each hour's `wave` key. Backward compatibility: keep the old aggregate fields so nothing breaks.

### 5.3. Expose swell category 0–10 in `/conditions`
`swell_tables.surf_height_from_buoy()` already returns `category`. Thread it through to the conditions response so the frontend doesn't have to re-compute it.

### 5.4. Merge tide into `/forecast-timeline`
Current `/forecast-timeline` returns `[{hour, wave, wind, tide_ft}]` — but `tide_ft` may be null. Ensure tide is populated by calling `tides.fetch_tide_timeline()` inline and merging by hour. Spec: `ClaudeSuggestions /TIDES_ENDPOINT.md` §3.

### 5.5. Storm source labels on primary swell (nice-to-have)
For the `source_label` field in `<SwellRow>` ("290° · LOW-442 · 1,240nm"), we need storm attribution. This requires the `scan_active_storms` tool (handoff priority #4) or a simpler heuristic (bearing + distance to nearest active storm from `high_seas.py`). **For V1, emit the `direction_deg · N nm` portion only, and skip the storm ID if not available** — the frontend renders whatever is present.

### 5.6. Favorites endpoints
Table `user_favorites` exists (migration 006). Add:
- `GET /api/favorites` → list user's favorited spot slugs
- `POST /api/favorites/{slug}` → add
- `DELETE /api/favorites/{slug}` → remove

### 5.7. Session insight endpoint (for §7.5)
New endpoint:
```
GET /api/surf-spots/{slug}/user-insight
→ {
    "has_sessions": true,
    "session_count": 7,
    "avg_quality": 4.2,
    "last_session": { "logged_at": "...", "quality": 5, "note": "..." },
    "preferred_conditions": {
      "wvht_range_ft": [3.5, 5.5],
      "preferred_period_s": [14, 17],
      "preferred_tide": "mid_rising",
      "preferred_wind_dir": "offshore"
    },
    "size_perception_bias": 0.92
  }
```
Returns `{"has_sessions": false}` when `session_count < 3` (minimum for profile per handoff). Backed by `user_spot_profiles` view.

---

## 6. Frontend — phased implementation plan

Six phases. Each is a separate PR. Acceptance criteria at the end of each phase block.

### Phase 1 — Design tokens + primitives scaffold
**Goal:** Get the OKLCH theme shipping + scaffold all 10 shared primitive files with empty implementations + Storybook-style dev harness. No visible user change yet.

**Prerequisite for all other phases.**

Tasks:
- `frontend/public/fonts/` — add self-hosted Geist, Geist Mono, Instrument Serif (OFL-1.1, see CLAUDE.md brand spec)
- `frontend/src/design/themes.css` — define `:root[data-theme="ocean"]`, `:root[data-theme="dawn"]`, `:root[data-theme="daylight"]` with OKLCH custom props. Source values from `backend/config/ramps.json` `theme_accents` (which symlinks to `frontend/src/config/ramps.json`). Extract from the mockup's `:root` block (lines 11-31).
- Add `--s1`, `--s2`, `--s3`, `--wind` to the theme vars (not just `--accent`/`--fire`)
- `frontend/src/design/ThemeProvider.jsx` — sets `data-theme` attr on `<html>` from localStorage, default "ocean"
- `App.js` — wrap root in `<ThemeProvider>`
- `frontend/src/components/spot/` — create all 10 files as scaffolds with JSDoc contracts and a single exported component that renders a placeholder panel `<div>PRIMITIVE: Compass</div>` etc.
- `frontend/src/components/spot/index.js` — barrel export
- `frontend/src/screens/DevPrimitives.jsx` — unlisted dev route `/dev/primitives` that renders every primitive with mock props. Helps iterate in isolation.

**Acceptance:**
- `npm start`, navigate to `/dev/primitives`, see 10 placeholder panels
- Theme switcher (temporary dev button) toggles `data-theme` and body bg changes
- Fonts load (Inspector shows Geist applied to body)
- No existing pages broken

### Phase 2 — Backend prerequisites
**Goal:** All §5 items shipped and tested. No frontend changes.

Tasks:
- §5.1 — wind direction fix + unit test comparing to buoy 46224 ground truth
- §5.2 — swell decomposition in `main.py::conditions` and `main.py::forecast_timeline`. Include backward-compat aggregate fields.
- §5.3 — surface `category` from `swell_tables`
- §5.4 — tide merge in forecast_timeline
- §5.5 — emit best-effort `source_label` on primary swell
- §5.6 — favorites CRUD in `routes/favorites.py`
- §5.7 — `GET /surf-spots/{slug}/user-insight` → new endpoint, reads `user_spot_profiles`

**Acceptance:**
- `curl /api/surf-spots/cardiff-reef/conditions` returns `swells: [...]` with 1-3 entries, each with `category`
- `curl /api/surf-spots/cardiff-reef/forecast-timeline?hours=168` → each hour has `wave.swells[]` + non-null `tide_ft`
- Wind direction at Cardiff agrees with NDBC 46224 within 30° on next clear day
- Pytest green; no regressions in existing endpoints

### Phase 3 — Compass + Forecast Timeline
**Goal:** Replace SpotDetail's hero area and timeline with the new components. Conditions grid + break facts also ship. Ships the visible "top half" of the new page.

Tasks:
- Implement `<Compass>` (SVG, 3 rings, multi-swell, wind, center icon) — see mockup lines 405-488 for reference SVG
- Implement `<SpotTitle>` (eyebrow + name)
- Implement `<DayPicker>` (pill dropdown with ratings, click-outside behavior, keyboard nav)
- Implement `<ForecastScrubber>` (0-168h slider, gradient track, ticks, mini chart)
- Implement `<ConditionsGrid>` (6 cells, optional tabs)
- Implement `<BreakFacts>` (4 cells)
- Refactor `SpotDetail.js`:
  - Rip out old compass (lines ~345-811)
  - Rip out old timeline (lines ~849-865)
  - Rip out old conditions cards (lines ~870-1010)
  - Wire up shared state: `const [selectedHour, setSelectedHour] = useState(0)` drives Compass, ConditionsGrid, ForecastScrubber, (and later StripChartStack)
  - Wire up favorites button (calls §5.6 endpoints)
  - Keep admin edit mode (now gated behind the new edit chip)
  - Lazy-load heavy components where sensible
- Top bar: convert to floating pill row with backdrop-blur

**Acceptance:**
- Spot detail page loads at `/spot/cardiff-reef` (or whatever current route is)
- Compass shows 3 swell arrows + wind arrow, matches mockup geometry within 2px
- Scrubbing timeline rotates arrows and updates conditions grid in real time (no full re-render jitter)
- Day picker opens/closes correctly, snaps to same hour on new day
- Favorite star toggles state and persists to backend
- Dark/light themes both render correctly
- No render storms — verified via React DevTools Profiler on map pan

### Phase 4 — Multi-swell + Strip charts
**Goal:** Ship the "bottom half" — swell breakdown rows and stacked strip charts. Page is now feature-complete for the mockup.

Tasks:
- Implement `<SwellRow>` + `<SwellBreakdown>`
- Implement `<StripChart>` (single SVG area+line, cursor sync)
- Implement `<StripChartStack>` (wave/wind/tide, shared cursor)
- Wire into `SpotDetail.js` — two-column layout below conditions card
- Make sure cursor on strip charts moves when scrubber moves (shared `selectedHour`)
- Legend rows

**Acceptance:**
- Page renders exactly like mockup at 1280px width
- Mobile (375px): conditions grid collapses 6→2 cols; cols-2 stacks; compass shrinks to 360px per mockup
- Strip chart cursor tracks scrubber smoothly
- No CSS token literal hex/rgb in any of the new files (CLAUDE.md rule — enforce via eyeball, CI lint already in place)

### Phase 5 — Session Insight card
**Goal:** The replacement for the "AI Insight" slot. Pulls from §5.7 endpoint.

Tasks:
- Implement `<SessionInsightCard>`:
  - Empty state: "Log your first session here" + CTA → opens session-log modal (stubbed for now, full UI in separate plan)
  - Partial state (1-2 sessions): "Build 3 sessions to unlock your preferred conditions"
  - Full state (3+ sessions): avg rating stat, session count, preferred conditions chips, last session note
- Visual treatment reuses the aqua/fire gradient accent from the mockup's AI card (lines 265-281) — keep the pulsing dot motif (it's brand-aligned)
- Slot it into the cols-2 grid where the AI card was in the mockup
- Handle loading state with `<LogoPulse size={48} />`

**Acceptance:**
- Card shows correct state per session count
- Reading the preferred conditions on a user with 5+ sessions matches the mockup's narrative tone (concise, specific, data-grounded)
- Card is the same height as SwellBreakdown card next to it

### Phase 6 — Polish, mobile, Copilot integration
**Goal:** Ship Copilot artifact wrappers using the new primitives. Polish mobile. Ship.

Tasks:
- `Copilot.jsx`: add 3 new artifact types — `conditions_snapshot`, `swell_breakdown`, `forecast_strips` — each wraps the shared primitive with `variant="mini"` / `compact` props
- Update Copilot system prompt (backend `copilot.py`) to mention the new artifact types so the model emits them
- Mobile polish: verify all breakpoints, touch targets ≥44px, day picker is tap-friendly
- Animation polish: slider thumb scale on drag, compass arrow rotation easing (ease-out 200ms)
- A11y: ARIA labels on compass arrows (`aria-label="NW groundswell, 4.2 feet, 15 seconds"`), keyboard scrubbing with arrow keys, focus-visible on all interactive elements
- Replace every loading state in SpotDetail with `<LogoPulse>` per CLAUDE.md rule
- Take before/after screenshots in `.playwright-mcp/` for visual regression reference

**Acceptance:**
- Ask Copilot "what are conditions at Cardiff?" → renders `conditions_snapshot` artifact visually consistent with spot page
- Design review (`/design-review` workflow) passes with no Critical items
- Code review (`/review`) passes
- Mobile test on 375px + 768px + 1920px breakpoints

---

## 7. Decisions I made — please correct any that are wrong

1. **Real Leaflet map as backdrop, not decorative.** Keeps the page consistent with the rest of the app and lets us add bathymetry tiles later. The stylized look from the mockup is recreated via a dark-themed tile set (e.g., MapBox Dark or Stadia Maps Alidade Dark Matter) plus the vignette/grid overlay. If you want the decorative mockup-pixel-perfect version instead, Phase 3 changes.
2. **AI Insight → Session Insight.** The card slot becomes the personalization hook. Ties to the feedback loop from the handoff. If you'd rather just drop the card entirely or link to Copilot instead, say so and I'll revise Phase 5.
3. **Shared primitives in `components/spot/`.** Not `components/shared/` or `widgets/` — keeps the folder name pointed at the domain. Copilot-specific wrappers stay in `screens/Copilot.jsx`.
4. **Backward-compat backend fields.** Phase 2 adds `swells[]` but keeps `swell_direction`/`period_sec` so the current SpotDetail keeps working while we migrate.
5. **Dev harness at `/dev/primitives`.** Not gated by env because the dev team wants it quickly. Gate behind `NODE_ENV !== 'production'` before merging Phase 1.
6. **Admin edit mode kept.** Hidden behind the edit chip in the top bar. If you want to drop it from V2 entirely, Phase 3 gets simpler.
7. **No AI summary, period.** Per your call — no LLM-generated text on this page. Session insight is data-summarized templated prose, not AI generated.

---

## 8. File-by-file instructions for Phase 1 (Claude Code starts here)

Checklist — create/modify files in this order:

1. **`frontend/public/fonts/README.md`** — document the font download procedure. Files expected:
   - `geist-variable.woff2`, `geist-mono-variable.woff2`, `instrument-serif-regular.woff2`, `instrument-serif-italic.woff2`
   - Source: Google Fonts → self-host using google-webfonts-helper
   - License: OFL-1.1
2. **`frontend/src/design/themes.css`** — create fresh. Copy OKLCH vars from mockup `:root` block. Define 3 themes by wrapping in `[data-theme="..."]` selectors. Values sourced from `frontend/src/config/ramps.json` `theme_accents` — if any var isn't in ramps.json yet, add it to ramps.json first (`backend/config/ramps.json` is source of truth, symlinked).
3. **`frontend/src/index.css`** — `@import "./design/themes.css";` + `@font-face` declarations for the 4 font files.
4. **`frontend/src/design/ThemeProvider.jsx`** — React context provider. Reads `localStorage.theme` default "ocean", sets `data-theme` on `document.documentElement`, exposes `setTheme` via context.
5. **`frontend/src/App.js`** — wrap root in `<ThemeProvider>`.
6. **`frontend/src/components/spot/`** — `mkdir`. Create 10 scaffold files, each with:
   ```jsx
   /**
    * <PrimitiveName>
    * @param {Props} props
    * @description ...
    * See notes/SPOT_DETAIL_V2_PLAN.md §4.2 for contract.
    */
   export default function PrimitiveName(props) {
     return <div className="primitive-placeholder">PRIMITIVE: PrimitiveName</div>;
   }
   ```
   Files: `Compass.jsx`, `SwellRow.jsx`, `SwellBreakdown.jsx`, `ConditionsGrid.jsx`, `StripChart.jsx`, `StripChartStack.jsx`, `DayPicker.jsx`, `ForecastScrubber.jsx`, `SpotTitle.jsx`, `BreakFacts.jsx`, `SessionInsightCard.jsx`.
7. **`frontend/src/components/spot/index.js`** — barrel export all primitives.
8. **`frontend/src/screens/DevPrimitives.jsx`** — unlisted route. Renders each primitive with a reasonable mock prop. Gate behind `NODE_ENV !== 'production'`.
9. **`frontend/src/App.js`** — add route `/dev/primitives` → `<DevPrimitives />` (dev only).
10. **Run `npm start`, visit `/dev/primitives`, verify 10 placeholder panels render.**

Commit message template:
```
feat(design-v2): phase 1 — tokens, fonts, primitives scaffold

- Self-hosted Geist + Instrument Serif fonts
- OKLCH 3-theme system (Ocean/Dawn/Daylight) via themes.css
- ThemeProvider wraps App, persists to localStorage
- Scaffold 10 shared spot primitives in components/spot/
- Dev harness at /dev/primitives (dev-only route)

Prerequisite for SPOT_DETAIL_V2_PLAN phases 3-6.
No user-visible change to spot detail page yet.
```

---

## 9. Phase dependency graph

```
Phase 1 (tokens + scaffold)
   │
   ├─→ Phase 2 (backend prereqs) ──┐
   │                                │
   └─→ Phase 3 (compass + timeline + conditions)
                                    │
                                    ├─→ Phase 4 (swell breakdown + strips)
                                    │
                                    ├─→ Phase 5 (session insight)
                                    │
                                    └─→ Phase 6 (Copilot + polish + mobile)
```

Phase 1 and Phase 2 can be done in parallel (different developers / different PRs). Phase 3 blocks on both. 4, 5, 6 can be done in parallel after 3 lands.

---

## 10. Out of scope for V2 — intentional

- ~~**AI-driven spot analysis.** Per user direction, dropped.~~ **Reversed 2026-04-22** — AI analysis is in V2 via `<SioneReadCard>` calling `POST /api/sione/analyze` in Geometry Analyst mode. See `notes/SIONE_CAPABILITIES.md` and §1 update.
- **Session log UI itself.** `<SessionInsightCard>` reads session data but the "log a session" modal is a separate plan — see handoff priority #9.
- **New bathymetry visualization.** Mockup shows painted bathymetry contours. When real bathymetry data lands, it becomes a separate Leaflet pane — not baked into this plan.
- **Storm source attribution on secondary/tertiary swells.** V1 shows the primary only.
- **Swell arrival timeline chart.** Separate Sione artifact (handoff priority #5) — uses `<StripChart>` primitive but is a distinct feature.
- **Timeline at > 168h** (7 days). GFS-Wave has 180h, but mockup caps at 7 days for scrub UX reasons. Don't push past 168h without a UX pass.

---

## 11. Risks

1. **Leaflet + compass z-index war.** Compass is a DOM overlay; Leaflet uses panes at z-indexes 200-700 per CLAUDE.md. Compass needs its own pane at ~650 (same tier as labels) to sit above tiles and swell overlays but below UI chrome. Mitigation: create a dedicated Leaflet pane `compass-overlay` at z-index 645 in Phase 3.
2. **Cursor drift between StripChartStack and ForecastScrubber.** Mini chart is inside scrubber; big strips are in a separate card. Shared cursor math lives in a pure function `hourToX(hour, totalHours, width)` exported from `StripChart.jsx`. Both components call it with their own width. Mitigation: write the function first, unit-test it.
3. **Font fallback during font load.** Geist is ~100KB woff2. Use `font-display: swap` and system font stack fallback (`-apple-system, system-ui`). Don't block render.
4. **Swell decomposition for spots that only have 1 swell.** Backend must emit `swells: [primary]` (length 1) — frontend renders 1 row + 1 arrow. Don't require 3.
5. **"Category 3 · shoulder-to-head"** copy assumes swell_tables.py category labels match the mockup. Verify in Phase 3 — may need a small lookup table mapping Category 0..10 → UI label.

---

## 12. References

- **Design source:** `ClaudeDesign/project/mysurflife-spot-detail.html`
- **Current implementation:** `frontend/src/SpotDetail.js`, `frontend/src/SpotDetail.css`
- **Handoff context:** `notes/HANDOFF_2026-04-22.md` — known bugs, priority queue
- **Copilot artifacts (existing):** `frontend/src/screens/Copilot.jsx` lines 104-299
- **Design V2 plan:** `notes/DESIGN_V2_INTEGRATION_PLAN.md` — parent plan for tokens/themes/logo
- **Swell category table:** `backend/swell_tables.py` + `ClaudeSuggestions /SWELL_TABLES.md`
- **Tides endpoint spec:** `ClaudeSuggestions /TIDES_ENDPOINT.md`
- **Wind direction bug:** `HANDOFF_2026-04-22.md` §"Known Bugs · BUG 1"
- **Brand spec:** `backend/config/ramps.json` `brand.*` + CLAUDE.md "Brand Assets" section
- **Leaflet z-index hierarchy:** CLAUDE.md "Frontend — Canvas Rendering Architecture"

---

**Next action:** Claude Code begins Phase 1 per §8. Phases 2-6 get their own detailed specs at kickoff time.
