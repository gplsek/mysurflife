# Storm Detection — Execution Playbook (Phases 4-8)

**Owner:** George
**Status:** ✅ Phases 4–8 shipped (commits `12318e2`, `fe499f7`, Apr 27 2026). This doc is now a build record + verification reference, not an open work queue.
**Last updated:** 2026-05-21
**Goal:** Ship the remaining phases of `notes/GLOBAL_STORM_DETECTION_PLAN.md` so the storm map is MVP-complete.

**Prerequisite reading (do this first, in order):**
1. `notes/GLOBAL_STORM_DETECTION_PLAN.md` — design source of truth (§ references throughout this doc)
2. `notes/STORM_COVERAGE_BUGS.md` — bugs this plan resolves (especially 5, 6, 8, 9)
3. `notes/STORM_DRAWER_V2_DESIGN_BRIEF.md` — drawer field contract Phase 8 must satisfy
4. `notes/STORM_SIONE_HANDOFF.md` — Sione tool surface that consumes the new endpoints

**Working principles for this build:**
- Ship phase by phase. After each phase's "smoke test passes," commit. Do not bundle phases into one mega commit.
- All new Python modules: type hints, docstrings, f-string logging with emoji prefixes (`🌀` for detector, `🌊` for WW3, `🗺️` for landfall).
- Keep `main.py` untouched — all new endpoints go in `backend/routes/storms.py`. New jobs go in `backend/jobs/`. New services go in `backend/services/`.
- No `from x import y` for module-level mutable state. Use `import module as alias` (see `services/state.py` docstring).
- Every external fetch wrapped in `try/except` with timeout + fallback. Log failures with the storm_id or run_date so production can grep them.

---

## Audit — what's already in place

> **Update (2026-05-21):** the original audit below (written 2026-04-27 morning) is superseded — Phases 4–8 shipped that same afternoon in commits `12318e2` (GFS detector, Bugs 5 & 6) and `fe499f7` (WW3 enrichment + region impact + DB persistence). The table reflects current `main`.

| Phase | Plan reference | Actual state |
|---|---|---|
| 1 (Pressure ingestion) | §11 Phase 1 | **Done in-job, no separate endpoint.** `backend/jobs/detect_storms.py:fetch_gfs_global_field()` pulls PRMSL+UGRD+VGRD globally from NOMADS in one shot. The separate `/api/pressure-overlay` endpoint was intentionally skipped — data is consumed directly by the detector, never round-trips through HTTP. |
| 2 (Detector job) | §11 Phase 2 | **Done.** `find_pressure_minima` + `cluster_minima` + `compute_fetch_geometry` + `detect_at_hour`; `_assign_ocean_basin` covers all 7 basins incl. SH. Loop wired in `run_storm_detection_loop()` (90s startup + 6h refresh). |
| 3 (Track matching) | §11 Phase 3 | **Done.** `match_tracks()` (≤600 km + ≤20 mb between linked steps) builds the `forecast_track` array. Dynamics gap closed in Phase 4 (`_annotate_track_dynamics`). |
| 4 (WW3 enrichment + confirmation pass) | §4.3, §4.4, §11 Phase 4 | **Done** (`fe499f7`). `fetch_ww3_global_hs` + `sample_hs_cone` populate `peak_sea_m` / `peak_period_s` / `swell_direction_deg` / `max_cone_hs_m`. `_annotate_track_dynamics` adds `is_deepening` / `intensification_rate_mb_per_6h` / `peak_intensity_hour`. Tests: `backend/test_detect_storms_ww3.py`. |
| 5 (Landfall check) | §6, §11 Phase 5 | **Done** (`fe499f7`). `_annotate_landfall` checks forecast-track points (not just the current center) and sets the landfall fields. |
| 6 (Bulletin reconciliation) | §8, §11 Phase 6 | **Done** (`fe499f7`). `backend/services/storm_reconciliation.py:reconcile()` merges bulletin metadata onto matched derived storms. Tests: `backend/test_storm_reconciliation.py`. |
| 7 (Region impact + narrative) | §7, §11 Phase 7 | **Done** (`fe499f7`). `backend/services/region_impact.py` (`score_storm_against_regions` + `compose_narrative`) + `backend/config/region_swell_windows.json`. |
| 8 (DB + new endpoints + frontend) | §10, §11 Phase 8 | **Done** (`fe499f7`). Migration `018_derived_storms.sql` present; `_persist_derived_storms` + `_storm_to_row` write rows; `GET /api/storms/{storm_id}/detail` live. Frontend source differentiation (`2092503`) + dashboard storm UI (`9c7839e`, `fe6620d`, `fcf1488`, `6d8f256`). |

**Latest migration:** `018_derived_storms.sql`.

**Remaining follow-ups (not blockers):** (1) confirm the detection loop is actually launched in `main.py` startup(); (2) verify `global-land-mask` is installed in prod — graceful fallback if not; (3) the build's own "do not bundle phases into one mega commit" rule was relaxed for `fe499f7` (Phases 4+7+8 in one commit), so spot-check each phase's Verification block below rather than assuming parity.

---

