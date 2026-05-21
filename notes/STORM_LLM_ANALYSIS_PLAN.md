# Storm LLM Analysis + Caching — Execution Plan

**Owner:** George
**Status:** 🚧 Ready to build — decisions locked 2026-05-21
**Companions:**
- `notes/STORM_DETECTION_EXECUTION_PLAN.md` — the detector this extends (Phases 1–8, shipped)
- `notes/STORM_SIONE_HANDOFF.md` — drawer → Sione design (the handoff this fixes)
- `notes/GLOBAL_STORM_DETECTION_PLAN.md` — design source of truth

---

## Why

Two problems + one feature:

1. **Storm card "AI analysis" is fake.** `region_impact.compose_narrative()` is templated string assembly ("Pure string assembly, no LLM"). Want real LLM analysis — but **not on every card load** (too expensive).
2. **`/api/storms/active` is slow/expensive.** It does live per-request work: per-ocean bulletin fetch (6h cache) + dedupe + reconcile + land-mask + sanitize. The map feels real-time-heavy.
3. **Sione handoff loses storm context.** `_sione_sessions` is an in-memory per-process dict; prod runs `uvicorn --workers 4`, so ~3/4 of follow-up chats land on a worker that never saw the session → Sione gets the default prompt with zero storm data. Restarts wipe sessions too.

## Core move

The **6h detection job does ALL the work and writes a finished snapshot; the API just reads it.** LLM runs ~N times per cycle, never per page-load.

```
GFS/WW3 (6h)  ── already wired
   ▼
6h JOB (extend existing run_detection):
   detect → track → WW3 confirm → region_impacts        ← already done
 + build region_timeline (deterministic: top-3 regions by peak hour) NEW
 + LLM analysis (Sonnet, 1 call/storm, change-gated, narrates timeline) NEW
 + reconcile bulletins + land-mask + dedupe              ← MOVED from request path
   → write derived_storms rows + one storm_snapshot JSONB
   ▼ DB (shared across 4 workers, survives restart)
/api/storms/active        → return snapshot verbatim (pure read, no LLM)
/api/storms/{id}/detail   → read row incl. analysis + region_timeline (no LLM)
Sione handoff             → seed from same row by storm_id; only follow-ups hit LLM
```

## Locked decisions

| Decision | Choice |
|---|---|
| Analysis refresh cadence | Every 6h cycle, **only if storm changed materially** (else reuse stored text) |
| Analysis model | **Sonnet 4.6** (`claude-sonnet-4-6`) |
| Map snapshot store | **JSONB snapshot row in DB** (`storm_snapshot`) |
| Sione handoff fix | **Rebuild context from `storm_id` via DB** (stateless, worker-agnostic) |
| Numbers vs prose | Numbers stay **deterministic** (from `region_impacts`); LLM only **narrates** — no invented sizes |

## LLM analysis content spec

Trajectory of surf impact over the forecast — top 3 regions ordered by time, each with arrival/peak window + projected size/period/direction. Example:

> Strong low in the Gulf of Alaska, tracking SE and deepening. **Next ~2 days:** primary impact **Central America** — 4–6 ft @ 15s WNW, arriving Thu, peaking Fri. **~Day 4:** energy shifts to **South America (Peru/Chile)** — 6–8 ft @ 16s. **~Day 5:** glancing **So-Cal** at 14s.

