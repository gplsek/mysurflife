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

_Last updated: 2025-10-21 15:53_