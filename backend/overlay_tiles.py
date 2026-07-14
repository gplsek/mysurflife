"""
overlay_tiles.py — server-baked wind raster tiles.

Phase A of notes/WIND_TILES_EXECUTION_PLAN.md: one GRIB fetch per
{model, run, forecast_hour} (global 0.25° GFS — UGRD/VGRD @10m, GUST @surface,
PRMSL @MSL) → float grids cached to disk → PNG tile pyramid colored from
backend/config/ramps.json → served by routes/tiles.py.

The browser only blits pre-colored pixels; no client-side rasterizing.
"""
import asyncio
import io
import json
import math
import os
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_HERE = Path(__file__).parent
TILE_CACHE_ROOT = _HERE / "cache" / "tiles"
GRID_CACHE_DIR = TILE_CACHE_ROOT / "grids"
PNG_CACHE_DIR = TILE_CACHE_ROOT / "png"

# Timeline cadence served to the frontend. 3-hourly keeps a full run's grid
# footprint under ~1 GB (81 hours × ~10 MB) while matching GFS 3-hourly output.
TILE_HOURS: List[int] = list(range(0, 241, 3))

TILE_SIZE = 256
MAX_TILE_ZOOM = 8          # 0.25° data has no detail beyond ~z7; Leaflet upscales
# Equirectangular u/v texture for GL particles. 1024×512 is a hair under the
# 1440×721 native GFS grid — indistinguishable for particle advection, and the
# PNG drops from ~2 MB to a few hundred KB, which is what makes timeline play
# viable (one texture per 3-hourly step).
UV_TEXTURE_SIZE = (1024, 512)

# u/v encode range for the uv.png texture (m/s). ±40 m/s covers hurricane force.
UV_SCALE_MS = 40.0
GUST_SCALE_MS = 60.0

MS_TO_KTS = 1.94384

_NOMADS_FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"

# ---------------------------------------------------------------------------
# Color ramps (from backend/config/ramps.json — single source of truth)
# ---------------------------------------------------------------------------

_LUT_SIZE = 512
_ramp_luts: Dict[str, Tuple[Tuple[float, float], np.ndarray]] = {}


def _load_ramp_lut(ramp_name: str) -> Tuple[Tuple[float, float], np.ndarray]:
    """Build (domain, LUT[_LUT_SIZE, 4] uint8 RGBA) from ramps.json stops."""
    if ramp_name in _ramp_luts:
        return _ramp_luts[ramp_name]

    with open(_HERE / "config" / "ramps.json") as f:
        ramps = json.load(f)["ramps"]
    if ramp_name not in ramps:
        raise KeyError(f"ramp '{ramp_name}' not in ramps.json")

    ramp = ramps[ramp_name]
    d0, d1 = float(ramp["domain"][0]), float(ramp["domain"][1])
    stops = ramp["stops"]

    values = np.array([s["value"] for s in stops], dtype=np.float64)
    rgba = np.array(
        [[s["rgba"][0], s["rgba"][1], s["rgba"][2], s["rgba"][3] * 255.0] for s in stops],
        dtype=np.float64,
    )

    xs = np.linspace(d0, d1, _LUT_SIZE)
    lut = np.empty((_LUT_SIZE, 4), dtype=np.uint8)
    for ch in range(4):
        lut[:, ch] = np.clip(np.interp(xs, values, rgba[:, ch]), 0, 255).astype(np.uint8)

    _ramp_luts[ramp_name] = ((d0, d1), lut)
    return _ramp_luts[ramp_name]


# ---------------------------------------------------------------------------
# Run resolution
# ---------------------------------------------------------------------------

_run_cache: Dict[str, Tuple[str, float]] = {}  # model -> (run_id, resolved_at)
_RUN_CACHE_TTL = 600  # seconds


def _dir_param(run_id: str) -> str:
    # run_id format: YYYYMMDDHH
    return f"%2Fgfs.{run_id[:8]}%2F{run_id[8:]}%2Fatmos"


