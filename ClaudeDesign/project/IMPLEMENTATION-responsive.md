# mysurflife — Responsive implementation handoff

**Scope:** Mobile + tablet behavior across all pages. Desktop layouts are unchanged — this doc is only about what happens **below 900px** and the supporting scaffolding that lets the pages respond cleanly at any viewport.

**Prototype reference files (in this project):**
- `mysurflife-breakpoints.html` — side-by-side showcase at Desktop 1440 / Tablet 820 / Mobile 390 for all pages
- `mysurflife-map.html` + `map-view.js` — the page with the heaviest responsive logic (hamburger drawer, region dropdown)
- `mysurflife.html`, `mysurflife-home.html`, `mysurflife-spot-detail.html`, `mysurflife-copilot-session.html`, `mysurflife-storm-card.html` — the other screens

---

## 1. Why this work was needed

The original desktop layouts assumed a wide viewport. On a phone this produced four concrete problems:

1. **No viewport meta tag on 5 of 7 pages** → iOS/Android rendered them at ~980px and shrunk to fit, so text was tiny and nothing responded to media queries.
2. **Map left rail** (Markers legend + Layer toggles) was hidden below 900px with no replacement — users couldn't toggle layers or see the legend on mobile.
3. **Map top nav tabs** (Map / Dashboard / Journal / Alerts / Copilot) were hidden below 900px with no replacement — users couldn't navigate.
4. **Region chips** ran off-screen because a flex-wrap row doesn't fit on a 390px viewport and the horizontal-scroll fallback was awkward to discover.

Everything else (compass, conditions grid, strip charts, session log, storm card, copilot chat) was fixed by targeted media-query reflow — no structural change.

---

## 2. Breakpoints used

We use four breakpoints. Implement them as `min-width` in SCSS or as matching `max-width` media queries — the intent is the same.

| Name | Range | Purpose |
|---|---|---|
| **Desktop** | `≥ 901px` | Full layout with multi-column grids, left rails, wide search bars |
| **Tablet** | `≤ 900px` | Primary collapse point — rails become drawers, nav becomes hamburger, region chips become dropdown |
| **Small tablet / large phone** | `≤ 820px` | Page-specific tightening (storm-card stats go 2-col, spot detail compass shrinks) |
| **Phone** | `≤ 640px` | Grids collapse to 1 col, type scales down |
| **Narrow phone** | `≤ 420px` or `≤ 480px` | Brand label hides, zoom controls reposition |

---

## 3. Global requirements (apply to every page)

### 3.1 Viewport meta tag

Every `<head>` must include:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

Currently missing on the spot-detail, map, home, copilot-session, and storm-card source files in the prototype **before** this pass. Verify it's present in every production page template.

### 3.2 No horizontal scroll

No page should horizontally scroll at any viewport width. The usual culprits are:
- Tables or prefom blocks with explicit widths → wrap in `overflow-x: auto` container
- Absolute-positioned elements with `left: X` + fixed `width: Y` where `X + Y > 100vw` → use `left` + `right` instead of `left` + `width`
- Long strings in flex containers → add `min-width: 0` on flex children, `overflow-wrap: anywhere` on the text

### 3.3 Touch targets

Any interactive element below 900px must be **≥ 44×44 px** (Apple HIG) for touch. The prototype's mobile media queries already bump icon-buttons from 32 to 36 and the menu button to 44 — apply the same rule anywhere a user taps.

---

## 4. Map page (`mysurflife-map.html`)

This is the most involved change. Three components need responsive treatment:

### 4.1 Hamburger drawer (replaces left rail + top tabs)

**Trigger:** A 44×44 button in the top-left of the `.topbar`, visible only at `≤ 900px`. The prototype styles it with the aqua accent color and a subtle glow so it reads as a primary action, not chrome.

**Drawer panel:** A left-anchored slide-in panel, `min(300px, 85vw)` wide, containing:
1. **Close button** (X) in the top-right of the drawer
2. **Nav tabs** — Map (active), Dashboard, Journal, Alerts, Copilot. Each is a 40px-tall row with icon + label.
3. **Markers legend** — exactly the same rating tiers, buoy, and storm rows as the desktop left rail.
4. **Layers toggles** — Surf spots / NOAA buoys / Storm systems / Favorites only.

**Interaction spec:**
- Open: tap hamburger
- Close: tap X, tap the backdrop (semi-transparent overlay over the map), tap any drawer-tab link, or press Esc
- Transition: transform `translateX(-100%)` → `translateX(0)`, 220ms ease
- Backdrop: `rgba(0,0,0,0.4)` with a light blur, fades in with the drawer
- `body.menu-open` toggled by JS gates both the transform and the backdrop opacity

**Accessibility:**
- Hamburger is `<button>` with `aria-label="Open menu"`
- Drawer is `<aside>`; add `aria-hidden="true"/"false"` as it toggles
- Trap focus inside the drawer while open (prototype currently does not — add in implementation)
- First interactive element inside the drawer should receive focus on open
- Escape closes the drawer and returns focus to the hamburger

### 4.2 Region chips → dropdown

**Trigger:** The currently-selected region chip (e.g. "California"), with a ˅ caret glyph. Only one chip is visible below 900px — the "on" chip.

**Dropdown panel:** Tapping the trigger toggles `.region-bar.open`, which restyles the container as a vertical popover with all regions listed, each showing its spot count on the right.

**Interaction spec:**
- Tap selected chip → opens menu (preventDefault + stopPropagation on the click so it does NOT re-run `selectRegion`)
- Tap any region → `selectRegion(id)` runs as normal, menu closes, selected chip updates
- Tap selected chip while open → closes without side effects
- Tap outside bar → closes
- Esc → closes
- Crossing the 900px breakpoint upward → always closes (use `matchMedia.addEventListener('change', …)`)

