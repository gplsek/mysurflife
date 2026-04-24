-- Migration: Allow public reads on ai_spot_analysis
-- RLS was enabled on this table but no SELECT policy existed,
-- causing all reads via the anon client to return empty.
-- AI analyses contain no PII — public read is correct.

ALTER TABLE ai_spot_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_spot_analysis_public_read" ON ai_spot_analysis;

CREATE POLICY "ai_spot_analysis_public_read"
    ON ai_spot_analysis
    FOR SELECT
    USING (true);
