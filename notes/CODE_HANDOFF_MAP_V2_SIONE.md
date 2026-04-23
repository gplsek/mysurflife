# Code Handoff — Map V2 & Sione

**Read this first.** This is the single entry point for the Map V2 + Sione work. Everything else is referenced from here.

**Last updated:** 2026-04-22

---

## 1. Mission

Ship a new `/map` page (Leaflet-based, no WebGL, no canvas overlays) with three capabilities:

1. **Spots + buoys + storms** on one dark map, with a preview card on click and a one-shot `/api/map/bundle` endpoint powering it.
2. **Storm → surf arrival** — click a storm, see which sub-regions it delivers surf to, drill into spot-level timing.
3. **Storm → Sione handoff** — "Plan trip with Sione" CTA seeds an AI session with storm + spot context. Sione also replaces the old per-persona AI library and powers a new inline card on the spot detail page.

The windy.com-style wind/wave vector-field overlays are **explicitly out of scope** (confirmed in `ClaudeDesign/project/SPEC-map.md` §16).

---

## 2. Docs to read, in order

**Read all five before writing code.** They're mutually reinforcing — skipping any of them means you'll miss either a design constraint, a data gap, or a dependency.

1. **`ClaudeDesign/project/SPEC-map.md`** — Design spec for the map page. Authoritative for chrome, markers, clustering, z-index, state object, and the "no overlays" rule.
2. **`notes/STORM-card.md`** — Design spec for the storm card. Authoritative for the L1/L2/L3 structure, fetch-wedge geometry, forecast-track geometry, sort toggles, lazy-fetch of spots, and the Sione handoff flow (§8).
3. **`notes/MAP_V2_IMPLEMENTATION_PLAN.md`** — The phased build plan (Phase 0 → Phase 5). API contracts, migrations, acceptance criteria per phase. This is your primary roadmap.
4. **`notes/MAP_V2_DATA_GAPS.md`** — The "why" behind the new endpoints and the `spot_ratings` table. Read this to understand the N+1 scoring problem and why `/api/map/bundle` exists.
5. **`notes/SIONE_CAPABILITIES.md`** — Sione spec. Modes, endpoints, admin-panel migration, sub-phased workplan (5a–5e). **Required before Phase 5 begins.** Also explains the hard boundary on what Sione does NOT generate (all deterministic physics/forecast outputs come from existing modules).

Supporting:

