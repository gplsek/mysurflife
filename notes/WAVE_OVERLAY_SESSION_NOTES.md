# Wave Overlay Work Session Notes
**Date**: 2025-12-19
**Status**: In Progress - Debugging viewport coverage and zoom scaling issues

## 🎯 Objective
Implement Windy.com-style wave overlay with:
- Oceanographic color palette (dark navy → cyan → orange → red)
- Full viewport coverage (edge-to-edge rendering)
- Proper zoom scaling (canvas updates when zooming)

## ✅ Completed Changes

### 1. Wave Color Palette - COMPLETE ✅
**File**: `frontend/src/WaveCanvasLayer.js` (lines 137-148)

**Changed from**: Purple/Magenta palette
**Changed to**: Windy oceanographic palette

```javascript
// NEW Color Stops (in feet)
0ft   → Dark Navy (0, 0, 80)       // Calm ocean
2ft   → Dark Blue (0, 80, 180)     // Small waves
4ft   → Medium Blue (0, 160, 220)  // Building swells
6ft   → Cyan (0, 200, 255)         // Good surf
8ft   → Turquoise (100, 255, 200)  // Large swells
10ft  → Yellow-Green (150, 255, 100) // Building energy
12ft  → Yellow-Orange (255, 200, 0)  // Very large
15ft  → Orange (255, 120, 0)         // Extreme
18ft+ → Red (255, 0, 0)              // Massive
```

### 2. Alpha Transparency - COMPLETE ✅
**File**: `frontend/src/WaveCanvasLayer.js` (lines 82-84)

**Changed**:
```javascript
// OLD
const ALPHA_BASE = 0.50;
const MIN_ALPHA = 0.20;
const GAMMA = 0.65;

// NEW - Darker ocean feel
const ALPHA_BASE = 0.45;  // Lower overall transparency
const MIN_ALPHA = 0.10;   // Much more transparent at low heights
const GAMMA = 0.70;       // Smoother progression
```

**Dynamic Alpha** (lines 193-196):
```javascript
// Low waves = very transparent (dark ocean)
// High waves = more opaque (colors pop)
const heightNorm = Math.min(hsFt / 20, 1);
const alphaBoost = Math.pow(heightNorm, 0.8);
const baseAlpha = MIN_ALPHA + (alphaBase - MIN_ALPHA) * alphaBoost;
```

### 3. Legend Updated - COMPLETE ✅
**File**: `frontend/src/WaveHeightLegend.js` (lines 8-18)

Updated to match new oceanographic palette with 9 color stops.

### 4. Backend Bbox Expansion - COMPLETE ✅
**File**: `backend/main.py` (line 1813)

**Changed**:
```python
# OLD: 0.3° expansion (~33km)
rounded_min_lat = max(-90.0, rounded_min_lat - 0.3)

# NEW: 0.75° expansion (~83km) for full coverage
expansion = 0.75  # Aggressive expansion for full viewport coverage
rounded_min_lat = max(-90.0, rounded_min_lat - expansion)
rounded_min_lon = max(-180.0, rounded_min_lon - expansion)
rounded_max_lat = min(90.0, rounded_max_lat + expansion)
rounded_max_lon = min(180.0, rounded_max_lon + expansion)
```

**Why**: WW3 grid is 0.16° resolution. Need substantial padding to ensure interpolation works at viewport edges.

### 5. Zoom Event Listener - COMPLETE ✅
**File**: `frontend/src/WaveCanvasLayer.js` (lines 808-826)

**Added zoomend listener**:
```javascript
// OLD: Missing zoomend
map.on('moveend', handleMapUpdate);
map.on('resize', handleMapUpdate);

// NEW: Added zoomend
map.on('moveend', handleMapUpdate);
map.on('zoomend', handleMapUpdate);  // CRITICAL FIX
map.on('resize', handleMapUpdate);

// And cleanup
map.off('moveend', handleMapUpdate);
map.off('zoomend', handleMapUpdate);  // ADDED
map.off('resize', handleMapUpdate);
```

