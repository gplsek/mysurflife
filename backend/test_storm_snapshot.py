"""Phase 4: /api/storms/active snapshot-vs-live branching. DB + bulletins mocked."""
import asyncio

import routes.storms as rs


def _patch(monkeypatch, snapshot, assemble_result):
    """Patch the snapshot reader + live assembler; return call-tracking dict."""
    seen = {"read": False, "assemble": False}

    async def fake_read():
        seen["read"] = True
        return snapshot

    async def fake_assemble(ocean_list, min_wind_kts, max_pressure_mb, include_highs):
        seen["assemble"] = True
        return assemble_result

    monkeypatch.setattr(rs, "_read_storm_snapshot", fake_read)
    monkeypatch.setattr(rs, "assemble_active_storms", fake_assemble)
    return seen


def test_default_path_serves_snapshot(monkeypatch):
    snap = {"storms": [{"id": "snap-1"}], "count": 1, "updated_at": "t"}
    seen = _patch(monkeypatch, snap, {"storms": [], "count": 0, "updated_at": None})
    out = asyncio.run(rs.get_active_storms())          # no args → no overrides
    assert out["source"] == "snapshot"
    assert out["count"] == 1 and out["cached"] is True
    assert seen["assemble"] is False                   # live path not taken


def test_override_bypasses_snapshot(monkeypatch):
    seen = _patch(monkeypatch, {"storms": [{"id": "snap"}], "count": 1, "updated_at": "t"},
                  {"storms": [{"id": "live-1"}], "count": 1, "updated_at": "t2"})
    out = asyncio.run(rs.get_active_storms(min_wind_kts=40))
    assert out["source"] == "live"
    assert seen["read"] is False                       # snapshot never consulted
    assert out["storms"][0]["id"] == "live-1"


def test_missing_snapshot_falls_back_to_live(monkeypatch):
    seen = _patch(monkeypatch, None, {"storms": [{"id": "live-1"}], "count": 1, "updated_at": None})
    out = asyncio.run(rs.get_active_storms())           # no overrides, but snapshot is None
    assert out["source"] == "live"
    assert seen["read"] is True and seen["assemble"] is True
