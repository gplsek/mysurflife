"""
wave_tiles.py — server-baked wave raster tiles (waves + primary swell).

Mirror of overlay_tiles.py for the GFSWave 0.25° global product
(gfswave.tHHz.global.0p25.fFFF.grib2): one GRIB fetch per {run, hour} pulls
HTSGW/DIRPW/PERPW plus the partition-1 swell fields (SWELL/SWDIR/SWPER) →
float grids cached to disk → PNG tile pyramid colored from the wave_height
ramp in backend/config/ramps.json → served by routes/tiles.py.

Variables:
  height — significant wave height (HTSGW), the Windy "Waves" layer
  swell  — partition-1 swell height (SWELL_1), the Windy "Swell1" layer

The uv texture encodes the wave *propagation* vector at deep-water group
velocity (Cg ≈ 0.78·T m/s), so the shared GL particle engine drifts particles
in the swell travel direction at a period-proportional speed. Direction data
is FROM-direction (project convention); propagation is FROM + 180°.
"""
import asyncio
import io
import os
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import numpy as np
from PIL import Image

from overlay_tiles import (
    GRID_CACHE_DIR,
    PNG_CACHE_DIR,
    MAX_TILE_ZOOM,
    TILE_SIZE,
    UV_SCALE_MS,
    UV_TEXTURE_SIZE,
    _LUT_SIZE,
    _bilinear_sample,
    _load_ramp_lut,
    _tile_latlon_mesh,
    png_tile_path,
    run_id_to_iso,
)

WAVE_MODEL = "gfswave"

# Same 3-hourly cadence as wind so the shared timeline drives both. GFSWave
# global.0p25 publishes 3-hourly out to f384; we stop at 240 like the wind set.
WAVE_TILE_HOURS: List[int] = list(range(0, 241, 3))

M_TO_FT = 3.28084
GROUP_VEL_FACTOR = 9.8 / (4 * np.pi)  # deep-water Cg = g·T/(4π) ≈ 0.78·T m/s
UV_HEIGHT_SCALE_M = 15.0              # B-channel height encode range

_WW3_FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl"
_WW3_FILE_PAT = "gfswave.t{HH}z.global.0p25.f{FFF}.grib2"
_WW3_DIR_PAT = "%2Fgfs.{DATE}%2F{HH}%2Fwave%2Fgridded"

VARIABLE_RAMPS = {"height": "wave_height", "swell": "wave_height"}

# ---------------------------------------------------------------------------
# Run resolution
# ---------------------------------------------------------------------------

_run_cache: Dict[str, Tuple[str, float]] = {}
_RUN_CACHE_TTL = 600


async def resolve_latest_run(model: str = WAVE_MODEL) -> Optional[str]:
    """Probe NOMADS for the newest GFSWave run with gridded output."""
    cached = _run_cache.get(model)
    if cached and time.time() - cached[1] < _RUN_CACHE_TTL:
        return cached[0]

    now = datetime.utcnow()
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        for day_offset in (0, 1):
            d = (now - timedelta(days=day_offset)).strftime("%Y%m%d")
            for hh in ("18", "12", "06", "00"):
                probe = (
                    f"{_WW3_FILTER}?file={_WW3_FILE_PAT.format(HH=hh, FFF='000')}"
                    "&var_HTSGW=on"
                    "&leftlon=0&rightlon=1&toplat=1&bottomlat=0"
                    f"&dir={_WW3_DIR_PAT.format(DATE=d, HH=hh)}"
                )
                try:
                    resp = await client.head(probe)
                    if resp.status_code == 200:
                        run_id = d + hh
                        _run_cache[model] = (run_id, time.time())
                        print(f"✅ wave tiles: latest GFSWave run {run_id}")
                        return run_id
                except Exception:
                    continue
    print("⚠️ wave tiles: could not resolve latest GFSWave run")
    return None


# ---------------------------------------------------------------------------
# Grid store (RAM LRU → disk npz → NOMADS)
# ---------------------------------------------------------------------------

_grid_mem: "Dict[str, Dict[str, np.ndarray]]" = {}
_grid_mem_order: List[str] = []
_GRID_MEM_MAX = 6

_grid_locks: Dict[str, asyncio.Lock] = {}


