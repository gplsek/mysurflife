# Surf Spot Detail Page - Design Plan

## Screenshot Analysis (spot-detail.png)

### Layout Components

#### 1. Header Section
- **Back navigation** ("< The Pass")
- **Spot name** as title
- **Action buttons** (bookmark, share, menu)

#### 2. Hero Image/Map
- **Large satellite view** of the break location
- Shows coastline, water, and break position
- Interactive map or static high-res image

#### 3. Condition Indicators (Top Right Overlay)
- **Multiple metric boxes** stacked vertically
- Each shows an icon + value
- Appears to show: Wind, Swell direction, Tide, Rating
- Color-coded (green/blue/white backgrounds)

#### 4. Swell Breakdown Table (Primary Content)
- **Multiple swell components** (Swell 1, Swell 2, Swell 3)
- **Columns**: Height (m), Period (s), Direction (degrees), Type, Rating
- **Color-coded rows**: Blue, Pink, Yellow (different swell sources)
- Shows how different swells combine at the spot

#### 5. Timeline/Forecast Selector (Bottom)
- **Date navigation**: Previous date, Today, Next date
- **Time slider**: Hour-by-hour forecast (e.g., "2:00 pm")
- **View toggles**: "Hourly" vs "3 Day"
- Shows conditions at selected time

#### 6. Location Info
- **Pin icon** + location/region name

---

## Our Data Structure vs Screenshot

### What We Have ✅

**From Backend**:
- Spot name, location (lat/lon)
- Current conditions score (0-10)
- Wave height (blended from multiple buoys)
- Wave period
- Swell direction
- Wind speed and direction
- Break type, bottom type
- Skill level, hazards
- Optimal conditions (swell/wind/tide preferences)
- Buoy data sources (3-5 per spot)

**From Buoy API**:
- Historical data (48 hours)
- Multiple data points per hour
- Wave height, period, direction over time
- Can show trends

### What We're Missing ⚠️

**Advanced Features** (would require new integrations):
- Individual swell component breakdown (primary, secondary, wind swell)
  - *Screenshot shows 3 separate swells with different periods/directions*
  - *This requires wave spectrum analysis or CDIP buoy data*
- Tide predictions (high/low tide times)
  - *Would need NOAA tide API*
- Hourly forecast timeline
  - *We have WaveWatch III forecast data but not spot-specific yet*
- Wind forecast (GFS/HRRR has this, need to map to spot)

### What We Can Build Now ✅

**Phase 1 - MVP** (using current data):
1. Spot name + location
2. Current conditions score with breakdown
3. Current wave/wind conditions from blended buoys
4. Historical chart (past 48 hours)
5. Optimal conditions reference
6. Spot characteristics (break type, skill, hazards)
7. Buoy data sources with map

**Phase 2 - Enhanced** (new integrations):
1. Add tide data (NOAA CO-OPS tide API)
2. Add hourly forecast from WaveWatch III
3. Add wind forecast from GFS/HRRR
4. Timeline slider for forecast hours

**Phase 3 - Advanced** (complex):
1. Individual swell components (requires CDIP spectral data)
2. Webcam integration
3. User session logs
4. Community reports

---

## Proposed Layout (MVP)

### Route
`/spots/:slug` (e.g., `/spots/swamis`)

### Page Structure

```
┌─────────────────────────────────────────────────┐
│ < Back to Map          Swamis          🔖 ⚙️    │  Header
├─────────────────────────────────────────────────┤
│                                                 │
│        [Satellite Map of Break Location]       │  Hero Image
│                                                 │
│                    🏄 World Class              │
│                                                 │
├─────────────────────────────────────────────────┤
│  Current Conditions                    Last Updated: 2:35 PM │
│                                                               │
│  ┌──────────────────────────────────────┐                   │
│  │     🟢 7.2 / 10                      │  Score Card        │
│  │        Good                           │                   │
│  │                                       │                   │
│  │  📏 2.3 ft  ⏱️ 12.7s  🧭 251°        │  Wave Info        │
│  │  💨 Light wind  🌊 SW Swell          │  Wind/Swell       │
│  └──────────────────────────────────────┘                   │
│                                                               │
│  Score Breakdown:                                            │
│  ├─ Swell Direction    1.5/3  ██████░░░░                    │
│  ├─ Swell Size         2.7/3  █████████░                    │
│  ├─ Wind Direction     1.0/2  █████░░░░░                    │
│  └─ Wind Speed         2.0/2  ██████████                    │
├─────────────────────────────────────────────────┤
│  Historical Conditions (Past 48 Hours)          │
│                                                  │
│  [Line Chart: Wave Height + Period over time]   │  Chart
│                                                  │
├─────────────────────────────────────────────────┤
│  Spot Information                                │
│                                                  │
│  🌊 Break Type:        Point break (reef)       │
│  📐 Best Swell:        NW, W (280-320°)        │  Info Grid
│  💨 Best Wind:         E, ESE (offshore)        │
│  🌊 Best Tide:         Low-Mid                  │
│  🎯 Skill Level:       Experienced              │
│  ⚠️  Hazards:          Rocks, shallow, crowd     │
│  📏 Works:             2-16 ft                   │
│  🏖️  Access:           Stairs below SRF          │
├─────────────────────────────────────────────────┤
│  Buoy Data Sources                               │
│                                                  │
│  ├─ 46224 Oceanside (40%)    [View on Map]     │  Buoy List
│  ├─ 46275 Red Beach (30%)    [View on Map]     │
│  ├─ 46225 Torrey Pines (20%) [View on Map]     │
│  └─ 46277 Green Beach (10%)  [View on Map]     │
└─────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Step 1: Create Route + Component

**Files to create**:
- `frontend/src/SpotDetail.js` - Main detail page component
- Update `frontend/src/App.js` - Add route `/spots/:slug`

**State management**:
```javascript
const [spot, setSpot] = useState(null);
const [conditions, setConditions] = useState(null);
const [historicalData, setHistoricalData] = useState([]);
const [loading, setLoading] = useState(true);
```

### Step 2: Fetch Data

```javascript
// Fetch spot details
const spotData = await fetch(`/api/surf-spots/${slug}`);

