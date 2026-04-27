"""services/storm_reconciliation.py — merge bulletin storms with model-detected storms.

Logic per §8 of GLOBAL_STORM_DETECTION_PLAN.md:
  - Match bulletin → model within 300 km of bulletin position.
  - On match: keep model storm, overwrite name/warning_tier/raw_text/basin_label
    from bulletin, prefer bulletin pressure/wind for display, log if model
    disagrees with bulletin > 10 mb or > 15 kt.
  - Bulletin-only matches survive as bulletin storms (model missed them).
  - Model-only matches survive tagged source='model'.
  - Result has source ∈ {'bulletin', 'model', 'reconciled'}.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(min(1.0, a)))


def reconcile(
    bulletin_storms: List[Dict],
    model_storms: List[Dict],
    *,
    spatial_radius_km: float = 300,
    time_window_hours: float = 6,
) -> List[Dict]:
    """
    Returns the merged storm list. Each storm has 'source' set to one of
    'bulletin', 'model', or 'reconciled'.

    Matching: spatial proximity only (spatial_radius_km).
    time_window_hours accepted for API compatibility; reserved for future use.
    """
    consumed_model: set[int] = set()
    out: List[Dict] = []

    for bs in bulletin_storms:
        b_lat = bs.get("lat") or 0
        b_lon = bs.get("lon") or 0

        best_model_idx: Optional[int] = None
        best_dist = spatial_radius_km + 1

        for mi, ms in enumerate(model_storms):
            if mi in consumed_model:
                continue
            m_lat = ms.get("lat") or 0
            m_lon = ms.get("lon") or 0
            dist = _haversine_km(b_lat, b_lon, m_lat, m_lon)
            if dist < best_dist:
                best_dist = dist
                best_model_idx = mi

        if best_model_idx is not None:
            ms = model_storms[best_model_idx]
            consumed_model.add(best_model_idx)

            # Log significant discrepancies
            b_pres = bs.get("pressure_mb") or bs.get("min_pressure_mb")
            m_pres = ms.get("pressure_mb")
            if b_pres and m_pres and abs(b_pres - m_pres) > 10:
                print(
                    f"⚠️  reconcile: pressure mismatch storm={bs.get('id','?')} "
                    f"bulletin={b_pres} model={m_pres}"
                )
            b_wind = bs.get("wind_kts") or bs.get("max_wind_kts")
            m_wind = ms.get("wind_kts") or ms.get("peak_wind_kts")
            if b_wind and m_wind and abs(b_wind - m_wind) > 15:
                print(
                    f"⚠️  reconcile: wind mismatch storm={bs.get('id','?')} "
                    f"bulletin={b_wind} model={m_wind}"
                )

            # Build reconciled storm: bulletin wins for display metadata,
            # model wins for track + WW3 + dynamics fields.
            merged = {**ms}  # start from model (has track, WW3 fields, dynamics)
            # Bulletin overrides
            for field in ("name", "warning_tier", "raw_text", "basin_label",
                          "type", "nhc_official", "issued_utc"):
                if bs.get(field) is not None:
                    merged[field] = bs[field]
            # Bulletin wins for pressure/wind display
            if b_pres is not None:
                merged["pressure_mb"] = b_pres
            if b_wind is not None:
                merged["wind_kts"] = b_wind
            # Track provenance
            merged["source"] = "reconciled"
            merged["bulletin_storm_id"] = bs.get("id")
            out.append(merged)
        else:
            # No model match — keep as pure bulletin storm
            out.append({**bs, "source": "bulletin"})

    # Remaining model storms that were not matched
    for mi, ms in enumerate(model_storms):
        if mi not in consumed_model:
            out.append({**ms, "source": ms.get("source", "model")})

    return out
