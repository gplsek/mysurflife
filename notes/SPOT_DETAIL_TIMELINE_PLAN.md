# Surf Spot Detail Page - Timeline Forecast Design

## Forecast Data Available

### Wave Forecast (WaveWatch III)
- **Range**: 180 hours (7.5 days)
- **Updates**: Every 6 hours
- **Resolution**: 0.16° (~18km)
- **Data**: Wave height, period, direction

### Wind Forecast (GFS/HRRR/NAM)
- **HRRR**: 48 hours (3km resolution, best for California coast)
- **NAM**: 84 hours (12km resolution)
- **GFS**: 384 hours (25km resolution, global)
- **Recommendation**: Use HRRR for 0-48h, GFS for 48-180h

### Timeline Coverage
**Primary range**: 0-180 hours (7.5 days) to match wave forecast
**Granularity**: 3-hour intervals (60 data points)

---

## Page Layout

```
┌─────────────────────────────────────────────────────────┐
│ < Back to Map          Swamis              🔖 Share ⚙️  │  Header
├─────────────────────────────────────────────────────────┤
│                                                          │
│              [Static Satellite Image]                   │  Hero (no zoom/pan)
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  🏄 World Class                  │   │  Badge Overlay
│  │              📍 Encinitas, CA                    │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  FORECAST: Thu Jan 23, 2:00 PM (Now)                   │  Timeline Header
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  🟢 7.2 / 10    Good Conditions                 │   │  Score Badge
│  └─────────────────────────────────────────────────┘   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │         WIND & SWELL DIRECTION                   │   │
│  │                                                   │   │
│  │              🌬️                                  │   │  Arrow Visualization
│  │             ↗️ 15 mph                           │   │  (Wind arrow)
│  │            E-NE                                  │   │
│  │                                                   │   │
│  │         🌊          🌊                          │   │
│  │        ↖️          ↗️                           │   │  (Swell arrows)
│  │     SW 3.2 ft    NW 1.8 ft                     │   │  Primary + Secondary
│  │     13s period   8s period                      │   │
│  │                                                   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌───────────────────────────────────────────────────┐ │
│  │  TIMELINE (7.5 Days)                              │ │
│  │                                                    │ │
│  │  Now    12h    24h    48h    72h   120h   168h   │ │  Hour markers
│  │   ●──────┼──────┼──────┼──────┼──────┼──────┼   │ │  Slider
│  │   │                                              │ │
│  │   └─ Drag to view forecast                      │ │
│  │                                                    │ │
│  │  [< Today] [Fri] [Sat] [Sun] [Mon] [Tue] [Wed]  │ │  Day chips
│  └───────────────────────────────────────────────────┘ │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  CONDITIONS AT SELECTED TIME                            │
│                                                          │
│  ┌──────────────────────────────────────────────┐     │
│  │  Predicted Surf Size: 4-6 ft                 │     │  Calculated from
│  │  (Based on 3.2ft @ 13s SW + 1.8ft @ 8s NW)   │     │  combined swells
│  └──────────────────────────────────────────────┘     │
│                                                          │
│  ┌────────────────────────────────────────────────┐   │
│  │               SWELL BREAKDOWN                   │   │
│  │                                                  │   │
│  │  Primary Swell (SW)                             │   │  Table
│  │  • Height:    3.2 ft (1.0 m)                   │   │
│  │  • Period:    13 seconds                        │   │
│  │  • Direction: 225° (SW)                        │   │
│  │  • Quality:   🟢 Optimal (matches best window)│   │
│  │                                                  │   │
│  │  Secondary Swell (NW)                           │   │
│  │  • Height:    1.8 ft (0.6 m)                   │   │
│  │  • Period:    8 seconds                         │   │
│  │  • Direction: 315° (NW)                        │   │
│  │  • Quality:   🟢 Optimal (primary window)     │   │
│  │                                                  │   │
│  │  Wind                                            │   │
│  │  • Speed:     15 mph (7 m/s)                   │   │
│  │  • Direction: 45° (NE)                         │   │
│  │  • Quality:   🟢 Offshore                      │   │
│  └────────────────────────────────────────────────┘   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  SCORE BREAKDOWN                                        │
│                                                          │
│  Swell Direction   2.8/3  █████████░                   │  Progress bars
│  Swell Size        2.5/3  ████████░░                   │  (update with
│  Wind Direction    1.8/2  █████████░                   │   timeline)
│  Wind Speed        2.0/2  ██████████                   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  FORECAST CHART (7 Days)                                │
│                                                          │
│  [Line chart showing score over time]                   │  Chart
│  [Vertical line indicates selected time]                │  (0-180 hours)
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  SPOT INFORMATION                                       │
│  [Same as before - static info]                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Arrow Visualization Details

### Wind Arrow (Single)
```
      🌬️
       ↗️  15 mph
      E-NE
