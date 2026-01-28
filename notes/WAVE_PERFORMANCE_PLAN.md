# Wave Overlay Performance Plan
## Based on notes/performance-ideas.md Analysis

## Quick Wins (1-2 hours) - Do These First

### 1. Dynamic Resolution Scaling Based on Zoom ✅ PARTIALLY DONE

**Current State**: We use fixed `PIXEL_STRIDE` or `scale` variable
**Problem**: Zoomed out = huge canvas = too many samples
**Solution**: Aggressive resolution scaling based on zoom level

```javascript
// In WaveCanvasLayer.js drawHeatmap()
const zoom = map.getZoom();

// Zoom-adaptive resolution scaling
// Zoom 4-5: render at 1/4 resolution (scale = 4)
// Zoom 6-7: render at 1/3 resolution (scale = 3)
// Zoom 8-9: render at 1/2 resolution (scale = 2)
// Zoom 10+: render at full resolution (scale = 1)
let scale;
if (zoom < 6) {
  scale = 4; // Very aggressive - 1/16th pixels
} else if (zoom < 8) {
  scale = 3; // 1/9th pixels
} else if (zoom < 10) {
  scale = 2; // 1/4 pixels
} else {
  scale = 1; // Full resolution
}

const offWidth = Math.ceil(size.x / scale);
const offHeight = Math.ceil(size.y / scale);
```

**Impact**: At zoom 4, instead of processing 2M pixels, process 125k pixels (16x faster)

---

### 2. Render Budget Cap

**Problem**: Even with scaling, some views still process too much
**Solution**: Cap maximum samples per frame

```javascript
// After calculating offWidth/offHeight
const MAX_SAMPLES = 100000; // 100k pixels max
const totalSamples = offWidth * offHeight;

if (totalSamples > MAX_SAMPLES) {
  // Increase scale factor to reduce samples
  const additionalScaling = Math.ceil(Math.sqrt(totalSamples / MAX_SAMPLES));
  scale *= additionalScaling;
  offWidth = Math.ceil(size.x / scale);
  offHeight = Math.ceil(size.y / scale);
  console.warn(`⚠️ Capping samples: ${totalSamples} -> ${offWidth * offHeight} (scale=${scale})`);
}
```

**Impact**: Guarantees no single frame takes more than ~100ms to render

---

### 3. Debounce Timeline Slider ✅ CRITICAL

**Current State**: Every slider tick triggers immediate fetch + render
**Problem**: Scrubbing causes 10+ overlapping renders
**Solution**: Debounce with cancel

```javascript
// In MapOverlay.js - Add slider debounce
const sliderDebounceRef = useRef(null);
const renderTokenRef = useRef(0);

const handleWaveFrameChange = (newIndex) => {
  // Cancel pending debounce
  if (sliderDebounceRef.current) {
    clearTimeout(sliderDebounceRef.current);
  }

  // Update UI immediately (for responsiveness)
  setSelectedWaveFrameIndex(newIndex);

  // Debounce actual data fetch/render
  sliderDebounceRef.current = setTimeout(() => {
    renderTokenRef.current++; // Invalidate old renders
    // Fetch new data here
  }, 150); // 150ms debounce
};
```

**Add to fetchWaveData**:
```javascript
const fetchWaveData = useCallback(async ({ model, bbox, hour, zoom, renderToken }) => {
  // ... fetch logic ...

  // Before setting state, check if this render is stale
  if (renderToken !== renderTokenRef.current) {
    console.log(`⏭️ Skipping stale render (token ${renderToken} vs current ${renderTokenRef.current})`);
    return null;
  }

  return rawData;
}, []);
```

**Impact**: Only renders the final slider position, not every intermediate frame

---

### 4. Cancel In-Flight Canvas Draws

**Problem**: Old drawHeatmap() keeps running even after new data arrives
**Solution**: Check cancellation flag in render loop

```javascript
// In WaveCanvasLayer.js
const renderCancelledRef = useRef(false);

useEffect(() => {
  // Set cancellation flag when component updates
  renderCancelledRef.current = false;

  // ... existing setup ...

  function drawHeatmap() {
    // Check cancellation at start and in expensive loops
    if (renderCancelledRef.current) {
      console.log('🚫 Render cancelled');
      return;
    }

    // ... render logic ...

    // Check again during pixel loop (every 1000 pixels)
    for (let y = 0; y < offHeight; y++) {
      if (renderCancelledRef.current && y % 10 === 0) {
        console.log('🚫 Render cancelled mid-draw');
        return;
      }
      for (let x = 0; x < offWidth; x++) {
        // ... pixel logic ...
      }
    }
  }

  return () => {
    renderCancelledRef.current = true; // Cancel on unmount
  };
}, [map, waveData, visible, units]);
```

**Impact**: Stops wasting CPU on obsolete renders

---

## Medium Effort (2-4 hours)

### 5. Server-Side Raster Pre-Generation

**Current**: Server returns JSON vectors, client interpolates + colors
**Better**: Server returns pre-colored image data

Add new endpoint: `/api/waves-raster`

