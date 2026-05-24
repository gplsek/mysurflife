-- Migration 021: unify public + owner-curated spots into one model.
-- See notes/SPOT_CONFIG_EDITOR_PLAN.md ("Core data model").
-- Safe to re-run (idempotent).
--
-- Owner-curated spots become ordinary `spots` rows so they inherit ALL existing
-- config (characteristics, swell/wind windows, tuning) and code paths. The only
-- difference is who can see them, expressed by two new columns:
--   owner_id   NULL  = global catalog (imported/admin);  set = a user's private place
--   visibility 'public' | 'private'
--
-- SECURITY MODEL: the backend writes via the service-role client, which BYPASSES
-- RLS — so app-code is the primary gate (admin check + ownership check). The RLS
-- policies below are (a) the read-side guard against direct PostgREST/anon access
-- and (b) defense-in-depth for any future direct-client writes. There is no admin
-- JWT claim in RLS; admin access stays in app code (auth.is_admin()).
--
-- PERF: the current-user lookup is wrapped as a subselect per Supabase guidance so
-- the planner evaluates it once (initPlan) instead of per-row.
--
-- NOTE: is_published is a catalog-moderation flag for PUBLIC spots only. Private
-- spots are hidden by visibility='private' regardless of is_published — do not set
-- is_published=false expecting it to hide a public spot from its owner.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ownership + visibility columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.spots
    ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- NOT NULL DEFAULT 'public' backfills every existing catalog row as public.
ALTER TABLE public.spots
    ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

-- Allowed values.
ALTER TABLE public.spots DROP CONSTRAINT IF EXISTS spots_visibility_chk;
ALTER TABLE public.spots
    ADD CONSTRAINT spots_visibility_chk CHECK (visibility IN ('public', 'private'));

-- Integrity: a private spot must have an owner (otherwise it is unreachable).
ALTER TABLE public.spots DROP CONSTRAINT IF EXISTS spots_private_needs_owner_chk;
ALTER TABLE public.spots
    ADD CONSTRAINT spots_private_needs_owner_chk
    CHECK (visibility = 'public' OR owner_id IS NOT NULL);

COMMENT ON COLUMN public.spots.owner_id IS
    'NULL = global catalog (imported/admin). Set = the user who created this private place.';
COMMENT ON COLUMN public.spots.visibility IS
    'public = appears in catalog/map for everyone; private = visible only to owner_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes (every list/search/map query must filter on these — keep them fast)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_spots_owner ON public.spots(owner_id);
CREATE INDEX IF NOT EXISTS idx_spots_visibility ON public.spots(visibility);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — spots: public catalog readable by all; owners read/write their own
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.spots ENABLE ROW LEVEL SECURITY;

-- Replaces the old "Allow public read published spots" (is_published only).
-- A private spot has visibility='private', so it can NEVER match this predicate.
DROP POLICY IF EXISTS "Allow public read published spots" ON public.spots;
DROP POLICY IF EXISTS "spots_public_read" ON public.spots;
CREATE POLICY "spots_public_read" ON public.spots
    FOR SELECT USING (visibility = 'public' AND is_published = true);

DROP POLICY IF EXISTS "spots_owner_all" ON public.spots;
CREATE POLICY "spots_owner_all" ON public.spots
    FOR ALL
    USING ((SELECT auth.uid()) = owner_id)
    WITH CHECK ((SELECT auth.uid()) = owner_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — child tables follow their parent spot's visibility/ownership
--    Read: parent is public+published OR parent owned by me.
--    Write: parent owned by me.
-- ─────────────────────────────────────────────────────────────────────────────

-- spot_characteristics ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read characteristics" ON public.spot_characteristics;
DROP POLICY IF EXISTS "spot_characteristics_read" ON public.spot_characteristics;
CREATE POLICY "spot_characteristics_read" ON public.spot_characteristics
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_characteristics.spot_id
                AND ((s.visibility = 'public' AND s.is_published = true) OR s.owner_id = (SELECT auth.uid())))
    );
DROP POLICY IF EXISTS "spot_characteristics_owner_all" ON public.spot_characteristics;
CREATE POLICY "spot_characteristics_owner_all" ON public.spot_characteristics
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_characteristics.spot_id AND s.owner_id = (SELECT auth.uid())))
    WITH CHECK (EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_characteristics.spot_id AND s.owner_id = (SELECT auth.uid())));

-- spot_swell_windows ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read swell windows" ON public.spot_swell_windows;
DROP POLICY IF EXISTS "spot_swell_windows_read" ON public.spot_swell_windows;
CREATE POLICY "spot_swell_windows_read" ON public.spot_swell_windows
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_swell_windows.spot_id
                AND ((s.visibility = 'public' AND s.is_published = true) OR s.owner_id = (SELECT auth.uid())))
    );
