# Sione — Capabilities & Workplan

**Audience:** Code (backend + frontend), Design
**Purpose:** Single source of truth for what Sione is, what it does, and how it plugs into the product. Supersedes the per-persona architecture that lived in `backend/ai_personas.py` and `backend/ai_personas_spots.py`.
**Status:** Draft — 2026-04-22. Workplan at §7.

---

## 1. The idea in one paragraph

Sione is the only AI-facing surface in the product. From the user's perspective it's a single assistant — one name, one brand, one mental model. Internally, Sione operates in **modes** determined by the context it's invoked with. A click from a storm card lands in *Storm Planner* mode. An inline card on the spot detail page runs *Geometry Analyst* mode. A cold-open chat runs *Generalist* mode. Modes are internal plumbing — the user never picks a persona, never sees a mode label, never switches characters mid-conversation. Adding a new capability means adding a mode, not a new AI product.

This replaces the previous plan where each capability (spot analysis, storm planning, session debrief) had its own persona. That design leaked implementation detail into the UX and made future capabilities feel like new products to learn.

---

## 2. Modes

Every mode is a system-prompt template + an output contract + a set of context fields the caller is expected to supply. Prompts live in `backend/sione/modes/` (migrated from `ai_personas*.py`) and remain editable from the existing admin panel — the admin UI keeps the same "edit persona" affordance, but the list is now a fixed set of modes rather than free-form personas.

### 2.1 Geometry Analyst (`mode=spot_geometry`)

- **What it does:** Analyzes a specific surf spot's swell windows, shadow zones, bathymetry, and optimal conditions from first principles. Reasons about coastline geometry from coordinates — doesn't invent place names.
- **Source prompt:** `backend/ai_personas_spots.py::SpotSwellGeometryAnalyst.analyze` verbatim (it's well-tuned; don't rewrite on migration).
- **Context in:** `{ spot_slug, spot_characteristics, swell_windows, wind_windows, coordinates, ocean_basin }` — already assembled by `get_spot_context()` today.
- **Output contract:** `sione.analyze.spot.v1` — versioned JSON schema matching the current persona output (primary_windows, shadow_zones, partial_blockage, bathymetry, optimal_swell, summary). Frozen at v1; schema changes bump the version.
- **Invoked from:** `POST /api/sione/analyze` with `{ context_type: "spot", spot_slug }`. Renders as an inline card on the spot detail page under the title "Sione's read on {spot name}".
- **Cadence & cache:** Spot geometry doesn't change hour-to-hour. Cache per spot for 30 days in `sione_analyses` table; invalidate on spot_characteristics edit or on manual admin refresh. Cost: one LLM call per spot per month, at most.

### 2.2 Storm Planner (`mode=storm_trip`)

- **What it does:** Given a storm × region × spot × arrival context, helps the user decide whether to travel, when to go, and what to watch for. Runs follow-up conversations.
- **Source prompt:** New — written for the storm-card handoff flow per STORM-card.md §8. Draft prompt in `backend/sione/modes/storm_trip.py`.
- **Context in:** `{ storm_id, storm_summary, target_subregion, target_spot, arrival (first/peak/size/period/window), user_home_coords? }` — populated from `/api/storms/{id}/arrivals` response plus user profile.
- **Output contract:** Natural-language conversational. Opening message is deterministic template (server-side string), not LLM-generated, so it renders instantly.
- **Invoked from:** `POST /api/sione/sessions` with the context block; "Plan trip with Sione" CTA on storm card L3 spot row (STORM-card.md §8).
- **Tools available in this mode:** `get_tides`, `get_forecast`, `create_alert`, `log_trip_to_journal`. `get_flights` deferred to a later milestone.
- **Cadence & cache:** No caching — conversational. Store sessions in `sione_sessions` table for resumability.

### 2.3 Generalist (`mode=generalist`)

