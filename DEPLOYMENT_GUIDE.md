# Deployment Guide - Multi-Model AI Spot Analysis

This guide covers deploying the multi-model AI spot analysis system to production.

## 📋 What's New in This Release

### Backend Features
- **Multi-model AI analysis**: Claude Sonnet 4 + OpenAI GPT-4o
- **Global spot support**: Works anywhere in the world (not just California)
- **Enhanced AI prompts**: Includes all human-entered spot data
- **Hawaiian buoy 51201**: Waimea Bay buoy for Pipeline forecasting
- **New API endpoints**: `/api/spots/{slug}/ai-analysis/all`
- **Authentication system**: Supabase auth with admin roles
- **Surf spots infrastructure**: Detail pages, scoring, timeline

### Frontend Features
- **Tabbed AI analysis**: Compare Claude vs OpenAI analyses
- **Spot detail pages**: Comprehensive spot information
- **Admin login**: Secure authentication interface
- **AI persona management**: Admin-only persona configuration

---

## 🔐 Environment Variables (.env Updates)

### Required on Production Server

**Location**: `/var/www/mysurflife/backend/.env`

Add these **NEW** environment variables:

```bash
# OpenAI API (NEW - for GPT-4o integration)
OPENAI_API_KEY=your_openai_api_key_here

# Anthropic API (UPDATE model if needed)
ANTHROPIC_API_KEY=your_existing_anthropic_key
# Note: Now using Claude Sonnet 4 (claude-sonnet-4-20250514)

# Supabase (should already exist)
SUPABASE_URL=https://duebzukxycgfkfjezwjq.supabase.co
SUPABASE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# Redis (should already exist)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Get Your OpenAI API Key

1. Visit https://platform.openai.com/api-keys
2. Create new secret key
3. Copy the key (starts with `sk-proj-...`)
4. Add to production `.env` file

---

## 📦 Database Updates

### 1. Buoy 51201 (Waimea Bay)

**Run on production server:**

```bash
cd /var/www/mysurflife/backend
source venv/bin/activate

# Add Waimea Bay buoy to database
python3 << 'EOF'
import asyncio
from database import get_supabase_admin_client

async def main():
    admin = get_supabase_admin_client()

    # Check if exists
    existing = admin.table("buoys").select("id").eq("id", "51201").execute()
    if existing.data:
        print("✓ Buoy 51201 already exists")
        return

    # Add buoy
    result = admin.table("buoys").insert({
        "id": "51201",
        "name": "Waimea Bay",
        "latitude": 21.671,
        "longitude": -158.118,
        "region": "Hawaii",
        "active": True,
        "wind_fallback_station": None
    }).execute()

    if result.data:
        print("✅ Added buoy 51201 (Waimea Bay)")
    else:
        print("❌ Failed to add buoy")

asyncio.run(main())
EOF
```

### 2. International Test Spots (Optional)

If you want Pipeline and Uluwatu test spots:

```bash
# Run the script (already in repo)
python3 backend/add_test_international_spots.py
python3 backend/update_international_buoys.py
```

**Note**: These are test spots. Skip if you don't want them in production.

---

## 🚀 Deployment Steps

### Step 1: Pull Latest Code

```bash
cd /var/www/mysurflife
git pull origin main
```

### Step 2: Update Backend Dependencies

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

**New dependencies added:**
- `openai>=1.0.0` - OpenAI API client

### Step 3: Update Frontend Dependencies

```bash
cd frontend
npm install
```

**No new npm packages** - only code changes.

### Step 4: Update .env File

```bash
cd /var/www/mysurflife/backend
nano .env
```

Add the OpenAI API key (see Environment Variables section above).

### Step 5: Add Waimea Bay Buoy

Run the database update script from "Database Updates" section above.

### Step 6: Build Frontend

```bash
cd /var/www/mysurflife/frontend
npm run build
```

### Step 7: Restart Backend Service

```bash
sudo systemctl restart mysurflife-backend
```

### Step 8: Reload Apache

```bash
sudo systemctl reload apache2
```

---

## ✅ Verification Steps

### 1. Check Backend Health

```bash
# Test backend is running
curl https://mysurflife.com/api/buoy-status/all | jq '.[] | select(.station == "51201")'

# Should return Waimea Bay buoy data
```

### 2. Test Pipeline Spot

```bash
# Test Pipeline conditions with Hawaiian buoys
curl https://mysurflife.com/api/surf-spots/pipeline/conditions | jq