**Why**: Without this, canvas doesn't redraw when zooming, causing waves to not scale with map.

## ❌ Current Issues

### Issue 1: Viewport Not Filling
**Symptom**: Wave overlay not rendering across entire viewport (gaps at edges)

**Possible Causes**:
1. Backend bbox expansion not sufficient (though we increased to 0.75°)
2. Frontend interpolation failing at edges
3. Land masking too aggressive
4. Data bounds don't match map bounds

### Issue 2: No Zoom Scaling
**Symptom**: Waves don't scale/update when zooming in/out

**Attempted Fix**: Added zoomend listener (line 809)
**Status**: User reports "no change" after fix

**Possible Causes**:
1. Frontend didn't recompile the change
2. Browser cache not cleared
3. Different issue preventing canvas redraw
4. Data not being fetched on zoom

## 🔍 Debugging Steps for Next Session

### 1. Verify Changes Compiled
Check frontend terminal shows:
```
Compiling...
Compiled successfully!
```

If not, restart frontend:
```bash
cd frontend
rm -rf node_modules/.cache
npm start
```

### 2. Check Browser Console (F12)
Look for these messages:

**On page load with wave overlay enabled**:
```
🌊 Wave data fetch: Map ready, fetching data...
🌊 WaveField stats: { valid: true, minHs: X, maxHs: Y, bounds: {...} }
🌊 Drawing wave heatmap: size=1920x1080, zoom=7
🌊 Wave canvas coverage: XX%
```

**On zoom in/out**:
```
🌊 Zoom ended, fetching wave data for expanded bounds (zoom=8, bbox=...)
✅ Wave overlay updated (zoom ended): vectors: 450
🌊 Drawing wave heatmap: size=1920x1080, zoom=8
```

**Red flags** ⚠️:
```
⚠️  Data bounds don't fully cover map bounds. Coverage: 75%
🌊 Cannot draw: canvas or waveField invalid
```

### 3. Test Backend Directly
```bash
curl "http://localhost:8000/api/waves-overlay?model=ww3&forecast_hour=0&bounds=32.5,-118.0,33.5,-117.0&source=global"
```

Should return JSON with 200+ vectors instantly.

### 4. Check Canvas Element Exists
In browser console:
```javascript
// Check if canvas exists
console.log('Canvas:', document.querySelector('#wave-heatmap-canvas'));
console.log('Canvas size:', document.querySelector('#wave-heatmap-canvas')?.width, 'x', document.querySelector('#wave-heatmap-canvas')?.height);

// Check if wave data exists in React state
// (You'll need to inspect React DevTools for this)
```

### 5. Hard Refresh Browser
- **Mac**: `Cmd + Shift + R`
- **Windows/Linux**: `Ctrl + Shift + R`

This clears cache and forces reload.

## 🧪 Test Procedure

1. **Start both servers**:
   ```bash
   # Terminal 1: Backend
   cd backend && source venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000 --reload

   # Terminal 2: Frontend
   cd frontend && npm start
   ```

2. **Open browser**: http://localhost:3000

3. **Enable wave overlay** (checkbox/toggle)

4. **Test zoom levels**:
   - Zoom 5: Wide coast view (should show full coverage)
   - Zoom 8: Regional view (should show smooth coverage)
   - Zoom 10: Nearshore detail (should show high detail)

5. **Test panning**: Drag map around, waves should follow

6. **Check colors**: Should see dark navy (low waves) → cyan → orange progression

## 📊 Expected Results

### Backend Response
```json
{
  "vectors": [
    {"lat": 32.5, "lon": -118.0, "hs": 1.2, "dir_deg": 285},
    // ... 200-400 vectors depending on bbox
  ],
  "bounds": {
    "min_lat": 32.5,
    "min_lon": -118.0,
    "max_lat": 33.5,
    "max_lon": -117.0
  },
  "model": "ww3",
  "source": "global"
}
```

### Frontend Canvas
- **Size**: Should match viewport (e.g., 1920x1080)
- **Z-index**: 25 (within tile-pane)
- **Position**: Absolute, top-left
- **Opacity**: 1.0 (alpha is per-pixel)

