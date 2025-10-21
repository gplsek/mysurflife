# MySurfLife - Surf Conditions Dashboard

This project is a FastAPI + React-based surf conditions dashboard that fetches live buoy data and displays it on a map. Built for surfers, by surfers.

---

## 🌊 Core Features (MVP)

- ✅ Fetch buoy data from NOAA (NDBC)
- ✅ FastAPI backend with `/api/buoy-status` and `/api/buoy-status/all`
- ✅ React frontend using Leaflet to display buoys on a map
- ✅ Convert NOAA WVHT (meters) to feet
- ✅ Marker icon + shadow fixed in Leaflet
- ✅ Includes full California coast (14 buoys)

---

## ✅ Completed Features

### Surf Scoring
- ✅ Calculate surf score based on:
  - Wave height (ft)
  - Period (sec)
  - Direction (degrees)
- ✅ Color-coded markers (green/orange/red/grey) based on score
- ✅ Score legend in control panel

### UI Improvements
- ✅ Auto-refresh buoy data every 5 minutes
- ✅ Display detailed buoy report in dedicated panel
- ✅ Unit selector (Imperial/Metric) with localStorage persistence
- ✅ Timezone selector (Local/UTC)
- ✅ Basemap switcher (OpenStreetMap, Satellite, Terrain, Ocean)
- ✅ Clean marker popups (name only)
- ✅ Floating control panel with refresh button

### Backend Enhancements
- ✅ Cache buoy data (5-minute TTL)
- ✅ Concurrent API calls using asyncio.gather()
- ✅ Proper error handling with timeouts
- ✅ Wind data parsing (speed, direction, gusts)
- ✅ Temperature data (water & air)
- ✅ ISO format timestamps for easy parsing

### Data Features
- ✅ Wave height, period, direction
- ✅ Wind speed, direction, and gusts
- ✅ Water and air temperature
- ✅ Automatic unit conversion (ft/m, mph/km/h, °F/°C)
- ✅ Compass direction labels (N, NE, E, etc.)

---

## 🧠 Planned Features (Next)

### UI Improvements
- [ ] Filter markers by region (when expanding beyond California)
- [ ] Filter by surf conditions (e.g., "Show only good surf")

### Backend Enhancements
- [ ] Add historical trend endpoint
- [ ] Slack/webhook alerts for certain surf conditions
- [ ] Database storage for long-term historical data

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
- ✅ Toggle between different basemaps:
  - ✅ OpenStreetMap (default)
  - ✅ Satellite
  - ✅ Terrain
  - ✅ Ocean
- ✅ Implemented via `<LayersControl>` in `react-leaflet`

### 2. Wind Overlay (Live + Forecast)
- [ ] Integrate Windy API or NOAA wind field data
- [ ] Optionally fetch and animate wind arrows from GRIB2 forecast
- [ ] Use vector arrows or streamlines for display

### 3. Swell Overlay (Forecast Animation)
- [ ] Use NOAA WW3 (WaveWatch III) forecast layers
- [ ] Animate wave height and direction forecast
- [ ] Optional: heatmap, contour lines, or icon vectors

### 4. Live Wind Data Per Buoy
- ✅ Wind data parsed from NDBC buoy files
- ✅ Fetch wind speed, direction, and gusts in backend
- ✅ Display wind speed and direction in the buoy detail panel
- ✅ Compass direction labels (N, NE, ESE, etc.)
- ✅ Unit conversion (mph for Imperial, km/h for Metric)


---

---

## 🎯 Current Focus

### High Priority (Next Sprint)
1. **24-Hour Wave Height Charts** - Show wave height trends over the last 24-48 hours
2. **Surf Condition Filters** - Filter buoys by quality (e.g., "Show only good surf")
3. **Forecast Integration** - Add 5-day forecast data from NOAA/Surfline

### Medium Priority
1. **Historical Trends API** - Endpoint to fetch data from past weeks
2. **Surf Alerts** - Email/push notifications for preferred conditions
3. **Swell Overlay** - Animated wave height forecast on map

---

_Last updated: 2025-10-21 (Latest: Added wind data + basemap switcher)_