# Should show:
# - primary_buoy: "51201"
# - buoys_used: [51201, 51101, 51001]
```

### 3. Test Multi-Model AI Endpoint

```bash
# Test AI analysis endpoint for Blacks Beach
curl https://mysurflife.com/api/spots/blacks-beach/ai-analysis/all | jq

# Should return:
# - analyses.claude (Claude Sonnet 4)
# - analyses.openai (OpenAI GPT-4o)
```

### 4. Frontend Tests

Visit these URLs in browser:

- **Blacks Beach spot**: https://mysurflife.com/spots/blacks-beach
  - Verify tabbed AI analysis (Claude + OpenAI tabs)
  - Verify spot details, conditions, timeline

- **Pipeline spot**: https://mysurflife.com/spots/pipeline
  - Verify shows on map (Hawaii location)
  - Verify conditions use Hawaiian buoys
  - Generate AI analyses to test global prompts

- **Admin login**: https://mysurflife.com/login
  - Test admin authentication
  - Verify AI persona management

### 5. Check Backend Logs

```bash
sudo journalctl -u mysurflife-backend -f

# Look for:
# ✅ Loaded 36 buoys from database (includes 51201)
# ✅ OpenAI API initialized for AI personas
# ✅ Spot-based AI personas loaded
```

---

## 🔧 Troubleshooting

### Issue: "OpenAI API key not found"

**Fix:**
```bash
cd /var/www/mysurflife/backend
nano .env
# Add: OPENAI_API_KEY=sk-proj-...
sudo systemctl restart mysurflife-backend
```

### Issue: "Buoy 51201 not found"

**Fix:**
```bash
# Re-run database script
cd /var/www/mysurflife/backend
source venv/bin/activate
# Run buoy insert script from "Database Updates" section
sudo systemctl restart mysurflife-backend
```

### Issue: "Module 'openai' not found"

**Fix:**
```bash
cd /var/www/mysurflife/backend
source venv/bin/activate
pip install openai
sudo systemctl restart mysurflife-backend
```

### Issue: Frontend shows old code

**Fix:**
```bash
cd /var/www/mysurflife/frontend
npm run build
# Clear browser cache: Ctrl+Shift+R (Chrome) or Cmd+Shift+R (Mac)
```

### Issue: AI analysis generates but doesn't save

**Fix:**
- Check Supabase RLS policies allow inserts to `ai_spot_analysis` table
- Verify `SUPABASE_SERVICE_KEY` is set in `.env`
- Check backend logs: `sudo journalctl -u mysurflife-backend -n 100`

---

## 📊 Database Schema Changes

### New Tables (should already exist if Supabase setup ran)

**`ai_spot_analysis`**:
- Stores Claude and OpenAI analyses
- Differentiated by `persona_type` column
- JSONB `analysis_data` for flexible storage

**`ai_personas`**:
- Persona configurations
- Used by admin persona management

### Updated Tables

**`buoys`**:
- Added buoy `51201` (Waimea Bay)

**`spot_forecast_tuning`**:
- Pipeline spot updated with Hawaiian buoy blend

---

## 🌍 New International Spots

If you ran the test spot scripts, you'll have:

### Pipeline, Hawaii
- **URL**: https://mysurflife.com/spots/pipeline
- **Buoys**: 51201 (Waimea Bay), 51101 (Hanalei), 51001 (NW Hawaii)
- **Features**: Full conditions, AI analysis, timeline

### Uluwatu, Bali
- **URL**: https://mysurflife.com/spots/uluwatu
- **Buoys**: None (no NOAA buoys in Indonesia)
- **Features**: Spot info, AI analysis (no live conditions yet)
- **Future**: Will use WaveWatch III model data only

---

## 🔑 Admin Access

### Create Admin User (if needed)

```bash
cd /var/www/mysurflife/backend
source venv/bin/activate

# Update user role to admin
python3 << 'EOF'
import asyncio
from database import get_supabase_admin_client

async def main():
    admin = get_supabase_admin_client()
    email = "your-email@example.com"

    # Get user by email
    result = admin.auth.admin.list_users()
    user = next((u for u in result if u.email == email), None)

    if user:
        # Update metadata
        admin.auth.admin.update_user_by_id(
            user.id,
            {"user_metadata": {"role": "admin"}}
        )
        print(f"✅ Made {email} an admin")
    else:
        print(f"❌ User {email} not found")

