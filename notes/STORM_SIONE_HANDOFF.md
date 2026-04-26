# Storm Detail → Sione Handoff

**Owner:** George
**Status:** Active plan
**Last updated:** 2026-04-26
**Companions:**
- `notes/SIONE_CAPABILITIES.md` — Sione modes, tool surface, provider strategy
- `notes/GLOBAL_STORM_DETECTION_PLAN.md` — the data pipeline that powers Sione's storm tools
- `ClaudeDesign/project/SPEC-storm-card.md` §3.6 (existing "Ask Sione" chip) and §8 (existing handoff spec)
- `notes/STORM_DRAWER_V2_DESIGN_BRIEF.md` — *shelved* in favor of this approach

---

## Guiding principle

> **Don't guess what people want to see, or what's important to them.**

Static visualizations bake in our guesses. An "energy widget" that ranks regions by some computed score is us saying "*we* think this is what matters about this storm." A surfer in San Diego doesn't care about the storm's energy distribution across nine regions — they care about their two or three home spots, on the days they can actually surf, with the wind and tide they like, given a board they happen to own.

Every surfer is asking a slightly different question of every storm. We can't pre-render all those questions into one drawer. So instead:

1. **The drawer stays simple.** It shows objective storm characterization (what is this storm? where is it going?). No personalization, no scoring, no "best for you."
2. **Sione owns the personalized layer.** When the user wants to know "how does this storm affect *me*?", they tap "Ask Sione about this storm" and the LLM, given full storm data + their full user context + the right tools, answers their actual question.
3. **The data pipeline still gets built.** `GLOBAL_STORM_DETECTION_PLAN.md` is still the right plan — it just feeds Sione's tool surface instead of feeding a widget. Better data → better Sione answers.

This is a conscious choice to under-build the UI and over-build the conversational interface. Surfline and Windy bet the other way.

---

## The drawer stays as-is

No design changes to `mysurflife-storm-card.html` or `SPEC-storm-card.md` for v1 of the new pipeline. The only adjustment is that L3 (per-spot breakdown) gets dropped, since the spot-by-spot personalization moves to Sione where it belongs. L1 + L2 remain.

What changes — invisibly — is the **data quality** flowing into L1 and L2 from the new pipeline:

- L1 forecast track moves from 1-3 sparse waypoints to a hourly track from GFS. The visual stays the same; the dots are just placed accurately.
- L1 fetch wedge is now derived from the actual wind field, not a regex over bulletin text. Same visual; better data.
- L2 regional rows now exist for all global regions (today: only North Pacific / North Atlantic / East Pacific basins). Same row component; more rows.
- L1 may quietly gain `landfall_eta_hours` as a one-line caption under the forecast track if the storm is making landfall — the only proposed UI change in v1, and only because "this storm dies on land in 36h" is genuinely critical info that no surfer should miss. *Nice-to-have, not blocking.*

That's it. No widget. No comparison viz. No narrative paragraph. No new chips. Save the design budget for things that move the needle.

---

## The handoff: what Sione gets

When the user clicks the "Ask Sione about this storm" chip (existing L1 chip, current spec §3.6), we POST to a new Sione session endpoint with two structured payloads.

### 1. Storm context (objective, the same for every user)

