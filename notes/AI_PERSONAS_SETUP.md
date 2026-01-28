# 🤖 AI Surf Analysis Personas - Setup Guide

## Overview

MySurfLife now includes AI-powered surf analysis using specialized personas:

**Persona 1: Swell Geometry Analyst** ✅ Implemented
- Expert oceanographer analyzing optimal swell directions
- Identifies shadow zones from islands and landmasses
- Explains period-dependent diffraction and wrap
- Provides bathymetry and refraction analysis

**Future Personas** (Framework Ready):
- Conditions Interpreter - Plain-English surf reports
- Session Optimizer - Best sessions in next 5 days
- Wind Quality Analyst - Offshore/onshore analysis

---

## 🚀 Quick Start

### 1. Get Anthropic API Key

Sign up at: https://console.anthropic.com/

Get your API key and add it to `.env`:

```bash
cd backend
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" >> .env
```

### 2. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

This adds the `anthropic` Python package.

### 3. Run Database Migration

```bash
# Connect to your Supabase instance and run:
psql postgresql://YOUR_CONNECTION_STRING < migrations/002_create_ai_spot_analysis.sql
```

Or use Supabase dashboard:
1. Go to SQL Editor
2. Paste contents of `migrations/002_create_ai_spot_analysis.sql`
3. Run

### 4. Restart Backend

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

You should see:
```
✅ Anthropic API initialized for AI personas
✅ AI personas module loaded
```

---

## 📊 API Endpoints

### Get Cached Analysis

```bash
GET /api/ai/spot-analysis/{buoy_id}
```

Returns cached AI analysis if it exists.

**Example:**
```bash
curl http://localhost:8000/api/ai/spot-analysis/46266
```

### Generate New Analysis

```bash
POST /api/ai/spot-analysis/{buoy_id}/generate
```

Generates fresh AI analysis (caches to database).

**Example:**
```bash
curl -X POST http://localhost:8000/api/ai/spot-analysis/46266/generate
```

**With force regeneration:**
```bash
curl -X POST "http://localhost:8000/api/ai/spot-analysis/46266/generate?force=true"
```

### Batch Generate (Background Job)

```bash
POST /api/ai/spot-analysis/batch-generate
```

Generate analysis for multiple buoys at once.

**Example - All buoys:**
```bash
curl -X POST http://localhost:8000/api/ai/spot-analysis/batch-generate \
  -H "Content-Type: application/json"
```

**Example - Specific buoys:**
```bash
curl -X POST http://localhost:8000/api/ai/spot-analysis/batch-generate \
  -H "Content-Type: application/json" \
  -d '{"buoy_ids": ["46266", "46225", "46232"], "force": false}'
```

### Get All Analyses

```bash
GET /api/ai/analyses/all?persona_type=swell_geometry_analyst&limit=50
```

**Example:**
```bash
curl "http://localhost:8000/api/ai/analyses/all?limit=10"
```

### Delete Analysis

```bash
DELETE /api/ai/spot-analysis/{analysis_id}
```

Archives an analysis (soft delete).

### Submit Feedback

```bash
POST /api/ai/spot-analysis/{analysis_id}/feedback
```

**Example:**
```bash
curl -X POST http://localhost:8000/api/ai/spot-analysis/UUID/feedback \
  -H "Content-Type: application/json" \
  -d '{"rating": 5, "notes": "Spot on analysis!"}'
```

### Get Statistics

```bash
GET /api/ai/stats
```

Returns total analyses count.

---

## 🎨 Frontend Integration

### Import Component

```javascript
import AISpotAnalysis from './AISpotAnalysis';
```

### Use in Buoy Detail Panel

```javascript
const [showAIAnalysis, setShowAIAnalysis] = useState(false);

// Add button to buoy detail
<button onClick={() => setShowAIAnalysis(true)}>
  🤖 AI Spot Analysis
</button>

// Render component
{showAIAnalysis && (
  <AISpotAnalysis
    buoyId={selectedBuoy.id}
    spotName={selectedBuoy.name}
    onClose={() => setShowAIAnalysis(false)}
  />
)}
```

### Integration Options

**Option A: Modal/Overlay** (Recommended)
```javascript
// Show as overlay on top of map
{showAIAnalysis && (
  <div className="ai-analysis-modal">
    <AISpotAnalysis ... />
  </div>
)}
```

**Option B: Expandable Section**
```javascript
// Show within buoy detail panel
<div className="buoy-detail-section">
  <h3 onClick={() => setShowAIAnalysis(!showAIAnalysis)}>
    🤖 AI Analysis {showAIAnalysis ? '▼' : '▶'}
  </h3>
  {showAIAnalysis && <AISpotAnalysis ... />}
</div>
```

**Option C: Separate Page**
```javascript
// Navigate to /spot/{buoy_id}/analysis route
<Route path="/spot/:buoyId/analysis">
  <AISpotAnalysis ... />
</Route>
```

---

## 💰 Cost Estimates

**Claude 3.5 Sonnet Pricing:**
- Input: ~$3 per million tokens
- Output: ~$15 per million tokens

**Per Analysis:**
- Average cost: **$0.01 - $0.05** per spot
- With 24-hour caching: ~$0.50-$2.00 per day for moderate usage

**Example: 35 buoys analyzed once:**
- Total cost: ~$0.35 - $1.75 one-time
- Re-analyze on demand or when conditions change significantly

---

## 🔧 Configuration

### Environment Variables

```bash
# backend/.env

# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional (for alternative provider)
# OPENAI_API_KEY=sk-...
```

### Caching Strategy

**Database storage** (Supabase):
- Analysis persists forever (unless archived)
- Marked as "superseded" when regenerated
- Access via `GET /api/ai/spot-analysis/{buoy_id}`

