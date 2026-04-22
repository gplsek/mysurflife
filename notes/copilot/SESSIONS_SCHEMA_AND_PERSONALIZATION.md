# Sessions Schema & Personalization Engine

**Status:** 🟡 Schema migrated — backend jobs + Copilot tools pending
**Owner:** George
**Migration:** `supabase/migrations/001_sessions_core.sql`
**Created:** 2026-04-21
**Related:**
- [`SUPABASE_SESSIONS_SCHEMA.md`](./SUPABASE_SESSIONS_SCHEMA.md) — original schema draft (superseded by this plan)
- [`copilot_driven_architecture.md`](./copilot_driven_architecture.md) — Copilot vision
- [`DESIGN_V2_INTEGRATION_PLAN.md`](./DESIGN_V2_INTEGRATION_PLAN.md) — UI integration
- [`GLOBAL_DATA_EXPANSION_PLAN.md`](./GLOBAL_DATA_EXPANSION_PLAN.md) — data sources

---

## 1. Why This Exists — The Core Product Insight

MySurfLife is not a surf forecast site. The real problem being solved is:

> Experienced surfers don't use one source. They track storms, read models, check buoys,
> and synthesize it all using years of personal knowledge about specific spots.
> No app captures or assists with that synthesis process.

Surfline and Magic Seaweed answer **"what will the surf be like?"**
MySurfLife answers **"what will the surf be like *for you*, at *your* spots?"**

That distinction drives every schema and architecture decision in this document.

The secret sauce is a **feedback loop** no other surf app has:

```
Forecast data → Copilot prediction → User surfs → Logs perceived conditions
      ↑                                                        ↓
Personal preference model ←── Delta analysis ←── Actual buoy data (auto-populated)
```

Over enough sessions, the system stops relying purely on models and starts using
the user's own history. The moat is the session log data — Surfline can't replicate
it because they don't own the personal data layer.

---

## 2. The Three-Layer Conditions Model

This is the most important architectural decision in the schema.

Previous drafts had a single conditions block (`swell_ft`, `wind_mph`, etc.).
That's wrong because it collapses three fundamentally different things:

| Layer | What it is | Who writes it | Why it matters |
|---|---|---|---|
| `actual_*` | What NDBC buoys reported during the session | Backend auto-pop job | Ground truth — objective |
| `perceived_*` | What the surfer experienced at the break | User (4 questions) | Personal signal — subjective |
| `forecast_*` | What the model predicted the night before | Backend snapshot job | Accuracy measurement |

**The delta between these layers is the product.**

- `actual_wvht_ft` vs `perceived_size` → reveals spot amplification (canyon, reef) and user-specific size perception
- `actual_mwd_deg` vs `perceived_dir_deg` → reveals swell refraction at the specific break
- `forecast_wvht_ft` vs `actual_wvht_ft` → measures model accuracy at this spot over time
- `perceived_quality` vs `actual_*` conditions → the preference signal: what conditions make *this user* happy

### Example: Blacks Beach

Blacks sits above the La Jolla submarine canyon. The canyon focuses swell energy,
making waves 30-40% larger and more powerful than the nearby buoy suggests.

A user who has logged 20 sessions at Blacks will accumulate a pattern where
`perceived_size = 'overhead'` correlates with `actual_wvht_ft ≈ 3.5`. That delta
becomes the `size_perception_bias` in `user_spot_profiles` — and the Copilot
uses it to say: *"Buoy 46225 is showing 3.5ft — expect overhead at Blacks."*

That's local knowledge the system learned from the user's own logs. No other app does this.

---

## 3. Why the Perceived Size Scale Uses Words, Not Feet

The `perceived_size` field uses surf vernacular:
`knee | waist | chest | shoulder | head | overhead | doh | toh | plus`

Not feet. Intentional.

Asking a surfer "how big were the waves in feet?" produces unreliable data —
every surfer answers differently and the Hawaiian vs. face-height debate is endless.
Asking "was it overhead or double-overhead?" produces consistent, comparable data
because surfers have been using this scale for decades.

The conversion to feet happens in the Copilot layer using the user's `size_perception_bias`,
not in the database.

---

## 4. The 30-Second Log Design

Session logging must be frictionless or users won't do it. The target is 30 seconds.

**What the user provides:**
1. Spot (or confirm auto-detected from favorites)
2. Date + approximate start time ("Tuesday around 8am")
3. Duration ("surfed for about 2 hours")
4. Perceived size (single tap on scale)
5. Quality rating 1-10 (slider)
6. Perceived wind (single tap: glassy / offshore / onshore / howling)
7. Optional: note, board, crowd

**What the system auto-populates (user provides nothing):**
- `actual_wvht_ft`, `actual_dpd_s`, `actual_mwd_deg` — from NDBC historical obs
- `actual_wspd_mph`, `actual_wdir_deg` — from NDBC
- `actual_tide_state`, `actual_tide_ft` — from NOAA CO-OPS
- `actual_water_temp_f` — from NDBC WTMP
- `forecast_*` — from our model cache at session_date-1 18:00
- `primary_buoy_id`, `offshore_buoy_id` — from spot → buoy mapping in `spots` table

