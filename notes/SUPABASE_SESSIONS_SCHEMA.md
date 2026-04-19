# Supabase Sessions Schema — Session Journal + Favorites

**Status:** 📋 Planning
**Owner:** George (handoff to Claude Code for execution)
**Parent plan:** [`DESIGN_V2_INTEGRATION_PLAN.md`](./DESIGN_V2_INTEGRATION_PLAN.md) §6 — this is Stage 1 of the Supabase rollout
**Effort:** ~1 week end-to-end (backend migration + frontend hook + photos bucket)
**Risk:** Low — additive, user-scoped, no external API dependencies

---

## 1. Goal

Replace the design's `window.SESSIONS` mock with a real, user-scoped, persistent session journal backed by Supabase. Ship Favorites in the same migration since both tables share the same patterns (user-scoped, RLS-protected, no server-side aggregation needed).

**Success criteria:**

- A logged-in user can create, read, update, delete their own sessions via the Journal screen.
- A user cannot read or modify another user's sessions (RLS enforced).
- Session photos upload to a private Supabase Storage bucket with per-user folder isolation.
- Favorites toggle on Dashboard writes immediately, reflects across devices within 2 seconds (realtime subscription).
- Offline creates queue locally and sync when connection returns.

---

## 2. Schema

### `sessions` table

```sql
CREATE TABLE public.sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- What and when
    spot_id         TEXT NOT NULL,              -- slug: 'lowers', 'rincon', 'pipeline'
    spot_name       TEXT NOT NULL,              -- denormalized for display if spot changes
    session_date    TIMESTAMPTZ NOT NULL,
    duration_min    INTEGER NOT NULL CHECK (duration_min > 0 AND duration_min < 1440),

    -- Quantitative outcomes
    waves_caught    INTEGER CHECK (waves_caught >= 0),
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 0 AND 5),

    -- Conditions snapshot (as recorded by the user OR snapshotted from forecast at session time)
    swell_ft        NUMERIC(4,1),
    swell_period_s  NUMERIC(4,1),
    swell_dir_deg   INTEGER CHECK (swell_dir_deg BETWEEN 0 AND 360),
    wind_mph        NUMERIC(4,1),
    wind_dir_deg   INTEGER CHECK (wind_dir_deg BETWEEN 0 AND 360),
    tide_state      TEXT CHECK (tide_state IN ('low', 'rising', 'mid', 'high', 'falling')),
    water_temp_f    NUMERIC(4,1),

    -- Qualitative
    note            TEXT,
    board_used      TEXT,
    crowd_level     SMALLINT CHECK (crowd_level BETWEEN 1 AND 5),

    -- Photos: array of storage paths (not URLs — compute signed URLs on fetch)
    photo_paths     TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Metadata
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Indexes below
    CONSTRAINT spot_id_format CHECK (spot_id ~ '^[a-z0-9][a-z0-9\-]{0,63}$')
);

CREATE INDEX idx_sessions_user_date ON public.sessions (user_id, session_date DESC);
CREATE INDEX idx_sessions_spot ON public.sessions (spot_id) WHERE spot_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_touch_updated_at
BEFORE UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

### `user_favorites` table

```sql
CREATE TABLE public.user_favorites (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spot_id     TEXT NOT NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    sort_order  INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (user_id, spot_id),
    CONSTRAINT spot_id_format CHECK (spot_id ~ '^[a-z0-9][a-z0-9\-]{0,63}$')
);

CREATE INDEX idx_favorites_user ON public.user_favorites (user_id, sort_order);
```

### RLS policies

```sql
-- sessions
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

-- user_favorites
ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own favorites"
    ON public.user_favorites FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
```

### Storage bucket for session photos

```sql
-- Create bucket (private, 10MB file limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'session-photos',
    'session-photos',
    false,
    10485760,  -- 10 MB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
);

