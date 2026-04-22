# Tides Endpoint — Implementation Notes

**Status:** 🟡 Ready to wire — `backend/tides.py` written, needs registering in `main.py`
**File:** `backend/tides.py`
**Created:** 2026-04-21
**Related:**
- [`SESSIONS_SCHEMA_AND_PERSONALIZATION.md`](./SESSIONS_SCHEMA_AND_PERSONALIZATION.md) — auto-pop job uses `/api/tides/hilo`
- [`backend/migrations/007_add_spot_columns.sql`](../backend/migrations/007_add_spot_columns.sql) — seeds `tide_station_id` per spot
- `frontend/src/Copilot.jsx` — `conditions_timeline` artifact needs to merge tide data

---

## 1. What Was Built

`backend/tides.py` provides two FastAPI endpoints and the supporting logic:

### `GET /api/tides/timeline`
Hourly tide predictions for a spot, 1-30 days out.

**Params:**
- `spot_slug` — resolves `tide_station_id` from Supabase `spots` table
- `station` — override: explicit NOAA CO-OPS station ID (bypasses DB lookup)
- `days` — integer 1-30, default 7

**Response:**
```json
{
  "station_id": "9410230",
  "station_name": "La Jolla, CA",
  "spot_slug": "blacks-beach",
  "unit": "ft",
  "datum": "MLLW",
  "timeline": [
    { "t": "2026-04-23 06:00", "v": 2.34, "state": "rising_low",
      "is_high": false, "is_low": false },
    ...
  ],
  "hilo": [
    { "t": "2026-04-23 08:12", "v": 4.56, "type": "H" },
    { "t": "2026-04-23 14:33", "v": 0.82, "type": "L" },
    ...
  ]
}
```

### `GET /api/tides/hilo`
Hi/lo events for a station + date range. Used by the session auto-population
job to determine tide state at a historical session time (past or future).

**Params:**
- `station` — NOAA CO-OPS station ID (required)
- `begin_date` — YYYYMMDD
- `end_date` — YYYYMMDD

---

## 2. How to Wire Into main.py

Add **two lines** near the top of `backend/main.py`, after the app is created:

```python
# Near the top of main.py, after other imports
from tides import register_routes as register_tide_routes

# After `app = FastAPI(...)` is created (around line 100)
register_tide_routes(app)
```

That's it. The two endpoints will be live.

**Verify with:**
```bash
curl "http://localhost:8000/api/tides/timeline?spot_slug=blacks-beach&days=3"
curl "http://localhost:8000/api/tides/hilo?station=9410230&begin_date=20260421&end_date=20260423"
```

---

## 3. How to Merge Into the conditions_timeline Artifact

The `conditions_timeline` artifact in `Copilot.jsx` currently renders
wave height and wind from `/api/surf-spots/{slug}/forecast-timeline`.

Tide data needs to be fetched in parallel and merged by timestamp.

### In `Copilot.jsx` (or a new `useTideData` hook):

```javascript
// Fetch tide data alongside forecast timeline
const [forecastData, tideData] = await Promise.all([
  fetch(`/api/surf-spots/${spotId}/forecast-timeline?hours=168`).then(r => r.json()),
  fetch(`/api/tides/timeline?spot_slug=${spotId}&days=7`).then(r => r.json()),
]);

// Build a lookup map from tide timeline: { "2026-04-23 06:00": { v, state } }
const tideByHour = {};
(tideData.timeline || []).forEach(p => {
  // CO-OPS returns "2026-04-23 06:00" — normalize to match forecast "hour" offsets
  tideByHour[p.t] = p;
});

// Merge: add tide fields to each forecast point
const merged = forecastData.timeline.map(point => {
  // Convert forecast hour offset to a wall-clock time string for lookup
  const wallTime = offsetToWallTime(forecastData.generated_at, point.hour);
  const tide = tideByHour[wallTime] || null;
  return {
    ...point,
    tide_ft:    tide?.v     ?? null,
    tide_state: tide?.state ?? null,
  };
});
```

The `offsetToWallTime` helper converts `forecast_hour=6` + a base timestamp
into a local time string matching the CO-OPS format (`"2026-04-23 06:00"`).

### In the chart renderer:
Add a third track to the timeline chart:
- Wave height: blue area chart
- Wind speed: grey line
- Tide height: teal area chart (secondary Y axis, 0-6ft range)

Overlay `hilo` events as labelled markers (▲ High / ▼ Low) on the tide track.

---

## 4. Data Source Details