**Key point:** NDBC keeps historical records going back years. A user can log
a session from 3 weeks ago and the auto-pop job can still backfill it.
This makes the logging feel forgiving — they don't have to do it in real time.

---

## 5. Auto-Population Job Design

**File:** `backend/jobs/populate_session_conditions.py`

**Triggered by:**
- `POST /api/sessions` — async, immediately after insert
- Nightly sweep for any session where `actual_populated_at IS NULL`

**Algorithm:**

```
1. Load session: spot_id, session_date, start_time, duration_min
2. Look up spot in Supabase spots table → get primary_buoy_id, offshore_buoy_id,
   nearest tide station ID
3. Compute time window: start_time → start_time + duration_min (UTC)
4. Fetch NDBC historical stdmet for primary_buoy_id, time window:
   https://www.ndbc.noaa.gov/data/historical/stdmet/{station_id}{year}.txt.gz
   (or the 45-day realtime endpoint for recent sessions)
5. Filter rows to time window, average: WVHT, DPD, MWD, WSPD, WDIR, WTMP
6. Fetch NOAA CO-OPS tide for nearest station + time window
   → compute tide_state (low/rising_low/mid/rising_high/high/falling)
   → record absolute tide height
7. PATCH sessions row: set actual_* fields, actual_populated_at = now()
8. If forecast cache has data for session_date-1 at this spot:
   → snapshot forecast_* fields too
```

**Error handling:**
- NDBC data unavailable (station offline, too historical): set `actual_populated_at`
  to a sentinel value like `'1970-01-01'` to stop the sweep from retrying forever.
  Log the failure. User can manually enter conditions if they want.
- Partial data (wind available but no wave height): populate what's available,
  still mark `actual_populated_at`.

**Rate limiting:** NDBC requests should be throttled — 1 req/sec max.
Use the existing semaphore pattern from `backend/main.py`.

---

## 6. User Spot Profiles — Computed, Never Edited

`user_spot_profiles` is a derived table, not a settings table.
**Users never edit it directly.** It is recomputed by a backend job.

**Recompute trigger:**
- After any session is updated with `actual_populated_at` (i.e., auto-pop completed)
- On demand: `POST /api/internal/recompute-profiles?user_id=X&spot_id=Y`
- Nightly sweep for any profile where the most recent session is newer than `computed_at`

**Minimum sessions to compute:** 3. Below that threshold, no row exists and the
Copilot falls back to generic spot characteristics.

**Key computed fields:**

`sweet_wvht_min/max_ft` — inner quartile (p25-p75) of `actual_wvht_ft` on sessions
where `perceived_quality >= 7`. This is the user's confirmed sweet spot, not a guess.

`size_perception_bias` — `AVG(perceived_size_as_ft / actual_wvht_ft)` where
`perceived_size_as_ft` converts the vernacular scale to feet using a standard mapping
(e.g. overhead = 6ft, doh = 10ft). A bias of 1.35 means the user consistently
perceives waves 35% bigger than the buoy reports — classic canyon spot signature.

`dir_perception_offset` — `AVG(swell_dir_delta_deg)` from `session_deltas`.
A consistent +20° offset means the spot refracts swell to appear more westerly
than the buoy's open-ocean reading. This calibrates the Copilot's direction advice.

`forecast_wvht_mae_ft` — mean absolute error of our forecast vs. actual at this spot.
Lets the Copilot say "our models tend to underforecast Blacks by 0.8ft on NW swells."

---

## 7. Copilot Tools This Schema Enables

Once `user_spot_profiles` has data, these Copilot tools become possible:

### `get_user_spot_profile(user_id, spot_id)`
Returns a natural-language summary of the user's history and preferences at a spot.
> "At Blacks, your sweet spot is 3-5ft buoy (expect overhead to doh given canyon
> amplification), 14-18s period, NW 290-320°, low-to-mid tide, any offshore.
> 23 sessions logged, average quality 7.8/10."

### `predict_session_quality(user_id, spot_id, forecast_window)`
Scores an upcoming forecast window against the user's preference profile.
> "Wednesday 6-9am at Blacks looks like a 8.5/10 for you. 15s NW at 305° hits
> your sweet spot exactly. Low tide at 7:15am. Similar conditions: you rated
> your last 4 matching sessions 8, 9, 9, 8."

### `explain_spot_behavior(user_id, spot_id)`
Uses the delta data to explain why the spot behaves the way it does for this user.
> "You consistently perceive waves at Blacks 35% larger than buoy 46225 reports.
> This matches the La Jolla canyon amplification effect — when the buoy says 3ft,
> plan for overhead. You also perceive the swell direction as ~20° more westerly
> than the buoy, likely due to canyon refraction."

### `find_best_session_window(user_id, spots[], days_ahead)`
Scans the forecast across the user's favorite spots and ranks windows.
> "Your best window this week: Blacks on Wednesday 6-9am (predicted 8.5/10),
> Cardiff Thursday afternoon (7/10), Del Mar Saturday morning (6/10)."

