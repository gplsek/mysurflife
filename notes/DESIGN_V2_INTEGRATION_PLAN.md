# Design V2 Integration Plan — Claude Design → Production

**Status:** 📋 Planning
**Owner:** George (handoff to Claude Code for execution)
**Design source:** `ClaudeDesign/` bundle (9 prototype files + chat transcript)
**Companion plans:** [`WAVE_PERFORMANCE_V2_PLAN.md`](./WAVE_PERFORMANCE_V2_PLAN.md), [`GLOBAL_DATA_EXPANSION_PLAN.md`](./GLOBAL_DATA_EXPANSION_PLAN.md), [`SUPABASE_SESSIONS_SCHEMA.md`](./SUPABASE_SESSIONS_SCHEMA.md)
**Estimated effort:** 4 phases, ~5–7 weeks, interleaved with V2 and Global Data execution

---

## 1. Goal

Bring the visual redesign from `ClaudeDesign/` into production without blocking V2 performance work or the Global Data expansion. The redesign is a complete visual system — themes, typography, layout, information architecture — and must be adopted as a system, not component-by-component.

**Success criteria:**

- Three themes (Ocean, Dawn, Daylight) switch at runtime via a single `data-theme` attribute with no layout thrash.
- Design tokens (OKLCH color, type, spacing) live in one place — adding a fourth theme is a ~30-line JSON addition + CSS variable block, not a refactor.
- Overlay tiles (V2 Phase 2 output) harmonize visually on all three themes without per-theme tile pyramids.
- Session Journal, Alerts, and Dashboard screens render against real data (not `window.SPOTS` mocks) and preserve offline/loading/error states from the design.
- Decorative SVG wind particles in `MapBackground.jsx` do not ship alongside real WindGL particles.
- Mobile companion renders on wide viewports in a dev/demo mode only — not in shipped production UI.

---

## 2. What the Design Actually Is

### Files in `ClaudeDesign/project/`

| File | Lines | Role | Status in design |
|---|--:|---|---|
| `mysurflife.html` | ~30 | Script loader + root div | Entry point for prototype only |
| `App.jsx` | 339 | Main shell — topbar, layer rail, view switcher, tweaks panel | Complete visual |
| `MapBackground.jsx` | 269 | SVG equirectangular world map placeholder with decorative wind/swell | **Explicit swap point** for Mapbox/MapLibre (per chat1.md) |
| `SpotDetailPanel.jsx` | 205 | Floating right panel with 3 tabs (Forecast / AI Insight / My History) | Complete visual |
| `SideScreens.jsx` | 211 | Dashboard + Sessions + Alerts screens | Complete visual |
| `MobileCompanion.jsx` | ~150 | Phone-frame overlay shown on wide viewports | **Demo mode only** |
| `States.jsx` | 148 | Offline banner, error banner, loading overlay, empty favs, storm tracker modal | Complete visual |
| `data.jsx` | 53 | Mock SPOTS (15 global), SESSIONS (6), ALERTS (5), `genForecast()` | **Mock — replace entirely** |
| `styles.css` | 1086 | All tokens + component CSS for 3 themes | Source of truth for visual |

### Design system summary

- **Color:** OKLCH tokens in 3 themes via `[data-theme="..."]` CSS blocks. See `backend/config/ramps.json` `theme_accents` for the canonical color list.
- **Typography:** Geist (UI, body), Geist Mono (numbers, metadata), Instrument Serif (editorial accents — session notes, hero headlines). All OFL-1.1 licensed.
- **Layout:** Map-first, full-bleed. Panels float above the map with `backdrop-filter: saturate(180%) blur(14px)` and `oklch(... / 0.88)` fills. 1px borders at 8% white.
- **Density:** Driven by `--density` custom property (0.8 compact / 1.0 default / 1.2 comfortable).
- **Icons:** Inline SVG throughout, not an icon font. Consistent 1.5px stroke weight, rounded linecaps.

---

## 3. Phased Execution

Four phases designed to parallelize with V2 Phase 1/2/3 and Global Data Phase 1/2/3.

### PHASE A — Design Tokens & Typography

**Goal:** Make the token system the source of truth for all colors, fonts, spacing. No visual change yet — just foundation.
**Effort:** ~1 week
**Risk:** Very low
**Sequence:** Ship before V2 Phase 2 starts (so tile legends can pull from the same tokens).

#### Tasks for Claude Code

1. **Create the design token module.**
   - New files:
     - `frontend/src/design/tokens.css` — all CSS custom properties in `:root` and `[data-theme="..."]` blocks. Copy verbatim from `ClaudeDesign/project/styles.css` lines 1–62. Add minimum of these tokens: `--bg`, `--bg-2`, `--bg-3`, `--panel`, `--panel-solid`, `--border`, `--border-strong`, `--fg`, `--fg-2`, `--muted`, `--muted-2`, `--accent`, `--accent-2`, `--fire`, `--good`, `--panel-blur`, `--radius-s/m/l`, `--density`, `--font-ui`, `--font-mono`, `--font-serif`.
     - `frontend/src/design/tokens.js` — exports `getThemeColor(name)` and `resolveToRgb(cssColor)` helpers (pattern in the chat transcript). Subscribes to theme changes via `MutationObserver` on `document.documentElement[data-theme]`.
   - Import `tokens.css` at the top of `frontend/src/index.js` (or `index.css`).

2. **Self-host fonts.**
   - Directory: `frontend/public/fonts/`
   - Files to ship (download from official sources, both OFL-1.1):
     - Geist: Variable font `Geist[wght].woff2` (100–900). Source: https://vercel.com/font/geist
     - Geist Mono: Variable font `GeistMono[wght].woff2`. Same source.
     - Instrument Serif: `InstrumentSerif-Regular.woff2` + `InstrumentSerif-Italic.woff2`. Source: https://fonts.google.com/specimen/Instrument+Serif
   - New file: `frontend/src/design/fonts.css` with `@font-face` declarations.
   - Preload declaration in `public/index.html`: `<link rel="preload" href="/fonts/Geist[wght].woff2" as="font" type="font/woff2" crossorigin>`.
   - Verify FOUT/FOIT behavior — `font-display: swap` is acceptable per the design's pragmatic tone.

3. **Theme switcher component.**
   - New file: `frontend/src/design/ThemeProvider.js`. Reads `localStorage.mysurflife_theme` (default: `'ocean'`), sets `document.documentElement.setAttribute('data-theme', value)` on mount and on change.
   - Expose a `useTheme()` hook returning `{ theme, setTheme }`.
   - Allowed values: `'ocean' | 'dawn' | 'daylight'`. Any other value falls back to `'ocean'`.