asyncio.run(main())
EOF
```

---

## 📈 Performance Considerations

### Redis Cache
- AI analyses are NOT cached (always fresh)
- Buoy data cached for 5 minutes
- Wind/wave overlays cached by bbox/hour

### API Rate Limits
- **Anthropic**: Track Claude Sonnet 4 usage
- **OpenAI**: Track GPT-4o usage
- Consider caching AI responses if regenerated frequently

### Database Connections
- Backend uses connection pooling
- Supabase has connection limits on free tier
- Monitor with: `SELECT * FROM pg_stat_activity;`

---

## 🎯 Testing Checklist

After deployment, verify:

- [ ] Backend health: `/api/buoy-status/all` returns 36 buoys
- [ ] Buoy 51201 active: Shows Waimea Bay data
- [ ] Pipeline spot: Shows on map at Hawaii location
- [ ] Pipeline conditions: Uses Hawaiian buoys (51201 primary)
- [ ] Blacks Beach AI: Shows tabbed Claude + OpenAI analyses
- [ ] Generate Claude analysis: Saves to database correctly
- [ ] Generate OpenAI analysis: Saves with different persona_type
- [ ] Tab switching: Toggle between analyses works
- [ ] Admin login: Authentication successful
- [ ] Admin buttons: Only visible when logged in as admin
- [ ] Persona management: Admin can view/edit personas
- [ ] Mobile responsive: Tabs work on mobile devices

---

## 📞 Support

### Backend Logs
```bash
sudo journalctl -u mysurflife-backend -f
```

### Apache Logs
```bash
sudo tail -f /var/log/apache2/mysurflife-error.log
sudo tail -f /var/log/apache2/mysurflife-access.log
```

### Database Queries
Use Supabase SQL Editor:
```sql
-- Check AI analyses
SELECT spot_slug, persona_type, model_used, created_at
FROM ai_spot_analysis
ORDER BY created_at DESC
LIMIT 10;

-- Check buoy 51201
SELECT * FROM buoys WHERE id = '51201';

-- Check Pipeline forecast tuning
SELECT s.slug, sft.buoy_blend
FROM spots s
JOIN spot_forecast_tuning sft ON s.id = sft.spot_id
WHERE s.slug = 'pipeline';
```

---

## 🎉 Post-Deployment

Once deployed and verified:

1. **Test AI Analysis**:
   - Generate Claude analysis for Blacks Beach
   - Generate OpenAI analysis for Blacks Beach
   - Compare quality and accuracy

2. **Monitor Costs**:
   - Claude Sonnet 4: ~$3 per 1M input tokens
   - OpenAI GPT-4o: ~$2.50 per 1M input tokens
   - Each analysis ~2,000 tokens = $0.006-$0.007 per analysis

3. **User Feedback**:
   - Ask users to compare Claude vs OpenAI analyses
   - Track which model provides more accurate spot assessments
   - Consider adding user voting/feedback UI

4. **International Expansion**:
   - Add more Hawaiian spots (Sunset Beach, Haleiwa, etc.)
   - Research Indonesian BMKG buoys for Uluwatu
   - Implement WaveWatch III-only mode for non-NDBC regions

---

## 📚 Related Documentation

- **TABBED_AI_ANALYSIS.md** - Tabbed UI implementation details
- **GLOBAL_SPOT_ANALYSIS.md** - Global spot analysis architecture
- **AI_ANALYSIS_ENHANCEMENTS.md** - Enhancement summary
- **SURF_SPOTS_API.md** - API endpoint documentation
- **SUPABASE_SETUP.md** - Database schema and setup

---

## ✅ Quick Deploy Summary

```bash
# 1. Pull code
cd /var/www/mysurflife && git pull

# 2. Backend deps
cd backend && source venv/bin/activate && pip install -r requirements.txt

# 3. Frontend deps & build
cd ../frontend && npm install && npm run build

# 4. Update .env (add OPENAI_API_KEY)
nano backend/.env

# 5. Add buoy 51201 (run database script)

# 6. Restart services
sudo systemctl restart mysurflife-backend
sudo systemctl reload apache2

# 7. Verify
curl https://mysurflife.com/api/buoy-status/all | jq '.[] | select(.station == "51201")'
```

---

**Deployment Date**: 2026-01-28
**Version**: Multi-Model AI (Claude Sonnet 4 + OpenAI GPT-4o)
**Commit**: `3993dd2` - 🌍 Multi-model AI spot analysis with global support
