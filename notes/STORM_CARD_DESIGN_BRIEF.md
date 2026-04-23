# Storm Card — Design Brief

**Audience:** Design team, to produce Figma/HTML comps
**Purpose:** Give Design everything they need to mock up the storm click-to-reveal card and its swell-arrival drill-down, without guessing at data or interaction flow.
**Engineering companion:** `notes/MAP_V2_IMPLEMENTATION_PLAN.md` Phase 4 · `notes/MAP_V2_DATA_GAPS.md`
**Product context:** `ClaudeDesign/project/SPEC-map.md`

---

## 1. What this card is and where it lives

**What:** A click-to-reveal card on the `/map` page that appears when the user clicks a storm beacon (the pulsing 120×120 SVG ring rendered on the world map).

**Why:** The storm beacon on its own is just a position and a label ("985 mb · 55 kt"). The card is the answer to the questions a surfer actually asks when they see a storm on the map:

1. *What is this storm and how bad is it?*
2. *Where is it going? Will it grow or fade?*
3. *Where will it deliver surf, and when?*
4. *Should I travel for it? Which spot, which day?*

Surfline and Windy refuse to answer #3 and #4. This is the card's reason to exist.

**Mental model:** Think of it like an NHC hurricane detail page fused with a Surfline regional forecast, presented inline on a world map. It should feel like a first-class product surface, not a map tooltip.

---

## 2. Information hierarchy — three levels

The card opens in **Level 1** and progressively discloses L2 and L3 as the user engages. All three can share the same container or stack as separate surfaces — Design's call.

### Level 1 — Storm characterization (always visible when card is open)

Everything the user needs to understand *what the storm is.* No swell math yet — pure meteorology.

**Data fields:**
- **Title:** Type + basin (e.g. "Low Pressure · Gulf of Alaska"). Type is one of: `Low`, `Tropical Storm`, `Tropical Depression`, `Hurricane`, `Typhoon`.
- **Subtitle:** Position (lat/lon formatted as `42.5°N, 155.0°W`) · "issued Xh ago" (bulletin freshness)
- **Central pressure:** in millibars (e.g. `985 mb`). Strength indicator — lower is stronger.
- **Max sustained winds:** in knots (e.g. `55 kt`). Convert to mph in UI if you prefer, but keep kt available — it's the meteorological standard.
- **Max seas:** in feet (e.g. `22 ft`). What the storm is generating on-site.
- **Movement:** direction + speed (e.g. `Moving NE at 15 kt`). Vector arrow recommended.
- **Warning tier:** one of `none` / `gale` / `storm` / `hurricane`. Drives a color badge.
- **Fetch summary:** direction + radius (e.g. `Hurricane-force winds in W semicircle, ~150 nm radius`). This is the most important line for surfers — it tells them which coast the storm is "aimed at."
- **Forecast track preview:** 3 waypoints (24h / 48h / 72h) with pressure+wind at each. Can be a tiny sparkline, text list, or integrated with the map rendering.
- **Raw bulletin text:** collapsed by default, accessible via "View full bulletin" disclosure. Oceanographers and hardcore users want this.

**Visual components Design should create:**
- Storm type badge (4 variants: Low / Tropical Storm / Hurricane / Typhoon)
- Warning tier color indicator (gale/storm/hurricane warning bar or border accent)
- Pressure "gauge" — could be numeric, could be a minimal bar indicator showing where this pressure sits on a 950–1020 mb scale. Design's call on whether a visual reads better than just a number.
- Movement vector — directional arrow
- Small fetch wedge diagram (compass-rose style, showing which quadrant has the strongest winds)
- Mini forecast-track chart (either a 3-dot polyline with timestamps, or a small stat block: "In 48h: 995 mb, moving to 45.5°N 146°W, weakening")

### Level 2 — Regional scorecard (below L1, always visible if data available)

*"Where does this storm deliver surf?"* A ranked list of reachable sub-regions. Only shows sub-regions where at least one spot is predicted above 3 ft — stays short and honest.