4. **Ramps.json symlink + build-time copy.**
   - Run: `ln -s ../../backend/config/ramps.json frontend/src/config/ramps.json` (from repo root).
   - Alternatively, add a prebuild step to `frontend/package.json`: `"prebuild": "mkdir -p src/config && cp ../backend/config/ramps.json src/config/ramps.json"`.
   - New file: `frontend/src/design/ramps.js` with `rampStops()`, `rampDomain()`, `sampleRamp()`. See `WAVE_PERFORMANCE_V2_PLAN.md` Phase 2 task 3 for the reference implementation.

5. **CI lint rule.**
   - Add to `.eslintrc.js` custom rule OR a shell-script pre-commit hook: reject `#[0-9a-fA-F]{3,8}` in any file matching `frontend/src/**/*Legend.js`, `frontend/src/**/*Layer*.js`, or `frontend/src/design/Logo*.{js,jsx}`. Message: "Hex color literals forbidden — import from frontend/src/design/ramps.js".

6. **Extract and ship logo SVG components.** See §3.5.7 A6 for full spec. Creates `frontend/public/logo/*.svg` (11 variants) and `frontend/src/design/Logo.jsx` + `LogoPulse.jsx`.

7. **Generate favicon pack.** See §3.5.7 A7 for full spec. Creates raster favicons 16/32/64/96/180/512, `favicon.ico`, `site.webmanifest`, wires into `public/index.html`.

8. **Branded loading overlay animation.** See §3.5.7 A8 for full spec. Adds `@keyframes pulse-ring` to `design/tokens.css`, implements `LogoPulse` component.

#### Acceptance criteria for Phase A

- Setting `document.documentElement.setAttribute('data-theme', 'dawn')` in the console visibly shifts all already-styled components that read from tokens.
- Fonts load without CLS (Cumulative Layout Shift) score change.
- No existing component needs a code change (tokens are additive at this phase).

---

### PHASE B — Component Migration

**Goal:** Rebuild the map view, panels, and dashboard in the real codebase, against real data endpoints.
**Effort:** ~3 weeks
**Risk:** Medium — this is the most visible change.
**Sequence:** Runs in parallel with V2 Phase 2 (tiles) and Global Data Phase 1 (global wave grid). The MapLibre migration (Section 4 below) happens inside this phase.

#### Component Inventory — Design File → Production Target

| Design source | Production target | Data source | Notes |
|---|---|---|---|
| `App.jsx` (shell, topbar, layer rail) | `frontend/src/App.js` + new `frontend/src/Shell.js` | N/A | Replace existing App.js gradually. Keep `MapOverlay.js` as the map container. |
| `MapBackground.jsx` | Replaced by MapLibre/Leaflet tile basemap | Tile provider (see §4) | Decorative wind particles are **NOT carried over**. |
| `SpotDetailPanel.jsx` | `frontend/src/panels/SpotDetailPanel.js` (new) | `/api/surf-spots/{slug}/forecast-timeline` + `/api/spot-history/{id}` (new) | 3 tabs. AI tab deferred (Phase D). |
| `SideScreens.jsx` `DashboardScreen` | `frontend/src/screens/Dashboard.js` (new) | `/api/dashboard/{user_id}` (new aggregation endpoint) | Hero text uses LLM call (Phase D) or template fallback. |
| `SideScreens.jsx` `SessionsScreen` | `frontend/src/screens/SessionJournal.js` (new) | Supabase `sessions` table via hook (see `SUPABASE_SESSIONS_SCHEMA.md`) | Phase B can ship empty-state if Supabase isn't wired yet. |
| `SideScreens.jsx` `AlertsScreen` | `frontend/src/screens/Alerts.js` (new) | Supabase `alerts` table + Edge Function evaluator (Phase D) | Phase B ships UI only; wire in Phase D. |
| `States.jsx` `OfflineBanner`, `ErrorBanner`, `MapLoadingOverlay`, `PanelSkeleton`, `EmptyFavorites` | `frontend/src/states/*.js` (5 new files) | N/A (presentational) | Wire into existing load/error paths in `MapOverlay.js` + new panels. |
| `States.jsx` `StormTrackerDetail` | **Deferred to Phase D** | NOAA NHC / GFS MSLP extraction (new backend capability) | Do not ship in Phase B. Gate behind `?storms=1` during development. |
| `MobileCompanion.jsx` | **Demo mode only** — ship under `?devtools=1` | N/A | Not part of production UI. |
| `data.jsx` | **Delete** | All real endpoints | No `window.SPOTS` in production. |

#### Specific tasks for Claude Code

1. **Rating labels from server.**
   - Backend: add `rating_label` field to `/api/surf-spots/{slug}/forecast-timeline` response. Compute from wave energy index (`WVHT² × DPD`) + wind speed + cross-shore angle. Vocabulary: `"FIRING" | "PUMPING" | "HEAVY" | "CLEAN" | "FUN" | "SOLID" | "CHOPPY" | "FLAT" | "XXL" | "PERFECT"`. Initially may be computed via a simple scoring rubric; Phase D upgrades to an LLM call.
   - Frontend: `SpotDetailPanel.js` reads `spot.label` directly. Falls back to `"—"` if missing.

2. **Timeline heatmap.**
   - Replace the bottom time slider in `MapOverlay.js` with the design's heatmap timeline (App.jsx `Timeline` component).
   - Driven by `/api/forecast-heatmap?spot={id}&hours=168` returning `[{t, d, h, swell, wind, rating}, ...]` — mirrors `genForecast()` output shape.
   - Color each cell using `sampleRamp('wave_height', cell.swell)` with per-cell opacity `0.35 + (cell.rating / 5) * 0.6`.
   - Active cell has `box-shadow: 0 0 0 2px var(--accent)`.

3. **Favorite spots.**
   - Supabase `user_favorites` table (schema in `SUPABASE_SESSIONS_SCHEMA.md` §9). Migration runs in parallel.
   - Frontend hook: `useFavorites()` returns `[favorites, addFav, removeFav]` with optimistic updates.
   - Dashboard `favs-grid` renders `EmptyFavorites` component if `favorites.length === 0`.