async def resolve_latest_run(model: str = "gfs") -> Optional[str]:
    """Probe NOMADS for the newest available GFS run. Returns 'YYYYMMDDHH'."""
    cached = _run_cache.get(model)
    if cached and time.time() - cached[1] < _RUN_CACHE_TTL:
        return cached[0]

    now = datetime.utcnow()
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        for day_offset in (0, 1):
            d = (now - timedelta(days=day_offset)).strftime("%Y%m%d")
            for hh in ("18", "12", "06", "00"):
                probe = (
                    f"{_NOMADS_FILTER}?file=gfs.t{hh}z.pgrb2.0p25.f000"
                    "&lev_10_m_above_ground=on&var_UGRD=on"
                    "&leftlon=0&rightlon=1&toplat=1&bottomlat=0"
                    f"&dir={_dir_param(d + hh)}"
                )
                try:
                    resp = await client.head(probe)
                    if resp.status_code == 200:
                        run_id = d + hh
                        _run_cache[model] = (run_id, time.time())
                        print(f"✅ tiles: latest GFS run {run_id}")
                        return run_id
                except Exception:
                    continue
    print("⚠️ tiles: could not resolve latest GFS run")
    return None


def run_id_to_iso(run_id: str) -> str:
    return f"{run_id[:4]}-{run_id[4:6]}-{run_id[6:8]}T{run_id[8:]}:00:00Z"


# ---------------------------------------------------------------------------
# Grid store: fetch + disk cache + in-memory LRU
# ---------------------------------------------------------------------------

_grid_mem: "Dict[str, Dict[str, np.ndarray]]" = {}
_grid_mem_order: List[str] = []
_GRID_MEM_MAX = 8  # decoded hours kept in RAM (~10 MB each)

_grid_locks: Dict[str, asyncio.Lock] = {}


def _grid_path(model: str, run_id: str, hour: int) -> Path:
    return GRID_CACHE_DIR / model / run_id / f"f{hour:03d}.npz"


def _mem_put(key: str, grids: Dict[str, np.ndarray]) -> None:
    _grid_mem[key] = grids
    if key in _grid_mem_order:
        _grid_mem_order.remove(key)
    _grid_mem_order.append(key)
    while len(_grid_mem_order) > _GRID_MEM_MAX:
        evict = _grid_mem_order.pop(0)
        _grid_mem.pop(evict, None)


def _load_npz(path: Path) -> Optional[Dict[str, np.ndarray]]:
    try:
        with np.load(path) as z:
            return {k: z[k].astype(np.float32) for k in z.files}
    except Exception as e:
        print(f"⚠️ tiles: bad grid cache {path}: {e}")
        try:
            path.unlink()
        except OSError:
            pass
        return None


def _open_grib_level(tmp_path: str, filter_keys: Dict[str, Any]) -> Optional[Any]:
    import xarray as xr

    try:
        return xr.open_dataset(
            tmp_path,
            engine="cfgrib",
            backend_kwargs={"indexpath": "", "filter_by_keys": filter_keys},
        )
    except Exception as e:
        print(f"⚠️ tiles: cfgrib open failed for {filter_keys}: {e}")
        return None


def _pick_var(ds, candidates: List[str]) -> Optional[np.ndarray]:
    if ds is None:
        return None
    for cand in candidates:
        if cand in ds.data_vars:
            return ds[cand].values.astype(np.float32)
    for name, da in ds.data_vars.items():
        sn = (da.attrs.get("GRIB_shortName") or "").lower()
        if sn in [c.lower() for c in candidates]:
            return da.values.astype(np.float32)
    return None


