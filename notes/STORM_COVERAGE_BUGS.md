# Storm Coverage Bugs

**Owner:** George
**Last updated:** 2026-04-26
**Companion:** `notes/GLOBAL_STORM_DETECTION_PLAN.md` (the long-term fix)

These are immediate gaps in the existing bulletin-based pipeline. Most are quick fixes that improve coverage in the short term while the wind-field-derived pipeline is being built.

---

## Bug 1 — South Pacific bulletin location is wrong

**Severity:** High (silent data loss)
**File:** `backend/high_seas.py`
**Lines:** 24–40

```python
"south-pacific": {
    "type": "HSF",
    "location": "EP2",      # ← This is "East Pacific" (off Mexico), NOT South Pacific
    "label": "East/South Pacific High Seas Forecast",
},
```

`HSF/EP2` is the East Pacific bulletin covering the eastern tropical Pacific (off Mexico / Central America), not the South Pacific. KWBC does not issue a South Pacific bulletin. The product mapping is misnamed and the label is misleading.

**Impact:** Users assume we have South Pacific coverage; we don't. The "South Pacific" label in any UI surface is wrong.

**Fix options:**
- (a) Rename the key to `east-pacific` everywhere (config, routes, frontend) so the label is honest.
- (b) Source actual South Pacific data from BoM (`http://www.bom.gov.au/marine/forecasts/`) or NZ MetService — both publish but neither has a clean public JSON API.
- (c) Wait for the wind-field detector (`GLOBAL_STORM_DETECTION_PLAN.md`) which makes this moot.

**Recommendation:** Do (a) now (rename + honest label) and let (c) eventually replace it. (b) is more work than it's worth given that the global detector solves it.

---

## Bug 2 — Forecast track parser misses ".12 HOUR FORECAST" format

**Severity:** Medium (drawer L1 forecast track is null on every storm)
**File:** `backend/high_seas.py`
**Lines:** 214–270, function `_parse_forecast_track`

Current regex (line 227) handles only:
```
WILL MOVE NE TO 44N 151W BY 12Z TUE
NEAR 44N 151W
```

Real bulletins use a different convention for explicit forecast positions:
```
.24 HOUR FORECAST LOW 61N 45W
.36 HOUR FORECAST LOW 60N 42W
.48 HOUR FORECAST LOW 58N 38W
```

These never match the current pattern. Result: `forecast_track` is null on most storms.

**Fix:** add a second regex pass:

```python
hour_pat = re.compile(
    r"\.(\d{1,3})\s+HOUR\s+FORECAST\s+(?:LOW|HIGH|TROPICAL\s+\w+|HURRICANE|TYPHOON)?\s*"
    r"(\d+(?:\.\d+)?[NS])\s*(\d+(?:\.\d+)?[EW])",
    re.IGNORECASE,
)
for m in hour_pat.finditer(text):
    hours_ahead = int(m.group(1))
    lat = _parse_lat(m.group(2))
    lon = _parse_lon(m.group(3))
    if lat is not None and lon is not None:
        waypoints.append({"hours_ahead": hours_ahead, "lat": lat, "lon": lon})
```

**Verification:** call `/api/storms/active` after deploy and check that at least one storm has a non-null `forecast_track` array. Compare against a recent HSF/NP raw text to confirm.

---

## Bug 3 — Pressure threshold semantics

**Severity:** Low (no current data loss, but confusing)
**File:** `backend/routes/storms.py`
**Lines:** 28, 110–112

Default config:
```python
"min_pressure_mb": 1020,
```

```python
if s.get("pressure_mb") and s["pressure_mb"] > min_pressure_mb:
    continue
```

The threshold is *inclusive of stronger storms* (lower mb), so this filter only rejects systems above 1020 mb, which is fine. But the variable name `min_pressure_mb` reads as "minimum allowed pressure" → should be `max_pressure_mb` for clarity (lower pressure = stronger storm).

Also: storms without a parsed `pressure_mb` (which happens when LLM enhancement fails) are kept by the `s.get("pressure_mb") and …` short-circuit. That's probably the right call — better to show a storm with missing pressure than drop it — but it should be explicit.