-- RLS: users can only access files in a folder matching their user_id
CREATE POLICY "Users read own photos"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'session-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload to own folder"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'session-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own photos"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'session-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
```

Photo path format: `session-photos/{user_id}/{session_id}/{uuid}.{ext}`

---

## 3. Migration SQL

Save as `supabase/migrations/20260501_sessions_and_favorites.sql`. Keep the two migrations separate on disk if preferred (`20260501_sessions.sql`, `20260501_favorites.sql`, `20260501_storage.sql`) — Claude Code's choice. The above schema is the canonical form.

**Apply order:**
1. `sessions` table + trigger + RLS
2. `user_favorites` table + RLS
3. `session-photos` bucket + RLS

**Rollback:**
```sql
DROP POLICY IF EXISTS ... ;
DROP TABLE IF EXISTS public.sessions CASCADE;
DROP TABLE IF EXISTS public.user_favorites CASCADE;
DROP FUNCTION IF EXISTS public.touch_updated_at CASCADE;
DELETE FROM storage.buckets WHERE id = 'session-photos';
```

---

## 4. Frontend Data Layer

### Types

New file: `frontend/src/types/session.js`

```js
/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} userId
 * @property {string} spotId
 * @property {string} spotName
 * @property {string} sessionDate           ISO 8601
 * @property {number} durationMin
 * @property {number} [wavesCaught]
 * @property {number} rating                0..5
 * @property {number} [swellFt]
 * @property {number} [swellPeriodS]
 * @property {number} [swellDirDeg]
 * @property {number} [windMph]
 * @property {number} [windDirDeg]
 * @property {'low'|'rising'|'mid'|'high'|'falling'} [tideState]
 * @property {number} [waterTempF]
 * @property {string} [note]
 * @property {string} [boardUsed]
 * @property {number} [crowdLevel]          1..5
 * @property {string[]} [photoPaths]
 * @property {string} createdAt
 * @property {string} updatedAt
 */
```

### Supabase client

New file: `frontend/src/lib/supabase.js`

```js
import { createClient } from '@supabase/supabase-js';

const url = process.env.REACT_APP_SUPABASE_URL;
const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('⚠️ Supabase env vars missing — sessions/favorites disabled');
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 2 } },
});
```

### Hooks

New file: `frontend/src/hooks/useSessions.js`

```js
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useSessions({ spotId = null, limit = 50 } = {}) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    let query = supabase
      .from('sessions')
      .select('*')
      .order('session_date', { ascending: false })
      .limit(limit);
    if (spotId) query = query.eq('spot_id', spotId);

    const { data, error } = await query;
    if (error) setError(error);
    else setSessions(data.map(_rowToSession));
    setLoading(false);
  }, [spotId, limit]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (session) => {
    const row = _sessionToRow(session);
    const { data, error } = await supabase
      .from('sessions').insert(row).select().single();
    if (error) throw error;
    const created = _rowToSession(data);
    setSessions(s => [created, ...s]);
    return created;
  }, []);

  const update = useCallback(async (id, patch) => {
    const { data, error } = await supabase
      .from('sessions').update(_sessionToRow(patch)).eq('id', id).select().single();
    if (error) throw error;
    const updated = _rowToSession(data);
    setSessions(s => s.map(x => x.id === id ? updated : x));
    return updated;
  }, []);

  const remove = useCallback(async (id) => {
    const { error } = await supabase.from('sessions').delete().eq('id', id);
    if (error) throw error;
    setSessions(s => s.filter(x => x.id !== id));
  }, []);

  return { sessions, loading, error, refetch: fetch, create, update, remove };
}

