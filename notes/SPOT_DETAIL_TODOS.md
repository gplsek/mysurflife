# Spot Detail Page — Non-Functional Elements & Fix Plan

**Last updated:** 2026-04-22  
**Branch:** `design-v2-integration`  
**Spec source:** `notes/mysurflife-spot-detail.html` (functional spec delivered this session)

Phases 1–5 of `SPOT_DETAIL_V2_PLAN.md` are complete. This doc tracks everything that renders but does nothing, shows placeholder data, or is missing entirely. Items are grouped by surface and ranked by user-facing impact.

---

## 1. Topbar

### 1.1 Favorite chip — `[HIGH]`
**State:** Not present in the UI at all. Spec §1.2 shows a 🔥 chip that toggles `spot.favorited`.  
**Plan:**
1. Add favorite chip to `sd-topbar` in `SpotDetail.js` (after the edit chip, before user menu). Show filled/outline state based on `favorited` state.
2. Wire `GET /api/favorites` on mount to populate initial state.
3. `POST /api/favorites/{slug}` on toggle on, `DELETE /api/favorites/{slug}` on toggle off.
4. Backend: add `routes/favorites.py` — table `user_favorites` already exists (migration 006).
5. Show `<LogoPulse size={12} compact />` in chip while toggling.

---

## 2. Forecast Timeline card

### 2.1 Tick highlight (`.sd-tick-current`) — `[LOW]`
**State:** CSS class `.sd-tick-current` (accent color) is defined but never applied. Spec §3.3 says the nearest 24h bucket tick should be highlighted.  
**Plan:** In `ForecastScrubber.jsx`, compute `nearestTickIdx = Math.round(selectedHour / 24)` clamped to 0–7. Apply `sd-tick-current` class to that tick span.

---

## 3. Conditions card

### 3.1 Tabs (Wave / Wind / Tide / All) — `[MEDIUM]`
**State:** Four tabs render and have active state, but clicking them does nothing — the 6-cell grid shows all fields regardless.  
**Plan (two options — pick one):**
- **Option A (filter):** Pass `activeTab` down to `ConditionsGrid`. When tab is `wave`, show cells 1–3 only; `wind` → cell 4; `tide` → cell 5–6; `all` → all 6. This matches the spec's "filter the 6-cell grid" description.
- **Option B (remove):** Drop the tabs entirely until there's a clear UX need. The grid is small enough that 6 cells is readable.
- **Recommendation:** Option A — it's a 20-line change and makes the card useful at mobile (2-col grid is cramped with all 6 fields).

### 3.2 Wind context — onshore / offshore — `[MEDIUM]`
**State:** Wind cell subtitle shows `"NW · 315°"` only. Spec §4.2 wants `"Light NW · offshore"` — deriving onshore/offshore relative to the spot's coastline facing direction.  
**Plan:**
1. Add `coastline_bearing` to `spot_characteristics` schema (integer, degrees the shore faces — e.g. Cardiff faces ~270°). Populate for existing spots.
2. In `getConditionsForGrid()`, compute `angleDiff = (windDir - (coastlineBearing + 180) + 360) % 360`. If `angleDiff < 90 || angleDiff > 270` → offshore; else → onshore. Cross-shore if near 90°/270°.
3. Prefix the wind label: `"Light NW · offshore"`. Also derive magnitude label: `< 5mph` → "Light", `5–15` → "Moderate", `> 15` → "Strong".

### 3.3 Swell conditions subtitle category text — `[LOW]`
**State:** `ConditionsGrid` subtitle is `"Live + model data"` at hour 0, `"Apr 22, 2:11 PM"` when scrubbing. Spec §4.1 shows `"Apr 22, 02:11 PM · Category 3 · shoulder-to-head"` with category derived from wave face.  
**Plan:** Append category to subtitle string in `SpotDetail.js`:
```js
const cat = condGrid?.category_label; // already computed as "Cat 3 · Chest high"
subtitle = selectedHour === 0 ? 'Live + model data' : `${fmtTime(selectedHour)}${cat ? ` · ${cat}` : ''}`;
```

---

## 4. Swell breakdown card (left column)

