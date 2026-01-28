# Surf Spots Feature - Implementation Plan

## Overview

Add surf spot database with detailed conditions, optimal swell/wind, hazards, and real-time surf quality scoring based on nearby buoy data.

**Data Source**: Wannasurf.com (San Diego County: 114 spots)
- Index: https://wannasurf.com/spot/North_America/USA/California/San_Diego_County/index.html
- Detail pages follow pattern: `/spot/.../[spot_name_lowercase]/index.html`

## Database Schema

### Table: `surf_spots`

```sql
CREATE TABLE surf_spots (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,  -- URL-friendly: "blacks_beach"
    name TEXT NOT NULL,  -- Display name: "Blacks Beach"

    -- Location
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    region TEXT NOT NULL,  -- "San Diego County", "Orange County", etc.
    location_description TEXT,  -- "Below Torrey Pines Glider Port"
    access_description TEXT,  -- How to get there

    -- Wave Characteristics
    wave_type TEXT,  -- "Beach-break", "Point-break", "Reef-rocky", "Jetty"
    wave_direction TEXT,  -- "Right", "Left", "Right/Left"
    bottom_type TEXT,  -- "Sandy", "Rocks", "Reef", "Sand-bar"
    wave_power TEXT,  -- "Hollow", "Fast", "Powerful", "Mellow"
    normal_length_m INTEGER,  -- Average ride length in meters
    good_day_length_m INTEGER,  -- Max ride length on good days

    -- Optimal Conditions
    best_swell_direction TEXT,  -- "Northwest, West, Southwest"
    best_wind_direction TEXT,  -- "East", "Offshore", etc.
    best_tide TEXT,  -- "Low", "Mid", "High", "Low-Mid", "All"
    optimal_swell_min_m REAL,  -- Minimum swell height (meters)
    optimal_swell_max_m REAL,  -- Maximum swell height (meters)

    -- Experience & Safety
    skill_level TEXT NOT NULL,  -- "Beginners", "All surfers", "Experienced", "Pros only"
    wave_quality TEXT,  -- "World Class", "Good", "Fun", "Mediocre"
    hazards TEXT[],  -- Array: ["Rocks", "Rip currents", "Localism", "Sharks"]
    crowd_level TEXT,  -- "Empty", "Uncrowded", "Crowded", "Ultra crowded"

    -- Metadata
    description TEXT,  -- Full description/overview
    parking_info TEXT,
    facilities TEXT[],  -- ["Parking", "Showers", "Bathrooms", "Lifeguard"]
    source_url TEXT,  -- Wannasurf detail page

    -- Relationships
    primary_buoy_id TEXT,  -- REFERENCES buoys(id) - Closest buoy for conditions
    secondary_buoy_ids TEXT[],  -- Other relevant buoys

    -- Status
    active BOOLEAN DEFAULT true,
    verified BOOLEAN DEFAULT false,  -- Manual verification flag
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_surf_spots_location ON surf_spots(latitude, longitude);
CREATE INDEX idx_surf_spots_region ON surf_spots(region);
CREATE INDEX idx_surf_spots_skill ON surf_spots(skill_level);
CREATE INDEX idx_surf_spots_slug ON surf_spots(slug);
CREATE INDEX idx_surf_spots_buoy ON surf_spots(primary_buoy_id);

-- RLS
ALTER TABLE surf_spots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON surf_spots
    FOR SELECT USING (active = true);
```

### Table: `surf_conditions_log` (Future)

For storing historical surf quality scores:

```sql
CREATE TABLE surf_conditions_log (
    id BIGSERIAL PRIMARY KEY,
    spot_id INTEGER REFERENCES surf_spots(id),
    timestamp TIMESTAMPTZ NOT NULL,

    -- Conditions at time of logging
    wave_height_m REAL,
    wave_period_sec REAL,
    wave_direction INTEGER,
    wind_speed_ms REAL,
    wind_direction INTEGER,

    -- Calculated scores (0-10)
    swell_score REAL,  -- How close to optimal swell
    wind_score REAL,  -- How good is wind direction
    size_score REAL,  -- Is size in optimal range
    overall_score REAL,  -- Combined score

    -- Source buoy
    buoy_id TEXT NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conditions_spot_time ON surf_conditions_log(spot_id, timestamp DESC);
```

