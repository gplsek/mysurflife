# MySurfLife - Surf Conditions Dashboard

This project is a FastAPI + React-based surf conditions dashboard that fetches live buoy data and displays it on a map. Built for surfers, by surfers.

---

## 🌊 Core Features (MVP)

- ✅ Fetch buoy data from NOAA (NDBC)
- ✅ FastAPI backend with `/api/buoy-status` and `/api/buoy-status/all`
- ✅ React frontend using Leaflet to display buoys on a map
- ✅ Convert NOAA WVHT (meters) to feet
- ✅ Marker icon + shadow fixed in Leaflet
- ✅ Includes full California coast + south of Scripps Pier

---

## 🧠 Planned Features (Next)

### Surf Scoring
- [ ] Calculate surf score based on:
  - Wave height (ft)
  - Period (sec)
  - Direction (degrees)
- [ ] Color-coded markers based on score
- [ ] Score legend and tooltips

### UI Improvements
- [ ] Filter markers by region or conditions
- [ ] Auto-refresh buoy data every 10 minutes
- [ ] Add user-selectable overlays (e.g. swell, tide, wind)
- [ ] Display detailed buoy report modal/popup

### Backend Enhancements
- [ ] Save recent buoy data (cache or DB)
- [ ] Add historical trend endpoint
- [ ] Slack/webhook alerts for certain surf conditions

---

## 📁 Project Structure

```
mysurflife/
├── backend/
│   ├── main.py
│   └── ...
├── frontend/
│   ├── public/
│   └── src/
│       ├── App.js
│       └── components/
└── README.md
```

---

## 🛠️ Local Dev

