-- Migration 010: Storm observation history
-- Append-only table; one row per bulletin parse that finds a storm.
-- storm_key ties together re-parses of the same system across runs.

CREATE TABLE IF NOT EXISTS public.storm_observations (
    id             bigserial PRIMARY KEY,
    storm_key      text NOT NULL,          -- '{basin}-{round(lat,0)}-{round(lon,0)}'
    observed_utc   timestamptz NOT NULL,
    ocean          text,                   -- 'north-pacific' | 'north-atlantic' | 'south-pacific'
    lat            numeric(6,3),
    lon            numeric(7,3),
    type           text,
    pressure_mb    smallint,
    wind_kts       smallint,
    sea_height_ft  smallint,
    movement_dir   text,
    movement_kts   smallint,
    warning_tier   text,
    raw_entry      jsonb,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storm_obs_key_time
    ON public.storm_observations (storm_key, observed_utc DESC);

CREATE INDEX IF NOT EXISTS idx_storm_obs_ocean_time
    ON public.storm_observations (ocean, observed_utc DESC);