**Critical implementation note:** The dropdown toggle uses a **capture-phase** click listener on the bar so it can intercept before the per-chip `selectRegion` click listener fires. Without this, tapping the "on" chip would just re-select the same region instead of opening the menu.

### 4.3 Other map mobile tweaks

Codify these in a `@media (max-width: 900px)` block:
- **Topbar:** gap reduces to 8px, mounted at `top: 10px; left: 10px; right: 10px`, brand logo padding trims
- **Search input:** `.search-kbd` (⌘K hint) hides
- **Zoom controls:** reposition to `right: 10px; bottom: 160px` so they don't collide with the status bar
- **Status bar:** stacks vertically; both cards become full-width
- **Preview card** (spot click): becomes bottom-anchored full-width sheet with 2-column metrics grid instead of 4
- **Storm preview card:** same treatment

At `≤ 420px`: brand label text hides (logo only), region chip padding reduces, search input font drops to 12.5px.

---

## 5. Other pages — required mobile reflow

Each of these should live in a `@media (max-width: 900px)` block in the page's stylesheet (or a shared media-queries stylesheet). Values below are the ones used in the prototype.

### 5.1 `mysurflife.html` (marketing home)

Already fluid via the existing hero + section grid. No new work required — verify hero type scales down with `clamp()` and the Copilot demo animation doesn't overflow.

### 5.2 `mysurflife-home.html` (dashboard)

- Favorited spots grid: `grid-template-columns: repeat(3, 1fr)` → `repeat(2, 1fr)` at `≤ 900px` → `1fr` at `≤ 640px`
- Nav tabs in the topbar collapse to hamburger (same pattern as map, but the drawer only needs the nav tabs — no legend/layers)
- Page padding reduces from 48px to 20px

### 5.3 `mysurflife-spot-detail.html`

- Map hero (satellite tile) keeps full width but height reduces from 420px to 280px at `≤ 640px`
- Compass overlay: scales from 280px diameter to 220px at `≤ 820px`, to 180px at `≤ 480px`
- Conditions grid: 4 cols → 2 cols at `≤ 640px`
- Day dropdown: anchor shifts, max-height reduces so it fits above the fold
- Strip charts (wave/wind/tide): keep full width, reduce y-axis label font to 10px
- Slider: reduce tick label count — show every 48h instead of every 24h below 640px

### 5.4 `mysurflife-copilot-session.html`

- History rail (left sidebar with past sessions): hides below 900px, replaced by a hamburger-style drawer trigger (same pattern as map)
- Message bubbles: widen from `max-width: 680px` to `100% - 24px`
- Composer: pins to bottom of viewport with `position: sticky` so the keyboard doesn't push it off-screen
- Rich inline components inside messages (charts, spot cards): reflow to single-column

### 5.5 `mysurflife-storm-card.html`

- Card wrap: side-anchored drawer on desktop → full-width at `≤ 820px` → top offset reduces at `≤ 480px`
- Primary stats grid: 4 cols → 2 cols at `≤ 820px`
- Map hero height: 320px → 220px at `≤ 480px`
- Spot affiliation rows: internal gap shrinks, icons reduce from 20px to 16px

---

## 6. Implementation checklist for engineering

- [ ] Add `<meta name="viewport">` to every page template that doesn't have it
- [ ] Set up a shared SCSS/CSS breakpoint file with the 5 breakpoints above
- [ ] Audit every page for horizontal scroll at 320px, 390px, 768px, 820px (Chrome DevTools device toolbar)
- [ ] Implement the hamburger drawer component in the map page — see §4.1. Reuse the same component on home, copilot-session, and any other page with a nav rail.
- [ ] Implement the region-dropdown pattern in the map page — see §4.2. Capture-phase listener is non-negotiable.
- [ ] Port the page-specific media query blocks (§5) from the prototype HTML files into production stylesheets
- [ ] Add focus-trap + `aria-hidden` management to the drawer (the prototype currently lacks these)
- [ ] Verify touch target sizes — no interactive element below 44×44 at `≤ 900px`
- [ ] QA at physical device widths: iPhone SE (375), iPhone 14 (390), iPhone 14 Pro Max (430), iPad Mini (744), iPad Pro (1024)
- [ ] QA with iOS Safari's dynamic address bar — status bar and drawer should behave correctly with `100svh`/`100dvh` instead of `100vh` where applicable

---

## 7. Known prototype caveats (not bugs to fix, just to know)

- **Focus management:** The map drawer doesn't trap focus or return focus to the hamburger on close. Add both in production.
- **Scroll lock:** When the drawer is open, the map still scrolls behind the backdrop. Add `overflow: hidden` to `body.menu-open` in production (the prototype omits this to avoid interfering with Leaflet's gesture handling — solve it by suspending map gestures while the drawer is open, not by body scroll lock).
- **Drawer-tab routing:** The prototype uses `location.href = '...'` for the Dashboard and Copilot tabs. Production should use the app's router.
- **Region dropdown keyboard nav:** Only Esc is wired up. Production should add arrow-key navigation and Enter-to-select.
- **Breakpoint at exactly 900px:** Matches the existing desktop/mobile split the prototype already uses. If your design system standardizes on different breakpoints (e.g. 768/1024), shift these accordingly — the structure doesn't care about the specific number, only that left-rail + top-tabs hide together at the same point.

---

## 8. Visual references

- **Breakpoint showcase:** open `mysurflife-breakpoints.html` in the prototype — shows all pages at Desktop / Tablet / Mobile widths side-by-side as live iframes, so you can see how each layout reflows.
- **Live mobile test:** open `mysurflife-map.html` directly in a mobile browser (or desktop browser narrowed to 390px) to see the hamburger drawer and region dropdown in action.