### 4.1 Swell source label — storm ID + distance — `[LOW]`
**State:** `SwellRow` shows `source_label` as `"290°"` only. Spec §5.1 wants `"290° · LOW-442 · 1,240nm"` (bearing + storm ID + great-circle distance to storm).  
**Plan:**
- **V1 (no storm data):** Format as `"{dir}° · {Math.round(distance_nm)}nm"` when `distance_nm` is available from backend. Backend already has `source_label` stub in §5.5 of V2 plan.
- **V2 (with storm tracker):** Include storm ID once `scan_active_storms` is implemented (handoff priority #4).
- For now: add `distance_nm` to the swell data shape in the backend `/forecast-timeline` response; frontend renders it when present.

### 4.2 AI note — real content — `[HIGH]`
**State:** AI note section shows static placeholder text: "Log sessions to unlock personalized insights". Spec §5.2 wants dynamic content from `GET /api/surf-spots/{slug}/user-insight`.  
**Sub-states:**
- **No sessions (< 3):** Current placeholder is appropriate. Add `session_count` to response and show "Log your first session here" vs "2 more sessions to unlock your profile".
- **Has sessions (≥ 3):** Show `avg_quality` stat, preferred conditions chips, last session note excerpt.
- **Confidence %:** Show `"AI Insight · Confidence {n}%"` eyebrow when `confidence` field present.

**Plan:**
1. Implement `GET /api/surf-spots/{slug}/user-insight` — reads `user_spot_profiles` view (schema in `SUPABASE_SESSIONS_SCHEMA.md`). Returns `{has_sessions, session_count, preferred_conditions, ...}`.
2. Fetch in `SpotDetail.js` as Phase 4 data (low priority, non-blocking). Store in `[userInsight, setUserInsight]` state.
3. Pass `userInsight` to the AI note block; render correct state based on `has_sessions`.
4. "Log a session" CTA: for now, navigate to `/log?spot={slug}` (page TBD). Block on session log UI plan.

### 4.3 "Log a session" CTA button — `[LOW]`
**State:** Button renders, does nothing.  
**Plan:** `onClick={() => navigate('/log?spot=' + slug)}` once the session log route exists. Until then, link to a `#` anchor or hide the button.

---

## 5. Strip charts card (right column)

### 5.1 Tide data — ~~often null~~ — `[FIXED ✅]`
**Was:** `tide_ft` was always null in `/forecast-timeline` — tide service existed in `tides.py` but was only wired up for the Copilot helper, not the public endpoint.  
**Fix applied:** `main.py::get_surf_spot_forecast_timeline` now fetches NOAA CO-OPS tide predictions via `tides.fetch_tide_timeline()` and merges `tide_ft` + `tide_state` into each timeline point. Wrapped in try/except so a tide fetch failure degrades gracefully (returns wave/wind data without tide, not an error). Both the pre-baked Redis path and the live fetch path now include tide.

---

## 6. Keyboard / accessibility

### 6.1 Day menu keyboard navigation — `[MEDIUM]`
**State:** Day menu opens/closes with click and Escape but has no ↑/↓ arrow-key navigation or focus trap.  
**Spec §3.2 requirement:** Arrow keys move focus within menu; Enter selects; Esc closes + restores focus to button.  
**Plan:** Add `onKeyDown` handler to `DayPicker.jsx`:
```js
// On button: Enter/Space → open
// On menu items: ArrowDown → next item; ArrowUp → prev; Enter → select; Escape → close
```
Use `useRef` array for item refs. On open, `focus()` the selected item.

### 6.2 Compass ARIA labels — `[LOW]`
**State:** Compass SVG has `aria-label="Swell and wind direction compass"` on the outer SVG but arrow groups have no accessible names.  
**Spec §8:** Each arrow group needs `<title>` child with current values so screen readers can inspect.  
**Plan:** In `Compass.jsx`, add `<title>` to each `<g>`:
```jsx
<title>{`${degreesToCardinal(swell.direction_deg)} swell, ${swell.height_ft.toFixed(1)} ft, ${Math.round(swell.period_s)} seconds`}</title>
```

### 6.3 Range input ARIA — `[LOW]`
**State:** Range input has no `aria-label` or `aria-valuetext`.  
**Plan:** Add to `ForecastScrubber.jsx`:
```jsx
aria-label="Forecast time offset in hours"
aria-valuetext={selectedHour === 0 ? 'Now' : fmtTime(selectedHour)}
```

---

## 7. Backend — blocking data gaps

These are backend items that make frontend fields go blank or show "--".

| Gap | Symptom | Backend fix |
|---|---|---|
| `swell_1/2/3` decomposed | Compass shows 1 arrow or none | Parse `SWELL`/`SWPER`/`SWDIR` from GFS-Wave GRIB2 alongside primary. See V2 Plan §5.2 |
| ~~`tide_ft` null in timeline~~ | ~~Tide strip empty, tide cell shows "--"~~ | ✅ Fixed — tide now merged in `/forecast-timeline` via NOAA CO-OPS |
| `water_temp_c` on spot | Water cell shows "--" when `selectedHour > 0` | Populate `spot_characteristics.water_temp_c` from nearest buoy or NOAA SST |
| `user-insight` endpoint | AI note always shows placeholder | Implement `GET /api/surf-spots/{slug}/user-insight` (V2 Plan §5.7) |
| Favorites endpoints | Favorite chip can't save | `POST/DELETE /api/favorites/{slug}` (V2 Plan §5.6) |
| Coastline bearing | Wind onshore/offshore can't be derived | Add `coastline_bearing` field to `spot_characteristics` |

---

## 8. Phase 6 items (not yet started)

From `SPOT_DETAIL_V2_PLAN.md §Phase 6`:

- **Copilot artifact wrappers** — `conditions_snapshot`, `swell_breakdown`, `forecast_strips` artifact types in `Copilot.jsx` using the shared `components/spot/` primitives.
- **Animation polish** — compass arrow rotation with `ease-out 200ms` transition; slider thumb scale on drag.
- **Mobile QA** — full pass at 375px / 768px; touch targets ≥ 44px; day menu viewport clipping fix.
- **`prefers-reduced-motion`** — disable `pulseDot` and day-menu transitions.

---

## Priority order for next session

1. **Favorite chip** (topbar, high user value, backend table exists)
2. **Tabs filter grid** (Option A — 20 lines, immediate UX improvement)
3. **`user-insight` backend endpoint** (unblocks AI note real content)
4. **Tide data merge in timeline** (unblocks tide strip + tide cell)
5. **Tick highlight** (quick polish, 5 lines)
6. **Keyboard nav on day menu** (accessibility, spec requirement)

---

## 9. Known Data Source Issues

### 9.1 GFS-Wave GRIB filter returning 302 redirects — `[MEDIUM]`
**State:** `filter_gfswave.pl` returns `302 Moved Temporarily` for all forecast hours above f000 (and sometimes f000 too). This breaks the `/forecast-timeline` live-fetch fallback and the map wave overlay for extended forecast hours.  
**Impact:** Map wave overlay (heatmap/particles) shows stale or no data past hour 0. Spot detail timeline is unaffected — it now uses Open-Meteo as primary data source.  
**Likely cause:** NOMADS reorganized the `grib_filter` URL structure or the run directory pattern changed. The current URL builds `%2Fgfs.DATE%2FHH%2Fwave%2Fgridded` — verify this path still exists on NOMADS for the current run cycle.  
**Investigation:**
```bash
curl -v "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl?file=gfswave.t12z.global.0p16.f006.grib2&var_HTSGW=on&dir=%2Fgfs.YYYYMMDD%2F12%2Fwave%2Fgridded"
# Check the Location header on the 302 to see where it's redirecting
```
**Do NOT remove** `_da_partitions()` or the GFS-Wave GRIB pipeline — it's needed for the 2D map overlay endpoint (`/api/waves-overlay`).

### 9.2 Open-Meteo attribution — `[DONE ✅]`
**Fix applied:** "Open-Meteo" link added to Forecast Timeline card subtitle in `SpotDetail.js`. License: CC-BY-4.0 per open-meteo.com/en/terms.
