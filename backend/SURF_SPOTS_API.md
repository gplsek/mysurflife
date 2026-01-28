# Surf Spots API - Documentation

## Overview

Real-time surf conditions scoring API for 5 pilot surf spots in San Diego County. Uses blended buoy data (3-5 buoys per spot) to calculate surf quality scores on a 0-10 scale.

## Current Status

✅ **LIVE** - All endpoints operational

### Spots Loaded
1. **Blacks Beach** (world-class beach break, expert) - 4 buoys mapped
2. **Swamis** (world-class point break, experienced) - 4 buoys mapped
3. **Cardiff Reef** (reef break, intermediate) - 4 buoys mapped
4. **Seaside Reef** (regional classic reef, experienced) - 4 buoys mapped
5. **Oceanside Harbor** (jetty break, experienced) - 4 buoys mapped

### Example Scores (Current)
```
🟢 7.7/10 - Seaside Reef (Good)
🟢 7.2/10 - Swamis (Good)
🟡 6.1/10 - Cardiff Reef (Fair)
🟡 5.8/10 - Blacks Beach (Fair)
🟡 5.7/10 - Oceanside Harbor (Fair)
```

## API Endpoints

### 1. List All Spots

```bash
GET /api/surf-spots
```

**Query Parameters:**
- `region` (optional) - Filter by region (e.g., "San Diego County")
- `skill_level` (optional) - Filter by skill (beginner, intermediate, experienced, expert)
- `min_score` (optional) - Minimum score (requires with_scores=true)
- `with_scores` (optional) - Include real-time scores (default: false, slower)

**Example:**
```bash
# Basic list (fast)
curl "http://localhost:8000/api/surf-spots"

# With real-time scores (slower, ~2-3 seconds)
curl "http://localhost:8000/api/surf-spots?with_scores=true"

# Filter by skill level
curl "http://localhost:8000/api/surf-spots?skill_level=experienced&with_scores=true"

# Only show spots scoring 7+
curl "http://localhost:8000/api/surf-spots?with_scores=true&min_score=7.0"
```

**Response:**
```json
{
  "spots": [
    {
      "id": "66685b93-a1bb-4dc7-9786-4d002525ddcd",
      "name": "Blacks Beach",
      "slug": "blacks-beach",
      "latitude": 32.879583,
      "longitude": -117.253833,
      "spot_characteristics": {
        "break_type": "beach",
        "bottom_type": "sand",
        "wave_quality": "world_class",
        "skill_level": "expert",
        "best_swell_direction": "NW, W, SW",
        "works_from_swell_ft": 3.0,
        "works_to_swell_ft": 16.0
      },
      "current_conditions": {
        "overall_score": 5.8,
        "rating": "Fair",
        "emoji": "🟡",
        "wave_height_ft": 2.7,
        "adjusted_height_ft": 2.9,
        "swell_direction": 243
      }
    }
  ],
  "count": 5,
  "with_scores": true
}
```

### 2. Get Spot Detail

```bash
GET /api/surf-spots/{slug}
```

**Example:**
```bash
curl "http://localhost:8000/api/surf-spots/blacks-beach"
```