async def _fetch_grids_from_nomads(model: str, run_id: str, hour: int) -> Optional[Dict[str, np.ndarray]]:
    """Download global 0.25° UGRD/VGRD/GUST/PRMSL for one forecast hour."""
    file_name = f"gfs.t{run_id[8:]}z.pgrb2.0p25.f{hour:03d}"
    url = (
        f"{_NOMADS_FILTER}?file={file_name}"
        "&lev_10_m_above_ground=on&lev_surface=on&lev_mean_sea_level=on"
        "&var_UGRD=on&var_VGRD=on&var_GUST=on&var_PRMSL=on"
        "&leftlon=0&rightlon=360&toplat=90&bottomlat=-90"
        f"&dir={_dir_param(run_id)}"
    )

    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            print(f"🌐 tiles: fetching GRIB {file_name} (global, 4 vars)")
            resp = await client.get(url)
            resp.raise_for_status()
            content = resp.content
    except Exception as e:
        print(f"❌ tiles: NOMADS fetch failed for {file_name}: {e}")
        return None

    if len(content) < 10240:
        print(f"❌ tiles: GRIB too small ({len(content)} bytes) — likely NOMADS error page")
        return None

    with tempfile.NamedTemporaryFile(delete=False, suffix=".grib2") as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        ds_wind = _open_grib_level(tmp_path, {"typeOfLevel": "heightAboveGround", "level": 10})
        ds_sfc = _open_grib_level(tmp_path, {"typeOfLevel": "surface"})
        ds_msl = _open_grib_level(tmp_path, {"typeOfLevel": "meanSea"})

        u = _pick_var(ds_wind, ["u10", "ugrd10m", "u", "10u"])
        v = _pick_var(ds_wind, ["v10", "vgrd10m", "v", "10v"])
        gust = _pick_var(ds_sfc, ["gust", "fg", "i10fg"])
        prmsl = _pick_var(ds_msl, ["prmsl", "msl", "mslet"])

        if u is None or v is None or ds_wind is None:
            print("❌ tiles: U/V not found in GRIB")
            return None

        lat_name = "latitude" if "latitude" in ds_wind.coords else "lat"
        lon_name = "longitude" if "longitude" in ds_wind.coords else "lon"
        lats = ds_wind[lat_name].values.astype(np.float32)
        lons = ds_wind[lon_name].values.astype(np.float32)

        # Normalize to ascending latitude
        if len(lats) >= 2 and lats[0] > lats[-1]:
            lats = np.flip(lats)
            u = np.flipud(u)
            v = np.flipud(v)
            if gust is not None:
                gust = np.flipud(gust)
            if prmsl is not None:
                prmsl = np.flipud(prmsl)

        grids: Dict[str, np.ndarray] = {
            "u": u.astype(np.float16),
            "v": v.astype(np.float16),
            "lats": lats,
            "lons": lons,
        }
        if gust is not None:
            grids["gust"] = gust.astype(np.float16)
        if prmsl is not None:
            grids["prmsl_mb"] = (prmsl / 100.0).astype(np.float32)

        path = _grid_path(model, run_id, hour)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(path, **grids)
        print(f"✅ tiles: cached grids {model}/{run_id}/f{hour:03d} ({path.stat().st_size // 1024} KB)")
        return {k: g.astype(np.float32) for k, g in grids.items()}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


async def get_grids(model: str, run_id: str, hour: int) -> Optional[Dict[str, np.ndarray]]:
    """Float grids for one forecast hour: RAM LRU → disk npz → NOMADS fetch."""
    key = f"{model}/{run_id}/{hour}"
    if key in _grid_mem:
        return _grid_mem[key]

    lock = _grid_locks.setdefault(key, asyncio.Lock())
    async with lock:
        if key in _grid_mem:
            return _grid_mem[key]

        path = _grid_path(model, run_id, hour)
        grids = _load_npz(path) if path.exists() else None
        if grids is None:
            grids = await _fetch_grids_from_nomads(model, run_id, hour)
        if grids is not None:
            _mem_put(key, grids)
        return grids


# ---------------------------------------------------------------------------
# Sampling + tile math
# ---------------------------------------------------------------------------

def _bilinear_sample(field: np.ndarray, lats: np.ndarray, lons: np.ndarray,
                     lat_pts: np.ndarray, lon_pts: np.ndarray) -> np.ndarray:
    """Vectorized bilinear sample on a regular global lat/lon grid.

    Assumes ascending lats, ascending lons spanning 0..360 with wraparound.
    lat_pts/lon_pts are 2D arrays of sample coordinates (degrees, lon in any range).
    """
    lat0, dlat = float(lats[0]), float(lats[1] - lats[0])
    lon0, dlon = float(lons[0]), float(lons[1] - lons[0])
    n_lat, n_lon = field.shape[-2], field.shape[-1]

    li = (lat_pts - lat0) / dlat
    lo = ((lon_pts - lon0) % 360.0) / dlon

    i0 = np.clip(np.floor(li).astype(np.int32), 0, n_lat - 1)
    i1 = np.clip(i0 + 1, 0, n_lat - 1)
    j0 = np.floor(lo).astype(np.int32) % n_lon
    j1 = (j0 + 1) % n_lon

    fi = np.clip(li - i0, 0.0, 1.0)
    fj = lo - np.floor(lo)

    v00 = field[i0, j0]
    v01 = field[i0, j1]
    v10 = field[i1, j0]
    v11 = field[i1, j1]

    return (v00 * (1 - fi) * (1 - fj) + v01 * (1 - fi) * fj
            + v10 * fi * (1 - fj) + v11 * fi * fj)