```
- **Size**: Large arrow (80px)
- **Color**: Based on speed
  - Green: < 10 mph (light, ideal)
  - Yellow: 10-15 mph (moderate)
  - Orange: 15-20 mph (strong)
  - Red: > 20 mph (blown out)
- **Direction**: Points where wind is GOING (standard convention)
- **Label**: Speed + compass direction (E, NE, SW, etc.)

### Swell Arrows (Multiple)
```
    🌊              🌊
    ↖️              ↗️
  SW 3.2 ft      NW 1.8 ft
  13s period     8s period
  [Primary]      [Secondary]
```

**Primary Swell** (largest/best):
- **Color**: Blue (#3b82f6)
- **Size**: Large arrow (100px)
- **Indicator**: "[Primary]" label or thicker arrow
- Arrow points where swell is COMING FROM

**Secondary Swell**:
- **Color**: Purple (#a855f7)
- **Size**: Medium arrow (70px)
- Shows if significant (> 1 ft or > 20% of primary)

**Wind Swell** (if present):
- **Color**: Grey (#9ca3af)
- **Size**: Small arrow (50px)
- Short period (< 8s) swell

### Arrow Layout
```
┌────────────────────────────────────┐
│     WIND & SWELL DIRECTION         │
│                                     │
│              🌬️                    │  Wind (top)
│             ↗️ 15 mph              │
│            E-NE                     │
│                                     │
│     🌊              🌊            │  Swells (bottom)
│    ↖️              ↗️             │
│  SW 3.2ft        NW 1.8ft         │
│  13s [Pri]       8s [Sec]         │
└────────────────────────────────────┘
```

---

## Timeline Interaction

### Slider Component
```javascript
<input
  type="range"
  min={0}
  max={60}  // 180 hours / 3-hour intervals
  value={selectedHourIndex}
  onChange={(e) => setSelectedHourIndex(parseInt(e.target.value))}
  className="timeline-slider"
/>
```

### Hour Markers
```
Now  12h  24h  48h  72h  120h  168h
 ●────┼────┼────┼────┼─────┼─────┼
```

### Day Chips (Click to jump)
```
[< Today] [Fri] [Sat] [Sun] [Mon] [Tue] [Wed]
    ●                                         (indicator)
```

### Time Display
```
FORECAST: Fri Jan 24, 8:00 AM (+18 hours)
```
- Shows selected date/time
- Shows hours from now ("+18 hours")

---

## Data Updates on Timeline Scrub

### State Management
```javascript
const [timelineIndex, setTimelineIndex] = useState(0);  // Current hour index
const [forecastData, setForecastData] = useState([]);   // All 60 data points

