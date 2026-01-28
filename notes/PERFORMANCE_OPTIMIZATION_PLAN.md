# MySurfLife Performance Optimization Plan

## Completed Optimizations ✅

### 1. Redis L2 Cache (COMPLETED)
- **Status**: ✅ Redis 8.4.0 installed and running
- **Impact**: Shared cache across all workers, dramatically faster than disk
- **Configuration**: localhost:6379, already integrated in backend/main.py
- **Result**: L1 (memory) → L2 (Redis) → L3 (disk) caching hierarchy now fully operational

### 2. Vector Count Reduction (COMPLETED)
- **Change**: Reduced target from 5000 to 3000 vectors (40% reduction)
- **Impact**: 40% less data to transfer and render
- **Files Modified**: backend/main.py (wind and wave subsampling logic)
- **Expected Improvement**: ~40% faster JSON serialization and frontend rendering

### 3. Performance Timing Logs (COMPLETED)
- **Change**: Added timing measurements for OPeNDAP fetches
- **Impact**: Can now identify exact bottlenecks
- **Example Output**: `✅ Fetched 2986 wave vectors via OPeNDAP (20251219 18z f000) in 2.34s`

## Recommended: Database + Background Jobs

### Phase 1: Database Schema (SQLite → PostgreSQL migration path)

#### Why Database?
1. **Persistent Storage**: Wave/wind data survives server restarts
2. **Query Optimization**: Spatial queries for bbox intersection
3. **Historical Data**: Keep 7+ days of forecasts for trend analysis
4. **Reduced NOAA Load**: Fetch once, serve many users

#### Proposed Schema (SQLite for MVP, PostgreSQL for production)

```sql
-- Wave Forecast Data
CREATE TABLE wave_forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,              -- 'ww3'
    run_date TEXT NOT NULL,           -- '20251219'
    run_cycle TEXT NOT NULL,          -- '18'
    forecast_hour INTEGER NOT NULL,   -- 0-180
    domain TEXT NOT NULL,             -- 'global', 'epacif', etc.
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    hs_m REAL,                        -- Wave height (meters)
    dir_deg REAL,                     -- Wave direction
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model, run_date, run_cycle, forecast_hour, domain, lat, lon)
);

CREATE INDEX idx_wave_spatial ON wave_forecasts(lat, lon, forecast_hour);
CREATE INDEX idx_wave_run ON wave_forecasts(run_date, run_cycle, forecast_hour);

-- Wind Forecast Data
CREATE TABLE wind_forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,              -- 'gfs', 'hrrr', 'nam'
    run_date TEXT NOT NULL,
    run_cycle TEXT NOT NULL,
    forecast_hour INTEGER NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    u_ms REAL,                        -- U component (m/s)
    v_ms REAL,                        -- V component (m/s)
    speed_kts REAL,                   -- Speed (knots)
    dir_deg REAL,                     -- Direction
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model, run_date, run_cycle, forecast_hour, lat, lon)
);

CREATE INDEX idx_wind_spatial ON wind_forecasts(lat, lon, forecast_hour);
CREATE INDEX idx_wind_run ON wind_forecasts(run_date, run_cycle, forecast_hour);

-- Forecast Run Metadata
CREATE TABLE forecast_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    run_date TEXT NOT NULL,
    run_cycle TEXT NOT NULL,
    domain TEXT,                      -- For wave models
    fetch_status TEXT,                -- 'pending', 'in_progress', 'complete', 'failed'
    fetch_started_at TIMESTAMP,
    fetch_completed_at TIMESTAMP,
    vector_count INTEGER,
    error_message TEXT,
    UNIQUE(model, run_date, run_cycle, domain)
);

CREATE INDEX idx_run_status ON forecast_runs(model, fetch_status, run_date);
```

#### Migration Strategy
1. **Start with SQLite**: Simple file-based DB, no server needed
2. **Add DB connection pool**: Use `aiosqlite` for async operations
3. **Modify API endpoints**: Check DB first, fall back to OPeNDAP
4. **PostgreSQL upgrade path**: When ready, use PostGIS for spatial queries

#### Implementation Files
```
backend/
  database.py          # DB connection, models, queries
  migrations/
    001_initial.sql    # Initial schema
  prefetch_scheduler.py # Background job runner
```

### Phase 2: Background Job Scheduler

#### Purpose
Pre-fetch fresh NOAA data on a schedule so users get instant responses from the database.

#### Options

**Option A: APScheduler (Recommended for MVP)**
```python
# backend/prefetch_scheduler.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import asyncio

scheduler = AsyncIOScheduler()

async def prefetch_latest_forecasts():
    """
    Runs every hour to fetch the latest forecast data from NOAA
    and populate the database.
    """
    models = ['gfs', 'hrrr', 'nam', 'ww3']

    for model in models:
        # Determine latest run cycle (00z, 06z, 12z, 18z)
        run_cycle = determine_latest_run()

        # Fetch all forecast hours (0, 3, 6, ..., 180)
        for forecast_hour in get_forecast_hours(model):
            # Fetch data for California bbox
            bbox = {"min_lat": 30, "max_lat": 42, "min_lon": -130, "max_lon": -115}

            # Call existing OPeNDAP fetch logic
            vectors = await fetch_wave_data_from_opendap(...)

            # Store in database
            await store_vectors_in_db(vectors, model, run_cycle, forecast_hour)

            # Rate limit to avoid overwhelming NOAA servers
            await asyncio.sleep(5)  # 5 seconds between requests

# Schedule: Run every hour, 10 minutes after the hour
# (NOAA typically publishes new runs at :00, so :10 gives them time)
scheduler.add_job(
    prefetch_latest_forecasts,
    trigger=CronTrigger(minute=10),
    id='prefetch_forecasts',
    replace_existing=True
)

scheduler.start()
```

