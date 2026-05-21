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

### Phase 2 — Deterministic `region_timeline` builder
- `services/region_impact.py`: `build_region_timeline(region_impacts) -> list` (top-3 by energy, chronological).
- Store on storm record + persist to DB.
- **Accept:** unit test; `region_timeline` present on `/detail`.

### Phase 3 — LLM analysis (Sonnet, change-gated)
- New `backend/services/storm_analysis.py`: `generate_analysis(storm, region_timeline) -> str` using Sonnet 4.6.
- Change gate: `analysis_input_hash` from rounded position + pressure + tier set + timeline region ids; skip LLM + reuse stored text if unchanged.
- Graceful fallback to `compose_narrative()` on LLM error.
- Wire into `run_detection()` after region_impacts.
- **Accept:** `analysis_text` populated; unchanged storm on next run logs "reuse", no LLM call.

### Phase 4 — Snapshot builder + `/active` pure read
- Move reconcile + land-mask + dedupe + bulletin merge into the job; build finished list; write `storm_snapshot`.
- Refactor `/api/storms/active` → read snapshot (fallback to current path if snapshot missing/stale).
- **Accept:** `/active` does no per-request bulletin fetch; latency drops; same response shape.

### Phase 5 — Sione handoff fix (storm_id → DB rebuild) — ✅ shipped (commit `acab8de`, branch `storm-handoff-fix`)
- `/api/sione/chat`: on session miss but `ctx.storm_id` present, rebuild `system_prompt_override` from `derived_storms` row (+ analysis + timeline once Phase 3 lands) + user favorites.
- Cover: bulletin-only storms not in `derived_storms` (fall back to client-passed storm or snapshot-by-id); anonymous users.
- Optionally repopulate `_sione_sessions` per-worker as a cache.
- **Accept:** handoff works regardless of worker / after restart; verified end-to-end.
- **Note:** the core fix (context survives workers) works today without the new columns — ship first as a bugfix if quick relief is wanted.

### Phase 6 — Frontend card analysis rendering
- `StormCard.jsx`: render `analysis_text` + `region_timeline` trajectory list in place of the templated `sc-narrative`. Keep "Ask Sione" CTA. Label as AI-generated.
- **Accept:** card shows the LLM trajectory; Sione deep-dive still works.

### Phase 7 — Map storm strength filter
- Frontend control on the storm layer: **All / Gale 34kt+ / Storm 48kt+ / Hurricane 64kt+** (client-side filter on loaded set by `warning_tier` / wind — instant, no refetch).
- **Accept:** toggling filters markers instantly.

---

## Cost

~10–40 global storms × 1 Sonnet call / 6h, change-gated → a few hundred calls/day worst case, far less in practice. Vs. rejected "LLM on every card open."

## Sequencing note

Phases 1→4 are the data/caching backbone. **Phase 5 (handoff bugfix) is the highest-priority production bug** and can land first independently. Phases 6–7 are frontend polish on top.