DROP POLICY IF EXISTS "spot_swell_windows_owner_all" ON public.spot_swell_windows;
CREATE POLICY "spot_swell_windows_owner_all" ON public.spot_swell_windows
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_swell_windows.spot_id AND s.owner_id = (SELECT auth.uid())))
    WITH CHECK (EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_swell_windows.spot_id AND s.owner_id = (SELECT auth.uid())));

-- spot_wind_windows ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read wind windows" ON public.spot_wind_windows;
DROP POLICY IF EXISTS "spot_wind_windows_read" ON public.spot_wind_windows;
CREATE POLICY "spot_wind_windows_read" ON public.spot_wind_windows
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_wind_windows.spot_id
                AND ((s.visibility = 'public' AND s.is_published = true) OR s.owner_id = (SELECT auth.uid())))
    );
DROP POLICY IF EXISTS "spot_wind_windows_owner_all" ON public.spot_wind_windows;
CREATE POLICY "spot_wind_windows_owner_all" ON public.spot_wind_windows
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_wind_windows.spot_id AND s.owner_id = (SELECT auth.uid())))
    WITH CHECK (EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_wind_windows.spot_id AND s.owner_id = (SELECT auth.uid())));

-- spot_forecast_tuning ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read tuning" ON public.spot_forecast_tuning;
DROP POLICY IF EXISTS "spot_forecast_tuning_read" ON public.spot_forecast_tuning;
CREATE POLICY "spot_forecast_tuning_read" ON public.spot_forecast_tuning
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_forecast_tuning.spot_id
                AND ((s.visibility = 'public' AND s.is_published = true) OR s.owner_id = (SELECT auth.uid())))
    );
DROP POLICY IF EXISTS "spot_forecast_tuning_owner_all" ON public.spot_forecast_tuning;
CREATE POLICY "spot_forecast_tuning_owner_all" ON public.spot_forecast_tuning
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_forecast_tuning.spot_id AND s.owner_id = (SELECT auth.uid())))
    WITH CHECK (EXISTS (SELECT 1 FROM public.spots s WHERE s.id = spot_forecast_tuning.spot_id AND s.owner_id = (SELECT auth.uid())));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS — spot-attached tables added AFTER migration 002 that still had
--    `USING (true)` (world-readable). Without this they would leak a private
--    spot's AI analysis / ratings once convergence (022) puts private spots in
--    `spots`. Read-only; writes stay service-role.
-- ─────────────────────────────────────────────────────────────────────────────

-- ai_spot_analysis (FK spot_id → spots.id; added in migration 003) ─────────────
-- 1 legacy row has NULL spot_id (not tied to any spot → cannot leak a private
-- spot) — keep it readable to preserve current behavior.
DROP POLICY IF EXISTS "ai_spot_analysis_public_read" ON public.ai_spot_analysis;
DROP POLICY IF EXISTS "ai_spot_analysis_read" ON public.ai_spot_analysis;
CREATE POLICY "ai_spot_analysis_read" ON public.ai_spot_analysis
    FOR SELECT USING (
        ai_spot_analysis.spot_id IS NULL
        OR EXISTS (SELECT 1 FROM public.spots s WHERE s.id = ai_spot_analysis.spot_id
                   AND ((s.visibility = 'public' AND s.is_published = true) OR s.owner_id = (SELECT auth.uid())))
    );

-- spot_ratings (FK spot_slug → spots.slug; added in migration 011 — joins on SLUG)
DROP POLICY IF EXISTS "spot_ratings_public_read" ON public.spot_ratings;
DROP POLICY IF EXISTS "spot_ratings_read" ON public.spot_ratings;
CREATE POLICY "spot_ratings_read" ON public.spot_ratings
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.spots s WHERE s.slug = spot_ratings.spot_slug
                AND ((s.visibility = 'public' AND s.is_published = true) OR s.owner_id = (SELECT auth.uid())))
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- NEXT (separate migration 022 — data convergence, NOT in this schema change):
--   Migrate public.user_spots rows into public.spots as visibility='private'.
--   Blocked on an open question: private-spot slugs.
--     slug is UNIQUE NOT NULL globally, so two users' "Secret Reef" collide.
--     Options: (a) mint disambiguated slugs e.g. <name>-<short-uuid>, or
--              (b) keep routing private spots by id (usr_<id>) and relax slug.
--   Until 022 lands, user_spots stays the source for private spots and the
--   /api/user/spots endpoints are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