**Option B: Celery + Redis (Production-grade)**
- More robust for distributed systems
- Better error handling and retry logic
- Requires Redis (already have it!)
- Overkill for initial implementation

**Option C: Simple Cron Job**
```bash
# /etc/cron.d/mysurflife-prefetch
10 * * * * cd /path/to/backend && ./venv/bin/python prefetch_script.py >> /var/log/mysurflife-prefetch.log 2>&1
```

#### Prefetch Strategy

**Prioritize California Coverage**
```python
# Prefetch zones (in order of priority)
PREFETCH_ZONES = [
    # Southern California
    {"min_lat": 32, "max_lat": 34.5, "min_lon": -120, "max_lon": -117, "priority": 1},
    # Central California
    {"min_lat": 34.5, "max_lat": 37, "min_lon": -123, "max_lon": -120, "priority": 2},
    # Northern California
    {"min_lat": 37, "max_lat": 42, "min_lon": -125, "max_lon": -122, "priority": 3},
]

# Forecast hours to prefetch (not all 61 hours, just key ones)
PREFETCH_HOURS = [0, 6, 12, 24, 48, 72, 96, 120]  # Current + 5 days
```

**Schedule**:
- **Hourly**: Fetch latest hour 0 (current conditions)
- **Every 6 hours**: Fetch full forecast range (0-180h)
- **On-demand**: Fill gaps when users request specific hours

#### Benefits
1. **Instant Loading**: Most requests served from DB, not NOAA
2. **Reduced Latency**: No OPeNDAP wait time for common queries
3. **Offline Capability**: Can serve cached data if NOAA is down
4. **Historical Analysis**: Keep past forecasts for accuracy tracking

### Phase 3: Additional Optimizations

#### 3.1 Compression
```python
# Enable gzip compression in FastAPI
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)
```

#### 3.2 Frontend Optimizations
```javascript
// Reduce React.StrictMode double-rendering in production
// In frontend/src/index.js:
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  process.env.NODE_ENV === 'development' ? (
    <React.StrictMode><App /></React.StrictMode>
  ) : (
    <App />  // No StrictMode in production
  )
);
```

#### 3.3 CDN for Static Assets (Production)
- Use CloudFlare or similar for frontend bundle
- Serve GeoJSON files from CDN
- Reduces latency for global users

## Implementation Timeline

### Week 1: Database Foundation
- [ ] Add SQLite database with schema
- [ ] Modify API endpoints to check DB first
- [ ] Test with manual data insertion

### Week 2: Background Jobs
- [ ] Implement APScheduler prefetch script
- [ ] Schedule hourly current conditions fetch
- [ ] Monitor for 48 hours to verify reliability

### Week 3: Full Coverage
- [ ] Expand to all forecast hours
- [ ] Add error handling and retry logic
- [ ] Dashboard for prefetch status

### Week 4: Production Hardening
- [ ] Migrate to PostgreSQL (if needed)
- [ ] Add database cleanup (delete forecasts >7 days old)
- [ ] Performance monitoring and alerting

## Estimated Performance Improvements

| Metric | Before | After (Redis) | After (DB+Prefetch) |
|--------|--------|---------------|---------------------|
| First Load | 3-5s | 3-5s | 0.2-0.5s |
| Cache Hit | 0.5s | 0.1s | 0.1s |
| Zoom/Pan | 2-4s | 1-2s | 0.2-0.5s |
| Timeline Scrub | 2-4s | 1-2s | 0.2-0.5s |
| Forecast Range | 180h | 180h | 180h (pre-cached) |

## Cost Considerations

### Development Server
- SQLite: **Free** (file-based)
- APScheduler: **Free** (in-process)
- Redis: **Free** (local instance)

### Production (mysurflife.com)
- PostgreSQL: **$7-15/month** (DigitalOcean/Linode managed)
- Redis: **$0** (already have local Redis from this optimization)
- Storage: **~500MB-1GB** for 7 days of forecasts
- Compute: **Minimal** (background jobs use idle CPU)

## Next Steps

1. **Test Current Optimizations**: Verify 40% vector reduction + Redis work well
2. **Measure Baseline**: Get exact timing numbers before DB implementation
3. **Prototype SQLite**: Add database.py with basic schema
4. **Build Prefetch Script**: Start with just hour 0 (current conditions)
5. **Monitor & Iterate**: Watch logs, measure improvements, expand coverage

## Questions for User

1. **Database preference**: Start with SQLite (simple) or jump to PostgreSQL (scalable)?
2. **Prefetch scope**: California only, or expand to Pacific Northwest/Hawaii?
3. **Historical data**: Keep old forecasts for analysis, or purge after 7 days?
4. **Priority**: Focus on wave data first, or implement wind + waves together?
