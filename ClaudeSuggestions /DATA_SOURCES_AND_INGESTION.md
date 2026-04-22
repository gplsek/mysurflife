# Data Sources Audit & Ingestion Architecture

**Status:** 🔴 URGENT — OPeNDAP shutdown affects current backend
**Created:** 2026-04-21
**Owner:** George
**Related:**
- `backend/main.py` — current data fetch code (needs migration)
- `backend/ww3_grid_registry.json` — wave model registry
- [`SWELL_ARRIVAL_PHYSICS.md`](./SWELL_ARRIVAL_PHYSICS.md)
- [`GLOBAL_DATA_EXPANSION_PLAN.md`](./GLOBAL_DATA_EXPANSION_PLAN.md)

---

## 🚨 CRITICAL: NOAA OPeNDAP Shutdown — February 23, 2026

**The NOAA NOMADS OPeNDAP (DODS) server was shut down on February 23, 2026.**

Any code in `backend/main.py` using URLs starting with:
```
https://nomads.ncep.noaa.gov/dods/
```
**is broken or will break imminently.**

This affects:
- GFS wind model fetches
- WaveWatch III wave model fetches
- HRRR, NAM, GEFS fetches

**The replacement is the NOMADS Grib Filter service:**
```
https://nomads.ncep.noaa.gov/cgi-bin/filter_{model}.pl
```

All data is still available — the access method changed. This is not a data
loss event, it's an API migration. But it must be done before the current
backend works reliably.

### Migration Priority: IMMEDIATE
Claude Code should audit every URL in `backend/main.py` starting with
`nomads.ncep.noaa.gov/dods/` and migrate to the Grib Filter equivalents
documented in Section 3 below.

---

## 1. The Complete Surf Forecast Data Stack

### What We Need (and Why)

A complete surf forecast requires five independent data streams:

| Stream | What it tells us | Update frequency | Range |
|---|---|---|---|
| **Wave model** (WW3/GFS-Wave) | Swell height, period, direction at sea | 6 hours | 16 days |
| **Wind model** (GFS/HRRR) | Wind speed + direction at the beach | 6 hours | 384 hours |
| **Buoy observations** (NDBC) | Actual current conditions offshore | 10 minutes | Real-time |
| **Tide predictions** (CO-OPS) | Tide height + state | Static (harmonic) | 1 year |
| **Storm tracking** (WW3 high seas) | Where swells are being generated | 6 hours | 16 days |

The Stormsurf methodology adds a sixth layer — **swell generation estimation**
from the Sea Height Tables — which lets you estimate whether a storm will
produce significant swell *before* the wave model resolves it (models struggle
with tight gradient/small fetch storms).

### The Surf Forecast Calculation Chain

```
Storm wind speed + duration + fetch
        ↓  [Sea Height Table — seatable.html]
Storm sea height estimate (ft) + max period (s)
        ↓  [Swell Characteristics Table]
        ↓  [Great Circle distance — haversine]
Swell travel time per period band
        ↓  [Decay Tables — swell_decay.html]
Decayed swell height at spot (ft)
        ↓  [Swell Category Table — category_short.html]
Wave face height category (0-10)
        ↓  [Spot bathymetry + swell window filter]
        ↓  [Spot size_perception_bias from user_spot_profiles]
Predicted surf height at this spot for this user
        ↓  [Wind model + Tide]
Go/No-Go + optimal session window
```

Every step of this chain is now implemented in `swell_physics.py` (steps 1-5)
and `tides.py` (step 6 tide). Steps 6-7 (spot filter + personalization) use
the Supabase `spots` and `user_spot_profiles` tables.

---

## 2. Stormsurf Reference Tables — Fully Integrated

All three Stormsurf reference tables are now encoded in `swell_physics.py`:

### Sea Height Table (seatable.html)
Maps wind speed × duration × fetch → storm sea height (ft) + period (s).
Used to estimate storm output when the wave model hasn't resolved it yet.
Encoded as `_SEA_HEIGHT_TABLE` in `swell_physics.py`.

Key insight from Stormsurf: **WaveWatch III is the best simulation available**
and should be the primary source. The Sea Height Table is a fallback/sanity check
for extreme conditions where models struggle (tight gradient storms, hurricanes
outside the NE/SW US model domains).