4. **Topbar view switcher.**
   - Views: `Map | Dashboard | Journal | Alerts`. URL-routed via React Router (`/map`, `/`, `/journal`, `/alerts`).
   - Default route `/` → Dashboard (change from current default `/map`).
   - Keep the current "Buoys / Wind / Waves" overlay toggle but move it into the Map view's layer rail (left side, per design).

5. **Panel close/open interactions.**
   - `SpotDetailPanel` slides in from right with `transform: translateX(16px)` → `translateX(0)` + opacity 0 → 1 over 180ms.
   - Click outside panel (on map) closes it. Preserve map pan/zoom while closing.

#### Acceptance criteria for Phase B

- All 4 top-level screens (Map, Dashboard, Journal, Alerts) render with live data from real endpoints.
- All 3 themes look correct — no hardcoded colors anywhere in the new component tree.
- Loading/error/offline/empty states each have a reproducible trigger (dev tools throttle, API 500, `navigator.onLine = false`, fresh user).
- **Every production loading state uses `<LogoPulse>`** (§3.5.9 checklist). `grep -r "Loading..." frontend/src/` returns zero hits outside comments and tests. `grep -r "className=\"spinner\"" frontend/src/` returns zero hits. Emoji in loading states is zero.
- No `window.SPOTS`, `window.SESSIONS`, or `window.ALERTS` references remain in production code.
- Lighthouse Performance score does not regress vs. pre-migration baseline.

---

### PHASE C — Leaflet → MapLibre GL Migration

Covered in detail in Section 4 below. Lives inside Phase B, not a separate calendar phase.

---

### PHASE D — Deferred Surfaces

**Goal:** Ship the AI Insight tab, Storm Tracker, and the LLM-driven rating labels + dashboard hero text.
**Effort:** ~2 weeks
**Risk:** High — new backend capability (NHC/GFS storm extraction), LLM integration.
**Sequence:** Runs after V2 Phase 3 ships and after Supabase Phase 2 (alerts + edge functions) is live.

Deferred because each of these brings a new infrastructure dependency:

1. **AI Insight tab** — needs a stable session history database, a storm-tracker output, a per-user preference store, and an LLM prompt template. Realistic to build once sessions have 2+ months of data.
2. **Storm Tracker modal** — needs NOAA NHC cyclone feed (tropical) + GFS MSLP pressure-low extraction (mid-latitude). A "storm → spot" attribution model (fetch distance, great-circle angle, wrap checker) is new logic worth a dedicated spike.
3. **Dashboard hero headline** — LLM-generated ("Dawn patrol looks firing at Lowers"). Template fallback for Phase B; LLM in Phase D.

These each deserve their own plan file when the time comes:

- `notes/STORM_TRACKER_PLAN.md` — TBD
- `notes/AI_INSIGHT_PLAN.md` — TBD

---

## 3.5 Brand Identity & Logo System (D1)

The redesign ships alongside a new brand mark — the "D1" logo — defined in `ClaudeDesign/logo/mysurflife-logo-export.html`. This is a complete identity system with marks, lockups, favicons, apparel, and animated loading — not just a decorative icon. It must be adopted as a component, not copy-pasted SVG, so that theme changes propagate automatically.

### 3.5.1 Mark Anatomy

The D1 mark is three nested half-rings (the "swell" radiating outward) above a filled origin dot (the "spot"). Conceptually: a spot marker emitting concentric waves.

```
                ╭────────────╮      ← outer ring  r=28  stroke=1.2  opacity=0.25
             ╭──╯            ╰──╮
          ╭──╯  ╭────────╮      ╰──╮  ← middle ring r=21  stroke=1.6  opacity=0.50
       ╭──╯    ╭╯        ╰╮        ╰──╮
     ╭─╯   ╭───╯          ╰───╮       ╰─╮ ← inner ring  r=14  stroke=2.0  opacity=1.00
             ●                           ← dot at (32, 40) r=4
```

**Canonical specs** (authoritative values live in `ramps.json` `brand.mark_d1`):

| Property | Value |
|---|---|
| viewBox | `0 0 64 64` |
| Origin (dot center) | `(32, 40)` |
| Dot radius | `4px` |
| Dot fill | `var(--accent)` — theme-resolved (aqua on dark, `#0a8a9e` AA-safe on light) |
| Ring stroke | `var(--fire)` — theme-resolved (orange in Ocean/Dawn/Daylight) |
| Ring radii | 14 / 21 / 28 (inner → outer; 7px spacing) |
| Ring strokes | 2.0 / 1.6 / 1.2 |
| Ring opacity | 1.00 / 0.50 / 0.25 |
| Ring line-cap | round |
| Clear space | Equal to dot radius (4px at native; scales proportionally) |
| Minimum size | 16px |
| Degraded mode | Below 24px, drop outer two rings — render only inner ring + dot |

### 3.5.2 Variant Pack

From the export pack (`ClaudeDesign/logo/mysurflife-logo-export.html`), 11 canonical variants must ship:

| # | Variant | Use case | File slug |
|---|---|---|---|
| 1 | Mark — ink | Dark surfaces, default in Ocean theme | `mark-ink.svg` |
| 2 | Mark — paper | Light surfaces, default in Daylight theme | `mark-paper.svg` |
| 3 | Mark — aqua | Aqua background (marketing, tee) | `mark-aqua.svg` |
| 4 | Mark — fire | Fire background (marketing, tee) | `mark-fire.svg` |
| 5 | Horizontal — mark + wordmark | Default header lockup | `lockup-horizontal.svg` |
| 6 | Horizontal — with tagline | Landing page hero, footer | `lockup-horizontal-tagline.svg` |
| 7 | Horizontal — mono (paper) | Print-ready single-color | `lockup-horizontal-mono.svg` |
| 8 | Stacked | Square contexts (badges, cards) | `lockup-stacked.svg` |
| 9 | App icon — rounded rect (ink) | iOS/Android home-screen icon | `app-icon-ink.svg` |
| 10 | App icon — rounded rect (paper) | Light-mode alt icon | `app-icon-paper.svg` |
| 11 | Animated loading | MapLoadingOverlay, PanelSkeleton hero | React component `<LogoPulse />` |

All ship as vector components (not raster). See 3.5.5 for favicon raster generation.

### 3.5.3 Typography Lockup Rules

From the export pack spec table:

- **Wordmark:** `Geist` weight 800, tracking −0.04em, lowercase, literal text: `mysurflife`.
- **Tagline:** `Geist Mono` weight 500, 10px, tracking +0.24em, uppercase, literal text: `AI SURF FORECAST`. Color: `var(--muted)`.
- **Editorial accents** (session notes, dashboard hero): `Instrument Serif` italic.