`region_timeline` (structured, stored alongside prose) = sort impacted regions by `peak_arrival_hours`, take top 3 by `energy_index`, emit `{region, arrival_hours, peak_hours, size_ft, period_s, dir_deg, tier}`. Both card and Sione read it; Sione handles follow-ups (user's region / travel destination).

---

## Phases (one commit each)

### Phase 1 — Schema (migration `019_storm_analysis.sql`) — ✅ written + validated (apply to prod pending)
- `derived_storms` add: `analysis_text text`, `region_timeline jsonb`, `analysis_generated_at timestamptz`, `analysis_model text`, `analysis_input_hash text`.
- New `storm_snapshot` (single-row JSONB cache, PK `id='current'`).
- **Accept:** migration applies in `supabase/migrations/`; columns present. ✅ Validated locally (018→019 apply cleanly, 019 idempotent on re-run).
- **Prod apply:** no DB connection string in env — apply via Supabase dashboard SQL editor or linked `supabase db push` at deploy time (additive + idempotent, safe to re-run).

### Phase 2 — Deterministic `region_timeline` builder — ✅ done
- `services/region_impact.py`: `build_region_timeline(storm, region_impacts, top_n=3)` — strongest regions by energy, ordered chronologically by peak arrival; emits `{region_id, region, tier, arrival_hours, peak_hours, fade_hours, size_ft, period_s, dir_deg, energy_index}`. Pure, no LLM.
- Wired into `jobs/detect_storms.py` (alongside `region_impacts`/`narrative`) + persisted via `_storm_to_row` → `region_timeline` column. `/api/storms/{id}/detail` returns it automatically (selects `*`).
- **Accept:** ✅ `backend/test_region_timeline.py` (7 tests) + full storm suite (23) pass; end-to-end verified against real region config.

### Phase 3 — LLM analysis (Sonnet, change-gated) — ✅ done
- `backend/services/storm_analysis.py`: `generate_analysis(storm, region_timeline)` (Sonnet 4.6) narrates the deterministic timeline — uses only provided numbers, never invents. `enrich_with_analysis(storms, existing)` is the change-gated batch orchestrator (one client per batch).
- Change gate: `compute_input_hash` over rounded position + pressure + type + deepening/landfall + timeline (region/tier/size/period/peak bucketed to 6h). Reuse stored text when unchanged → no API call.
- Graceful fallback: missing key / empty timeline / LLM error → keep templated `narrative` as `analysis_text`, hash left unset so the next run retries.
- Wired into `run_detection()` (`_load_existing_analysis` → `enrich_with_analysis`) before persist; `_storm_to_row` writes the 4 `analysis_*` columns. `/api/storms/{id}/detail` returns them (selects `*`).
- **Accept:** ✅ `backend/test_storm_analysis.py` (9 tests: hash stability/sensitivity/6h-bucket, generate calls model / skips empty / no-key, enrich reuse/generate/fallback). Full storm suite 32 green.
- **Deploy reqs:** migration `019` applied + `ANTHROPIC_API_KEY` set. Degrades to templated narrative if either is missing.

### Phase 4 — Snapshot builder + `/active` pure read — ✅ done
- `routes/storms.py`: extracted `assemble_active_storms()` (bulletin merge + dedupe + reconcile + land-mask) from the endpoint; added `build_and_store_snapshot()` (writes `storm_snapshot`) + `_read_storm_snapshot()` (8h staleness guard).
- `jobs/detect_storms.py`: `run_detection()` calls `build_and_store_snapshot()` after persist.
- `/api/storms/active`: default path (no query overrides) → pure snapshot read (`source: "snapshot"`); query overrides or missing/stale snapshot → live assemble (`source: "live"`). Response shape preserved (+`source`).
- **Accept:** ✅ no per-request bulletin fetch on the default path; `backend/test_storm_snapshot.py` (3 tests: snapshot served / override bypass / missing→live). Full storm suite 35 green.
- **Follow-up:** the detection loop runs in all 4 uvicorn workers, so the snapshot is written 4× (harmless last-write-wins) and detection/LLM is duplicated (change-gate dedupes most LLM via DB). Consider moving the detector to a single systemd service like `mysurflife-rate-spots-*`.

### Phase 5 — Sione handoff fix (storm_id → DB rebuild) — ✅ shipped (commit `acab8de`, branch `storm-handoff-fix`)
- `/api/sione/chat`: on session miss but `ctx.storm_id` present, rebuild `system_prompt_override` from `derived_storms` row (+ analysis + timeline once Phase 3 lands) + user favorites.
- Cover: bulletin-only storms not in `derived_storms` (fall back to client-passed storm or snapshot-by-id); anonymous users.
- Optionally repopulate `_sione_sessions` per-worker as a cache.
- **Accept:** handoff works regardless of worker / after restart; verified end-to-end.
- **Note:** the core fix (context survives workers) works today without the new columns — ship first as a bugfix if quick relief is wanted.

### Phase 6 — Frontend card analysis rendering — ✅ done (visual check pending data)
- `StormCard.jsx`: replaced templated `sc-narrative` with an `sc-analysis` block — `analysis_text` (falls back to `narrative`) under a "Sione forecast" eyebrow (D1 `<Logo variant="mark">`), plus an `sc-trajectory` list rendered from `region_timeline` (peak timing · region · size@period · dir, tier-colored left border). "Ask Sione" CTA unchanged.
- `styles/storm-card.css`: styles for the new classes (existing tokens, no hex).
- **Accept:** ✅ production build compiles (+498 B JS / +303 B CSS); JSX parses; no hex literals. Visual confirmation pending migration 019 applied + a detection cycle populating `analysis_text` in prod.
- **Pre-existing gap (not Phase 6):** the other Phase 8 detail sections (`sc-section`, `sc-dynamics`, `sc-landfall`, `sc-regions`, `sc-row-grid`, `sc-cell`, `sc-region-row`) shipped without CSS — the detail panel below the analysis block is largely unstyled. Worth a follow-up styling pass.

### Phase 7 — Map storm strength filter
- Frontend control on the storm layer: **All / Gale 34kt+ / Storm 48kt+ / Hurricane 64kt+** (client-side filter on loaded set by `warning_tier` / wind — instant, no refetch).
- **Accept:** toggling filters markers instantly.

---

## Cost

~10–40 global storms × 1 Sonnet call / 6h, change-gated → a few hundred calls/day worst case, far less in practice. Vs. rejected "LLM on every card open."

## Sequencing note

Phases 1→4 are the data/caching backbone. **Phase 5 (handoff bugfix) is the highest-priority production bug** and can land first independently. Phases 6–7 are frontend polish on top.