```json
{
  "storm": {
    "id":              "model-np-45.5N-148.0W-2026-04-26T12Z",
    "source":          "model" | "bulletin" | "reconciled",
    "type":            "LOW",
    "name":            "Strong low pressure · Gulf of Alaska",
    "current_position":{"lat": 45.5, "lon": -148.0},
    "current_pressure_mb": 982,
    "peak_wind_kts":   58,
    "warning_tier":    "storm",
    "is_deepening":    true,
    "intensification_rate_mb_per_6h": -3.5,
    "peak_intensity_hour": 18,
    "will_make_landfall":  false,
    "landfall_eta_hours":  null,

    "forecast_track": [
      {"hours_ahead": 0,   "lat": 45.5, "lon": -148.0, "pressure_mb": 982, "peak_wind_kts": 58},
      {"hours_ahead": 6,   "lat": 46.2, "lon": -146.0, "pressure_mb": 978, "peak_wind_kts": 62},
      ...
    ],

    "fetch": {
      "peak_quadrant": "E",
      "peak_radius_nm": 300,
      "all_quadrants_nm": {"N": 180, "NE": 240, "E": 300, "SE": 280, "S": 200, "SW": 120, "W": 100, "NW": 140}
    },

    "ww3_at_storm": {
      "peak_sea_m":         7.2,
      "peak_period_s":      14,
      "swell_direction_deg":295
    },

    "region_impacts": [
      {
        "region_id":          "so-cal",
        "label":              "Southern California",
        "impact_tier":        "direct",
        "is_best_exposure":   false,
        "bearing_deg":        205,
        "distance_nm":        4200,
        "exposure_facing":    ["S", "SW"],
        "arrival_iso":        "2026-04-29T14:00:00Z",
        "peak_arrival_iso":   "2026-04-30T08:00:00Z",
        "fade_iso":           "2026-05-02T20:00:00Z",
        "peak_period_s":      16,
        "swell_direction_deg":195,
        "energy_index":       0.62,
        "energy_curve":       [...]
      },
      ...
    ],

    "raw_bulletin_text": "...",   // null if model-only
    "issued_utc":        "2026-04-26T12:00:00Z"
  }
}
```

This is exactly the same payload the storm drawer reads (`/api/storms/{id}/regional-impact`). No re-computation — Sione sees what the drawer shows, plus everything the drawer chooses not to render.

### 2. User context (subjective, personalized)

```json
{
  "user": {
    "id":         "uuid",
    "home_location": {"lat": 32.85, "lon": -117.27, "label": "La Jolla, CA"},
    "favorite_spots": [
      {"slug": "blacks-beach",   "name": "Blacks Beach",   "lat": 32.88, "lon": -117.25,
       "swell_window_deg": [240, 320], "best_period_s": [12, 18], "best_size_ft": [4, 10],
       "wind_pref": "offshore_E_to_NE"},
      {"slug": "trestles", "name": "Lower Trestles", "lat": 33.39, "lon": -117.59,
       "swell_window_deg": [180, 240], "best_period_s": [13, 18], "best_size_ft": [3, 8],
       "wind_pref": "offshore_E"}
    ],
    "user_spots": [
      // private spots, scoped per SIONE_CAPABILITIES.md §10 rules
    ],
    "recent_journal": [
      {"date": "2026-04-12", "spot": "blacks-beach", "score": 5,
       "notes": "Long-period south, head-high+, glassy AM"}
    ],
    "active_alerts": [
      {"spot": "blacks-beach", "min_size_ft": 6, "swell_dir_deg": [200, 250]}
    ],
    "skill_level":   "intermediate",
    "available_dates": null,         // populated if user has set a trip-window preference
    "timezone":      "America/Los_Angeles"
  }
}
```

This payload comes from the user's profile + recent journal + saved alerts. It's only sent if the user is signed in. Anonymous users get a minimal handoff (storm context only) and Sione's opening message is correspondingly generic.

### 3. Endpoint

```
POST /api/sione/sessions

{
  "mode":    "storm_trip",
  "storm":   { ... payload §1 ... },
  "user":    { ... payload §2, optional ... },
  "source":  "storm-card"
}

→ { "session_id": "...", "opening_message": "..." }
```

Existing endpoint `/api/scout/sessions` is renamed/augmented to support this — see `SIONE_CAPABILITIES.md` §3.1.

---

## Sione's opening message

Pre-rendered server-side, NOT LLM-streamed on open. Template-assembled to keep latency near-zero and cost zero on the open. The user will then ask their own follow-up, which is when the LLM streams.

### Template logic

If the user has favorite spots in any region the storm reaches with `impact_tier ∈ {direct, glancing}`:
> *I'm tracking a {storm.type.lower()} in the {basin} that'll send swell into your area. {your_favorite_spot} sits in the {region.label} window — first lines arrive {arrival_local}, peaking around {peak_local}. Swell direction looks like {swell_dir} at {peak_period}s. Want me to break down which of your spots will work best, or look at conditions for a specific day?*