## Data Collection Strategy

### Phase 1: Semi-Automated Scraping (Initial Load)

1. **Build scraper** to parse Wannasurf index and detail pages
2. **Extract structured data** for all 114 San Diego spots
3. **Manual review** of extracted data (verify coordinates, clean descriptions)
4. **Bulk import** to Supabase via migration script

### Phase 2: Manual Curation (Ongoing)

1. **Add local knowledge**: Best times, secret spots, local tips
2. **Map to buoys**: Assign primary/secondary buoys for each spot
3. **Update conditions**: Seasonal variations, recent changes
4. **Add photos**: User-submitted or curated images

### Phase 3: Community Contributions (Future)

1. **User submissions**: Add new spots, update conditions
2. **Ratings & reviews**: User feedback on accuracy
3. **Session logs**: "Surfed here today, waves were 6/10"

## Spot-to-Buoy Mapping

Critical for real-time conditions scoring:

```python
SPOT_BUOY_MAPPING = {
    "blacks_beach": {
        "primary": "46225",  # Torrey Pines Outer
        "secondary": ["46266", "46232"],  # Del Mar, Point Loma
        "swell_weight": 0.8,  # How much to trust buoy vs model
    },
    "swamis": {
        "primary": "46224",  # Oceanside Offshore
        "secondary": ["46225", "46275"],
        "swell_weight": 0.9,
    },
    "windansea": {
        "primary": "46225",
        "secondary": ["46266"],
        "swell_weight": 0.85,
    },
    # ... etc for all spots
}
```

## Backend API Endpoints

### Core Endpoints

```python
# Get all surf spots (with filters)
GET /api/surf-spots
Query params:
  - region: "San Diego County"
  - skill_level: "Beginners" | "All surfers" | "Experienced" | "Pros only"
  - wave_type: "Beach-break" | "Point-break" | "Reef-rocky"
  - min_score: 0-10 (current conditions score)
  - bounds: lat/lon bounding box (for map viewport)

# Get single spot details
GET /api/surf-spots/{slug}
Returns: Full spot details + current conditions from nearby buoy(s)

# Get current conditions for spot
GET /api/surf-spots/{slug}/conditions
Returns: Real-time surf quality score based on buoy data

# Get spot recommendations (future)
GET /api/surf-spots/recommendations
Query params:
  - skill_level: User's skill level
  - max_distance_km: Range from user location
  - min_score: Minimum quality score
Returns: Top 5 spots surfing best right now
```

### Conditions Scoring Algorithm

```python
def calculate_surf_score(spot: Dict, buoy_data: Dict) -> Dict:
    """
    Calculate real-time surf quality score (0-10) for a spot.

    Factors:
    1. Swell direction match (0-3 points)
    2. Swell size in optimal range (0-3 points)
    3. Wind direction offshore (0-2 points)
    4. Wind speed light (0-2 points)
    """

    # 1. Swell direction score
    buoy_dir = buoy_data['mean_wave_dir']
    optimal_dirs = parse_directions(spot['best_swell_direction'])
    dir_score = calculate_direction_match(buoy_dir, optimal_dirs)

    # 2. Swell size score
    wave_height = buoy_data['wave_height_m']
    size_score = 0
    if spot['optimal_swell_min_m'] <= wave_height <= spot['optimal_swell_max_m']:
        size_score = 3.0
    elif wave_height < spot['optimal_swell_min_m']:
        size_score = (wave_height / spot['optimal_swell_min_m']) * 3.0
    else:  # Too big
        size_score = max(0, 3.0 - (wave_height - spot['optimal_swell_max_m']))

    # 3. Wind direction score (offshore is best)
    wind_dir = buoy_data.get('wind_dir')
    if wind_dir:
        wind_score = calculate_wind_score(wind_dir, spot['best_wind_direction'])
    else:
        wind_score = 1.0  # Neutral if no wind data

    # 4. Wind speed score (light is best)
    wind_speed = buoy_data.get('wind_speed_ms', 0)
    speed_score = max(0, 2.0 - (wind_speed / 5.0))  # < 5 m/s is ideal

    total_score = dir_score + size_score + wind_score + speed_score

    return {
        "overall_score": round(total_score, 1),
        "swell_direction_score": dir_score,
        "swell_size_score": size_score,
        "wind_direction_score": wind_score,
        "wind_speed_score": speed_score,
        "rating": get_rating_text(total_score),  # "Epic", "Good", "Fair", "Poor"
        "buoy_id": buoy_data['station'],
        "timestamp": datetime.now().isoformat()
    }

def get_rating_text(score: float) -> str:
    if score >= 8.5: return "Epic"
    if score >= 7.0: return "Good"
    if score >= 5.0: return "Fair"
    if score >= 3.0: return "Poor"
    return "Flat"
```