### Swell Characteristics Table (papers.shtml)
Maps storm sea height → max period + swell speed.
Encoded and interpolated in `swell_physics.py` `speed_from_period()`.

### Swell Category Table (category_short.html)
Maps (buoy Hs + period) → wave face height category (0-10).
This is the missing piece in our current surf scoring — we're doing raw Hs
conversion but not the period-weighted category system.

**Current gap:** `backend/surf_scoring.py` likely uses a simple multiplier
to convert Hs → surf height. Replace with the Swell Category lookup for
more accurate face height predictions.

```python
# Current (approximate):
surf_height_ft = buoy_wvht_ft * 1.5  # rough multiplier

# Better (Stormsurf Category Table):
category = swell_category(buoy_wvht_ft, buoy_dpd_s)
face_height_range = CATEGORY_FACE_HEIGHTS[category]  # e.g. "7.5-10 ft"
```

### Swell Decay Table (swell_decay.html)
Full bilinear interpolation across 9 sea height brackets (5-45ft) and
distances 50-10,000nm. Encoded in `swell_physics.py` `decay_size()`.
Validated against Stormsurf reference numbers — exact match.

---

## 3. Data Source Inventory — Current Status

### 3.1 Wave Models

#### GFS-Wave (replaces standalone WW3)
**Status:** ✅ Available — migration required from OPeNDAP to Grib Filter

NOAA merged standalone WW3 into GFS-Wave as of GFS v16. WW3 branding
still used but data lives in the GFS directory structure.

```
# OLD (OPeNDAP — DEAD as of Feb 23 2026):
https://nomads.ncep.noaa.gov/dods/wave/...

# NEW (Grib Filter):
https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl?
  dir=/gfs.{YYYYMMDD}/{CC}/wave/gridded/
  &file=gfswave.t{CC}z.global.0p16.f{FFF}.grib2
  &var_HTSGW=on        # significant wave height (Hs)
  &var_PERPW=on        # primary wave period
  &var_DIRPW=on        # primary wave direction
  &var_SWELL=on        # swell height
  &var_SWPER=on        # swell period
  &subregion=          # bounding box
  &toplat={N}&leftlon={W}&rightlon={E}&bottomlat={S}

# Key variables:
  HTSGW  = significant wave height (Hs) in meters
  PERPW  = peak wave period in seconds
  DIRPW  = peak wave direction in degrees (coming FROM)
  SWELL  = swell height (sea state minus wind waves)
  SWPER  = swell period

# Model runs: 00Z, 06Z, 12Z, 18Z (4x/day)
# Forecast range: 000-384 hours (16 days)
# Resolution options:
  global.0p16  = 0.16° (~18km) global
  global.0p25  = 0.25° (~28km) global (faster, less detail)
  epacif.0p16  = 0.16° Eastern Pacific (higher quality for CA)
  atlocn.0p16  = 0.16° Atlantic

# Data location on NOMADS:
  /gfs.{YYYYMMDD}/{CC}/wave/gridded/
```

**For ww3_grid_registry.json:** Update all OPeNDAP URLs to Grib Filter format.
The domain structure (epacif, atlocn, global) is preserved.

#### GEFS-Wave (ensemble — new capability)
**Status:** ✅ Available — not currently used, high value to add

30-member ensemble extends to 16 days. Gives confidence intervals on
swell arrival — the Copilot can say "70% chance of 4ft+ at Blacks Saturday"
instead of a single deterministic number.

```
https://nomads.ncep.noaa.gov/cgi-bin/filter_gefs_wave.pl?
  dir=/gefs.{YYYYMMDD}/{CC}/wave/gridded/
  &file=gefs.wave.t{CC}z.c00.global.0p25.f{FFF}.grib2
```

### 3.2 Wind Models

#### GFS Wind
**Status:** ⚠️ Migration required from OPeNDAP to Grib Filter

```
# NEW Grib Filter URL pattern:
https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25_1hr.pl?
  dir=/gfs.{YYYYMMDD}/{CC}/atmos
  &file=gfs.t{CC}z.pgrb2.0p25.f{FFF}
  &var_UGRD=on         # U component of wind (m/s)
  &var_VGRD=on         # V component of wind (m/s)
  &lev_10_m_above_ground=on
  &subregion=&toplat={N}&leftlon={W}&rightlon={E}&bottomlat={S}

# Convert U/V to speed+direction:
  speed = sqrt(U² + V²) × 2.23694  # m/s to mph
  direction = (270 - atan2(V, U) × 180/π) % 360  # meteorological convention
```