## Dependencies to install before starting

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt   # picks up global-land-mask added 2026-04-27
```

If `global-land-mask` is unavailable in your environment, all phases that import it have graceful fallbacks (Phase 5 detector keeps running but skips landfall check; Phase 4 cone sampling treats NaN cells as "ocean missing" rather than relying on package-level land detection).

---

## PHASE 4 — WW3 enrichment + confirmation pass

**Goal:** every detected storm has WW3 fields populated AND fails-fast if no surf-relevant Hs response is found within its downwind cone. This is the algorithmic equivalent of how Stormsurf users visually confirm storms — see the Hs blob, not just the pressure low.

**Files touched:**
- `backend/jobs/detect_storms.py` — add WW3 fetcher + cone sampler + filter integration
- `backend/config/storm_detector_config.json` — NEW, threshold tunables
- `backend/tests/test_detect_storms_ww3.py` — NEW unit tests (see §Verification below)

### 4.1 New config file

Path: `backend/config/storm_detector_config.json`

```json
{
  "$comment": "Tunables for the GFS+WW3 cyclone detector. See notes/GLOBAL_STORM_DETECTION_PLAN.md §4.4.",
  "max_pressure_mb":          1005,
  "cluster_radius_km":          200,
  "track_radius_km":            600,
  "track_pressure_delta_mb":     20,
  "hs_confirm_min_m":           3.0,
  "cone_half_angle_deg":          45,
  "cone_range_nm":         [100, 800],
  "confirm_required":          false,
  "$confirm_required_note": "Set to true to actually drop unconfirmed model storms. Start false (log-only) for at least 2 GFS cycles, validate against bulletin storms, then flip on."
}
```

`detect_storms.py` must read this file at module load via `_load_config()`. Existing module constants (`_MAX_PRESSURE_MB`, `_CLUSTER_RADIUS_KM`, `_TRACK_RADIUS_KM`, `_TRACK_PRESSURE_DELTA`) get reassigned from the config rather than hardcoded — this is a one-time refactor at the top of the file. Fail loud (raise) if the config file is missing; fall back silently to defaults if individual keys are missing.

### 4.2 WW3 global fetcher (mirrors the GFS fetcher)

Add to `detect_storms.py`:

```python
async def fetch_ww3_global_hs(
    run_date: str,
    run_cycle: str,
    forecast_hour: int,
) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """
    Download global WW3 0.5° HTSGW (Hs, m), PERPW (period, s), DIRPW (dir, deg)
    for one forecast hour. Returns (hs_m, period_s, dir_deg, lat_1d, lon_1d) or None.

    NOMADS pattern (mirrors filter_wave.pl URL used in main.py:fetch_real_noaa_ww3_opendap).
    Land cells come back as NaN — the cone sampler relies on this.
    """
```

Implementation notes:
- Reuse the `multi_1.glo_30m.t{HH}z.f{NNN}` filename pattern from `main.py:_format_dir_param`.
- Variables: `var_HTSGW=on&var_PERPW=on&var_DIRPW=on`.
- Cycles available: 00/06/12/18Z, hours 0..180 in 3h steps. Detector queries 0/6/12/.../168 — round to nearest available WW3 hour (typically same hour since 6 is a multiple of 3).
- Returns numpy arrays in shape `(lat, lon)`. Lon is 0..360 (caller normalizes to -180..180 the same way the GFS fetcher does).
- 60s timeout. If WW3 run timing differs from GFS run timing (it usually does — WW3 lags by ~1 cycle), accept the most recent WW3 run available, even if it's 6h older than the GFS run; log the lag.

### 4.3 Cone sampler

Add to `detect_storms.py`:

```python
def sample_hs_cone(
    hs_arr: np.ndarray,
    lat_1d: np.ndarray,
    lon_1d: np.ndarray,
    center_lat: float,
    center_lon: float,
    peak_quadrant: Optional[str],          # from compute_fetch_geometry
    half_angle_deg: float = 45.0,
    range_nm: Tuple[int, int] = (100, 800),
) -> Dict:
    """
    Sample WW3 Hs in a downwind cone from (center_lat, center_lon).
    Cone axis = direction storm fetch is pointing (peak_quadrant).
    Returns {max_hs_m, mean_hs_m, ocean_cells, total_cells, samples}.
    Land cells (NaN) are excluded from stats. ocean_cells == 0 means cone
    has no fetch over water → storm gets dropped.
    """