function _rowToSession(r) {
  return {
    id: r.id, userId: r.user_id, spotId: r.spot_id, spotName: r.spot_name,
    sessionDate: r.session_date, durationMin: r.duration_min,
    wavesCaught: r.waves_caught, rating: r.rating,
    swellFt: r.swell_ft, swellPeriodS: r.swell_period_s, swellDirDeg: r.swell_dir_deg,
    windMph: r.wind_mph, windDirDeg: r.wind_dir_deg,
    tideState: r.tide_state, waterTempF: r.water_temp_f,
    note: r.note, boardUsed: r.board_used, crowdLevel: r.crowd_level,
    photoPaths: r.photo_paths || [],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function _sessionToRow(s) {
  return {
    spot_id: s.spotId, spot_name: s.spotName,
    session_date: s.sessionDate, duration_min: s.durationMin,
    waves_caught: s.wavesCaught, rating: s.rating,
    swell_ft: s.swellFt, swell_period_s: s.swellPeriodS, swell_dir_deg: s.swellDirDeg,
    wind_mph: s.windMph, wind_dir_deg: s.windDirDeg,
    tide_state: s.tideState, water_temp_f: s.waterTempF,
    note: s.note, board_used: s.boardUsed, crowd_level: s.crowdLevel,
    photo_paths: s.photoPaths,
  };
}
```

New file: `frontend/src/hooks/useFavorites.js`

```js
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useFavorites() {
  const [favorites, setFavorites] = useState([]);  // string[] of spot_ids
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.from('user_favorites')
      .select('spot_id, sort_order')
      .order('sort_order')
      .then(({ data }) => {
        if (mounted && data) setFavorites(data.map(r => r.spot_id));
        setLoading(false);
      });

    // Realtime subscription for cross-device sync
    const channel = supabase.channel('favorites-self')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'user_favorites',
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setFavorites(f => [...f, payload.new.spot_id]);
        } else if (payload.eventType === 'DELETE') {
          setFavorites(f => f.filter(id => id !== payload.old.spot_id));
        }
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const add = useCallback(async (spotId) => {
    setFavorites(f => f.includes(spotId) ? f : [...f, spotId]);  // optimistic
    const { error } = await supabase
      .from('user_favorites')
      .insert({ spot_id: spotId, sort_order: favorites.length });
    if (error) {
      setFavorites(f => f.filter(id => id !== spotId));  // revert
      throw error;
    }
  }, [favorites.length]);

  const remove = useCallback(async (spotId) => {
    setFavorites(f => f.filter(id => id !== spotId));  // optimistic
    const { error } = await supabase
      .from('user_favorites').delete().eq('spot_id', spotId);
    if (error) {
      setFavorites(f => [...f, spotId]);  // revert
      throw error;
    }
  }, []);

  return { favorites, loading, add, remove };
}
```

### Photo upload helper

New file: `frontend/src/lib/photos.js`

```js
import { supabase } from './supabase';
import { v4 as uuid } from 'uuid';

/**
 * Uploads a File to session-photos bucket.
 * Returns the storage path (not a URL).
 */
export async function uploadSessionPhoto(sessionId, file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${user.id}/${sessionId}/${uuid()}.${ext}`;

  const { error } = await supabase.storage
    .from('session-photos')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;

  return path;
}

/**
 * Resolves a storage path to a short-lived signed URL (1 hour).
 */
export async function signedPhotoUrl(path, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from('session-photos')
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
```

---

## 5. Backend (FastAPI) — Optional Proxy

Not strictly required — the frontend talks directly to Supabase. Add a FastAPI proxy only if we need server-side aggregation (e.g., "top 10 rated sessions this month" across all users for leaderboards, which isn't in scope yet).

For now: `backend/main.py` adds **one** endpoint for cross-data aggregation:

```python
@app.get("/api/user/{user_id}/session-stats")
async def get_session_stats(user_id: str, months: int = 12):
    """
    Aggregates session stats for the Dashboard screen.
    Reads from Supabase with service role key (server-side auth).
    Returns: total_sessions, total_minutes, total_waves, avg_rating,
             top_spots, rating_trend.
    """
    # Implementation uses supabase-py with SERVICE_ROLE_KEY (bypasses RLS).
    # Must validate user_id matches authenticated user from JWT.
```

This is the seam where the Dashboard's `stats YTD / avg rating / 42h in the water` block gets real numbers.

---

## 6. Offline Support

Sessions must persist offline-created entries. Pattern:

1. `useSessions().create()` writes to Supabase directly if `navigator.onLine`.
2. If offline (`navigator.onLine === false`) OR the insert fails with a network error, write to IndexedDB under `pending_sessions` store.
3. On `window.addEventListener('online', ...)`, drain `pending_sessions` to Supabase one-by-one. Discard successfully-synced entries.
4. Photos follow the same pattern — queue in IndexedDB as Blobs, upload when online.

Use [`idb-keyval`](https://github.com/jakearchibald/idb-keyval) (1 KB) for the IndexedDB wrapper. Add to `package.json`.

New file: `frontend/src/lib/offlineQueue.js` — opaque module with `enqueue(item)`, `drain(handler)`, `pendingCount()`.

---

## 7. Auth Setup

Supabase Auth uses magic-link email by default. The design doesn't specify an auth screen yet. For Phase B integration:

1. Add a minimal login page at `/login` — email input + "Send magic link" button.
2. After magic-link click, user lands on `/` with active session.
3. `App.js` gates Journal / Alerts / Dashboard behind `useUser()` hook. Map view is public (read-only — no favorites, no sessions).
4. "Sign out" link in topbar user menu.

Auth env vars in `frontend/.env.local`:

```
REACT_APP_SUPABASE_URL=https://<project>.supabase.co
REACT_APP_SUPABASE_ANON_KEY=<anon-key>
```

Production: same values but sourced from deployed env (`.env.production` or Apache SetEnv directives).

---

## 8. Seeding Test Data

For development, seed 6 sessions per test user to verify the Journal UI renders correctly:

New file: `supabase/seed/dev_sessions.sql`

```sql
-- Run via `supabase db reset` in local dev. DO NOT run against production.
INSERT INTO public.sessions (
    user_id, spot_id, spot_name, session_date, duration_min,
    waves_caught, rating, swell_ft, swell_period_s, wind_mph, tide_state, water_temp_f, note
)
SELECT
    (SELECT id FROM auth.users WHERE email = 'dev@mysurflife.local'),
    spot_id, spot_name, session_date, duration_min,
    waves_caught, rating, swell_ft, swell_period_s, wind_mph, tide_state, water_temp_f, note
FROM (VALUES
    ('lowers', 'Lower Trestles', NOW() - INTERVAL '1 day', 118, 14, 5, 4.2, 14, 6, 'rising', 64, 'Dawn patrol. Glassy til 8:30. Got the wave of the week.'),
    ('malibu', 'Malibu First Point', NOW() - INTERVAL '3 days', 95, 9, 3, 2.8, 12, 11, 'low', 63, 'Crowded. Onshore came up early.'),
    ('rincon', 'Rincon', NOW() - INTERVAL '5 days', 140, 22, 5, 5.1, 15, 4, 'mid', 62, 'Reeled off a set wave from the cove all the way to the highway.'),
    ('ocean-beach', 'Ocean Beach', NOW() - INTERVAL '8 days', 52, 4, 2, 8.0, 13, 19, 'rising', 56, 'Got worked. Paddled back in.'),
    ('lowers', 'Lower Trestles', NOW() - INTERVAL '11 days', 105, 11, 4, 3.4, 13, 7, 'mid', 64, 'Clean but small. Fun for the longboard.'),
    ('rincon', 'Rincon', NOW() - INTERVAL '14 days', 120, 16, 4, 4.0, 14, 5, 'falling', 62, 'Family on the beach. Tide dropped fast.')
) AS t(spot_id, spot_name, session_date, duration_min, waves_caught, rating, swell_ft, swell_period_s, wind_mph, tide_state, water_temp_f, note);
```

---

## 9. Acceptance Criteria

### Schema
- `sessions` table accepts valid inserts and rejects invalid (rating out of range, duration_min ≤ 0).
- RLS: unauthenticated query returns 0 rows; authenticated user sees only own rows.
- `user_favorites` composite PK prevents duplicate favs.

### Frontend
- Journal screen renders the 6 seed sessions in reverse chronological order with stats block computed correctly (total, hours in water, waves, avg rating).
- Creating a session via "New session" button writes to DB and appears in list without refresh.
- Editing a session updates `updated_at` trigger correctly.
- Deleting a session removes it from UI and DB.
- Photo upload: file picker opens, selected image uploads, new photo appears in the session detail with a signed URL.
- Dashboard favs-grid reflects `useFavorites()` state; clicking a spot's star toggles it and shows instantly.
- Offline test: disable network, create session, verify it's queued (dev console shows `pending_sessions` count), re-enable network, verify it syncs within 2 seconds.

### Security
- User A cannot fetch User B's sessions via direct Supabase client call (verify in testing).
- Signed photo URLs expire after 1 hour.
- Service role key is never exposed in frontend — only in backend `.env` for the stats endpoint.

---

## 10. Execution Notes for Claude Code

**Order of operations:**

1. Apply the migration in Supabase dashboard (or via `supabase db push`). Verify with `SELECT * FROM public.sessions LIMIT 0` as different roles (anon, authenticated, service_role).
2. Install packages: `npm install @supabase/supabase-js idb-keyval uuid`.
3. Create `frontend/src/lib/supabase.js` + env vars first. Verify auth works by signing in as a test user.
4. Build `useSessions` hook. Render it in a throwaway component on `/debug/sessions` to test CRUD.
5. Build `SessionJournal` screen (per `DESIGN_V2_INTEGRATION_PLAN.md` §3 Phase B Component Inventory) using the hook. Match the design's visual from `ClaudeDesign/project/SideScreens.jsx` lines 92–149.
6. Build `useFavorites` hook, wire into Dashboard favs-grid.
7. Photo upload component — optional enhancement after core CRUD ships.
8. Offline queue — ship as a follow-up PR, not required for Phase B merge.

**Commits:**
- `feat(db): sessions + user_favorites tables with RLS`
- `feat(storage): session-photos bucket with per-user RLS`
- `feat(frontend): supabase client + useSessions hook`
- `feat(frontend): useFavorites hook with realtime subscription`
- `feat(frontend): session journal screen`
- `feat(frontend): session detail + create form`
- `feat(frontend): dashboard favorites wired to live data`
- `feat(frontend): offline queue for sessions` (follow-up)

**Testing:**
- Unit tests: `_rowToSession` / `_sessionToRow` round-trip.
- Integration: create → read → update → delete session via hook.
- Manual: photo upload flow; cross-device favorites sync (two browser tabs as same user).

---

## 11. Deferred / Future

Not in this plan — explicitly deferred to keep this scope tight:

- **Per-session forecast snapshot.** When a user logs a session, ideally we snapshot the forecast that was live at that moment (wave model state, wind, tide) for later ML training. Add in a follow-up — needs a backend endpoint that returns the full forecast blob by spot + timestamp.
- **Alert rules table.** Lives in the Alerts screen design, but full implementation (rules + evaluator edge function + realtime push) is Stage 2 of the Supabase rollout (`DESIGN_V2_INTEGRATION_PLAN.md` §6). Get a separate plan file when that kicks off.
- **User preferences / AI learning.** Also Stage 3.
- **Sharing a session publicly** (read-only share link). Future UX feature.
- **Bulk import from CSV / Surf Check / Lineup Reviews.** Feature request bucket.

---

**Created:** 2026-04-19
**Supersedes:** nothing — new plan
**Related:** [`DESIGN_V2_INTEGRATION_PLAN.md`](./DESIGN_V2_INTEGRATION_PLAN.md) (parent), [`WAVE_PERFORMANCE_V2_PLAN.md`](./WAVE_PERFORMANCE_V2_PLAN.md), [`GLOBAL_DATA_EXPANSION_PLAN.md`](./GLOBAL_DATA_EXPANSION_PLAN.md)
