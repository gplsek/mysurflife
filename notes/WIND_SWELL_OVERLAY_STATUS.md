# 🌬️🌊 Wind & Swell Overlay Integration Status

## ✅ Phase 1 Complete + Custom Particle Animations!

**Last Updated:** 2025-10-21  
**Commit:** `cce32a7`

### 🎨 NEW: Windy-Style Particle Animations!
We now have **100% custom particle-based animations** for both wind and swell, inspired by Windy.com but completely independent:

- **WindParticles.js**: 3000 animated particles following wind flow
  - Color-coded by speed (green → blue → yellow → orange → red)
  - Fade trail effects for smooth visualization
  - Works with HRRR, GFS, and NAM models
  
- **WaveParticles.js**: 2500 animated particles following ocean swell
  - Color-coded by wave height (light green → crimson)
  - Elongated elliptical particles with wave oscillation
  - Works with WaveWatch III model
  
No Windy.com iframe - fully custom implementation!

---

## 📍 CDIP URLs Currently Being Tested

For **Del Mar Nearshore (NDBC 46266 = CDIP 153p1)**, the system tries:

```
1. https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/153p1/153p1_rt.nc
2. https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_validation/153p1/153p1_rt.nc
3. https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/153p1_rt.nc
```

**Explore these URLs to find the correct path:**
- Main THREDDS: https://thredds.cdip.ucsd.edu/thredds/catalog.html
- Model catalog: https://thredds.cdip.ucsd.edu/thredds/catalog/cdip/model/catalog.html
- Realtime catalog: https://thredds.cdip.ucsd.edu/thredds/catalog/cdip/realtime/catalog.html

---

## 🎯 New API Endpoints

### 1. `/api/wind-overlay` - Wind Forecast Models

Get wind data for map visualization with model selection.

**Parameters:**
- `model` (optional): `gfs`, `hrrr`, or `nam` (default: `gfs`)
- `bounds` (optional): `"min_lat,min_lon,max_lat,max_lon"` (default: California)

**Example:**
```bash
curl "http://localhost:8000/api/wind-overlay?model=hrrr"
```

**Response:**
```json
{
  "model": "hrrr",
  "model_name": "High-Resolution Rapid Refresh",
  "resolution": "3 km",
  "bounds": {...},
  "vectors": [
    {
      "lat": 33.0,
      "lon": -118.0,
      "speed_kts": 12,
      "direction_deg": 270,
      "u_component": -12.0,
      "v_component": 0.0
    }
  ]
}
```

---

### 2. `/api/swell-overlay` - Wave Forecast

Get swell/wave forecast data for map visualization.

**Parameters:**
- `model` (optional): `ww3` (default, WaveWatch III)
- `bounds` (optional): Geographic bounds

**Example:**
```bash
curl "http://localhost:8000/api/swell-overlay?model=ww3"
```

**Response:**
```json
{
  "model": "ww3",
  "model_name": "WaveWatch III",
  "wave_data": [
    {
      "lat": 33.0,
      "lon": -118.0,
      "wave_height_m": 1.5,
      "wave_height_ft": 4.9,
      "period_sec": 12,
      "direction_deg": 285,
      "energy": 27.0
    }
  ]
}
```

---

### 3. `/api/overlays/models` - Available Models

Get list of all wind and swell models with their specs.

**Example:**
```bash
curl "http://localhost:8000/api/overlays/models"
```

---

## 🌬️ Wind Models Available

### GFS (Global Forecast System)
- **Resolution:** 25 km
- **Coverage:** Global
- **Updates:** Every 6 hours
- **Forecast:** 16 days
- **Best for:** General conditions, long-range planning
- **NOAA URL:** https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl

### HRRR (High-Resolution Rapid Refresh)
- **Resolution:** 3 km 🔥 *Highest resolution*
- **Coverage:** Continental US
- **Updates:** Every hour 🔥 *Most frequent*
- **Forecast:** 48 hours
- **Best for:** California coast, short-term accuracy
- **NOAA URL:** https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl

### NAM (North American Mesoscale)
- **Resolution:** 12 km
- **Coverage:** North America
- **Updates:** Every 6 hours
- **Forecast:** 84 hours (3.5 days)
- **Best for:** Medium-range regional forecasts
- **NOAA URL:** https://nomads.ncep.noaa.gov/cgi-bin/filter_nam.pl

---

## 🌊 Swell Model

### WaveWatch III (WW3)
- **Resolution:** 50 km
- **Coverage:** Global
- **Updates:** Every 6 hours
- **Forecast:** 180 hours (7.5 days)
- **Best for:** Ocean swell tracking and forecasting
- **NOAA URL:** https://polar.ncep.noaa.gov/waves/

---

## 📊 Current Status

### ✅ Complete:
- [x] **Phase 1: Backend API**
  - [x] Wind overlay API endpoint with 3 models (GFS, HRRR, NAM)
  - [x] Swell overlay API endpoint (WW3)
  - [x] Model info API endpoint
  - [x] Configurable geographic bounds
  - [x] Caching (10min wind, 30min swell)
  - [x] Sample data structure defined
  
