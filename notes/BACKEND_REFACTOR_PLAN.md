# Backend Refactor Plan — Splitting `main.py`

**Owner:** George
**Last updated:** 2026-04-26
**Status:** Proposal — sequence at your discretion. Each phase is independently shippable.

---

## TL;DR

`backend/main.py` is **4,903 lines**. The next-largest file in the backend is `swell_tables.py` at 689. Eight route modules already live under `backend/routes/` using the FastAPI `APIRouter()` pattern, but the migration stalled — roughly **4,500 lines of route handlers, helpers, and module-level state never moved**. This plan finishes that migration in four shippable phases, with no API contract breaks.

| Goal | Today | After |
|---|---|---|
| `main.py` line count | 4,903 | ~150 (bootstrap only) |
| Route modules | 8 partial | 16 complete |
| Service layer | none | `services/` for shared logic |
| Module-level state | 9 globals in `main.py` | centralized in `services/cache.py`, `services/state.py` |
| API contracts | — | unchanged (CI snapshot test enforces) |

---

## Why this matters

Three concrete pains, in order of severity:

1. **Merge friction.** Any non-trivial change to wave overlays, wind overlays, or AI analysis touches the same file. Cherry-picking, blame-walking, and resolving conflicts all suffer.
2. **Cognitive load.** New contributors (and Claude review sessions) have to load 4,903 lines of context to reason about a single endpoint. The Code Review workflow described in `CLAUDE.md` becomes much weaker because the agent can't fit the whole file in context comfortably.
3. **Testability.** Endpoint logic, caching, fetch logic, and parsing are interleaved at module scope. Unit-testing a wave-overlay parser without spinning up the FastAPI app is harder than it should be.

The CLAUDE.md non-negotiables already point this direction: *"Prefer small, reviewable diffs; avoid 'mega PRs'"* and *"Avoid breaking API contracts; version or feature-flag when needed."* Both apply to the refactor itself.

---

## Current state of `main.py` (structural map)

Mapped via the Explore agent. Line ranges are approximate and will drift as code is added.

| Lines | Section | Approx. size | Notes |
|---|---|---:|---|
| 1–50 | Bootstrap, FastAPI app, CORS, router includes | 50 | Stays in `main.py` |
| 58–310 | Module-level state: caches, semaphores, in-flight dedup, sione sessions | 250 | 9 globals — biggest extraction target |
| 314–915 | Buoy endpoints (`/api/buoy-status/all`, `/api/buoy-history`, `/api/buoy-forecast`, etc.) | 600 | Note: `buoy_service.py` already exists but is small (113 lines, map-bundle-only) |
| 1355–1769 | Wind overlay endpoints (`/api/wind-overlay`, `/api/wind/frames`) | 415 | OPeNDAP + caching heavy |
| 1825–3255 | Wave overlay endpoints (4 endpoints, all WW3 domains) | **1,430** | Largest single section. Domain switching, longitude normalization, multi-tier cache lookups |
| 3261–3908 | Spots / conditions endpoints (7 endpoints) | 650 | Cross-cuts buoy + wind + wave fetchers |
| 3987–4286 | AI analysis endpoints (4–5 endpoints) | 300 | Anthropic SDK, prompts inline |
| 4307–4740 | Copilot chat (`/api/copilot/chat`) | 435 | Streaming SSE, tool surface |
| 4742–4903 | Sione handoff (2 endpoints) | 160 | New, written cleanly already — easiest extraction |

The 9 globals at 58–310 deserve a closer look because they're the main reason "just move the route" doesn't work as a one-liner:

- `cache: dict[str, tuple[float, Any]]` — generic per-endpoint TTL cache (~5min buoy, ~10min wind)
- `_timeline_cache`, `_dataset_cache` — wave-specific caches with their own eviction
- `_in_flight_requests: dict[str, asyncio.Future]` — request deduplication (Task D pattern)
- `NDBC_SEM = asyncio.Semaphore(12)` — buoy concurrency
- `WIND_SEM = asyncio.Semaphore(2)` — wind overlay processing
- `TIMELINE_SEM = asyncio.Semaphore(5)` — timeline pre-warming
- `_sione_sessions: dict[str, SioneSession]` — in-process Sione conversation state
- A handful of `_redis_client` / lazy-init helpers

