-- Migration: Update AI Spot Analysis to work with surf spots (not buoys)
-- Links analysis to spots table and adds spot-specific fields

-- Drop old unique constraint
ALTER TABLE ai_spot_analysis DROP CONSTRAINT IF EXISTS unique_buoy_analysis;

-- Drop misspelled constraint if it exists
ALTER TABLE ai_spot_analysis DROP CONSTRAINT IF EXISTS unique_spot_analusis;

-- Make buoy_id nullable (no longer required for spot-based analyses)
ALTER TABLE ai_spot_analysis ALTER COLUMN buoy_id DROP NOT NULL;

-- Add spot_id foreign key
ALTER TABLE ai_spot_analysis ADD COLUMN IF NOT EXISTS spot_id UUID REFERENCES spots(id) ON DELETE CASCADE;

-- Create new unique constraint for spot-based analysis
ALTER TABLE ai_spot_analysis DROP CONSTRAINT IF EXISTS unique_spot_analysis;
ALTER TABLE ai_spot_analysis ADD CONSTRAINT unique_spot_analysis UNIQUE (spot_id, persona_type, status);

-- Create index on spot_id
CREATE INDEX IF NOT EXISTS idx_ai_spot_analysis_spot_id ON ai_spot_analysis(spot_id);

-- Update comments
COMMENT ON COLUMN ai_spot_analysis.spot_id IS 'Foreign key to spots table - the actual surf spot being analyzed';
COMMENT ON COLUMN ai_spot_analysis.buoy_id IS 'Reference buoy ID (kept for backward compatibility)';

-- Note: buoy_id and related fields kept for backward compatibility
-- New analyses should use spot_id + spot_name