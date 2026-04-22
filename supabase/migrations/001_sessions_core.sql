-- ============================================================
-- MySurfLife — Core Sessions Migration
-- File: supabase/migrations/001_sessions_core.sql
--
-- Creates:
--   public.sessions               — surf session journal
--   public.user_favorites         — per-user favorited spots
--   public.user_spot_profiles     — derived preference model (computed, not edited)
--   public.session_deltas         — view: buoy vs perceived vs forecast deltas
--   storage bucket: session-photos
--
-- Apply order:
--   1. sessions table + trigger + RLS
--   2. user_favorites table + RLS
--   3. user_spot_profiles table + RLS
--   4. session_deltas view
--   5. session-photos storage bucket + RLS
--
-- Rollback: see bottom of file
-- ============================================================


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

CREATE TABLE public.sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- ── Identity ─────────────────────────────────────────────
    spot_id         TEXT NOT NULL,
    spot_name       TEXT NOT NULL,          -- denormalized: display resilience if slug changes
    session_date    DATE NOT NULL,          -- the calendar day (user's local date)
    start_time      TIME,                   -- e.g. 08:00 — nullable, user can omit
    duration_min    INTEGER CHECK (duration_min > 0 AND duration_min < 1440),

    -- ── Source buoys ─────────────────────────────────────────
    -- Stored so we can re-derive actual_* if the algorithm changes later.
    primary_buoy_id     TEXT,               -- nearest inshore buoy, e.g. '46225'
    offshore_buoy_id    TEXT,               -- reference for period/direction, e.g. '46086'

    -- ── ACTUAL conditions (auto-populated from buoy history) ─
    -- Populated by backend job after session is created.
    -- Values are averaged across the session window (start → start + duration).
    actual_wvht_ft      NUMERIC(4,1),       -- NDBC WVHT: significant wave height
    actual_dpd_s        NUMERIC(4,1),       -- NDBC DPD: dominant period
    actual_mwd_deg      INTEGER CHECK (actual_mwd_deg BETWEEN 0 AND 360),
                                            -- NDBC MWD: mean wave direction
    actual_wspd_mph     NUMERIC(4,1),       -- NDBC WSPD (converted from m/s)
    actual_wdir_deg     INTEGER CHECK (actual_wdir_deg BETWEEN 0 AND 360),
    actual_tide_state   TEXT CHECK (actual_tide_state IN (
                            'low', 'rising_low', 'mid', 'rising_high', 'high', 'falling'
                        )),
    actual_tide_ft      NUMERIC(4,1),       -- absolute tide height from NOAA CO-OPS
    actual_water_temp_f NUMERIC(4,1),       -- NDBC WTMP
    actual_populated_at TIMESTAMPTZ,        -- NULL until the auto-pop job runs

    -- ── PERCEIVED conditions (what the surfer experienced) ───
    -- These are the 4 questions asked post-session.
    -- Uses surf-vernacular size scale, not feet — intentional.
    perceived_size      TEXT CHECK (perceived_size IN (
                            'knee', 'waist', 'chest', 'shoulder',
                            'head', 'overhead', 'doh', 'toh', 'plus'
                        )),
    perceived_dir_deg   INTEGER CHECK (perceived_dir_deg BETWEEN 0 AND 360),
                                            -- what direction did it feel like?
    perceived_quality   SMALLINT CHECK (perceived_quality BETWEEN 1 AND 10),
                                            -- 1-10, not 1-5: finer signal for ML
    perceived_wind      TEXT CHECK (perceived_wind IN (
                            'glassy', 'light_offshore', 'offshore',
                            'light_onshore', 'onshore', 'howling'
                        )),
    perceived_crowd     SMALLINT CHECK (perceived_crowd BETWEEN 1 AND 5),
    perceived_note      TEXT,               -- free text, optional

    -- ── FORECAST snapshot (what the model said the night before) ─
    -- Captured at session_date-1 ~18:00 local for this spot's session window.
    -- Enables measuring forecast accuracy over time and per model.
    forecast_wvht_ft    NUMERIC(4,1),
    forecast_dpd_s      NUMERIC(4,1),
    forecast_mwd_deg    INTEGER CHECK (forecast_mwd_deg BETWEEN 0 AND 360),
    forecast_wspd_mph   NUMERIC(4,1),
    forecast_wdir_deg   INTEGER CHECK (forecast_wdir_deg BETWEEN 0 AND 360),
    forecast_model      TEXT,               -- e.g. 'ww3+gfs', 'ww3+hrrr'
    forecast_snapped_at TIMESTAMPTZ,        -- when we captured the forecast

    -- ── Equipment ─────────────────────────────────────────────
    board_display       TEXT,               -- free text: "6'2 JS Monsta Box", etc.
    wetsuit_mm          NUMERIC(3,1),       -- 3.0, 4.3, 5.4 — NULL = boardshorts

    -- ── Outcomes ──────────────────────────────────────────────
    waves_caught        INTEGER CHECK (waves_caught >= 0),
    best_wave_note      TEXT,               -- "reeled one from the cove to the pier"

    -- ── Photos ────────────────────────────────────────────────
    -- Store paths, not URLs. Compute signed URLs at read time.
    -- Format: session-photos/{user_id}/{session_id}/{uuid}.{ext}
    photo_paths         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    -- ── Log metadata ──────────────────────────────────────────
    log_method          TEXT NOT NULL DEFAULT 'manual'
                            CHECK (log_method IN ('manual', 'copilot', 'import')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT spot_id_format CHECK (spot_id ~ '^[a-z0-9][a-z0-9\-]{0,63}$')
);

-- Indexes
CREATE INDEX idx_sessions_user_date
    ON public.sessions (user_id, session_date DESC);

CREATE INDEX idx_sessions_spot
    ON public.sessions (spot_id);

-- The key cross-query: all sessions for a user at a specific spot, newest first
CREATE INDEX idx_sessions_user_spot_date
    ON public.sessions (user_id, spot_id, session_date DESC);

-- Quality filter for preference computation (only rated sessions)
CREATE INDEX idx_sessions_user_quality
    ON public.sessions (user_id, perceived_quality)
    WHERE perceived_quality IS NOT NULL;

-- Unpopulated sessions (for the auto-pop job sweep)
CREATE INDEX idx_sessions_unpopulated
    ON public.sessions (created_at)
    WHERE actual_populated_at IS NULL;

-- Trigger: keep updated_at current
CREATE TRIGGER sessions_touch_updated_at
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own sessions"
    ON public.sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users insert own sessions"
    ON public.sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own sessions"
    ON public.sessions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own sessions"
    ON public.sessions FOR DELETE
    USING (auth.uid() = user_id);


-- ============================================================
-- 2. USER_FAVORITES TABLE
-- ============================================================

CREATE TABLE public.user_favorites (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spot_id     TEXT NOT NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    sort_order  INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (user_id, spot_id),
    CONSTRAINT fav_spot_id_format CHECK (spot_id ~ '^[a-z0-9][a-z0-9\-]{0,63}$')
);

CREATE INDEX idx_favorites_user_order
    ON public.user_favorites (user_id, sort_order);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own favorites"
    ON public.user_favorites FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- 3. USER_SPOT_PROFILES TABLE
-- Computed from session history — never edited directly by users.
-- Rebuilt by backend job: POST /api/internal/recompute-profiles
-- One row per (user, spot). Only exists once >= 3 sessions logged.
-- ============================================================

CREATE TABLE public.user_spot_profiles (
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spot_id             TEXT NOT NULL,
    session_count       INTEGER NOT NULL DEFAULT 0,

    -- Aggregate quality signal
    avg_quality         NUMERIC(3,1),           -- mean perceived_quality across all sessions
    avg_quality_good    NUMERIC(3,1),            -- mean where perceived_quality >= 7

    -- Preferred conditions window (inner quartile of 7+ rated sessions)
    -- These are the ranges that correlate with the user's best sessions at this spot.
    sweet_wvht_min_ft   NUMERIC(4,1),
    sweet_wvht_max_ft   NUMERIC(4,1),
    sweet_dpd_min_s     NUMERIC(4,1),
    sweet_dpd_max_s     NUMERIC(4,1),
    sweet_mwd_deg       INTEGER,                -- circular mean of good-session swell directions
    sweet_mwd_spread    INTEGER,                -- ± spread in degrees (how direction-sensitive)
    preferred_tide      TEXT,                   -- modal tide state on 7+ rated sessions
    preferred_wind      TEXT,                   -- modal wind condition on 7+ rated sessions

    -- Perception bias at this spot
    -- Persistent delta between perceived size and buoy reports.
    -- > 1.0 means user perceives bigger than buoy (e.g. canyon amplification at Blacks)
    -- < 1.0 means user perceives smaller (sheltered spot, user undersells)
    size_perception_bias    NUMERIC(4,2),       -- e.g. 1.35 = perceives 35% larger than buoy
    dir_perception_offset   INTEGER,            -- degrees: perceived_dir - actual_mwd, avg

    -- Forecast accuracy at this spot (how well our models do here for this user)
    forecast_wvht_mae_ft    NUMERIC(4,2),       -- mean absolute error: forecast vs actual
    forecast_dpd_mae_s      NUMERIC(4,2),

    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, spot_id),
    CONSTRAINT profile_spot_id_format CHECK (spot_id ~ '^[a-z0-9][a-z0-9\-]{0,63}$')
);

