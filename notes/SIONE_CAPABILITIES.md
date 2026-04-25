# Sione — Capabilities & Workplan

**Audience:** Code (backend + frontend), Design
**Purpose:** Single source of truth for what Sione is, what it does, and how it plugs into the product. Supersedes the per-persona architecture that lived in `backend/ai_personas.py` and `backend/ai_personas_spots.py`.
**Status:** Draft — 2026-04-24. Workplan at §7.

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
- **Provider:** Claude + OpenAI during eval (see §2.5); JSON schema identical across providers; cached analysis is provider-agnostic from Sione's perspective.

### 2.2 Storm Planner (`mode=storm_trip`)

- **What it does:** Given a storm × region × spot × arrival context, helps the user decide whether to travel, when to go, and what to watch for. Runs follow-up conversations.
- **Source prompt:** New — written for the storm-card handoff flow per STORM-card.md §8. Draft prompt in `backend/sione/modes/storm_trip.py`.
- **Context in:** `{ storm_id, storm_summary, target_subregion, target_spot, arrival (first/peak/size/period/window), user_home_coords? }` — populated from `/api/storms/{id}/arrivals` response plus user profile.
- **Output contract:** Natural-language conversational. Opening message is deterministic template (server-side string), not LLM-generated, so it renders instantly.
- **Invoked from:** `POST /api/sione/sessions` with the context block; "Plan trip with Sione" CTA on storm card L3 spot row (STORM-card.md §8).
- **Tools available in this mode:** `get_tides`, `get_forecast`, `create_alert`, `log_trip_to_journal`. `get_flights` deferred to a later milestone.
- **Provider:** Claude only (see §2.5). Conversational modes stay on a single provider so tool-call plumbing and streaming behaviour are consistent.
- **Cadence & cache:** No caching — conversational. Store sessions in `sione_sessions` table for resumability.

### 2.3 Generalist (`mode=generalist`)

- **What it does:** Open-ended surf Q&A for users who land in Sione without context. Can pivot into any mode once context is established (e.g., user mentions a specific spot → Sione silently loads Geometry Analyst context for subsequent turns).
- **Source prompt:** New, shorter — establishes Sione as a surf-native assistant, capable of explaining conditions, recommending regions, narrating forecasts. No persona ornaments beyond the brand voice.
- **Context in:** User's location (if consented), recent favorites, last session's target spot. Thin context.
- **Output contract:** Natural-language conversational.
- **Invoked from:** Cold-open chat (nav link, keyboard shortcut), or when deep-linking into Sione without storm/spot params.
- **Provider:** Claude only (see §2.5).
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

### 2.5 Provider strategy

Sione is **provider-agnostic at the boundary** — modes call a thin `llm.complete(provider, model, …)` seam in `backend/sione/providers/` so the rest of the stack (routes, cache, admin panel, frontend card) never branches on which vendor served the response.

**Current state (eval phase):**

| Mode | Provider(s) | Why |
|---|---|---|
| `spot_geometry` (structured JSON) | Claude **and** OpenAI, side-by-side | Structured output + schema validation — safe to A/B. Each spot can hold one cached analysis per provider so admins can diff them. |
| `storm_trip` | Claude only | Tool-calling + streaming stability; not worth maintaining two tool-call plumbings during eval. |
| `generalist` | Claude only | Same reasoning. |

**End state:** After ~30–40 paired spot analyses we pick one provider for `spot_geometry` based on an internal rubric (reasoning quality, hallucination rate on place names, latency, cost per analysis, JSON-schema compliance rate). The losing provider's code stays in the repo as a dormant adapter, but we stop spending tokens on it.

**Non-negotiables:**

