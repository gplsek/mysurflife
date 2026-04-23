-- Migration: Create AI Spot Analysis table
-- Stores AI-generated swell geometry analysis for surf spots

CREATE TABLE IF NOT EXISTS ai_spot_analysis (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Link to buoy/spot
    buoy_id TEXT NOT NULL,
    spot_name TEXT NOT NULL,
    latitude DECIMAL(10, 6) NOT NULL,
    longitude DECIMAL(10, 6) NOT NULL,

    -- AI Analysis Results (JSONB for flexibility)
    analysis_data JSONB NOT NULL,

    -- Metadata
    persona_type TEXT NOT NULL DEFAULT 'swell_geometry_analyst',
    model_used TEXT NOT NULL, -- e.g., 'claude-3-5-sonnet', 'gpt-4-turbo'
    analysis_version TEXT NOT NULL DEFAULT '1.0',

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Status
    status TEXT NOT NULL DEFAULT 'active', -- active, archived, superseded

    -- Quality metrics (optional)
    user_feedback_rating INTEGER, -- 1-5 stars
    user_feedback_notes TEXT,

    -- Indexes for fast lookup
    CONSTRAINT unique_buoy_analysis UNIQUE (buoy_id, persona_type, status)
);

-- Create indexes
CREATE INDEX idx_ai_spot_analysis_buoy_id ON ai_spot_analysis(buoy_id);
CREATE INDEX idx_ai_spot_analysis_persona_type ON ai_spot_analysis(persona_type);
CREATE INDEX idx_ai_spot_analysis_created_at ON ai_spot_analysis(created_at DESC);
CREATE INDEX idx_ai_spot_analysis_status ON ai_spot_analysis(status);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_ai_spot_analysis_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_spot_analysis_updated_at
    BEFORE UPDATE ON ai_spot_analysis
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_spot_analysis_updated_at();

-- Add comments for documentation
COMMENT ON TABLE ai_spot_analysis IS 'AI-generated surf spot analysis including swell geometry, shadows, and optimal conditions';
COMMENT ON COLUMN ai_spot_analysis.analysis_data IS 'JSONB containing primary_windows, shadow_zones, partial_blockage, optimal_swell, and summary';
COMMENT ON COLUMN ai_spot_analysis.persona_type IS 'Type of AI persona: swell_geometry_analyst, conditions_interpreter, session_optimizer, wind_quality_analyst';
COMMENT ON COLUMN ai_spot_analysis.analysis_version IS 'Version number for tracking prompt/algorithm changes';