```

Algorithm:
1. Convert `peak_quadrant` ('N','NE',...,'NW') to a center bearing in degrees (N=0, E=90, S=180, W=270; NE=45, etc). If `peak_quadrant` is None, the storm has no detectable fetch — return `{max_hs_m: NaN, ocean_cells: 0, ...}` and let the filter drop it.
2. For each (lat, lon) cell in the WW3 grid, compute great-circle distance and bearing from the storm center. Use the haversine helper already in the file.
3. Keep cells where: `range_nm[0] ≤ distance ≤ range_nm[1]` AND `|bearing - cone_bearing| ≤ half_angle_deg` (handle bearing wraparound at 0/360).
4. From kept cells, drop NaN Hs values (those are land or missing).
5. Return stats. Also include `samples: List[{lat, lon, hs_m}]` of up to 8 strongest cells for debugging via the future `/api/storms/_debug` endpoint extension.

Performance: the WW3 grid is ~720×360 cells. For each storm, only a small fraction falls in the cone. A naive O(grid) loop per storm is fine (~50ms × 30 storms × 30 hours = 45s/run, acceptable). If profiling shows it's a bottleneck later, vectorize with numpy bearing calc — but don't pre-optimize.

### 4.4 Integrate confirmation pass into `detect_at_hour`

Modify the existing `detect_at_hour()` to take WW3 arrays:

```python
def detect_at_hour(
    pres_pa, u_ms, v_ms,
    lat_1d, lon_1d,
    hours_ahead,
    hs_arr=None, ww3_lat=None, ww3_lon=None,    # NEW — None = legacy path
    config=None,                                  # NEW — for thresholds
) -> List[Dict]:
```

For each detected center, after `fetch = compute_fetch_geometry(...)`:

1. If WW3 arrays provided, call `sample_hs_cone(...)` with `peak_quadrant = fetch["peak_quadrant"]`.
2. Sample WW3 *at the storm center* (single grid lookup) to get `peak_sea_m`, `peak_period_s`, `swell_direction_deg`. Land/NaN at center → leave these null.
3. Set `confirmation_status` based on cone result:
   - `cone_result["ocean_cells"] == 0` → `"land_only"` (no ocean in cone)
   - `cone_result["max_hs_m"] < hs_confirm_min_m` → `"weak_fetch"`
   - otherwise → `"confirmed"`
4. Add `max_cone_hs_m` to the detection dict.
5. **Drop unconfirmed storms** if `config["confirm_required"]` is True AND `confirmation_status != "confirmed"`. Otherwise keep them tagged but log the would-be-dropped count: `print(f"🌊 confirm: would-drop {n} storms (confirm_required=False)")`.

### 4.5 Wire WW3 into `run_detection`

In `run_detection()`, after resolving the GFS run, also resolve the latest WW3 run (reuse `main.py:_resolve_latest_ww3_run` pattern — copy the function body, don't import from main.py):

```python
ww3_date, ww3_cycle = await _resolve_latest_ww3_run()
```

Inside the per-hour loop, fetch WW3 for that forecast hour alongside GFS:

```python
gfs_result = await fetch_gfs_global_field(run_date, run_cycle, fh)
ww3_result = await fetch_ww3_global_hs(ww3_date, ww3_cycle, fh)
# Pass both into detect_at_hour
```

If WW3 fetch fails (`ww3_result is None`), proceed with GFS-only detection — every storm gets `confirmation_status: "ww3_unavailable"` and `confirm_required` doesn't apply (we never drop on missing-data, only on actively-failing-the-test).

### 4.6 Compute intensification fields

After `match_tracks()` builds storm dicts, add a derived-fields step. New helper:

```python
def _annotate_track_dynamics(storm: Dict) -> None:
    """Compute intensification_rate_mb_per_6h, peak_intensity_hour, is_deepening
    from the forecast_track. Mutates storm in place."""
```

Logic:
- `intensification_rate_mb_per_6h` = avg pressure delta over first 24h of track (4 steps). Negative = deepening.
- `peak_intensity_hour` = `track[argmin(pressure_mb)].hours_ahead`.
- `is_deepening` = `track[1].pressure_mb < track[0].pressure_mb` (next step is deeper).

Call from `match_tracks` for each storm before append.

### 4.7 Verification

Smoke test (no live network):

```bash
cd backend && pytest tests/test_detect_storms_ww3.py -v
```

Tests to write in `backend/tests/test_detect_storms_ww3.py`:
- `test_sample_hs_cone_land_only` — feed a 4×4 NaN array, expect `ocean_cells == 0`.
- `test_sample_hs_cone_strong_fetch` — synthetic Hs grid with 8m peak in NE quadrant, peak_quadrant='NE', expect `max_hs_m ≈ 8.0`.
- `test_sample_hs_cone_weak_fetch` — synthetic Hs grid all 1.5m, expect `max_hs_m < 3.0` (would-drop case).
- `test_sample_hs_cone_no_quadrant` — `peak_quadrant=None`, expect `ocean_cells == 0`.
- `test_annotate_track_dynamics` — synthetic 5-point track from 1010→990→980→985→995, expect `peak_intensity_hour=12`, `is_deepening=True`.

Live integration test (requires NOMADS access):

```bash
cd backend && python3 -c "
import asyncio
from jobs.detect_storms import run_detection
storms = asyncio.run(run_detection())
print(f'Total: {len(storms)}')
print(f'Confirmed: {sum(1 for s in storms if s.get(\"confirmation_status\") == \"confirmed\")}')
print(f'Weak fetch: {sum(1 for s in storms if s.get(\"confirmation_status\") == \"weak_fetch\")}')
print(f'Land only: {sum(1 for s in storms if s.get(\"confirmation_status\") == \"land_only\")}')
"
```

Expected: at least one confirmed storm in active basins. Land_only count should be > 0 over a full 168h run (continental pressure minima are common in mid-latitude winter). Weak fetch should outnumber confirmed when basins are seasonally quiet.

**Acceptance criteria for Phase 4:**
1. Pytest passes.
2. Live run produces at least one `confirmation_status: "confirmed"` storm.
3. `/api/storms/active` response shows `peak_sea_m`, `peak_period_s`, `swell_direction_deg`, `max_cone_hs_m`, `confirmation_status`, `is_deepening`, `intensification_rate_mb_per_6h`, `peak_intensity_hour` on every model storm.
4. Logs show `🌊 confirm: would-drop N storms (confirm_required=False)` on each detection run.

**Commit message:** `feat(storms): WW3 confirmation pass + intensification dynamics`

---

## PHASE 5 — Landfall check on tracks

**Goal:** for every storm, walk the forecast track and flag whether it crosses land before peak intensity. Drives "swell window closes Tuesday" copy in the drawer.

**Files touched:**
- `backend/jobs/detect_storms.py` — add `_annotate_landfall()` helper, call from `match_tracks()`

### 5.1 Implementation

Reuse `global_land_mask.globe.is_land(lat, lon)` already added in `routes/storms.py`. Move the import-with-fallback to a shared spot — top of `detect_storms.py`:

```python
try:
    from global_land_mask import globe as _globe_land