- **Schema contract is frozen.** Both providers must emit `sione.analyze.spot.v1` byte-for-byte. Any deviation is a bug, not a feature — the cache, the inline card, and future consumers do not see provider differences.
- **Prompts are co-owned.** Mode prompts live per-provider (`backend/sione/modes/spot_geometry/claude.md`, `.../openai.md`) because each vendor has different system-prompt conventions, tool-call formatting, and JSON-mode behaviour. The semantic content is identical; the wrapper is provider-specific.
- **Cost + latency tracked per provider.** `sione_usage` gets `provider` and `model` columns; admin dashboard can filter so the eval decision is backed by real numbers, not vibes.
- **Kill switches are per-provider.** `SIONE_PROVIDER_CLAUDE=false` and `SIONE_PROVIDER_OPENAI=false` env flags let us pull one vendor without pulling Sione. If both are false, routes 503.

---

## 3. Endpoints

### 3.1 `POST /api/sione/analyze` — structured output, cached

```
POST /api/sione/analyze
Body: {
  "context_type": "spot",         // only "spot" for v1; "storm" reserved for future
  "spot_slug": "mavericks",
  "output_schema": "sione.analyze.spot.v1",
  "provider": "claude",           // "claude" | "openai" | "default" (server picks current primary)
  "force_refresh": false          // admin-only, bypasses cache
}

Response (200):
{
  "mode": "spot_geometry",
  "schema": "sione.analyze.spot.v1",
  "provider": "claude",
  "model": "claude-opus-4-6",
  "analysis": { /* full JSON per output contract */ },
  "cached": true,
  "computed_at": "2026-04-01T12:00:00Z",
  "ttl_expires": "2026-05-01T12:00:00Z"
}
```

- Cache key: `sione:analyze:{context_type}:{id}:{schema_version}:{provider}` — one cached row per provider per spot during eval; after consolidation the primary provider's row is what users see
- TTL: 30 days for spot analysis, recomputed sooner if admin edits spot or mode prompt
- Idempotent GET-shaped semantics despite POST (enables request-body context without URL bloat)
- Returns 503 with `{ "fallback": "show empty state" }` if LLM call fails and no cached result exists — frontend collapses the card gracefully
- Public read always serves the **primary** provider's cached row (currently Claude); `provider=openai` is admin-only until consolidation

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
- Both log usage to a `sione_usage` table for billing + debugging: `user_id, mode, endpoint, provider, model, tokens_in, tokens_out, latency_ms, ts`.
- Kill switches stack from coarse to fine:
  - `SIONE_ENABLED=false` — all Sione endpoints 503 (master off switch)
  - `SIONE_PROVIDER_CLAUDE=false` — skip Claude; fall back to OpenAI if that's also enabled, else 503
  - `SIONE_PROVIDER_OPENAI=false` — same logic, other direction
- Per-mode kill switches live in the admin panel (see §5), not env flags, so we can toggle without a deploy.

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

### 4.5 Sione's tool surface

The existing `backend/copilot.py` already implements a well-tuned tool-use layer — 7 data tools, a `respond` structured-output tool, tool-registry dependency injection, iteration cap, timing instrumentation. Sione's migration keeps all of it and adds what's needed for the three-mode structure.

**Per-mode tool allowlists.** Each mode gets a curated subset. Tools not on the allowlist aren't sent in the `tools` parameter — saves ~50–150 tokens per omitted tool in the system prompt and prevents safety-sensitive calls from the wrong mode.

