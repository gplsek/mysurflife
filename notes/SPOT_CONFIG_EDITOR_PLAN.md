# Spot Config Editor + AI/Geo Generator — Plan

**Owner:** George
**Status:** 📋 Planning — model unified around owner-curated spots (updated 2026-05-22)
**Related:** `backend/surf_scoring.py` (consumer of these windows), `backend/routes/spot_config.py` (B1 API), PR #8 (wind quality rework)

---

## Product thesis

MySurfLife is a **data aggregator + visualization tool**, not a top-down authority. The forecast loop is:

```
create spot (GPS) → geo suggests best swell/wind (A1) → user fine-tunes
   (swell windows, wind windows, tide preference) → feeds the rating algorithm
   AND Sione (AI) → conditions + model forecast + the user's local knowledge
   combine into the report
```

Conditions are **objective** (buoys + WW3 + HRRR are correct at any lat/lon, zero config).
Ratings are **subjective** — they need per-spot windows. So spot pages can show real conditions
immediately; the spot-specific *score* layers on as config matures.

**Why this is the right bet:** the codebase already admits the gap this fills. The surf-height
formula note in `CLAUDE.md` says it *"does not account for bathymetry, refraction, or spot-specific
characteristics… implement per-spot calibration coefficients."* The user-tuning loop **is** that
calibration — crowdsourced instead of hand-coded. It also reframes the rating from authoritative
(can be "wrong", kills trust) to **personalized** ("your spot, your tuning" — if it's off, you fix it).

---

## Core data model: one spot table, place ≠ tuning

Two concepts were previously glued together. Separating them is what makes both **owner spots**
and **deduplication** work:

- **Place** — a break at a location. Objective, shareable, deduplicated. One canonical row.
- **Tuning** — windows + tide preference. Subjective, per-person.

### Decision 1 — unify public + private into one `spots` table

Today `spots` (imported/public, rich config) and `user_spots` (owner, thin: name/coords/break_type,
**no windows, no characteristics**, synthetic `usr_<id>` slug) are divergent tables. Owner-curated
spots should be **identical** to imported spots — the only difference is who can see them.

Add to `spots`:
- `owner_id uuid NULL` — `NULL` = global catalog; set = a user's private place.
- `visibility text` — `'public' | 'private'` (default `'public'` for the catalog).

Then private spots are ordinary `spots` rows and **everything already built works for them for free**:
`spot_characteristics`, `spot_swell_windows`, `spot_wind_windows`, `spot_forecast_tuning`, the geo
generator (A1), the LLM generator (A2), the rose, the rating algorithm, the editor. One code path,
scoped by RLS. No duplicate tables, no `is this a user spot` branching.

Converge `user_spots`: migrate rows into `spots` (mint slugs / route private by id), keep
`/api/user/spots` working as a filtered view (`owner_id = me`) for backward compat, then deprecate.

> ⚠️ **The catalog-leak footgun.** Once private spots live in `spots`, **every** list/search/map
> endpoint must filter `visibility='public' OR owner_id = me`. One missed filter leaks a secret spot
> onto the global map. This is the single most important thing to get right in the migration —
> enforce it at the RLS layer, not just in app code.

### Decision 2 — tuning is a per-user overlay (Phase 2)

To **consolidate** a place while letting each user keep their own windows, tuning must carry an owner:

- `owner_id` on the windows tables. `NULL` = "house" default (geo/llm/admin, source-tagged).
  Set = that user's personal override on the same place.
- 50 surfers can tune one canonical "Ocean Beach" without clobbering each other.
- **Consensus tuning** (the prize): aggregate many users' overrides into a crowd-derived window that
  beats geo/LLM alone — *only possible because places are canonical*. This is "aggregate, get their
  idea, inform them" made literal.

Phasing keeps it small: **v1** windows stay spot-level (matches "their spots are just theirs");
**v2** introduces the `owner_id` overlay + consensus when sharing actually matters.

---

## Deduplication: consolidate places by geo, never auto-merge

Surf world is small (~30k spots globally, Surfline). Even heavy duplication is a few hundred K rows —
**scale is a non-issue for Postgres**. Dedup is about a clean map + letting knowledge aggregate, not storage.

1. **Candidates on create** — query `spots` within ~150m of the new coords. Naive haversine over a
   lat/lon bbox is fast enough; PostGIS `ST_DWithin` if we want it clean.
2. **Proximity + fuzzy name, not distance alone** — Trestles' Uppers/Lowers/Middles sit ~150m apart
   and are *different* spots. Close + similar name = same; close + different name = adjacent break, keep separate.
3. **Confirm, never silently merge** — show "Is this one of these?" (Google Maps "add a place"
   pattern). User picks an existing place or "No, it's new."
4. **Privacy-scoped** — dedup runs against the **public catalog** and the **user's own spots** only.
   Never merge across *different users'* private spots: merging would reveal that a stranger surfs
   someone's secret reef.

---

## Provenance (already shipped in migration 020)

`source` on both windows tables: `'human' | 'geo' | 'llm'`. The generator only writes/overwrites
non-human rows, so a human edit always wins. Surface this as a **confidence tier** in the UI:
human-verified > geo-derived > llm-proposed > unconfigured. Only assert the 0–5 score where
confidence is adequate; elsewhere show raw conditions and soft-pedal the score.

---

## A. AI / geo config generator  (✅ A1, A2 shipped)

- **A1 — geo orientation (deterministic, free):** coastline bearing at lat/lon → seaward facing →
  offshore = opposite. Trustworthy; run on **every** spot. Wire into the create flow so a new spot is
  pre-filled the instant coords exist (the "aha" moment).
- **A2 — LLM windows (cost + hallucination):** proposes swell windows, wind categories, ideal tide
  from name + lat/lon + region + break type. Worst at obscure spots → spend LLM calls + human review
  only on spots that get traffic or are marquee. Cache/change-gate like the storm analysis.
- **Defaults must stand alone:** most users won't tune. Geo + LLM must produce a usable rating
  *without* user input; tuning is the upgrade, not the floor.

## B. Spot config editor

- **B1 (✅ shipped, PR #13):** read-only `SwellWindRose` on SpotDetail + `GET/PUT
  /api/spots/{slug}/windows` (PUT admin-gated, authoritative replace, tags `source='human'`).
- **B2a:** interactive editor in edit mode — add/remove swell & wind window rows (numeric
  dir/weight/category + tide preference), **live rose preview**. Gated `admin || owner`.
- **B2b:** draggable arc handles on the rose, synced with the inputs.
- **Tide preference:** has no structured home yet (`spot_characteristics.tide_position` is free text).
  Add weighted tide states (low/mid/high/rising/falling) like the swell/wind windows so it feeds the
  rating + Sione cleanly.

---

## Phasing

| Phase | Scope | Status |
|---|---|---|
| PR #8 | wind quality rework so windows drive the rating | ✅ |
| A1 | geo orientation deriver | ✅ (PR #11) |
| A2 | LLM window generator + migration 020 (`source`) | ✅ (PR #12) |
| B1 | read-only rose + windows API | ✅ (PR #13) |
| **M1** | **migration: `owner_id` + `visibility` on `spots`; RLS; converge `user_spots`** | ⬜ next |
| **M2** | PUT owner-gating (`admin \|\| owner`); list/search visibility filters | ⬜ |
| **B2a** | interactive editor (inputs + live preview), serves public + private | ⬜ |
| **A1-create** | geo-suggest on spot create (pre-fill windows) | ⬜ |
| **B2b** | drag-to-edit arcs on the rose | ⬜ |
| **Tide** | structured tide-preference windows → rating + Sione | ⬜ |
| **B2-overlay** | per-user tuning overlay (`owner_id` on windows) + consensus | ⬜ (v2) |
| **Dedup** | proximity + name candidate suggestion on create | ⬜ (with create flow) |

### Acceptance criteria — M1/M2 (the migration that unblocks everything)
- Existing public spots unchanged (backfilled `visibility='public'`, `owner_id=NULL`).
- A private spot is a `spots` row with `owner_id=me`, `visibility='private'`; it gets characteristics
  + windows like any spot.
- **No private spot ever appears** in `/api/surf-spots`, search, or the global map for a non-owner
  (RLS-enforced; add a regression test).
- `PUT /api/spots/{slug}/windows` succeeds for admin OR the owner; 403 otherwise.

---

## Risks
1. **Catalog leak** — see footgun above. RLS-first, regression test.
2. **Low tuning engagement** — defaults (geo/llm) must carry the rating alone.
3. **Wrong dedup merge** — confirm-on-create, never auto-merge; name + distance, not distance alone.
4. **Import legality** — names/coords are factual (fine); don't copy others' prose descriptions —
   generate our own.
5. **Sione integration is real work** — rating algo already consumes windows; threading per-spot
   user prefs into Sione's context is a prompt change, not automatic.

## Open questions
- Private spot slugs: mint real unique slugs, or route private spots by id (keep `usr_` pattern)?
- Coastline dataset for A1 at global scale (Natural Earth 1:50m vs existing land-mask gradient)?
- `is_primary boolean` on windows now (explicit "best") vs. infer from max `weight`?
- Consensus tuning algorithm (median window? weighted by user credibility?) — defer to v2.