except ImportError:
    _globe_land = None
```

```python
def _annotate_landfall(storm: Dict) -> None:
    """Walk forecast_track; set will_make_landfall + landfall_eta_hours.
    Mutates storm in place. No-op if global_land_mask is unavailable."""
    if _globe_land is None:
        return
    track = storm.get("forecast_track") or []
    peak_hour = storm.get("peak_intensity_hour")
    for wp in track:
        if not _globe_land.is_land(float(wp["lat"]), float(wp["lon"])):
            continue
        # First land hit found
        storm["will_make_landfall"] = True
        storm["landfall_eta_hours"] = wp["hours_ahead"]
        # If landfall happens before peak intensity, flag for swell-window UX
        storm["landfall_before_peak"] = (
            peak_hour is not None and wp["hours_ahead"] < peak_hour
        )
        return
    storm["will_make_landfall"] = False
```

Call from `match_tracks()` after `_annotate_track_dynamics(storm)`.

### 5.2 Verification

Add unit tests to `test_detect_storms_ww3.py`:
- `test_landfall_oceanic_track` — synthetic track entirely over open Pacific, expect `will_make_landfall=False`.
- `test_landfall_crosses_coast` — synthetic track that lands in BC after 36h, expect `landfall_eta_hours=36`.
- `test_landfall_before_peak_flag` — track with `peak_intensity_hour=48` and landfall at hour 36, expect `landfall_before_peak=True`.

**Acceptance criteria:**
1. Tests pass.
2. Live run shows `will_make_landfall: true` on at least one storm headed for North America in the 168h window.

**Commit message:** `feat(storms): landfall check on forecast tracks`

---

## PHASE 6 — Real bulletin reconciliation (§8)

**Goal:** when a derived storm matches a bulletin storm in space + time, merge bulletin metadata onto it. When unmatched, both flow through with provenance flags. Replaces the current naive distance-dedupe in `routes/storms.py:200-218`.

**Files touched:**
- `backend/services/storm_reconciliation.py` — NEW
- `backend/routes/storms.py` — replace existing model-merge block with a call to the new service

### 6.1 New service module

Path: `backend/services/storm_reconciliation.py`

```python
"""services/storm_reconciliation.py — merge bulletin storms with model-detected storms.

Logic per §8 of GLOBAL_STORM_DETECTION_PLAN.md:
  - Match bulletin → model within 300 km AND within 6h of bulletin issued time.
  - On match: keep model storm, overwrite name/warning_tier/raw_text/basin_label
    from bulletin, prefer bulletin pressure/wind for display, log if model
    disagrees with bulletin > 10 mb or > 15 kt.
  - Bulletin-only matches survive as bulletin storms (model missed them).
  - Model-only matches survive tagged source='model'.
  - Result has source ∈ {'bulletin', 'model', 'reconciled'}.
"""
```

Public API:

```python
def reconcile(
    bulletin_storms: List[Dict],
    model_storms: List[Dict],
    *,
    spatial_radius_km: float = 300,
    time_window_hours: float = 6,
) -> List[Dict]:
    """Returns the merged storm list. Each storm has 'source' set."""
