# Quick Debug Commands - Wave Overlay

## 🚀 Start Servers

```bash
# Terminal 1: Backend
cd /Users/georgeplsek/sites/wwwroot/mysurflife/backend
source venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2: Frontend
cd /Users/georgeplsek/sites/wwwroot/mysurflife/frontend
npm start
```

## 🔍 Check What's Running

```bash
# Check ports
lsof -i :3000  # Frontend
lsof -i :8000  # Backend

# Kill if needed
kill <PID>
```

## 🧪 Test Backend Directly

```bash
# Test wave API
curl "http://localhost:8000/api/waves-overlay?model=ww3&forecast_hour=0&bounds=32.5,-118.0,33.5,-117.0&source=global" | python3 -c "import sys, json; data = json.load(sys.stdin); print(f'Vectors: {len(data.get(\"vectors\", []))}, Bounds: {data.get(\"bounds\", \"none\")}')"

# Should return: Vectors: 200-400, Bounds: {...}
```

## 🌐 URLs

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000/api/waves-overlay
- **Windy comparison**: https://www.windy.com/-Waves-waves?waves,33.009,-117.290,5

## 📊 Browser Console Commands (F12)

```javascript
// Check if wave canvas exists
console.log('Canvas:', document.querySelector('#wave-heatmap-canvas'));
console.log('Canvas size:', document.querySelector('#wave-heatmap-canvas')?.width, 'x', document.querySelector('#wave-heatmap-canvas')?.height);

// Check wave overlay layer
console.log('Wave layer:', document.querySelector('.wave-overlay-layer'));

// Clear localStorage
localStorage.clear();
```

## 🔄 Force Refresh

### Frontend
```bash
cd frontend
rm -rf node_modules/.cache
npm start
```

### Browser
- **Mac**: Cmd + Shift + R
- **Windows/Linux**: Ctrl + Shift + R

## 🎭 Playwright (After Claude Code Restart)

```
Take a screenshot of localhost:3000 with wave overlay enabled
```

## 📝 Check Logs

### Browser Console Should Show:
```
🌊 Wave data fetch: Map ready, fetching data...
🌊 WaveField stats: { valid: true, ... }
🌊 Drawing wave heatmap: size=1920x1080, zoom=7
🌊 Zoom ended, fetching wave data... (on zoom)
```

### Backend Terminal Should Show:
```
INFO:     127.0.0.1:xxxxx - "GET /api/waves-overlay?... HTTP/1.1" 200 OK
```

## ⚠️ Red Flags

### Browser Console:
```
⚠️  Data bounds don't fully cover map bounds. Coverage: 75%  ← BAD
🌊 Cannot draw: canvas or waveField invalid  ← BAD
```

### Frontend Terminal:
```
Failed to compile  ← BAD
```

## 🔧 Modified Files

Check these have your changes:
```bash
# Check backend expansion (should be 0.75)
grep -n "expansion = " backend/main.py

# Check frontend zoomend listener (should exist)
grep -n "map.on.*zoomend.*handleMapUpdate" frontend/src/WaveCanvasLayer.js

# Check color palette (should be navy/cyan/orange)
grep -A 10 "colorStops = \[" frontend/src/WaveCanvasLayer.js
```

## 📸 Visual Checklist

When viewing http://localhost:3000 with wave overlay:

- [ ] Dark navy/blue ocean visible (not bright purple/magenta)
- [ ] Waves cover entire viewport (no gaps at edges)
- [ ] Waves update when zooming in/out
- [ ] Waves update when panning
- [ ] Map tiles visible underneath (semi-transparent)
- [ ] Legend shows correct colors (dark blue → cyan → orange → red)

---

**Quick check after restart**: Run all test commands above and verify ✓