- [x] **Phase 3: Frontend Visualization** ✨ NEW!
  - [x] Overlay toggle controls in map UI
  - [x] Custom particle-based wind animation (WindParticles.js)
  - [x] Custom particle-based swell animation (WaveParticles.js)
  - [x] Model selector checkboxes (HRRR, GFS, NAM, WW3)
  - [x] Animated Windy-style visualization
  - [x] Color-coded by intensity (wind speed / wave height)
  - [x] Fade trail effects for smooth flow
  - [x] Real-time canvas rendering

### 🔄 Next Steps:

#### Phase 2A: Fetch Real Wind Data
1. Install `pygrib` or use NOAA's GRIB filter API
2. Parse GRIB2 wind forecast files
3. Extract U/V wind components for California
4. Return grid of wind vectors

#### Phase 2B: Fetch Real Swell Data
1. Access WaveWatch III NetCDF files via THREDDS/OPeNDAP
2. Extract wave height, period, direction
3. Return grid of wave parameters

---

## 🎨 Frontend Integration Plan

### Map Controls (Top-Right Panel)

```
┌─────────────────────────────────┐
│  🔄 Refresh | 📊 Surf Score      │
│                                   │
│  🌬️ Wind:  [▢] GFS  [▢] HRRR   │
│             [▢] NAM              │
│                                   │
│  🌊 Swell:  [▢] WaveWatch III    │
│                                   │
│  Units: ● Imperial  ○ Metric     │
│  Time:  ● Local     ○ UTC        │
└─────────────────────────────────┘
```

### Visualization Options:

**Wind Arrows:**
- Arrow size = wind speed
- Arrow direction = wind direction
- Color = speed (light blue → dark blue → purple)
- Grid spacing: ~25km

**Swell Heatmap:**
- Color intensity = wave height
- Optional arrows for direction
- Transparency to see buoys underneath

---

## 🧪 Testing

### Test Wind Endpoint:
```bash
# GFS model (default)
curl "http://localhost:8000/api/wind-overlay"

# HRRR model (high-res)
curl "http://localhost:8000/api/wind-overlay?model=hrrr"

# NAM model
curl "http://localhost:8000/api/wind-overlay?model=nam"

# Custom bounds (San Diego area)
curl "http://localhost:8000/api/wind-overlay?bounds=32.5,-117.5,33.0,-117.0"
```

### Test Swell Endpoint:
```bash
curl "http://localhost:8000/api/swell-overlay"
```

### Get All Models:
```bash
curl "http://localhost:8000/api/overlays/models" | python3 -m json.tool
```

---

## 🚀 Implementation Priority

### Recommended Order:

1. **Finish CDIP URL verification** (you're doing this!)
   - Once found, buoy forecasts will use real ECMWF data

2. **Add Wind Overlay UI** (Quick win)
   - Checkboxes to toggle models
   - Simple arrow visualization
   - HRRR recommended for California (3km resolution)

3. **Fetch Real Wind Data** (Phase 2A)
   - Integrate GRIB2 data from NOAA
   - Populate actual wind vectors

4. **Add Swell Overlay UI**
   - Toggle for WW3
   - Heatmap visualization

5. **Fetch Real Swell Data** (Phase 2B)
   - Access WW3 NetCDF via THREDDS
   - Populate actual wave data

---

## 💡 Quick Wins

**You can start using overlays NOW** with sample data:
1. Add checkboxes to frontend
2. Fetch overlay data on toggle
3. Display model info to users
4. Show "coming soon" for actual data visualization

Users will see:
- ✅ Which models are available
- ✅ Model specifications
- ✅ That overlays are coming
- 🔜 Actual wind/swell visualization (Phase 2)

---

## 📝 Data Sources & Documentation

**NOAA NOMADS (Operational Model Archive):**
- https://nomads.ncep.noaa.gov/

**GRIB2 Filter Services:**
- GFS: https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl
- HRRR: https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl
- NAM: https://nomads.ncep.noaa.gov/cgi-bin/filter_nam.pl

**WaveWatch III:**
- Main site: https://polar.ncep.noaa.gov/waves/
- THREDDS: https://polar.ncep.noaa.gov/thredds/catalog.html

**Libraries for Phase 2:**
- `pygrib` - Read GRIB2 files
- `xarray` - Handle NetCDF/GRIB data
- `cfgrib` - GRIB via xarray
- Already have: `netCDF4` ✅

---

**Status:** Phase 1 & 3 Complete! ✅🎨  
**What Works NOW:**
- Toggle HRRR/GFS/NAM wind models → See animated particle flow
- Toggle WaveWatch III swell → See animated wave particles
- Color-coded by intensity
- Windy-style smooth animations
- No external dependencies

**Next:** 
1. Find correct CDIP THREDDS URLs (for buoy forecasts)
2. Real data integration (Phase 2A: Wind, Phase 2B: Swell)