def _grid_path(run_id: str, hour: int) -> Path:
    return GRID_CACHE_DIR / WAVE_MODEL / run_id / f"f{hour:03d}.npz"


def _mem_put(key: str, grids: Dict[str, np.ndarray]) -> None:
    _grid_mem[key] = grids
    if key in _grid_mem_order:
        _grid_mem_order.remove(key)
    _grid_mem_order.append(key)
    while len(_grid_mem_order) > _GRID_MEM_MAX:
        _grid_mem.pop(_grid_mem_order.pop(0), None)


def _load_npz(path: Path) -> Optional[Dict[str, np.ndarray]]:
    try:
        with np.load(path) as z:
            return {k: z[k].astype(np.float32) for k in z.files}
    except Exception as e:
        print(f"⚠️ wave tiles: bad grid cache {path}: {e}")
        try:
            path.unlink()
        except OSError:
            pass
        return None


def _open_grib(tmp_path: str, filter_keys: Dict[str, Any]) -> Optional[Any]:
    import xarray as xr

    try:
        return xr.open_dataset(
            tmp_path,
            engine="cfgrib",
            backend_kwargs={"indexpath": "", "filter_by_keys": filter_keys},
        )
    except Exception:
        return None


def _pick(ds, candidates: List[str]) -> Optional[np.ndarray]:
    if ds is None:
        return None
    for cand in candidates:
        if cand in ds.data_vars:
            arr = ds[cand].values.astype(np.float32)
            # Partition dimension (orderedSequenceData) → take partition 1
            if arr.ndim == 3:
                arr = arr[0]
            return arr
    return None