-- RLS: users can read their own profiles (computed by service role)
ALTER TABLE public.user_spot_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profiles"
    ON public.user_spot_profiles FOR SELECT
    USING (auth.uid() = user_id);

-- Service role writes (backend job bypasses RLS with service key)
-- No INSERT/UPDATE policy needed for authenticated role —
-- only the backend service role writes these rows.


-- ============================================================
-- 4. SESSION_DELTAS VIEW
-- The personalization signal. Used by the Copilot tools and
-- the profile recompute job.
-- Readable by owner via the sessions RLS (view inherits it).
-- ============================================================

CREATE VIEW public.session_deltas AS
SELECT
    s.id,
    s.user_id,
    s.spot_id,
    s.spot_name,
    s.session_date,
    s.start_time,
    s.log_method,

    -- ── Size: perceived vs buoy ───────────────────────────────
    -- Persistent delta here reveals canyon/reef amplification
    -- or user-specific size perception bias.
    s.perceived_size,
    s.actual_wvht_ft,

    -- ── Direction: perceived vs buoy ─────────────────────────
    -- Persistent delta reveals swell refraction at this spot.
    -- e.g. buoy says 290° NW but surfer perceives it as 270° W
    -- because the canyon wraps it.
    s.perceived_dir_deg,
    s.actual_mwd_deg,
    -- Normalize to -180..180 range for averaging
    CASE
        WHEN (s.perceived_dir_deg - s.actual_mwd_deg) > 180
            THEN (s.perceived_dir_deg - s.actual_mwd_deg) - 360
        WHEN (s.perceived_dir_deg - s.actual_mwd_deg) < -180
            THEN (s.perceived_dir_deg - s.actual_mwd_deg) + 360
        ELSE (s.perceived_dir_deg - s.actual_mwd_deg)
    END AS swell_dir_delta_deg,

    -- ── Quality vs conditions: the preference signal ──────────
    s.perceived_quality,
    s.actual_wvht_ft    AS cond_wvht_ft,
    s.actual_dpd_s      AS cond_dpd_s,
    s.actual_mwd_deg    AS cond_mwd_deg,
    s.actual_tide_state AS cond_tide,
    s.perceived_wind    AS cond_wind_perceived,

    -- ── Forecast accuracy ─────────────────────────────────────
    s.forecast_wvht_ft,
    s.forecast_dpd_s,
    s.forecast_model,
    ROUND((s.actual_wvht_ft - s.forecast_wvht_ft)::NUMERIC, 2)
        AS forecast_wvht_error_ft,          -- + means actual was bigger than forecast
    ROUND((s.actual_dpd_s - s.forecast_dpd_s)::NUMERIC, 2)
        AS forecast_dpd_error_s

