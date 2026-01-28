# Default View Update - Overlays OFF on Load

## Summary

**Date**: 2026-01-22
**Change**: Wave and wind overlays now default to OFF when the site first loads

## ✅ What Changed

### Before
- **Wave overlay**: Automatically ON when page loads
- **Wind overlay**: OFF by default
- Users would see waves immediately without requesting them

### After
- **Wave overlay**: OFF by default ✅
- **Wind overlay**: OFF by default ✅
- **Buoys only**: Clean view of just buoy markers on initial load
- Users can toggle overlays on manually via checkboxes

## Files Modified

**`frontend/src/MapOverlay.js`** (line 214):

**Before:**
```javascript
const [overlayType, setOverlayType] = useState('waves'); // Default to waves
```

**After:**
```javascript
const [overlayType, setOverlayType] = useState('none'); // Default to none - buoys only
```

## User Experience

### On Page Load (http://localhost:3000)

**What you'll see:**
1. ✅ Clean map with OpenStreetMap tiles
2. ✅ 35 buoy markers (color-coded by conditions)
3. ✅ Control panel with overlay checkboxes (all unchecked)
4. ✅ No wave overlay visible
5. ✅ No wind overlay visible

**To Enable Overlays:**
- Check **"Waves"** checkbox → Purple/magenta wave overlay appears
- Check **"Wind"** checkbox → Wind vectors and particles appear
- Check **"Wave Particles"** → Animated wave particle flow
- Check **"Wind Particles"** → Animated wind particle flow

### Benefits

1. **Faster initial load** - No need to fetch wave/wind data on page load
2. **Cleaner interface** - Users see buoys first without overlay clutter
3. **User choice** - Overlays are opt-in, not forced on
4. **Bandwidth savings** - Only fetch overlay data when requested
5. **Better mobile experience** - Less visual noise on smaller screens

## Technical Details

**State Management:**
- `overlayType`: Controls which overlay is active
  - `'none'` - No overlays (default)
  - `'waves'` - Wave overlay active
  - `'wind'` - Wind overlay active

**Why This Matters:**
- Wave overlay fetches ~3000 vectors from WW3 OPeNDAP (can take 2-5 seconds)
- Wind overlay fetches GRIB data from NOMADS (1.9MB download)
- On slow connections, this could delay page usability
- Users primarily want buoy data first, overlays second

## Testing

### Verify Default State
1. Open **http://localhost:3000** (hard refresh: Cmd+Shift+R / Ctrl+Shift+R)
2. Page loads showing **only buoy markers** ✅
3. No purple/magenta wave colors visible ✅
4. No wind particle animations ✅
5. Control panel shows **unchecked** overlay checkboxes ✅

### Verify Overlays Work When Enabled
1. Check **"Waves"** checkbox
2. Wait 2-5 seconds → Purple/magenta wave overlay appears ✅
3. Check **"Wind"** checkbox
4. Wait 1-2 seconds → Wind particles appear ✅
5. Uncheck both → Overlays disappear ✅

### Browser Console
No errors should appear related to missing overlay data on page load.

## Related Changes

This update works together with:
1. **Surf Height Formula Fix** - Realistic surf heights (no more √period inflation)
2. **35 Pacific Buoys** - Hawaii, Pacific Northwest, full California coast
3. **Windy Colors** - Purple/magenta wave palette (when enabled)

## Future Enhancements

Possible improvements:
1. **Remember user preference** - Store overlay state in localStorage
2. **Quick toggle shortcuts** - Keyboard shortcuts (W for waves, G for wind)
3. **Default based on location** - Auto-enable waves if zoomed to offshore
4. **Loading indicators** - Show spinner when overlay is fetching data

---

**Ready to Test!**
Refresh http://localhost:3000 and you'll see a clean buoy-only view on load!