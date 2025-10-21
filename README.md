# 🏄 MySurfLife - Live Surf Conditions Dashboard

A real-time surf conditions dashboard tracking 14 California buoys with live wave data, wind conditions, and intelligent surf scoring.

**Built with:** FastAPI (backend) + React + Leaflet (frontend)

---

## 🌊 Current Features (Implemented)

### ✅ **Backend (FastAPI + Python)**
- **14 California Buoys** - Coverage from Imperial Beach to Cape Mendocino
- **Live NDBC Data** - Real-time wave, wind, and temperature data
- **Concurrent API Calls** - Fetch all buoys in parallel using asyncio.gather()
- **Smart Caching** - 5-minute cache to reduce API load
- **Wind Fallback System** - Automatically fetches from NOS CO-OPS stations when buoy wind is missing
- **Surf Calculations**:
  - Wave face height: `0.7 × WVHT × √DPD`
  - Wave energy index: `WVHT² × DPD`
- **Wave Trend Analysis** - Compares last 5 readings to detect rising/holding/falling conditions
- **Endpoints**:
  - `/api/buoy-status` - Single buoy (Del Mar)
  - `/api/buoy-status/all` - All 14 buoys
  - `/api/buoy-history/{station_id}?hours=48` - Historical time series
  - `/api/buoy-forecast/{station_id}?hours=120` - 5-day forecast (Phase 1: trend-based)
  - `/api/cache/clear` - Clear cache

### ✅ **Frontend (React + Leaflet)**
- **Interactive Map** - California coast with color-coded buoy markers
- **4 Basemap Options** - OpenStreetMap, Satellite, Terrain, Ocean
- **Buoy Detail Panel** - Click any buoy to see full conditions:
  - 🏄 Surf face height with trend indicator (↑↓→)
  - Wave energy bar (visual 0-500 scale with color coding)
  - Period, direction with rotating arrows
  - Wind speed/direction with fallback station attribution
  - Water and air temperature
  - Timestamp in local or UTC
  - **📈 Historical Charts** - Expandable 48-hour wave history:
    - Wave height & face height (dual-line chart)
    - Period trend
    - Energy index trend
    - Lazy-loaded on demand
  - **🔮 5-Day Forecast** - Toggle forecast overlay on charts:
    - Trend-based projection (Phase 1)
    - Dotted lines distinguish forecast from observed
    - Next 120 hours in 3-hour intervals
    - Phase 2: Full CDIP ECMWF model integration planned
- **Smart Scoring** (0-3 scale):
  - Considers surf face height, period, direction, and energy
  - Color-coded markers: Green (3), Orange (2), Red (1), Grey (0)
- **Auto-Refresh** - Every 5 minutes
- **Unit Selection** - Imperial (ft, °F, mph) or Metric (m, °C, km/h)
- **Timezone Selection** - Local or UTC
- **Persistent Settings** - localStorage saves preferences

### ✅ **Data Features**
- Wave height (buoy reading)
- Surf face height (calculated rideable size)
- Wave trend (rising/holding/falling)
- Wave energy index with visual indicator
- Dominant period
- Wave direction with directional arrows
- Wind speed, direction, gusts
- Wind source tracking (buoy vs. coastal station)
- Water & air temperature

---

## 🗺️ Buoy Coverage

**Southern California (9 buoys):**
- 46266 - Del Mar Nearshore
- 46225 - Torrey Pines Outer
- 46259 - Mission Bay
- 46232 - Point Loma South
- 46236 - Imperial Beach
- 46258 - San Pedro Channel
- 46222 - Santa Monica Basin
- 46086 - Pt. Dume / Santa Barbara
- 46011 - Santa Maria

**Central/Northern California (5 buoys):**
- 46027 - Cape Mendocino
- 46014 - Pt. Arena
- 46026 - San Francisco Bar
- 46012 - Monterey Bay
- 46013 - Bodega Bay

---

## 🚀 Next Priorities

### ✅ **1. Historical Wave Charts** (COMPLETED!)
- ✅ Fetch last 24-48 hours of wave height data from NDBC
- ✅ Add `/api/buoy-history/{station_id}` endpoint
- ✅ Integrate Recharts library for visualization
- ✅ Display 3 line charts in buoy detail panel
- ✅ Show wave height, period, and energy trends
- ✅ Lazy-loaded with expand/collapse functionality

### 🌬️ **2. Wind Overlay** (Next Priority)
- [ ] Integrate wind vector overlay on map
- [ ] Fetch NOAA/Windy wind field data
- [ ] Animated wind arrows showing current conditions
- [ ] Toggle layer on/off
- [ ] Consider using Windy API or WMS layers

### 🌊 **3. Swell Overlay** (High Priority)
- [ ] Add NOAA WaveWatch III (WW3) forecast overlay
- [ ] Animated swell direction and height
- [ ] Heatmap or contour visualization
- [ ] 5-day swell forecast animation
- [ ] Toggle layer on/off

---

## 📁 Project Structure

```
mysurflife/
├── backend/
│   ├── main.py                      # FastAPI server
│   ├── requirements.txt             # Python dependencies
│   └── venv/                        # Virtual environment
├── frontend/
│   ├── src/
│   │   ├── App.js                   # Main app component
│   │   ├── MapOverlay.js            # Map + buoy markers
│   │   ├── index.js                 # React entry point
│   │   └── index.css                # Global styles
│   ├── public/
│   │   └── index.html
│   ├── package.json                 # Node dependencies
│   └── node_modules/
├── buoy_to_wind_station_map.json   # Wind fallback mapping
├── WIND_STATION_MAPPING.md         # Wind station documentation
├── mysurflife-project-plan.md      # Detailed planning doc
└── README.md                        # This file
```

---

## 🛠️ Local Development

### Backend Setup
```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**API will be available at:** http://localhost:8000

### Frontend Setup
```bash
cd frontend
npm install
npm start
```

**App will open at:** http://localhost:3000

---

## 🧱 Tech Stack

**Backend:**
- Python 3.10+
- FastAPI - Modern async web framework
- httpx - Async HTTP client
- asyncio - Concurrent buoy data fetching

**Frontend:**
- React 18
- Leaflet / react-leaflet - Interactive maps
- Recharts - Historical data visualization
- SVG - Custom direction arrows and indicators

**Data Sources:**
- NOAA NDBC - Buoy data (https://www.ndbc.noaa.gov/)
- NOS CO-OPS - Coastal wind stations
- Future: NOAA WaveWatch III for forecasts

---

## 📊 Formulas & Calculations

**Surf Face Height:**
```
Face Height (ft) ≈ 0.7 × WVHT × √DPD
```

**Wave Energy Index:**
```
Energy = WVHT² × DPD
```

**Energy Scale:**
- 0-50: Small
- 50-150: Moderate
- 150-300: Powerful
- 300-500: Very Powerful
- 500+: Extreme

---

## 📝 Notes

- NDBC data updates approximately every 10 minutes
- Cache set to 5 minutes for optimal freshness
- Wind fallback uses NOS CO-OPS tide stations with met sensors
- All calculations done server-side, frontend handles display only
- Timestamps in ISO format (UTC) from backend

---

**Last Updated:** 2025-10-21  
**Status:** Active Development  
**Latest Feature:** 🔮 5-day wave forecast overlay with CDIP integration roadmap  
**Next Session Focus:** CDIP ECMWF model integration (Phase 2), wind overlay, swell overlay
