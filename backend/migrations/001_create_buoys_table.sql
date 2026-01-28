-- Create buoys table
CREATE TABLE IF NOT EXISTS buoys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    wind_fallback_station TEXT,
    region TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for geographic queries
CREATE INDEX IF NOT EXISTS idx_buoys_location ON buoys(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_buoys_region ON buoys(region);

-- Enable Row Level Security
ALTER TABLE buoys ENABLE ROW LEVEL SECURITY;

-- Allow public read access (buoys are public data)
CREATE POLICY "Allow public read access" ON buoys
    FOR SELECT USING (true);

-- Optional: Allow authenticated users to suggest updates
-- CREATE POLICY "Allow authenticated updates" ON buoys
--     FOR UPDATE USING (auth.role() = 'authenticated');

COMMENT ON TABLE buoys IS 'NDBC buoy stations along the Pacific Coast';
COMMENT ON COLUMN buoys.id IS 'NDBC station ID (e.g., 46266)';
COMMENT ON COLUMN buoys.wind_fallback_station IS 'NOS CO-OPS station ID for wind data fallback';
COMMENT ON COLUMN buoys.region IS 'Geographic region (Southern CA, Central CA, Northern CA, Pacific Northwest, Hawaii, Offshore)';
COMMENT ON COLUMN buoys.active IS 'Whether buoy is currently active and should be displayed';