Spacing in horizontal lockup: mark width + `0.5 × cap-height` → wordmark starts. Tagline (when present) sits below the wordmark baseline, indented to align with the 'm'.

### 3.5.4 Theme Resolution

The mark uses **two** CSS custom properties resolved at runtime:

```css
/* Logo reads these; ramps.json `theme_accents` defines per-theme values */
:root[data-theme="ocean"]    { --accent: oklch(0.82 0.16 195); --fire: oklch(0.75 0.19 45); }
:root[data-theme="dawn"]     { --accent: oklch(0.80 0.17  45); --fire: oklch(0.72 0.20 25); }
:root[data-theme="daylight"] { --accent: oklch(0.55 0.18 240); --fire: oklch(0.60 0.22 30); }
```

The React component (`Logo.jsx`) never hardcodes colors — it uses `stroke="currentColor"` + CSS variables so a theme swap instantly retints the mark without re-render.

### 3.5.5 File Manifest

```
frontend/
  public/
    logo/
      mark-ink.svg                  # variants 1–4
      mark-paper.svg
      mark-aqua.svg
      mark-fire.svg
      lockup-horizontal.svg         # variants 5–8
      lockup-horizontal-tagline.svg
      lockup-horizontal-mono.svg
      lockup-stacked.svg
      app-icon-ink.svg              # variants 9–10
      app-icon-paper.svg
      favicon.ico                   # legacy, 16+32 multi-res
      favicon-16.png
      favicon-32.png
      favicon-64.png                # PWA manifest
      favicon-96.png
      favicon-180.png               # apple-touch-icon
      favicon-512.png               # PWA splash
      site.webmanifest              # PWA manifest referencing icons
  src/
    design/
      Logo.jsx                      # single React component, prop-driven
      LogoPulse.jsx                 # animated loading variant
      logo-symbol.js                # <symbol id="mark-d1"> string export (for inlining)
```

### 3.5.6 Logo React Component API

```jsx
// frontend/src/design/Logo.jsx
<Logo
  variant="mark"               // "mark" | "horizontal" | "horizontal-tagline" | "stacked" | "app-icon"
  size={32}                    // number (px) — auto-drops outer rings < 24
  surface="auto"               // "auto" | "dark" | "light" — controls dot color on Daylight theme
  title="mysurflife"           // <title> for a11y; null = aria-hidden
  className=""
/>

// Example: header logo
<Logo variant="horizontal" size={28} />

// Example: loading state
<LogoPulse size={96} />
```

`LogoPulse.jsx` implements the three-ring pulse animation from `brand.pulse_animation` in ramps.json — `animation-duration: 2.4s`, staggered `0 / 800 / 1600ms`, each ring expands from the dot radius outward while fading to 0 opacity. Use `@keyframes pulse-ring` with CSS variable-driven `transform: scale(...)`.

### 3.5.7 Phase A Subtasks (new)

Added to Phase A § "Tasks for Claude Code" — these run alongside the token/font/ramps work:

**A6. Extract and ship logo SVG components.**
- From `ClaudeDesign/logo/mysurflife-logo-export.html`, extract the 11 variants and write them as standalone SVG files in `frontend/public/logo/`.
- The `<symbol id="mark-d1">` definition (see `brand.mark_d1.svg_symbol` in ramps.json) is the canonical source — all variants reference it via `<use href="#mark-d1">`.
- Build `frontend/src/design/Logo.jsx` with the prop API above. The component's internal SVG uses `stroke="currentColor"` for rings and `fill="var(--accent)"` for the dot — no hex literals.
- Build `frontend/src/design/LogoPulse.jsx` consuming `brand.pulse_animation` params (durations, stagger, radii).

**A7. Generate favicon pack.**
- Create raster favicons from `mark-ink.svg` at 16/32/64/96/180/512 px using Node build script `frontend/scripts/generate-favicons.js` (use `sharp` — add as devDependency).
- Output to `frontend/public/logo/favicon-*.png`.
- Also emit `favicon.ico` (multi-resolution: 16+32+48) via `png-to-ico` package.
- Generate `site.webmanifest` referencing the 192/512 PNGs; wire into `public/index.html` `<link rel="manifest">`.
- Update `public/index.html` head:
  ```html
  <link rel="icon" type="image/png" sizes="16x16" href="/logo/favicon-16.png" />
  <link rel="icon" type="image/png" sizes="32x32" href="/logo/favicon-32.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/logo/favicon-180.png" />
  <link rel="manifest" href="/logo/site.webmanifest" />
  <link rel="shortcut icon" href="/logo/favicon.ico" />
  ```
- Favicon regeneration runs as `npm run favicons` and is **not** part of the main build — run manually when the mark changes.

