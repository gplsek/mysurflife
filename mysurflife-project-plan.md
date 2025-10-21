
# MySurfLife Project Plan

## 💨 Wind Forecast Overlay Plan (Inspired by iWindsurf)

### 🎯 Goal
Create a **live and forecasted wind overlay map** similar to [iWindsurf](https://wx.iwindsurf.com/map) with:

- Color-coded wind speed (0–40+ knots)
- Flow lines or arrows to show direction
- Slider to animate wind forecasts
- Thick, smooth visuals for clarity

---

### 🔍 Data Source

#### ✅ Option 1: **Windy ECMWF/GFS API (Requires Partnership or Scraping)**
- Commercial product, premium data access
- Not ideal for open-source MVP

#### ✅ Option 2: **NOAA GFS or HRRR Model via AWS / NOMADS**
Use **Global Forecast System (GFS)** or **High Resolution Rapid Refresh (HRRR)** via:

- [NOAA NOMADS GFS Data](https://nomads.ncep.noaa.gov/)
- [AWS Open GFS](https://registry.opendata.aws/noaa-gfs-bdp-pds/)

Fetch wind data in:
- `u-wind` (east-west component)
- `v-wind` (north-south component)

Grid resolution:
- GFS: 0.25° (≈ 25 km)
- HRRR: 3 km (CONUS only)

Format: GRIB2 or NetCDF (use `cfgrib` or `xarray`)

---

### 🛠️ Tech Stack

#### 📦 Backend
- Python + FastAPI
- Use `xarray` or `cfgrib` to parse GFS wind fields
- Cache forecasts (6hr steps for 5–7 days)
- Convert into 2D vectors + timestamps
- Serve as JSON tiles or GeoJSON

#### 🧭 Frontend
- React + Leaflet (with `leaflet-velocity` or `wind-layer`)
- Animate using `react-slider` + Leaflet time control
- Use `velocityLayer` or D3 canvas overlay
- Color gradient:
  - 0–5 knots: light blue
  - 5–10: teal
  - 10–20: yellow/orange
  - 20–30: red
  - 30–40+: purple/black

#### 🖼️ Visuals
- Use curved flow lines (e.g., Windy, Earth Nullschool)
- Scale line thickness by wind speed
- Optional: switch to arrows for low-performance mode

---

### 📅 Timeline

| Task | Effort |
|------|--------|
| Fetch & parse GFS wind (GRIB) | 3–5 PM |
| Design wind vector backend API | 2 PM |
| Frontend wind overlay component | 4–6 PM |
| Animation slider UI | 2 PM |
| QA + integration | 2 PM |

---

### 🔁 Future Enhancements
- Add HRRR (higher res) for nearshore US wind
- Blend wind data with swell overlays
- Add gust forecast, wind shear indicators