**Response:**
```json
{
  "id": "66685b93-a1bb-4dc7-9786-4d002525ddcd",
  "name": "Blacks Beach",
  "slug": "blacks-beach",
  "latitude": 32.879583,
  "longitude": -117.253833,
  "location_description": "Below Torrey Pines Glider Port, north of La Jolla",
  "access_description": "Park at Torrey Pines Glider Port. Take trail down to beach (15-30 min hike).",
  "parking_info": "Free parking at Glider Port, but can fill up on weekends",

  "spot_characteristics": {
    "break_type": "beach",
    "bottom_type": "sand",
    "wave_direction": "both",
    "wave_power": "hollow, fast, powerful",
    "wave_quality": "world_class",
    "skill_level": "expert",
    "crowd_level": "ultra_crowded",
    "best_swell_direction": "NW, W, SW",
    "works_from_swell_ft": 3.0,
    "works_to_swell_ft": 16.0,
    "best_wind_direction": "E",
    "tide_position": "low-mid",
    "hazards": ["rips", "undertow", "localism", "sneaker_sets"]
  },

  "spot_swell_windows": [
    {
      "dir_min": 280,
      "dir_max": 310,
      "period_min_sec": 12,
      "weight": 1.0,
      "notes": "Primary NW-W window, clean long-period lines"
    },
    {
      "dir_min": 245,
      "dir_max": 275,
      "period_min_sec": 10,
      "weight": 0.8,
      "notes": "SW swells work, can be sectiony"
    }
  ],

  "spot_wind_windows": [
    {
      "dir_min": 45,
      "dir_max": 135,
      "max_mph": 8,
      "category": "ideal",
      "weight": 1.0
    }
  ],

  "spot_forecast_tuning": {
    "buoy_blend": {
      "46225": {"weight": 0.5, "role": "primary"},
      "46266": {"weight": 0.25, "role": "secondary"},
      "46232": {"weight": 0.15, "role": "tertiary"},
      "46259": {"weight": 0.1, "role": "backup"}
    },
    "hs_multiplier": 1.1,
    "direction_penalty_deg": 15,
    "confidence_base": 0.75
  }
}
```

### 3. Get Real-Time Conditions

```bash
GET /api/surf-spots/{slug}/conditions
```

**Example:**
```bash
curl "http://localhost:8000/api/surf-spots/swamis/conditions"
```

**Response:**
```json
{
  "spot_name": "Swamis",
  "spot_slug": "swamis",

  "overall_score": 7.2,
  "rating": "Good",
  "emoji": "🟢",

  "swell_direction_score": 1.49,
  "swell_size_score": 2.7,
  "wind_direction_score": 1.0,
  "wind_speed_score": 2.0,

  "wave_height_m": 0.67,
  "wave_height_ft": 2.2,
  "adjusted_height_ft": 2.3,
  "period_sec": 12.7,
  "swell_direction": 251,
  "wind_speed_mph": null,
  "wind_direction": null,

  "buoys_used": [
    {
      "id": "46224",
      "weight": 0.4,
      "wave_height_m": 0.6
    },
    {
      "id": "46275",
      "weight": 0.3,
      "wave_height_m": 0.7
    },
    {
      "id": "46225",
      "weight": 0.2,
      "wave_height_m": 0.7
    },
    {
      "id": "46277",
      "weight": 0.1,
      "wave_height_m": 0.8
    }
  ],
  "primary_buoy": "46224",
  "confidence": 0.8,
  "best_swell_window": "NW-W primary, best with long period"
}
```

## Scoring Algorithm

### Overall Score (0-10 scale)

Calculated from 4 components:

1. **Swell Direction** (0-3 points)
   - Checks if swell is coming from optimal direction windows
   - Applies penalty for off-angle swell
   - Uses weighted windows (some directions better than others)

2. **Swell Size** (0-3 points)
   - Checks if wave height is in spot's working range
   - Applies spot's height multiplier (some spots amplify swell)
   - Sweet spot bonus for mid-range sizes

3. **Wind Direction** (0-2 points)
   - Offshore winds = ideal (2 points)
   - Light onshore = tolerable (1-1.5 points)
   - Strong onshore = poor (0 points)

4. **Wind Speed** (0-2 points)
   - < 5 mph = perfect (2 points)
   - 5-10 mph = good (1.5 points)
   - 10-15 mph = marginal (0.8 points)
   - > 15 mph = blown out (0 points)

### Rating Scale

- **Epic** (8.5-10) 🔥 - Go now!
- **Good** (7-8.5) 🟢 - Surfable and fun
- **Fair** (5-7) 🟡 - Worth checking out
- **Poor** (3-5) 🟠 - Small or messy
- **Flat** (0-3) 🔴 - Don't bother