Anything that imports these from `main` creates a circular-import risk during extraction. The plan handles this in Phase 1.

---

## Target structure

```
backend/
├── main.py                          # ~150 lines: app, CORS, router includes, lifespan hooks
├── config.py                        # constants (TTLs, semaphore sizes, sentinel values)
├── routes/
│   ├── __init__.py
│   ├── admin.py                     # (exists)
│   ├── alerts.py                    # (exists)
│   ├── auth.py                      # (exists)
│   ├── favorites.py                 # (exists)
│   ├── map.py                       # (exists — /api/map/bundle)
│   ├── sessions.py                  # (exists)
│   ├── storms.py                    # (exists)
│   ├── user_spots.py                # (exists)
│   ├── buoys.py                     # NEW — buoy status / history / forecast
│   ├── wind.py                      # NEW — wind overlays + frames
│   ├── waves.py                     # NEW — wave overlays (4 endpoints)
│   ├── spots.py                     # NEW — spot conditions
│   ├── ai_analysis.py               # NEW — analysis endpoints
│   ├── copilot.py                   # NEW — streaming chat
│   └── sione.py                     # NEW — Sione handoff
└── services/
    ├── __init__.py
    ├── cache.py                     # generic TTL cache + Redis facade + dedup
    ├── state.py                     # semaphores, sione sessions, lifespan-managed
    ├── buoy_service.py              # EXTEND existing (currently 113-line map helper)
    ├── wind_service.py              # OPeNDAP + grid math for wind models
    ├── wave_service.py              # OPeNDAP + grid math for WW3
    ├── spot_service.py              # spot scoring orchestration
    └── ai_service.py                # Anthropic client wrapper, prompt loading
```

The split is **routes = HTTP shape** (FastAPI decorators, request/response models, error mapping), **services = work** (fetching, caching, parsing, computing). Routes call services. Services don't import from routes.

---

## Phased migration

Each phase ends in a deployable commit. Each phase is sized to fit "small, reviewable diff" — the largest single PR is Phase 3 (waves) at roughly 1,500 lines moved, which is unavoidable given that's the largest section.

### Phase 1 — Foundation: extract globals into `services/`

**Goal:** Eliminate the module-level state in `main.py` so subsequent phases don't have to keep importing from `main`.

**Work:**