**Regeneration triggers** (suggested):
1. **On-demand**: User clicks "Regenerate" button
2. **Scheduled**: Background job every 30 days (coastline doesn't change!)
3. **Never**: Analysis is timeless (geography is constant)

**Best practice:**
- Generate once per buoy when first discovered
- Regenerate only if:
  - User reports inaccuracy
  - Analysis version updated (new prompts)
  - Major coastal changes (rare)

---

## 🧪 Testing

### Test Single Buoy Analysis

```bash
# 1. Generate analysis for Del Mar
curl -X POST http://localhost:8000/api/ai/spot-analysis/46266/generate

# 2. Retrieve cached analysis
curl http://localhost:8000/api/ai/spot-analysis/46266

# 3. Check database
# Go to Supabase dashboard → ai_spot_analysis table
```

### Test Frontend Component

```bash
cd frontend
npm start
```

1. Click on any buoy marker
2. Look for "🤖 AI Spot Analysis" button
3. Click to generate/view analysis
4. Verify all sections render correctly

### Test Batch Generation

```bash
# Generate for first 3 buoys
curl -X POST http://localhost:8000/api/ai/spot-analysis/batch-generate \
  -H "Content-Type: application/json" \
  -d '{
    "buoy_ids": ["46266", "46225", "46232"],
    "force": false
  }'
```

---

## 📝 Database Schema

Table: `ai_spot_analysis`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `buoy_id` | TEXT | Buoy identifier (e.g., "46266") |
| `spot_name` | TEXT | Human-readable name |
| `latitude` | DECIMAL | Spot latitude |
| `longitude` | DECIMAL | Spot longitude |
| `analysis_data` | JSONB | Full AI analysis results |
| `persona_type` | TEXT | Persona used (e.g., "swell_geometry_analyst") |
| `model_used` | TEXT | AI model (e.g., "claude-3-5-sonnet-20241022") |
| `analysis_version` | TEXT | Version for tracking prompt changes |
| `created_at` | TIMESTAMP | When generated |
| `updated_at` | TIMESTAMP | Last updated |
| `status` | TEXT | active / archived / superseded |
| `user_feedback_rating` | INTEGER | 1-5 stars (optional) |
| `user_feedback_notes` | TEXT | User comments (optional) |

**Indexes:**
- `buoy_id` - Fast lookup by buoy
- `persona_type` - Filter by persona
- `status` - Query active analyses
- `created_at` - Sort by date

---

## 🐛 Troubleshooting

### "AI personas not configured"

**Problem:** Missing `ANTHROPIC_API_KEY` in environment.

**Solution:**
```bash
cd backend
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" >> .env
# Restart backend
```

### "Analysis already exists"

**Problem:** Trying to generate when cached analysis present.

**Solution:** Use `force=true` parameter:
```bash
curl -X POST "http://localhost:8000/api/ai/spot-analysis/46266/generate?force=true"
```

### "Failed to parse JSON"

**Problem:** AI response format changed or malformed.

**Solution:**
1. Check raw response in logs
2. Update `extract_json_from_response()` in `ai_personas.py`
3. Regenerate with updated parser

### Analysis quality issues

**Problem:** AI analysis inaccurate or generic.

**Solution:**
1. Update prompt in `ai_personas.py` (SwellGeometryAnalyst.analyze)
2. Increment `analysis_version` to "1.1"
3. Regenerate analyses with new prompt

---

## 🔄 Future Enhancements

### Add More Personas (Framework Ready)

**Conditions Interpreter:**
```python
# Already stubbed in ai_personas.py
result = await ConditionsInterpreter.interpret(
    wvht_ft=4.5,
    dpd_sec=14,
    mwd_deg=240,
    wind_speed_kts=8,
    wind_dir_deg=90,
    spot_name="Del Mar"
)
```

**Session Optimizer:**
```python
# Analyze 5-day forecast to find best sessions
result = await SessionOptimizer.optimize(
    forecast_data=[...],
    user_prefs={"skill": "intermediate", "preferred_size": "4-6ft"}
)
```

### Use Analysis in Surf Scoring

**Integrate with `surf_scoring.py`:**
```python
# Fetch AI analysis
ai_analysis = await get_analysis(buoy_id)

# Use optimal_swell data to boost score
if swell_direction == ai_analysis['optimal_swell']['direction_deg']:
    score += 1.0  # Bonus for optimal direction
```

### Background Processing

**Set up cron job:**
```bash
# Generate missing analyses nightly
0 2 * * * curl -X POST http://localhost:8000/api/ai/spot-analysis/batch-generate
```

---

## 📚 References

- **Anthropic Docs**: https://docs.anthropic.com/
- **Claude API**: https://console.anthropic.com/
- **Supabase Docs**: https://supabase.com/docs

---

## ✅ Checklist

- [ ] Get Anthropic API key
- [ ] Add `ANTHROPIC_API_KEY` to `.env`
- [ ] Install `anthropic` package (`pip install -r requirements.txt`)
- [ ] Run database migration (`002_create_ai_spot_analysis.sql`)
- [ ] Restart backend and verify "✅ AI personas module loaded"
- [ ] Test single buoy analysis generation
- [ ] Integrate `AISpotAnalysis` component into frontend
- [ ] Generate analyses for all buoys (optional)
- [ ] Set up feedback collection (optional)

---

**Status**: ✅ Persona 1 (Swell Geometry Analyst) fully operational!

**Next Steps**:
1. Generate analyses for your main buoys
2. Integrate UI component into buoy detail panels
3. Collect user feedback on analysis quality
4. Implement additional personas as needed

**Questions?** Check logs for detailed error messages or review this guide.