```

Algorithm:
1. For each bulletin storm, find the nearest model storm within `spatial_radius_km`. If matched, build a reconciled dict:
   - All bulletin fields override model fields EXCEPT `forecast_track` (model wins — full hourly resolution beats sparse bulletin waypoints), `peak_sea_m`/`peak_period_s`/`swell_direction_deg` (model wins — bulletin doesn't have period/direction), and the new dynamics fields (`is_deepening`, `peak_intensity_hour`, `intensification_rate_mb_per_6h`).
   - `source = "reconciled"`.
   - `bulletin_storm_id = bulletin["id"]`.
2. Mark matched model storms as consumed; remaining model storms get `source = "model"` (already set upstream).
3. Unmatched bulletin storms get `source = "bulletin"`.
4. Log mismatches: if `abs(bulletin.pressure_mb - model.pressure_mb) > 10`, print `⚠️ reconcile: pressure mismatch storm={id} bulletin={X} model={Y}`. Same for wind > 15 kt.

### 6.2 Wire into `routes/storms.py`

Replace the existing block at `routes/storms.py:200-218` with:

```python
# Reconcile bulletin + model storms (§8 reconciliation)
try:
    from services.storm_reconciliation import reconcile
    from jobs.detect_storms import get_cached_model_storms
    model_storms = get_cached_model_storms() or []
    out = reconcile(out, model_storms)
except Exception as e:
    print(f"⚠️  storms/active: reconcile failed: {e}")
```

The land-mask filter and dedupe-complex-lows that follow are unchanged.

### 6.3 Verification

Tests in `backend/tests/test_storm_reconciliation.py` (NEW):
- `test_reconcile_match_overrides_bulletin_metadata` — bulletin {pressure=985, name="Atlantic LOW"} + model {pressure=982, peak_sea_m=8} within 200km, expect merged storm with name="Atlantic LOW", pressure_mb=985 (bulletin wins for display), peak_sea_m=8 (model wins), source='reconciled'.
- `test_reconcile_bulletin_only` — bulletin storm with no model match within 1000km, expect output keeps it with source='bulletin'.
- `test_reconcile_model_only` — model storm with no bulletin match, expect source='model'.
- `test_reconcile_logs_mismatch` — bulletin pressure=970, model pressure=985, expect warning logged.

**Acceptance criteria:**
1. Tests pass.
2. `/api/storms/active` response shows `source: "reconciled"` on at least one storm during a season when KWBC has issued bulletins. Verify with: `curl localhost:8000/api/storms/active | jq '[.storms[] | .source] | group_by(.) | map({source: .[0], count: length})'`.

**Commit message:** `feat(storms): bulletin/model reconciliation per §8`

---

## PHASE 7 — Region impact + narrative

**Goal:** for each storm, score its impact against each surf region (So Cal, N Cal, Hawaii, etc.) — bearing match, distance, arrival timing, energy index. Plus a deterministic prose narrative.

**Files touched:**
- `backend/config/region_swell_windows.json` — NEW
- `backend/services/region_impact.py` — NEW
- `backend/jobs/detect_storms.py` — call region_impact + narrative after track dynamics
- Storm dict gains `region_impacts: List[Dict]` and `narrative: str` fields

### 7.1 Region windows config

Path: `backend/config/region_swell_windows.json`

```json
{
  "$comment": "Per-region swell exposure windows. Bearings in degrees from storm to region. See GLOBAL_STORM_DETECTION_PLAN.md §7.1.",
  "regions": {
    "so-cal":           { "label": "Southern California", "centroid": [33.5, -118.0], "swell_window_deg": [180, 290], "facing": ["S", "SW", "W"] },
    "n-cal":            { "label": "Northern California", "centroid": [38.0, -123.0], "swell_window_deg": [220, 320], "facing": ["W", "NW"] },
    "pnw":              { "label": "Pacific Northwest",   "centroid": [46.0, -124.0], "swell_window_deg": [230, 330], "facing": ["W", "NW"] },
    "hawaii-n-shore":   { "label": "Hawaii N Shore",       "centroid": [21.7, -158.0], "swell_window_deg": [280, 360], "facing": ["N", "NW"] },
    "hawaii-s-shore":   { "label": "Hawaii S Shore",       "centroid": [21.3, -157.8], "swell_window_deg": [160, 230], "facing": ["S", "SW"] },
    "central-america":  { "label": "Central America",      "centroid": [11.0,  -86.0], "swell_window_deg": [180, 250], "facing": ["S", "SW"] },
    "mainland-mx":      { "label": "Mainland Mexico",      "centroid": [16.5,  -99.5], "swell_window_deg": [200, 280], "facing": ["S", "SW", "W"] },
    "indo":             { "label": "Indonesia",            "centroid": [-8.5,  115.0], "swell_window_deg": [180, 240], "facing": ["S", "SW"] },
    "australia-east":   { "label": "Australia East Coast", "centroid": [-33.0, 151.5], "swell_window_deg": [120, 220], "facing": ["E", "SE", "S"] }
  }
}
```

Note: `centroid` is the lat/lon used for bearing calc. Verify centroid values match `frontend/src/components/map/constants.js REGIONS` if that file exists; if it disagrees, the frontend constants are source of truth — copy from there.

### 7.2 New service

Path: `backend/services/region_impact.py`

```python
"""services/region_impact.py — score each storm against surf regions.

Per §7.1 of GLOBAL_STORM_DETECTION_PLAN.md:
  - Compute bearing from storm to region centroid.
  - Distance + arrival timing via group velocity (1.5 × T × 3.6 km/h).
  - Impact tier: direct | glancing | partial | miss | landfall_blocked.
  - Energy index (0-1) from projected_height² × period, normalized across regions.
  - Energy curve (24-48 samples from arrival → fade).
  - Narrative templater: pure string assembly, no LLM.
"""
```

Public API:

```python
def score_storm_against_regions(storm: Dict) -> List[Dict]:
    """Returns sorted region_impacts list (highest energy_index first)."""