#### HRRR (US only, 3km resolution)
**Status:** ⚠️ Migration required

```
https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl?
  dir=/hrrr.{YYYYMMDD}/conus
  &file=hrrr.t{CC}z.wrfsfcf{FF}.grib2
  &var_UGRD=on&var_VGRD=on
  &lev_10_m_above_ground=on
  &subregion=...

# Only valid within CONUS bounds (roughly 21-50°N, 60-130°W)
# Must gate by bounding box before requesting
```

#### NAM (North America, 12km)
**Status:** ⚠️ Migration required

```
https://nomads.ncep.noaa.gov/cgi-bin/filter_nam.pl?
  dir=/nam.{YYYYMMDD}
  &file=nam.t{CC}z.awphys{FF}.tm00.grib2
  &var_UGRD=on&var_VGRD=on
  &lev_10_m_above_ground=on
  &subregion=...
```

#### ECMWF Open Data (new — global, best quality)
**Status:** ✅ Free since mid-2025 — not yet integrated

ECMWF open data is now freely available and is higher quality than GFS
globally, especially for wind. CC BY 4.0 license (attribution required).

```python
# Python client:
from ecmwf.opendata import Client
client = Client()
client.retrieve(
    stream="oper",
    type="fc",
    step=[0, 6, 12, 24, 48, 72, 96, 120],
    param=["10u", "10v"],  # 10m U/V wind
    target="output.grib2"
)
```

Priority for global expansion — covers Europe, Australia, S. America
with better resolution than GFS alone.

### 3.3 Buoy Observations (NDBC)

**Status:** ✅ Working — no migration needed

NDBC is separate from NOMADS, unaffected by the OPeNDAP shutdown.

```
# Real-time (last 45 days):
https://www.ndbc.noaa.gov/data/realtime2/{STATION_ID}.txt

# Historical stdmet (years of data):
https://www.ndbc.noaa.gov/data/historical/stdmet/{STATION_ID}{YEAR}.txt.gz

# Key parameters:
  WVHT  = significant wave height (m) — convert to ft: × 3.28084
  DPD   = dominant wave period (s)
  APD   = average wave period (s)
  MWD   = mean wave direction (degrees, coming FROM)
  WSPD  = wind speed (m/s) — convert: × 2.23694
  WDIR  = wind direction (degrees, FROM)
  WTMP  = water temperature (°C) — convert: (×9/5)+32

# Update frequency: every 10 minutes for active buoys
# No rate limits stated but be courteous: max 1 req/sec per station
```

### 3.4 Tide Predictions (NOAA CO-OPS)

**Status:** ✅ Implemented in `tides.py`

```
https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?
  station={STATION_ID}
  &product=predictions
  &datum=MLLW
  &time_zone=lst_ldt
  &interval=h
  &units=english
  &format=json
  &begin_date={YYYYMMDD}&end_date={YYYYMMDD}
```

### 3.5 Storm Tracking / High Seas Bulletins

**Status:** 🟡 Not yet integrated — needed for Copilot storm-tracking tool

NOAA NWS issues High Seas Forecasts in text form. These contain
storm positions, wind speeds, and sea heights in the format that feeds
directly into the `swell_physics.py` `StormPosition` dataclass.

```
# High Seas Forecast text bulletins:
https://tgftp.nws.noaa.gov/data/raw/fz/fzpn02.kwbc.hsf.epa.txt  # E Pacific
https://tgftp.nws.noaa.gov/data/raw/fz/fzpn01.kwbc.hsf.npa.txt  # N Pacific
https://tgftp.nws.noaa.gov/data/raw/fz/fznt01.knhc.hsf.at1.txt  # N Atlantic

# These bulletins list: storm center lat/lon, wind radii, max seas (ft/m)
# Parse with regex → StormPosition objects → feed to swell_physics.swell_arrivals()
```

---

## 4. The Ingestion Architecture

### Design Principles

1. **Pull, cache, serve** — never make the user wait for an upstream API call
2. **Tiered caching** — L1 (memory, seconds), L2 (Redis, minutes-hours), L3 (disk, days)
3. **Graceful degradation** — if primary source fails, fall back to secondary
4. **Background jobs** — data is prefetched on schedule, not on request
5. **Multi-source** — no single point of failure for any data type