## Frontend Integration

### Map Display

1. **Surf spot markers** (different icon from buoys)
   - Color-coded by current score: 🟢 Epic, 🟡 Good, 🟠 Fair, 🔴 Poor
   - Click to show spot details panel

2. **Spot details panel** (similar to buoy details)
   - Spot name, type, skill level
   - Current conditions score with breakdown
   - Optimal conditions reference
   - Link to full detail page

3. **Filters**
   - Skill level filter (show only spots I can surf)
   - Score filter (only show spots scoring 6+)
   - Wave type filter

### New Views

1. **Spot Directory Page** (`/spots`)
   - List/grid view of all spots
   - Sort by: score, distance, name, skill level
   - Filters by region, type, skill

2. **Spot Detail Page** (`/spots/{slug}`)
   - Full spot information
   - Current conditions chart (like buoy history)
   - Nearby buoys
   - Access/parking info
   - Hazards and safety info
   - User tips/comments (future)

3. **Daily Forecast** (future)
   - "Where should I surf today?"
   - Personalized recommendations based on skill
   - Timeline showing best time to go

## Scraping Implementation

### Script Structure

```python
# backend/scraping/wannasurf_scraper.py

import httpx
from bs4 import BeautifulSoup
import json
import re
from typing import List, Dict

async def scrape_san_diego_spots() -> List[Dict]:
    """Scrape all San Diego County surf spots from Wannasurf."""

    index_url = "https://wannasurf.com/spot/North_America/USA/California/San_Diego_County/index.html"

    # 1. Get index page
    async with httpx.AsyncClient() as client:
        response = await client.get(index_url)
        soup = BeautifulSoup(response.text, 'html.parser')

    # 2. Parse spot list
    spots = []
    for spot_link in soup.find_all('a', href=re.compile(r'/spot/.*index.html')):
        spot_name = spot_link.text.strip()
        spot_url = f"https://wannasurf.com{spot_link['href']}"

        # Fetch detail page
        spot_data = await scrape_spot_detail(spot_url, spot_name)
        spots.append(spot_data)

        # Be nice to the server
        await asyncio.sleep(1)

    return spots

async def scrape_spot_detail(url: str, name: str) -> Dict:
    """Scrape individual spot detail page."""

    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        soup = BeautifulSoup(response.text, 'html.parser')

    # Parse coordinates (format: "32° 52.775' N, 117° 15.23' W")
    coords_text = soup.find(text=re.compile(r'\d+°.*[NS].*\d+°.*[EW]'))
    lat, lon = parse_coordinates(coords_text)

    # Parse wave characteristics
    wave_type = extract_field(soup, "Type:")
    wave_direction = extract_field(soup, "Direction:")
    bottom_type = extract_field(soup, "Bottom:")

    # Parse optimal conditions
    best_swell = extract_field(soup, "Swell direction:")
    best_wind = extract_field(soup, "Wind direction:")
    best_tide = extract_field(soup, "Tide:")

    # Parse skill level
    skill_level = extract_field(soup, "Experience:")

    # Parse description
    description = extract_description(soup)

    return {
        "name": name,
        "slug": name.lower().replace(' ', '_').replace('.', ''),
        "latitude": lat,
        "longitude": lon,
        "wave_type": wave_type,
        "wave_direction": wave_direction,
        "bottom_type": bottom_type,
        "best_swell_direction": best_swell,
        "best_wind_direction": best_wind,
        "best_tide": best_tide,
        "skill_level": skill_level,
        "description": description,
        "source_url": url,
        "region": "San Diego County"
    }
```

