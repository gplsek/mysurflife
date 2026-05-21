# Global Storm Detection Plan

**Owner:** George
**Status:** ✅ Built — Phases 1–8 shipped Apr 27 2026 (commits `12318e2`, `fe499f7`). This doc remains the design source of truth; for current implementation state see the audit table in `notes/STORM_DETECTION_EXECUTION_PLAN.md`.
**Last updated:** 2026-05-21
**Companions:**
- `notes/STORM_COVERAGE_BUGS.md` — immediate bugs in the bulletin pipeline
- `notes/STORM_CARD_DESIGN_BRIEF.md` — what the storm-detail drawer expects
- `notes/MAP_V2_IMPLEMENTATION_PLAN.md` Phase 4 — current storm beacon/card work
- `backend/high_seas.py`, `backend/routes/storms.py`, `backend/storm_arrivals.py` — current pipeline

---

## 1. Why this exists

Today, the storm map is fed by NOAA NWS High Seas bulletins from KWBC (Washington DC):

| Product | Coverage | Update cadence |
|---|---|---|
| HSF/NP | North Pacific (Aleutians, Gulf of Alaska, mid-latitude) | 4×/day |
| HSF/EP2 | East tropical Pacific (off Mexico/Central America) | 4×/day |
| HSF/AT1 | North Atlantic | 4×/day |

**Hard structural gaps** (no parser fix can solve these):

1. **Southern Hemisphere** is entirely absent. The Tasman lows, lows south of Australia, Indian Ocean systems west of Perth — KWBC doesn't issue bulletins below the equator. Those products belong to BoM (AU) and MetService (NZ) and aren't on `api.weather.gov`.
2. **Forecast tracks are sparse and human-prose.** Bulletins say "WILL MOVE NE TO 44N 151W BY 12Z TUE" or ".12 HOUR FORECAST LOW 61N45W" — we get a few waypoints, not an hour-by-hour track. Our regex currently misses the second format entirely (see `STORM_COVERAGE_BUGS.md`).
3. **Tropical and extratropical are split products.** Named hurricanes are NHC, not HSF. We don't ingest NHC.
4. **No storm-generated swell decomposition.** Bulletins give peak sea height, not peak period or direction. We can't tell a surfer "this storm produces a 17s WNW swell" from the bulletin alone.

Windy doesn't have any of these gaps — and Windy doesn't have a "storm database" either. It just renders the GFS / ECMWF wind+pressure field globally and your eye does the cyclone detection. We can do the same algorithmically using inputs we already have in the app.

**Goal of this plan:** derive a global, hour-by-hour, model-native storm dataset that fills both the spatial gaps and the storm-detail-drawer fields, while keeping the bulletin pipeline as a metadata reconciliation layer.

---

## 2. Data sources (what we already have, what we'd add)

| Source | Status | Use |
|---|---|---|
| GFS 10m wind (u, v) | **In app** — `/api/wind-overlay?model=gfs` | Storm intensity (peak wind), fetch geometry |
| GFS MSL pressure | **Not yet ingested** | Storm-center detection (local minima) |
| HRRR / NAM wind | **In app** | High-res refinement near US coast (optional) |
| WW3 wave height (htsgwsfc) | **In app** — `/api/waves-overlay?source=global` | Storm-generated sea height + **hard filter** (§4.4 confirmation pass) |
| WW3 wave period (perpwsfc) | **In app** | Peak period at storm + radials → arrival group velocity |
| WW3 wave direction (dirpwsfc) | **In app** | Swell direction → spot exposure window match |
| NWS High Seas bulletins | **In app** — `high_seas.py` | Reconciliation (named storms, warning tiers, raw text for Sione) |
| Natural Earth 1:50m coastline raster | Not yet imported | Landfall check |

**Note:** GFS MSL pressure is the only meaningful new fetch. Same OPeNDAP server as the wind we already pull, just one extra variable (`prmslmsl`). No new network dependency, no new API key.

---

## 3. Pipeline architecture

