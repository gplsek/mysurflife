-- Migration 019: storm LLM analysis + precomputed map snapshot
-- See notes/STORM_LLM_ANALYSIS_PLAN.md (Phase 1).
-- Safe to re-run (idempotent).
--
-- Two additions:
--   1. derived_storms gets precomputed-analysis columns. The 6h detection job
--      writes a Sonnet-generated trajectory narrative + a structured region
--      timeline (top regions over the forecast), regenerated only when a storm
--      changes materially (gated by analysis_input_hash). Card/detail + Sione
--      read these — zero LLM at request time.
--   2. storm_snapshot: a single finished JSONB list the job builds (detect +
--      reconcile + land-mask), so /api/storms/active is a pure read instead of
--      recomputing bulletins + reconciliation on every request.

-- ── 1. Precomputed analysis columns on derived_storms ────────────────────────

ALTER TABLE public.derived_storms
    ADD COLUMN IF NOT EXISTS analysis_text          text,        -- Sonnet trajectory narrative
    ADD COLUMN IF NOT EXISTS region_timeline        jsonb,       -- [{region, arrival_hours, peak_hours, size_ft, period_s, dir_deg, tier}]
    ADD COLUMN IF NOT EXISTS analysis_generated_at  timestamptz, -- when analysis_text was produced
    ADD COLUMN IF NOT EXISTS analysis_model         text,        -- e.g. 'claude-sonnet-4-6'
    ADD COLUMN IF NOT EXISTS analysis_input_hash    text;        -- change gate: skip LLM if unchanged

-- ── 2. Precomputed map snapshot (single row) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.storm_snapshot (
    id          text PRIMARY KEY DEFAULT 'current',  -- always the one current row
    storms      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- finished /api/storms/active payload
    count       int NOT NULL DEFAULT 0,
    updated_at  timestamptz,                          -- bulletin freshness (max issued_utc)
    built_at    timestamptz NOT NULL DEFAULT now()    -- when the job assembled this snapshot
);

-- RLS: public read, no public write (writes via service-role from the backend job)
ALTER TABLE public.storm_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "storm_snapshot_public_read" ON public.storm_snapshot;
CREATE POLICY "storm_snapshot_public_read" ON public.storm_snapshot
    FOR SELECT USING (true);