### Visual Result
- Dark navy ocean at 0-3ft
- Blue → cyan at 4-8ft
- Yellow-green → orange at 10-15ft
- Red at 18ft+
- Smooth gradients (no hard edges)
- Full viewport coverage (edge-to-edge)
- Scales when zooming

## 🔧 Additional Fixes to Try

### If Still No Viewport Coverage

**Option 1: Increase backend expansion more**
```python
# In backend/main.py line 1813
expansion = 1.0  # Even more aggressive (111km padding)
```

**Option 2: Check frontend bbox calculation**
```javascript
// In frontend/src/MapOverlay.js around line 849
// Add padding to frontend bbox before sending to backend
const padding = 0.5; // Add 0.5° padding on frontend too
const bbox = [
  bounds.getSouth() - padding,
  bounds.getWest() - padding,
  bounds.getNorth() + padding,
  bounds.getEast() + padding
].join(',');
```

**Option 3: Disable land masking temporarily**
```javascript
// In frontend/src/WaveCanvasLayer.js line 461
// Comment out land masking to see if it's blocking rendering
/*
if (isLikelyLand(latLng.lat, latLng.lng)) {
  // Skip this check temporarily
}
*/
```

### If Still No Zoom Scaling

**Option 1: Force canvas redraw on data change**
```javascript
// In frontend/src/WaveCanvasLayer.js useEffect dependencies (line 829)
// Make sure waveData is in dependency array
}, [map, waveData, visible, units]); // waveData should trigger redraw
```

**Option 2: Add immediate redraw on zoom**
```javascript
// In frontend/src/WaveCanvasLayer.js after line 809
map.on('zoomend', () => {
  console.log('🌊 ZOOM DETECTED - Force redraw');
  handleMapUpdate();
});
```

## 📝 Files Modified This Session

1. `frontend/src/WaveCanvasLayer.js`
   - Lines 82-84: Alpha constants
   - Lines 137-148: Color palette
   - Lines 190-196: Dynamic alpha calculation
   - Line 809: Added zoomend listener
   - Line 825: Added zoomend cleanup

2. `frontend/src/WaveHeightLegend.js`
   - Lines 8-18: Updated color stops

3. `backend/main.py`
   - Lines 1809-1817: Increased bbox expansion to 0.75°

4. `.mcp.json` - Playwright MCP configuration (needs Claude Code restart to activate)

5. `.claude/settings.local.json` - Enabled project MCP servers

6. `CLAUDE.md` - Updated with workflows and wave overlay documentation

## 🎭 Playwright MCP Setup

**Status**: Configured but not loaded in current session

**To activate**:
1. Exit Claude Code session
2. Start new session
3. Playwright tools will be available

**Then can use**:
```
Take a screenshot of localhost:3000 with wave overlay enabled
```

## 🌐 Reference URLs

- **Local app**: http://localhost:3000
- **Backend API**: http://localhost:8000/api/waves-overlay
- **Windy comparison**: https://www.windy.com/-Waves-waves?waves,33.009,-117.290,5

## 💡 Key Insights

1. **WW3 grid resolution**: 0.16° (~18km) - need 4-5x padding for smooth edges
2. **Frontend uses bilinear interpolation**: Needs data BEYOND viewport edges
3. **OPeNDAP returns nearest grid points**: Sometimes slightly inside requested bounds
4. **Zoom event chain**:
   - User zooms → MapOverlay fetches new data → WaveCanvasLayer redraws canvas
   - If any link breaks, zoom doesn't work
5. **Canvas must listen to zoomend**: Critical for scaling with map

## 🚀 Next Steps When Resuming

1. Restart Claude Code to get Playwright MCP working
2. Take screenshot of localhost:3000 to see actual state
3. Check browser console for specific error messages
4. Verify all changes compiled and loaded
5. Test zoom scaling with console logs
6. If still issues, increase backend expansion to 1.0° or add frontend padding

---

**Session saved**: 2025-12-19
**Ready to resume**: ✅