def compose_narrative(storm: Dict, region_impacts: List[Dict]) -> str:
    """Returns prose summary suitable for drawer header. No LLM call."""
```

Algorithm details — copy from §7.1 of the design plan verbatim. Critical details often missed:
- `decay(d, T)` is period-aware exponential: `e^(-d / e_fold(T))` where `e_fold(T) = 3000 km` for T ≥ 16s, `1000 km` for T ≤ 10s, linear interp between.
- `exposure_factor(bearing_match)` = `cos²(angular_offset_from_window_center)`, 0 outside window.
- Energy curve shape: 0% at arrival, ramp to peak by `peak_arrival_hours`, hold at peak for `0.3 × storm_duration_hours`, exponential decay to fade.
- `is_best_exposure` = pick the single region with highest `energy_index` AMONG those with `impact_tier == "direct"`. If no direct hits, no region gets the flag.

Narrative templater — fill the template from §7.2:

```python
_NARRATIVE_TEMPLATE = (
    "{storm_type} at {position_phrase}. Swell arrives {best_region.label} "
    "{arrival_weekday}, peaks {peak_weekday} and runs through {fade_weekday}. "
    "Best exposure: {best_region.label} ({facing}-facing spots)."
    "{also_reaches_clause}{misses_clause}{landfall_clause} "
    "Keep an eye on your spot report for fine-grain timing."
)
```

`also_reaches_clause` is " Also reaches {direct_regions[1..]} {arrival_diff} later." with arrival_diff formatted as "~12h" or "~36h".

If no `direct` regions match: short fallback narrative `"{storm_type} at {position_phrase}. No surf-relevant regions in the {N}-day forecast window."`.

### 7.3 Hook into detector

In `match_tracks()`, after `_annotate_track_dynamics(storm)` and `_annotate_landfall(storm)`:

```python
from services.region_impact import score_storm_against_regions, compose_narrative
storm["region_impacts"] = score_storm_against_regions(storm)
storm["narrative"] = compose_narrative(storm, storm["region_impacts"])
```

### 7.4 Verification

Tests in `backend/tests/test_region_impact.py` (NEW):
- `test_score_so_cal_direct_hit` — synthetic storm at 30°N 130°W with `peak_period_s=16`, `peak_sea_m=6`, expect So Cal `impact_tier='direct'`, energy_index ~0.6+.
- `test_score_hawaii_shadow` — storm in N Atlantic, expect Hawaii regions get `impact_tier='miss'`.
- `test_landfall_blocked_tier` — storm with `landfall_before_peak=True` and bearing in So Cal window, expect `impact_tier='landfall_blocked'`.
- `test_narrative_includes_best_region` — synthetic storm with one direct hit, expect narrative mentions that region's label and uses correct weekday names from `arrival_iso`.
- `test_narrative_no_direct_hits` — all regions miss, expect fallback narrative.

**Acceptance criteria:**
1. Tests pass.
2. Live run: `curl localhost:8000/api/storms/active | jq '.storms[0].region_impacts | length'` ≥ 9 (one per region).
3. `curl localhost:8000/api/storms/active | jq '.storms[0].narrative'` returns a non-empty string with "Best exposure" or "No surf-relevant regions".

**Commit message:** `feat(storms): region impact scoring + narrative templater`

---

## PHASE 8 — DB persistence + new endpoint + frontend wiring

**Goal:** persist derived storms to Postgres, expose `/api/storms/{id}/detail`, surface the new fields in the storm card / drawer.

**Files touched:**
- `supabase/migrations/018_derived_storms.sql` — NEW
- `backend/jobs/detect_storms.py` — add `_persist_derived_storms()` write step
- `backend/routes/storms.py` — add `GET /api/storms/{id}/detail`
- `frontend/src/components/map/StormCard.jsx` — surface period, direction, landfall, intensification, narrative, region_impacts widget

### 8.1 Migration

Path: `supabase/migrations/018_derived_storms.sql`

Schema per §10 of the design plan, with one tweak: `forecast_track`, `fetch_quadrants`, `region_impacts` are jsonb (matches §10). Add an additional `confirmation_status` text column and `max_cone_hs_m` real column for the Phase 4 fields.

```sql
-- Migration 018: derived_storms — primary source for /api/storms/active
-- Replaces the in-memory _model_storms_cache as the durable store.