// Fetch current conditions
const conditionsData = await fetch(`/api/surf-spots/${slug}/conditions`);

// Fetch historical data for buoys (blend multiple buoys)
// Use buoy blend weights to fetch and merge history
const buoyBlend = spot.spot_forecast_tuning.buoy_blend;
const buoyHistories = await Promise.all(
  Object.keys(buoyBlend).map(buoyId =>
    fetch(`/api/buoy-history/${buoyId}?hours=48`)
  )
);
```

### Step 3: Build Components

#### Hero Section
```javascript
<div className="hero">
  <div className="hero-image">
    {/* Leaflet map or satellite image */}
    <MapContainer center={[spot.latitude, spot.longitude]} zoom={15}>
      <TileLayer url="satellite" />
      <Marker position={[spot.latitude, spot.longitude]} />
    </MapContainer>
  </div>
  <div className="hero-badge">
    🏄 {spot.spot_characteristics.wave_quality}
  </div>
</div>
```

#### Score Card
```javascript
<div className="score-card">
  <div className="score-main">
    {conditions.emoji} {conditions.overall_score}/10
  </div>
  <div className="score-rating">{conditions.rating}</div>

  <div className="conditions-summary">
    <span>📏 {conditions.adjusted_height_ft}ft</span>
    <span>⏱️ {conditions.period_sec}s</span>
    <span>🧭 {conditions.swell_direction}°</span>
  </div>

  <div className="score-breakdown">
    <ScoreBar label="Swell Direction" score={1.5} max={3} />
    <ScoreBar label="Swell Size" score={2.7} max={3} />
    <ScoreBar label="Wind Direction" score={1.0} max={2} />
    <ScoreBar label="Wind Speed" score={2.0} max={2} />
  </div>
