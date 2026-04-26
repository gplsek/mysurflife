# Storm Detail Drawer — v2 Design Brief

> **STATUS: SHELVED — 2026-04-26.** Decision was made to keep the existing v1 storm card unchanged and route all personalized / richer analysis through the "Ask Sione about this storm" handoff instead of expanding the drawer itself. See `notes/STORM_SIONE_HANDOFF.md` for the active plan. This document is preserved as a reference in case we revisit a richer in-drawer viz later (e.g., for users who don't want to chat with an LLM).

---

**For:** Design team
**From:** Engineering
**Last updated:** 2026-04-26
**Existing artifact to evolve:** `ClaudeDesign/project/mysurflife-storm-card.html` + `ClaudeDesign/project/SPEC-storm-card.md`
**Engineering companion:** `notes/GLOBAL_STORM_DETECTION_PLAN.md` (the data pipeline that unlocks everything below)

---

## TL;DR for design

The existing storm card is good. We're not throwing it away. But the data pipeline behind it is being upgraded from "parsed bulletin text from one of three NOAA products" to "global wind-field-derived storm dataset with hour-by-hour tracks, swell direction/period, landfall checks, and a per-region energy curve." That unlocks several visual moves the current card doesn't have room for, and one or two we should retire because the data was always weak.

**Three big shifts:**

1. **L3 (per-spot breakdown) gets dropped.** We're going region-only. Surfers click through to the spot detail page for fine-grain timing — the drawer's job is "where, when, how much energy, who gets it best, who misses." Removing L3 reclaims 40-60% of the drawer's vertical real estate for the new region viz.
2. **L2 evolves from a ranked list of regions into a comparison widget.** Bar-per-region with energy magnitude on Y, date window on X, sortable. The user can see at a glance "Central America gets the lion's share, So Cal gets the tail, Hawaii misses entirely." Currently L2 is six rows of identical-looking text — the data was never there to differentiate them visually. Now it is.
3. **L1 (storm characterization) gets four new chips/badges** the data couldn't power before: swell direction + period at storm, intensification trend, landfall warning, model-vs-bulletin provenance.

Plus a **narrative line** at the top of the drawer — a one-paragraph plain-English summary that the surf-text data nerds in the audience will love and the casual users will just read.

---

## What stays the same (don't redesign these)

- **Three-level disclosure model** — L1 always visible, L2 below, L3 expanded… except L3 goes away. So actually two-level now. Container, animation, dismissal, scrolling — keep all of that.
- **Container chrome** — 420px wide, dark theme, blur, shadow, entry animation.
- **Pressure gauge bar** in L1 primary stats. It's a great visual; nothing changes.
- **Fetch wedge SVG** — keep it. The data behind it gets better (we now compute 8-quadrant radii instead of one wedge), but the visual treatment is fine. Optional upgrade: instead of a single filled wedge, render an 8-spoke radial polygon showing the actual fetch shape — see §3.4 below.
- **Forecast track viz** — keep the dashed polyline + waypoint dots. Data improves from 1-3 sparse waypoints to ~28 hourly points; you may want to drop the per-waypoint cards (current `+24h`, `+48h`, `+72h` rows) in favor of an interactive scrubber over the polyline. Optional, not required.
- **"Ask Sione about this storm" chip** — keep it, but consider where it lives now that L3's "Plan trip with Sione" CTA disappears.
- **Raw bulletin disclosure** — keep it, with one nuance: when the storm is model-derived only (no bulletin match), the disclosure becomes "View detection details" with a structured display of pressure history, fetch shape over time, and detector confidence rather than raw text.
- **Warning tier color bar** at the top of the card.

---

## What evolves — Level 1 (Storm characterization)

The current L1 already does a great job answering *"what is this storm?"* The new pipeline gives us four extra fields that should appear as small badges/chips somewhere in the L1 section, probably in a new sub-row between the primary stats (§3.3) and the movement+fetch row (§3.4).

### 1.1 New chip: Swell signature

Currently L1 shows max seas in feet — that's *what the storm is generating on-site*. It does not tell a surfer what flavor of swell will arrive at their coast. With WW3 sampled at the storm location, we now have:

- **Peak period** (e.g. `16s`)
- **Swell direction** (e.g. `295° WNW`)

**Visual idea:** a single chip with a small directional arrow (compass needle) on the left, period prominent on the right.
```
[↗ 295° WNW]  16s peak period
```
Chip sits below the primary stats. Compass needle rotates to match `swell_direction_deg`. Period number gets the largest type weight in the chip.

### 1.2 New chip: Intensification trend

The storm is either **deepening** (getting stronger), **filling** (weakening), or **steady**. The current L1 says nothing about this — surfers want to know "is this storm peaking now or just getting started?"

**Visual idea:** a small trend pill with directional arrow + delta:
```
↓ Deepening · -8 mb / 6h
↑ Filling · +4 mb / 6h
─ Steady
```
Color: deepening = warn-storm coral (it's getting more intense, surf is improving), filling = muted (it's done, swell is fading), steady = neutral fg.

Pair with `peak_intensity_hour` shown as a small caption under the chip when relevant: `peaks in 18h` or `peaked 12h ago`.

### 1.3 New badge: Landfall warning

This is the highest-value new field. When `will_make_landfall === true` and `landfall_eta_hours` is within the storm's swell-generation window, a prominent warning element should render:

**Visual idea:** an attention-getting strip below the warning bar (or replacing it for landfalling storms), like:
```
🌀 Track makes landfall in 36h — swell window closes Tuesday
```
Use `--warn-storm` color treatment. This deserves to feel as important as a hurricane warning — for a surf trip, "the storm dies on land" is the difference between a 5-day window and a 24-hour window.

When the storm is offshore-staying, no badge appears.

### 1.4 New tag: Provenance

Some storms are reconciled (model + bulletin agreement), some are bulletin-only (rare), some are model-only (most of them, especially in the Southern Hemisphere). The drawer should be honest about which. A small text-only tag near the title block:

```
NOAA BULLETIN + MODEL    ← high confidence, named storm
NOAA BULLETIN ONLY       ← rare; model didn't pick it up
GFS MODEL DETECTION      ← most common globally; not a named storm
```

Geist Mono 9px uppercase, muted, sits next to the existing position/freshness sub-line. No color emphasis — it's metadata, not a warning.

---

## What evolves — Level 2 (Regional scorecard) — the headline change

This is where the most design energy should go. The current L2 is a vertical list of region rows, each showing peak height + peak time + window length + tier. The new pipeline lets us replace this with a **comparison widget** where the user can see all regions at once and visually understand who gets what, when, and how much.

### 2.1 The widget concept

Imagine a horizontal stacked layout, one row per region, with three visual encodings working together:

- **Y-axis (row height or row badge):** energy magnitude — `energy_index` 0-1
- **X-axis (within each row):** time, next 7 days
- **Filled segment within row:** the swell window for that region (`arrival_iso` → `fade_iso`), with a marker at `peak_arrival_iso`
- **Color treatment:** based on `impact_tier` — `direct` / `glancing` / `partial` / `miss` / `landfall_blocked`
- **Best-exposure flag:** the top region gets a special highlight or icon

Mocked in ASCII:
```
  Sun Mon Tue Wed Thu Fri Sat
  ─────────────────────────────
★ Central America     ░░░██████████░░░░░░░░░░  energy 0.95   "best exposure · S/SW spots"
  Mainland Mexico     ░░░░░░░██████████░░░░░░  energy 0.71   "S/SW spots, ~12h after C.A."
  So Cal              ░░░░░░░░░░██████████░░░  energy 0.62   "S spots best, weakening tail"
  N Cal               ░░░░░░░░░░░░░░██████░░░  energy 0.34   "glancing"
  Hawaii              ────────── shadowed ───   —             "won't see this one"
  PNW                 ─────── wrong window ──   —             "outside swell window"
```

### 2.2 Visual treatments to consider (Design's call)

- **Bar chart family.** Each region is a horizontal bar; bar fill represents the swell window over time, bar height or saturation represents energy. Sortable by energy or arrival time.
- **Sparkline family.** Each region row gets an inline `energy_curve` sparkline (the data has 24-48 sample points, ramps up to peak, fades out). Sparkline X is time, Y is energy. Same row also shows `arrival_iso` / `peak_arrival_iso` / `fade_iso` as text.
- **Heatmap family.** A grid where rows are regions and columns are days, cells are colored by predicted energy that day. Most info-dense, possibly busiest.
- **Stacked timeline family.** All regions share one X-axis (the next 7 days). Regions appear as horizontal bars/swimlanes anchored at their arrival times, fading with their fade time. Energy is encoded by bar opacity or thickness. Lets the user see "Saturday is the big day across multiple regions."

We don't have a strong opinion — pick the treatment that reads cleanest at 420px wide. The **stacked timeline** is probably the most surf-native (it answers "what coast is doing what when?" at a glance), but the **bar chart** is the most readable for a quick visit.

### 2.3 Per-region row data available

For every region returned by the API:
| Field | Type | Use in viz |
|---|---|---|
| `region_id` | string | Row key |
| `label` | string | Row name |
| `bearing_deg` | number | Optional small directional indicator (storm → region) |
| `distance_nm` | number | Caption: `4,200 nm` |
| `exposure_facing` | array | Hint: `S/SW-facing spots` |
| `impact_tier` | enum | Color/state of the row |
| `is_best_exposure` | bool | Star badge / row highlight |
| `arrival_iso` | timestamp | Window start |
| `peak_arrival_iso` | timestamp | Peak marker |
| `fade_iso` | timestamp | Window end |
| `peak_period_s` | number | Caption / chip: `peaks at 16s` |
| `swell_direction_deg` | number | Optional arrow chip per row |
| `energy_index` | 0-1 | Bar height / saturation / row sort |
| `energy_curve` | array | Sparkline data points |

### 2.4 Empty / miss states

When a region has `impact_tier: "miss"` or `"landfall_blocked"`, **don't drop it from the viz** — show it but flatlined with a clear reason:

- `miss` → `"Wrong window"` or `"Outside exposure"`
- `landfall_blocked` → `"Storm dies on land before swell builds"`
- `shadowed` (sub-case of miss) → `"Equator shadow"` / `"Continent in the way"`

The viz should reward an honest "this doesn't reach you" answer, not just hide it. That's a competitive advantage over Surfline and Windy — they refuse to answer "will this hit me?" so we should over-answer it.

### 2.5 Sort + interactivity

Keep the existing pill-group sort toggle pattern from the current card. New options:
- **Energy** (default) — sort by `energy_index` desc
- **Arrival** — sort by `arrival_iso` asc (who gets it first?)
- **Distance** — sort by `distance_nm` asc

Click on a region row → highlight that row + dim the others + draw a great-circle arc from storm to region centroid on the underlying map. That interaction stays from the current card; no design change needed.

---

## What evolves — narrative line (new)

The pipeline server-renders a one-paragraph plain-English summary of the storm at every detection cycle. We want this rendered prominently in the drawer, probably between L1 and L2 as a quoted block.

### 3.1 Template + example

The text is pre-assembled by code (no LLM, no cost, deterministic). Template:

```
{Storm type} {position description}. Swell arrives {best_region.label}
{best_region.arrival_iso:weekday}, peaks {peak_arrival_iso:weekday} and runs
through {fade_iso:weekday}. Best exposure: {best_region.label}
({facing}-facing spots). Also reaches {direct_regions[1..]} {arrival_diff} later.
{Misses_regions} won't see this one. {Landfall_caveat if applicable.}
Keep an eye on your spot report for fine-grain timing.
```

Example:
> *Strong low pressure deepening south of New Zealand. Swell arrives Central America Friday, peaks Saturday and runs through Tuesday. Best exposure: Central America (south-facing spots). Also reaches Mainland Mexico ~12h later, So Cal ~24h later. Hawaii is shadowed by the equator and won't see this one. Keep an eye on your spot report for fine-grain timing.*

### 3.2 Visual treatment

This block reads like *editorial commentary*. Use Instrument Serif italic for the prose body — that font is already in the design system specifically for moments like this. Stay around 14px, line-height 1.5, max-width matches card width minus padding.

Consider:
- A subtle quote/aside treatment (vertical accent bar on the left, like a pull quote)
- A small "Auto-summary" tag in Geist Mono uppercase muted, so users understand this is computed — sets expectations
- An animated typing-on effect on first reveal (optional, polish-tier — must not block content)

### 3.3 When to hide it

If the storm is `landfall_blocked` against every region, or the narrative gets too short to be useful (e.g. a marginal storm with one weak target), suppress the narrative block and rely on the L2 viz alone. Don't show empty boilerplate.

---

## What evolves — fetch wedge (optional polish)

Current fetch wedge fills one quadrant/semicircle based on a bulletin string. New pipeline gives us **8 quadrant radii** computed from the actual wind field. Two evolution options:

- **A. Keep the simple wedge.** Pick the largest quadrant from the 8 and render the existing wedge. Honest, still informative. No design work.
- **B. Polar polygon.** Render an 8-spoke radial polygon where each spoke length = quadrant radius / max radius. Outline + 25% fill. The shape becomes a visual fingerprint of the storm — round = symmetric, lopsided = asymmetric. Surf nerds love this.

If B is doable in the same 96×96 footprint as the current wedge, it's a nice upgrade. If it crowds the layout, A is fine.

---

## Forecast track upgrade (optional)

Current viz: 3-point dashed polyline with `+24h / +48h / +72h` waypoint cards below. New data: hourly track out to 168h.

**Conservative evolution:** keep the 3-point viz but extend the waypoint cards to a horizontal scrubber: drag a marker along the track, see pressure/wind/position update in real time. Bottom of the L1 section.

**Bolder evolution:** drop the waypoint cards. Replace with a horizontal time slider underneath the track viz, where dragging it animates a marker along the polyline AND simultaneously updates the L2 widget to show the storm's projected impact at that future time. ("If I scrub to Friday at 3 PM, the energy curves in L2 reflect what the storm has produced by then.")

The bolder version is a much richer toy and ties L1 to L2 directly. Probably worth it. Defer if it adds too much scope.

---

## Storm marker on map (small companion change)

The drawer is opened by clicking a storm marker. With provenance metadata, the marker can communicate confidence:

- **Solid pulsing ring** — bulletin-confirmed storm (today's behavior)
- **Dashed pulsing ring** — model-derived only (new)
- **Subtle inner glow color** keyed to `warning_tier` (gale = gold, storm = coral, hurricane = red — matches the warning bar inside the drawer)

Optional: animate the storm marker so the inner core throbs *faster* when the storm is `is_deepening: true` and *slower* when `filling`. Subtle but readable cue from across the map.

---

## Out of scope (don't design for these)

- Per-spot height projections in the drawer. **Drop entirely.** Spot pages already do this.
- "See all N spots" CTA. **Drop.** No spot list anymore.
- "Plan trip with Sione" L3 CTA. **Drop.** No L3.
- Any height number shown to one decimal place per region. We're using qualitative tiers + relative energy index, not "11.2 ft." Resist the urge.
- Tropical-cyclone-specific NHC cone rendering. We can add it if a storm reconciles with NHC data, but it's not a v1 must-have for the drawer redesign — too easy to overload visually.

---

## Suggested deliverables for Design

Phase one — explore the L2 widget:
1. **3-4 visual exploration variants** of the regional energy widget at 420px width. Stacked timeline, horizontal bar chart, sparkline grid, heatmap — pick the best two and refine.
2. **Empty/miss state treatments** for regions that don't get the storm.
3. **Best-exposure highlight** treatment — how does the lead region differ visually from also-rans?

Phase two — L1 enrichment:
4. **Swell signature chip** layout (direction + period).
5. **Intensification trend pill** with deepening/filling/steady states.
6. **Landfall warning** strip — needs to feel important without overwhelming the warning bar above it.

Phase three — narrative + polish:
7. **Narrative block** typography and quote treatment.
8. **Provenance tag** placement.
9. **Optional:** polar fetch polygon, interactive forecast track scrubber.

---

## Reference files

- **Existing card prototype:** `ClaudeDesign/project/mysurflife-storm-card.html` (1,553 lines — open in a browser to see current state)
- **Existing card spec:** `ClaudeDesign/project/SPEC-storm-card.md` (647 lines — section numbers above match)
- **Original product brief:** `notes/STORM_CARD_DESIGN_BRIEF.md` (the original L1/L2/L3 product brief — partially superseded by this v2 brief)
- **Engineering plan:** `notes/GLOBAL_STORM_DETECTION_PLAN.md` (where the new data comes from)
- **Bug log:** `notes/STORM_COVERAGE_BUGS.md` (interim parser fixes for the existing pipeline)

Questions for design to think through:
1. Is the regional widget bold enough to be the visual center of gravity in the drawer, or does it compete with the L1 block above it?
2. Does the narrative block belong above L2 (sets the story, then shows the data) or below (data first, then summary)?
3. How should the drawer differ visually for a *named hurricane* vs a *generic North Pacific low*? Both go through the same template, but hurricanes deserve more gravity. Does provenance/type drive a slightly different visual hierarchy?
4. Mobile (~375px wide) — does the widget collapse to one-region-at-a-time with horizontal swipe, or does it stack vertically with each region taking a full-width row? Both are valid; pick one.
