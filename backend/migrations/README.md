# Database Migrations

This directory contains SQL migrations for the MySurfLife database.

## Running Migrations

### 1. Create Buoys Table

**Run in Supabase SQL Editor** (Dashboard > SQL Editor):

```bash
# Copy contents of 001_create_buoys_table.sql
cat migrations/001_create_buoys_table.sql
```

Paste the SQL into Supabase SQL Editor and execute.

### 2. Migrate Buoy Data

**Run from backend directory**:

```bash
cd backend
source venv/bin/activate
python3 migrate_buoys.py
```

Expected output:
```
🚀 Starting migration of 35 buoys to Supabase...
✅ Successfully migrated 35 buoys

Buoys by region:
  Central California: 5 buoys
  Hawaii: 5 buoys
  Northern California: 5 buoys
  Offshore Pacific: 2 buoys
  Pacific Northwest: 4 buoys
  Southern California: 14 buoys
```

### 3. Verify Migration

**Test in Python**:

```bash
python3 << 'EOF'
from buoy_registry import get_all_buoys, get_buoy_by_id

# Check buoy count
buoys = get_all_buoys()
print(f"Total buoys loaded: {len(buoys)}")

# Test specific buoy
delmar = get_buoy_by_id("46266")
if delmar:
    print(f"Found: {delmar['name']} at ({delmar['lat']}, {delmar['lon']})")
EOF
```

**Test via API**:

```bash
# Start backend
uvicorn main:app --reload

# In another terminal, test API
curl http://localhost:8000/api/buoy-status/all | jq '.[0]'
```

## Migration Details

### 001: Create Buoys Table

Creates the `buoys` table with:
- `id` (TEXT, primary key) - NDBC station ID
- `name` (TEXT) - Display name
- `latitude` (DOUBLE PRECISION)
- `longitude` (DOUBLE PRECISION)
- `wind_fallback_station` (TEXT, nullable) - NOS CO-OPS station for wind fallback
- `region` (TEXT) - Geographic region
- `active` (BOOLEAN) - Whether buoy is displayed
- `created_at`, `updated_at` (TIMESTAMPTZ)

Includes:
- Geographic index for location queries
- Region index for filtering
- Row Level Security with public read access

### Data Migration Script

`migrate_buoys.py`:
- Migrates 35 hardcoded buoys to database
- Uses upsert (can be run multiple times safely)
- Regional organization:
  - Southern California: 14 buoys
  - Central California: 5 buoys
  - Northern California: 5 buoys
  - Pacific Northwest: 4 buoys
  - Offshore Pacific: 2 buoys
  - Hawaii: 5 buoys

## Rollback

If you need to rollback:

```sql
-- Delete all buoys
DELETE FROM buoys;

-- Or drop the table entirely
DROP TABLE IF EXISTS buoys CASCADE;
```

## Adding New Buoys

After migration, add new buoys via database:

```sql
INSERT INTO buoys (id, name, latitude, longitude, region, active)
VALUES ('46999', 'New Buoy Name', 33.5, -118.0, 'Southern California', true);
```

Or programmatically:

```python
from database import supabase

supabase.table("buoys").insert({
    "id": "46999",
    "name": "New Buoy Name",
    "latitude": 33.5,
    "longitude": -118.0,
    "region": "Southern California",
    "active": True
}).execute()

# Refresh cache
from buoy_registry import refresh_buoy_cache
refresh_buoy_cache()
```