```
┌────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│ GFS pressure   │────▶│ Cyclone detector │────▶│ Storm centers per │
│ + wind (per h) │     │ (local minima +  │     │ forecast hour     │
└────────────────┘     │  fetch geometry) │     └─────────┬─────────┘
                       └──────────────────┘               │
                                                          ▼
┌────────────────┐                              ┌───────────────────┐
│ Coastline      │─────────────────────────────▶│ Track matcher     │
│ raster         │                              │ (NN across hours) │
└────────────────┘                              └─────────┬─────────┘
                                                          │
┌────────────────┐                                        ▼
│ WW3 wave field │────────────────────────────▶┌───────────────────┐
│ (h, T, dir)    │                             │ Per-storm record  │
└────────────────┘                             │ (track + WW3 +    │
                                               │  landfall + impact)│
┌────────────────┐                             └─────────┬─────────┘
│ NWS bulletins  │─────────────────────────────────────▶ │
│ (high_seas.py) │           reconcile metadata          │
└────────────────┘                                        ▼
                                               ┌───────────────────┐
                                               │ derived_storms    │
                                               │ DB table          │
                                               └─────────┬─────────┘
                                                         │
                                              /api/storms/active
                                              /api/storms/{id}/detail
                                              /api/storms/{id}/arrivals
```

Runs as a background job (`backend/jobs/detect_storms.py`) every 6 hours, aligned with new GFS run availability.

---

## 4. Cyclone detection algorithm

Per forecast hour `t` in `[0, 6, 12, ..., 168]`:

### 4.1 Find pressure minima

