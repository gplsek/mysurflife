"""
/api/tiles/* — pre-baked wind raster tiles (Phase A, notes/WIND_TILES_EXECUTION_PLAN.md).

Routes:
  GET /api/tiles/wind/{model}/runs                              → run manifest
  GET /api/tiles/wind/{model}/{run}/{hour}/uv.png|uv.json       → GL particle texture
  GET /api/tiles/wind/{model}/{run}/{hour}/{z}/{x}/{y}.png      → colored tile (+@2x, .f32)
  GET /api/tiles/_stats                                          → cache stats

CDN-ready: every image response carries Cache-Control + ETag (immutable for
non-latest runs), Access-Control-Allow-Origin: *, no cookies.
"""
import hashlib
from typing import Optional, Tuple

from fastapi import APIRouter, HTTPException, Request, Response

import overlay_tiles as ot

router = APIRouter(prefix="/api/tiles", tags=["tiles"])

SUPPORTED_MODELS = {"gfs"}
SUPPORTED_VARS = {"speed", "gust"}


def _validate(model: str, hour: int) -> None:
    if model not in SUPPORTED_MODELS:
        raise HTTPException(404, f"unknown model '{model}' (supported: {sorted(SUPPORTED_MODELS)})")
    if hour not in ot.TILE_HOURS:
        raise HTTPException(404, f"forecast hour {hour} not in tile cadence (0..{ot.TILE_HOURS[-1]} step 3)")


async def _resolve_run(model: str, run: str) -> str:
    if run == "latest":
        resolved = await ot.resolve_latest_run(model)
        if not resolved:
            raise HTTPException(503, "could not resolve latest model run")
        return resolved
    if len(run) != 10 or not run.isdigit():
        raise HTTPException(400, "run must be YYYYMMDDHH or 'latest'")
    return run


def _cache_headers(model: str, run_id: str, extra_key: str) -> dict:
    latest = ot._run_cache.get(model)
    is_latest = bool(latest) and latest[0] == run_id
    cache_control = (
        "public, max-age=600, stale-while-revalidate=1800"
        if is_latest
        else "public, max-age=21600, immutable"
    )
    etag = 'W/"' + hashlib.md5(f"{model}:{run_id}:{extra_key}".encode()).hexdigest()[:16] + '"'
    return {
        "Cache-Control": cache_control,
        "ETag": etag,
        "Access-Control-Allow-Origin": "*",
        "Vary": "Accept-Encoding",
    }


def _maybe_304(request: Request, headers: dict) -> Optional[Response]:
    if request.headers.get("if-none-match") == headers["ETag"]:
        return Response(status_code=304, headers=headers)
    return None


def _parse_y_spec(y_spec: str) -> Tuple[int, str, int]:
    """'25.png' → (25, 'png', 1); '25@2x.png' → (25, 'png', 2); '25.f32' → (25, 'f32', 1)."""
    scale = 1
    if y_spec.endswith("@2x.png"):
        y_str, ext = y_spec[: -len("@2x.png")], "png"
        scale = 2
    elif y_spec.endswith(".png"):
        y_str, ext = y_spec[: -len(".png")], "png"
    elif y_spec.endswith(".f32"):
        y_str, ext = y_spec[: -len(".f32")], "f32"
    else:
        raise HTTPException(404, "tile must end in .png, @2x.png, or .f32")
    try:
        return int(y_str), ext, scale
    except ValueError:
        raise HTTPException(400, f"bad tile y '{y_str}'")


@router.get("/wind/{model}/runs")
async def wind_runs(model: str):
    """Run manifest the frontend loads before requesting any tiles."""
    if model not in SUPPORTED_MODELS:
        raise HTTPException(404, f"unknown model '{model}'")
    run_id = await ot.resolve_latest_run(model)
    if not run_id:
        raise HTTPException(503, "could not resolve latest model run")
    return {
        "model": model,
        "run": run_id,
        "run_iso": ot.run_id_to_iso(run_id),
        "hours": ot.TILE_HOURS,
        "baked_hours": ot.baked_hours(model, run_id),
        "variables": sorted(SUPPORTED_VARS),
        "max_zoom": ot.MAX_TILE_ZOOM,
        "tile_url": f"/api/tiles/wind/{model}/{run_id}/{{hour}}/{{z}}/{{x}}/{{y}}.png",
        "uv_url": f"/api/tiles/wind/{model}/{run_id}/{{hour}}/uv.png",
    }