CREATE TABLE IF NOT EXISTS public.derived_storms (
    storm_id          text PRIMARY KEY,
    source            text NOT NULL,                       -- 'model' | 'bulletin' | 'reconciled'
    bulletin_storm_id text,
    detected_at       timestamptz NOT NULL,
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
    landfall_before_peak boolean,
    forecast_track    jsonb NOT NULL,
    fetch_quadrants   jsonb NOT NULL,
    peak_sea_m        real,
    peak_period_s     real,
    swell_direction_deg real,
    max_cone_hs_m     real,
    confirmation_status text,
    region_impacts    jsonb,
    narrative         text,
    raw_bulletin_text text,
    expires_at        timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_derived_storms_active
    ON public.derived_storms (expires_at) WHERE expires_at > now();
CREATE INDEX IF NOT EXISTS idx_derived_storms_position
    ON public.derived_storms (current_lat, current_lon);
CREATE INDEX IF NOT EXISTS idx_derived_storms_source
    ON public.derived_storms (source);

-- RLS: public read, no public write (writes via service-role from backend job)
ALTER TABLE public.derived_storms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "derived_storms_public_read" ON public.derived_storms
    FOR SELECT USING (true);
```

Apply via:

```bash
# Local
psql $DATABASE_URL -f supabase/migrations/018_derived_storms.sql
# Production: apply through Supabase dashboard or `supabase db push` per project convention
```

### 8.2 Persistence step in detector

After `match_tracks()` and all annotations, write to Postgres:

```python
async def _persist_derived_storms(storms: List[Dict], detected_at: datetime) -> None:
    """Upsert each storm into derived_storms with expires_at = detected_at + 12h."""
    from database import get_supabase_admin_client, supabase
    client = get_supabase_admin_client() or supabase
    if not client:
        print("⚠️  detect_storms: no DB client; skipping persistence")
        return
    expires_at = (detected_at + timedelta(hours=12)).isoformat()
    rows = [_storm_to_row(s, detected_at, expires_at) for s in storms]
    try:
        client.table("derived_storms").upsert(rows, on_conflict="storm_id").execute()
        print(f"✅ detect_storms: persisted {len(rows)} storms")
    except Exception as e:
        print(f"❌ detect_storms: persistence failed: {e}")
```

`_storm_to_row()` maps the storm dict to the table column shape. Drop fields not in the schema (e.g., `label`, computed for display only).

Call from `run_detection()` after `set_cached_model_storms(storms)`:

```python
await _persist_derived_storms(storms, datetime.utcnow().replace(tzinfo=timezone.utc))
```

The in-memory cache stays as a fast read path; DB is the durable source. `/api/storms/{id}/detail` reads from DB; `/api/storms/active` continues to read the cache (no DB latency on hot path) but falls back to DB if cache is empty.

### 8.3 New endpoint

In `backend/routes/storms.py`:

```python
@router.get("/api/storms/{storm_id}/detail")
async def get_storm_detail(storm_id: str):
    """
    Full storm record for the drawer — track, region impacts, narrative,
    raw bulletin text, intensification + landfall fields.

    Reads from derived_storms (DB) so the drawer survives a backend restart.
    Falls back to the in-memory cache if DB is unavailable.
    """
```

Implementation:
1. Try DB lookup: `client.table("derived_storms").select("*").eq("storm_id", storm_id).single().execute()`.
2. On DB miss/error, fall back to scanning `get_cached_model_storms()` and the bulletin path.
3. Return 404 with body `{"error": "storm_not_found", "storm_id": storm_id}` if neither finds it (storms expire after 12h).
4. Sanitize NaN/Inf via the existing `json_sanitize()` pattern from `main.py`.

### 8.4 Frontend wiring

`frontend/src/components/map/StormCard.jsx`:
- New section "Storm Dynamics": `is_deepening` badge (animated pulse if true), `intensification_rate_mb_per_6h` ("deepening 4 mb / 6h"), `peak_intensity_hour` ("peaks in 18h").
- New section "Landfall": only render if `will_make_landfall === true`. Shows `landfall_eta_hours`. If `landfall_before_peak`, add red "Storm dies before peak" warning.
- Replace existing peak-sea readout: include `peak_period_s` ("16s WNW") and convert `swell_direction_deg` to a compass label ("WNW") + arrow icon.
- New "Regional Impact" widget: stacked horizontal bars per region from §7.1.2 of the design plan. Read from `region_impacts`. Highlight `is_best_exposure: true` row.
- Render `narrative` at the top of the card as the headline text, replacing whatever's currently there.

Fetch detail on card open:

```js
const [detail, setDetail] = useState(null);
useEffect(() => {
  if (!storm?.id) return;
  fetch(`/api/storms/${storm.id}/detail`)
    .then(r => r.json())
    .then(setDetail);
}, [storm?.id]);
```

Use `detail` for the new fields, fall back to `storm` for the basics so the card still renders if the detail call is in flight.

CSS for `.source-model` ring style — verify it exists in the storm marker CSS file (likely `frontend/src/components/map/StormMarker.css` or similar). If not, add:

```css
.marker-storm.source-model .ring {
  stroke-dasharray: 4 6;
  opacity: 0.7;
}
```

### 8.5 Verification

```bash
# Migration applied
psql $DATABASE_URL -c "SELECT count(*) FROM public.derived_storms;"
# Expected: 0 initially, then matches detector run count after first cycle

# Detector persistence
sudo systemctl restart mysurflife-backend
sudo journalctl -u mysurflife-backend -f | grep "persisted"
# Expected: "✅ detect_storms: persisted N storms" within 90s + 1 detection cycle

# New endpoint
curl "http://localhost:8000/api/storms/active" | jq '.storms[0].id' | xargs -I{} curl "http://localhost:8000/api/storms/{}/detail" | jq '.narrative, .region_impacts | length'

# Frontend visual smoke
npm start
# Open localhost:3000, click a storm beacon → drawer should show:
#   - Narrative at top
#   - Storm dynamics section
#   - Landfall section (if applicable)
#   - Regional impact widget with at least 4 bars
#   - Period + compass direction in peak-sea readout
```

**Acceptance criteria:**
1. Migration applied; row count > 0 after one detector cycle.
2. `/api/storms/{id}/detail` returns 200 with all Phase 4-7 fields populated.
3. Storm card renders all new sections without console errors.
4. Model-derived beacons render with dashed ring (visible difference from bulletin/reconciled).
5. Drawer survives backend restart (DB-backed, not just cache).

**Commit message:** `feat(storms): persistence + detail endpoint + drawer fields`

---

## Final integration test (end-to-end)

After all phases ship and the backend has run at least one full detection cycle:

```bash
# 1. Detector cycle completed
sudo journalctl -u mysurflife-backend --since "10 minutes ago" | grep "storm detector:" | tail -20

# 2. Pipeline diagnostic
curl -s "http://localhost:8000/api/storms/_debug" | jq '{
  totals: .totals,
  per_ocean_drops: [.oceans[] | {ocean: .ocean, dropped: .filter.dropped}]
}'