**NOAA CO-OPS predictions:**
- URL: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
- Product: `predictions` (harmonic — always available for future dates)
- Datum: MLLW (Mean Lower Low Water) — standard surf reference
- Interval: `h` (hourly) for timeline; `hilo` for hi/low events
- Units: `english` (feet)
- Time zone: `lst_ldt` (station's local standard/daylight time)
- No API key required. Include `application=MySurfLife` as courtesy.

**Why harmonic predictions, not observed water levels:**
- Predictions are available for any future date (up to 1 year)
- Observed levels only go back 45 days
- For surf forecasting, harmonic predictions are accurate enough
  (astronomical tide dominates; storm surge is a separate signal)

**Why MLLW datum:**
- Surf forecasters read tide in feet above/below MLLW by convention
- MLLW is the CO-OPS standard for US West Coast

---

## 5. Tide State Logic

The `state` field on each hourly point is derived from the hi/lo cycle,
not from absolute height thresholds. This makes it consistent across
spots with very different tidal ranges (1.5ft neap vs 6ft spring).

```
near low  (within 1h of local minimum) → "low"
rising, bottom third of range          → "rising_low"
rising, middle third                   → "mid"
rising, top third                      → "rising_high"
near high (within 1h of local maximum) → "high"
falling (any height)                   → "falling"
```

This matches the language in `sessions.actual_tide_state` exactly,
so session auto-population can use the same vocabulary.

---

## 6. Caching

Tide predictions are **deterministic** (harmonic math — same answer every time
for the same date range). Cache aggressively:

- L1 in-memory: 6-hour TTL (in `tides.py` `_tide_cache`)
- L2 Redis: If you want Redis caching, add this to `tides.py` `_cache_get/set`
  using the same pattern as `main.py`. Key: `tides:{station_id}:{begin}:{end}`

No need to invalidate — predictions don't change.

---

## 7. Station ID Resolution Priority

When given a `spot_slug`:

1. **Supabase DB** — `spots.tide_station_id` (seeded by migration 007)
2. **Fallback map** — `_FALLBACK_STATIONS` dict in `tides.py` covers the full CA coast + Hawaii
3. **Default** — San Diego (9410170) if nothing matches

For international spots (added during global expansion):
- EMODnet and other international tide sources will need adapters
- The fallback map should grow alongside the buoy adapters in `GLOBAL_DATA_EXPANSION_PLAN.md`
- For now, non-US spots return a 422 with a clear error message

---

## 8. Session Auto-Population Integration

The `populate_session_conditions.py` job uses `/api/tides/hilo` to
determine tide state at a historical session time:

```python
# Given: station_id, session_date, start_time
hilo = await fetch_hilo(station_id, session_date - 1day, session_date + 1day)

# Find the surrounding hi/lo events
before = [e for e in hilo if e['t'] <= session_start_time]
after  = [e for e in hilo if e['t'] > session_start_time]

last_extreme = before[-1] if before else None
next_extreme = after[0] if after else None

# Determine state from the phase between extremes
tide_state = _classify_tide_state(last_extreme, next_extreme, session_start_time)
tide_height = _interpolate_height(last_extreme, next_extreme, session_start_time)
```

---

## 9. Validation Checklist (for Claude Code)

Before deploying:
- [ ] `from tides import register_routes as register_tide_routes` added to `main.py`
- [ ] `register_tide_routes(app)` called after `app = FastAPI(...)`
- [ ] `httpx` in `requirements.txt` (it's likely already there — verify)
- [ ] Smoke test: `curl "http://localhost:8000/api/tides/timeline?spot_slug=blacks-beach&days=2"`
      returns JSON with `timeline` array of hourly points and `hilo` array of events
- [ ] All `state` values in response are one of: `low, rising_low, mid, rising_high, high, falling`
- [ ] `conditions_timeline` artifact in `Copilot.jsx` updated to fetch + merge tide data
- [ ] Tide track renders in the chart with hi/lo markers

---

## 10. Known Limitations / Future Work

**Storm surge not modeled.** CO-OPS `predictions` is harmonic only.
During major swells, actual water levels can differ significantly from predictions
due to wave setup and storm surge. This is acceptable for surf forecasting —
surfers care about the astronomical tide phase, not storm surge.

**International spots.** CO-OPS only covers US + territories.
International tide sources (EMODnet, BOM Australia, SHOM France) will be needed
for the global expansion. The `_resolve_station` function is designed to be
extended — add non-NOAA adapters in `backend/tide_adapters/` following the
same pattern as the buoy adapters.

**Tide station accuracy.** Some spots are 20-30 miles from their nearest
CO-OPS station. The time offset (tide arrives at a different time than the
station) is not currently corrected. For most spots this is ±10-20 minutes —
acceptable for surf forecasting. High-accuracy use cases can use CO-OPS
subordinate station corrections (not currently implemented).

---

**Last updated:** 2026-04-21
**Next steps:**
1. Wire `register_tide_routes(app)` into `main.py`
2. Merge tide data into `conditions_timeline` artifact in `Copilot.jsx`
3. Add tide track to chart renderer
4. Add tide state to session auto-pop job (`populate_session_conditions.py`)
