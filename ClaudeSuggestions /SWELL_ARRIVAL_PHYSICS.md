# Swell Arrival Physics — Implementation Notes

**Status:** 🟡 Module written — needs wiring into main.py + Copilot tool
**File:** `backend/swell_physics.py`
**Created:** 2026-04-21
**Source methodology:** Stormsurf.com
  - https://www.stormsurf.com/page2/papers/papers.shtml
  - https://www.stormsurf.com/page2/papers/calculator/about.shtml
  - https://www.stormsurf.com/page2/papers/swell_decay.html
**Related:**
  - [`SESSIONS_SCHEMA_AND_PERSONALIZATION.md`](./SESSIONS_SCHEMA_AND_PERSONALIZATION.md)
  - [`copilot_driven_architecture.md`](./copilot_driven_architecture.md)
  - `backend/copilot.py` — add `calculate_swell_arrival` tool here

---

## 1. Why This Exists — The Black Magic Made Explicit

Experienced surfers track storms manually across 5+ sites to answer one question:
**"When will this swell hit and how big will it be?"**

This module encodes the complete expert methodology into pure Python math.
No API calls. No ML. Just physics + empirical tables from 30 years of
Stormsurf observation.

The three pieces:

**Great circle distance** — haversine formula between storm center and spot.
Correct for a sphere; accurate to ~0.5% for ocean distances.

**Swell travel time** — `distance_nm ÷ speed_kts(period)`.
Swell group velocity scales with period: longer period = faster travel.
A 20s swell crosses the Pacific ~80% faster than an 11s swell.

**Swell decay size** — empirical tables mapping (storm sea height, travel distance)
to decayed swell height. Larger storms decay more slowly because they have more
energy. A 45ft storm retains 14% of height at 5,000nm vs 8.8% for a 5ft storm.

---

## 2. The Physics In Plain English

### Why period matters so much

A swell is not a single wave — it's a spectrum of wave periods all generated
simultaneously by the storm. They travel at different speeds:

- 20s period → ~31 knots → crosses 1,600nm in ~51 hours
- 17s period → ~26 knots → crosses 1,600nm in ~61 hours  
- 14s period → ~22 knots → crosses 1,600nm in ~73 hours
- 11s period → ~17 knots → crosses 1,600nm in ~94 hours

The long-period energy arrives first. Then the swell "fills in" as
progressively shorter periods arrive over the following 12-48 hours.
This is why a swell builds slowly, peaks, then fades — you're watching
the period spectrum arrive in sequence.

This explains why Blacks Beach handles 16s+ NW swells better than 11s:
longer period = more energy surviving the 1,600nm trip from the storm,
plus the La Jolla canyon amplifies longer-period energy more.

### Why distance × sea height → decay factor (not a simple formula)

Swell decay is not linear. Two effects:

1. **Dispersion spreading** — energy spreads laterally as it travels.
   A storm 5,000nm away covers a much wider arc, so less hits your beach.

2. **Energy dissipation** — smaller waves lose energy faster than larger ones.
   This is why the decay tables have different curves per sea height.

The Stormsurf tables are empirically calibrated against decades of buoy
observations — they outperform simple formula-based approximations.

### The >4,000nm correction (×0.75)

At extreme distances, swell energy spreads over such a wide arc that
even the empirical tables overestimate arrival size. The ×0.75 correction
accounts for this. Relevant for California's long-range south swells
from the Southern Ocean (4,500-6,000nm).

---

## 3. How to Wire Into main.py

```python
# Near the top of main.py, after other imports
from swell_physics import register_routes as register_swell_routes

# After app = FastAPI(...)
register_swell_routes(app)
```

Three endpoints go live:

```
POST /api/swell/arrivals     — full calculation: arrival times + decayed sizes
GET  /api/swell/decay        — single decay lookup
GET  /api/swell/distance     — great-circle distance between two points
```

Verify:
```bash
# Distance from a typical NW Pacific storm to Blacks Beach
curl "http://localhost:8000/api/swell/distance?lat1=42&lon1=-155&lat2=32.88&lon2=-117.25"
# → { "distance_nm": ~1490, "bearing_deg": ~305 }

# Decay: 36ft seas, 1,619nm away
curl "http://localhost:8000/api/swell/decay?sea_height_ft=36&distance_nm=1619"
# → { "decayed_height_ft": ~6.2, "decay_factor": ~0.172 }
```

---

## 4. The New Copilot Tool: `calculate_swell_arrival`

Add this tool to `backend/copilot.py` alongside the existing 5 tools.

```python
{
    "name": "calculate_swell_arrival",
    "description": (
        "Calculate when a storm's swell will arrive at a surf spot and how big "
        "it will be. Given storm position(s) from a wave model and a spot, "
        "returns arrival times per period band and predicted swell height after decay. "
        "Use this when the user asks about an incoming swell, 'when will it hit', "
        "'how big will it be', or 'is there anything coming'."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "spot_slug": {
                "type": "string",
                "description": "The spot slug to calculate arrivals for"
            },
            "storm_positions": {
                "type": "array",
                "description": "Storm positions from the wave model (1+ positions)",
                "items": {
                    "type": "object",
                    "properties": {
                        "lat":           {"type": "number"},
                        "lon":           {"type": "number"},
                        "timestamp":     {"type": "string", "description": "ISO 8601 UTC"},
                        "sea_height_ft": {"type": "number"},
                        "label":         {"type": "string"},
                        "confirmed":     {"type": "boolean"}
                    },
                    "required": ["lat", "lon", "timestamp", "sea_height_ft"]
                }
            },
            "off_axis":    {"type": "boolean", "default": False},
            "small_fetch": {"type": "boolean", "default": False}
        },
        "required": ["spot_slug", "storm_positions"]
    }
}
```