def _tile_latlon_mesh(z: int, x: int, y: int, size: int) -> Tuple[np.ndarray, np.ndarray]:
    """Pixel-center lat/lon mesh for a Web Mercator tile."""
    n = 2.0 ** z
    px = (np.arange(size) + 0.5) / size
    lon_row = (x + px) / n * 360.0 - 180.0

    yn = (y + px) / n
    lat_col = np.degrees(np.arctan(np.sinh(math.pi * (1.0 - 2.0 * yn))))

    lon_pts, lat_pts = np.meshgrid(lon_row, lat_col)
    return lat_pts, lon_pts


def _variable_field_kts(grids: Dict[str, np.ndarray], variable: str) -> Optional[np.ndarray]:
    if variable == "gust":
        if "gust" not in grids:
            return None
        return grids["gust"] * MS_TO_KTS
    speed = np.sqrt(grids["u"] ** 2 + grids["v"] ** 2)
    return speed * MS_TO_KTS


_VARIABLE_RAMPS = {"speed": "wind_speed", "gust": "wind_gust"}


def render_png_tile(grids: Dict[str, np.ndarray], z: int, x: int, y: int,
                    variable: str = "speed", scale: int = 1) -> Optional[bytes]:
    """Render one colored RGBA PNG tile. Pure CPU, ~5 ms at 256px."""
    field = _variable_field_kts(grids, variable)
    if field is None:
        return None

    size = TILE_SIZE * scale
    lat_pts, lon_pts = _tile_latlon_mesh(z, x, y, size)
    values = _bilinear_sample(field, grids["lats"], grids["lons"], lat_pts, lon_pts)

    (d0, d1), lut = _load_ramp_lut(_VARIABLE_RAMPS[variable])
    idx = np.clip(((values - d0) / (d1 - d0) * (_LUT_SIZE - 1)), 0, _LUT_SIZE - 1)
    nan_mask = ~np.isfinite(idx)
    idx = np.where(nan_mask, 0, idx).astype(np.int32)

    rgba = lut[idx]
    if nan_mask.any():
        rgba = rgba.copy()
        rgba[nan_mask, 3] = 0  # NaN → fully transparent, never black

    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", compress_level=6)
    return buf.getvalue()


def render_f32_tile(grids: Dict[str, np.ndarray], z: int, x: int, y: int,
                    variable: str = "speed") -> Optional[bytes]:
    """Raw little-endian float32 256×256 grid (kts) for client-side probes."""
    field = _variable_field_kts(grids, variable)
    if field is None:
        return None
    lat_pts, lon_pts = _tile_latlon_mesh(z, x, y, TILE_SIZE)
    values = _bilinear_sample(field, grids["lats"], grids["lons"], lat_pts, lon_pts)
    return values.astype("<f4").tobytes()


def render_uv_texture(grids: Dict[str, np.ndarray]) -> Tuple[bytes, Dict[str, Any]]:
    """Global equirectangular u/v texture for the GL particle layer (Phase C).

    Encoding: R = u, G = v (both (val + UV_SCALE)/(2*UV_SCALE) × 255), B = 0,
    A = 255. Layout: lon −180..180 left→right, lat 90..−90 top→bottom.
    B used to carry gust, but no shader reads it and the high-entropy channel
    tripled the PNG size — the texture is fetched per 3-hourly step, so its
    weight directly gates timeline playback.
    """
    u, v = grids["u"], grids["v"]
    lons = grids["lons"]

    # Reorder longitude to −180..180 and flip latitude to image orientation
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
        "gust_max": None,
        "units": "m/s",
        "layout": "equirectangular lon[-180,180] lat[90,-90]",
    }
    return buf.getvalue(), meta


# ---------------------------------------------------------------------------
# PNG disk cache + housekeeping
# ---------------------------------------------------------------------------

def png_tile_path(model: str, run_id: str, hour: int, variable: str,
                  z: int, x: int, y: int, scale: int) -> Path:
    suffix = "@2x" if scale == 2 else ""
    return PNG_CACHE_DIR / model / run_id / variable / f"{hour}" / f"{z}" / f"{x}" / f"{y}{suffix}.png"


def uv_texture_path(model: str, run_id: str, hour: int) -> Path:
    # .v2: slim encoding (1024×512, B channel zeroed). The version bump makes
    # pre-existing 2 MB textures on disk invisible so they regenerate slim.
    return PNG_CACHE_DIR / model / run_id / "uv" / f"{hour}.v2.png"


