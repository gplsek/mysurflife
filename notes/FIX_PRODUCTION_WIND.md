# Fix Production Wind Data Issue

## Problem
Production returns identical wind data for all forecast hours (stuck at 15.3 m/s @ 247°).
Local works correctly with varying wind data.

## Root Cause
One of these:
1. Production code is out of date
2. Python bytecode cache (.pyc) is stale
3. GFS data fetch is broken on production server

---

## Fix Steps (Run on Production Server)

### Step 1: Verify Git Commit

```bash
cd /var/www/mysurflife

# Check commit
git log -1 --oneline
# Should show: 5b47133 or later

# Check for uncommitted changes
git status
# Should be clean (no modified files)
```

**If out of date:**
```bash
git pull origin main
sudo systemctl restart mysurflife-backend
```

### Step 2: Clear Python Bytecode Cache

Python sometimes uses old .pyc files even after code updates:

```bash
cd /var/www/mysurflife/backend

# Remove all bytecode cache
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
find . -name "*.pyc" -delete

# Restart backend
sudo systemctl restart mysurflife-backend

# Wait for startup
sleep 5
```

### Step 3: Test Wind Fetch with Logging

Watch logs in one terminal:
```bash
sudo journalctl -u mysurflife-backend -f
```

In another terminal, trigger wind fetch:
```bash
curl "http://localhost:8000/api/wind-overlay?model=gfs&forecast_hour=6&bounds=32.9,-117.4,33.1,-117.2"
```

**Look for this in logs:**
```
🌐 Fetching GRIB from NOMADS: gfs.t12z.pgrb2.0p25.f006 (forecast hour 6)
📥 Downloaded 1898167 bytes, parsing with xarray...
✅ Fetched 20 wind vectors via NOMADS GRIB filter
```

**Key check:** The file name should show **f006** not **f000**.

### Step 4: Test Multiple Forecast Hours

```bash
for hour in 0 6 12; do
  echo "Testing hour $hour..."
  curl -s "http://localhost:8000/api/wind-overlay?model=gfs&forecast_hour=$hour&bounds=32.9,-117.4,33.1,-117.2" | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
v = data.get('vectors', [{}])[0]
u = v.get('u_component', 0)
v_c = v.get('v_component', 0)
print(f'  Hour {$hour}: u={u:.2f}, v={v_c:.2f}')
"
done

# These should be DIFFERENT
```

### Step 5: Verify File Name in Code

```bash
grep -A 2 "fh = max.0, int.forecast_hour" backend/main.py
```

**Should show:**
```python
fh = max(0, int(forecast_hour))
file_name = f"gfs.t{run_cycle}z.pgrb2.0p25.f{fh:03d}"
```

**If you see something different**, the code wasn't deployed.

### Step 6: Check NOMADS Connectivity

Test if production server can reach NOMADS:

```bash
curl -I "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?file=gfs.t00z.pgrb2.0p25.f000&lev_10_m_above_ground=on&var_UGRD=on&var_VGRD=on&leftlon=0&rightlon=1&toplat=1&bottomlat=0&dir=/gfs.20260128/00/atmos"

# Should return: HTTP/2 200
# If 403 or timeout = firewall/network issue
```

---

## Verification

After fixes, test the timeline endpoint:

```bash
curl "http://localhost:8000/api/surf-spots/seaside-reef/forecast-timeline?hours=12" | \
python3 -c "
import json, sys
data = json.load(sys.stdin)
winds = [(t['hour'], t['wind']['speed_ms']) for t in data['timeline']]
print('Wind data by hour:')
for hour, speed in winds:
    print(f'  Hour {hour:2d}: {speed:.1f} m/s')

unique = len(set([speed for _, speed in winds]))
print(f'\nUnique wind values: {unique}')
if unique > 1:
    print('✅ FIXED!')
else:
    print('❌ Still broken')
"
```

---

## If Still Broken

### Check if it's a caching issue inside _do_fetch_wind

Look for this in main.py around line 1800:

```python
async def _do_fetch_wind_overlay(...):
    # Check if there's any caching happening here
    # that doesn't include forecast_hour
```

### Check the cache key is correct

In `get_wind_overlay`:
```python
cache_key = f"wind_{model}_{bounds}_{real_data}_{run}_{forecast_hour}"
#                                                            ^^^^^^^^^ MUST be here
```

### Enable debug logging

Add this near the top of `get_wind_overlay`:
```python
print(f"🐛 DEBUG: model={model}, forecast_hour={forecast_hour}, cache_key={cache_key}")
```

Then restart and check logs.

---

## Nuclear Option

If all else fails, completely redeploy:

```bash
cd /var/www/mysurflife

# Stash any local changes
git stash

# Pull latest
git pull origin main

# Clear everything
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null
find . -name "*.pyc" -delete
redis-cli FLUSHALL

# Reinstall dependencies (in case something's off)
cd backend
source venv/bin/activate
pip install --upgrade -r requirements.txt

# Restart
sudo systemctl restart mysurflife-backend

# Wait and test
sleep 10
curl "http://localhost:8000/api/surf-spots/seaside-reef/forecast-timeline?hours=12" | jq '.timeline[0:3]'
```

---

## Expected Behavior

**Correct (what local shows):**
```json
{
  "hour": 0,
  "wind": {"speed_ms": 0.5, "direction": 46}
},
{
  "hour": 6,
  "wind": {"speed_ms": 0.9, "direction": 359}
},
{
  "hour": 12,
  "wind": {"speed_ms": 1.7, "direction": 316}
}
```

**Broken (what production shows):**
```json
{
  "hour": 0,
  "wind": {"speed_ms": 15.3, "direction": 247}
},
{
  "hour": 6,
  "wind": {"speed_ms": 15.3, "direction": 247}  // SAME!
},
{
  "hour": 12,
  "wind": {"speed_ms": 15.3, "direction": 247}  // SAME!
}
```

---

**Created**: 2026-01-28
**Priority**: Critical
**Affects**: All production forecast timelines