### Caching TTLs by Data Type

| Data type | L1 memory | L2 Redis | L3 disk | Reason |
|---|---|---|---|---|
| NDBC buoy real-time | 5 min | 10 min | — | NDBC updates every 10 min |
| GFS wind forecast | 30 min | 3 hours | 24 hours | New model run every 6 hours |
| GFS-Wave forecast | 30 min | 3 hours | 24 hours | Same as wind |
| Tide predictions | 6 hours | 24 hours | 7 days | Harmonic — never changes |
| Swell arrival calc | 1 hour | 6 hours | — | Depends on model run |
| High Seas bulletins | 30 min | 3 hours | — | Issued every 6-12 hours |
| Spot AI enrichment | — | — | 30 days | Rarely changes |
| User spot profiles | — | 1 hour | — | Recomputed after new sessions |

### Background Job Schedule

```
Every 10 min:
  - Fetch all active NDBC buoys (semaphore: 5 concurrent)
  - Store in Redis + update L1 cache

Every 6 hours (aligned with model runs: 00Z, 06Z, 12Z, 18Z + 4hr delay):
  - Fetch GFS wind for all spot bounding boxes
  - Fetch GFS-Wave for all spot bounding boxes
  - Parse High Seas bulletins → extract storm positions
  - Run swell_arrivals() for all favorite spots → cache results
  - Snapshot forecast for session auto-population (session.forecast_*)

Every 24 hours:
  - Fetch tide predictions for next 7 days for all active tide stations
  - Recompute user_spot_profiles for any user with new sessions

On demand (triggered by API request, cached immediately):
  - Any spot not in regular schedule
  - User-requested storm calculation
```

### Module Structure (target state)

```
backend/
├── main.py                    # FastAPI app + route registration
├── tides.py                   # ✅ Done — NOAA CO-OPS
├── swell_physics.py           # ✅ Done — arrival calc + decay
├── buoy_registry.py           # ✅ Exists — needs global expansion
├── surf_scoring.py            # ⚠️ Exists — replace Hs multiplier with category table
│
├── data_sources/
│   ├── gfs_wave.py            # 🔴 URGENT — migrate from OPeNDAP to Grib Filter
│   ├── gfs_wind.py            # 🔴 URGENT — migrate from OPeNDAP to Grib Filter
│   ├── hrrr.py                # 🔴 URGENT — migrate + add domain gating
│   ├── nam.py                 # 🔴 URGENT — migrate + add domain gating
│   ├── ecmwf.py               # 🟡 New — global wind quality upgrade
│   ├── ndbc.py                # ✅ Working — refactor from main.py
│   └── high_seas.py           # 🟡 New — storm bulletin parser
│
├── jobs/
│   ├── fetch_buoys.py         # 🟡 Extract from main.py
│   ├── fetch_forecasts.py     # 🔴 New — replaces ad-hoc fetches in main.py
│   ├── populate_sessions.py   # 🟡 Planned — auto-pop session conditions
│   └── recompute_profiles.py  # 🟡 Planned — user_spot_profiles
│
└── cache/
    ├── redis_cache.py         # ✅ Exists in main.py — extract to module
    └── disk_cache.py          # ✅ Exists in main.py — extract to module
```

---

## 5. The OPeNDAP → Grib Filter Migration

### What changes

OPeNDAP used array index notation. Grib Filter uses geographic coordinates
and GRIB2 variable names.

```python
# OLD OPeNDAP pattern (broken):
url = f"https://nomads.ncep.noaa.gov/dods/wave/mww3/{date}/multi_1.glo_30mxt{run}z"
ds = xarray.open_dataset(url)
hs = ds['htsgwsfc'][forecast_hour_idx, lat_idx_start:lat_idx_end, lon_idx_start:lon_idx_end]

# NEW Grib Filter pattern:
import cfgrib
url = (
    f"https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl?"
    f"dir=/gfs.{date}/{run:02d}z/wave/gridded/"
    f"&file=gfswave.t{run:02d}z.global.0p16.f{hour:03d}.grib2"
    f"&var_HTSGW=on&var_PERPW=on&var_DIRPW=on"
    f"&subregion=&toplat={north}&leftlon={west}&rightlon={east}&bottomlat={south}"
)
response = httpx.get(url)
# Parse GRIB2 binary — use cfgrib or eccodes
import eccodes
# OR: use pygrib
import pygrib
msgs = pygrib.fromstring(response.content)
hs = msgs.select(shortName='swh')[0].values  # significant wave height
```