def purge_old_runs(model: str, keep_runs: int = 2) -> int:
    """Delete grid + png caches for all but the newest `keep_runs` runs."""
    import shutil

    removed = 0
    for root in (GRID_CACHE_DIR / model, PNG_CACHE_DIR / model):
        if not root.exists():
            continue
        runs = sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.name)
        for stale in runs[:-keep_runs]:
            shutil.rmtree(stale, ignore_errors=True)
            removed += 1
            print(f"🧹 tiles: purged {stale}")
    return removed


def cache_stats() -> Dict[str, Any]:
    def _dir_stats(root: Path) -> Dict[str, Any]:
        if not root.exists():
            return {"files": 0, "bytes": 0}
        files = 0
        total = 0
        for p in root.rglob("*"):
            if p.is_file():
                files += 1
                total += p.stat().st_size
        return {"files": files, "bytes": total}

    return {
        "grids": _dir_stats(GRID_CACHE_DIR),
        "png": _dir_stats(PNG_CACHE_DIR),
        "mem_grids": list(_grid_mem.keys()),
        "tile_hours": {"count": len(TILE_HOURS), "max": TILE_HOURS[-1], "step": 3},
    }


def baked_hours(model: str, run_id: str) -> List[int]:
    """Forecast hours whose float grids are already on disk for this run."""
    root = GRID_CACHE_DIR / model / run_id
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

# One warmer per BOX, not per process. Four uvicorn workers each running a
# full-run warm (plus the cron prewarm) pinned a 2-vCPU host flat and held
# ~1.5 GB per worker — the per-process task guard alone is not enough. The
# lock file is the SAME one the prewarm cron wraps itself in (flock -n), so
# cron job and in-server warmers mutually exclude across the whole machine.
WARM_LOCK_PATH = "/tmp/mysurflife-prewarm.lock"


def acquire_warm_lock() -> Optional[Any]:
    """Non-blocking exclusive flock; returns an open fd to hold, or None."""
    import fcntl

    try:
        fd = os.open(WARM_LOCK_PATH, os.O_CREAT | os.O_RDWR, 0o664)
    except OSError:
        return None
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except OSError:
        os.close(fd)
        return None


def release_warm_lock(fd: Any) -> None:
    try:
        os.close(fd)  # closing releases the flock
    except OSError:
        pass


async def _warm_run(model: str, run_id: str) -> None:
    missing = [h for h in TILE_HOURS if not _grid_path(model, run_id, h).exists()]
    if not missing:
        return
    lock_fd = acquire_warm_lock()
    if lock_fd is None:
        print(f"⏭️ tiles: self-warm {model}/{run_id} skipped — another warmer holds the lock")
        return
    try:
        print(f"🔥 tiles: self-warm {model}/{run_id} — {len(missing)} hours missing")
        sem = asyncio.Semaphore(_WARM_CONCURRENCY)

        async def _one(hour: int) -> None:
            async with sem:
                grids = await get_grids(model, run_id, hour)
                if grids is None:
                    return
                uv = uv_texture_path(model, run_id, hour)
                if not uv.exists():
                    png, _meta = render_uv_texture(grids)
                    uv.parent.mkdir(parents=True, exist_ok=True)
                    uv.write_bytes(png)

        await asyncio.gather(*[_one(h) for h in missing])
        print(f"🏁 tiles: self-warm {model}/{run_id} complete")
    finally:
        release_warm_lock(lock_fd)


def ensure_run_warm(model: str, run_id: str) -> None:
    """Kick a background bake of this run's missing grid hours (idempotent).

    Called from the manifest route, so the first map visitor after a run flip
    (or a deploy) starts the warm-up instead of waiting for the prewarm cron —
    scrubbing stops hitting cold 15-30 s GRIB fetches within a few minutes.
    Grids are the expensive part; PNG tiles render on demand in ~5 ms once
    they exist. Guarded twice: a per-process task registry, and the box-wide
    flock in _warm_run (shared with the cron prewarm) so at most ONE warmer
    runs per machine no matter how many workers serve manifests.
    """
    key = f"{model}/{run_id}"
    task = _warm_tasks.get(key)
    if task and not task.done():
        return
    for k in [k for k, t in _warm_tasks.items() if t.done()]:
        del _warm_tasks[k]
    _warm_tasks[key] = asyncio.create_task(_warm_run(model, run_id))
