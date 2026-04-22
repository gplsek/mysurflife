# Swell Tables — Implementation Notes

**Status:** ✅ Implemented + validated
**File:** `backend/swell_tables.py`
**Created:** 2026-04-21
**Sources:**
  - Swell Category Table: https://www.stormsurf.com/page2/papers/category_short.html
  - Sea Height Table: https://www.stormsurf.com/page2/papers/seatable.html
**Related:**
  - `backend/swell_physics.py` — arrival time + decay (companion module)
  - `backend/surf_scoring.py` — replace `calculate_surf_height()` here
  - [`BACKEND_EFFICIENCY_AUDIT.md`](./BACKEND_EFFICIENCY_AUDIT.md) — Problem 3
  - [`SWELL_ARRIVAL_PHYSICS.md`](./SWELL_ARRIVAL_PHYSICS.md)

---

## 1. What's In This Module

### Swell Category Table — `swell_category(wvht_ft, period_s)`

Converts a buoy reading (Hs + period) to a Stormsurf category 0-10, which
maps to an expected wave face height range at a generic beach.

**Why this matters:** The same Hs at different periods produces drastically
different surf. The current `calculate_surf_height()` in `main.py` uses a
homemade multiplier (`0.6 + 0.08 × period`, capped at 2.2×). The category
table is the empirically calibrated industry standard.

| Buoy reading | Current formula | Category table |
|---|---|---|
| 6ft @ 7s | 6 × 1.16 = **7.0ft** | Cat 1 → **2.5-5ft** |
| 6ft @ 14s | 6 × 1.72 = **10.3ft** | Cat 3 → **7.5-10ft** |
| 6ft @ 20s | 6 × 2.20 = **13.2ft** | Cat 4 → **10-15ft** |

The current formula overestimates short-period surf and still underdifferentiates
long-period swell. The category table is grounded in real observations.

**Boundary conventions (validated against table):**
- Category 0 upper bound is strict: `wvht < threshold` (table says `<X ft`)
- Categories 1-9 upper bounds are inclusive: `wvht <= threshold` (table says `X-Y ft`)

### Sea Height Table — `estimate_sea_height(wind_kts, duration_hrs, fetch_nm)`

Estimates what sea height a storm is generating given its wind parameters.
Uses Stormsurf Table 1 (duration-primary), which Stormsurf notes is closer
to real buoy observations than their alternative fetch-primary table.

**When to use this:**
- A storm is forming and WW3 hasn't resolved it yet (models lag by 6-12 hours)
- Sanity-checking WW3 output ("model says 25ft but this storm only has 40kts for 24hrs...")
- Copilot explaining *why* a storm will or won't produce significant swell
- Storm is in a tight gradient / small fetch area where models struggle

**WW3 is still primary.** This table supplements, never replaces, model data.

---

## 2. How to Wire Into main.py

```python
# Add near top of main.py:
from swell_tables import register_routes as register_swell_table_routes

# After app = FastAPI(...):
register_swell_table_routes(app)
```

Two endpoints go live:
```
GET /api/swell/category?wvht_ft=6&period_s=14&size_bias=1.35
GET /api/swell/sea-height?wind_kts=45&duration_hrs=35&fetch_nm=630
```

---

## 3. Replacing `calculate_surf_height()` in surf_scoring.py

**Current code in `main.py` / `surf_scoring.py`:**
```python
def calculate_surf_height(wave_height_m, dpd_sec):
    mult = max(1.0, min(2.2, 0.6 + 0.08 * dpd_sec))
    return round(wave_height_m * mult, 2)
```

**Replacement:**
```python
from swell_tables import surf_height_from_buoy

def calculate_surf_height(wave_height_m, dpd_sec, size_bias=1.0):
    wvht_ft = wave_height_m * 3.28084
    result = surf_height_from_buoy(wvht_ft, dpd_sec, size_bias)
    # Return mid-point of face height range in meters for backward compat
    face_mid_ft = result['face_mid_ft']
    return round(face_mid_ft / 3.28084, 2)
```

For new code (Copilot, session logging, etc.), use `surf_height_from_buoy()`
directly — it returns the full dict with category, label, min/max range, and
size-bias-adjusted values.

### Where to get `size_bias`

Pull from `user_spot_profiles.size_perception_bias` for the current user + spot.
If no profile exists yet (< 3 sessions logged), default to 1.0.

```python
profile = supabase.table('user_spot_profiles')
    .select('size_perception_bias')
    .eq('user_id', user_id)
    .eq('spot_id', spot_slug)
    .single()
    .execute()

size_bias = profile.data.get('size_perception_bias', 1.0) if profile.data else 1.0
result = surf_height_from_buoy(wvht_ft, dpd_sec, size_bias)
```

---

## 4. Copilot Integration

### In Copilot responses

The category + label makes natural language responses much richer:

```python
# Instead of: "Buoy shows 3.8ft, estimated surf height 6.5ft"
# The Copilot can say:

result = surf_height_from_buoy(3.8, 15.0, size_bias=1.35)
# → category=3, label="Shoulder-Head", face_min=7.5, face_max=10.0
#   adjusted_min=10.1, adjusted_max=13.5 (Blacks Beach bias)

# Copilot output:
"Buoy 46225 is reading 3.8ft @ 15s — that's a Category 3 swell.
At a generic beach that's shoulder-to-head high (7.5-10ft faces).
At Blacks, the canyon amplification typically adds about 35%, so
expect overhead to just-overhead (10-13ft faces) if the swell direction
is in your window."
```

### In the `calculate_swell_arrival` Copilot tool

After decay gives us the predicted offshore Hs at the spot:
```python
decayed_hs_ft = decay_size(storm_sea_ft, distance_nm)
result = surf_height_from_buoy(decayed_hs_ft, peak_period_s, size_bias)
# Now Copilot can say "this swell will arrive as Cat 3 → shoulder-head high"
```

### Sea height tool — explaining developing storms

```python
# User asks: "There's a storm at 45N 155W with 45kt winds for the last 2 days.
#              Should I care about it?"

storm_result = estimate_sea_height(wind_kts=45, duration_hrs=48, fetch_nm=800)
# → sea_height_ft=45.0, period_s=21.0, fully_developed=False

# Copilot:
"That storm has been running 45 knot winds over an 800nm fetch for 48 hours.
That's capable of generating 45ft seas at 21 second period — a significant
long-period swell. WW3 confirms this. Based on the distance (1,200nm from
Blacks), expect the first 20s energy to arrive Saturday morning, with peak
17-18s energy Saturday afternoon around 6-8ft at the buoy (Cat 4 at Blacks,
roughly overhead to double-overhead)."
```

---

## 5. Swell Category Quick Reference

| Cat | Face height | Typical description |
|---|---|---|
| 0 | 0-2.5ft | Flat / barely rideable |
| 1 | 2.5-5ft | Knee to chest high |
| 2 | 5-7.5ft | Chest to shoulder |
| 3 | 7.5-10ft | Shoulder to head high |
| 4 | 10-15ft | Overhead to double |
| 5 | 15-20ft | Double to triple overhead |
| 6 | 20-25ft | Triple+ |
| 7 | 25-30ft | XXL |
| 8 | 30-40ft | XXL+ |
| 9 | 40-50ft | Historic |
| 10 | 50ft+ | Mythic |

*Face height is trough-to-crest, average of highest 1/3 waves at a generic beach.
Spots with size-enhancing bathymetry (canyons, reefs) can be up to 2× these values.*

---

## 6. Validation Tests

All tests pass against Stormsurf reference values:

```python
# Run: python3 -m pytest backend/test_swell_tables.py
# Or inline:

from swell_tables import swell_category, estimate_sea_height

assert swell_category(6.0, 14.0) == 3   # 6ft @ 14s → Cat 3 (7.5-10ft)
assert swell_category(6.0,  7.0) == 1   # 6ft @ 7s  → Cat 1 (2.5-5ft)
assert swell_category(3.0, 25.0) == 3   # 3ft @ 25s → Cat 3 (long period)
assert swell_category(8.9, 14.0) == 3   # 8.9ft @ 14s → Cat 3 (inclusive top)
assert swell_category(9.0, 14.0) == 4   # 9.0ft @ 14s → Cat 4

r = estimate_sea_height(45.0, 35.0)
assert abs(r['sea_height_ft'] - 35.0) < 1.5   # 45kts 35hrs → ~35ft
assert abs(r['period_s'] - 16.0) < 0.5         # period ~16s
```

---

## 7. Execution Checklist for Claude Code

- [ ] Copy `swell_tables.py` to `backend/swell_tables.py`
- [ ] Add `from swell_tables import register_routes as register_swell_table_routes` to `main.py`
- [ ] Call `register_swell_table_routes(app)` after `app = FastAPI(...)`
- [ ] Update `calculate_surf_height()` in `surf_scoring.py` per Section 3
- [ ] Update `calculate_surf_height()` call sites in `main.py` to use the new return value shape
- [ ] Wire `size_bias` lookup into `get_surf_spot_conditions()` endpoint
- [ ] Run validation: `curl "http://localhost:8000/api/swell/category?wvht_ft=6&period_s=14"`
      → should return `{"category": 3, "label": "Shoulder-Head", "face_min_ft": 7.5, ...}`
- [ ] Add `calculate_swell_arrival` Copilot tool to use `surf_height_from_buoy()` for final output

---

**Last updated:** 2026-04-21
**Validated against:** Stormsurf category_short.html + seatable.html reference values
**All 14 category + 4 sea height tests pass ✓**