</div>
```

#### Historical Chart
```javascript
<div className="chart-section">
  <h3>Historical Conditions (Past 48 Hours)</h3>
  <ResponsiveContainer width="100%" height={300}>
    <LineChart data={historicalData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="time" />
      <YAxis yAxisId="left" label={{ value: 'Height (ft)', angle: -90 }} />
      <YAxis yAxisId="right" orientation="right" label={{ value: 'Period (s)', angle: 90 }} />
      <Tooltip />
      <Legend />
      <Line yAxisId="left" type="monotone" dataKey="waveHeight" stroke="#3b82f6" name="Wave Height" />
      <Line yAxisId="right" type="monotone" dataKey="period" stroke="#22c55e" name="Period" />
    </LineChart>
  </ResponsiveContainer>
</div>
```

#### Info Grid
```javascript
<div className="info-grid">
  <InfoRow icon="🌊" label="Break Type" value={spot.spot_characteristics.break_type} />
  <InfoRow icon="📐" label="Best Swell" value={spot.spot_characteristics.best_swell_direction} />
  <InfoRow icon="💨" label="Best Wind" value={spot.spot_characteristics.best_wind_direction} />
  <InfoRow icon="🌊" label="Best Tide" value={spot.spot_characteristics.tide_position} />
  <InfoRow icon="🎯" label="Skill Level" value={spot.spot_characteristics.skill_level} />
  <InfoRow icon="⚠️" label="Hazards" value={spot.spot_characteristics.hazards.join(', ')} />
  <InfoRow icon="📏" label="Works" value={`${spot.spot_characteristics.works_from_swell_ft}-${spot.spot_characteristics.works_to_swell_ft} ft`} />
  <InfoRow icon="🏖️" label="Access" value={spot.access_description} />
</div>
```

#### Buoy Sources
```javascript
<div className="buoy-sources">
  <h3>Buoy Data Sources</h3>
  {Object.entries(spot.spot_forecast_tuning.buoy_blend).map(([buoyId, config]) => (
    <div key={buoyId} className="buoy-item">
      <span>{buoyId} ({config.role})</span>
      <span>{(config.weight * 100).toFixed(0)}%</span>
      <button onClick={() => flyToBuoy(buoyId)}>View on Map</button>
    </div>
  ))}
</div>
```

### Step 4: Styling

**CSS Approach**: Mobile-first, responsive
- Hero image: Full width, 40vh height on desktop, 30vh on mobile
- Score card: Centered, card with shadow, prominent score
- Chart: Responsive container, touch-friendly on mobile
- Info grid: 2 columns on desktop, 1 column on mobile
- Color scheme: Match existing app (blues, greens for good conditions)

### Step 5: Navigation

**Link from map**:
- Update popup to include "View Details" button
- Link to `/spots/{slug}`

**Link from list**:
- Future: Create `/spots` listing page
- Each spot card links to detail page

---

## Enhanced Features (Phase 2)

### Tide Integration

**API**: NOAA CO-OPS Tide Predictions
```
https://api.tidesandcurrents.noaa.gov/api/prod/datagetter
?product=predictions
&application=MySurfLife
&begin_date=YYYYMMDD
&end_date=YYYYMMDD
&datum=MLLW
&station=STATION_ID
&time_zone=lst_ldt
&units=english
&interval=hilo
&format=json
```

**Display**:
- Show today's high/low tide times
- Indicator for current tide position
- Icon: 🌊 High / 🏖️ Low

### Hourly Forecast

**Data Source**: WaveWatch III forecast data (already available)
- Use `/api/waves-overlay` to get forecast grid
- Extract data point for spot's lat/lon
- Show timeline slider (0-180 hours)

**UI**:
```
┌────────────────────────────────────────┐
│  Forecast Timeline                     │
│  Now    6h     12h    18h    24h       │
│  ├──────┼──────┼──────┼──────┤        │
│  7.2    7.5    7.8    7.3    6.9       │
│  🟢     🟢     🟢     🟢     🟡        │
└────────────────────────────────────────┘
```

### Swell Components

**Requires**: CDIP spectral data or WaveWatch III partitioned swells
- Primary swell (longest period)
- Secondary swell
- Wind swell (short period)

**Display**: Table like screenshot
```
┌──────┬────────┬────────┬──────────┬──────┐
│      │ Height │ Period │ Direction│ Type │
├──────┼────────┼────────┼──────────┼──────┤
│ 🔵 1 │ 1.5m   │ 13s    │ 300° NW  │ Long │
│ 🟣 2 │ 0.8m   │ 8s     │ 240° SW  │ Mid  │
│ 🟡 3 │ 0.3m   │ 4s     │ 180° S   │ Wind │
└──────┴────────┴────────┴──────────┴──────┘
```

---

## File Structure

```
frontend/src/
├── App.js (add route)
├── SpotDetail.js (new - main component)
├── components/
│   ├── SpotHero.js (hero image section)
│   ├── ScoreCard.js (current conditions card)
│   ├── ScoreBar.js (progress bar for score breakdown)
│   ├── HistoricalChart.js (reuse from buoy detail)
│   ├── SpotInfoGrid.js (info rows)
│   ├── BuoySourceList.js (buoy sources with links)
│   └── SpotDetail.css (styling)
```

---

## API Additions Needed

### 1. Blended Historical Data (Optional)

**New endpoint**: `GET /api/surf-spots/{slug}/history?hours=48`

Returns blended buoy history using spot's buoy weights:
```json
{
  "spot_slug": "swamis",
  "hours": 48,
  "data": [
    {
      "timestamp": "2026-01-23T12:00:00Z",
      "wave_height_m": 0.7,
      "period_sec": 12.5,
      "direction": 255,
      "buoys_used": ["46224", "46275"]
    }
  ]
}
```

**Implementation**: Merge multiple buoy histories with weights

### 2. Spot Forecast (Phase 2)

**New endpoint**: `GET /api/surf-spots/{slug}/forecast?hours=72`

Returns hourly forecast scores for the spot:
```json
{
  "spot_slug": "swamis",
  "forecast": [
    {
      "timestamp": "2026-01-23T13:00:00Z",
      "forecast_hour": 0,
      "score": 7.2,
      "wave_height_ft": 2.3,
      "period_sec": 12.7,
      "rating": "Good"
    }
  ]
}
```

---

## Next Steps

1. **Review this plan** - Confirm the approach and features
2. **Create SpotDetail.js component** - Build MVP with current data
3. **Add routing** - Set up `/spots/:slug` route
4. **Style the page** - Make it look good on mobile and desktop
5. **Test with all 5 spots** - Ensure it works for each spot type
6. **Add "View Details" link** - From map popup to detail page

## Questions to Answer

1. **Hero image**: Use satellite map (interactive) or static image?
2. **Historical data**: Show blended data or individual buoy charts?
3. **Navigation**: Add breadcrumbs or just back button?
4. **Mobile layout**: Full-screen or keep header?
5. **Chart period**: 24h, 48h, or 7 days?

---

## Design Inspiration (from screenshot)

**Good elements to adopt**:
- Large hero image (visually appealing)
- Clear score/rating display
- Swell breakdown table (when we have data)
- Timeline for forecasts (Phase 2)
- Clean, minimal design
- Color-coded indicators

**Our unique additions**:
- Buoy blending explanation (transparency)
- Score breakdown with bars (educational)
- Link to buoys on map
- Optimal conditions reference
- Access/hazard information