### Migration Script

```python
# backend/migrations/002_load_surf_spots.py

from scraping.wannasurf_scraper import scrape_san_diego_spots
from database import get_supabase_admin_client
import asyncio

async def migrate_surf_spots():
    """Scrape and load surf spots into database."""

    admin = get_supabase_admin_client()
    if not admin:
        print("❌ Need admin credentials")
        return

    print("🏄 Scraping San Diego surf spots from Wannasurf...")
    spots = await scrape_san_diego_spots()

    print(f"✅ Scraped {len(spots)} spots")

    # Load to database
    result = admin.table("surf_spots").upsert(spots).execute()

    print(f"✅ Loaded {len(result.data)} spots to database")

    # Summary by wave type
    types = {}
    for spot in spots:
        t = spot['wave_type']
        types[t] = types.get(t, 0) + 1

    print("\n📊 Spots by type:")
    for wave_type, count in sorted(types.items()):
        print(f"  {wave_type}: {count}")

if __name__ == "__main__":
    asyncio.run(migrate_surf_spots())
```

## Implementation Phases

### Phase 1: Database & Scraping (Week 1)
- [ ] Create `surf_spots` table in Supabase
- [ ] Build Wannasurf scraper
- [ ] Scrape San Diego County spots (114 spots)
- [ ] Manual review and data cleaning
- [ ] Load to database

### Phase 2: Backend API (Week 1-2)
- [ ] Create `/api/surf-spots` endpoint
- [ ] Create `/api/surf-spots/{slug}` endpoint
- [ ] Implement conditions scoring algorithm
- [ ] Create `/api/surf-spots/{slug}/conditions` endpoint
- [ ] Map each spot to primary/secondary buoys

### Phase 3: Frontend - Map Integration (Week 2)
- [ ] Add surf spot markers to map
- [ ] Color-code by current score
- [ ] Click handler for spot details panel
- [ ] Add skill level filter
- [ ] Add score filter

### Phase 4: Frontend - Detail Pages (Week 3)
- [ ] Create `/spots` directory page
- [ ] Create `/spots/{slug}` detail page
- [ ] Show current conditions chart
- [ ] Display optimal conditions reference
- [ ] Show nearby buoys

### Phase 5: Enhancements (Future)
- [ ] Expand to Orange County, LA County
- [ ] Add tide data integration
- [ ] Add webcam feeds
- [ ] User ratings & reviews
- [ ] Session logging ("I surfed here today")
- [ ] Smart recommendations engine
- [ ] Push notifications ("Your favorite spot is firing!")

## Open Questions

1. **Scraping ethics**: Should we cache/store Wannasurf data or link to their site?
   - **Recommendation**: Store core data (coords, conditions), link to detail page for full info

2. **Buoy mapping**: Manual or automated?
   - **Recommendation**: Start with closest buoy automatically, allow manual override

3. **Score weights**: How much to weight each factor?
   - **Recommendation**: Start with equal weights, tune based on feedback

4. **Update frequency**: How often to recalculate scores?
   - **Recommendation**: Every 10 minutes (same as buoy cache)

5. **Regional expansion**: Beyond San Diego?
   - **Recommendation**: Start with San Diego (114 spots), expand to OC/LA once proven

## Success Metrics

1. **Database**: 100+ San Diego spots loaded with complete data
2. **Accuracy**: Spot scores match real conditions (validated by test sessions)
3. **Performance**: Spot list loads in < 500ms with scores
4. **Usability**: Users can find "best spot right now" in 2 clicks

## Next Steps

1. Review this plan - any changes/additions?
2. Create `surf_spots` table SQL
3. Build basic scraper for 5-10 sample spots
4. Manual review of scraped data quality
5. Once validated, scrape all 114 spots
6. Build API endpoints with scoring
7. Add to map UI