@router.get("/wind/{model}/{run}/{hour}/uv.json")
async def wind_uv_meta(model: str, run: str, hour: int):
    _validate(model, hour)
    run_id = await _resolve_run(model, run)
    grids = await ot.get_grids(model, run_id, hour)
    if grids is None:
        raise HTTPException(503, "model data unavailable for this hour")
    _, meta = ot.render_uv_texture(grids)
    return {"model": model, "run": run_id, "hour": hour, **meta}


@router.get("/wind/{model}/{run}/{hour}/uv.png")
async def wind_uv_texture(model: str, run: str, hour: int, request: Request):
    _validate(model, hour)
    run_id = await _resolve_run(model, run)

    headers = _cache_headers(model, run_id, f"uv:{hour}")
    not_modified = _maybe_304(request, headers)
    if not_modified:
        return not_modified

    path = ot.uv_texture_path(model, run_id, hour)
    if path.exists():
        return Response(path.read_bytes(), media_type="image/png", headers=headers)

    grids = await ot.get_grids(model, run_id, hour)
    if grids is None:
        raise HTTPException(503, "model data unavailable for this hour")
    png, _meta = ot.render_uv_texture(grids)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return Response(png, media_type="image/png", headers=headers)


@router.get("/wind/{model}/{run}/{hour}/{z}/{x}/{y_spec}")
async def wind_tile(model: str, run: str, hour: int, z: int, x: int, y_spec: str,
                    request: Request, var: str = "speed"):
    _validate(model, hour)
    if var not in SUPPORTED_VARS:
        raise HTTPException(400, f"var must be one of {sorted(SUPPORTED_VARS)}")
    y, ext, scale = _parse_y_spec(y_spec)
    if not (0 <= z <= ot.MAX_TILE_ZOOM):
        raise HTTPException(404, f"zoom {z} out of range (0..{ot.MAX_TILE_ZOOM})")
    n = 2 ** z
    if not (0 <= x < n and 0 <= y < n):
        raise HTTPException(404, "tile out of range")

    run_id = await _resolve_run(model, run)
    headers = _cache_headers(model, run_id, f"{var}:{hour}:{z}:{x}:{y_spec}")
    not_modified = _maybe_304(request, headers)
    if not_modified:
        return not_modified

    if ext == "png":
        path = ot.png_tile_path(model, run_id, hour, var, z, x, y, scale)
        if path.exists():
            return Response(path.read_bytes(), media_type="image/png", headers=headers)

    grids = await ot.get_grids(model, run_id, hour)
    if grids is None:
        raise HTTPException(503, "model data unavailable for this hour")

    if ext == "f32":
        data = ot.render_f32_tile(grids, z, x, y, variable=var)
        if data is None:
            raise HTTPException(404, f"variable '{var}' not present in this run")
        return Response(data, media_type="application/octet-stream", headers=headers)

    png = ot.render_png_tile(grids, z, x, y, variable=var, scale=scale)
    if png is None:
        raise HTTPException(404, f"variable '{var}' not present in this run")
    path = ot.png_tile_path(model, run_id, hour, var, z, x, y, scale)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return Response(png, media_type="image/png", headers=headers)


@router.get("/_stats")
async def tile_stats():
    return ot.cache_stats()


@router.post("/_purge")
async def tile_purge(model: str = "gfs", keep_runs: int = 2):
    """Housekeeping: drop caches for all but the newest runs."""
    return {"purged_runs": ot.purge_old_runs(model, keep_runs=keep_runs)}
