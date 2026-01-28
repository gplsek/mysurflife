# Surf Spots UI Implementation Plan

## Changes to MapOverlay.js

### 1. Add State Variables (after line 259)

```javascript
// Surf spots state
const [surfSpots, setSurfSpots] = useState([]);
const [surfSpotsLoading, setSurfSpotsLoading] = useState(false);
const [showSurfSpots, setShowSurfSpots] = useState(true); // Toggle visibility
const [selectedSpot, setSelectedSpot] = useState(null); // For detail panel
```

### 2. Add Custom Icon Function (after line 45)

```javascript
const getSurfSpotIcon = (score) => {
  // Color-code by surf score (0-10 scale)
  let color;
  if (score >= 8.5) {
    color = 'red'; // Epic (fire emoji)
  } else if (score >= 7.0) {
    color = 'green'; // Good
  } else if (score >= 5.0) {
    color = 'orange'; // Fair
  } else if (score >= 3.0) {
    color = 'gold'; // Poor
  } else {
    color = 'grey'; // Flat
  }

  return new L.DivIcon({
    className: 'surf-spot-marker',
    html: `
      <div style="
        background-color: ${color};
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
      ">
        🏄
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
};
```

### 3. Add Fetch Function (after fetchBuoyData at line 540)

```javascript
const fetchSurfSpots = async () => {
  try {
    setSurfSpotsLoading(true);
    // Fetch with scores for real-time conditions
    const res = await fetch('/api/surf-spots?with_scores=true');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setSurfSpots(data.spots || []);
    console.log(`✅ Loaded ${data.count} surf spots`);
  } catch (err) {
    console.error('❌ Error fetching surf spots:', err);
    setSurfSpots([]);
  } finally {
    setSurfSpotsLoading(false);
  }
};
```

### 4. Add useEffect to Fetch on Mount (after buoy fetch useEffect)

```javascript
// Fetch surf spots on mount
useEffect(() => {
  fetchSurfSpots();
  // Update every 10 minutes (same as buoys)
  const interval = setInterval(fetchSurfSpots, 10 * 60 * 1000);
  return () => clearInterval(interval);
}, []);
```

### 5. Add Spot Click Handler

```javascript
const handleSpotClick = (spot) => {
  setSelectedSpot(spot);
  setSelectedBuoy(null); // Clear buoy selection
  setShowChart(false);
  setShowForecast(false);
  // Optional: Fetch more detailed conditions
};
```

### 6. Render Surf Spot Markers (after buoy markers around line 2682)

```javascript
{/* Surf Spots */}
{showSurfSpots && surfSpots.map((spot) => {
  const conditions = spot.current_conditions;
  const score = conditions?.overall_score || 0;

  return (
    <Marker
      key={spot.id}
      position={[spot.latitude, spot.longitude]}
      icon={getSurfSpotIcon(score)}
      eventHandlers={{
        click: () => handleSpotClick(spot)
      }}
    >
      <Popup>
        <div style={{ textAlign: 'center', minWidth: '200px' }}>
          <strong style={{ fontSize: '14px' }}>
            {spot.name}
          </strong>
          {conditions && (
            <>
              <div style={{
                fontSize: '24px',
                margin: '8px 0',
                color: score >= 7 ? '#22c55e' : score >= 5 ? '#f59e0b' : '#ef4444'
              }}>
                {conditions.emoji} {score}/10
              </div>
              <div style={{ fontSize: '12px', color: '#666' }}>
                {conditions.rating}
              </div>
              <div style={{ fontSize: '11px', marginTop: '8px' }}>
                {conditions.adjusted_height_ft}ft @ {conditions.period_sec}s
              </div>
            </>
          )}
        </div>
      </Popup>
    </Marker>
  );
})}
```

### 7. Add Toggle Button (in header controls)

```javascript
<button
  onClick={() => setShowSurfSpots(!showSurfSpots)}
  style={{
    padding: '8px 16px',
    backgroundColor: showSurfSpots ? '#3b82f6' : '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    marginLeft: '8px'
  }}