FROM public.sessions s
WHERE
    s.actual_populated_at IS NOT NULL       -- only sessions with buoy data
    AND s.perceived_quality IS NOT NULL;    -- only rated sessions


-- ============================================================
-- 5. STORAGE: session-photos bucket
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'session-photos',
    'session-photos',
    false,                                  -- private bucket
    10485760,                               -- 10 MB per file
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;               -- idempotent re-run

-- Path convention: session-photos/{user_id}/{session_id}/{uuid}.{ext}
-- The first folder segment is the user_id — used by all RLS policies below.

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
-- 6. SEED: dev test data (local dev only — skip in production)
-- Run manually: psql $LOCAL_DB_URL -f 001_sessions_core.sql --set=seed=true
-- Or just uncomment the block below in a separate seed file.
-- ============================================================

-- DO $$
-- DECLARE
--     dev_user_id UUID;
-- BEGIN
--     SELECT id INTO dev_user_id FROM auth.users WHERE email = 'dev@mysurflife.local' LIMIT 1;
--     IF dev_user_id IS NULL THEN
--         RAISE NOTICE 'Dev user not found — skipping seed.';
--         RETURN;
--     END IF;
--
--     INSERT INTO public.sessions (
--         user_id, spot_id, spot_name, session_date, start_time, duration_min,
--         primary_buoy_id,
--         actual_wvht_ft, actual_dpd_s, actual_mwd_deg,
--         actual_wspd_mph, actual_tide_state, actual_water_temp_f, actual_populated_at,
--         perceived_size, perceived_dir_deg, perceived_quality, perceived_wind, perceived_crowd,
--         waves_caught, board_display, perceived_note
--     ) VALUES
--         (dev_user_id,'blacks-beach','Blacks Beach','2026-04-15','07:30',120,
--          '46225', 3.8,15,295, 4.0,'low',62,now(),
--          'overhead',290,9,'light_offshore',2, 14,'6''2 CI Mid','Perfect morning. Canyon lit up.'),
--
--         (dev_user_id,'blacks-beach','Blacks Beach','2026-04-08','08:00',90,
--          '46225', 2.1,12,280, 8.0,'mid',62,now(),
--          'chest',275,5,'onshore',3, 7,'6''2 CI Mid','Onshore came up fast. Fun start.'),
--
--         (dev_user_id,'cardiff-reef','Cardiff Reef','2026-04-10','06:30',105,
--          '46224', 2.8,14,300, 3.0,'rising_low',63,now(),
--          'shoulder',295,7,'glassy',2, 10,'7''0 Egg','Dawn glassy. Reef was firing.'),
--
--         (dev_user_id,'del-mar','Del Mar','2026-04-05','09:00',75,
--          '46224', 3.5,16,285, 5.0,'low',63,now(),
--          'shoulder',280,6,'light_offshore',4, 8,'6''2 CI Mid','Crowded. Waves were there.'),
--
--         (dev_user_id,'blacks-beach','Blacks Beach','2026-03-28','07:00',150,
--          '46225', 5.2,18,305, 2.0,'low',60,now(),
--          'doh',300,10,'glassy',1, 18,'6''2 CI Mid','Best session of the year. Empty at dawn.'),
--
--         (dev_user_id,'lowers','Lower Trestles','2026-03-20','06:00',120,
--          '46086', 4.1,15,290, 4.0,'rising_low',62,now(),
--          'overhead',285,8,'light_offshore',3, 12,'6''2 CI Mid','Lowers doing its thing.');
-- END $$;


-- ============================================================
-- ROLLBACK (save separately as 001_sessions_core_rollback.sql)
-- ============================================================
--
-- DROP VIEW  IF EXISTS public.session_deltas CASCADE;
-- DROP TABLE IF EXISTS public.user_spot_profiles CASCADE;
-- DROP TABLE IF EXISTS public.user_favorites CASCADE;
-- DROP TABLE IF EXISTS public.sessions CASCADE;
-- DROP FUNCTION IF EXISTS public.touch_updated_at CASCADE;
--
-- DELETE FROM storage.objects  WHERE bucket_id = 'session-photos';
-- DELETE FROM storage.buckets  WHERE id = 'session-photos';
--
-- DROP POLICY IF EXISTS "Users read own session photos"   ON storage.objects;
-- DROP POLICY IF EXISTS "Users upload to own session folder" ON storage.objects;
-- DROP POLICY IF EXISTS "Users delete own session photos" ON storage.objects;