**A8. LogoPulse as the universal loading indicator.**
- Implement `<LogoPulse>` with the full API specified in §3.5.9 (size/compact/continuous/label props). Enforce the 4-size policy (96/48/24/12) via PropTypes warning for non-canonical sizes.
- Implement `@keyframes pulse-ring` in `design/tokens.css` (add to Phase A task 1). Use CSS variable-driven `transform: scale()` so the component is size-agnostic — one keyframe set handles all 4 recipes.
- Replace the placeholder loading spinner in `States.jsx` `MapLoadingOverlay` with `<LogoPulse size={96} label="loading your surf" />` centered over a faint `backdrop-filter: blur(6px)` backdrop.
- **Migrate all 15 existing loading indicators** per §3.5.9 checklist. Phase B owns the per-component migrations (since each one ships alongside its component's port), but the LogoPulse primitive itself ships in Phase A.
- Expand the Phase A task 5 CI lint to reject emoji+"Loading" strings, `className="spinner"`, `className="loading-spinner"`, `className="ai-pulse"` outside the reference folders.

### 3.5.8 Canonical domain — note for Claude Code

The export pack's browser-chrome preview shows the URL `mysurf.life`. **This is a design flourish only.** The canonical production domain is `mysurflife.com` (confirmed with George, 2026-04-19). Do not register `mysurf.life`, do not reference it in `og:url`, canonical tags, email templates, or anywhere else in the codebase. Treat any `mysurf.life` string in `ClaudeDesign/` as visual filler — replace with `mysurflife.com` during extraction.

### 3.5.9 LogoPulse — unified loading indicator

**Policy:** every loading state in the app uses `<LogoPulse>` or a LogoPulse-variant primitive. No emoji spinners (`🌊 Loading...`), no text-only "Loading..." placeholders, no generic CSS `.spinner` divs, no ad-hoc dot animations. This is a brand-level consistency rule enforced via CI lint in Phase A task 5.

**Why:** the pulse-rings animation *is* the brand — it's literally the logo mark in motion. Reusing it everywhere loading happens reinforces the mark, replaces 5+ one-off indicators with one component, and eliminates the jarring cognitive context switch between emoji/text/CSS spinners scattered across the app.

#### Size recipes

LogoPulse scales to 4 canonical sizes. Each has its own rules for which rings render and how fast they pulse, derived from `brand.mark_d1.drop_outer_rings_below_px` (24) and the pulse timing in `brand.pulse_animation`.

| Size | Rings shown | Pulse duration | Stagger | Use case | Props |
|--:|---|--:|--:|---|---|
| 96 | All 3 rings + dot | 2400ms | 0 / 800 / 1600 | Full-page splash, MapLoadingOverlay, route gate | `<LogoPulse size={96} label="loading your surf" />` |
| 48 | All 3 rings + dot | 1800ms | 0 / 600 / 1200 | Panel/card loading, SpotDetailPanel PanelSkeleton hero, dashboard tile | `<LogoPulse size={48} />` |
| 24 | Inner + middle only (no outer) + dot | 1200ms | 0 / 400 | Inline list row, table cell, chart block | `<LogoPulse size={24} compact />` |
| 12 | Inner ring + dot only | 900ms | 0 | Button inline, AI "thinking", eyebrow tag | `<LogoPulse size={12} compact />` (replaces `.ai-pulse`) |

The `compact` prop enforces the ring-drop rule without the caller having to know about the 24px threshold. Below 24, pulse runs faster (because the visual distance is shorter — keeps apparent angular velocity constant).

#### Production migration checklist

Every production loading indicator today is a migration target. Claude Code replaces each one while migrating the surrounding component in Phase B. Table below lists exact current state → target state.

| # | File | Current indicator | Target | Size |
|--:|---|---|---|--:|
| 1 | `AuthContext.js` (app boot) | `loading` state with no visual | `<LogoPulse />` full-screen splash behind route tree while auth resolves | 96 |
| 2 | `MapOverlay.js:241` `loading` | No visual gate today (map renders bare) | `<MapLoadingOverlay>` (States.jsx primitive) wrapping `<LogoPulse />` + "loading your surf" | 96 |
| 3 | `MapOverlay.js:247` `chartLoading` | `<div>Loading chart…</div>` | `<LogoPulse compact />` inline in chart container | 24 |
| 4 | `MapOverlay.js:251` `forecastLoading` | text "Loading forecast…" | `<LogoPulse compact />` over forecast bars | 24 |
| 5 | `MapOverlay.js:275` `waveFramesLoading` | text | `<LogoPulse compact />` in timeline slider knob area | 24 |
| 6 | `SpotDetail.js:211` | `🌊 Loading...` emoji | `<LogoPulse size={48} label="" />` centered in `.spot-detail-loading` | 48 |
| 7 | `SpotDetail.js:814` `timelineLoading` | inline state | `<LogoPulse compact />` in timeline panel | 24 |
| 8 | `SpotDetail.js:1198` `modelLoading` | inline state | `<LogoPulse compact />` in model card | 24 |
| 9 | `SpotDetail.js:1271` `buoyLoading` | inline state | `<LogoPulse compact />` in buoy card | 24 |
| 10 | `AISpotAnalysis.js:151` | `<div className="spinner"></div>` + "Loading analysis..." | `<LogoPulse size={48} label="analyzing" />` (editorial italic label, Instrument Serif) | 48 |
| 11 | `Login.js:146` button | text "Please wait..." | text stays; prepend `<LogoPulse size={12} compact />` inside the button | 12 |
| 12 | `ManageUsers.js:184` | text "Loading..." in `.loading` div | `<LogoPulse size={48} />` replacing the text | 48 |
| 13 | `ManagePersonas.js:120` | text "Loading..." | `<LogoPulse size={48} />` | 48 |
| 14 | `SpotDetailPanel.jsx:124` (design source) `.ai-pulse` | 3-dot CSS pulse | `<LogoPulse size={12} compact continuous />` — `continuous` prop keeps it running while AI response streams in | 12 |
| 15 | `MobileCompanion.jsx:70` (design source, dev-only) `.ai-pulse` | same | same LogoPulse with `continuous` | 12 |

Phase B commits that migrate each surrounding component must migrate its loading indicator in the same PR — no "hold the old spinner, swap later" commits.

#### `<LogoPulse>` component API (final)

```jsx
// frontend/src/design/LogoPulse.jsx
<LogoPulse
  size={48}                 // 96 | 48 | 24 | 12 (enforced via PropTypes warning on other values)
  compact={false}           // bool — auto-true when size < 24. Drops outer 1-2 rings.
  continuous={false}        // bool — if true, animation runs indefinitely (for AI "thinking" states).
                            //         if false (default), animation runs for 3 cycles then repeats
                            //         at lower opacity until the parent unmounts — prevents
                            //         hypnotic over-animation on long loads.
  label={null}              // string | null — optional text beneath the pulse, Instrument Serif italic
                            //         color var(--fg-2), only renders at size >= 48
  aria-label="Loading"      // a11y (default: "Loading" if label is null)
  className=""
/>
```

#### Rules for future contributors

1. **No new spinner components.** Need a loading indicator? Use LogoPulse. Pick the size from the recipe table above.
2. **Never pair LogoPulse with another spinner** in the same surface. It reads as "double loading" and weakens the brand.
3. **No emoji in loading states.** Ever. `🌊 Loading...` is forbidden — the mark IS the wave.
4. **AI thinking states** use `continuous` prop. Loading states don't. The distinction is: AI thinking = waiting for a response of unknown length; loading = fetching a known-bounded resource.
5. **For pages with multiple loading regions** (e.g., SpotDetail has buoy + model + timeline all fetching in parallel), use `size=24 compact` for each. Do not hoist to a single `size=96` overlay — it hides the granular loading progress from the user.

#### CI lint expansion

Phase A task 5's lint rule expands to also reject:

- Literal strings `"Loading..."`, `"Loading"`, `"Please wait..."` in JSX children (grep pattern: `>\s*Loading\.\.\.?\s*<`)
- The emoji `🌊` adjacent to the word "Loading"
- `className="spinner"`, `className="loading-spinner"`, `className="ai-pulse"` (post-migration)

Exception list: permitted in `__tests__/**`, `ClaudeDesign/**` (reference), and in comments.

### 3.5.10 Acceptance for logo integration (additive to Phase A acceptance)

- Toggling `data-theme` on `document.documentElement` instantly retints the logo mark in the header, dashboard, and loading overlay — no remount, no flash.
- Favicon renders correctly in Chrome, Safari, Firefox browser tabs and as an iOS home-screen icon.
- At `size=16`, `<Logo variant="mark" />` renders the inner ring + dot only (no visual clipping).
- All mark SVG files validate as clean SVG 1.1 (no Inkscape/Illustrator metadata, no inline styles that would override theme CSS).
- No hardcoded `#3EC9D4`, `#E5743D`, or `#0a1218` appear in any `frontend/src/**/*.{js,jsx,css}` file (enforced by the Phase A5 CI lint rule, which expands its scope to include `*Logo*.{js,jsx}`).

---

## 4. Leaflet → MapLibre GL Decision

The redesign is the right forcing function to evaluate this. The chat transcript explicitly names Mapbox/MapLibre as the real-data swap point. V2 Phase 2 (overlay tiles) and Phase 3 (WebGL particles) both land cleanly on a WebGL map. This section makes the decision explicit and lays out the migration path.

### Why this matters now

The current codebase uses `react-leaflet` with `L.TileLayer` (2D canvas). V2 adds:

- **Phase 2:** raster overlay tiles → Leaflet handles this fine (just another `L.TileLayer`).
- **Phase 3:** WebGL particles → need a separate WebGL canvas overlaid at z-index 401. Possible on Leaflet (we've seen `leaflet.pixi-overlay` and `leaflet-webgl-layer` patterns), but fragile: the WebGL canvas must be re-synced with Leaflet's pan/zoom transforms on every `move` event, and z-index coordination with Leaflet's pane system is a known footgun.

On MapLibre GL, particles are native — you either add a `CustomLayer` (WebGL shader runs inside MapLibre's render loop with camera matrices provided for free) or use the `raster-particle` layer type (MapLibre 4.0+). Zero transform-sync code required.

### Pros / cons matrix

| Dimension | Leaflet (stay) | MapLibre GL (switch) |
|---|---|---|
| Status quo effort | ✅ Zero churn | ❌ ~1 week migration |
| Raster overlay tiles (V2 Phase 2) | ✅ Native `L.TileLayer` | ✅ Native `raster` source |
| WebGL particles (V2 Phase 3) | ⚠️ Possible, fragile | ✅ Native `CustomLayer`, zero sync code |
| Vector basemap (stylable, theme-aware) | ❌ Vector tiles via plugins (fragile) | ✅ First-class |
| Retina / DPR handling | ⚠️ `detectRetina` + manual CSS | ✅ Automatic via devicePixelRatio |
| Pan/zoom smoothness | ⚠️ 30–60fps on canvas | ✅ 60fps GPU-driven |
| Mobile perf | ⚠️ Acceptable | ✅ Substantially better |
| Plugin ecosystem | ✅ Huge, mature | ⚠️ Smaller but growing |
| Theming for 3 Claude Design themes | ❌ Two basemap URLs or heavy CSS filters | ✅ Single vector style with runtime paint changes |
| React integration | ✅ `react-leaflet` mature | ✅ `react-map-gl` works with MapLibre |
| Marker customization | ✅ Easy (HTML) | ⚠️ Different model (GeoJSON source + symbol layer OR HTML via `Marker`) |
| Click-to-probe | ✅ Map-to-latlng trivial | ✅ `map.unproject()` — same thing |
| Learning curve | — | ⚠️ Style spec + source/layer model is new |
| License | BSD-2 | BSD-3 |

### Recommendation: **Switch to MapLibre GL during Phase B.**

Rationale:
1. V2 Phase 3 is where Leaflet hurts us most. We'd be retrofitting WebGL into a 2D canvas host.
2. Phase B already rewrites every map-adjacent component. The incremental cost of switching the map library is ~15–20% on top of work we're already doing.
3. Themability: MapLibre's `setPaintProperty()` lets us retheme the basemap at runtime — Dawn theme gets warm coasts, Ocean gets deep blues, Daylight gets a satellite-inspired palette — all from a single vector style JSON. On Leaflet we'd need three tile URLs.
4. Vector tiles cached from a free-tier provider (MapTiler, Stadia Maps, or self-hosted via tileserver-gl) cost roughly the same as raster tiles in our expected volume.

### Migration Path

**Step 1 — Replace map container.**
- Remove `react-leaflet` from `package.json`. Add `maplibre-gl` and `react-map-gl@7 (maplibre variant)`.
- New file: `frontend/src/map/MapContainer.js` replaces the Leaflet `<MapContainer>`.
- Style source: start with MapTiler Streets (`https://api.maptiler.com/maps/streets/style.json?key=...`) for Ocean theme. Prototype Dawn and Daylight as style overrides using `setPaintProperty()` on load.
- Free tier: MapTiler gives 100k tile loads/month. Switch to Stadia Maps or self-host when we outgrow it.

**Step 2 — Port overlay tile layer.**
- `WaveTileLayer.js` + `WindTileLayer.js` become MapLibre raster sources:
  ```js
  map.addSource('waves', {
    type: 'raster',
    tiles: [`https://tiles.mysurflife.com/api/tiles/waves/${model}/${run}/${hour}/{z}/{x}/{y}.png`],
    tileSize: 256,
  });
  map.addLayer({
    id: 'waves',
    type: 'raster',
    source: 'waves',
    paint: { 'raster-opacity': 0.55 },
  });
  ```
- Forecast hour changes: `map.getSource('waves').setTiles([newUrl])`. Clean and fast.

**Step 3 — Port particle layer (V2 Phase 3 enabler).**
- `WindParticlesLayerGL.js` becomes a MapLibre `CustomLayer`:
  ```js
  map.addLayer({
    id: 'wind-particles',
    type: 'custom',
    onAdd: (map, gl) => this._init(gl),
    render: (gl, matrix) => this._render(gl, matrix),
  });
  ```
- No transform-sync code. MapLibre hands you the projection matrix. WindGL's shader takes this as a uniform.

**Step 4 — Port markers (spot markers).**
- Best option: GeoJSON source + symbol layer. All spots in one GeoJSON FeatureCollection.
- Click handler: `map.on('click', 'spots', (e) => { ... })`. Cluster at low zoom via `cluster: true` on the source — free feature.
- Rating dot rendered via `icon-image` (we pre-generate 6 SVG icons — rating 0–5 — and load them as images on map load).

**Step 5 — Port click-to-probe.**
- `map.on('click', (e) => fetchProbe(e.lngLat))` — same as Leaflet's latlng. Use `/api/wave-point` already in production.

**Step 6 — Delete react-leaflet and `react-leaflet-google-layer` (if present).**
- After Phase B lands and MapLibre is stable for 1 week.

### Open decisions for Claude Code

- **Basemap provider:** MapTiler (easiest) vs. self-host via tileserver-gl (more ops work, full control). Recommend MapTiler for launch, revisit at 100k tiles/month.
- **Vector vs. raster basemap:** Vector enables per-theme paint changes (recommended). Raster is simpler but needs 3 URLs.

---

## 5. Decorative Particle Gating Rule

The design's `MapBackground.jsx` includes 256 SVG `<line>` elements animated via CSS to simulate wind flow. These are decorative — they're not data. They must not ship alongside real WindGL particles (V2 Phase 3) because:

- Visual competition: two particle systems overlap and hurt readability.
- Perf: 256 animated DOM elements consume main-thread time the GPU-accelerated system doesn't.
- Data integrity: users seeing "wind flow" that isn't real wind flow is a trust bug.

### The rule

Decorative particles render only when **all** of these are true:

1. No real overlay data is loaded (user hasn't toggled Wind/Waves on).
2. The current view is Dashboard or an empty-state (loading, offline, error).
3. User has not disabled them via `localStorage.mysurflife_decorative_particles = 'off'` (debug option, hidden from main UI).

When any real overlay becomes active — WaveTileLayer or WindParticlesLayerGL mounts — decorative particles unmount immediately. Transition: opacity 1 → 0 over 250ms.

### Implementation note

`MapBackground.jsx` logic moves into a new component `frontend/src/map/DecorativeOverlay.js`. It subscribes to the overlay state (`useOverlays()` hook returning which layers are active). Renders nothing when layers are on.

---

## 6. Supabase Sequencing

The design introduces three surfaces that need persistent, user-scoped data: Session Journal, Favorites, and Alerts. These map onto the three Supabase pillars (storage, realtime, edge functions).

### Staged rollout

**Stage 1 — Sessions table + favorites (during Phase B).**
- Most contained, highest user value, no background compute needed.
- See [`SUPABASE_SESSIONS_SCHEMA.md`](./SUPABASE_SESSIONS_SCHEMA.md) for full DDL, RLS policies, hooks.
- Storage bucket for session photos lands here.

**Stage 2 — Alerts table + evaluator edge function (during Phase D).**
- Alerts table with per-user conditional rules.
- Scheduled edge function runs every 15 minutes: for each active alert, fetches current forecast for that spot, evaluates condition, writes to `alert_events` table if triggered.
- Realtime subscription on `alert_events` delivers push notifications to the client.

**Stage 3 — AI features + storm tracker (Phase D).**
- `user_preferences` table stores learned prefs (favorite swell direction, preferred tide, historical rating correlations).
- Edge function for LLM summarization (dashboard hero text, AI Insight tab).
- Storm tracker populates a `storms` table updated hourly from NOAA NHC + GFS MSLP.

### What Claude Code writes for each stage

Each stage produces 3 artifacts in a standard layout:

```
supabase/
  migrations/
    20260501_sessions.sql          # stage 1
    20260512_favorites.sql          # stage 1
    20260601_alerts.sql             # stage 2
    20260601_alert_events.sql       # stage 2
    20260701_user_prefs.sql         # stage 3
    20260701_storms.sql             # stage 3
  functions/
    evaluate-alerts/index.ts        # stage 2 (Deno edge function)
    summarize-dashboard/index.ts    # stage 3
    ingest-storms/index.ts          # stage 3
```

---

## 7. Non-Shipping Surfaces

Two things from the design that **do not** ship to production:

### Tweaks panel (App.jsx bottom-right)
- Theme toggle, density slider, state simulator — **developer tool only**.
- Gate behind `?devtools=1` query param OR `localStorage.mysurflife_devtools = 'on'`.
- Strip from production bundle via webpack DefinePlugin `process.env.REACT_APP_DEVTOOLS`.

### Mobile companion (phone-frame overlay)
- Shown on wide viewports in the prototype for design-review purposes.
- **Not a production feature.** Real mobile users get the main UI responsive-styled down to 375px, not a decorative phone frame.
- Delete `MobileCompanion.jsx` at the end of Phase B.

---

## 8. File Targets Summary

### New files (frontend)
- `frontend/src/design/tokens.css`
- `frontend/src/design/tokens.js`
- `frontend/src/design/fonts.css`
- `frontend/src/design/ramps.js`
- `frontend/src/design/ThemeProvider.js`
- `frontend/src/design/Logo.jsx` ⭐ D1 mark component
- `frontend/src/design/LogoPulse.jsx` ⭐ animated loading variant
- `frontend/src/design/logo-symbol.js` ⭐ `<symbol id="mark-d1">` string
- `frontend/src/config/ramps.json` (symlink to `backend/config/ramps.json`)
- `frontend/src/Shell.js`
- `frontend/src/map/MapContainer.js` (MapLibre)
- `frontend/src/map/DecorativeOverlay.js`
- `frontend/src/panels/SpotDetailPanel.js`
- `frontend/src/screens/Dashboard.js`
- `frontend/src/screens/SessionJournal.js`
- `frontend/src/screens/Alerts.js`
- `frontend/src/states/OfflineBanner.js`
- `frontend/src/states/ErrorBanner.js`
- `frontend/src/states/MapLoadingOverlay.js`
- `frontend/src/states/PanelSkeleton.js`
- `frontend/src/states/EmptyFavorites.js`
- `frontend/scripts/generate-favicons.js` ⭐ Node build script for raster favicons
- `frontend/public/fonts/Geist[wght].woff2`
- `frontend/public/fonts/GeistMono[wght].woff2`
- `frontend/public/fonts/InstrumentSerif-Regular.woff2`
- `frontend/public/fonts/InstrumentSerif-Italic.woff2`
- `frontend/public/logo/mark-{ink,paper,aqua,fire}.svg` ⭐ 4 mark variants
- `frontend/public/logo/lockup-horizontal.svg`
- `frontend/public/logo/lockup-horizontal-tagline.svg`
- `frontend/public/logo/lockup-horizontal-mono.svg`
- `frontend/public/logo/lockup-stacked.svg`
- `frontend/public/logo/app-icon-{ink,paper}.svg`
- `frontend/public/logo/favicon-{16,32,64,96,180,512}.png` ⭐ raster favicons
- `frontend/public/logo/favicon.ico`
- `frontend/public/logo/site.webmanifest`

### New files (backend)
- `backend/config/ramps.json` ✅ already created
- `backend/overlay_tiles.py` (V2 Phase 2)
- Rating-label computation lives inside `main.py` or a new `backend/rating.py`

### Modified files
- `frontend/package.json` — remove `react-leaflet`, `leaflet`; add `maplibre-gl`, `react-map-gl`
- `frontend/src/App.js` — switch to Shell + routing
- `frontend/src/index.js` — import tokens.css + fonts.css
- `frontend/public/index.html` — add font preload tags; add favicon, apple-touch-icon, manifest `<link>` tags
- `frontend/package.json` — add `sharp` and `png-to-ico` as devDependencies (for favicon generation script); add `"favicons": "node scripts/generate-favicons.js"` to `scripts`
- `backend/main.py` — add `rating_label` field, `/api/forecast-heatmap`, `/api/dashboard/{user_id}`
- `CLAUDE.md` — update map library section (Leaflet → MapLibre), add design token section, add Brand Assets section

### Deleted files
- `ClaudeDesign/` stays in repo as reference bundle (don't delete — it's the handoff artifact).
- `frontend/src/WaveCanvasLayer.js`, `WindCanvasLayer.js` (V2 Phase 2 cleanup — already tracked there)
- `frontend/src/WindParticlesLayer.js`, `WaveParticlesLayer.js` (V2 Phase 3 cleanup)

---

## 9. Cross-Plan Sequencing

Execution order that keeps the three plans unblocked:

```
 Week 1: [A] Design Tokens + Fonts + ramps.js         [V2-1] render tokens, abort, stride
 Week 2: [A done] → [B] Shell + ThemeProvider         [V2-1 done]
 Week 3: [B] Dashboard + Session Journal (Supabase)   [V2-2] tile renderer backend
 Week 4: [B] Leaflet → MapLibre migration             [V2-2] tile endpoints + CDN
 Week 5: [B] Spot Panel + Timeline + States           [V2-2 done] legacy canvas deleted
 Week 6: [B] Alerts UI (mock data)                    [V2-3 starts] WebGL particles
 Week 7: [B done]                                     [V2-3 done] particle cleanup
 Week 8+: [D] AI Insight + Storm Tracker + LLM        [Global Data Phase 2 / 3 interleaved]
```

Key dependencies:
- Phase A must ship before V2 Phase 2 tile renderer starts (tile colors need `ramps.json`).
- MapLibre migration (Phase B week 4) must be stable before V2 Phase 3 WebGL particles.
- Supabase sessions must ship (Phase B week 3) before Session Journal screen.

---

## 10. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|:-:|:-:|---|
| MapLibre migration takes longer than estimated | Medium | High | Time-box to 1 week in Phase B; if not stable, ship Phase B on Leaflet and migrate in a follow-up. V2 Phase 3 is the real forcing function — must be MapLibre by then. |
| OKLCH color mismatch across browsers (older Safari) | Low | Medium | OKLCH is supported in Safari 15.4+. Use `@supports (color: oklch(0% 0 0))` feature queries with sRGB fallbacks generated from the pre-computed `rgb` field in `theme_accents`. |
| `backdrop-filter blur(14px)` kills mobile perf | Medium | Medium | Measure on real devices (iPhone 12, Pixel 6) early in Phase B. If bad, reduce blur radius to 8px on `@media (max-width: 768px)`. |
| Font files bloat bundle / slow TTFB | Low | Low | Preload + woff2 + variable fonts. Total font payload < 150KB. |
| Sessions Journal empty-state looks worse than mock grid | Low | Low | Ship the design's EmptyFavorites pattern — it handles the empty case well. |
| LLM rating-label cost balloons | Medium | Medium | Template fallback in Phase B; only upgrade to LLM in Phase D when we measure and budget it. |
| Storm tracker data source unreliable | Medium | High | Phase D only. NHC tropical data is reliable. GFS MSLP extraction for mid-latitude lows needs validation — ship tropical-only v1. |

---

## 11. Execution Notes for Claude Code

When starting Phase A:
1. Read `ClaudeDesign/project/styles.css` top-to-bottom before writing `tokens.css`. Everything in `:root` and `[data-theme="..."]` is the token source.
2. Do NOT port component CSS yet — only the tokens. Component styles come in Phase B as each component is migrated.
3. Verify fonts load by opening DevTools Network tab in the dev server; each should be ~30–80KB woff2.

When starting Phase B:
1. Start with the Shell + ThemeProvider + routing skeleton. Get a blank Dashboard page rendering first.
2. Port one panel at a time. SpotDetailPanel is the highest-leverage — port it second after Dashboard.
3. MapLibre migration is its own PR, not mixed with component migration.
4. Every new component must:
   - Accept no hex color props. All colors via tokens.
   - Render correctly in all 3 themes (manual QA — toggle via Tweaks).
   - Handle loading/error/empty states (pick the right States.jsx component).

Run `/review` and `/design-review` after each phase.

Commit discipline:
- Phase A: ~8 commits (tokens, fonts, theme provider, ramps symlink, CI lint, logo SVG variants, Logo.jsx + LogoPulse.jsx, favicon pack + MapLoadingOverlay).
- Phase B: 15–25 commits, one per component + MapLibre migration as 3–5 commits.
- Phase D: TBD when that phase kicks off.

---

**Created:** 2026-04-19
**Last updated:** 2026-04-19 — added §3.5 Brand Identity & Logo System (D1 mark, variants, Phase A subtasks A6–A8).
**Supersedes:** nothing — new plan
**Related:** [`WAVE_PERFORMANCE_V2_PLAN.md`](./WAVE_PERFORMANCE_V2_PLAN.md) (overlays), [`GLOBAL_DATA_EXPANSION_PLAN.md`](./GLOBAL_DATA_EXPANSION_PLAN.md) (data), [`SUPABASE_SESSIONS_SCHEMA.md`](./SUPABASE_SESSIONS_SCHEMA.md) (sessions), `ClaudeDesign/README.md` (design source bundle), `ClaudeDesign/logo/mysurflife-logo-export.html` (D1 export pack)