If the user has no favorite spots in the storm's path:
> *I'm tracking a {storm.type.lower()} in the {basin}. Best exposure is {best_region.label} ({facing_text}-facing spots) starting {arrival_local}. Your home spots in {user_home_region} are {miss_or_glancing_summary}. Want a deeper look at whether it's worth a trip, or how the storm compares to past swells in your journal?*

If the user is anonymous:
> *I'm tracking a {storm.type.lower()} in the {basin}. Best exposure is {best_region.label} starting {arrival_local}. Want me to break down which coasts this hits and when?*

If the storm makes landfall before peak:
> *Heads up — this storm tracks onto land in {landfall_eta_hours}h, which closes the swell window early. {short_window_summary}. Worth checking if your spots see anything before that. Want me to check?*

### Why pre-render

- Zero latency on click — the user sees Sione's first response immediately.
- Zero LLM cost on every drawer→Sione click. We only pay when the user actually engages.
- Deterministic — every storm gets a consistent opener.

Once the user types a follow-up, we stream from the LLM with the full storm + user payload in the system context. That's when personalization happens.

---

## Sione's tool surface (storm-trip mode)

Per `SIONE_CAPABILITIES.md` §4.5, in `storm_trip` mode Sione has access to:

| Tool | Purpose |
|---|---|
| `get_storm_arrivals(storm_id)` | Fresh region-impact data (in case the storm has been re-detected since the handoff payload was assembled) |
| `get_spot_conditions(slug)` | Current + forecast conditions at a specific spot |
| `get_conditions_window(slug, start, end)` | Conditions across the storm's swell arrival window — answers "is Friday or Saturday better at Blacks?" |
| `compare_spots(slugs[])` | Ranks user's favorites for this storm's conditions |
| `rank_spots(region, criteria)` | Finds best spots for the user's preferences within an affected region |
| `get_buoy_history(station_id, hours)` | "Has this buoy seen a swell like this before?" |
| `get_tides(spot_slug, day)` | Tide windows on the peak day |
| `list_active_storms()` | Cross-reference with other current storms in case there's a competing swell |
| `calculate_swell_arrival(from, to, period)` | Custom arrival math for "what about this private spot of mine?" |
| `create_alert` (write tool, gated) | "Set me an alert for >6ft at Blacks during this window" |

The tools themselves don't need any new work for storm-trip — they already exist and serve other modes. The only new behavior is that Sione's `storm_trip` system prompt instructs it to:

1. Anchor analysis to the user's favorite spots first, not to global "best exposure"
2. Offer concrete actions (compare days, set alerts, save trip plan) rather than just description
3. Be honest when the storm doesn't help the user — "this one's a miss for your spots, but Trestles will see something glancing" — instead of overstating the impact
4. Never invent precision the data can't support (e.g., "8.3 ft at Blacks at 7:42 AM" is a fabricated promise; "head-high to overhead Friday morning" is honest)

---

## Example interactions

These are illustrative. The actual responses are generated by the LLM with the storm + user payloads in context.

### Example 1 — Storm hits user's home region

> **Sione:** I'm tracking a strong low in the Gulf of Alaska that's deepening — central pressure is 982 mb and dropping. Swell arrives So Cal Friday afternoon, peaks Saturday morning. Looks like 16s WNW.
>
> Blacks should pick it up — that direction is right in its window. Want me to look at the Friday-vs-Saturday call, or pull up the wind forecast for the peak?
>
> **User:** What's the wind doing Saturday morning?
>
> *(Sione calls `get_spot_conditions("blacks-beach")` for Saturday AM)*
>
> **Sione:** Saturday morning is looking offshore — 6-8 mph from the east at sunrise, glassy by 7. Tide low at 5:23 AM, rising. That's about as clean as it gets for Blacks on a long-period WNW. Want me to set you an alert if conditions shift?

### Example 2 — Storm misses user's region