- **What it does:** Open-ended surf Q&A for users who land in Sione without context. Can pivot into any mode once context is established (e.g., user mentions a specific spot → Sione silently loads Geometry Analyst context for subsequent turns).
- **Source prompt:** New, shorter — establishes Sione as a surf-native assistant, capable of explaining conditions, recommending regions, narrating forecasts. No persona ornaments beyond the brand voice.
- **Context in:** User's location (if consented), recent favorites, last session's target spot. Thin context.
- **Output contract:** Natural-language conversational.
- **Invoked from:** Cold-open chat (nav link, keyboard shortcut), or when deep-linking into Sione without storm/spot params.
- **Cadence & cache:** Sessions persisted as above.

### 2.4 Mode activation table

| Entry point | Mode | Endpoint |
|---|---|---|
| Spot detail page inline card | Geometry Analyst | `POST /api/sione/analyze` |
| Storm card L3 "Plan trip" button | Storm Planner | `POST /api/sione/sessions` |
| Storm card "Ask Sione about this storm" chip (§3.6) | Storm Planner | `POST /api/sione/sessions` |
| Spot detail "Ask Sione about this spot" chip | Geometry Analyst → conversational | `POST /api/sione/sessions` with spot context |
| Nav / keyboard shortcut / deep link without params | Generalist | `POST /api/sione/sessions` (no context body) |

**One wrinkle to resolve in code:** Geometry Analyst has two output modes — structured JSON (the inline card) and conversational (the follow-up chip). Implementation: the mode's system prompt conditionally appends a "respond in JSON matching schema X" instruction based on `output_format` in the request. Same brain, two response shapes.

---

## 3. Endpoints

### 3.1 `POST /api/sione/analyze` — structured output, cached

```
POST /api/sione/analyze
Body: {
  "context_type": "spot",         // only "spot" for v1; "storm" reserved for future
  "spot_slug": "mavericks",
  "output_schema": "sione.analyze.spot.v1",
  "force_refresh": false          // admin-only, bypasses cache
}

Response (200):
{
  "mode": "spot_geometry",
  "schema": "sione.analyze.spot.v1",
  "analysis": { /* full JSON per output contract */ },
  "cached": true,
  "computed_at": "2026-04-01T12:00:00Z",
  "ttl_expires": "2026-05-01T12:00:00Z"
}
```

- Cache key: `sione:analyze:{context_type}:{id}:{schema_version}`
- TTL: 30 days for spot analysis, recomputed sooner if admin edits spot or mode prompt
- Idempotent GET-shaped semantics despite POST (enables request-body context without URL bloat)
- Returns 503 with `{ "fallback": "show empty state" }` if LLM call fails and no cached result exists — frontend collapses the card gracefully

### 3.2 `POST /api/sione/sessions` — conversational, streaming

```
POST /api/sione/sessions
Body: {
  "context": {
    "type": "storm_trip" | "spot_followup" | "generalist",
    /* type-specific fields per §2 */
  }
}

Response (201):
{
  "session_id": "sess_abc123",
  "mode": "storm_trip",
  "opening_message": "I see a storm forming in Gulf of Alaska…",  // deterministic template
  "url": "/sione/sess_abc123"
}
```

Subsequent turns:
```
POST /api/sione/sessions/{session_id}/messages
Body: { "content": "how early should I fly in?" }

Streams SSE/WebSocket tokens. Session context baked into system prompt at session creation; not re-sent per message.
```

Deep link entry: `GET /sione/{session_id}` loads the transcript and resumes.

### 3.3 What both endpoints share

- Auth required for `sessions` (sessions are persisted per-user). `analyze` is public read, admin write.
- Both log usage to a `sione_usage` table for billing + debugging: `user_id, mode, endpoint, tokens_in, tokens_out, latency_ms, ts`.
- Both honor a kill switch env flag (`SIONE_ENABLED=false`) that returns 503 immediately — useful if Anthropic API is down or we're over budget.

