"""
Pure utility functions — no local imports, safe to use from any module.
"""
import math
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any, List, Tuple

import numpy as np


def json_sanitize(obj: Any) -> Any:
    """Recursively replace NaN/Inf with None so JSON serialization never fails."""
    if obj is None:
        return None
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (int, str, bool)):
        return obj
    if isinstance(obj, (np.integer, np.floating)):
        try:
            val = float(obj) if isinstance(obj, np.floating) else int(obj)
            if math.isnan(val) or math.isinf(val):
                return None
            return val
        except (ValueError, OverflowError):
            return None
    if isinstance(obj, dict):
        return {k: json_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_sanitize(v) for v in obj]
    if isinstance(obj, datetime):
        return obj.isoformat() + "Z" if obj.tzinfo is None else obj.isoformat()
    return str(obj)


def calculate_surf_height(wave_height_m: float, dpd_sec: float, size_bias: float = 1.0) -> float:
    """
    Theoretical surf face height from offshore wave parameters.

    Uses the Stormsurf Swell Category Table via swell_tables.surf_height_from_buoy.
    Returns mid-point of face height range in meters for backward compat.
    For richer output (category, label, range), call surf_height_from_buoy directly.
    """
    from swell_tables import surf_height_from_buoy
    wvht_ft = wave_height_m * 3.28084
    result = surf_height_from_buoy(wvht_ft, dpd_sec, size_bias)
    return round(result["face_mid_ft"] / 3.28084, 2)


@lru_cache(maxsize=64)
def _times_utc_for_run(run_iso: str, hours: Tuple[int, ...]) -> List[str]:
    """Generate UTC timestamps for a model run + list of hours. LRU-cached."""
    run_iso_clean = run_iso.replace("Z", "").replace(" ", "T")
    try:
        base = datetime.fromisoformat(run_iso_clean)
    except ValueError:
        base = datetime.strptime(run_iso_clean, "%Y-%m-%dT%H:%M:%S")
    return [(base + timedelta(hours=int(h))).isoformat(timespec="seconds") + "Z" for h in hours]