- **`ClaudeDesign/project/mysurflife-storm-card.html`** — working prototype of the storm card; pixel-level reference for STORM-card.md
- **`ClaudeDesign/project/SPEC-storm-card.md`** — design spec companion to the prototype (if it diverges from `notes/STORM-card.md`, `notes/STORM-card.md` wins — it's the latest)
- **`notes/SPOT_DETAIL_V2_PLAN.md`** — the spot detail page plan. §1 and §10 were updated 2026-04-22 to un-drop AI analysis. The new `<SioneReadCard>` lands on this page per Phase 5d.
- **`CLAUDE.md`** — existing project conventions (non-negotiable code style, review priorities, canvas patterns for any non-map canvas work, etc.)

---

## 3. Current state — what's already scaffolded

As of this handoff, the following exist in the repo but are not yet wired end-to-end:

**Phase 0 — Map shell (mostly done, verify):**
```
frontend/src/pages/Map.jsx
frontend/src/components/map/
    Chrome.jsx · LeftRail.jsx · RegionChips.jsx · StatusBar.jsx · ZoomControls.jsx
    PreviewCard.jsx · StormPreviewCard.jsx
    StormMarker.js · clusterGrid.js · constants.js · markers.js
    useMapBundle.js · useMapState.js
```

**Phase 1 — Storms (partial):**
```
backend/routes/storms.py                            # exists — verify it covers /api/storms/active
backend/migrations/010_storm_observations.sql       # exists — verify it matches PLAN §2
```

**Phase 4 — Storm card + arrivals UI (scaffolded, not wired):**
```
frontend/src/components/map/
    StormCard.jsx · StormFetchWedge.jsx · StormForecastTrack.jsx
    RegionalScorecard.jsx · ArrivalSpotList.jsx · ArrivalRow.jsx
```

These are ahead of where the plan has them, which is fine — but they need the Phase 2 and Phase 4 backends underneath them to do anything. Don't assume they match STORM-card.md yet; verify against the spec before wiring.

**Not yet started:**
- Phase 2 (spot_ratings table, `/api/map/bundle`, rate_spots.py job)
- Phase 3 (favorites CRUD)
- Phase 4 backend (storm_arrivals.py, migration 012 for sub-regions)
- Phase 5 anything (rename, Sione modes, analyze endpoint, sessions, spot detail card)

---

## 4. Immediate next action

**Verify Phase 0 and Phase 1 are actually done before building on top of them.**

Concretely:

1. Run `/map` locally. Does it load CARTO Dark Matter tiles, center at `[25, -50]` zoom 2, render spots + buoys + (mock) storms with correct tier classes? Check against PLAN §1 acceptance criteria. If anything's off, close out Phase 0 first.
2. Read `backend/routes/storms.py` and `backend/migrations/010_storm_observations.sql`. Do they match the PLAN §2 contract exactly? In particular — does `/api/storms/active` return `fetch.quadrant`, `forecast_track[]`, `warning_tier`, and `sea_range_ft`? If not, close the gaps. Run the golden-file test against three real bulletins.
3. Only once 1+2 are green, start **Phase 2** — the `spot_ratings` table and `/api/map/bundle`. This is the biggest performance win in the plan and everything else depends on it being fast.

Order after that: Phase 3 (favorites) → Phase 4 (arrivals — matches the already-scaffolded UI) → Phase 5 (Sione, following sub-phases 5a–5e in SIONE_CAPABILITIES.md §7).

---

## 5. Known spec conflicts — flagged for you so you don't get whiplash

- **Storm marker interactivity.** `ClaudeDesign/project/SPEC-map.md` §7.3 says storm markers are ambient (`interactive: false`). `notes/STORM-card.md` §0 requires `interactive: true` so clicks open the storm card. **Resolution:** follow STORM-card.md — it's the later spec and Design confirmed the storm card is click-to-open. Update SPEC-map.md §7.3 inline when you touch the marker code, so future readers don't get confused.
- **Copilot route naming in STORM-card.md §8.** Spec still mentions `/copilot?session=` alongside "Sione" branding. **Resolution:** Sione is locked in (see SIONE_CAPABILITIES.md). Use `/sione/:session_id` throughout Phase 5. Keep a 301 from `/copilot` → `/sione` for 90 days.
- **`mysurflife-storm-card.html` vs `notes/STORM-card.md`.** Prototype HTML is pixel reference; the markdown doc is functional spec. When they disagree on behavior, the doc wins. When they disagree on pixels, the HTML wins. If they disagree on something that's clearly a bug in one, flag it before implementing.

---

## 6. Non-obvious decisions already made — don't re-litigate

These are in the docs but worth surfacing so you don't burn time questioning them:

- **No Windy-style overlays.** Confirmed out of scope per SPEC-map.md §16. The storm-centric visualization (markers + fetch wedges + forecast tracks + arrival arcs) replaces the vector field approach. Don't propose re-adding it.
- **Sione is the rename of Copilot.** Final. See MAP_V2_IMPLEMENTATION_PLAN §8 and SIONE_CAPABILITIES.md.
- **Sione does not generate forecast numbers.** Storm positions, arrival times, peak sizes, tiers, spot scores are all computed deterministically. Sione narrates them as context. Hard boundary — see SIONE_CAPABILITIES §4. If you find yourself tempted to have an LLM generate a numeric forecast claim, you've misread the plan.
- **Persona prompts migrate verbatim into Sione modes.** Don't rewrite `SpotSwellGeometryAnalyst` in Phase 5a. Move it. Polish later if needed.
- **`sione_analyses` cache TTL is 30 days** for spot analysis. At handful-of-beta-users scale this means ~1 LLM call per spot per month. Don't shorten it without a reason.
- **Sub-regions are a new `subregion_key` column on `spots` + `subregions` table.** Not a join table. See PLAN §5 migration 012.

---

## 7. Blockers needing user input — do not start these without clearing

| Blocker | Blocks | How to clear |
|---|---|---|
| Trademark/domain clearance on "Sione" | Phase 5a merge | User to confirm (or route to counsel). Not required to *start* scaffolding — required before the rename PR merges to main. |
| Sione voice-and-tone one-pager from Design | Phase 5a prompt wording | Ask user. If not available, use placeholder voice ("knowledgeable local, concise, not hyped, slightly dry") and flag for polish pass. |
| Which tools Storm Planner mode can call | Phase 5c | Proposed list: `get_tides`, `get_forecast`, `create_alert`. `log_trip_to_journal` + `get_flights` deferred. Confirm with user before shipping 5c. |
| NHC GeoJSON integration for tropical systems | Phase 4 stretch goal | Not a Phase 4 blocker. Ship Phase 4 with bulletins-only; NHC cone is additive later. |

---

## 8. Infra note — we just upgraded

The EC2 instance moved from `t3.small` → `t3.large` (2 vCPU / 8 GB) on 2026-04-22. You now have real RAM headroom for:

- Phase 2 `rate_spots.py` tier-2/3 jobs (Open-Meteo batch fetches)
- Phase 4 `storm_arrivals.py` compute (storm × spot × forecast hour)
- Phase 5 Sione LLM calls + `sione_analyses` cache

Don't treat RAM as a constraint for v1. If a compute job needs 2–3 GB transiently, that's fine. Still keep the `NDBC_SEM` / `WIND_SEM` semaphores in place — they're about upstream rate limits, not our RAM.

---

## 9. Conventions reminder (from CLAUDE.md — mandatory)

Non-negotiables you'll hit repeatedly in this work:

- **`json_sanitize()`** on every API response that touches numpy — NaN/Inf will break the frontend silently.
- **Canvas cleanup** in `useEffect` return — leaked canvases stack up on Leaflet remount.
- **Per-pixel alpha**, never `ctx.globalAlpha` (not relevant for Map V2 directly — matters if you touch any existing layer code).
- **No hex literals** in `*Layer*.js`, `*Legend.js`, `Logo*.jsx` — import from `frontend/src/design/ramps.js`. CI-enforced.
- **`LogoPulse`, not spinners**, for every loading state. Spot-detail `SioneReadCard` uses `<LogoPulse size={48} />`.
- **Small, reviewable diffs.** No mega-PRs. Each phase is shippable on its own behind `FF_MAP_V2`.
- **Async-first** on all new backend routes. Handle `httpx.TimeoutError`, `HTTPStatusError`, `OSError` at every external boundary.

---

## 10. How to report back

When a phase is complete:
1. Update the phase's acceptance criteria in `MAP_V2_IMPLEMENTATION_PLAN.md` inline (strike through or check off).
2. If anything material diverged from the plan, add a short note explaining what and why.
3. Surface any newly-discovered blockers in this doc's §7.

If you hit a spec ambiguity not covered in §5, don't guess — flag it back up.

---

## 11. File index (quick lookup)

**Design specs (authoritative):**
- `ClaudeDesign/project/SPEC-map.md`
- `ClaudeDesign/project/SPEC-storm-card.md`
- `ClaudeDesign/project/mysurflife-storm-card.html`
- `notes/STORM-card.md`

**Plans (authoritative):**
- `notes/MAP_V2_IMPLEMENTATION_PLAN.md` — phased roadmap
- `notes/MAP_V2_DATA_GAPS.md` — data gap analysis
- `notes/SIONE_CAPABILITIES.md` — Sione spec + sub-phases
- `notes/SPOT_DETAIL_V2_PLAN.md` — spot detail page (updated for Sione card)

**Code to migrate / rename in Phase 5:**
- `backend/ai_personas.py` → deprecate
- `backend/ai_personas_spots.py` → migrates to `backend/sione/modes/spot_geometry.py`
- `backend/ai_personas_spots_openai.py` → deprecate
- `backend/routes/copilot.py` → `backend/routes/sione.py`
- `frontend/src/pages/Copilot.jsx` → `frontend/src/pages/Sione.jsx`
- `frontend/src/components/copilot/` → `frontend/src/components/sione/`

**Existing physics / data:**
- `backend/high_seas.py` — bulletin parser (needs Phase 1 enhancements)
- `backend/swell_physics.py` — 651 lines, Stormsurf calculator, ready for `storm_arrivals.py` to consume
- `backend/surf_scoring.py` — composite scoring function

---

**Questions?** Escalate to the user before building on ambiguous ground. This plan is tight but it's also opinionated — the non-obvious calls in §6 are all there for a reason.