1. Pull GFS MSL pressure field at `t`, downsample to ~50 km grid (we don't need full GFS resolution for centers).
2. For each cell, compare to the 8 neighbors at the same downsampled grid. Keep cells where pressure is the strict local minimum.
3. Reject minima with pressure ≥ 1005 mb (no storm). Tropical cyclones often have lower thresholds (~1000 mb for TS, ~990 for hurricane), but extratropical lows can be intense at 990–1000 mb so 1005 mb is a reasonable global cutoff.
4. Cluster minima within 200 km of each other into a single center (centroid of pressures, weighted by 1/pressure).

### 4.2 Compute fetch geometry per center

1. Pull wind speed field around each center within a 1000 km box.
2. Compute mean wind direction in 8 quadrants (N, NE, E, SE, S, SW, W, NW) within the box.
3. For each quadrant, walk outward from center until wind drops below 35 kt (gale threshold). That's the gale radius.
4. Record `fetch.quadrant` = quadrant with the largest radius (peak fetch direction). Store all 8 radii as a polar array for the drawer's compass-rose viz.
5. If peak wind anywhere in box ≥ 64 kt, record `warning_tier = hurricane`; ≥ 48 → `storm`; ≥ 35 → `gale`; else `none`.

### 4.3 Sample WW3 at the center

1. Look up WW3 grid cell at the storm center (handle the 0–360 → −180–180 longitude normalization already in the codebase).
2. Record `htsgwsfc`, `perpwsfc`, `dirpwsfc` at center → `peak_sea_m`, `peak_period_s`, `swell_direction_deg`.
3. Optionally sample at the 8-quadrant fetch radii for a more robust "peak swell within fetch."

### 4.4 WW3 confirmation pass (hard filter)

A pressure minimum is the storm's *cause*; WW3 wave height is its *effect*. We require evidence of the effect before keeping the cause on the surf map. This is the algorithmic equivalent of how Stormsurf users visually confirm storms — they see the Hs blob, not the pressure low directly.

**Algorithm** (per detected center from §4.1):

1. Compute the **downwind cone** from the center:
   - Vertex at `(lat, lon)`
   - Axis = `fetch_peak_quadrant` from §4.2 (the direction the strongest fetch is pointing)
   - Half-angle = 45° (covers the active fetch quadrant generously)
   - Range = 100 nm to 800 nm downwind (waves need ~6–12h fetch to grow; the peak Hs typically sits a few hundred nm downwind of the center, not at the center itself)
2. Sample WW3 `htsgwsfc` at all grid cells whose center falls inside the cone.
3. Compute `max_cone_hs_m` = max Hs across sampled ocean cells. **Land cells are masked NaN in WW3 and are automatically excluded.**
4. Apply two reject conditions:
   - **`zero_ocean_cells`** — the cone contains no valid (non-NaN) Hs values. The center is fully embedded in continent / no fetch reaches blue water. Drop the storm.
   - **`weak_fetch`** — `max_cone_hs_m < HS_CONFIRM_MIN` (default **3.0 m / ~10 ft**, tunable in `backend/config/storm_detector_config.json`). The pressure minimum exists but isn't producing surf-relevant seas. Drop the storm.
5. Otherwise record `max_cone_hs_m` on the storm record as a confirmation signal. Use it as a tiebreaker in §7.1 region scoring (a storm with stronger confirmed seas outranks one barely passing the threshold).

**What this filter eliminates for free:**

| Class | Why it fails | Example |
|---|---|---|
| Continental lows | Cone has no ocean cells | Hudson Bay low, Great Plains cyclone, inland Canada/Alaska systems KWBC sometimes narrates |
| Landfalling cyclones (post-landfall) | Cone over-water shrinks each hour as storm moves inland; eventually `max_cone_hs_m` drops below threshold | Hurricane that's been inland 24h+ — drops off the storm map naturally |
| Pressure dimples without fetch | Real low but no surface wind to drive waves (e.g., upper-level low aloft) | Cut-off lows over Atlantic that don't deepen to the surface |
| GFS spurious detections | Transient noise that doesn't generate sustained fetch | Boundary-layer convergence lines that scan as local pressure minima |

**Tunables** (all in `storm_detector_config.json`):
- `hs_confirm_min_m` — minimum confirmed Hs in cone (default 3.0)
- `cone_half_angle_deg` — cone width (default 45)
- `cone_range_nm` — `[min, max]` range from center (default `[100, 800]`)
- `confirm_required` — bool, false to log-only and not actually drop (useful while validating thresholds)

**Note on bulletin reconciliation:** named bulletin storms that fail confirmation should still be retained but tagged `confirmation_status: "weak"` rather than dropped — the bulletin is human-curated ground truth and we trust it over the model. This only filters *model-derived* storms.

### 4.5 Output per detected storm at hour `t`

```json
{
  "detected_at_hour": 12,
  "lat": 45.5,
  "lon": -148.0,
  "pressure_mb": 982,
  "peak_wind_kts": 58,
  "fetch_quadrants_nm": {"N": 180, "NE": 240, "E": 300, "SE": 280, "S": 200, "SW": 120, "W": 100, "NW": 140},
  "fetch_peak_quadrant": "E",
  "fetch_peak_radius_nm": 300,
  "warning_tier": "storm",
  "peak_sea_m": 7.2,
  "peak_period_s": 14,
  "swell_direction_deg": 295,
  "max_cone_hs_m": 8.4,
  "confirmation_status": "confirmed"
}
```

---

## 5. Track matching across forecast hours

For each detection at hour `t`, find the closest detection at hour `t + 6`:

1. Compute great-circle distance between this hour's center and each next-hour center.
2. Match if distance ≤ 600 km (storms can move ~30 kt × 6 h = 180 nm = 333 km, so 600 km is generous to handle weak/fast systems).
3. Also require pressure delta ≤ 15 mb per 6h (storms intensify but rarely beyond this rate).
4. Storms that fail to match at `t + 6` are flagged "dissipating" at `t`.
5. Storms that appear new at `t + 6` (no parent at `t`) are flagged "forming" at `t + 6`.

Per matched storm, build a track:
```json
"forecast_track": [
  {"hours_ahead": 0,  "lat": 42.0, "lon": -155.0, "pressure_mb": 998, "peak_wind_kts": 35, ...},
  {"hours_ahead": 6,  "lat": 43.5, "lon": -152.0, "pressure_mb": 988, "peak_wind_kts": 50, ...},
  {"hours_ahead": 12, "lat": 45.5, "lon": -148.0, "pressure_mb": 982, "peak_wind_kts": 58, ...},
  ...up to hours_ahead=168
]
```

Compute derived fields from the track:
- `intensification_rate_mb_per_6h` — average pressure delta over first 24h
- `peak_intensity_hour` — hour of lowest pressure on the track
- `is_deepening` — bool, pressure dropping at hour 0
- `movement.direction`, `movement.speed_kts` — from delta(lat,lon) at hour 0

---

## 6. Landfall check

1. Load Natural Earth 1:50m coastline as a binary land mask raster (~5 km resolution is plenty). Store as a GeoTIFF or a Numpy array shipped with the app.
2. For each track point, check if the lat/lon falls in a land cell.
3. If any track point is on land before `peak_intensity_hour`, set `will_make_landfall = true` and record `landfall_eta_hours`.
4. If true, dampen swell projections downstream of landfall:
   - From the landfall hour, swell generation effectively stops (storm dies on land or weakens drastically).
   - Existing swell already in the water continues propagating, but no further reinforcement.
   - The drawer should label this clearly: "Storm makes landfall in 36h — swell window closes Tuesday."

---

## 7. Region impact scoring

**Scope decision (2026-04-26):** v1 is **region-level only**. We tell the user "swell arrives So Cal on Fri, best for south-facing spots, keep an eye on your spot report, will hit N Cal Sat, miss Hawaii, best exposure Central America." We do **not** project a height per spot — the spot report (existing pipeline) is the right level of detail for that and we don't want to overpromise spot-specific accuracy from a global model.

### 7.1 Region screening

Iterate over the app's known regions and sub-regions (Hawaii, So Cal, N Cal, PNW, Mainland Mexico, Central America, Indo, Australia, S. America — defined in `frontend/src/components/map/constants.js REGIONS`).

For each region, compute against the storm's peak-fetch position:

1. **Bearing** from storm to region centroid (great-circle).
2. **Distance** in nautical miles.
3. **Exposure match** — does the bearing fall within the region's swell window? Each region gets a window in a new `backend/config/region_swell_windows.json`, e.g.:
   ```json
   {
     "so-cal":         { "swell_window_deg": [180, 290], "facing": ["S", "SW", "W"] },
     "n-cal":          { "swell_window_deg": [220, 320], "facing": ["W", "NW"] },
     "hawaii-n-shore": { "swell_window_deg": [280, 350], "facing": ["N", "NW"] },
     "hawaii-s-shore": { "swell_window_deg": [160, 230], "facing": ["S", "SW"] },
     "central-america":{ "swell_window_deg": [180, 250], "facing": ["S", "SW"] },
     "mainland-mx":    { "swell_window_deg": [200, 280], "facing": ["S", "SW", "W"] }
   }
   ```
4. **Arrival window** — first arrival to peak to fade:
   - `arrival_hours = distance_km / (1.5 × peak_period_s × 3.6)` (group velocity)
   - `peak_arrival_hours = arrival_hours + (storm peak_intensity_hour - 0)` — peak swell rides on peak storm
   - `fade_hours = arrival_hours + storm_duration_hours + 24` — generous tail for long-period swell
5. **Impact tier** — qualitative bucket, not a height:
   - `direct` — bearing in swell window, distance < 4000 nm, peak period ≥ 12s → "best exposure"
   - `glancing` — bearing within 15° of window edge, or distance 4000–7000 nm → "will arrive but smaller"
   - `partial` — bearing inside window but distance > 7000 nm or short period → "long-period traveler, mostly outer reefs"
   - `miss` — bearing outside window by > 15°, or shadowed by land
   - `landfall_blocked` — bearing inside window but storm makes landfall before peak → "early signal then dies"
6. **Best-exposure flag** — among all `direct` impacts, the region with the best alignment + closest distance + longest fade window gets `is_best_exposure: true`. Drives the "best exposure" line in the narrative.

Output per region:
```json
{
  "region_id":          "so-cal",
  "label":              "Southern California",
  "bearing_deg":        205,
  "distance_nm":        4200,
  "exposure_facing":    ["S", "SW"],
  "impact_tier":        "direct",
  "is_best_exposure":   false,
  "arrival_iso":        "2026-04-29T14:00:00Z",
  "peak_arrival_iso":   "2026-04-30T08:00:00Z",
  "fade_iso":           "2026-05-02T20:00:00Z",
  "peak_period_s":      16,
  "swell_direction_deg":195,
  "energy_index":       0.62,
  "energy_curve":       [
    {"hour": 0,  "energy": 0.0},
    {"hour": 6,  "energy": 0.18},
    {"hour": 12, "energy": 0.45},
    {"hour": 18, "energy": 0.62},
    {"hour": 24, "energy": 0.55},
    {"hour": 30, "energy": 0.40},
    {"hour": 36, "energy": 0.22},
    {"hour": 42, "energy": 0.08}
  ]
}
```

### 7.1.1 Energy metric (drives the regional widget)

The user-facing widget visualizes "which region gets the most energy, and over what date window." For that we need a comparable scalar per region plus a curve over time.

**Per-region scalar — `energy_index`:**

Use the project's existing wave energy formula (CLAUDE.md: `WVHT² × DPD`), normalized to a 0–1 scale that's comparable across regions for the same storm:

```
projected_height_m   = peak_sea_m × decay(distance_nm, peak_period_s) × exposure_factor(bearing_match)
projected_energy     = projected_height_m² × peak_period_s
energy_index         = projected_energy / max_projected_energy_across_all_regions
```

Where:
- `decay(d, T)` is period-aware exponential decay — long-period swell (T ≥ 16s) decays slowly (~3000 km e-folding), short-period (T ≤ 10s) decays fast (~1000 km).
- `exposure_factor(bearing_match)` = `cos²` of the angular distance between storm bearing and region's swell window center, clamped to 0 outside the window.

This is theoretical — it's not "what your buoy will read." It's a comparable rank: "this region gets twice the energy of that one from this particular storm."

**Per-region curve — `energy_curve`:**

24–48 sample points from `arrival_iso` to `fade_iso`, with energy ramped in and out. Shape:

- 0% at `arrival_iso`
- Linear ramp to peak (or the storm's `peak_intensity_hour` if storm peaks while swell is en route)
- Hold near peak for `0.3 × storm_duration_hours`
- Exponential decay to 0% at `fade_iso`

This is enough fidelity for a small bar/area chart in the widget — the user sees the shape, not a precise number per hour.

### 7.1.2 What the widget can show

(Documenting the data contract — design lives elsewhere.)

A horizontal stacked viz with one row per region, X-axis = time (next 7 days):

```
Central America  ████████░░░░░░░░░░░░░░░░░░░░░  energy 0.95  ← best exposure
Mainland Mexico  ░░░██████░░░░░░░░░░░░░░░░░░░░  energy 0.71
So Cal           ░░░░░░██████░░░░░░░░░░░░░░░░░  energy 0.62
N Cal            ░░░░░░░░░████░░░░░░░░░░░░░░░░  energy 0.34
Hawaii (miss)    ─────────────────────────────  —          ← shadowed
PNW              ░░░░░░░░░░░░██░░░░░░░░░░░░░░░  energy 0.18
```

Each row's bar height encodes `energy_index`, fill position encodes the date window (`arrival_iso` → `fade_iso`), peak marker encodes `peak_arrival_iso`. Best-exposure row gets a highlight badge. "Miss" rows are flat-lined with the reason (`shadowed`, `wrong_window`, `landfall_blocked`).

The widget reads from a single endpoint:

```
GET /api/storms/{storm_id}/regional-impact

{
  "storm_id": "model-sp-55.2S-178.4E-2026-04-26T12Z",
  "narrative": "Strong low pressure deepening south of New Zealand...",
  "regions": [ ... §7.1 entries sorted by energy_index desc ... ],
  "computed_at": "2026-04-26T18:42:00Z"
}
```

### 7.2 Storm narrative

For each storm, compose a short prose summary suitable for the drawer header and Sione's storm-trip mode. Generated server-side as part of the detection job so we don't pay LLM costs on every drawer open.

Template (filled by code, not LLM — keeps it free):

```
{Storm type} at {position description}. Swell arrives {best_region} on
{best_region.arrival_iso:weekday}, peaks {peak_arrival_iso:weekday} and runs
through {fade_iso:weekday}. Best exposure: {best_region.label} ({facing}-facing
spots). Also reaches {direct_regions[1..]} {arrival_diff} later.
{Misses_regions} won't see this one. {Landfall_caveat if applicable.}
Keep an eye on your spot report for fine-grain timing.
```

Example output:
> *Strong low pressure deepening south of New Zealand. Swell arrives Central America Friday, peaks Saturday and runs through Tuesday. Best exposure: Central America (south-facing spots). Also reaches Mainland Mexico ~12h later, So Cal ~24h later. Hawaii is shadowed by the equator and won't see this one. Keep an eye on your spot report for fine-grain timing.*

The narrative is stored in `derived_storms.narrative` (text) and refreshed each detector run.

---

## 8. Reconciliation with NWS bulletins

Bulletins still win on metadata even when the wind-field detector also finds the storm:

For each bulletin storm:
1. Search the derived-storms set for a center within 300 km and within 6h of the bulletin's issued time.
2. If matched, merge:
   - Bulletin's `name`, `warning_tier`, `raw_text`, `basin_label` → onto the derived storm
   - Derived storm's `forecast_track` (full hourly resolution) → wins over bulletin's sparse waypoints
   - Bulletin's `pressure_mb` and `wind_kts` → cross-check; if bulletin disagrees with model by > 10 mb or > 15 kt, log a warning (likely a model spinup issue or stale bulletin) but trust the bulletin for display
3. If unmatched, the bulletin storm stands alone (the model missed it — rare but possible for tropical systems where convection isn't well-resolved at GFS resolution).
4. If the derived storm has no bulletin match, it's a "model storm" — display it but with a different visual treatment (e.g., dashed beacon ring, "Model-derived" tag in the drawer) so users understand the provenance.

---

## 9. Storm-detail drawer field coverage

This is the gating question — does this pipeline give us enough to fill the drawer designed in `STORM_CARD_DESIGN_BRIEF.md`? Walk through every field:

### Level 1 — Storm characterization

| Drawer field | Source |
|---|---|
| Title (type + basin) | Type from `pressure_mb` (extratropical low if >985, intensifying low if deepening, tropical if from NHC reconciliation) + basin lookup from lat/lon |
| Subtitle (lat/lon + freshness) | Detection lat/lon + GFS run timestamp |
| Central pressure | `pressure_mb` from §4.1 |
| Max sustained winds | `peak_wind_kts` from §4.2 |
| Max seas | `peak_sea_m × 3.281` from §4.3 (ft) |
| Movement | Track delta hour-0 to hour-6, §5 |
| Warning tier | From `peak_wind_kts`, §4.2 |
| Fetch summary | `fetch_peak_quadrant` + `fetch_peak_radius_nm`, §4.2 |
| Forecast track preview (24/48/72h) | From `forecast_track`, §5 — far better than bulletin's 1–2 waypoints |
| Raw bulletin text | Reconciled from bulletin if matched, else null/synthetic |

**Plus new fields the bulletins can't provide:**
- `intensification_rate_mb_per_6h` — "deepening rapidly" / "slowly weakening" badge
- `peak_intensity_hour` — "Peaks in 18h, then decays"
- `is_deepening` — animated badge while true
- `swell_direction_deg` — "Generating WNW swell at 295°"
- `peak_period_s` — "Peak period 14s"
- `will_make_landfall` + `landfall_eta_hours` — major UX win, currently impossible

### Level 2 — Regional scorecard (this is the v1 detail level)

| Drawer field | Source |
|---|---|
| Region label | From `REGIONS` constant |
| Impact tier badge | `impact_tier` from §7.1 (`direct` / `glancing` / `partial` / `miss` / `landfall_blocked`) |
| First arrival | `arrival_iso` from §7.1 |
| Peak arrival | `peak_arrival_iso` from §7.1 |
| Surf window | `arrival_iso` to `fade_iso`, formatted as days |
| Exposure hint | `exposure_facing` (e.g. "S/SW-facing spots") |
| "Best exposure" badge | `is_best_exposure` flag |
| Direction at region | `swell_direction_deg` |
| Period at region | `peak_period_s` |

**No spot-level peak size projection in v1.** Surfers click through to the spot's existing detail page (which uses CDIP/WW3 sampling at the spot location) for fine-grain timing and height. The drawer's job is "where and when, not how big at your specific spot."

### Level 3 — DROPPED for v1

The spot breakdown in `STORM_CARD_DESIGN_BRIEF.md` Level 3 is explicitly out of scope for this pipeline. Reasoning:

1. The existing spot detail page already does this well from the buoy + WW3 + spot-rating pipeline.
2. Projecting a height per spot from a global model invites "your forecast was wrong" complaints we can't reasonably honor at GFS/WW3 resolution.
3. Region + "keep an eye on your spot report" is the honest deliverable — the user follows the storm to their spot, then trusts the spot pipeline for the call.

We may revisit L3 later once we have spot-specific calibration coefficients, but it's not blocking on this work.

**Coverage:** every L1 + L2 drawer field is fillable. The narrative (§7.2) covers what the drawer can't show in tabular form.

---

## 10. Database schema

```sql
CREATE TABLE public.derived_storms (
  storm_id          text PRIMARY KEY,                   -- e.g. "model-np-45.5N-148.0W-2026-04-26T12Z"
  source            text NOT NULL,                      -- 'model' | 'bulletin' | 'reconciled'
  bulletin_storm_id text,                               -- FK-style ref to bulletin storm if reconciled
  detected_at       timestamptz NOT NULL,               -- GFS run time
  current_lat       double precision NOT NULL,
  current_lon       double precision NOT NULL,
  current_pressure_mb int,
  peak_wind_kts     int,
  warning_tier      text,
  basin_label       text,
  is_deepening      boolean,
  intensification_rate_mb_per_6h real,
  peak_intensity_hour int,
  will_make_landfall boolean,
  landfall_eta_hours int,
  forecast_track    jsonb NOT NULL,                     -- full hourly track from §5
  fetch_quadrants   jsonb NOT NULL,                     -- 8-direction radii
  peak_sea_m        real,
  peak_period_s     real,
  swell_direction_deg real,
  region_impacts    jsonb,                              -- §7.1 output (per-region tiers, arrival windows)
  narrative         text,                               -- §7.2 prose summary
  raw_bulletin_text text,                               -- copied from bulletin if reconciled
  expires_at        timestamptz NOT NULL                -- detected_at + 12h (next run replaces)
);

CREATE INDEX idx_derived_storms_active ON public.derived_storms (expires_at) WHERE expires_at > now();
CREATE INDEX idx_derived_storms_position ON public.derived_storms (current_lat, current_lon);
```

Job writes to this table, API reads from it. Cleanup job drops rows past `expires_at`.

---

## 11. Phasing

Each phase is independently shippable.

### Phase 1 — Pressure ingestion (½ day)
- Add `prmslmsl` to the GFS OPeNDAP fetcher
- New endpoint `/api/pressure-overlay?model=gfs&forecast_hour=N` (mirrors wind-overlay shape)
- Cache parity with wind overlay (5-min L1, Redis L2, disk L3)
- Frontend toggle to render pressure isobars (optional v1 — could skip and just consume in the detector)

### Phase 2 — Detector job (1 day)
- `backend/jobs/detect_storms.py` — pulls latest GFS run, runs §4 detection at every 6h step out to 168h
- Writes raw detections to a `derived_storm_detections` staging table (one row per detection per hour)
- Cron at 5 minutes past every 6h (after GFS run availability)
- Exposes `/api/storms/derived/raw?run=latest` for debugging

### Phase 3 — Track matching (1 day)
- `backend/jobs/match_tracks.py` — runs §5 against staging table
- Writes consolidated rows to `derived_storms`
- Adds `forecast_track`, intensification fields

### Phase 4 — WW3 enrichment + confirmation pass (1 day)
- Sample WW3 at each track point's center → write `peak_sea_m`, `peak_period_s`, `swell_direction_deg`
- §4.4 confirmation pass: sample Hs in the downwind cone, compute `max_cone_hs_m`, apply hard filter (drop `zero_ocean_cells` + `weak_fetch` cases)
- Tunable thresholds in `storm_detector_config.json` (hs_confirm_min_m, cone_half_angle_deg, cone_range_nm)
- Once shipped, **the interim land-mask filter in `routes/storms.py` becomes redundant** — the cone implicitly excludes continental systems via WW3's land mask. Remove the interim filter as part of this phase.

### Phase 5 — Landfall check (½ day)
- Bundle Natural Earth 1:50m as a numpy `.npz` land mask in `backend/data/`
- Walk each track, set `will_make_landfall` and `landfall_eta_hours`

### Phase 6 — Bulletin reconciliation (½ day)
- §8 logic — match bulletins to model storms, merge fields
- Write `source` and `bulletin_storm_id`

### Phase 7 — Region impact + narrative (1 day)
- `region_swell_windows.json` — codify each region's exposure window and facing list
- §7.1 region screening with impact tiers
- `is_best_exposure` selection logic
- §7.2 narrative templater (no LLM — pure string assembly so it stays free and deterministic)
- Persist `region_impacts` jsonb + `narrative` text

### Phase 8 — API + frontend (1 day)
- `/api/storms/active` switches to read from `derived_storms` (with backwards-compat shape)
- New `/api/storms/{id}/detail` for the drawer (returns full track, region impacts, bulletin text)
- Frontend storm beacon distinguishes model-derived vs bulletin-confirmed (dashed vs solid ring)
- Storm card consumes the new fields (period, direction, landfall, intensification)

**Total estimate:** ~6.5 working days for full pipeline. Phase 1+2 alone (one and a half days) gets global storm centers on the map. Phase 4 (now 1 day with confirmation pass) is what makes the detector trustworthy enough to ship as the primary storm source — without it, we'd see continental false positives on every run.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| GFS misses small/early tropical systems that bulletins catch | Bulletins still ingested; reconciliation merges them in. Drawer shows "bulletin only" badge. |
| Detector picks up weak transient lows the user doesn't care about | Tunable thresholds in `backend/config/storm_detector_config.json` — pressure cutoff, fetch radius minimum, peak wind minimum, plus §4.4 `hs_confirm_min_m` (drops lows that don't actually generate surfable seas) |
| Continental pressure minima get marked as storms (Hudson Bay, inland Canada lows) | §4.4 confirmation pass: WW3 land cells are NaN; cone with no valid ocean cells fails the filter automatically. Same mechanism handles landfalling cyclones — they decay off the map as their fetch retreats over the coast. |
| `hs_confirm_min_m` threshold drops a real but small storm a user wanted to see | Set `confirm_required: false` initially to log-only, validate against bulletin storms across a few cycles, then enable. Bulletin-confirmed storms that fail confirmation are tagged "weak" rather than dropped (§4.4 reconciliation note). |
| WW3 grid resolution misses storm-scale features | Sample over fetch box, take peak — averages out resolution noise |
| Track matcher fails on fast-moving storms | 600 km window already generous; can boost to 800 km or use intensity matching as fallback |
| Compute cost (running detection over 168 forecast hours globally per 6h cycle) | Detection is fast — global 50km grid is ~150k cells, local-minimum scan is O(n). Estimated ~30s per run. WW3 sampling is the heavier piece, can downsample to every-other-track-point. |
| Land mask accuracy near small islands | 1:50m resolves to ~5 km — good enough for "will it make landfall" at storm scale. For surfer-relevant precision (e.g., Hawaii channel storms), upgrade to 1:10m later. |

---

## 13. What this does NOT do (and what comes later)

Out of scope for v1:
- **Tropical cyclone genesis prediction** — when does the next hurricane form? GFS can show it but the science is harder; defer to NHC for named systems.
- **ECMWF ensemble.** GFS deterministic only for now. ECMWF would let us show a confidence cone on tracks. Worth it later but doubles fetch cost.
- **Storm history archive.** This pipeline shows the live model. A separate IBTrACS-style historical storm archive ("when was the last time we got a storm like this?") is a different feature.
- **Multi-storm interaction modeling.** When two storms feed into the same fetch, we treat them independently. Real interaction (Fujiwhara effects, fetch reinforcement) is a research problem.

---

## 14. Open questions

1. Do we render derived storms by default, or behind a "show model storms" toggle? Recommend default-on with a visual differentiation rather than a toggle — simpler UX, and the data is fine quality.
2. Do we keep the bulletin-only path for users who explicitly want to filter to "human-verified" storms? Probably yes via a settings toggle, but not in primary UI.
3. How far ahead do we forecast tracks? GFS runs 384h but the detector accuracy degrades fast past 96h. Recommend 168h (7 days) as the user-visible default, computed out to 240h internally for scoring.
4. Sione tool surface — does Sione's `list_active_storms` switch to the derived dataset? Yes, with a `source_filter` parameter so users can ask "show me only the bulletin-confirmed storms in the North Pacific."
