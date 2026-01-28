# Debug: Production Wind Data Stuck Issue

## Problem

Production shows **identical wind data** for all forecast hours (15.3 m/s from 247°), while local shows correctly varying wind data.

**Symptoms:**
- Wave data: ✅ Correct (same on both)
- Wind data: ❌ Wrong (stuck on production)

## Root Causes (Likely)

### 1. Stale Redis Cache
Production Redis might have old cached wind data that's not expiring.

### 2. Wind Fetch Failing Silently
GFS/HRRR wind fetch might be failing on production and falling back to old data.

### 3. Code Version Mismatch
Despite being "same", there might be uncommitted changes or different versions running.

### 4. Environment Variable Issue
Different wind model settings between local and production.

---

## Diagnostic Steps

### Step 1: Check Production Backend Logs

SSH to production server:
```bash
ssh your-production-server
sudo journalctl -u mysurflife-backend -f
```

Look for:
- `🌐 Fetching GRIB from NOMADS` - Wind fetches
- `❌` or `⏱️` - Errors or timeouts
- `📦 Returning cached wind data` - Cache hits

### Step 2: Check Redis Cache on Production

```bash
# SSH to production
redis-cli

# Check for wind cache keys
KEYS *wind*

# Check specific key
GET "wind-forecast:gfs:seaside-reef:*"

# Check TTL (time to live)
TTL "wind-forecast:gfs:seaside-reef:*"

# Flush wind cache
DEL "wind-forecast:gfs:*"
```

### Step 3: Force Wind Data Refresh

```bash
# On production server
curl "http://localhost:8000/api/surf-spots/seaside-reef/model-forecast?model=gfs" | jq '.wind_points | length'

# Should return multiple wind points with different values
# If all same = wind fetch is broken
```

### Step 4: Check Wind Model Endpoint Directly

```bash
# Test GFS wind fetch on production
curl "http://localhost:8000/api/wind-overlay?model=gfs&forecast_hour=0&bounds=-118,32,-117,34" | jq '.vectors | length'

# Should return array of wind vectors
# If error = GFS fetch is failing
```

### Step 5: Compare Code Versions

```bash
# On production server
cd /var/www/mysurflife
git log -1 --oneline

# Compare with local
cd /Users/georgeplsek/sites/wwwroot/mysurflife
git log -1 --oneline

# Should match!
```

---

## Quick Fixes

### Fix 1: Clear Redis Cache on Production

```bash
# SSH to production
redis-cli FLUSHALL

# Or just wind cache
redis-cli
KEYS *wind*
# Delete each key shown

# Restart backend
sudo systemctl restart mysurflife-backend
```

### Fix 2: Restart Backend Service

```bash
sudo systemctl restart mysurflife-backend
sudo journalctl -u mysurflife-backend -n 100
```

### Fix 3: Pull Latest Code

```bash
cd /var/www/mysurflife
git pull origin main
sudo systemctl restart mysurflife-backend
```

---

## Detailed Investigation

### Check main.py Wind Caching Logic

Look for this in the forecast-timeline endpoint:

```python
# Get wind forecast
wind_data = await get_wind_forecast_for_spot(...)

# Check if wind_data is being cached incorrectly
# Should have different values for each forecast_hour
```

**Possible bug:** Wind data might be getting cached with the wrong key, causing all hours to return the same cached value.

### Check Wind Forecast Function

File: `backend/main.py` around line 1500-1600

```python
async def get_wind_forecast_for_spot(lat, lon, forecast_hour, model="gfs"):
    # Check if this is returning cached data for all hours
    cache_key = f"wind-{lat}-{lon}-{forecast_hour}-{model}"

    # Bug: If forecast_hour not in cache_key, all hours return same data
```

### Check Timeline Endpoint

Around line 2800-2900 in `main.py`:

```python
@app.get("/api/surf-spots/{spot_slug}/forecast-timeline")
async def get_spot_forecast_timeline(...):
    timeline = []
    for hour in forecast_hours:
        # Get wind for this hour
        wind = await get_wind_forecast_for_spot(lat, lon, hour)

        # BUG: If wind is cached without hour in key,
        # all iterations return same cached wind
```

---

## Testing After Fix

### Test 1: Different Wind Per Hour

```bash
curl "https://mysurflife.com/api/surf-spots/seaside-reef/forecast-timeline?hours=48" | \
python3 -c "
import json, sys
data = json.load(sys.stdin)
winds = [t['wind'] for t in data['timeline']]
unique_winds = len(set(str(w) for w in winds))
print(f'Total hours: {len(winds)}')
print(f'Unique wind values: {unique_winds}')
if unique_winds == 1:
    print('❌ STILL BROKEN - All wind values same')
else:
    print('✅ FIXED - Wind values vary')
"
```

### Test 2: Verify Cache Keys

```bash
# On production
redis-cli KEYS *wind*

# Should see different keys for different forecast hours
# Good: wind-seaside-0, wind-seaside-6, wind-seaside-12
# Bad: Only one key for all hours
```

---

## Most Likely Issue

Based on the symptoms, **99% probability** it's one of these:

1. **Redis cache has stale data** with very long TTL
2. **Wind fetch is failing** on production (firewall, NOMADS down, network issue)
3. **Cache key doesn't include forecast_hour** causing all hours to share same cached wind

---

## Immediate Action

**Run this on production server:**

```bash
# 1. Clear wind cache
redis-cli
FLUSHALL

# 2. Restart backend
sudo systemctl restart mysurflife-backend

# 3. Test immediately
curl "http://localhost:8000/api/surf-spots/seaside-reef/forecast-timeline?hours=48" | \
python3 -c "
import json, sys
data = json.load(sys.stdin)
wind0 = data['timeline'][0]['wind']
wind6 = data['timeline'][1]['wind']
print(f'Hour 0 wind: {wind0}')
print(f'Hour 6 wind: {wind6}')
print(f'Same? {wind0 == wind6}')
"

# 4. Check backend logs
sudo journalctl -u mysurflife-backend -n 50
```

---

## If Still Broken After Cache Clear

The issue is in the **code logic**, not cache. Check:

1. **Wind fetch error handling** - Failing silently?
2. **Cache key generation** - Missing forecast_hour?
3. **Default/fallback values** - Using static fallback?

Look for this pattern in code:

```python
# BAD - All hours get same cached value
cache_key = f"wind-{spot_slug}-{model}"  # Missing hour!

# GOOD - Each hour gets unique cached value
cache_key = f"wind-{spot_slug}-{model}-{forecast_hour}"
```

---

**Created**: 2026-01-28
**Priority**: High (affects production forecasts)
**Next Steps**: Clear production Redis cache and check backend logs