Backend:
```bash
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:
```bash
cd frontend
npm start
```

---

## ✨ Notes

- NOAA buoy files include header + units row → we parse only the true header.
- `WVHT` values are in meters, converted to feet via `1 m = 3.28084 ft`
- Default proxy is set in frontend `package.json`: `"proxy": "http://localhost:8000"`


---

## 📊 Graphs in Buoy Detail

Add visual charts to each buoy's popup or modal to match visuals like CDIP's site:

- [x] Wave Height (Hs) over time
- [ ] Period + Forecast (dual-line)
- [ ] Spectral Energy & Density view

### Backend
- [ ] Add `/api/buoy-history/{station_id}` endpoint
- [ ] Fetch past 5 days of Hs, Tp, Dp (from NDBC/CDIP feeds)
- [ ] Parse and return timestamped JSON series

### Frontend
- [ ] Use `Recharts` to render:
  - Line chart: Wave height (ft) vs time
  - Dual-line: Period and forecast height
  - Bar/density: Energy distribution (if spectrum available)
- [ ] Show on buoy marker click or modal expand

*Consider data caching to avoid repeated fetches on reselect.*



---

## 🗺️ Map Layers & Overlays

### 1. Basemap Layer Switching
- [ ] Toggle between different basemaps:
  - OpenStreetMap (default)
  - Satellite
  - Terrain
  - Dark/Light UI themes
- [ ] Implement via `<TileLayer>` in `react-leaflet`

### 2. Wind Overlay (Live + Forecast)
- [ ] Integrate Windy API or NOAA wind field data
- [ ] Optionally fetch and animate wind arrows from GRIB2 forecast
- [ ] Use vector arrows or streamlines for display

### 3. Swell Overlay (Forecast Animation)
- [ ] Use NOAA WW3 (WaveWatch III) forecast layers
- [ ] Animate wave height and direction forecast
- [ ] Optional: heatmap, contour lines, or icon vectors

### 4. Live Wind Data Per Buoy
- [ ] Match each buoy with a nearby wind station (from NDBC/CDIP)
- [ ] Fetch wind speed and direction in backend
- [ ] Display wind arrow, speed, and direction in the buoy detail popup
- [ ] Prioritize nearshore stations where available



---

## 🌬️ Wind Influence on Surf Scoring

### Wind Speed & Texture Thresholds
- **0–2 knots**: Glassy, ideal
- **2–5 knots**: Rippled but still clean — surf remains good
- **6–10 knots**: Light texture, may affect surf shape
- **11+ knots**: Choppy or blown out conditions, unless offshore

### Directional Wind Influence (West Coast Surf Logic)
- **Easterly (E, ENE, ESE)**: ✅ Offshore — improves quality at almost any speed
- **Southeasterly / Northeasterly (SE, NE)**: ⚠️ Starts to cross-blow and deteriorate quality
- **Southerly or Northerly (S, N)**: ❌ Degrades surf due to direct sidewinds
- **Westerly sector (SW, W, NW)**: ❌ Onshore — worst for clean conditions

### Scoring Integration
- [ ] Incorporate wind score into overall surf score
- [ ] Weight wind direction + speed relative to swell direction
- [ ] Tag spots as:
  - `Glassy` (< 3 knots)
  - `Clean` (< 6 knots, offshore or variable)
  - `Textured` (6–10 knots, side)
  - `Blown out` (> 10 knots or onshore)



---

## 📡 Wind Data Integration – Instructions for Claude

### 🔍 Goal:
Augment buoy data with **live wind speed + direction**, especially for **nearshore buoys**, using the closest available land-based or marine wind sensor.

---

### 🧭 Step 1: Nearest Wind Stations

- **Use NOAA NDBC** station list:
  https://www.ndbc.noaa.gov/to_station_table.shtml
- OR use their JSON/GeoJSON endpoint for marine and coastal stations:
  - https://www.ndbc.noaa.gov/data/stations/station_table.txt
  - [CDIP station map](https://cdip.ucsd.edu/?nav=historic&sub=stn)

For each buoy:
- Find the **nearest wind-reporting station** within ~15–25 miles.
- Prefer **land-based coastal stations** if buoy has no wind.
- Save the mapping like:

```json
{
  "46266": "L13",  // Del Mar Nearshore → Point Loma wind station
  "46225": "L14",  // Torrey Pines Outer → Camp Pendleton
  ...
}
```

---

### 🌬️ Step 2: Fetch Live Wind

Use NOAA’s standard data endpoint:
```
https://www.ndbc.noaa.gov/data/latest_obs/{station}.txt
```

Parse:
- `WDIR` = wind direction (deg)
- `WSPD` = wind speed (m/s)
- `GST`  = wind gust

Convert m/s to knots or mph as needed.

---

### ⚙️ Step 3: FastAPI Enhancement

- Add `nearest_wind_station` to each buoy in the `BUOY_LIST`
- Update `/api/buoy-status/all` to fetch wind from that station
- Include fields in response:
  ```json
  {
    "wind_speed_kts": 6,
    "wind_dir_deg": 85,
    "wind_text": "E @ 6 kts"
  }
  ```

---

### 📌 Notes

- Cache wind results for ~10 minutes to avoid rate limits
- Handle failures gracefully: `wind: N/A`
- For mobile performance, don’t fetch wind until popup is opened



---

## 🌊 Surf Wave Height Estimation from Buoy Data

### Key Inputs from Buoy
- `WVHT`: Significant Wave Height (in feet)
- `DPD`: Dominant Wave Period (in seconds)

### Rule of Thumb Formula
To estimate wave face height (surfable wave size at shore):

```
Estimated Wave Height (ft) ≈ 0.7 × WVHT × sqrt(DPD)
```

This provides a good face-height estimate based on the energy in the swell.

#### Example:
- `WVHT = 3.0 ft`
- `DPD = 14 sec`

```
≈ 0.7 × 3 × sqrt(14) ≈ 7.8 ft face height
```

> If displaying “Hawaiian scale” (back of wave), divide face height by ~2.

### Additional Metric: Wave Energy Index

```
Energy Index = WVHT² × DPD
```

Useful for scoring, comparisons, or heatmap overlays.

### Implementation Snippet (Python)

```python
import math

def estimate_wave_face_height(wvht_ft: float, dpd_sec: float) -> float:
    if wvht_ft and dpd_sec:
        return round(0.7 * wvht_ft * math.sqrt(dpd_sec), 1)
    return None
```

Use this for scoring, tooltip insights, or predictive surf height at a location.


---

_Last updated: 2025-10-21 15:53_