```python
# backend/main.py
@app.get("/api/waves-raster")
async def get_waves_raster(
    model: str = 'ww3',
    forecast_hour: int = 0,
    bounds: str = '',  # "minLat,minLon,maxLat,maxLon"
    width: int = 512,  # Output image width
    height: int = 512,
    source: str = 'global'
):
    """
    Return wave height as a pre-colored PNG raster.
    Client just draws image - no interpolation needed.
    """
    # Parse bounds
    min_lat, min_lon, max_lat, max_lon = map(float, bounds.split(','))

    # Fetch WW3 data (same as waves-overlay)
    vectors = await fetch_ww3_data(...)

    # Create numpy array for raster
    img = np.zeros((height, width, 4), dtype=np.uint8)

    # For each pixel, interpolate wave height
    for y in range(height):
        for x in range(width):
            lat = min_lat + (max_lat - min_lat) * (y / height)
            lon = min_lon + (max_lon - min_lon) * (x / width)

            # Interpolate hs from vectors
            hs = interpolate_bilinear(vectors, lat, lon)

            if hs is not None:
                # Apply color ramp (same as frontend)
                r, g, b, a = get_wave_color(hs)
                img[y, x] = [r, g, b, int(a * 255)]

    # Convert to PNG
    from PIL import Image
    pil_img = Image.fromarray(img, 'RGBA')

    # Return as PNG bytes
    buf = io.BytesIO()
    pil_img.save(buf, format='PNG')
    buf.seek(0)

    return Response(content=buf.read(), media_type='image/png')
```

**Frontend Change**:
```javascript
// In MapOverlay.js
const fetchWaveRaster = async ({ bbox, hour, zoom }) => {
  // Calculate appropriate resolution based on screen size
  const size = map.getSize();
  const scale = zoom < 6 ? 4 : zoom < 8 ? 2 : 1;
  const width = Math.ceil(size.x / scale);
  const height = Math.ceil(size.y / scale);

  const url = `/api/waves-raster?model=ww3&forecast_hour=${hour}&bounds=${bbox}&width=${width}&height=${height}`;
  const response = await fetch(url);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

// In WaveCanvasLayer, just draw the image
const img = new Image();
img.src = imageUrl;
img.onload = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
};
```

**Impact**:
- Eliminates client-side interpolation completely
- Server can cache rasters in Redis
- Consistent colors across all clients

---

### 6. Add Render Performance Metrics

Track actual render times to measure improvements:

```javascript
// In WaveCanvasLayer.js
function drawHeatmap() {
  const startTime = performance.now();

  // ... existing render logic ...

  const renderTime = performance.now() - startTime;
  console.log(`🎨 Wave render: ${renderTime.toFixed(0)}ms (${offWidth}x${offHeight} samples, scale=${scale})`);

  // Store in window for debugging
  if (!window.__wavePerf) window.__wavePerf = [];
  window.__wavePerf.push({ time: renderTime, samples: offWidth * offHeight, zoom: map.getZoom() });
  if (window.__wavePerf.length > 20) window.__wavePerf.shift();
}
```

---

## Future Enhancements (Later)

### 7. Tile-Based Overlay (Full Windy Architecture)

Requires significant backend work - implement when needed for production scale:

- `/tiles/waves/{model}/{run}/{hour}/{z}/{x}/{y}.png`
- Tile generation worker
- CDN caching strategy
- Client uses Leaflet TileLayer instead of canvas

### 8. WebGL Acceleration

Switch from Canvas 2D to WebGL for particles and color ramp:
- Regl.js or Three.js for WebGL abstraction
- Vertex shader for particle positions
- Fragment shader for color ramp lookup

---

## Implementation Priority (Local Dev)

**Phase 1: Quick Wins (Today - 2 hours)**
1. ✅ Add dynamic resolution scaling (modify WaveCanvasLayer.js lines 366-367)
2. ✅ Add render budget cap (add after line 368)
3. ✅ Add timeline slider debounce (modify MapOverlay.js handleWaveFrameChange)
4. ✅ Add render cancellation (add to WaveCanvasLayer.js useEffect)

**Phase 2: Server Optimization (Tomorrow - 4 hours)**
5. Add `/api/waves-raster` endpoint
6. Add raster caching in Redis
7. Update frontend to use raster endpoint

**Phase 3: Measurement & Tuning (Ongoing)**
8. Add performance metrics
9. Profile with Chrome DevTools
10. Adjust scaling factors based on real data

---

## Expected Performance Gains

**Before Optimizations:**
- Zoom 4 render: ~2000ms (timeout/hang)
- Zoom 6 render: ~800ms
- Zoom 10 render: ~200ms
- Timeline scrub: 10 renders queued, UI frozen

**After Phase 1:**
- Zoom 4 render: ~150ms (16x fewer samples)
- Zoom 6 render: ~100ms
- Zoom 10 render: ~150ms
- Timeline scrub: 1 render (debounced), smooth UI

**After Phase 2 (Raster):**
- Zoom 4-10: ~20-50ms (just drawing image)
- Timeline scrub: instant (cached rasters)
- Server handles interpolation once, serves many clients

---

## Testing Strategy

1. **Before measurements**:
   - Load wave overlay at zoom 4, 6, 10
   - Record render times in console
   - Scrub timeline, count renders

2. **After each phase**:
   - Repeat same tests
   - Compare render times
   - Verify visual quality unchanged

3. **Regression tests**:
   - Zoom in/out rapidly
   - Scrub slider rapidly
   - Switch between hours
   - Pan map during render
   - All should remain responsive

---

## Notes

- **Don't implement tiles yet** - that's a big architectural change requiring Nginx/CDN
- **Focus on client-side scaling first** - biggest bang for buck
- **Raster endpoint is optional** - only if Phase 1 isn't enough
- **WebGL is future work** - not needed for MVP smoothness