**Fix:** rename the field everywhere (`backend/config/storms_config.json`, route, frontend admin). Add a comment: `# Reject any system with central pressure ABOVE this value (high-pressure systems and weak lows)`.

---

## Bug 4 — `_storm_id` collisions when two storms share a basin and round to same lat/lon

**Severity:** Low but real
**File:** `backend/routes/storms.py`
**Lines:** 47–49

```python
def _storm_id(ocean: str, lat: float, lon: float) -> str:
    prefix = {"north-pacific": "np", "north-atlantic": "na", "south-pacific": "sp"}.get(ocean, ocean[:2])
    return f"{prefix}-{lat:.1f}-{abs(lon):.1f}"
```

Two storms 0.05° apart round to the same ID. Rare in open ocean but possible in regions like the Atlantic where multiple lows cluster.

**Fix:** include rounded `pressure_mb` as a tiebreaker, or use a hash of (lat, lon, pressure, type). Match the same ID generation in `_persist_storm_observations` (high_seas.py line 444).

---

## Bug 5 — Northern Hemisphere lows that the bulletin doesn't catch

**Severity:** Structural (not really a bug, but documenting it)

The HSF/NP bulletin focuses on storm-force and gale-force systems. Weak lows that produce surfable swell over multi-day fetch but never reach gale force are often not narrated as discrete "systems" in the bulletin — they appear as ambient low pressure in the synopsis. We miss them entirely.

**Fix:** Wait for `GLOBAL_STORM_DETECTION_PLAN.md` Phase 2 — the wind-field detector finds these by looking at pressure minima directly, not narrative wording.

---

## Bug 6 — South Atlantic, Indian Ocean, Tasman, Southern Ocean coverage

**Severity:** Structural

KWBC issues no bulletins below the equator anywhere. The Tasman lows the user spotted on Windy near New Zealand are invisible to our pipeline today. So are South Indian Ocean systems (off Western Australia, Mascarenes), the South Atlantic, and the Southern Ocean roaring forties storms that drive most of the swell hitting West Coast SA, central Pacific reefs, and California's biggest winter pulses.

**Fix:** This is the headline reason for `GLOBAL_STORM_DETECTION_PLAN.md`. Phase 1+2 of that plan delivers global coverage. No reasonable patch on the bulletin pipeline can.

---

## Bug 7 — Verified: region tab does NOT over-filter storms

**Status:** Investigated, NOT a bug.

Suspected that the "California 5" tab on the map page was filtering storms in addition to spots, hiding the Atlantic / Pacific markers users want to see. Verified by reading `frontend/src/pages/Map.jsx`:

```javascript
// Line 262-266 — storms render unconditionally, no region filter, no bounds clip
if (s.showStorms) {
  for (const storm of stormsRef.current) {
    addStormMarker(storm, curHRef.current);
  }
}

// Spots ARE region-filtered (line 281-284) and bounds-clipped (line 269-272)
```

Storms render unconditionally as long as the Storms layer toggle is on. The Atlantic-heavy clustering in the user's screenshot reflects actual bulletin coverage, not a UI bug. Closes the suspected over-filter.

---

## Bug 8 — Complex-low fragmentation (one storm narrated as N systems)

**Severity:** Medium (inflates active-storm count, fragments map markers)
**File:** `backend/high_seas.py`
**Lines:** 295–442 (parser), 430–436 (dedupe)

**Discovered via** `/api/storms/_debug` on 2026-04-26: HSF/AT1 reported a single Greenland complex low as four separate systems at 63–65°N off the south tip of Greenland with pressures 986 / 978 / 976 / 995 mb. KWBC narrates these as "COMPLEX LOW" in one section with multiple centers; our regex extracts each center as a discrete system, and `_parse_bulletin` dedupe is position-exact:

```python
# high_seas.py line 430-436
key = (round(lat, 1), round(lon, 1), sys_type)
if key in seen:
    continue
seen.add(key)
```

Storm centers spread 50–200 nm apart never collide on a 0.1° grid, so all of them survive. This is the source of George's reported 7 → ~4 inflation in the Atlantic count.

**Fix options:**

