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

## 📊 Historical Charts & CDIP Integration

### Goal
Recreate CDIP-style visualizations showing:
1. **Wave Height (Hs) over time** - Last 24-48 hours
2. **Period trends** - DPD over time
3. **Wave Energy Spectrum** - Frequency distribution (advanced)
4. **Forecast overlay** - If available from CDIP or NOAA

---

### 📡 Step 1: Understand Data Sources

#### CDIP (Coastal Data Information Program)
- **Primary Access:** https://cdip.ucsd.edu/data_access/
- **Station List:** https://cdip.ucsd.edu/m/products/
- **Data Formats:**
  - NetCDF files (most complete, requires parsing)
  - JSON/CSV via REST API (easier integration)
  - Pre-built graph images (not dynamic enough)

#### Example: Del Mar Nearshore (CDIP 153)
- Station ID: `153p1`
- CDIP URL: `https://cdip.ucsd.edu/m/products/?stn=153p1`
- Data endpoint: `https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/153p1_rt.nc`

#### NDBC (Current Source)
- Already integrated for real-time conditions
- Historical data: `https://www.ndbc.noaa.gov/data/realtime2/{station}.txt`
- Contains ~45 days of hourly data
- Fields: `WVHT`, `DPD`, `MWD`, `WSPD`, `WDIR`, `ATMP`, `WTMP`

---

### 🗺️ Step 2: Map CDIP Stations to Our Buoys

Not all NDBC buoys have CDIP equivalents. Priority mapping:

| NDBC ID | CDIP ID | Name | CDIP Available? |
|---------|---------|------|-----------------|
| 46266 | 153p1 | Del Mar Nearshore | ✅ Yes |
| 46225 | 100p1 | Torrey Pines Outer | ✅ Yes |
| 46232 | 158p1 | Point Loma South | ✅ Yes |
| 46236 | 157p1 | Imperial Beach | ✅ Yes |
| 46258 | 092p1 | San Pedro Channel | ✅ Yes |
| 46086 | 111p1 | Santa Barbara | ✅ Yes |
| 46011 | 071p1 | Santa Maria | ✅ Yes |
| 46222 | 191p1 | Santa Monica Basin | ✅ Yes |
| 46259 | — | Mission Bay | ❌ NDBC only |
| 46027 | 094p1 | Cape Mendocino | ✅ Yes |
| 46014 | 029p1 | Pt. Arena | ✅ Yes |
| 46026 | 142p1 | San Francisco Bar | ✅ Yes |
| 46012 | 156p1 | Monterey Bay | ✅ Yes |
| 46013 | 029p1 | Bodega Bay | ✅ Yes |

**Strategy:** Use CDIP for historical charts when available, fall back to NDBC parsing.

---

### ⚙️ Step 3: Backend Implementation

#### Option A: NDBC Historical (Simpler, Already Familiar)
```python
# /api/buoy-history/{station_id}?hours=48

async def fetch_ndbc_history(station_id: str, hours: int = 48):
    url = f"https://www.ndbc.noaa.gov/data/realtime2/{station_id}.txt"
    # Parse all rows, filter last N hours
    # Return: [{ "timestamp": "...", "wvht": 2.3, "dpd": 14, "mwd": 285 }, ...]
```

**Pros:**
- Already parsing NDBC format
- No new API integration
- Works for all 14 buoys

**Cons:**
- Limited to 45 days history
- No spectral data
- No forecasts

#### Option B: CDIP Integration (More Features)
```python
# Fetch from CDIP JSON endpoint
async def fetch_cdip_history(cdip_id: str, hours: int = 48):
    # CDIP API endpoint (if available)
    url = f"https://cdip.ucsd.edu/data_access/json/{cdip_id}"
    # Parse waveHs, waveDp, waveEnergy
    # Return structured time series
```

**Pros:**
- Spectral energy data
- Better wave period resolution
- Forecast models (some stations)
- Higher data quality

**Cons:**
- Need to parse NetCDF or find JSON endpoint
- Not all buoys have CDIP equivalents
- More complex integration

#### Option C: Hybrid Approach (Recommended)
1. Try CDIP first (for supported stations)
2. Fall back to NDBC if CDIP unavailable
3. Cache aggressively (30-60 min TTL for historical data)

---

### 🎨 Step 4: Frontend Charts with Recharts

#### Install Dependencies
```bash
npm install recharts
```

#### Component Structure
```jsx
// WaveHistoryChart.jsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

const WaveHistoryChart = ({ data, units }) => {
  return (
    <LineChart width={500} height={300} data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="time" />
      <YAxis label={{ value: units === 'imperial' ? 'Height (ft)' : 'Height (m)', angle: -90 }} />
      <Tooltip />
      <Legend />
      <Line type="monotone" dataKey="wvht" stroke="#0066cc" name="Wave Height" />
      <Line type="monotone" dataKey="dpd" stroke="#22c55e" name="Period (sec)" />
    </LineChart>
  );
};
```

#### Display Location
Add chart below current conditions in the **Buoy Detail Panel**:
```jsx
{selectedBuoy && (
  <div style={{ marginTop: '20px' }}>
    <h4>📈 Last 48 Hours</h4>
    <WaveHistoryChart 
      data={historyData} 
      units={units} 
    />
  </div>
)}
```

---

### 📋 Step 5: Implementation Checklist

#### Backend Tasks
- [ ] Create `/api/buoy-history/{station_id}?hours=48` endpoint
- [ ] Parse NDBC historical `.txt` file (all rows, not just latest)
- [ ] Filter to last N hours based on timestamp
- [ ] Return JSON array: `[{ timestamp, wvht, dpd, mwd, wspd, wdir }, ...]`
- [ ] Add caching (30-60 min TTL)
- [ ] Optional: Add CDIP integration for supported stations

#### Frontend Tasks
- [ ] Install `recharts`: `npm install recharts`
- [ ] Create `WaveHistoryChart.jsx` component
- [ ] Fetch history data when buoy is selected
- [ ] Display chart in buoy detail panel (below current data)
- [ ] Add loading state for chart
- [ ] Responsive sizing (fits panel width)
- [ ] Toggle between 24h/48h/7d views
- [ ] Optional: Add period as secondary Y-axis

#### Advanced Features (Future)
- [ ] Wave energy spectrum visualization (bar chart)
- [ ] Forecast overlay (if CDIP provides)
- [ ] Download chart as PNG
- [ ] Compare multiple buoys side-by-side

---

### 🔗 Useful CDIP Resources

- **Data Access Portal:** https://cdip.ucsd.edu/data_access/
- **Station Map:** https://cdip.ucsd.edu/m/products/
- **THREDDS Server:** https://thredds.cdip.ucsd.edu/thredds/catalog/cdip/realtime/catalog.html
- **Documentation:** https://cdip.ucsd.edu/m/documents/
- **Python Library:** `cdippy` (if available) or manual NetCDF parsing

---

### 📝 Notes

- Start with **NDBC historical** (simpler, works for all buoys)
- CDIP integration can be Phase 2 once basic charts are working
- Cache historical data aggressively (it doesn't change)
- Consider lazy-loading charts (only fetch when buoy is clicked)
- Mobile: Make charts responsive, possibly collapsible



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