> **Sione:** I'm tracking a low pressure system in the Tasman Sea that's sending swell up into Central America Friday — energy looks high there, best exposure is Salinas. Your home spots in So Cal are out of the swell window for this one. The storm tracks east of New Zealand, so the angle is wrong for California.
>
> If you want a closer look at Central America for a possible trip, I can pull conditions for the peak window. Otherwise, want me to check what's *actually* coming for your spots this weekend?

### Example 3 — Landfall caveat

> **Sione:** I'm tracking a tropical storm off Mexico, but heads up — its forecast track puts it on land in about 36 hours, which means swell generation cuts off early. There'll be a short pulse hitting Mainland Mexico starting Thursday afternoon, fading by Saturday. Your spots probably won't see meaningful energy from this one.
>
> Want me to check what else is in the water, or set up an alert for the next system that doesn't die on land?

---

## What this DOESN'T do (and why that's fine)

- **No proactive "storms that matter to you" feed.** A surfer in So Cal shouldn't have to scroll through twelve North Pacific lows to find the south swell. Future feature: a "for you" surface that filters the global storm set against the user's spots and only shows the ones with non-trivial impact tier. Out of scope here; tracked elsewhere.
- **No notification when a relevant storm is detected.** The `create_alert` tool exists for spot-level alerts; we don't yet auto-notify on storm-level events. Defer.
- **No multi-storm comparison.** "Is this swell better than the one we got two weeks ago?" is a great Sione question and the journal data supports it, but the drawer→Sione handoff doesn't pre-load that context. The user can ask, Sione can fetch. Not a v1 concern.

---

## Engineering work (the only real work for v1)

1. **`/api/sione/sessions` accepts `mode: "storm_trip"`** with the storm + user payload shape above. Endpoint exists today as `/api/scout/sessions`; needs a small payload extension and a renamed mode key.
2. **Server-side opening message templater** — pure string assembly, no LLM call. Lives in `backend/sione/openers/storm_trip.py` (per the SIONE_CAPABILITIES Phase 7.1 folder structure).
3. **Frontend "Ask Sione about this storm" chip** — already exists in the L1 mockup (`SPEC-storm-card.md` §3.6). Wire it to the new endpoint with the storm + user payload. Replace the (now-removed) L3 "Plan trip" CTA wiring.
4. **Sione storm_trip system prompt** — new prompt template per `SIONE_CAPABILITIES.md` §2.3, with the four "anchor to user's spots" / "concrete actions" / "be honest about misses" / "no fabricated precision" rules. Lives in `backend/sione/prompts/storm_trip.txt`.
5. **No changes to the drawer UI** other than dropping L3 wiring (the components themselves stay in case we want them back).

Everything else (the energy widget, narrative block, fetch polygon, etc.) is shelved unless we revisit.

---

## What we keep building anyway

The whole `GLOBAL_STORM_DETECTION_PLAN.md` engineering work still happens — it's the data layer underneath all of this. Better detection → richer Sione answers. The plan's Phase 1-6 (pressure ingestion, detector job, track matching, WW3 enrichment, landfall check, bulletin reconciliation) all run as written.

The only piece we de-prioritize is **Phase 7 (region impact + narrative)** — we still compute `region_impacts` and store it on the storm record, because Sione reads that during the handoff. We just don't render it as a widget in the drawer.

Phase 8 (API + frontend) reduces in scope: `/api/storms/{id}/regional-impact` still ships (Sione consumes it), but we don't build a UI surface for it directly.

**Net engineering effort:** ~5 days instead of ~6, with most of the savings on the frontend side. No design effort needed beyond the existing card.

---

## When to revisit a richer drawer

Two triggers would re-open the v2 design brief:

1. **Sione handoff usage stays low.** If most users open the drawer and don't tap "Ask Sione," they're getting their answer from the drawer alone, and the drawer is under-serving them. The fix is more drawer, not more LLM.
2. **Anonymous-user behavior diverges from signed-in.** Anonymous users can't get personalized analysis — they need the drawer to do more. If we see a strong split, the right answer might be a richer drawer for anonymous + the same handoff for signed-in.

Until we see that data, this plan stays.