async def _fetch_grids_from_nomads(run_id: str, hour: int) -> Optional[Dict[str, np.ndarray]]:
    """Download global 0.25° HTSGW/DIRPW/PERPW + partition-1 swell for one hour."""
    file_name = _WW3_FILE_PAT.format(HH=run_id[8:], FFF=f"{hour:03d}")
    url = (
        f"{_WW3_FILTER}?file={file_name}"
        "&var_HTSGW=on&var_DIRPW=on&var_PERPW=on"
        "&var_SWELL=on&var_SWDIR=on&var_SWPER=on"
        "&leftlon=0&rightlon=360&toplat=90&bottomlat=-90"
        f"&dir={_WW3_DIR_PAT.format(DATE=run_id[:8], HH=run_id[8:])}"
    )

    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            print(f"🌐 wave tiles: fetching GRIB {file_name} (global, 6 vars)")
            resp = await client.get(url)
            resp.raise_for_status()
            content = resp.content
    except Exception as e:
        print(f"❌ wave tiles: NOMADS fetch failed for {file_name}: {e}")
        return None

    if len(content) < 10240:
        print(f"❌ wave tiles: GRIB too small ({len(content)} bytes) — likely NOMADS error page")
        return None

    with tempfile.NamedTemporaryFile(delete=False, suffix=".grib2") as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        ds_hs = _open_grib(tmp_path, {"shortName": "swh"})
        ds_dir = _open_grib(tmp_path, {"shortName": "dirpw"})
        ds_per = _open_grib(tmp_path, {"shortName": "perpw"})
        # Partition-1 swell: GFSWave encodes partitions as orderedSequenceData levels
        ds_sw_h = _open_grib(tmp_path, {"typeOfLevel": "orderedSequenceData", "level": 1})
        if ds_sw_h is None:
            ds_sw_h = _open_grib(tmp_path, {"typeOfLevel": "orderedSequenceData"})

        hs = _pick(ds_hs, ["swh", "htsgw", "HTSGW"])
        dirpw = _pick(ds_dir, ["dirpw", "mwd", "DIRPW"])
        perpw = _pick(ds_per, ["perpw", "pp1d", "PERPW"])
        sw_h = _pick(ds_sw_h, ["shts", "swell", "SWELL"])
        sw_dir = _pick(ds_sw_h, ["mdts", "swdir", "SWDIR"])
        sw_per = _pick(ds_sw_h, ["mpts", "swper", "SWPER"])

        if hs is None or ds_hs is None:
            print("❌ wave tiles: HTSGW not found in GRIB")
            return None

        lat_name = "latitude" if "latitude" in ds_hs.coords else "lat"
        lon_name = "longitude" if "longitude" in ds_hs.coords else "lon"
        lats = ds_hs[lat_name].values.astype(np.float32)
        lons = ds_hs[lon_name].values.astype(np.float32)

        fields: Dict[str, Optional[np.ndarray]] = {
            "hs": hs, "dir": dirpw, "per": perpw,
            "sw_h": sw_h, "sw_dir": sw_dir, "sw_per": sw_per,
        }

        # Normalize to ascending latitude (match _bilinear_sample's contract)
        if len(lats) >= 2 and lats[0] > lats[-1]:
            lats = np.flip(lats)
            fields = {k: (np.flipud(f) if f is not None else None) for k, f in fields.items()}

        # NaN-out WW3 fill values (land cells)
        def _clean(f: Optional[np.ndarray], limit: float) -> Optional[np.ndarray]:
            if f is None:
                return None
            return np.where(np.isfinite(f) & (f < limit), f, np.nan)

        grids: Dict[str, np.ndarray] = {"lats": lats, "lons": lons}
        cleaned = {
            "hs": _clean(fields["hs"], 30.0),
            "dir": _clean(fields["dir"], 361.0),
            "per": _clean(fields["per"], 60.0),
            "sw_h": _clean(fields["sw_h"], 30.0),
            "sw_dir": _clean(fields["sw_dir"], 361.0),
            "sw_per": _clean(fields["sw_per"], 60.0),
        }
        for k, f in cleaned.items():
            if f is not None:
                grids[k] = f.astype(np.float16)

        path = _grid_path(run_id, hour)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(path, **grids)
        have = sorted(k for k in grids if k not in ("lats", "lons"))
        print(f"✅ wave tiles: cached grids {run_id}/f{hour:03d} ({path.stat().st_size // 1024} KB, {have})")
        return {k: g.astype(np.float32) for k, g in grids.items()}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _fill_coast(field: np.ndarray, iterations: int = 4) -> np.ndarray:
    """Extend ocean values into land (NaN) cells by iterative neighbor-mean.

    The 0.25° grid leaves the coastline as a blocky NaN staircase; bilinear
    sampling then goes NaN wherever ANY of the 4 surrounding cells is land,
    pulling the rendered field ~25 km back from shore in visible steps.
    Filling a few cells inland gives the sampler clean support all the way to
    the real coastline — which the renderer then cuts per-pixel with a 1 km
    land mask. Display masking, not this fill, decides what's visible.
    """
    f = field.copy()
    for _ in range(iterations):
        nan = ~np.isfinite(f)
        if not nan.any():
            break
        shifted = [
            np.roll(np.roll(f, dy, axis=0), dx, axis=1)
            for dy in (-1, 0, 1) for dx in (-1, 0, 1)
            if not (dy == 0 and dx == 0)
        ]
        import warnings
        with warnings.catch_warnings(), np.errstate(invalid="ignore"):
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN neighborhoods
            neigh = np.nanmean(np.stack(shifted), axis=0)
        f = np.where(nan & np.isfinite(neigh), neigh, f)
    return f


async def get_grids(run_id: str, hour: int) -> Optional[Dict[str, np.ndarray]]:
    key = f"{WAVE_MODEL}/{run_id}/{hour}"
    if key in _grid_mem:
        return _grid_mem[key]

    lock = _grid_locks.setdefault(key, asyncio.Lock())
    async with lock:
        if key in _grid_mem:
            return _grid_mem[key]

        path = _grid_path(run_id, hour)
        grids = _load_npz(path) if path.exists() else None
        if grids is None:
            grids = await _fetch_grids_from_nomads(run_id, hour)
        if grids is not None:
            # Height fields feed the PNG renderer: give them coast support.
            # Direction/period stay raw — the uv texture wants land at zero
            # velocity so swell particles stop at the shore.
            for k in ("hs", "sw_h"):
                if k in grids:
                    grids[k] = _fill_coast(grids[k])
            _mem_put(key, grids)
        return grids


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _variable_field_ft(grids: Dict[str, np.ndarray], variable: str) -> Optional[np.ndarray]:
    key = "sw_h" if variable == "swell" else "hs"
    if key not in grids:
        return None
    return grids[key] * M_TO_FT


