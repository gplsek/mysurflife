"""Tests for services.spot_config_llm (A2 swell-window generator). LLM mocked."""
import asyncio

import services.spot_config_llm as scl

SPOT = {"name": "X", "region": "CA", "country": "US", "latitude": 33, "longitude": -117}


class _FakeResp:
    def __init__(self, text): self.content = [type("B", (), {"text": text})()]


class _FakeMessages:
    def __init__(self, text, calls): self._t, self._c = text, calls
    async def create(self, **kw): self._c.append(kw); return _FakeResp(self._t)


class _FakeClient:
    def __init__(self, text, calls=None):
        self.messages = _FakeMessages(text, calls if calls is not None else [])


def test_geo_fallback_when_no_key(monkeypatch):
    monkeypatch.setattr(scl, "_ANTHROPIC_API_KEY", None)
    out = asyncio.run(scl.generate_swell_windows(SPOT, 270, "W"))
    assert out and out[0]["source"] == "geo"
    assert out[0]["dir_min"] == 190 and out[0]["dir_max"] == 350   # 270 ± 80


def test_none_when_no_facing_and_no_key(monkeypatch):
    monkeypatch.setattr(scl, "_ANTHROPIC_API_KEY", None)
    assert asyncio.run(scl.generate_swell_windows(SPOT, None)) is None


def test_llm_path_parses_windows(monkeypatch):
    monkeypatch.setattr(scl, "_ANTHROPIC_API_KEY", "k")
    calls = []
    client = _FakeClient('[{"dir_min":270,"dir_max":300,"weight":1.0,"period_min_sec":12}]', calls)
    out = asyncio.run(scl.generate_swell_windows(SPOT, 285, "WNW", client=client))
    assert len(out) == 1 and len(calls) == 1
    assert out[0]["source"] == "llm" and out[0]["dir_min"] == 270 and out[0]["weight"] == 1.0


def test_llm_strips_code_fences(monkeypatch):
    monkeypatch.setattr(scl, "_ANTHROPIC_API_KEY", "k")
    fenced = '```json\n[{"dir_min":180,"dir_max":240,"weight":0.8,"period_min_sec":10}]\n```'
    out = asyncio.run(scl.generate_swell_windows(SPOT, 210, "SSW", client=_FakeClient(fenced)))
    assert len(out) == 1 and out[0]["dir_min"] == 180


def test_llm_bad_json_falls_back_to_geo(monkeypatch):
    monkeypatch.setattr(scl, "_ANTHROPIC_API_KEY", "k")
    out = asyncio.run(scl.generate_swell_windows(SPOT, 270, "W", client=_FakeClient("not json")))
    assert out and out[0]["source"] == "geo"