# 3. Active storms with new fields
curl -s "http://localhost:8000/api/storms/active" | jq '
  .storms | map({
    id,
    source,
    confirmation_status,
    period: .peak_period_s,
    landfall: .will_make_landfall,
    n_regions: (.region_impacts | length),
    has_narrative: (.narrative != null and .narrative != "")
  }) | .[0:5]'

# 4. Detail endpoint per storm
for sid in $(curl -s "http://localhost:8000/api/storms/active" | jq -r '.storms[0:3].id'); do
  echo "=== $sid ==="
  curl -s "http://localhost:8000/api/storms/$sid/detail" | jq '{narrative, n_regions: (.region_impacts | length), has_track: ((.forecast_track | length) > 0)}'
done

# 5. Pytest
cd backend && pytest tests/test_detect_storms_ww3.py tests/test_storm_reconciliation.py tests/test_region_impact.py -v
```

All assertions must pass before declaring MVP complete.

---

## Deployment runbook

```bash
# 1. Merge feature branch to main
git checkout main && git pull && git merge feat/storm-detection-mvp

# 2. Deploy backend
./deploy.sh

# 3. Apply migration in prod (if not auto-applied)
# Via Supabase dashboard SQL editor, paste contents of 018_derived_storms.sql

# 4. Restart backend
sudo systemctl restart mysurflife-backend

# 5. Watch first detection cycle (90s startup + ~5min detection)
sudo journalctl -u mysurflife-backend -f
# Look for: "✅ storm detector: N tracked storms" and "✅ detect_storms: persisted N storms"

# 6. Smoke test prod
curl "https://mysurflife.com/api/storms/active" | jq '.count'
curl "https://mysurflife.com/api/storms/_debug" | jq '.totals'
```

---

## Rollback plan

If anything misbehaves in prod after deploy:

1. **Revert backend code:** `git revert <merge-commit> && ./deploy.sh && sudo systemctl restart mysurflife-backend`. Backend falls back to bulletin-only `/api/storms/active`. The migration stays in place but the new table goes unused — harmless.
2. **Disable detector loop only (lighter touch):** in `main.py` startup(), comment out the `asyncio.create_task(run_storm_detection_loop())` call and restart. Bulletin path keeps working; model storms disappear from the map.
3. **Frontend regression:** revert `frontend/src/components/map/StormCard.jsx` and rebuild. Card falls back to old layout; new fields stay on the API but go unrendered.

The migration itself is non-destructive (CREATE TABLE IF NOT EXISTS), so no rollback is needed unless the column types are wrong — in which case `DROP TABLE public.derived_storms;` and re-create from a corrected migration.

---

## Open questions for George (resolve before Phase 7)

1. **Region centroids:** the values in `region_swell_windows.json` above are rough lat/lon points. If `frontend/src/components/map/constants.js` has authoritative `REGIONS` centroids, copy from there. Otherwise these will need tuning after first user feedback.
2. **`confirm_required` flip date:** the config ships with `confirm_required: false` to log-only. Plan to flip to true after 2-3 GFS cycles validate the threshold doesn't drop bulletin-confirmed storms. Track in a follow-up issue.
3. **Storm card design fidelity:** the §8.4 changes are derived from `STORM_DRAWER_V2_DESIGN_BRIEF.md`. If that brief has been updated since 2026-04-26, re-read before Phase 8 frontend work.

---

## Estimated execution time

If Code runs straight through: ~3-4 hours of focused execution including writing tests. Plus 1-2 GFS detection cycles (12-18h wall-clock) before flipping `confirm_required: true`.
