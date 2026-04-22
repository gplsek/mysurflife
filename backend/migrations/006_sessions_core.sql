-- Migration 006: Core sessions, favorites, spot profiles, and session-photos storage
-- Canonical copy lives here; supabase/migrations/001_sessions_core.sql is the Supabase CLI copy.
--
-- Creates:
--   public.sessions               — surf session journal
--   public.user_favorites         — per-user favorited spots
--   public.user_spot_profiles     — derived preference model (computed by backend job)
--   public.session_deltas         — view: buoy vs perceived vs forecast deltas
--   storage bucket: session-photos
--
-- Rollback: see bottom of file


-- ============================================================
-- 0. SHARED UTILITY: touch_updated_at trigger function
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1. SESSIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Identity
    spot_id         TEXT NOT NULL,
    spot_name       TEXT NOT NULL,
    session_date    DATE NOT NULL,
    start_time      TIME,
    duration_min    INTEGER CHECK (duration_min > 0 AND duration_min < 1440),

    -- Source buoys (stored to re-derive actual_* if algorithm changes)
    primary_buoy_id     TEXT,
    offshore_buoy_id    TEXT,

    -- ACTUAL conditions (auto-populated from buoy history by backend job)
    actual_wvht_ft      NUMERIC(4,1),
    actual_dpd_s        NUMERIC(4,1),
    actual_mwd_deg      INTEGER CHECK (actual_mwd_deg BETWEEN 0 AND 360),
    actual_wspd_mph     NUMERIC(4,1),
    actual_wdir_deg     INTEGER CHECK (actual_wdir_deg BETWEEN 0 AND 360),
    actual_tide_state   TEXT CHECK (actual_tide_state IN (
                            'low', 'rising_low', 'mid', 'rising_high', 'high', 'falling'
                        )),
    actual_tide_ft      NUMERIC(4,1),
    actual_water_temp_f NUMERIC(4,1),
    actual_populated_at TIMESTAMPTZ,

    -- PERCEIVED conditions (user input — 4 post-session questions)
    perceived_size      TEXT CHECK (perceived_size IN (
                            'knee', 'waist', 'chest', 'shoulder',
                            'head', 'overhead', 'doh', 'toh', 'plus'
                        )),
    perceived_dir_deg   INTEGER CHECK (perceived_dir_deg BETWEEN 0 AND 360),
    perceived_quality   SMALLINT CHECK (perceived_quality BETWEEN 1 AND 10),
    perceived_wind      TEXT CHECK (perceived_wind IN (
                            'glassy', 'light_offshore', 'offshore',
                            'light_onshore', 'onshore', 'howling'
                        )),
    perceived_crowd     SMALLINT CHECK (perceived_crowd BETWEEN 1 AND 5),
    perceived_note      TEXT,

    -- FORECAST snapshot (captured at session_date-1 ~18:00 for accuracy measurement)
    forecast_wvht_ft    NUMERIC(4,1),
    forecast_dpd_s      NUMERIC(4,1),
    forecast_mwd_deg    INTEGER CHECK (forecast_mwd_deg BETWEEN 0 AND 360),
    forecast_wspd_mph   NUMERIC(4,1),
    forecast_wdir_deg   INTEGER CHECK (forecast_wdir_deg BETWEEN 0 AND 360),
    forecast_model      TEXT,
    forecast_snapped_at TIMESTAMPTZ,

    -- Equipment
    board_display       TEXT,
    wetsuit_mm          NUMERIC(3,1),

    -- Outcomes
    waves_caught        INTEGER CHECK (waves_caught >= 0),
    best_wave_note      TEXT,

    -- Photos (store paths, not URLs — compute signed URLs at read time)
    photo_paths         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    -- Log metadata
    log_method          TEXT NOT NULL DEFAULT 'manual'
                            CHECK (log_method IN ('manual', 'copilot', 'import')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT spot_id_format CHECK (spot_id ~ '^[a-z0-9][a-z0-9\-]{0,63}$')
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_date
    ON public.sessions (user_id, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_spot
    ON public.sessions (spot_id);

CREATE INDEX IF NOT EXISTS idx_sessions_user_spot_date
    ON public.sessions (user_id, spot_id, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_user_quality
    ON public.sessions (user_id, perceived_quality)
    WHERE perceived_quality IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_unpopulated
    ON public.sessions (created_at)
    WHERE actual_populated_at IS NULL;

DROP TRIGGER IF EXISTS sessions_touch_updated_at ON public.sessions;
CREATE TRIGGER sessions_touch_updated_at
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own sessions" ON public.sessions;
CREATE POLICY "Users read own sessions"
    ON public.sessions FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own sessions" ON public.sessions;
CREATE POLICY "Users insert own sessions"
    ON public.sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own sessions" ON public.sessions;
CREATE POLICY "Users update own sessions"
    ON public.sessions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own sessions" ON public.sessions;
CREATE POLICY "Users delete own sessions"
    ON public.sessions FOR DELETE
    USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT ALL ON public.sessions TO service_role;


-- ============================================================
-- 2. USER_FAVORITES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_favorites (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spot_id     TEXT NOT NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sort_order  INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (user_id, spot_id),
    CONSTRAINT fav_spot_id_format CHECK (spot_id ~ '^[a-z0-9][a-z0-9\-]{0,63}$')
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_order
    ON public.user_favorites (user_id, sort_order);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own favorites" ON public.user_favorites;
CREATE POLICY "Users manage own favorites"
    ON public.user_favorites FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_favorites TO authenticated;
GRANT ALL ON public.user_favorites TO service_role;


-- ============================================================
-- 3. USER_SPOT_PROFILES TABLE
-- Computed from session history by backend job.
-- Never edited directly by users.
-- One row per (user, spot). Created only once >= 3 sessions logged.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_spot_profiles (
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spot_id             TEXT NOT NULL,
    session_count       INTEGER NOT NULL DEFAULT 0,

    avg_quality         NUMERIC(3,1),
    avg_quality_good    NUMERIC(3,1),

    sweet_wvht_min_ft   NUMERIC(4,1),
    sweet_wvht_max_ft   NUMERIC(4,1),
    sweet_dpd_min_s     NUMERIC(4,1),
    sweet_dpd_max_s     NUMERIC(4,1),
    sweet_mwd_deg       INTEGER,
    sweet_mwd_spread    INTEGER,
    preferred_tide      TEXT,
    preferred_wind      TEXT,

    size_perception_bias    NUMERIC(4,2),
    dir_perception_offset   INTEGER,

    forecast_wvht_mae_ft    NUMERIC(4,2),
    forecast_dpd_mae_s      NUMERIC(4,2),

    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, spot_id),
    CONSTRAINT profile_spot_id_format CHECK (spot_id ~ '^[a-z0-9][a-z0-9\-]{0,63}$')
);

ALTER TABLE public.user_spot_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own profiles" ON public.user_spot_profiles;
CREATE POLICY "Users read own profiles"
    ON public.user_spot_profiles FOR SELECT
    USING (auth.uid() = user_id);

GRANT SELECT ON public.user_spot_profiles TO authenticated;
GRANT ALL ON public.user_spot_profiles TO service_role;


-- ============================================================
-- 4. SESSION_DELTAS VIEW
-- ============================================================

CREATE OR REPLACE VIEW public.session_deltas AS
SELECT
    s.id,
    s.user_id,
    s.spot_id,
    s.spot_name,
    s.session_date,
    s.start_time,
    s.log_method,

    s.perceived_size,
    s.actual_wvht_ft,

    s.perceived_dir_deg,
    s.actual_mwd_deg,
    CASE
        WHEN (s.perceived_dir_deg - s.actual_mwd_deg) > 180
            THEN (s.perceived_dir_deg - s.actual_mwd_deg) - 360
        WHEN (s.perceived_dir_deg - s.actual_mwd_deg) < -180
            THEN (s.perceived_dir_deg - s.actual_mwd_deg) + 360
        ELSE (s.perceived_dir_deg - s.actual_mwd_deg)
    END AS swell_dir_delta_deg,

    s.perceived_quality,
    s.actual_wvht_ft    AS cond_wvht_ft,
    s.actual_dpd_s      AS cond_dpd_s,
    s.actual_mwd_deg    AS cond_mwd_deg,
    s.actual_tide_state AS cond_tide,
    s.perceived_wind    AS cond_wind_perceived,

    s.forecast_wvht_ft,
    s.forecast_dpd_s,
    s.forecast_model,
    ROUND((s.actual_wvht_ft - s.forecast_wvht_ft)::NUMERIC, 2) AS forecast_wvht_error_ft,
    ROUND((s.actual_dpd_s  - s.forecast_dpd_s)::NUMERIC,  2) AS forecast_dpd_error_s

FROM public.sessions s
WHERE
    s.actual_populated_at IS NOT NULL
    AND s.perceived_quality IS NOT NULL;


-- ============================================================
-- 5. STORAGE: session-photos bucket
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'session-photos',
    'session-photos',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users read own session photos"       ON storage.objects;
DROP POLICY IF EXISTS "Users upload to own session folder"  ON storage.objects;
DROP POLICY IF EXISTS "Users delete own session photos"     ON storage.objects;

CREATE POLICY "Users read own session photos"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'session-photos'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users upload to own session folder"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'session-photos'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users delete own session photos"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'session-photos'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );


-- ============================================================
-- ROLLBACK (save separately as 006_sessions_core_rollback.sql)
-- ============================================================
--
-- DROP VIEW  IF EXISTS public.session_deltas CASCADE;
-- DROP TABLE IF EXISTS public.user_spot_profiles CASCADE;
-- DROP TABLE IF EXISTS public.user_favorites CASCADE;
-- DROP TABLE IF EXISTS public.sessions CASCADE;
-- DROP FUNCTION IF EXISTS public.touch_updated_at CASCADE;
--
-- DELETE FROM storage.objects WHERE bucket_id = 'session-photos';
-- DELETE FROM storage.buckets WHERE id = 'session-photos';
--
-- DROP POLICY IF EXISTS "Users read own session photos"       ON storage.objects;
-- DROP POLICY IF EXISTS "Users upload to own session folder"  ON storage.objects;
-- DROP POLICY IF EXISTS "Users delete own session photos"     ON storage.objects;
