# Spot-Based AI Analysis - Migration Guide

## ✅ Status: Ready to Run Migration 003

The spot-based AI analysis system is complete and tested. The only remaining step is running the database migration to update the schema.

## 📋 What Migration 003 Does

1. Makes `buoy_id` column nullable (no longer required for spot-based analyses)
2. Adds `spot_id` column with foreign key to `spots` table
3. Updates unique constraint from `buoy_id` to `spot_id`
4. Creates index on `spot_id` for query performance

## 🚀 Run Migration

### Step 1: Open Supabase SQL Editor

1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql
2. Click "New Query"

### Step 2: Copy and Paste Migration SQL

```sql
-- Migration: Update AI Spot Analysis to work with surf spots (not buoys)
-- Links analysis to spots table and adds spot-specific fields

-- Drop old unique constraint
ALTER TABLE ai_spot_analysis DROP CONSTRAINT IF EXISTS unique_buoy_analysis;

-- Make buoy_id nullable (no longer required for spot-based analyses)
ALTER TABLE ai_spot_analysis ALTER COLUMN buoy_id DROP NOT NULL;

-- Add spot_id foreign key
ALTER TABLE ai_spot_analysis ADD COLUMN IF NOT EXISTS spot_id UUID REFERENCES spots(id) ON DELETE CASCADE;

-- Create new unique constraint for spot-based analysis
ALTER TABLE ai_spot_analysis ADD CONSTRAINT unique_spot_analysis UNIQUE (spot_id, persona_type, status);

-- Create index on spot_id
CREATE INDEX IF NOT EXISTS idx_ai_spot_analysis_spot_id ON ai_spot_analysis(spot_id);

-- Update comments
COMMENT ON COLUMN ai_spot_analysis.spot_id IS 'Foreign key to spots table - the actual surf spot being analyzed';
COMMENT ON COLUMN ai_spot_analysis.buoy_id IS 'Reference buoy ID (kept for backward compatibility)';

-- Note: buoy_id and related fields kept for backward compatibility
-- New analyses should use spot_id + spot_name
```

### Step 3: Run the Query

Click "Run" and verify you see "Success. No rows returned"

## 🧪 Test the System

### Test 1: Generate AI Analysis for Blacks Beach

```bash
curl -X POST "http://localhost:8000/api/spots/blacks-beach/ai-analysis/generate?force=true"
```

You should see:
- ✅ Analysis generated with spot-specific details (beach break, sand bottom, W-SW optimal direction)
- ✅ Saved to database successfully
- ✅ No warnings about save failures

### Test 2: Retrieve Cached Analysis

```bash
curl "http://localhost:8000/api/spots/blacks-beach/ai-analysis"
```

Should return the cached analysis from the database.

### Test 3: Generate for Multiple Spots

```bash
curl -X POST "http://localhost:8000/api/spots/swamis/ai-analysis/generate"
curl -X POST "http://localhost:8000/api/spots/scripps-pier/ai-analysis/generate"
```

## 📊 Verify in Supabase

After generating analyses, check the database:

```sql
SELECT
    spot_name,
    persona_type,
    model_used,
    status,
    created_at
FROM ai_spot_analysis
WHERE spot_id IS NOT NULL
ORDER BY created_at DESC;
```

You should see your generated analyses linked to actual spots.

## 🎨 Frontend Integration

The `AISpotAnalysis` component is ready to use. Add it to your spot detail pages:

```javascript
import AISpotAnalysis from './AISpotAnalysis';

// In your SpotDetail.js or similar component:
<AISpotAnalysis
  spotSlug="blacks-beach"
  spotName="Blacks Beach"
/>
```

The component will:
- Check for cached analysis in database
- Show "Generate AI Analysis" button if none exists
- Display comprehensive swell geometry analysis
- Allow regeneration with ♻️ button

## 🐛 Troubleshooting

### If migration fails:

```sql
-- Check if table exists
SELECT table_name FROM information_schema.tables
WHERE table_name = 'ai_spot_analysis';

-- Check current columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ai_spot_analysis';
```

### If analysis save fails:

Check backend logs for specific error:
```bash
tail -f backend/backend.log
```

Common issues:
- `buoy_id NOT NULL constraint`: Migration not run yet
- `spot_id foreign key violation`: Spot doesn't exist in spots table
- `unique_spot_analysis violation`: Analysis already exists for this spot (use `force=true` to regenerate)

## 💰 Cost Estimate

Using Claude 3 Haiku model:
- ~$0.005 per analysis (~$0.25 for 50 spots)
- Analyses are cached permanently in database
- Only regenerate when needed (new spot data, user request, or batch update)

## 📝 Next Steps

After migration is complete:

1. ✅ Test with Blacks Beach, Swamis, Scripps Pier
2. 🔄 Batch generate for all spots (optional):
   ```bash
   curl -X POST "http://localhost:8000/api/spots/ai-analysis/batch-generate"
   ```
3. 🎨 Integrate UI component into spot detail pages
4. 🤖 Optional: Add more AI personas (Conditions Interpreter, Session Optimizer, etc.)