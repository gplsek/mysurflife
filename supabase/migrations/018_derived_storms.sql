-- Migration 018: derived_storms — primary durable store for model-detected storms.
-- Replaces the in-memory _model_storms_cache as the persistent source.
-- /api/storms/active continues to read the cache (fast path);
-- /api/storms/{id}/detail reads from this table (survives restarts).

CREATE TABLE IF NOT EXISTS public.derived_storms (
    storm_id                    text PRIMARY KEY,
    source                      text NOT NULL,                       -- 'model' | 'bulletin' | 'reconciled'
    bulletin_storm_id           text,
    detected_at                 timestamptz NOT NULL,
    current_lat                 double precision NOT NULL,
    current_lon                 double precision NOT NULL,
    current_pressure_mb         int,
    peak_wind_kts               int,
    warning_tier                text,
    basin_label                 text,
    is_deepening                boolean,
    intensification_rate_mb_per_6h real,
    peak_intensity_hour         int,
    will_make_landfall          boolean,
    landfall_eta_hours          int,
    landfall_before_peak        boolean,
    forecast_track              jsonb NOT NULL DEFAULT '[]'::jsonb,
    fetch_quadrants             jsonb NOT NULL DEFAULT '{}'::jsonb,
    peak_sea_m                  real,
    peak_period_s               real,
    swell_direction_deg         real,
    max_cone_hs_m               real,
    confirmation_status         text,
    region_impacts              jsonb,
    narrative                   text,
    raw_bulletin_text           text,
    expires_at                  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_derived_storms_expires
    ON public.derived_storms (expires_at);

CREATE INDEX IF NOT EXISTS idx_derived_storms_position
    ON public.derived_storms (current_lat, current_lon);

CREATE INDEX IF NOT EXISTS idx_derived_storms_source
    ON public.derived_storms (source);

-- RLS: public read, no public write (writes via service-role from backend job)
ALTER TABLE public.derived_storms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "derived_storms_public_read" ON public.derived_storms;
CREATE POLICY "derived_storms_public_read" ON public.derived_storms
    FOR SELECT USING (true);