def _ocean_fraction(z: int, x: int, y: int, size: int) -> Optional[np.ndarray]:
    """Per-pixel ocean coverage in [0,1], anti-aliased by 2x supersampling.

    Uses the ~1 km GLOBE land mask instead of the model's 25 km NaN staircase,
    so the wave field cuts off at the real coastline with a soft one-pixel
    feather. Returns None if global_land_mask is unavailable (falls back to
    the coarse NaN mask).
    """
    try:
        from global_land_mask import globe
    except ImportError:
        return None
    fine = size * 2
    lat_pts, lon_pts = _tile_latlon_mesh(z, x, y, fine)
    land = globe.is_land(
        np.clip(lat_pts, -89.99, 89.99),
        ((lon_pts + 180.0) % 360.0) - 180.0,
    )
    return 1.0 - land.reshape(size, 2, size, 2).mean(axis=(1, 3))


def render_png_tile(grids: Dict[str, np.ndarray], z: int, x: int, y: int,
                    variable: str = "height", scale: int = 1) -> Optional[bytes]:
    """One colored RGBA PNG tile; land renders transparent along the real
    (1 km) coastline, not the model grid's blocky NaN edge."""
    field = _variable_field_ft(grids, variable)
    if field is None:
        return None

    size = TILE_SIZE * scale
    lat_pts, lon_pts = _tile_latlon_mesh(z, x, y, size)
    values = _bilinear_sample(field, grids["lats"], grids["lons"], lat_pts, lon_pts)

    (d0, d1), lut = _load_ramp_lut(VARIABLE_RAMPS[variable])
    idx = np.clip(((values - d0) / (d1 - d0) * (_LUT_SIZE - 1)), 0, _LUT_SIZE - 1)
    nan_mask = ~np.isfinite(idx)
    idx = np.where(nan_mask, 0, idx).astype(np.int32)

    rgba = lut[idx].copy()
    if nan_mask.any():
        rgba[nan_mask, 3] = 0  # deep-interior land the coast fill didn't reach

    ocean = _ocean_fraction(z, x, y, size)
    if ocean is not None:
        rgba[..., 3] = (rgba[..., 3] * ocean).astype(np.uint8)

    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", compress_level=6)
    return buf.getvalue()


def render_f32_tile(grids: Dict[str, np.ndarray], z: int, x: int, y: int,
                    variable: str = "height") -> Optional[bytes]:
    """Raw little-endian float32 256×256 grid (feet) for client-side probes."""
    field = _variable_field_ft(grids, variable)
    if field is None:
        return None
    lat_pts, lon_pts = _tile_latlon_mesh(z, x, y, TILE_SIZE)
    values = _bilinear_sample(field, grids["lats"], grids["lons"], lat_pts, lon_pts)
    return values.astype("<f4").tobytes()


def render_uv_texture(grids: Dict[str, np.ndarray],
                      variable: str = "height") -> Optional[Tuple[bytes, Dict[str, Any]]]:
    """Equirectangular propagation-vector texture for the GL particle layer.

    R/G encode u/v of the wave propagation vector at deep-water group velocity
    (Cg = g·T/(4π)), same ±UV_SCALE_MS encoding the wind texture uses so the
    particle shader is shared unchanged. Direction grids hold FROM-direction;
    propagation is FROM + 180°, hence the negated sin/cos. B stays zero — no
    shader reads it, and a data-bearing channel triples the PNG weight.
    Land (NaN) encodes as zero velocity — particles there sit still and fade.
    """
    if variable == "swell":
        dir_f, per_f = grids.get("sw_dir"), grids.get("sw_per")
    else:
        dir_f, per_f = grids.get("dir"), grids.get("per")
    if dir_f is None or per_f is None:
        return None

    lons = grids["lons"]
    cg = GROUP_VEL_FACTOR * per_f
    rad = np.deg2rad(dir_f)
    u = -cg * np.sin(rad)
    v = -cg * np.cos(rad)
    u = np.where(np.isfinite(u), u, 0.0)
    v = np.where(np.isfinite(v), v, 0.0)

    roll = int(np.searchsorted(lons, 180.0))

    def _prep(f: np.ndarray) -> np.ndarray:
        return np.flipud(np.roll(f, -roll, axis=1))

    h, w = u.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = np.clip((_prep(u) + UV_SCALE_MS) / (2 * UV_SCALE_MS) * 255, 0, 255).astype(np.uint8)
    rgba[..., 1] = np.clip((_prep(v) + UV_SCALE_MS) / (2 * UV_SCALE_MS) * 255, 0, 255).astype(np.uint8)
    rgba[..., 3] = 255

    img = Image.fromarray(rgba, "RGBA").resize(UV_TEXTURE_SIZE, Image.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=6)

    meta = {
        "width": UV_TEXTURE_SIZE[0],
        "height": UV_TEXTURE_SIZE[1],
        "u_min": -UV_SCALE_MS, "u_max": UV_SCALE_MS,
        "v_min": -UV_SCALE_MS, "v_max": UV_SCALE_MS,
        "height_max_m": None,
        "units": "m/s (group velocity)",
        "layout": "equirectangular lon[-180,180] lat[90,-90]",
    }
    return buf.getvalue(), meta


