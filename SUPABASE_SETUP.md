# Supabase Setup Guide for MySurfLife

## 1. Get Your Supabase Credentials

### From Supabase Dashboard

1. Go to https://supabase.com/dashboard
2. Select your project (or create a new one)
3. Go to **Settings** (gear icon in sidebar)
4. Click **API** in the left menu

You'll see:
- **Project URL** - Copy this (looks like `https://xxxxx.supabase.co`)
- **API Keys**:
  - **anon public** - Copy this (safe for client-side)
  - **service_role** - Copy this (secret, server-side only)

## 2. Configure Local Development

```bash
# On your local machine
cd /Users/georgeplsek/sites/wwwroot/mysurflife/backend

# Edit .env file
nano .env
```

**Fill in your credentials:**

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-anon-public-key-here
SUPABASE_SERVICE_KEY=your-service-role-secret-key-here

# Redis Configuration (already working)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Application Settings
ENVIRONMENT=development
DEBUG=true
LOG_LEVEL=info
```

**Save and exit:** `Ctrl+X`, `Y`, `Enter`

## 3. Install Dependencies

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

This installs:
- `python-dotenv` - Load .env files
- `supabase` - Supabase Python client

## 4. Test Supabase Connection

```bash
# Start backend with .env loaded
uvicorn main:app --reload

# You should see:
# ✅ Supabase connected: https://xxxxx.supabase.co
```

## 5. Configure Production Server

```bash
# SSH to production
ssh your-server

# Create .env file on production
cd /var/www/mysurflife/backend
sudo nano .env
```

**Add the same credentials** (use production values):

```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-anon-public-key
SUPABASE_SERVICE_KEY=your-service-role-key

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

ENVIRONMENT=production
DEBUG=false
LOG_LEVEL=info
```

**Set secure permissions:**

```bash
sudo chown www-data:www-data /var/www/mysurflife/backend/.env
sudo chmod 600 /var/www/mysurflife/backend/.env
```

**Install dependencies:**

```bash
cd /var/www/mysurflife/backend
source venv/bin/activate
pip install -r requirements.txt
deactivate
```

**Restart backend:**

```bash
sudo systemctl restart mysurflife-backend

# Check logs for Supabase connection
sudo journalctl -u mysurflife-backend -n 20 | grep -i supabase
```

## 6. Create Database Tables (Optional)

If you want to store buoy data, forecasts, or user data in Supabase:

### Example: Buoy History Table

```sql
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

CREATE TABLE buoy_history (
    id BIGSERIAL PRIMARY KEY,
    station_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    wave_height_m REAL,
    dominant_period_sec REAL,
    mean_wave_dir INTEGER,
    surf_height_m REAL,
    wave_energy REAL,
    water_temp_c REAL,
    wind_speed_ms REAL,
    wind_dir INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast queries
CREATE INDEX idx_buoy_history_station ON buoy_history(station_id, timestamp DESC);

-- Enable Row Level Security (optional)
ALTER TABLE buoy_history ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access" ON buoy_history
    FOR SELECT USING (true);
```

### Example: User Favorites Table

```sql
CREATE TABLE user_favorites (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    station_id TEXT NOT NULL,
    nickname TEXT,
    alert_threshold REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, station_id)
);

CREATE INDEX idx_user_favorites_user ON user_favorites(user_id);

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

-- Users can only see/edit their own favorites
CREATE POLICY "Users can manage their own favorites" ON user_favorites
    USING (auth.uid() = user_id);
```

## 7. Using Supabase in Code

```python
# In backend/main.py or any other file
from database import supabase

# Check if Supabase is available
if supabase:
    # Insert data
    result = supabase.table("buoy_history").insert({
        "station_id": "46266",
        "timestamp": "2026-01-23T12:00:00Z",
        "wave_height_m": 1.5,
        "dominant_period_sec": 12.0,
        "surf_height_m": 2.16,
        "wave_energy": 18.0
    }).execute()

    # Query data
    data = supabase.table("buoy_history") \
        .select("*") \
        .eq("station_id", "46266") \
        .order("timestamp", desc=True) \
        .limit(100) \
        .execute()

    # Update data
    supabase.table("buoy_history") \
        .update({"wave_height_m": 1.6}) \
        .eq("id", 123) \
        .execute()

    # Delete data
    supabase.table("buoy_history") \
        .delete() \
        .lt("timestamp", "2026-01-01T00:00:00Z") \
        .execute()
```

## 8. Environment Variable Best Practices

### ✅ DO:
- Use `.env` for local development
- Use server environment variables or secrets manager for production
- Keep `.env` file in `.gitignore` (already configured)
- Use different Supabase projects for dev/staging/prod

### ❌ DON'T:
- Commit `.env` file to git
- Share service role key publicly
- Use production credentials in development
- Hardcode credentials in source code

## 9. Verify Setup

### Local Development

```bash
cd backend
source venv/bin/activate
python3 << 'EOF'
from database import supabase

if supabase:
    print("✅ Supabase connected!")
    # Test query
    result = supabase.table("buoy_history").select("count").execute()
    print(f"Database accessible: {result}")
else:
    print("⚠️  Supabase not configured")
EOF
```

### Production

```bash
sudo journalctl -u mysurflife-backend -n 50 | grep -E "Supabase|✅|⚠️"
```

## 10. Troubleshooting

### "Supabase not configured" message

- Check `.env` file exists in `backend/` directory
- Verify `SUPABASE_URL` and `SUPABASE_KEY` are set
- Check credentials are correct (no extra spaces)

### "Failed to connect to Supabase"

- Verify Supabase project is active
- Check API keys are valid (regenerate if needed)
- Ensure server has internet access to supabase.co

### Permission denied on .env file (production)

```bash
sudo chown www-data:www-data /var/www/mysurflife/backend/.env
sudo chmod 600 /var/www/mysurflife/backend/.env
```

---

## Next Steps

After Supabase is configured, you can:

1. **Store historical buoy data** for trend analysis
2. **Cache forecast data** in database for faster loading
3. **User accounts** with Supabase Auth
4. **Favorite buoys** and custom alerts
5. **Spot conditions** and local surf reports

The database module is ready to use - just import it:

```python
from database import supabase, get_supabase_admin_client
```