**Tool handler** — resolves spot coords from DB, calls `/api/swell/arrivals`,
returns the narrative + structured bands for the `swell_arrival` artifact.

---

## 5. New Artifact Type: `swell_arrival`

Add to the Copilot's component vocabulary in `Copilot.jsx`:

```javascript
// component type: "swell_arrival"
// Renders: timeline chart of period bands arriving over time
// X axis: time (next 5-7 days)
// Y axis: swell height (ft)
// Series: one line per period band (20s, 17s, 14s, 11s)
// Markers: storm positions on a mini map inset
// Annotation: "Peak: Sat 7am — 6.2ft @ 20s"
```

The structured `bands` array from the API maps directly to chart series.

---

## 6. How the Copilot Uses This End-to-End

When a user asks "Is there anything coming for next weekend?":

```
1. Copilot calls get_spot_conditions(spot_slug) to confirm which spot
2. Copilot calls get_buoy_history to see what the ocean looks like now
3. Copilot internally knows (from WW3 model data or system prompt context)
   about active North Pacific storm positions — OR it asks the user
   "I can see a storm at 42°N 155°W with 36ft seas — want me to run
   the arrival calc for Blacks?"
4. Copilot calls calculate_swell_arrival with those positions
5. Returns narrative + swell_arrival artifact:

"There's a solid NW storm (36ft seas, confirmed) at 42°N 155°W.
Here's what to expect at Blacks:

→ First long-period energy (20s): Saturday 7am
→ Swell fills in through Saturday morning
→ Peak (17s, ~6.2ft): Saturday 11am–2pm
→ Transitions to 14s Saturday evening, fading Sunday

Wednesday forecast shows light east wind Saturday morning — that's your window.
Low tide at 6:45am, rising through the morning session."

[swell_arrival chart renders below the message]
[conditions_timeline artifact for Saturday renders alongside]
```

That's the complete expert workflow — storm track → arrival calc → wind/tide
overlay — in one Copilot turn. No other surf app does this automatically.

---

## 7. Swell Window Integration

Each spot has `swell_windows` in its enrichment data (from the AI enrichment pipeline).
The `calculate_swell_arrival` tool should check the storm's bearing against the
spot's swell window before running the calc:

```python
swell_from_bearing = bearing_deg(spot_lat, spot_lon, storm_lat, storm_lon)

# Check if bearing falls inside spot's swell window
if not spot_in_swell_window(swell_from_bearing, spot.swell_windows):
    # Still calculate, but flag it in the response:
    # "Note: this storm is outside Blacks' optimal swell window (270-330°).
    #  The swell will be heavily refracted or blocked."
```

This is where the Wannasurf + AI enrichment data becomes directly actionable
in the forecast — not just a static description, but a live filter on incoming storms.

---

## 8. Validation Tests

Run these to verify the physics matches Stormsurf's reference results:

```python
from swell_physics import great_circle_nm, decay_size, swell_arrivals, StormPosition
from datetime import datetime, timezone

# Test 1: Distance (from Stormsurf papers.shtml example)
# Storm at 45°N 175°W, buoy at 34°14'N 129°58'W
d = great_circle_nm(45, -175, 34.233, -129.97)
assert 2140 < d < 2165, f"Expected ~2153nm, got {d}"

# Test 2: Decay (from swell_decay.html example)
# 30ft seas, 1700nm → factor 0.2325 → height 6.975ft
h = decay_size(30, 1700)
assert 6.8 < h < 7.2, f"Expected ~6.98ft, got {h}"

# Test 3: Arrival time
# Thurs AM storm (1619nm, 20s period, 31.2kts) → ~52 hours
from swell_physics import speed_from_period
speed = speed_from_period(20)
travel = 1619 / speed
assert 50 < travel < 54, f"Expected ~52 hrs, got {travel:.1f}"

print("All physics tests passed ✓")
```

Add these to `backend/test_swell_physics.py`.

---

## 9. Limitations & Future Work

**Storm position source.** This module is pure math — it needs storm positions
as input. Currently the Copilot would need to extract these from the WW3 model
data that's already flowing through the backend. A dedicated
`scan_active_storms(ocean, swell_window)` tool that reads WW3 high-seas output
and returns candidate storm positions would complete the loop.
This is the next major Copilot tool to build after `calculate_swell_arrival` ships.

**Wave height vs. surf height.** The decay tables output open-ocean significant
wave height (Hs). The `calculate_surf_height()` function already in `main.py`
applies the Hs → surf face height conversion (period-dependent scaling).
The Copilot's narrative should present surf height, not Hs.
Wire: `surf_height = calculate_surf_height(decayed_hs, peak_period)`.

**Southern Hemisphere swells.** The same physics applies — just different
bearing and distance. California's south swells from the Southern Ocean
(May–September) travel 5,000–6,000nm. The >4,000nm correction is critical here.

**Multi-storm interference.** When two storms generate swells arriving within
6-8 hours of each other (Stormsurf calls this "virtual fetch"), the number of
waves per set increases. The calculator's peak clustering graph detects this.
Not currently implemented — worth adding when the storm scanning tool ships.

---

**Last updated:** 2026-04-21
**Next steps:**
1. Wire `register_swell_routes(app)` into `main.py`
2. Add `calculate_swell_arrival` tool to `backend/copilot.py`
3. Add `swell_arrival` artifact renderer to `Copilot.jsx`
4. Build `scan_active_storms` tool to auto-extract storm positions from WW3
5. Run validation tests in `backend/test_swell_physics.py`
