-- Create surf spots core tables
-- Based on sophisticated schema with structured characteristics

-- 1. Core spots table (identity + location)
CREATE TABLE IF NOT EXISTS spots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,

    -- Geographic
    country TEXT DEFAULT 'USA',
    region TEXT NOT NULL,  -- "California"
    subregion TEXT,  -- "San Diego County"
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,

    -- Access & Description
    location_description TEXT,
    access_description TEXT,
    parking_info TEXT,

    -- Source attribution
    source TEXT DEFAULT 'manual',  -- manual, community, licensed_import
    source_url TEXT,

    -- Status
    is_published BOOLEAN DEFAULT true,
    verified BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Spot characteristics (structured surf data)
CREATE TABLE IF NOT EXISTS spot_characteristics (
    spot_id UUID PRIMARY KEY REFERENCES spots(id) ON DELETE CASCADE,

    -- Wave Type
    break_type TEXT,  -- beach, reef, point, river_mouth, jetty, mixed
    bottom_type TEXT,  -- sand, rock, reef, cobblestone, mixed
    wave_direction TEXT,  -- left, right, both, a_frame

    -- Wave Quality
    wave_power TEXT,  -- hollow, fast, powerful, mellow, fun
    normal_length_m INTEGER,  -- Average ride length
    good_day_length_m INTEGER,  -- Max ride on good days
    wave_quality TEXT,  -- world_class, regional_classic, good, fun

    -- Swell Preferences (as text for now, will parse to degrees)
    best_swell_direction TEXT,  -- "NW, W, SW"
    swell_exposure TEXT,  -- open_ocean, semi_exposed, protected
    works_from_swell_ft NUMERIC,  -- Minimum swell height
    works_to_swell_ft NUMERIC,  -- Maximum swell height

    -- Wind Preferences
    best_wind_direction TEXT,  -- "E, NE"
    max_onshore_mph INTEGER,  -- Max wind before blown out

    -- Tide Preferences
    tide_position TEXT,  -- low, mid, high, all
    tide_movement TEXT,  -- rising, falling, either

    -- Experience & Safety
    skill_level TEXT NOT NULL,  -- beginner, intermediate, experienced, expert, pros_only
    crowd_level TEXT,  -- empty, few, crowded, ultra_crowded
    consistency TEXT,  -- rare, regular, very_consistent
    consistency_days_per_year INTEGER,

    -- Hazards (array)
    hazards TEXT[],  -- ["rocks", "rips", "localism", "pollution"]

    -- Notes
    notes_internal TEXT,  -- Private notes
    notes_public TEXT,  -- Public description (our own words)

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Swell windows (multiple optimal swell directions per spot)
CREATE TABLE IF NOT EXISTS spot_swell_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spot_id UUID REFERENCES spots(id) ON DELETE CASCADE,

    -- Direction range in degrees (0-359)
    dir_min INTEGER NOT NULL CHECK (dir_min >= 0 AND dir_min < 360),
    dir_max INTEGER NOT NULL CHECK (dir_max >= 0 AND dir_max < 360),

    -- Period preferences
    period_min_sec INTEGER,  -- Minimum period for clean lines

    -- Weighting for scoring (1.0 = optimal, 0.5 = works but not ideal)
    weight NUMERIC DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1.0),

    -- Description
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Wind windows (multiple wind directions per spot)
CREATE TABLE IF NOT EXISTS spot_wind_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spot_id UUID REFERENCES spots(id) ON DELETE CASCADE,

    -- Direction range
    dir_min INTEGER NOT NULL CHECK (dir_min >= 0 AND dir_min < 360),
    dir_max INTEGER NOT NULL CHECK (dir_max >= 0 AND dir_max < 360),

    -- Max wind speed
    max_mph INTEGER,

    -- Category
    category TEXT,  -- ideal, tolerable, marginal
    weight NUMERIC DEFAULT 1.0,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Forecast tuning per spot (the secret sauce)
CREATE TABLE IF NOT EXISTS spot_forecast_tuning (
    spot_id UUID PRIMARY KEY REFERENCES spots(id) ON DELETE CASCADE,

    -- Buoy blending (JSONB for flexibility)
    buoy_blend JSONB NOT NULL,
    -- Example: {"46225": {"weight": 0.5, "role": "primary"}, "46266": {"weight": 0.3, "role": "secondary"}}

    -- Wave height multipliers
    hs_multiplier NUMERIC DEFAULT 1.0,  -- Does spot get bigger/smaller than buoy?
    tp_multiplier NUMERIC DEFAULT 1.0,  -- Period adjustment

    -- Direction tolerance
    direction_penalty_deg INTEGER DEFAULT 20,  -- How forgiving to off-angle swell

    -- Wind penalty curve (JSONB)
    wind_penalty_curve JSONB,
    -- Example: {"thresholds": [5, 10, 15], "penalties": [0, 0.2, 0.5, 1.0]}

    -- Confidence
    confidence_base NUMERIC DEFAULT 0.6 CHECK (confidence_base >= 0 AND confidence_base <= 1.0),

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_spots_location ON spots(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_spots_region ON spots(region, subregion);
CREATE INDEX IF NOT EXISTS idx_spots_slug ON spots(slug);

CREATE INDEX IF NOT EXISTS idx_characteristics_skill ON spot_characteristics(skill_level);
CREATE INDEX IF NOT EXISTS idx_characteristics_break_type ON spot_characteristics(break_type);

CREATE INDEX IF NOT EXISTS idx_swell_windows_spot ON spot_swell_windows(spot_id);
CREATE INDEX IF NOT EXISTS idx_wind_windows_spot ON spot_wind_windows(spot_id);

-- Row Level Security
ALTER TABLE spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_characteristics ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_swell_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_wind_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_forecast_tuning ENABLE ROW LEVEL SECURITY;

-- Public read access for published spots
CREATE POLICY "Allow public read published spots" ON spots
    FOR SELECT USING (is_published = true);

CREATE POLICY "Allow public read characteristics" ON spot_characteristics
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM spots WHERE spots.id = spot_characteristics.spot_id AND spots.is_published = true)
    );

CREATE POLICY "Allow public read swell windows" ON spot_swell_windows
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM spots WHERE spots.id = spot_swell_windows.spot_id AND spots.is_published = true)
    );

CREATE POLICY "Allow public read wind windows" ON spot_wind_windows
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM spots WHERE spots.id = spot_wind_windows.spot_id AND spots.is_published = true)
    );

CREATE POLICY "Allow public read tuning" ON spot_forecast_tuning
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM spots WHERE spots.id = spot_forecast_tuning.spot_id AND spots.is_published = true)
    );

-- Comments
COMMENT ON TABLE spots IS 'Surf spots with location and identity';
COMMENT ON TABLE spot_characteristics IS 'Structured surf characteristics for each spot';
COMMENT ON TABLE spot_swell_windows IS 'Multiple optimal swell direction windows per spot';
COMMENT ON TABLE spot_wind_windows IS 'Multiple optimal wind direction windows per spot';
COMMENT ON TABLE spot_forecast_tuning IS 'Forecast algorithm tuning parameters per spot';

COMMENT ON COLUMN spot_forecast_tuning.buoy_blend IS 'JSONB mapping of buoy IDs to weights for blended forecasts';
COMMENT ON COLUMN spot_forecast_tuning.hs_multiplier IS 'Multiplier for significant wave height (e.g., 1.1 if spot amplifies swell)';
COMMENT ON COLUMN spot_forecast_tuning.direction_penalty_deg IS 'Degrees off optimal before applying penalty';