(a) **Per-section merge in `_parse_bulletin`** — when a single bulletin section mentions "COMPLEX LOW" or contains multiple center coordinates, emit one synthesized system at the centroid with the strongest pressure as the primary. Annotate `secondary_centers: [...]` for the drawer. Cleanest semantic fix.

(b) **Geographic clustering at output time** — DBSCAN-style cluster on `(lat, lon)` with eps ≈ 3° within each ocean+type, collapse cluster to its strongest member. Naive but works for any future fragmentation case.

(c) **Output-side dedupe in `routes/storms.py`** — collapse `(ocean, sys_type, round(lat/3)*3, round(lon/3)*3)` keys, keep lowest-pressure member. ~10 lines, no parser changes. Good interim if Bug 8 fix is going to lag the GFS detector.

(d) **Wait for `GLOBAL_STORM_DETECTION_PLAN.md` Phase 1+2** — the wind-field detector clusters pressure minima directly from GFS, never sees the bulletin's narrative fragmentation. **Recommended:** George explicitly called this out as the right durable fix. Bulletin parser stays as a fallback / verification source.

**Recommendation:** (d) for the durable fix. Optionally (c) as a 10-line interim if the inflated count bothers users between now and detector ship.

---

## Bug 9 — LLM enhancement value bleed across co-section systems

**Severity:** Medium (silently wrong drawer L1 numbers)
**File:** `backend/high_seas.py`
**Lines:** 530–562, function `_enhance`

**Discovered via** `/api/storms/_debug` on 2026-04-26: the four Greenland complex-low fragments above all came back from `/api/storms/active` with **identical** `wind_kts: 65` and `sea_height_ft: 38`. That's not four separate measurements — that's the section-level "WITHIN AN AREA BOUNDED BY..." peak echoed onto every system the parser found in that section.

**Root cause:** `_enhance(system)` calls `parse_bulletin_section(system["raw_text"])` (Claude Haiku) with the full multi-system section text. The LLM dutifully extracts the strongest wind and sea height it sees, but it has no way to know which coordinate that peak belongs to, so the same number gets stamped onto each `system["wind_kts"]` / `system["sea_height_ft"]` for every system whose `raw_text` slice covers the same WITHIN-AREA block.

**Fix options:**

(a) **Skip LLM enhancement when section yields ≥2 systems** — leave `wind_kts` and `sea_height_ft` null rather than stamp the same peak on every center. Drawer already handles missing fields gracefully. 5-line change.

(b) **Per-coordinate sub-block extraction** — split section text on coordinate boundaries before feeding to the LLM, so each system gets only the prose within ±N lines of its own center. More work, only justified if (a) hides too much data.

(c) **Auto-resolves with Bug 8 fix** — once complex lows are merged into a single system, there's no "co-section" anymore and the LLM call gets the right scope. **Recommended** alongside Bug 8 (d).

**Recommendation:** (a) immediately as a safety net (prevents fake-precision in the drawer), then (c) eliminates the class of bug entirely once GFS detector or per-section merge ships.

---

## Suggested fix order

1. **Bug 2** (forecast track regex) — half-day, immediate win for drawer L1.
2. **Bug 1** (rename `south-pacific` → `east-pacific`) — half-day. **Partial fix already applied** in `routes/storms.py` (`_storm_id` prefix map renames). Verify `high_seas.py` `_OCEAN_PRODUCT_MAP` and frontend labels still need the rename.
3. **Bug 3** (rename `min_pressure_mb` → `max_pressure_mb`) — bundle with #1, same surface area.
4. **Bug 9 option (a)** (skip LLM enhancement on multi-system sections) — 5-line safety patch, prevents fake-precision drawer values today.
5. **Bug 4** (storm ID collisions) — half-day, do when convenient.
6. **Bug 8 option (c)** (output-side dedupe) — optional 10-line interim if 7→4 inflation bothers users before the detector ships.
7. **Bugs 5 / 6 / 8 (d) / 9 (c)** — defer to `GLOBAL_STORM_DETECTION_PLAN.md` Phase 1+2 (wind-field detector). Per George: *"Phase 1+2 of the GFS detector is the right call — not a parser fix."*
