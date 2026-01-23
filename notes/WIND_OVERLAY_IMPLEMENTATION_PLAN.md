# 🌬️ Wind Overlay Implementation Plan (iWindsurf Style)

## 🎯 Goal
Create a **clean, grid-based wind overlay** inspired by [iWindsurf](https://wx.iwindsurf.com/map):
- Grid cells with **background colors** showing wind speed
- **Directional arrows** showing wind direction
- **Clear, static visualization** (no flowing particles)
- **Time slider** to animate through forecast hours

---

## 📋 Current Status vs Target

| Component | Current Status | Target | Priority |
|-----------|---------------|--------|----------|
| **Backend API** | ✅ Working (`/api/wind-overlay`) | ✅ Ready | Done |
| **Data Source** | ⚠️ Mock/sample data | ❌ Real GRIB2 from NOAA | **HIGH** |
| **Visualization** | ❌ Particle animation (disabled) | ❌ Grid + arrows | **HIGH** |
| **Time Control** | ❌ Single snapshot | ❌ Slider (0-120 hours) | MEDIUM |
| **Color Scale** | ⚠️ Needs adjustment | ❌ iWindsurf colors | MEDIUM |
| **Models** | ✅ GFS, HRRR, NAM ready | ✅ Multi-model | Done |

---

## 🛠️ Phase 1: Real Data Integration

### Step 1A: Fetch Real NOAA Wind Data

**Libraries Needed:**
```bash
pip install pygrib cfgrib
# or use NOAA's HTTP GRIB filter API (simpler)
```

**Data Source Options:**

#### Option A: NOAA GRIB Filter API (Recommended - No File Download)
```python
# Fetch pre-filtered GRIB2 data via HTTP
# Example for HRRR:
url = "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl"
params = {
    "file": "hrrr.t00z.wrfsfcf00.grib2",  # Current forecast
    "lev_10_m_above_ground": "on",        # 10m wind level
    "var_UGRD": "on",                     # U-component (east-west)
    "var_VGRD": "on",                     # V-component (north-south)
    "subregion": "",
    "leftlon": -125,                       # California bounds
    "rightlon": -114,
    "toplat": 42,
    "bottomlat": 32
}
# Returns filtered GRIB2 file
```

#### Option B: AWS Open Data (Alternative)
```python
# GFS data on AWS S3
bucket = "noaa-gfs-bdp-pds"
path = f"gfs.{date}/00/atmos/gfs.t00z.pgrb2.0p25.f000"
# Requires AWS SDK and GRIB parser
```

### Step 1B: Parse GRIB2 Data

**Backend Function** (`backend/main.py`):
```python
import requests
import cfgrib
import xarray as xr

async def fetch_real_wind_forecast(model="hrrr", hours=48):
    """
    Fetch real wind data from NOAA GRIB2 files
    """
    # 1. Build NOAA filter URL
    base_urls = {
        "hrrr": "https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl",
        "gfs": "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl",
        "nam": "https://nomads.ncep.noaa.gov/cgi-bin/filter_nam.pl"
    }
    
    # 2. Fetch GRIB2 file for California region
    response = requests.get(base_urls[model], params={...})
    
    # 3. Parse with cfgrib
    ds = xr.open_dataset(response.content, engine='cfgrib')
    
    # 4. Extract U/V wind components
    u_wind = ds['u10']  # U-component at 10m
    v_wind = ds['v10']  # V-component at 10m
    
    # 5. Convert to speed and direction
    speed = np.sqrt(u_wind**2 + v_wind**2) * 1.94384  # m/s to knots
    direction = (270 - np.degrees(np.arctan2(v_wind, u_wind))) % 360
    
    # 6. Downsample to reasonable grid (every ~20km)
    # Return as JSON
    return wind_vectors
```

**Challenges:**
- GRIB2 files are large (~50-200 MB)
- Need to downsample/filter for web delivery
- NOAA filter API can be slow
- Consider caching downloaded GRIB files

**Estimated Time:** 4-6 hours

---

## 🎨 Phase 2: Frontend Grid Visualization

### Step 2A: Grid-Based Rendering (iWindsurf Style)

**Replace** `WindParticles.js` with **`WindGrid.js`**:

```javascript
// WindGrid.js - iWindsurf-style grid visualization
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

const WindGrid = ({ windData, model }) => {
  const map = useMap();
  
  useEffect(() => {
    if (!windData || !windData.vectors) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Grid cell size (adjust for zoom level)
    const cellSize = 40; // pixels
    
    function drawWindGrid() {
      const bounds = map.getBounds();
      
      windData.vectors.forEach(vector => {
        const point = map.latLngToContainerPoint([vector.lat, vector.lon]);
        
        // 1. Draw colored background cell
        const color = getWindSpeedColor(vector.speed_kts);
        ctx.fillStyle = color;
        ctx.fillRect(
          point.x - cellSize/2, 
          point.y - cellSize/2, 
          cellSize, 
          cellSize
        );
        
        // 2. Draw directional arrow
        drawArrow(ctx, point.x, point.y, vector.direction_deg, vector.speed_kts);
      });
    }
    
    function getWindSpeedColor(speed) {
      // iWindsurf-inspired color scale
      if (speed < 5) return 'rgba(173, 216, 230, 0.6)';      // Light blue
      if (speed < 10) return 'rgba(0, 206, 209, 0.7)';       // Teal
      if (speed < 15) return 'rgba(144, 238, 144, 0.7)';     // Light green
      if (speed < 20) return 'rgba(255, 255, 0, 0.75)';      // Yellow
      if (speed < 25) return 'rgba(255, 165, 0, 0.8)';       // Orange
      if (speed < 30) return 'rgba(255, 69, 0, 0.85)';       // Red-orange
      if (speed < 35) return 'rgba(220, 20, 60, 0.9)';       // Crimson
      return 'rgba(139, 0, 139, 0.95)';                      // Dark magenta
    }
    
    function drawArrow(ctx, x, y, direction, speed) {
      const arrowLength = Math.min(cellSize * 0.6, speed * 1.5);
      const arrowWidth = 3;
      
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((direction - 180) * Math.PI / 180); // Point where wind is going
      
      // Arrow shaft
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = arrowWidth;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -arrowLength);
      ctx.stroke();
      
      // Arrow head
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.moveTo(0, -arrowLength);
      ctx.lineTo(-5, -arrowLength + 8);
      ctx.lineTo(5, -arrowLength + 8);
      ctx.closePath();
      ctx.fill();
      
      ctx.restore();
    }
    
    // Redraw on map move/zoom
    map.on('moveend', drawWindGrid);
    map.on('zoomend', drawWindGrid);
    
    drawWindGrid();
    
    return () => {
      map.off('moveend', drawWindGrid);
      map.off('zoomend', drawWindGrid);
    };
  }, [map, windData]);
  
  return null;
};

export default WindGrid;
```

**Key Differences from Particle Animation:**
- ✅ Static grid (no animation loop)
- ✅ Clear arrow directions
- ✅ Background colors show speed intensity
- ✅ Semi-transparent to see map underneath
- ✅ Redraws only on map move/zoom (performance)

**Estimated Time:** 2-3 hours

---

## 🕐 Phase 3: Time-Based Forecast Animation

### Step 3A: Fetch Multi-Hour Forecast

**Backend Update:**
```python
@app.get("/api/wind-overlay-forecast")
async def get_wind_overlay_forecast(
    model: str = "hrrr",
    hours: int = 48
):
    """
    Return wind forecast for multiple hours (0, 3, 6, 9, ... hours)
    """
    forecasts = []
    for hour in range(0, hours + 1, 3):  # 3-hour intervals
        wind_data = await fetch_real_wind_forecast(model, forecast_hour=hour)
        forecasts.append({
            "forecast_hour": hour,
            "timestamp": (datetime.utcnow() + timedelta(hours=hour)).isoformat(),
            "vectors": wind_data
        })
    
    return {
        "model": model,
        "forecasts": forecasts
    }
```

### Step 3B: Frontend Time Slider

```javascript
// Add to MapOverlay.js
import Slider from '@mui/material/Slider';  // or any slider component

const [forecastHour, setForecastHour] = useState(0);
const [forecastData, setForecastData] = useState(null);

// Fetch multi-hour forecast
useEffect(() => {
  if (windOverlayEnabled) {
    fetch(`/api/wind-overlay-forecast?model=${selectedModel}&hours=48`)
      .then(res => res.json())
      .then(data => setForecastData(data));
  }
}, [windOverlayEnabled, selectedModel]);

// Render slider
<Slider
  value={forecastHour}
  onChange={(e, value) => setForecastHour(value)}
  min={0}
  max={48}
  step={3}
  marks={[
    { value: 0, label: 'Now' },
    { value: 24, label: '+24h' },
    { value: 48, label: '+48h' }
  ]}
/>

// Pass current forecast hour data to WindGrid
<WindGrid 
  windData={forecastData?.forecasts.find(f => f.forecast_hour === forecastHour)}
  model={selectedModel}
/>
```

**Estimated Time:** 2-3 hours

---

## 📐 Technical Specifications

### Grid Resolution

| Model | Native Grid | Display Grid | Rationale |
|-------|-------------|--------------|-----------|
| **HRRR** | 3 km | ~10-15 km | Balance detail vs performance |
| **GFS** | 25 km | ~25 km | Use native resolution |
| **NAM** | 12 km | ~15-20 km | Slight downsampling |

### Color Scale (Final)

```javascript
const WIND_COLORS = [
  { max: 5,  color: '#ADD8E6', label: 'Light' },       // Light blue
  { max: 10, color: '#00CED1', label: 'Gentle' },      // Teal
  { max: 15, color: '#90EE90', label: 'Moderate' },    // Light green
  { max: 20, color: '#FFFF00', label: 'Fresh' },       // Yellow
  { max: 25, color: '#FFA500', label: 'Strong' },      // Orange
  { max: 30, color: '#FF4500', label: 'Very Strong' }, // Red-orange
  { max: 35, color: '#DC143C', label: 'Gale' },        // Crimson
  { max: 99, color: '#8B008B', label: 'Storm' }        // Dark magenta
];
```

### Performance Targets

- **Grid Density**: ~50-100 cells per screen
- **Redraw Time**: < 100ms
- **Cache Duration**: 10 minutes
- **Max Forecast Range**: 48 hours (HRRR), 120 hours (GFS)

---

## 📅 Implementation Timeline

| Task | Estimated Time | Priority | Blocking? |
|------|----------------|----------|-----------|
| **1. Real GRIB2 data fetching** | 4-6 hours | HIGH | Yes |
| **2. Grid-based visualization** | 2-3 hours | HIGH | No (can mock) |
| **3. Color scale refinement** | 1 hour | MEDIUM | No |
| **4. Multi-hour forecast API** | 2 hours | MEDIUM | No |
| **5. Time slider UI** | 2-3 hours | MEDIUM | No |
| **6. Testing & refinement** | 2-3 hours | HIGH | No |

**Total:** ~13-18 hours for complete implementation

---

## 🚀 Quick Start (MVP Approach)

### Minimum Viable Product (4-6 hours):

1. **Real GRIB2 Integration** (4-5 hours)
   - Use NOAA HTTP filter API (simpler than file download)
   - Parse U/V components
   - Return ~100 wind vectors for California

2. **Grid Visualization** (1-2 hours)
   - Colored cells + arrows
   - Static (no time slider initially)
   - Current/nowcast conditions only

3. **Test with HRRR** (30 min)
   - Start with 1 model (HRRR recommended)
   - Add GFS/NAM later

**Result:** Working wind overlay like iWindsurf!

---

## 🔧 Development Steps (Detailed)

### Step 1: Backend - NOAA Integration
```bash
cd backend
source venv/bin/activate
pip install cfgrib pygrib  # or use HTTP API only
```

Update `main.py`:
- Replace mock data in `/api/wind-overlay`
- Add NOAA GRIB filter API calls
- Parse and downsample wind data
- Test with: `curl localhost:8000/api/wind-overlay?model=hrrr`

### Step 2: Frontend - Grid Component
```bash
cd frontend
```

Create `src/WindGrid.js`:
- Canvas-based grid renderer
- Colored cells based on wind speed
- White arrows for direction
- Integrate with map zoom/pan

### Step 3: Integration
Update `MapOverlay.js`:
- Replace `WindParticles` with `WindGrid`
- Add model selector (radio buttons: HRRR, GFS, NAM)
- Re-enable overlay controls (remove `{false &&` wrapper)

### Step 4: Test
- Start backend: `uvicorn main:app --reload`
- Start frontend: `npm start`
- Toggle wind overlay
- Verify grid appears with arrows and colors

---

## 📊 Success Criteria

### MVP Complete When:
- ✅ Real wind data from NOAA (not mock)
- ✅ Grid visualization with colors + arrows
- ✅ At least HRRR model working
- ✅ Updates on map zoom/pan
- ✅ Semi-transparent to see map underneath
- ✅ Toggleable on/off

### Full Version Complete When:
- ✅ All 3 models (HRRR, GFS, NAM)
- ✅ Time slider (0-48 hours for HRRR)
- ✅ Smooth performance (< 100ms redraws)
- ✅ Legend showing color scale
- ✅ Model info display

---

## 📚 Resources

### NOAA Data Access
- **NOMADS Filter Services**: https://nomads.ncep.noaa.gov/
- **HRRR Filter**: https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl
- **GFS Filter**: https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl
- **GRIB Documentation**: https://www.nco.ncep.noaa.gov/pmb/docs/grib2/

### Python Libraries
- **cfgrib**: https://github.com/ecmwf/cfgrib
- **pygrib**: https://github.com/jswhit/pygrib
- **xarray**: https://docs.xarray.dev/

### Inspiration
- **iWindsurf**: https://wx.iwindsurf.com/map
- **Windfinder**: https://www.windfinder.com/
- **PredictWind**: https://www.predictwind.com/

---

## 💡 Key Decisions Made

1. **Grid over Particles**: Based on user feedback ("forget the flow")
2. **iWindsurf Style**: Clear, static visualization preferred
3. **NOAA GRIB2**: Real data source identified
4. **HTTP Filter API**: Simpler than downloading/parsing full files
5. **HRRR Priority**: Best for California (3km resolution)
6. **48h Forecast**: HRRR's max range, good for surf planning

---

**Ready to implement?** Start with Phase 1 (Real Data) for immediate impact! 🚀

