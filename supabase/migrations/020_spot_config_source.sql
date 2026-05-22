-- Migration 020: provenance for spot swell/wind windows (A2 config generator).
-- See notes/SPOT_CONFIG_EDITOR_PLAN.md.
-- Safe to re-run (idempotent).
--
-- `source` distinguishes generated config from hand-tuned:
--   'human' (default) | 'geo' (coastline-derived) | 'llm' (model-proposed)
-- The generator only writes/overwrites non-human rows, so human edits always win.

ALTER TABLE public.spot_wind_windows
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'human';

ALTER TABLE public.spot_swell_windows
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'human';
