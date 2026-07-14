-- Migration 024: drop the legacy user_spots table.
-- Migration 022 converged its rows into public.spots (owner_id +
-- visibility='private') and froze it; it has been empty and unreferenced
-- since. The one remaining backend mention (routes/map.py) is a function
-- name, not a table read. DROP also removes its RLS policies and trigger;
-- the shared set_updated_at() function stays (other tables use it).

DROP TABLE IF EXISTS public.user_spots;