### Buoy Blending

Each spot uses 3-5 buoys with weighted blending:

```
Wave Height = Σ (buoy_height × weight)
Direction = from highest-weighted buoy
```

Example for Blacks Beach:
```
46225 (Torrey Pines): 0.7m × 50% = 0.35m
46266 (Del Mar):       0.6m × 25% = 0.15m
46232 (Point Loma):    0.9m × 15% = 0.135m
46259 (Mission Bay):   1.8m × 10% = 0.18m
                    Total = 0.815m (2.7ft)
```

## Implementation Details

### Files

- **`surf_scoring.py`** - Core scoring algorithm (500+ lines)
- **`main.py`** - API endpoints (lines 2760-2900)
- **`migrations/002_create_surf_spots_tables.sql`** - Database schema (5 tables)
- **`migrate_surf_spots.py`** - Data loader script

### Database Schema

5 interconnected tables:

1. **`spots`** - Core identity (name, location, access)
2. **`spot_characteristics`** - Wave type, skill, conditions
3. **`spot_swell_windows`** - Multiple swell direction ranges per spot
4. **`spot_wind_windows`** - Multiple wind direction preferences
5. **`spot_forecast_tuning`** - Buoy blend + algorithm tuning

### Caching

- Buoy data: 5 min cache (L1 memory + L2 Redis)
- Spot scores: Calculated on-demand (fast, ~100ms per spot)
- Batch requests: Single buoy fetch for all spots (~2-3 sec for 5 spots)

### Performance

- Single spot conditions: ~100-200ms
- All spots with scores: ~2-3 seconds (fetches 18+ buoys)
- List without scores: <50ms (database only)

## Testing

```bash
# Test all spots ranked by score
curl -s "http://localhost:8000/api/surf-spots?with_scores=true" \
  | python3 -c "import sys, json; data = json.load(sys.stdin); \
    spots = sorted(data['spots'], key=lambda x: x.get('current_conditions', {}).get('overall_score', 0), reverse=True); \
    [print(f'{s[\"current_conditions\"][\"emoji\"]} {s[\"current_conditions\"][\"overall_score\"]}/10 - {s[\"name\"]}') for s in spots if s.get('current_conditions')]"

# Test specific spot
curl "http://localhost:8000/api/surf-spots/swamis/conditions" | python3 -m json.tool

# Filter by skill level
curl "http://localhost:8000/api/surf-spots?skill_level=experienced&with_scores=true"
```

## Next Steps

### Immediate (Option B)
- Add surf spots to map UI with markers
- Color-code by score (🟢 Good, 🟡 Fair, 🔴 Poor)
- Click handler for spot details panel

### Short-term (Option C)
- Create spot detail pages with charts
- Add filtering UI (skill level, min score)
- "Where should I surf now?" recommendations

### Future
- Expand to 30-50 spots (Orange County, LA)
- Add tide data integration
- Webcam feeds
- User ratings and session logs
- Push notifications ("Your spot is firing!")

## Example Use Cases

### 1. "What's the best spot right now?"
```bash
curl -s "http://localhost:8000/api/surf-spots?with_scores=true&min_score=7.0"
# Returns: Seaside Reef (7.7), Swamis (7.2)
```

### 2. "Where can I surf as an intermediate?"
```bash
curl -s "http://localhost:8000/api/surf-spots?skill_level=intermediate&with_scores=true"
# Returns: Cardiff Reef (6.1)
```

### 3. "Show me all the data for Blacks Beach"
```bash
curl "http://localhost:8000/api/surf-spots/blacks-beach"
# Returns: Full spot details with buoy mappings
```

### 4. "Is Swamis good right now?"
```bash
curl "http://localhost:8000/api/surf-spots/swamis/conditions"
# Returns: 7.2/10 (Good) 🟢
```