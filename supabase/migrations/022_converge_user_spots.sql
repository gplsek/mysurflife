-- Migration 022: converge user_spots rows into the unified spots table.
-- Data companion to 021 (schema: owner_id/visibility/RLS). Safe to re-run.
--
-- Answers 021's open slug question with option (b): private spots keep the
-- synthetic slug 'usr_<id>' (unique because id is unique), so two users can
-- both have a "Secret Reef" and existing /spots/usr_... URLs stay stable.
-- The user_spots.id is preserved as spots.id so PUT/DELETE /api/user/spots/{id}
-- keeps working for ids clients fetched before the convergence.
--
-- is_published stays false for migrated rows: it is a catalog-moderation flag,
-- and if a private spot is ever flipped to visibility='public' it should not
-- skip moderation (see 021's note).
--
-- NOT done here (Python, not SQL): seeding spot_forecast_tuning.buoy_blend —
-- the buoy registry lives in the backend. Run once after applying:
--   cd backend && python3 backfill_user_spot_blends.py

-- 1. Copy spots (idempotent: skips rows already migrated).
INSERT INTO public.spots
    (id, slug, name, region, latitude, longitude, location_description,
     source, owner_id, visibility, is_published, created_at, updated_at)
SELECT
    us.id,
    'usr_' || us.id,
    us.name,
    'Personal',
    us.latitude,
    us.longitude,
    us.description,
    'user',
    us.user_id,
    'private',
    false,
    us.created_at,
    us.updated_at
FROM public.user_spots us
WHERE NOT EXISTS (SELECT 1 FROM public.spots s WHERE s.id = us.id)
ON CONFLICT (id) DO NOTHING;

-- 2. Seed a characteristics row per migrated spot (skill_level is NOT NULL —
-- default 'intermediate', the owner tunes it later via the editor).
INSERT INTO public.spot_characteristics (spot_id, break_type, skill_level)
SELECT us.id, us.break_type, 'intermediate'
FROM public.user_spots us
WHERE EXISTS (SELECT 1 FROM public.spots s
              WHERE s.id = us.id AND s.owner_id = us.user_id)
ON CONFLICT (spot_id) DO NOTHING;

-- 3. Freeze the legacy table. Kept (not dropped) as a safety net for one
-- release cycle; drop in a later migration once convergence is verified in
-- prod. Revoking access makes any straggler code path fail loudly instead of
-- silently reading stale data.
REVOKE ALL ON public.user_spots FROM anon, authenticated;
COMMENT ON TABLE public.user_spots IS
    'DEPRECATED (migration 022): rows converged into public.spots (owner_id + visibility=private, slug=usr_<id>). Do not read or write; scheduled for DROP after the convergence release settles.';