// Derived state for selected time
const selectedForecast = forecastData[timelineIndex];
```

### When Timeline Changes:
1. **Update arrows**:
   - Wind arrow direction rotates
   - Wind speed updates
   - Swell arrows rotate to new directions
   - Swell heights/periods update

2. **Update data table**:
   - Primary swell stats
   - Secondary swell stats (if present)
   - Wind stats
   - Quality indicators (🟢/🟡/🔴)

3. **Update score**:
   - Recalculate surf score for that time
   - Update score breakdown bars
   - Update chart vertical line position

4. **Update predicted surf size**:
   - Apply surf height formula to swell(s)
   - Show range (e.g., "4-6 ft")

---

## Backend API Additions

### 1. Spot Forecast Endpoint

```
GET /api/surf-spots/{slug}/forecast?hours=180
```

**Response**:
```json
{
  "spot_slug": "swamis",
  "spot_name": "Swamis",
  "forecast_hours": 180,
  "interval_hours": 3,
  "data_points": 60,

  "forecast": [
    {
      "forecast_hour": 0,
      "timestamp": "2026-01-23T14:00:00Z",
      "timestamp_local": "2026-01-23T06:00:00-08:00",

      "wave": {
        "primary_swell": {
          "height_m": 1.0,
          "height_ft": 3.2,
          "period_sec": 13,
          "direction": 225,
          "direction_text": "SW"
        },
        "secondary_swell": {
          "height_m": 0.6,
          "height_ft": 1.8,
          "period_sec": 8,
          "direction": 315,
          "direction_text": "NW"
        }
      },

      "wind": {
        "speed_ms": 7,
        "speed_mph": 15,
        "direction": 45,
        "direction_text": "NE"
      },

      "score": {
        "overall": 7.2,
        "rating": "Good",
        "swell_direction_score": 2.8,
        "swell_size_score": 2.5,
        "wind_direction_score": 1.8,
        "wind_speed_score": 2.0
      },

      "surf_prediction": {
        "min_ft": 4,
        "max_ft": 6,
        "quality": "Good",
        "notes": "Clean SW swell with offshore winds"
      }
    },
    // ... 59 more data points
  ],

  "optimal_windows": [
    {
      "start_hour": 12,
      "end_hour": 24,
      "score": 8.5,
      "note": "Best conditions - NW swell peaks with light offshore"
    }
  ]
}
```

### 2. Backend Implementation

**Fetch data from models**:
```python
async def get_spot_forecast(slug: str, hours: int = 180):
    """
    Get spot forecast for next N hours.

    1. Get spot details (lat/lon, buoy blend)
    2. For each forecast hour:
       - Fetch WW3 wave data at spot location
       - Fetch wind data (HRRR/GFS) at spot location
       - Calculate score using spot's scoring algorithm
       - Predict surf size from wave components
    3. Return timeline array
    """

    spot = get_spot_details(slug)
    forecast_points = []

    for hour in range(0, hours, 3):  # 3-hour intervals
        # Get wave forecast at spot location
        wave_data = await get_ww3_at_point(
            lat=spot.latitude,
            lon=spot.longitude,
            forecast_hour=hour
        )

        # Get wind forecast at spot location
        wind_data = await get_wind_at_point(
            lat=spot.latitude,
            lon=spot.longitude,
            forecast_hour=hour,
            model='hrrr' if hour < 48 else 'gfs'
        )

        # Calculate score for this time
        score = calculate_spot_score_at_time(
            spot,
            wave_data,
            wind_data
        )

        # Predict surf size
        surf_prediction = predict_surf_size(
            wave_data,
            spot.characteristics
        )

        forecast_points.append({
            'forecast_hour': hour,
            'timestamp': now + timedelta(hours=hour),
            'wave': wave_data,
            'wind': wind_data,
            'score': score,
            'surf_prediction': surf_prediction
        })

    return {
        'spot_slug': slug,
        'forecast': forecast_points,
        'optimal_windows': find_optimal_windows(forecast_points)
    }
```

**Extract data at point from grid**:
```python
def get_ww3_at_point(lat: float, lon: float, forecast_hour: int):
    """
    Extract wave data at specific lat/lon from WW3 grid.
    Uses bilinear interpolation for accuracy.
    """
    # Fetch WW3 grid for this forecast hour
    grid = fetch_ww3_grid(forecast_hour)

    # Find nearest grid points
    lat_idx, lon_idx = find_nearest_indices(grid, lat, lon)

    # Bilinear interpolation
    hs = interpolate_2d(grid.htsgwsfc, lat, lon, lat_idx, lon_idx)
    tp = interpolate_2d(grid.perpwsfc, lat, lon, lat_idx, lon_idx)
    dir = interpolate_2d(grid.dirpwsfc, lat, lon, lat_idx, lon_idx)

    return {
        'primary_swell': {
            'height_m': hs,
            'period_sec': tp,
            'direction': dir
        }
    }