---

## 4. Hard boundaries — what Sione does NOT do

Sione is a **narrator**, not a forecaster. The following are always computed deterministically and passed to Sione as context, never generated by it:

| Category | Source | Why not Sione |
|---|---|---|
| Storm position, pressure, wind, sea height | `backend/high_seas.py` bulletin parser | Ground truth from NWS — reproducibility is non-negotiable |
| Swell arrival times, peak sizes, windows at regions/spots | `backend/swell_physics.py` + `storm_arrivals.py` | Physics, not opinion — LLM hallucinations here would be a product-killing bug |
| Tier classifications (firing/solid/good/fair/flat) | Threshold lookup on peak_ft | Trivial compute, must be identical for every user |
| Wind at arrival time / tide at arrival time | Open-Meteo + CO-OPS for the specific future hour | Point forecasts exist — no reason to narrate them |
| Spot score (1–5) | `backend/surf_scoring.py` composite | Deterministic scoring function, auditable |

Sione can *explain* these — "Mainland Mexico scores higher because the storm's fetch quadrant points west-southwest and the coastline angles to catch it cleanly" — but cannot originate them.

This boundary is enforced at the system-prompt level: each mode's prompt explicitly forbids generating numeric forecast claims and instructs the model to defer to the context fields. In practice, Sione's context blocks include the numbers as structured fields the model quotes back, not computes.

---

## 5. Admin panel — what changes

The existing admin panel for editing AI personas stays, with these changes:

- List view becomes a fixed 3-row table of modes (Geometry Analyst / Storm Planner / Generalist), not an add-your-own list.
- Each row is editable: system prompt, output schema version pointer, tools enabled, temperature, max tokens.
- An "Effective as of {date}" timestamp per mode. Editing bumps the timestamp; bumping invalidates the `sione_analyses` cache for that mode.
- A "Test this mode" affordance: paste a context blob, get back the response. Saves us from having to ship a mode change to see what it does.
- A schema picker per mode: `spot_geometry` can point at `sione.analyze.spot.v1` or a future `v2`. Schema changes require a migration to update cached rows (or just invalidate them).

No data loss — the existing persona rows migrate into the `spot_geometry` mode. Future persona variants become new schema versions or new modes, whichever is the right shape.

---

## 6. Data the storm-card L2 rows need — compute pipeline

