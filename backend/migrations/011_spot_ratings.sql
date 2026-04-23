-- Pre-baked spot ratings: one row per spot, refreshed by jobs/rate_spots.py
-- Apply with: paste into Supabase SQL editor or supabase db push

CREATE TABLE IF NOT EXISTS public.spot_ratings (
    spot_slug          text PRIMARY KEY REFERENCES public.spots(slug) ON DELETE CASCADE,
    rating             numeric(3,1) NOT NULL CHECK (rating >= 0 AND rating <= 5),
    primary_swell_ft   numeric(4,1),
    primary_period_s   numeric(4,1),
    primary_swell_dir  smallint,
    wind_mph           numeric(4,1),
    wind_dir           smallint,
    water_temp_f       numeric(4,1),
    computed_at        timestamptz NOT NULL DEFAULT now(),
    forecast_hour      smallint NOT NULL DEFAULT 0,
    source             text NOT NULL       -- 'buoy' | 'openmeteo' | 'blended'
);

CREATE INDEX IF NOT EXISTS idx_spot_ratings_rating
    ON public.spot_ratings (rating DESC);

CREATE INDEX IF NOT EXISTS idx_spot_ratings_computed_at
    ON public.spot_ratings (computed_at DESC);

-- RLS: public read (map needs it unauthenticated), write only via service role
ALTER TABLE public.spot_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spot_ratings_public_read" ON public.spot_ratings
    FOR SELECT USING (true);

COMMENT ON TABLE public.spot_ratings IS
    'Pre-baked surf ratings refreshed by rate_spots.py. One row per spot.';