>
  🏄 {showSurfSpots ? 'Hide' : 'Show'} Surf Spots
</button>
```

### 8. Add Spot Detail Panel (similar to buoy detail)

```javascript
{selectedSpot && (
  <div style={{
    position: 'absolute',
    top: '100px',
    right: '20px',
    width: '350px',
    maxHeight: '70vh',
    overflowY: 'auto',
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    padding: '20px',
    zIndex: 1000,
  }}>
    <button
      onClick={() => setSelectedSpot(null)}
      style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        background: 'none',
        border: 'none',
        fontSize: '24px',
        cursor: 'pointer',
        color: '#666'
      }}
    >
      ×
    </button>

    <h2 style={{ marginTop: 0 }}>{selectedSpot.name}</h2>

    {selectedSpot.current_conditions && (
      <>
        <div style={{ textAlign: 'center', margin: '20px 0' }}>
          <div style={{ fontSize: '48px' }}>
            {selectedSpot.current_conditions.emoji}
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
            {selectedSpot.current_conditions.overall_score}/10
          </div>
          <div style={{ fontSize: '18px', color: '#666' }}>
            {selectedSpot.current_conditions.rating}
          </div>
        </div>

        <div style={{ marginTop: '20px' }}>
          <h3>Current Conditions</h3>
          <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
            <div>📏 Wave Height: {selectedSpot.current_conditions.adjusted_height_ft}ft</div>
            <div>⏱️ Period: {selectedSpot.current_conditions.period_sec}s</div>
            <div>🧭 Swell Direction: {selectedSpot.current_conditions.swell_direction}°</div>
            {selectedSpot.current_conditions.wind_speed_mph && (
              <div>💨 Wind: {selectedSpot.current_conditions.wind_speed_mph}mph</div>
            )}
          </div>
        </div>

        <div style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
          Data from {selectedSpot.current_conditions.buoys_used?.length} buoys
          (Primary: {selectedSpot.current_conditions.primary_buoy})
        </div>
      </>
    )}

    <div style={{ marginTop: '20px' }}>
      <h3>Spot Info</h3>
      <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
        <div>🌊 Type: {selectedSpot.spot_characteristics?.break_type}</div>
        <div>🎯 Skill: {selectedSpot.spot_characteristics?.skill_level}</div>
        <div>📐 Best Swell: {selectedSpot.spot_characteristics?.best_swell_direction}</div>
        <div>💨 Best Wind: {selectedSpot.spot_characteristics?.best_wind_direction}</div>
      </div>
    </div>
  </div>
)}
```

## Implementation Steps

1. ✅ Backend API complete
2. ⏳ Add state variables to MapOverlay.js
3. ⏳ Add fetch function
4. ⏳ Create custom spot icon
5. ⏳ Render spot markers with color-coding
6. ⏳ Add spot click handler
7. ⏳ Create spot detail panel
8. ⏳ Add toggle button
9. ⏳ Test with all 5 spots

## Testing Checklist

- [ ] Spots load on page load
- [ ] Spots display with correct colors (🟢 green for 7+, 🟡 orange for 5-7, 🔴 red for <5)
- [ ] Clicking spot shows detail panel
- [ ] Toggle button shows/hides spots
- [ ] Spots update every 10 minutes
- [ ] Spot markers have surf emoji 🏄
- [ ] Detail panel shows score, conditions, and spot info
- [ ] Can switch between buoy and spot panels
- [ ] Works on mobile (responsive)

## Color Scheme

**Surf Spot Markers** (based on 0-10 score):
- 🔴 Red (8.5-10): Epic
- 🟢 Green (7-8.5): Good
- 🟡 Orange (5-7): Fair
- 🟠 Gold (3-5): Poor
- ⚪ Grey (0-3): Flat

**Buoy Markers** (existing):
- 🟢 Green: Good conditions (score 3)
- 🟠 Orange: Moderate (score 2)
- 🔴 Red: Poor (score 1)
- ⚪ Grey: No data (score 0)

Different icons help distinguish spots from buoys at a glance.