For completeness (so Code doesn't have to re-derive this), here's what produces each field in the "Reachable surf" row for one `(storm, region)` pair:

| Field | Source | Notes |
|---|---|---|
| `name`, `parent` | `subregions` table (migration 012) | Static — seeded at migration time |
| `peak_ft` | `compute_storm_arrivals()` → swell_physics | Max across forecast track, per region centroid |
| `peak_period_s` | same | |
| `peak_utc` | same | UTC of the max |
| `first_arrival_utc` | same | First time energy crosses threshold at centroid |
| `window_h` | same | Hours from first_arrival to peak_utc + decay tail |
| `tier` | `tierFromPeak(peak_ft)` | Pure threshold — `>=10 firing · >=8 solid · >=6 good · >=4 fair · <4 flat` |
| `spot_count` | `subregions.spots` count filtered to `peak_ft ≥ 3` | Honest — only spots above the floor |
| `top_spots[]` | Top-N by score within the subregion | For §3.6 and potential future preview |

Per-spot (L3):

| Field | Source |
|---|---|
| `ft`, `period`, `dir` | Swell propagation at spot (offset from centroid by spot coords) |
| `first`, `peak` | Same, per-spot timing |
| `wind`, `wind_class` | Open-Meteo `hourly=windspeed_10m,winddirection_10m` at `peak_utc` for spot coords; class via `classifyWindVsSpotWindows()` |
| `tide`, `tide_class` | NOAA CO-OPS predictions at nearest tide station at `peak_utc`; class from rate of change |
| `score` | `surf_scoring.score_arrival_for_spot(arrival, spot)` — composite of size/period/direction fit × wind × tide |

None of that is Sione-generated. Sione sees the numbers as context when a user hands off from a row.

---

## 7. Workplan — Sione stand-up

Assumes Phase 4 of `MAP_V2_IMPLEMENTATION_PLAN.md` (arrivals compute) ships first so there's a real `storm_trip` context to hand off. Phases 7.1 and 7.2 can run in parallel once the rename is merged.

### 7.1 Scaffold & rename (Phase 5a — ~2 days)

- Rename `backend/routes/copilot.py` → `backend/routes/sione.py`; update imports and `main.py` registration
- Rename `frontend/src/pages/Copilot.jsx` → `Sione.jsx`; rename `components/copilot/` → `components/sione/`; update all import paths via codemod
- New route: `/sione` (old `/copilot` 301s for 90 days, then removed)
- New folder: `backend/sione/modes/` with `spot_geometry.py`, `storm_trip.py`, `generalist.py` — each exports `SYSTEM_PROMPT`, `DEFAULT_PARAMS`, `TOOLS` constants
- Migrate existing `ai_personas_spots.py::SpotSwellGeometryAnalyst` verbatim to `sione/modes/spot_geometry.py`
- Deprecate `ai_personas.py` and `ai_personas_spots*.py` — leave in tree with a `# DEPRECATED — see backend/sione/modes/` banner until the admin-panel migration lands, then delete

### 7.2 Analyze endpoint + cache table (Phase 5b — ~2 days)

- Migration `013_sione_analyses.sql`:
  ```sql
  CREATE TABLE public.sione_analyses (
      context_type   text NOT NULL,            -- 'spot' | 'storm' (future)
      context_id     text NOT NULL,            -- spot_slug, storm_id, etc.
      schema         text NOT NULL,            -- 'sione.analyze.spot.v1'
      analysis       jsonb NOT NULL,
      computed_at    timestamptz NOT NULL DEFAULT now(),
      ttl_expires    timestamptz NOT NULL,
      PRIMARY KEY (context_type, context_id, schema)
  );

  CREATE INDEX idx_sione_analyses_ttl ON public.sione_analyses (ttl_expires);
  ```
- `backend/routes/sione.py`:
  - `POST /api/sione/analyze` — cache lookup → serve or fall through to LLM call → write back
  - `POST /api/sione/analyze/refresh/{spot_slug}` — admin-only force refresh
- Mode runner: `backend/sione/runner.py` — one function `run_mode(mode_name, context, output_format) -> dict|str`; handles prompt assembly, model call, JSON extraction, error fallback
- Unit tests: mocked LLM call, verify context insertion, schema validation, cache hit path

### 7.3 Sessions endpoint + context handoff (Phase 5c — ~2 days)

- Extend `backend/routes/sione.py`:
  - `POST /api/sione/sessions` — accepts context per §2, picks mode, creates session row, generates deterministic opening message, returns `session_id` + `url`
  - `POST /api/sione/sessions/{id}/messages` — streams token-by-token; injects stored context into system prompt at each turn
- Migration `014_sione_sessions.sql`: `sione_sessions(id, user_id, mode, context jsonb, created_at, last_message_at)` + `sione_messages(session_id, role, content, ts)`
- Frontend:
  - `frontend/src/pages/Sione.jsx` — routes `/sione`, `/sione/:session_id`; reads URL params for context handoff
  - `frontend/src/components/sione/` — existing Copilot component tree, renamed
  - Storm card "Plan trip with Sione" CTA posts to `/api/sione/sessions`, navigates to `/sione/:session_id`
  - Deep link `/sione?storm=X&spot=Y&subregion=Z` auto-creates session on mount

### 7.4 Spot detail — inline Sione card (Phase 5d — ~1 day)

- New component `frontend/src/components/spot/SioneReadCard.jsx`:
  - Fetches `/api/sione/analyze` on mount with `{ context_type: "spot", spot_slug }`
  - Renders the analysis JSON as 3–5 scannable rows (best swell window, wind sensitivity, watch-outs, summary)
  - `<LogoPulse size={48} />` while loading
  - Collapses silently on 503 (no error text — the rest of the page works)
- "Ask Sione about this spot" chip at bottom of card → `POST /api/sione/sessions` with `{ type: "spot_followup", spot_slug }` → navigates to `/sione/:session_id`
- Slot the card back into SpotDetail (replaces the "Session Insight" placeholder in SPOT_DETAIL_V2_PLAN §4.2 for signed-out users; coexists with Session Insight for signed-in users as a separate card below it)

### 7.5 Admin-panel migration (Phase 5e — ~1 day)

- List view: swap the persona-list query for a fixed 3-row mode list
- Mode editor: reuses the existing prompt-editor UI; adds schema picker + kill-switch toggle per mode
- "Test this mode" panel: POSTs to a new `/api/sione/test` endpoint that runs the mode once with admin-provided context, returns response without caching
- Cache-invalidation button: on save, if prompt or schema changed, mark all `sione_analyses` rows for this mode as expired (set `ttl_expires = now()`)

### 7.6 Acceptance criteria (full Phase 5 rollup)

- `/api/sione/analyze` returns Geometry Analyst JSON for Mavericks within 300ms cached, <5s cold
- `/api/sione/sessions` with storm_trip context creates session in <400ms (opening message is template, not LLM)
- Storm card "Plan trip" button → user lands in Sione with storm/spot context verifiable in session record
- Spot detail page shows Sione card above the fold; chip handoff works; no error banners when the LLM is slow
- Admin edits to a mode's system prompt invalidate caches and take effect on next `/analyze` call
- Old `/copilot` URL 301s to `/sione`; Copilot references removed from visible UI (brand audit: logo doesn't change; just the assistant's name)
- Sione session persists across browser refresh via URL `session_id`

---

## 8. Open questions

1. **Trademark / domain check on "Sione"** — should clear with counsel before we merge Phase 5a. Nothing in the plan commits to the name until the rename PR lands.
2. **Sione brand voice** — Design should provide a short voice-and-tone doc (one page) that the mode prompts reference. Placeholder tone: "knowledgeable local, concise, not hyped, slightly dry." Lock this before Geometry Analyst prompt migrates, so we can polish wording in-place.
3. **Tool-call surface** — Which tools can Storm Planner actually invoke in v1? Proposed: `get_tides`, `get_forecast`, `create_alert`. `log_trip_to_journal` and `get_flights` deferred. Confirm before 7.3.
4. **Session TTL / cleanup** — How long do we keep Sione session transcripts? Suggest 90 days rolling, archive-only after that. Out of scope for Phase 5; flag for a follow-up.
5. **Usage billing / rate limits** — `sione_usage` table is logged, but is there a per-user cap? Suggest start unthrottled, add caps when cost is a real signal.

---

## 9. References

- **Spec:** `notes/STORM-card.md` — Sione handoff (§3.6, §8)
- **Spec:** `ClaudeDesign/project/SPEC-map.md` — storm marker interactivity
- **Plan:** `notes/MAP_V2_IMPLEMENTATION_PLAN.md` §5 Phase 4 (arrivals) + §6 Phase 5 (Sione)
- **Plan:** `notes/SPOT_DETAIL_V2_PLAN.md` §4.2 AI card slot
- **Source:** `backend/ai_personas_spots.py::SpotSwellGeometryAnalyst` (migrates to `backend/sione/modes/spot_geometry.py`)
- **Source:** `backend/swell_physics.py` (651 lines) — deterministic arrival compute
- **Brand:** `backend/config/ramps.json` `brand.*` — logo and typography, unchanged by rename

---

**Last updated:** 2026-04-22