**List item data per sub-region:**
- **Sub-region label:** "Mainland Mexico" / "Baja Norte" / "Hawaii North Shore" / "So Cal South" etc.
- **Peak size:** "11 ft" at this region's best spot
- **Peak day/time:** "Fri 5am" (localized to user's timezone)
- **Surf window:** "48 h" (how long the swell is surfable)
- **Parent region hint:** small "MX · Pacific" or flag-style indicator

**Interaction:**
- Rows are tappable
- Tapping a row promotes it to "selected" (visual highlight) and expands Level 3 below it
- Tapping the selected row again collapses L3
- Selecting a row also triggers a map reaction: dim spots outside that sub-region, draw a great-circle arc from storm center to region centroid, zoom to fit both

**Sort order:** By peak size descending. Design should consider whether to also offer "sort by arrival time" (for users who want to know what hits first) — not required for v1 but worth a comp variant.

**Empty state:** If no sub-regions have spots above the floor (e.g. tiny storm), show "This storm isn't projected to deliver significant surf" with a note on why.

### Level 3 — Spot breakdown (expands below selected L2 row)

*"Which specific break, and what will it actually do?"* A ranked list of spots within the selected sub-region.

**List item data per spot:**
- **Spot name:** "Pascuales"
- **Peak size + period + direction:** "11 ft @ 17s from WNW"
- **First arrival (UTC→local):** "Fri 5:00am"
- **Peak time:** "Sat 9:00am" (when conditions are best)
- **Wind at peak:** "4 mph SE offshore" (from Open-Meteo point forecast at that hour)
- **Tide at peak:** "0.8 ft rising" (from NOAA tides)
- **Score indicator:** 0–5 rating for this specific arrival at this specific spot (factors in swell window alignment + wind + tide)

**Interaction:**
- Per-row CTA: **"Plan trip"** button → hands off to [new assistant name] with context pre-loaded (see §6)
- Per-row CTA: **"Open spot"** → navigates to the spot detail page
- Per-row CTA: **"Set alert"** → opens alerts panel pre-filled with this storm + spot + arrival window

**"See all N spots" expansion:** Default to 5 rows visible, expand to show all via disclosure.

**Sort:** By `score` descending (not by size). The point is "where is this swell BEST consumed," not just "where is it biggest."

---

## 3. Interaction states to design

Design should produce comps for these distinct states:

1. **Closed** — storm beacon only, no card visible. (Already specified in SPEC-map.md §7.3.)
2. **Card opening** — transition animation (slide-up? fade-in? Design's call). 180ms ease to match SPEC-map.md §6 preview card pattern.
3. **L1 only** — storm data visible, L2 collapsed or loading. Use when `/api/storms/{id}/arrivals` is in flight.
4. **L1 + L2, no selection** — scorecard visible, nothing selected.
5. **L1 + L2 + L3** — sub-region selected, spot list expanded.
6. **L3 with "all spots" expanded** — showing >5 spots.
7. **Map reaction state** — when L2 row is selected, rest of map dims. Storm card stays full opacity.
8. **No-arrival state** — storm too weak to deliver surf anywhere. L2 shows an empty-state message.
9. **Partial data state** — bulletin didn't parse a forecast track or fetch wedge. Card should gracefully hide those visualizations, not show broken chrome.
10. **Mobile (≤640px)** — full-width card, stacked layout, maybe a sheet-from-bottom pattern rather than centered card.
11. **Dismissal** — close button, click-away on map, Esc key (SPEC-map.md §6.5).

---

## 4. Example data for comps — use these realistic scenarios

Give Design three representative storms to render. Copy-paste these into comps verbatim if helpful.

### Example A — Extratropical low, Gulf of Alaska (classic WC swell generator)

```
Type: LOW
Name: Low Pressure · Gulf of Alaska
Position: 42.5°N, 155.0°W
Pressure: 985 mb
Wind: 55 kt max
Seas: 22 ft (range 18–22)
Movement: NE at 15 kt
Warning: storm
Fetch: W semicircle, 150 nm, hurricane-force winds
Forecast track:
  +24h: 44.0°N, 151.0°W — 990 mb, 50 kt
  +48h: 45.5°N, 146.0°W — 995 mb, 40 kt
  +72h: 46.0°N, 140.0°W — 1002 mb, 30 kt
Bulletin issued: 2h ago
```

**Level 2 scorecard (expected output):**
```
Mainland Mexico    11 ft   Fri 5a    48 h
Baja Norte         9 ft    Thu 2p    40 h
So Cal South       8 ft    Thu 6a    36 h
Central Coast CA   7 ft    Wed 10p   30 h
Hawaii North       5 ft    Fri 8p    42 h
```

**Level 3 for "Mainland Mexico":**
```
Pascuales            11 ft @ 17s WNW   Fri 5a  peak Sat 9a   wind 4 mph SE off
Puerto Escondido     10 ft @ 17s WNW   Fri 7a  peak Sat 12p  wind 6 mph S off
Salina Cruz          7 ft @ 17s WNW    Fri 11a peak Sat 4p   wind 15 mph N on
Barra de la Cruz     7 ft @ 17s WNW    Fri 11a peak Sat 4p   wind 12 mph N on
La Ticla             9 ft @ 17s WNW    Fri 6a  peak Sat 10a  wind 3 mph E off
                                                  [ See all 12 ]
```

### Example B — Major hurricane, Atlantic (tropical)

```
Type: HURRICANE
Name: Hurricane Delta · Central Atlantic
Position: 22.0°N, 45.0°W
Pressure: 945 mb
Wind: 115 kt max (Category 3)
Seas: 35 ft
Movement: WNW at 12 kt
Warning: hurricane
Fetch: NE quadrant, 220 nm, hurricane-force winds
Forecast track (from NHC GeoJSON):
  +24h: 23.5°N, 48.0°W — 950 mb, 105 kt
  +48h: 25.0°N, 52.0°W — 960 mb, 90 kt  (forecast cone widening)
  +72h: 26.5°N, 57.0°W — 965 mb, 75 kt
Bulletin issued: 45 min ago
```

**Expected scorecard:** US East Coast sub-regions dominate; Caribbean and Bahamas show up; Europe Atlantic gets hint (~3 ft long-period).

### Example C — Weak storm edge case (test empty states)

```
Type: LOW
Name: Weak Low · Eastern Pacific
Position: 30.0°N, 135.0°W
Pressure: 1005 mb
Wind: 30 kt max
Seas: 10 ft
Movement: E at 8 kt
Warning: (none)
Fetch: (not parsed)
Forecast track: (not parsed)
```

**Expected scorecard:** empty — below 3 ft floor everywhere. Card shows L1 only with a "no significant surf expected" note in place of L2.

---

## 5. Brand + theme notes

Use existing design system tokens from `backend/config/ramps.json`:

- **Themes:** Ocean / Dawn / Daylight. Design should produce comps in Ocean as primary, Dawn/Daylight as spot-checks.
- **Typography:** `Geist` (sans, wordmark/UI), `Geist Mono` (values, timestamps, coordinates), `Instrument Serif` (italic, for editorial headings).
- **Values style:** Geist Mono 10px uppercase muted letter-spacing 0.14em for labels ("PRESSURE", "MAX WINDS"); Geist weight 600 for values.
- **Accent color:** `var(--accent)` — aqua in Ocean theme.
- **Fire color:** `var(--fire)` — sunset orange, used for logo rings, could be used for storm marker/wedge.
- **Storm-specific palette** (proposed — Design can refine):
  - Gale warning: `var(--gold)` or a muted amber
  - Storm warning: `var(--coral)` or a deep orange
  - Hurricane warning: `var(--storm)` (already defined) or a high-saturation red

Tier color for size ratings on arrival rows should reuse the spot-marker tier palette from SPEC-map.md §7.1 (coral / gold / good / aqua / muted) — consistency with the map markers.

Loading state: use `<LogoPulse size={24} compact />` per CLAUDE.md LogoPulse rules. No spinners.

---

## 6. The handoff to [Copilot-rename-target] — design implications

Level 3 includes a **"Plan trip"** CTA per spot. This is NOT an inline action — it's a context-rich handoff to the AI assistant (currently named "Copilot," being renamed — engineering will communicate the final name before Phase 5 build).

**What the handoff does:**
- Click "Plan trip" → creates a new assistant session with full context: storm data, sub-region, spot, arrival times, user's home location.
- Opening assistant message is pre-generated (not LLM-streamed), something like: *"I see a storm forming in Gulf of Alaska that'll bring 11 ft @ 17s to Pascuales starting Friday morning, peaking Saturday. Want me to help plan a trip?"*
- User can then continue the conversation — assistant has tools for flight lookup (future), tide data, spot forecasts, journal logging, alert creation.

**Design implications for the storm card:**
- The "Plan trip" button should telegraph that clicking it opens a conversation, not a flight-booking form. A chat-bubble icon or subtle wordmark integration might help.
- Consider whether the button should show the assistant's name — e.g. "Plan with Sione" or "Ask Sione" — or stay generic as "Plan trip" with the assistant identity revealed on the handoff page.
- The opening-message content lives in the assistant UI, not in the card. Design doesn't need to comp it, but knowing the pattern exists should inform the CTA.

**Secondary handoff points in the card:**
- "Set alert" CTA could route to the Alerts page with storm/spot/window pre-filled — not via the assistant, via a direct alerts form.
- "Open spot" routes to the spot detail page — straight navigation, no context transfer.
- Level 1 could have a "Ask [assistant] about this storm" chip for general Q&A not tied to a specific spot.

---

## 7. Edge cases and error states Design should anticipate

- Storm with no parsed `fetch` geometry → hide the wedge diagram in L1
- Storm with no parsed `forecast_track` → hide the mini track viz, show "Forecast track unavailable" text instead
- Storm with `warning_tier: "none"` → suppress the warning color bar entirely, don't show "no warning" text
- Very old bulletin (> 12h) → show freshness warning ("Last update 14h ago — may be stale")
- Arrivals endpoint fails → show L1, error state in L2 area ("Can't compute arrivals right now, try again in a moment")
- User not signed in → "Plan trip" CTA shows with lock icon, tooltip "Sign in to plan a trip"
- Mobile keyboard open → card should reflow, not be obscured
- Tropical storm with NHC data available → visual distinction in L1 (NHC-sourced track is more reliable than our bulletin parse) — maybe a small "NHC official" badge

---

## 8. What Design should NOT produce comps for (yet)

Out of scope for the first round of comps:

- The assistant-side conversation UI (separate renaming project, handled in Phase 5)
- Alerts creation form (existing flow, storm-card reuses it)
- Spot detail page (already comped in `mysurflife-spot-detail.html`)
- The base map itself, chrome, region chips, etc. (already spec'd in SPEC-map.md)
- Custom area / long-press pin interaction (v2 feature, not v1)
- Ensemble forecast confidence cone (tropical cone yes — v1, extratropical ensemble no — v2)

---

## 9. Deliverables expected from Design

For engineering to build Phase 4 cleanly:

1. **Storm card — closed state** on map (already covered by SPEC-map.md §7.3 but confirm visual treatment)
2. **Storm card — L1 only** (3 variants: Low, Hurricane, Tropical Storm) × 3 themes (Ocean/Dawn/Daylight)
3. **Storm card — L1 + L2** with sample data from Example A
4. **Storm card — L1 + L2 + L3** with Mainland Mexico selected and Pascuales row highlighted
5. **Map-reaction state** showing dimmed non-region spots + great-circle arc + zoom level
6. **Forecast track visualization** on map (polyline + waypoint circles)
7. **Fetch wedge visualization** on map (SVG polygon oriented to wind quadrant)
8. **Mobile card** (full-width sheet) for L1 + L2
9. **Empty state** (Example C — weak storm, no arrivals)
10. **Partial data state** (missing forecast track)

Figma file, HTML mockup, or both — follow the pattern of `mysurflife-spot-detail.html` (self-contained HTML with inline styles, runs as a static prototype).

---

## 10. Open questions for Design to resolve

- Should L2 + L3 stack within one card, or does selecting an L2 row open a second panel alongside the storm card? (Two-column layout vs. stacked accordion.)
- Should the "Plan trip" button live per-spot in L3, or at the top of the card as a single CTA that opens a conversation already scoped to the storm but unscoped to a spot? (Current plan: per-spot. Consider the alternative.)
- Does the forecast track render ON the map (our current plan) or INSIDE the card as a mini chart? Both?
- Is the fetch wedge visible always when data exists, or only when the storm is hovered/selected? (Too busy if always on, too subtle if only on select.)
- Time display: local to user, UTC, or local to the destination spot (useful for trip planning — "arriving 5am local in Mexico" reads more naturally than "1pm UTC")? Recommend local-to-destination for L3, local-to-user elsewhere.

---

**Last updated:** 2026-04-22