```

---

## Swell Component Detection

**Simple approach** (for MVP):
- Use WW3 primary wave as "primary swell"
- If available, use WW3 secondary/tertiary components
- If not, just show single swell

**Advanced approach** (future):
- Fetch CDIP spectral data
- Separate into:
  - Long period (> 12s) = Primary swell
  - Mid period (8-12s) = Secondary swell
  - Short period (< 8s) = Wind swell
- Different buoys may have different components

**For MVP**: Single swell is fine, can enhance later

---

## Predicted Surf Size Calculation

```javascript
function predictSurfSize(swells, spot) {
  let totalEnergy = 0;

  // Combine energy from all swells
  swells.forEach(swell => {
    const energy = Math.pow(swell.height_m, 2) * swell.period_sec;
    totalEnergy += energy;
  });

  // Convert back to wave height
  const avgPeriod = swells.reduce((sum, s) => sum + s.period_sec, 0) / swells.length;
  const combinedHeight = Math.sqrt(totalEnergy / avgPeriod);

  // Apply spot multiplier and surf height formula
  const spotMultiplier = spot.hs_multiplier || 1.0;
  const adjustedHeight = combinedHeight * spotMultiplier;

  // Calculate surf face height
  const mult = Math.max(1.0, Math.min(2.2, 0.6 + 0.08 * avgPeriod));
  const surfHeight = adjustedHeight * mult;

  // Return range (±20%)
  return {
    min_ft: Math.round(surfHeight * 0.8 * 3.28084),
    max_ft: Math.round(surfHeight * 1.2 * 3.28084),
    avg_ft: Math.round(surfHeight * 3.28084)
  };
}
```

---

## Mobile Considerations

### Arrow Layout (Mobile)
```
┌────────────────────┐
│  WIND & SWELL      │
│                     │
│      🌬️           │  Wind on top
│      ↗️ 15 mph     │
│                     │
│  🌊       🌊      │  Swells below
│  ↖️       ↗️      │  (stacked if needed)
│ SW 3.2ft  NW 1.8ft│
└────────────────────┘
```

### Timeline (Mobile)
```
┌────────────────────────┐
│ Now   24h   48h   72h  │  Fewer markers
│  ●─────┼─────┼─────┼  │  Larger touch target
└────────────────────────┘
```

### Day Chips (Mobile)
```
< [Today] [Fri] [Sat] >
      ●                    Scroll horizontally
```

---

## Implementation Steps

### Step 1: Backend - Forecast Endpoint (2-3 hours)
- [ ] Create `/api/surf-spots/{slug}/forecast` endpoint
- [ ] Extract WW3 data at spot lat/lon for each hour
- [ ] Extract wind data at spot lat/lon for each hour
- [ ] Calculate score for each time point
- [ ] Predict surf size for each time point
- [ ] Return 60 data points (0-180 hours, 3h intervals)

### Step 2: Frontend - Timeline Component (2 hours)
- [ ] Create timeline slider with hour markers
- [ ] Day chip navigation
- [ ] Time display (date + hours from now)
- [ ] State management for selected hour

### Step 3: Frontend - Arrow Visualization (2 hours)
- [ ] Wind arrow component (rotates with direction)
- [ ] Swell arrow component (supports multiple)
- [ ] Color coding by quality
- [ ] Update arrows when timeline changes

### Step 4: Frontend - Data Table (1 hour)
- [ ] Swell breakdown display
- [ ] Wind info display
- [ ] Quality indicators
- [ ] Updates with timeline

### Step 5: Frontend - Chart with Timeline (1 hour)
- [ ] Score chart over 180 hours
- [ ] Vertical line at selected time
- [ ] Click chart to jump to time

### Step 6: Integration & Polish (2 hours)
- [ ] Connect all pieces
- [ ] Loading states
- [ ] Error handling
- [ ] Mobile responsive
- [ ] Testing

---

## Next Steps

1. **Backend first**: Build forecast endpoint to provide timeline data
2. **Test API**: Verify we can get 180-hour forecast for all 5 spots
3. **Frontend components**: Build timeline + arrows + table
4. **Integration**: Wire everything together
5. **Polish**: Styling, mobile, performance

Ready to start? I can begin with the backend forecast endpoint.