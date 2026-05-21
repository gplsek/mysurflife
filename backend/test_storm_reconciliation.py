"""Tests for bulletin/model storm reconciliation (Phase 6)."""
import pytest
from services.storm_reconciliation import reconcile


def _bulletin(id="B1", lat=20.0, lon=-130.0, pressure=985, wind=45):
    return {
        "id": id, "lat": lat, "lon": lon,
        "pressure_mb": pressure, "wind_kts": wind,
        "name": "Atlantic LOW", "warning_tier": "gale",
        "raw_text": "BULLETIN TEXT", "source": "bulletin",
    }


def _model(id="M1", lat=20.0, lon=-130.0, pressure=982, wind=48,
           peak_sea_m=8.0, track=None):
    return {
        "id": id, "lat": lat, "lon": lon,
        "pressure_mb": pressure, "wind_kts": wind,
        "peak_sea_m": peak_sea_m,
        "forecast_track": track or [],
        "source": "model",
        "is_deepening": True,
        "peak_intensity_hour": 12,
        "intensification_rate_mb_per_6h": -2.0,
    }


def test_reconcile_match_overrides_bulletin_metadata():
    """Bulletin + model within 200km → merged with bulletin name/pressure, model peak_sea_m."""
    bs = [_bulletin(lat=20.0, lon=-130.0, pressure=985)]
    ms = [_model(lat=20.2, lon=-130.1, pressure=982, peak_sea_m=8.0)]
    out = reconcile(bs, ms, spatial_radius_km=300)

    assert len(out) == 1
    s = out[0]
    assert s["source"] == "reconciled"
    assert s["name"] == "Atlantic LOW"         # bulletin wins
    assert s["pressure_mb"] == 985            # bulletin pressure wins for display
    assert s["wind_kts"] == 45               # bulletin wind wins
    assert s["peak_sea_m"] == 8.0             # model field preserved
    assert s["is_deepening"] is True          # model dynamics preserved


def test_reconcile_bulletin_only():
    """Bulletin storm with no model match → source='bulletin'."""
    bs = [_bulletin(lat=20.0, lon=-130.0)]
    ms = [_model(lat=50.0, lon=10.0)]        # far away in North Atlantic
    out = reconcile(bs, ms, spatial_radius_km=300)

    bulletin_storms = [s for s in out if s["source"] == "bulletin"]
    assert len(bulletin_storms) == 1
    assert bulletin_storms[0]["id"] == "B1"


def test_reconcile_model_only():
    """Model storm with no bulletin match → source='model'."""
    bs = []
    ms = [_model(lat=20.0, lon=-130.0)]
    out = reconcile(bs, ms)

    assert len(out) == 1
    assert out[0]["source"] == "model"


def test_reconcile_logs_mismatch(capsys):
    """bulletin pressure=970, model pressure=990 → warning logged."""
    bs = [_bulletin(lat=20.0, lon=-130.0, pressure=970)]
    ms = [_model(lat=20.1, lon=-130.0, pressure=990)]
    reconcile(bs, ms, spatial_radius_km=300)
    captured = capsys.readouterr()
    assert "pressure mismatch" in captured.out


def test_reconcile_multiple_storms():
    """Two bulletins, two models — correct pairing by proximity."""
    bs = [
        _bulletin("B1", lat=20.0, lon=-130.0),
        _bulletin("B2", lat=40.0, lon=10.0),
    ]
    ms = [
        _model("M1", lat=20.2, lon=-130.1),  # close to B1
        _model("M2", lat=40.1, lon=10.1),    # close to B2
    ]
    out = reconcile(bs, ms, spatial_radius_km=300)
    reconciled = [s for s in out if s["source"] == "reconciled"]
    assert len(reconciled) == 2
    ids = {s["bulletin_storm_id"] for s in reconciled}
    assert "B1" in ids and "B2" in ids


def test_reconcile_empty_inputs():
    assert reconcile([], []) == []
    assert len(reconcile([], [_model()])) == 1
    assert len(reconcile([_bulletin()], [])) == 1