# ---------------------------------------------------------------------------
# Paths + housekeeping
# ---------------------------------------------------------------------------

def wave_png_tile_path(run_id: str, hour: int, variable: str,
                       z: int, x: int, y: int, scale: int) -> Path:
    # -v2: feathered 1km coastline (pre-existing blocky tiles must regenerate)
    return png_tile_path(WAVE_MODEL, run_id, hour, f"{variable}-v2", z, x, y, scale)


def wave_uv_texture_path(run_id: str, hour: int, variable: str) -> Path:
    # .v2: slim encoding (see overlay_tiles.uv_texture_path)
    return PNG_CACHE_DIR / WAVE_MODEL / run_id / "uv" / f"{hour}-{variable}.v2.png"


def baked_hours(run_id: str) -> List[int]:
    root = GRID_CACHE_DIR / WAVE_MODEL / run_id
    if not root.exists():
        return []
    hours = []
    for p in root.glob("f*.npz"):
        try:
            hours.append(int(p.stem[1:]))
        except ValueError:
            continue
    return sorted(hours)


# ---------------------------------------------------------------------------
# Self-warming: bake a whole run's grids in the background
# ---------------------------------------------------------------------------

_warm_tasks: Dict[str, "asyncio.Task"] = {}
_WARM_CONCURRENCY = 2


async def _warm_run(run_id: str) -> None:
    from overlay_tiles import acquire_warm_lock, release_warm_lock

    missing = [h for h in WAVE_TILE_HOURS if not _grid_path(run_id, h).exists()]
    if not missing:
        return
    lock_fd = acquire_warm_lock()
    if lock_fd is None:
        print(f"⏭️ wave tiles: self-warm {run_id} skipped — another warmer holds the lock")
        return
    try:
        print(f"🔥 wave tiles: self-warm {run_id} — {len(missing)} hours missing")
        sem = asyncio.Semaphore(_WARM_CONCURRENCY)

        async def _one(hour: int) -> None:
            async with sem:
                grids = await get_grids(run_id, hour)
                if grids is None:
                    return
                for variable in ("height", "swell"):
                    uv = wave_uv_texture_path(run_id, hour, variable)
                    if uv.exists():
                        continue
                    rendered = render_uv_texture(grids, variable=variable)
                    if rendered is None:
                        continue
                    uv.parent.mkdir(parents=True, exist_ok=True)
                    uv.write_bytes(rendered[0])

        await asyncio.gather(*[_one(h) for h in missing])
        print(f"🏁 wave tiles: self-warm {run_id} complete")
    finally:
        release_warm_lock(lock_fd)


def ensure_run_warm(run_id: str) -> None:
    """Background bake of missing wave grid hours (see overlay_tiles version)."""
    key = f"{WAVE_MODEL}/{run_id}"
    task = _warm_tasks.get(key)
    if task and not task.done():
        return
    for k in [k for k, t in _warm_tasks.items() if t.done()]:
        del _warm_tasks[k]
    _warm_tasks[key] = asyncio.create_task(_warm_run(run_id))
