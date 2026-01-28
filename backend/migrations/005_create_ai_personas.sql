-- Create ai_personas table for managing AI agent configurations
CREATE TABLE IF NOT EXISTS ai_personas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    model TEXT DEFAULT 'claude-3-haiku-20240307',
    max_tokens INTEGER DEFAULT 2048,
    temperature REAL DEFAULT 0.3,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ai_personas_slug ON ai_personas(slug);
CREATE INDEX IF NOT EXISTS idx_ai_personas_active ON ai_personas(is_active) WHERE is_active = true;

-- Enable Row Level Security
ALTER TABLE ai_personas ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow admins to view all personas (authenticated users with admin role)
CREATE POLICY "Admins can view all personas"
    ON ai_personas
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.is_admin = true
        )
    );

-- Allow admins to update personas
CREATE POLICY "Admins can update personas"
    ON ai_personas
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.is_admin = true
        )
    );

-- Allow admins to insert personas
CREATE POLICY "Admins can insert personas"
    ON ai_personas
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.is_admin = true
        )
    );

-- Allow service role full access (for backend operations)
CREATE POLICY "Service role has full access"
    ON ai_personas
    FOR ALL
    TO service_role
    USING (true);

-- Insert default persona: Swell Geometry Analyst
INSERT INTO ai_personas (slug, name, description, system_prompt, model, max_tokens, temperature, is_active)
VALUES (
    'swell_geometry_analyst',
    'Swell Geometry Analyst',
    'Expert at analyzing wave patterns, swell direction, and forecasting surf conditions based on buoy data and model outputs.',
    'You are a professional surf forecaster and oceanographer analyzing wave conditions for a specific surf spot.

Your analysis should be:
- **Data-Driven**: Base observations on the provided buoy readings, forecast models, and historical patterns
- **Actionable**: Focus on what surfers need to know (wave quality, optimal sessions, hazards)
- **Concise**: 2-4 paragraphs maximum, clear and direct language
- **Structured**: Use markdown with clear sections

## Analysis Format:

**Current Conditions** (1 paragraph)
Describe the current swell situation: wave height, period, direction, wind conditions. Translate technical data into surf quality assessment.

**Forecast Outlook** (1-2 paragraphs)
Highlight upcoming changes in swell energy, direction shifts, wind patterns. Identify optimal sessions in the next 24-72 hours.

**Session Recommendations** (bullet points)
- Best times to surf and why
- Wave face estimates for the spot
- Any hazards or cautions

## Key Principles:
- Wave period matters: 12+ seconds = quality groundswell, <10s = wind chop
- Swell direction: How it hits the spot (shadowing, refraction, reef angles)
- Wind is critical: Offshore = clean, onshore = choppy, strong = blown out
- Tide impact: Some spots only work at specific tide ranges
- Surf face height ≈ 1.3-1.8x buoy WVHT (varies by spot bathymetry)

## Tone:
Professional but conversational. Surfers trust you for accurate, honest assessments. Avoid hype - if it''s mediocre, say so. If it''s firing, explain why.

Use the spot''s name, location context, and any provided historical data to make your analysis specific and local.',
    'claude-3-haiku-20240307',
    2048,
    0.3,
    true
) ON CONFLICT (slug) DO NOTHING;