### Recommended Python libraries for GRIB2 parsing

```
cfgrib        — xarray-compatible, best for gridded data
pygrib         — lower level, faster for point extraction
eccodes        — ECMWF's C library (Python bindings)
```

Add to `backend/requirements.txt`:
```
cfgrib>=0.9.10
eccodes>=1.6.0
```

### Grib Filter URL builder (add to data_sources/gfs_wave.py)

```python
def build_gfswave_url(
    date: str,       # YYYYMMDD
    run: int,        # 0, 6, 12, 18
    hour: int,       # forecast hour 000-384
    north: float, south: float, west: float, east: float,
    domain: str = "global.0p16",  # or "epacif.0p16", "atlocn.0p16"
) -> str:
    base = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl"
    params = {
        "dir": f"/gfs.{date}/{run:02d}/wave/gridded/",
        "file": f"gfswave.t{run:02d}z.{domain}.f{hour:03d}.grib2",
        "var_HTSGW": "on",   # significant wave height
        "var_PERPW": "on",   # primary wave period
        "var_DIRPW": "on",   # primary wave direction
        "var_SWELL": "on",   # swell height (wind sea removed)
        "var_SWPER": "on",   # swell period
        "subregion": "",
        "toplat": north, "leftlon": west,
        "rightlon": east, "bottomlat": south,
    }
    return base + "?" + "&".join(f"{k}={v}" for k, v in params.items())
```

---

## 6. Worldwide Coverage — Long-Term Data Source Map

| Region | Wave model | Wind model | Buoys | Tide |
|---|---|---|---|---|
| **California (now)** | GFS-Wave epacif.0p16 | GFS + HRRR | NDBC (22 stations) | CO-OPS |
| **West Coast US** | GFS-Wave epacif.0p16 | GFS + HRRR + NAM | NDBC (30 stations) | CO-OPS |
| **Hawaii** | GFS-Wave global.0p16 | GFS + HRRR | NDBC (6 stations) | CO-OPS |
| **East Coast US** | GFS-Wave atlocn.0p16 | GFS + HRRR + NAM | NDBC (East Coast) | CO-OPS |
| **Europe** | GFS-Wave global + ECMWF | GFS + ECMWF + ICON | EMODnet | SHOM/CEFAS |
| **Australia** | GFS-Wave global | GFS + ECMWF | BOM | BoM tides |
| **Indonesia/SE Asia** | GFS-Wave global | GFS + ECMWF | Sparse | Regional |
| **South America** | GFS-Wave global | GFS + ECMWF | Sparse | SHOA |
| **South Africa** | GFS-Wave global | GFS + ECMWF | CSIR | SA Tides |

For all non-US regions: ECMWF Open Data is the wind quality upgrade that
makes GFS-only forecasts substantially more accurate. It's free, CC BY 4.0,
and available globally.

---

## 7. Surf Score Calculation — Current vs. Improved

### Current (approximate)
```python
# surf_scoring.py — likely something like:
surf_score = (wvht_ft * period_multiplier) * wind_penalty * tide_bonus
```