### `log_session_from_natural_language(user_id, text)`
Parses a casual description into a session log entry.
> Input: "surfed blacks tuesday morning for a couple hours, it was pretty fun,
> overhead sets, maybe a 7"
> → Creates session: spot=blacks-beach, date=Tuesday, duration=120min,
>   perceived_size=overhead, perceived_quality=7, triggers auto-pop job.

---

## 8. Copilot Component Contract (JSON Response Envelope)

When the Copilot generates a forecast or report, it returns structured JSON
alongside the natural language response. The frontend `switch`es on `component.type`
to render the right visualization.

```json
{
  "message": "Wednesday looks like your kind of day at Blacks...",
  "components": [
    {
      "type": "timeline_chart",
      "spot_id": "blacks-beach",
      "date_range": ["2026-04-23T00:00", "2026-04-23T23:00"],
      "tracks": ["wave_height", "wind", "tide"],
      "highlight_window": ["06:00", "09:00"],
      "animate": true
    },
    {
      "type": "conditions_summary",
      "spot_id": "blacks-beach",
      "forecast_time": "2026-04-23T07:00",
      "predicted_quality": 8.5,
      "confidence": "high",
      "matching_sessions": 4
    },
    {
      "type": "session_history_sparkline",
      "spot_id": "blacks-beach",
      "user_id": "...",
      "highlight_similar": true
    }
  ]
}
```

The user can then refine: "add swell period to that chart" → Copilot returns
an updated component spec with `"swell_period"` added to `tracks`. No page reload.

**Component type vocabulary (v1):**
- `timeline_chart` — wave height / wind / tide / swell period over time
- `conditions_summary` — snapshot card for a specific moment
- `spot_comparison` — side-by-side two spots at the same time
- `session_history_sparkline` — user's quality ratings at a spot over time
- `swell_map` — regional swell/wind map centered on a spot
- `forecast_accuracy` — model vs actual chart for a spot

---

## 9. What Was Deliberately Left Out of the Schema

These are deferred — not forgotten. Do not add them to the migration
without a separate plan:

**Alert rules table** — rules like "notify me when Blacks hits my sweet spot."
Needs its own table + Supabase edge function evaluator + push notification setup.
Planned for Stage 2 of the Supabase rollout.

**User boards table** — `board_slug` is a placeholder FK. Full equipment
tracking (board quiver, wetsuit inventory) is a future feature. For now,
`board_display` free text is sufficient.

**Per-session AI analysis** — different from `user_spot_profiles`. This would
be a full Claude-generated narrative for each session ("here's what the ocean
was doing that day and why it surfed the way it did"). High value but high cost
at scale. Defer until session volume justifies it.

**Social / sharing** — session logs are private by default. Public share links,
crew features, and leaderboards are future scope.

**Import from external sources** — CSV import, Surfline session history, Apple
Health workout data. The `log_method = 'import'` column is a placeholder.

---

## 10. Schema Validation Checklist (for Claude Code)

Before applying the migration, verify:

- [ ] `touch_updated_at()` function doesn't already exist in the project
      (check previous migrations). The `CREATE OR REPLACE` handles it but
      worth knowing.
- [ ] `storage.foldername()` helper is available — it's a Supabase built-in
      but confirm with `SELECT storage.foldername('a/b/c.jpg')` returning `['a','b']`.
- [ ] No existing `sessions` or `user_favorites` table (fresh migration).
- [ ] RLS is enabled on the Supabase project (should be on by default).
- [ ] Service role key is in `backend/.env` as `SUPABASE_SERVICE_KEY` —
      the profile recompute job needs it to write `user_spot_profiles`.

After applying:

- [ ] `SELECT * FROM public.sessions LIMIT 0` as `anon` role returns 0 rows (RLS works).
- [ ] `SELECT * FROM public.sessions LIMIT 0` as `authenticated` role with a test
      user returns only that user's rows.
- [ ] `SELECT * FROM public.session_deltas LIMIT 0` — view is accessible.
- [ ] `SELECT * FROM storage.buckets WHERE id = 'session-photos'` — bucket exists.
- [ ] Insert a test session, verify `updated_at` trigger fires on update.

---

## 11. Frontend Implementation Order (for Claude Code)

1. `frontend/src/lib/supabase.js` — Supabase client + env vars
2. `frontend/src/hooks/useSessions.js` — CRUD hook
3. `frontend/src/hooks/useFavorites.js` — with realtime subscription
4. Session Journal screen (per `DESIGN_V2_INTEGRATION_PLAN.md` Phase B)
5. Quick-log flow — the 30-second logging UX (most important for adoption)
6. `backend/jobs/populate_session_conditions.py` — auto-population job
7. `backend/jobs/recompute_user_profiles.py` — preference profile job
8. Copilot tools that consume `user_spot_profiles`

The quick-log flow (#5) should be prioritized above the full Journal screen (#4)
because it drives data collection. An empty journal is fine. A frictionless
way to log sessions is critical.

---

**Last updated:** 2026-04-21
**Next steps:**
1. Apply `supabase/migrations/001_sessions_core.sql`
2. Build `backend/jobs/populate_session_conditions.py`
3. Build quick-log UI component
4. Wire Copilot tools to `user_spot_profiles`
