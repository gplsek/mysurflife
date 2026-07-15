"""Tests for services.point_forecast + Sione tool registry consistency."""
import asyncio
import re

import numpy as np
import pytest

import overlay_tiles as ot
import wave_tiles as wt
from services.point_forecast import sample_point_forecast


# ── synthetic grids ──────────────────────────────────────────────────────────

def _wind_grids():
    lats = np.linspace(-90, 90, 19).astype(np.float32)
    lons = np.arange(0, 360, 10).astype(np.float32)
    shape = (19, 36)
    return {
        "u": np.full(shape, 5.0, dtype=np.float32),    # 5 m/s eastward
        "v": np.zeros(shape, dtype=np.float32),
        "gust": np.full(shape, 10.0, dtype=np.float32),
        "lats": lats, "lons": lons,
    }


def _wave_grids():
    lats = np.linspace(-90, 90, 19).astype(np.float32)
    lons = np.arange(0, 360, 10).astype(np.float32)
    shape = (19, 36)
    return {
        "hs": np.full(shape, 2.0, dtype=np.float32),
        "per": np.full(shape, 12.0, dtype=np.float32),
        "dir": np.full(shape, 200.0, dtype=np.float32),
        "sw_h": np.full(shape, 1.5, dtype=np.float32),
        "sw_per": np.full(shape, 14.0, dtype=np.float32),
        "sw_dir": np.full(shape, 210.0, dtype=np.float32),
        "lats": lats, "lons": lons,
    }


class _Exists:
    def __init__(self, val): self._v = val
    def exists(self): return self._v


def _patch_models(monkeypatch, wind=True, waves=True):
    async def wind_run(model="gfs"): return "2026010100"
    async def wave_run(model=wt.WAVE_MODEL): return "2026010100"
    monkeypatch.setattr(ot, "resolve_latest_run", wind_run)
    monkeypatch.setattr(wt, "resolve_latest_run", wave_run)
    monkeypatch.setattr(ot, "_grid_path", lambda m, r, h: _Exists(wind))
    monkeypatch.setattr(wt, "_grid_path", lambda r, h: _Exists(waves))

    async def wind_grids(model, run, hour): return _wind_grids()
    async def wave_grids(run, hour): return _wave_grids()
    monkeypatch.setattr(ot, "get_grids", wind_grids)
    monkeypatch.setattr(wt, "get_grids", wave_grids)


# ── sampler ──────────────────────────────────────────────────────────────────

def test_point_forecast_samples_wind_and_waves(monkeypatch):
    _patch_models(monkeypatch)
    out = asyncio.run(sample_point_forecast(33.0, -118.0, start_hour=0, end_hour=12, step_hours=6))

    assert out["missing_hours"] == []
    hours = [p["hour"] for p in out["points"]]
    assert hours == [0, 6, 12]

    p = out["points"][0]
    assert p["wind_kts"] == pytest.approx(5.0 * 1.94384, abs=0.1)
    assert p["wind_from_deg"] == 270.0            # eastward wind blows FROM the west
    assert p["gust_kts"] == pytest.approx(19.4, abs=0.1)
    assert p["wave_height_ft"] == pytest.approx(6.6, abs=0.1)
    assert p["wave_period_s"] == 12.0
    assert p["wave_from_deg"] == 200.0
    assert p["swell_height_ft"] == pytest.approx(4.9, abs=0.1)
    assert p["swell_from_deg"] == 210.0


def test_point_forecast_reports_missing_hours_instead_of_fetching(monkeypatch):
    """Uncached hours must be listed, never fetched inside a chat tool call."""
    _patch_models(monkeypatch, wind=False, waves=False)

    fetches = []
    async def no_fetch(*a, **k):
        fetches.append(a)
        raise AssertionError("tool call must not trigger a grid fetch")
    monkeypatch.setattr(ot, "get_grids", no_fetch)
    monkeypatch.setattr(wt, "get_grids", no_fetch)

    out = asyncio.run(sample_point_forecast(33.0, -118.0, start_hour=0, end_hour=12, step_hours=6))
    assert out["points"] == []
    assert out["missing_hours"] == [0, 6, 12]
    assert fetches == []


def test_point_forecast_wind_only_on_land(monkeypatch):
    _patch_models(monkeypatch, wind=True, waves=False)
    out = asyncio.run(sample_point_forecast(39.0, -100.0, start_hour=0, end_hour=0))
    p = out["points"][0]
    assert "wind_kts" in p and "wave_height_ft" not in p


# ── registry ↔ prompt consistency ────────────────────────────────────────────

def _prompt_tool_names(prompt: str):
    """Tool names referenced as bullets (- `tool_name` — ...) inside sections
    whose heading mentions tools; other backticked bullets are data fields."""
    names, in_tool_section = set(), False
    for line in prompt.splitlines():
        if line.lstrip().startswith("#"):
            in_tool_section = "tool" in line.lower()
            continue
        if in_tool_section:
            m = re.match(r"^\s*-\s*`([a-z_]+)`", line)
            if m:
                names.add(m.group(1))
    return names


def test_every_prompt_tool_exists_in_registry():
    """Regression: STORM_TRIP_SYSTEM_PROMPT used to name four tools that were
    never registered — the model called them and got 'Unknown tool'."""
    from copilot import SYSTEM_PROMPT, TOOL_DEFS
    from routes.copilot import _build_tool_registry
    from sione.openers.storm_trip import STORM_TRIP_SYSTEM_PROMPT

    registry = set(_build_tool_registry(None).keys()) | {"respond"}
    defs = {t["name"] for t in TOOL_DEFS}

    for prompt_name, prompt in (("base", SYSTEM_PROMPT), ("storm_trip", STORM_TRIP_SYSTEM_PROMPT)):
        for tool in _prompt_tool_names(prompt):
            assert tool in registry, f"{prompt_name} prompt references unregistered tool '{tool}'"
            assert tool in defs or tool == "respond", \
                f"{prompt_name} prompt references tool '{tool}' missing from TOOL_DEFS"


def test_new_tools_registered_and_defined():
    from copilot import TOOL_DEFS
    from routes.copilot import _build_tool_registry

    registry = _build_tool_registry(None)
    defs = {t["name"] for t in TOOL_DEFS}
    for tool in ("list_active_storms", "get_storm_detail", "get_model_point_forecast"):
        assert tool in registry
        assert tool in defs