### Improved (Stormsurf Category Table)
```python
# Add to swell_physics.py
SWELL_CATEGORIES = {
    # (category): (min_face_ft, max_face_ft)
    0: (0, 2.5),
    1: (2.5, 5.0),
    2: (5.0, 7.5),
    3: (7.5, 10.0),
    4: (10.0, 15.0),
    5: (15.0, 20.0),
    6: (20.0, 25.0),
    7: (25.0, 30.0),
    8: (30.0, 40.0),
    9: (40.0, 50.0),
    10: (50.0, 999.0),
}

# Category thresholds per period (from Stormsurf category_short.html)
# Format: [period_7s, period_9s, period_11s, period_13s, period_14s, period_17s, period_20s, period_25s]
CATEGORY_THRESHOLDS_PER_PERIOD = {
    7:  [3.5, 7.1, None, None, None, None, None, None],  # max periods by category
    9:  [2.8, 5.5, 8.3, None, None, None, None, None],
    11: [2.3, 4.5, 6.8, 9.0, None, None, None, None],
    13: [1.9, 3.8, 5.7, 7.6, 11.5, None, None, None],
    14: [2.0, 3.9, 5.9, 8.9, 10.7, 14.1, None, None],
    17: [1.5, 2.9, 4.3, 5.8, 8.8, 11.7, 14.7, None],  # (adjusted for 17s col)
    20: [1.3, 2.4, 3.7, 4.9, 7.4, 9.9, 12.4, None],
    25: [0.9, 1.9, 2.9, 3.9, 5.9, 7.9, 9.9, 11.9],
}

def swell_category(wvht_ft: float, period_s: float) -> int:
    """
    Returns Stormsurf swell category (0-10) from buoy Hs + period.
    This gives the expected wave face height, period-weighted.
    """
    # Find nearest period column
    periods = sorted(CATEGORY_THRESHOLDS_PER_PERIOD.keys())
    nearest_period = min(periods, key=lambda p: abs(p - period_s))
    thresholds = CATEGORY_THRESHOLDS_PER_PERIOD[nearest_period]

    for cat, threshold in enumerate(thresholds):
        if threshold is None:
            return cat
        if wvht_ft < threshold:
            return cat
    return len(thresholds)

def category_face_height(category: int) -> tuple[float, float]:
    """Returns (min_ft, max_ft) face height range for a swell category."""
    return SWELL_CATEGORIES.get(category, (0, 0))
```

---

## 8. Execution Checklist for Claude Code

### 🔴 Immediate (this week)
- [ ] Audit `backend/main.py` for all `nomads.ncep.noaa.gov/dods/` URLs
- [ ] Create `backend/data_sources/gfs_wave.py` with Grib Filter fetcher
- [ ] Create `backend/data_sources/gfs_wind.py` with Grib Filter fetcher
- [ ] Migrate HRRR + NAM fetches to Grib Filter (add domain gating)
- [ ] Add `cfgrib` and `eccodes` to `requirements.txt`
- [ ] Smoke test: verify wave + wind data is fetching correctly
- [ ] Update `ww3_grid_registry.json` with new URL patterns

### 🟡 Near-term (next 2 weeks)
- [ ] Add `swell_category()` to `swell_physics.py` (Section 7)
- [ ] Update `surf_scoring.py` to use category table instead of raw multiplier
- [ ] Extract buoy fetching to `backend/data_sources/ndbc.py`
- [ ] Create `backend/jobs/fetch_forecasts.py` background job
- [ ] Add ECMWF Open Data fetcher for global wind quality

### 🟢 Medium-term (global expansion)
- [ ] International buoy adapters (EMODnet, BOM, CEFAS)
- [ ] ICON wind model for Europe
- [ ] High Seas bulletin parser → `backend/data_sources/high_seas.py`
- [ ] `scan_active_storms()` Copilot tool

---

## 9. Secondary Sources & Fallbacks

| Primary | Secondary | Notes |
|---|---|---|
| GFS-Wave (NOMADS) | ECMWF open data wave | Different format (GRIB2) but same parameters |
| GFS wind (NOMADS) | Open-Meteo API | Free, no key, JSON — good emergency fallback |
| HRRR (NOMADS) | RAP model | Similar resolution, same domain |
| NDBC buoys | CDIP (for CA) | Directional spectra — richer but fewer stations |
| CO-OPS tides | WorldTides API | Paid but global coverage |

### Open-Meteo as Emergency Wind Fallback
If NOMADS is down (it does go down — see history), Open-Meteo provides
GFS + ECMWF wind data via a clean JSON API with no key required:

```python
# Emergency fallback:
url = (
    "https://api.open-meteo.com/v1/forecast?"
    f"latitude={lat}&longitude={lon}"
    "&hourly=wind_speed_10m,wind_direction_10m"
    "&wind_speed_unit=mph"
    f"&forecast_days=7"
)
```

Worth adding as a fallback in `gfs_wind.py` — if the Grib Filter request
fails after 2 retries, fall back to Open-Meteo. Log the fallback so we
know how often NOMADS is unreliable.

---

**Last updated:** 2026-04-21
**Next immediate action:** Migrate `backend/main.py` OPeNDAP URLs to Grib Filter
**Reference:** https://nomads.ncep.noaa.gov/info.php?page=opendap_grib_migration