1. Create `backend/services/__init__.py`, `cache.py`, `state.py`.
2. Move `cache`, `_timeline_cache`, `_dataset_cache`, `_in_flight_requests` into `services/cache.py` as a `CacheRegistry` class with three named caches and a `get_or_fetch_dedup(key, fetcher)` helper.
3. Move `NDBC_SEM`, `WIND_SEM`, `TIMELINE_SEM`, `_sione_sessions`, `_redis_client` into `services/state.py`. Initialize via FastAPI lifespan (so we can clean up the Redis pool on shutdown).
4. Move TTL constants and sentinel values into `config.py`.
5. Add a thin compatibility shim in `main.py` that re-exports the names that route handlers still inside `main.py` import (so we don't break Phase 2 mid-flight).

**Acceptance:**

- `main.py` shrinks by ~250 lines.
- All existing endpoints still respond identically (snapshot tests — see Verification below).
- `grep "^cache = " backend/main.py` returns nothing.

**Risk:** Lifespan-managed semaphores need to outlive a single request. Easy to get wrong if you instantiate them inside `lifespan()` instead of at module load.

---

### Phase 2 — Easy wins: extract Sione, AI analysis, copilot

**Goal:** Move three sections that are largely self-contained and recently written. Builds confidence in the migration before tackling the big ones.

**Work:**

1. Create `routes/sione.py`. Move the two Sione endpoints. Should be a near-copy-paste — the Sione code already uses `services/state.py` for session storage after Phase 1.
2. Create `routes/ai_analysis.py`. Move 4–5 analysis endpoints. Extract the Anthropic client init into `services/ai_service.py` (so prompts and model IDs are in one place).
3. Create `routes/copilot.py`. Move the streaming chat endpoint. The SSE generator stays in the route file; tool dispatch moves to `services/ai_service.py`.
4. Register the three new routers in `main.py`.

**Acceptance:**

- 3 new files under `routes/`, 1 new file under `services/`.
- `main.py` shrinks by ~895 lines.
- `/api/sione/*`, `/api/ai-analysis/*`, `/api/copilot/chat` all respond identically.

**Risk:** SSE streaming has subtle semantics — buffering, keepalive, close-on-disconnect. Test against the actual frontend, not just curl.

---

### Phase 3 — The big one: extract wave overlays

**Goal:** Move the largest section (1,430 lines) into `routes/waves.py` + `services/wave_service.py`.

**Work:**

1. Create `services/wave_service.py`. Move OPeNDAP fetchers, longitude normalization, NaN sanitization helpers, and the WW3 grid registry loader.
2. Create `routes/waves.py`. Move 4 endpoints (`/api/waves-overlay`, `/api/waves/run-availability`, etc.).
3. Caches stay under their existing keys in `services/cache.py` — endpoints call `cache.get_or_fetch_dedup(...)` instead of using globals.
4. The `_round_bbox` helper from CLAUDE.md goes into `services/wave_service.py` (since it's wave-specific in current usage; if wind also needs it, hoist to a shared `services/geo.py`).

**Acceptance:**

- `main.py` shrinks by ~1,430 lines.
- All wave overlay responses byte-identical to pre-refactor (snapshot test).
- WW3 grid registry still loads from `ww3_grid_registry.json`.

**Risk:** This is the single largest diff. Two specific landmines:

- **Longitude normalization** (CLAUDE.md "Common Pitfalls" #5). The 0–360 → -180–180 dance for WW3 is easy to lose in a copy-paste. Snapshot test must include a Pacific-crossing bbox to catch a broken conversion.
- **JSON sanitization** (CLAUDE.md "Common Pitfalls" #3). `json_sanitize()` must wrap every response. If it currently lives in `main.py`, move it to `services/__init__.py` as a shared utility before this phase.

**Mitigation:** Land Phase 3 behind a feature flag for one deploy cycle if you want extra paranoia. Not strictly necessary if snapshot tests pass.

---

### Phase 4 — Finish: buoys, wind, spots

**Goal:** Empty `main.py` of route handlers entirely.

**Work:**

1. Create `routes/buoys.py` + extend `services/buoy_service.py`. The existing `buoy_service.py` (113 lines) is a focused map-bundle helper — keep that surface, add the larger fetchers from `main.py` lines 314–915. Watch for name collisions.
2. Create `routes/wind.py` + `services/wind_service.py`. Mirror the wave structure from Phase 3.
3. Create `routes/spots.py` + `services/spot_service.py`. Spots is cross-cutting — it pulls from buoy + wind + wave services — so it needs them all to exist first, hence sequencing it last.
4. Final `main.py` should be ~150 lines: imports, app creation, CORS, router registration, lifespan hooks. Nothing else.

**Acceptance:**

- `wc -l backend/main.py` < 200.
- All routes registered, all snapshot tests pass.
- `backend/services/` has 6 modules with clear responsibilities.

**Risk:** `routes/spots.py` is the most cross-cutting and the one most likely to surface circular-import issues. If `services/spot_service.py` accidentally imports from `routes/spots.py` (or vice versa via a typed pydantic model), Python will complain at startup. Keep request/response models in the route file, scoring logic in the service.

---

## What stays in `main.py`

Roughly 150 lines:

- FastAPI app instantiation
- CORS middleware
- Router includes
- Lifespan hook (Redis pool, scheduled task warmup, graceful shutdown)
- A handful of root-level health endpoints (`/`, `/health`)
- Logging setup if any

That's it. No business logic, no caches, no fetchers, no semaphores.

---

## Verification strategy

Two layers of safety net.

**1. Endpoint contract snapshot tests.** Before touching anything, capture the JSON response shape (not values — shapes) for every endpoint via a script:

```bash
python scripts/snapshot_api_contracts.py > tests/contracts/baseline.json
```

After each phase, re-run and `diff` against baseline. Any structural change is a fail. The script should hit:

- `/api/buoy-status/all` (representative buoy)
- `/api/buoy-history/46266?hours=24`
- `/api/buoy-forecast/46266?hours=120`
- `/api/wind-overlay?model=hrrr&forecast_hour=6&bounds=...`
- `/api/waves-overlay?source=global&forecast_hour=24&bounds=...` (Pacific-crossing)
- `/api/waves-overlay?source=nearshore&...`
- `/api/wind/frames?model=gfs`
- `/api/waves/run-availability`
- `/api/storms/active`
- `/api/sione/sessions` (POST)
- `/api/copilot/chat` (POST, streaming — capture first 5 SSE events)

**2. Smoke deploy.** After Phase 1 and Phase 3 specifically, do a smoke deploy to staging and click through Map.jsx with the dev console open. Look for:

- Wind/wave canvas layers render at all zoom levels.
- Time slider scrubs without errors.
- Storm markers populate.
- Sione drawer opens and the opening message renders.

---

## What this plan does NOT do

Out of scope, listed so they're not forgotten:

- **Type-checking pass.** Adding mypy / pyright across the new modules is worthwhile but should be a separate effort.
- **Test coverage uplift.** This refactor preserves behavior. Adding unit tests for the newly-extracted services is a natural follow-up but doesn't gate the migration.
- **Async cleanup.** `httpx.AsyncClient()` is created per-request in several places. Hoisting to a shared client with connection pooling would be a perf win but is decoupled from the structural split.
- **Pydantic model consolidation.** Many endpoints declare ad-hoc dicts. Promoting them to typed models is post-refactor work.
- **Breaking up `swell_tables.py` (689 lines).** Second-largest file, but well-organized internally. Defer.

---

## Sequencing recommendation

If you do one phase per week:

| Week | Phase | Lines moved | Risk |
|---|---|---:|---|
| 1 | Phase 1 — services foundation | ~250 | Medium (lifespan-managed state) |
| 2 | Phase 2 — Sione + AI + copilot | ~895 | Low |
| 3 | Phase 3 — waves | ~1,430 | High (largest diff, OPeNDAP edge cases) |
| 4 | Phase 4 — buoys + wind + spots | ~1,800 | Medium (cross-cutting) |

If you want a faster path: Phases 1+2 can be combined in a single week without much added risk. Phase 3 should always be its own PR.

---

## Open questions

1. **Module naming.** I've used `services/` to mirror common Python convention; if you prefer `lib/` or `core/`, swap before starting. Cosmetic only.
2. **Should wave + wind share a `services/opendap.py` for the common fetcher?** Probably yes, but only after both are extracted and the duplication is visible. Don't pre-factor.
3. **Where does `json_sanitize` live?** Today it's in `main.py`. Proposal: `services/__init__.py` as a top-level utility, since every service that builds a response dict needs it.
4. **Background tasks.** If we eventually run timeline pre-warming as a periodic background job (currently kicked off from request handlers), it should live in `services/state.py` or a new `services/scheduler.py`. Worth deciding before Phase 3 because wave timelines are the heaviest pre-warm candidate.

---

## Companion documents

- `notes/GLOBAL_STORM_DETECTION_PLAN.md` — the wind-field cyclone detector. Lands in `services/storm_detection_service.py` after Phase 1.
- `notes/STORM_SIONE_HANDOFF.md` — the Sione storm-trip flow. Already lives cleanly; Phase 2 extracts it.
- `notes/STORM_COVERAGE_BUGS.md` — the bulletin-pipeline bugs. Bug 4 (storm_id collisions) gets easier to fix once Phase 4 puts the helpers in `services/storm_service.py`.