| Tool | `spot_geometry` | `storm_trip` | `generalist` |
|---|:-:|:-:|:-:|
| `get_spot_conditions` | — | ✓ | ✓ |
| `get_conditions_window` | — | ✓ | ✓ |
| `get_buoy_history` | — | ✓ | ✓ |
| `compare_spots` | — | ✓ | ✓ |
| `rank_spots` | — | — | ✓ |
| `calculate_swell_arrival` | — | ✓ | ✓ |
| `list_active_storms` (new) | — | ✓ | ✓ |
| `get_storm_arrivals` (new) | — | ✓ | ✓ |
| `get_tides` (new) | — | ✓ | ✓ |
| `create_alert` (new, write) | — | ✓ | — |
| `save_session` | — | — | ✓ (auth'd) |
| `respond` | N/A (structured JSON output) | ✓ | ✓ |

`spot_geometry` uses zero tools — it's a one-shot structured JSON analysis, no tool loop. The other two modes enter the tool loop from `copilot.py` (renamed to `backend/sione/runner.py`).

**New tools for `storm_trip`.** All four wrap existing backend routes — no new business logic:

- `list_active_storms()` → `GET /api/storms/active` (from `backend/routes/storms.py`)
- `get_storm_arrivals(storm_id)` → `GET /api/storms/{id}/arrivals`
- `get_tides(spot_id, start_utc, hours=12)` → CO-OPS predictions helper (new internal wrapper around the tide source already used in arrival scoring)
- `create_alert(spot, condition, threshold, confirmed=False)` → `POST /api/alerts` (from `backend/routes/alerts.py`). **Write tool** — follows the confirmation gate below.

**Write-tool confirmation gate.** Tools whose name starts with a write verb (`create_`, `save_`, `delete_`, `update_`) follow a two-step pattern. First call returns `{preview: true, summary, confirm_token}` instead of performing the write. The model renders it as a confirmation artifact (`alert_preview`, `session_preview`, etc.) in the `respond` payload. On user approval, a second tool call with `confirmed=true` and the server-signed `confirm_token` performs the actual write. The token is signed server-side so the model can't forge it, and scoped to the specific `(user_id, tool_name, args_hash)` so it can't be reused for a different operation. `save_session` is backported to this pattern during Sione migration (currently it writes on first call — a pre-existing foot-gun).

**Prompt caching.** Two-line change, real cost impact. Add `cache_control: {"type": "ephemeral"}` to both:
- The `SYSTEM_PROMPT` text block (~1,500 tokens per mode)
- The final entry in the `tools` array (Claude caches the whole array through that breakpoint; ~1,200 tokens)

Turn 2+ inside a session's 5-minute window pays 10% of the cached-portion cost instead of 100%. At ~3,000 conversational turns/month on Sonnet, that's roughly **$20/month saved** for a two-line change. Stacks with the Batch API discount on `spot_geometry`.

**Per-session tool-result cache.** In-memory dict keyed by `(tool_name, sorted_json(args))` with 5-minute TTL, lives on the session object. Prevents duplicate OPeNDAP fetches and duplicate large JSON blobs cluttering the conversation history when the user asks about the same spot across turns. Cleared on session end.

**Provider abstraction.** Tool definitions are authored in Claude's native shape (`input_schema`). A thin adapter in `backend/sione/providers/tools.py` rewrites to OpenAI's `{type: "function", function: {parameters}}` format when the provider is `openai`. Tool implementations themselves are provider-agnostic — they take kwargs, return dicts. Only the wire format switches.

**Observability + safety caps.**

- Each tool call logs to `sione_usage` with `tool_name, args_hash, latency_ms, status` alongside token counts.
- `MAX_TOOL_ITERATIONS = 8` stays (current copilot.py default).
- Per-tool rate limits enforced in the runner (e.g. max 3 `rank_spots` per session — expensive and often redundant).
- Admin dashboard surfaces: most-called tools, tools-per-session distribution, tool failure rates, write-tool confirm/cancel ratio.

**Streaming + tool use.** When Sione's runner moves to `messages.stream()` (Phase 7.3 streaming requirement), the tool loop must interleave: stream text deltas to the client until a `tool_use` block completes, pause the stream, execute the tool, emit a `tool_result` frame to the client ("fetching conditions at Blacks…"), resume streaming with tool results injected. Users see Sione's reasoning happen live — not a 15-second spinner followed by a wall of text.

**What not to build.** Anti-patterns to skip: custom tool DSL or plugin system (JSON schema + Python functions is fine under ~25 tools); tool-call DAG planners; automatic retry-with-backoff on tool failures (the model handles error returns gracefully by trying a different approach or asking the user).

---

## 5. Admin panel — what changes

The existing admin panel for editing AI personas stays, with these changes:

- List view becomes a fixed 3-row table of modes (Geometry Analyst / Storm Planner / Generalist), not an add-your-own list.
- Each row is editable: system prompt (per provider — tabs for Claude / OpenAI where both are active), output schema version pointer, tools enabled, temperature, max tokens.
- An "Effective as of {date}" timestamp per mode. Editing bumps the timestamp; bumping invalidates the `sione_analyses` cache for that mode.
- A "Test this mode" affordance: paste a context blob, pick a provider from a dropdown, get back the response. Saves us from having to ship a mode change to see what it does.
- A schema picker per mode: `spot_geometry` can point at `sione.analyze.spot.v1` or a future `v2`. Schema changes require a migration to update cached rows (or just invalidate them).
- **Compare mode (spot_geometry only, eval phase):** An admin action on the spot admin page — "Run Claude + OpenAI side-by-side" — that fires `/api/sione/analyze` once per provider, displays both analyses in a two-column diff view, and lets the admin pick a winner. The winner is written to cache as the primary; both rows are kept in `sione_analyses` for offline rubric scoring. Disappears once we consolidate.

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

Complete rename of every Copilot surface to Sione. Do this as one PR so the diff is reviewable and the 301 lands atomically.

#### Backend

| Before | After | Notes |
|---|---|---|
| `backend/copilot.py` | `backend/sione/runner.py` | Move into the new package; keep public API (`handle_chat`) for now, deprecate after §7.3 |
| `_copilot_*` helper functions in `main.py` | `_sione_*` | Bulk rename — `_copilot_get_spot_conditions` → `_sione_get_spot_conditions`, etc. |
| `class CopilotMessage` in `main.py` | `class SioneMessage` | |
| `class CopilotChatRequest` in `main.py` | `class SioneChatRequest` | |
| `# COPILOT — /api/copilot/chat` section header | `# SIONE — /api/sione/...` | Comment block update |
| `POST /api/copilot/chat` endpoint | `POST /api/sione/sessions/{id}/messages` (§7.3) | Old URL 301s for 90 days; wire the 301 in this PR so it's live from day one |
| `log_method: "copilot"` in session inserts | `log_method: "sione"` | Two callsites in `main.py` |
| `from copilot import handle_chat as _copilot_handle_chat` | `from sione.runner import handle_chat as _sione_handle_chat` | |
| Docstring references in `swell_physics.py`, `high_seas.py`, `swell_tables.py` | "Sione" | Comment-only; do in-place sed pass |
| Test file: `test_copilot_*` functions in `test_smoke.py` | `test_sione_*` | Update endpoint URL from `/api/copilot/chat` → new endpoint or keep old URL until 301 is removed |

New `backend/sione/` package structure (created in this phase):
```
backend/sione/
  __init__.py
  runner.py          ← copilot.py moved here; handle_chat + tool loop (extended for streaming in §7.3)
  modes/
    __init__.py
    spot_geometry.py ← migrated from ai_personas_spots.py::SpotSwellGeometryAnalyst (verbatim); TOOL_ALLOWLIST = []
    storm_trip.py    ← new (stub in this phase; filled in §7.3). TOOL_ALLOWLIST per §4.5
    generalist.py    ← new (stub in this phase; filled in §7.3). TOOL_ALLOWLIST per §4.5
  tools/             ← tool catalog moved from copilot.py::TOOL_DEFS
    __init__.py
    catalog.py       ← JSON-schema tool defs (Claude shape); 7 existing + 4 new (§4.5)
    registry.py      ← name → async callable dispatch (existing pattern from main.py:4717)
  providers/         ← thin llm.complete() seam (see §2.5); created in this phase
    __init__.py
    claude.py        ← wraps AsyncAnthropic; respects SIONE_PROVIDER_CLAUDE flag
    openai.py        ← wraps AsyncOpenAI; respects SIONE_PROVIDER_OPENAI flag
    tools.py         ← adapter: Claude-shape tool defs → OpenAI-shape on demand
    base.py          ← get_provider(name) dispatch + kill-switch enforcement
```

Deprecate `ai_personas.py` and `ai_personas_spots*.py` — add `# DEPRECATED — see backend/sione/modes/` banner. Delete after §7.5 admin-panel migration lands.

#### Frontend

| Before | After | Notes |
|---|---|---|
| `frontend/src/screens/Copilot.jsx` | `frontend/src/screens/Sione.jsx` | File rename |
| `import Copilot from './screens/Copilot'` in `App.js` | `import Sione from './screens/Sione'` | |
| `const CopilotIcon` in `App.js` | `const SioneIcon` | Component rename; SVG unchanged |
| `view === 'copilot'` state checks in `App.js` (×3) | `view === 'sione'` | |
| `{view === 'copilot' && <Copilot />}` in `App.js` | `{view === 'sione' && <Sione />}` | |
| Nav button label `"Copilot"` in `App.js` | `"Sione"` | |
| Route `path="/copilot"` in `App.js` | `path="/sione"` + add `<Route path="/copilot" element={<Navigate to="/sione" replace />} />` | 301 equivalent in React Router |
| `{ id: 'copilot', path: '/copilot', label: 'Copilot' }` in `NavDrawer.jsx` | `{ id: 'sione', path: '/sione', label: 'Sione' }` | |
| `CopilotDemo` component in `Home.jsx` | `SioneDemo` | Component rename |
| All visible text `"Copilot"` in `Home.jsx` (~10 occurrences) | `"Sione"` | Section headings, body copy, footer link |
| Section anchor `id="copilot"` + `href="#copilot"` in `Home.jsx` (×3) | `id="sione"` / `href="#sione"` | |
| `aria-label="Animated Copilot demo"` in `Home.jsx` | `aria-label="Animated Sione demo"` | |
| `mysurflife / copilot` demo header string in `Home.jsx` | `mysurflife / sione` | |
| DevPrimitives `"ConditionsGrid — showTabs=false (Copilot)"` label | `"... (Sione)"` | Comment/label only |

#### CSS class prefix

All `cop-` prefixed classes in `shell.css` (191 occurrences) and `Sione.jsx` (177 occurrences) rename to `si-`:

```
cop-screen         → si-screen
cop-rail           → si-rail
cop-conv           → si-conv
cop-thread         → si-thread
cop-msg            → si-msg
cop-chip           → si-chip
cop-artifact       → si-artifact
cop-sess-*         → si-sess-*
... (all cop- prefixes)
```

Do this with a global find-and-replace scoped to `shell.css` and `Sione.jsx` only — no other files use `cop-` classes. Verify with `grep -r "cop-" frontend/src` after the pass to confirm no strays.

#### Home.css + DevPrimitives

`Home.css` has two `/* ── COPILOT ── */` section comments — update to `/* ── SIONE ── */`. DevPrimitives has one label string. Both are cosmetic.

#### Acceptance criteria for Phase 5a

- `grep -r "Copilot\|copilot\|/copilot\|cop-" frontend/src` returns zero results in visible UI text, route strings, and CSS class names (comments excluded)
- `grep -r "copilot" backend/` returns zero results outside of comments and the 301 shim
- `/copilot` → `/sione` redirect works in browser
- `/api/copilot/chat` returns 301 → `/api/sione/sessions`
- All smoke tests pass under new endpoint name
- `log_method = "sione"` in new session rows (verify via DB query)

### 7.2 Analyze endpoint + cache table (Phase 5b — ~2 days)

- Migration `013_sione_analyses.sql`:
  ```sql
  CREATE TABLE public.sione_analyses (
      context_type   text NOT NULL,            -- 'spot' | 'storm' (future)
      context_id     text NOT NULL,            -- spot_slug, storm_id, etc.
      schema         text NOT NULL,            -- 'sione.analyze.spot.v1'
      provider       text NOT NULL,            -- 'claude' | 'openai'
      model          text NOT NULL,            -- 'claude-opus-4-6', 'gpt-4o', etc.
      analysis       jsonb NOT NULL,
      is_primary     boolean NOT NULL DEFAULT false,  -- served to public read; one per (context_type, context_id, schema)
      computed_at    timestamptz NOT NULL DEFAULT now(),
      ttl_expires    timestamptz NOT NULL,
      PRIMARY KEY (context_type, context_id, schema, provider)
  );

  CREATE INDEX idx_sione_analyses_ttl ON public.sione_analyses (ttl_expires);
  CREATE UNIQUE INDEX idx_sione_analyses_primary
      ON public.sione_analyses (context_type, context_id, schema)
      WHERE is_primary;
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
- **Streaming is mandatory, not optional.** The non-streaming Copilot UX (spinner → wall of text) is the thing users feel as "slow". Implementation:
  - Backend uses `anthropic.AsyncAnthropic().messages.stream(...)` inside a FastAPI `StreamingResponse` with `media_type="text/event-stream"`
  - SSE frames: `{"type":"token","text":"..."}` per chunk, terminated by `{"type":"done","usage":{...}}`; errors yield `{"type":"error","message":"..."}` in-band
  - Apache reverse proxy must set `flushpackets=on` on the `/api/` location, plus response headers `Cache-Control: no-cache`, `X-Accel-Buffering: no`, `Connection: keep-alive`
  - Frontend consumes via `fetch` + `ReadableStream` (not `EventSource`, because we need POST + auth headers); see `useSioneStream()` hook in `frontend/src/components/sione/useSioneStream.js`
  - Full assistant reply is reassembled server-side at the `done` frame and persisted to `sione_messages` — single source of truth for session history
- Migration `014_sione_sessions.sql`: `sione_sessions(id, user_id, mode, context jsonb, provider, model, created_at, last_message_at)` + `sione_messages(session_id, role, content, ts)`
- **Tool surface wiring** (see §4.5 for the full design):
  - Move `TOOL_DEFS` out of `copilot.py` into `backend/sione/tools/catalog.py`; each mode imports its allowlist.
  - Add the four new `storm_trip` tools: `list_active_storms`, `get_storm_arrivals`, `get_tides`, `create_alert`. First three wrap existing routes (`backend/routes/storms.py`, CO-OPS helper). `create_alert` wraps `POST /api/alerts` and uses the two-step confirmation gate (`confirmed=false` → preview + signed token; `confirmed=true` + valid token → real write).
  - Backport `save_session` to the confirmation-gate pattern (currently writes on first call — pre-existing foot-gun).
  - Add `cache_control: {"type": "ephemeral"}` to `SYSTEM_PROMPT` and to the last entry in the `tools` array — ~2,700 cached tokens, ~$20/month saved at 3k turns.
  - Per-session tool-result cache: dict on the session object, keyed by `(tool_name, sorted_json(args))`, 5-min TTL.
  - Streaming + tool use interleave: stream text deltas until a `tool_use` block completes, emit a `tool_start` frame to the client ("fetching conditions at Blacks…"), run the tool, emit a `tool_result` frame, resume streaming. Use the Anthropic SDK's `messages.stream()` event loop (`content_block_delta` / `content_block_stop`).
- Frontend:
  - `frontend/src/pages/Sione.jsx` — routes `/sione`, `/sione/:session_id`; reads URL params for context handoff
  - `frontend/src/components/sione/` — existing Copilot component tree, renamed
  - Storm card "Plan trip with Sione" CTA posts to `/api/sione/sessions`, navigates to `/sione/:session_id`
  - Deep link `/sione?storm=X&spot=Y&subregion=Z` auto-creates session on mount
  - Assistant message renders token-by-token with a blinking cursor during `streaming: true`; swaps to final state on `done` frame

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
6. **Provider consolidation criteria** — when do we stop running Claude + OpenAI for `spot_geometry` and commit to one? Proposed rubric (to be finalised before Phase 5b): after **30 paired analyses** scored by the internal rubric (reasoning quality, place-name hallucination rate, JSON-schema compliance, latency, cost). If one provider wins ≥60% of the paired evals *and* is no more than 2× the cost, switch. Otherwise run another 20 and re-evaluate. Admin dashboard surfaces the running score so the decision is visible, not a private call.

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

**Last updated:** 2026-04-24
