"""Unit tests for services.storm_analysis (Phase 3). LLM calls are mocked."""
import asyncio

import services.storm_analysis as sa


# ── Fake Anthropic client (no network) ──────────────────────────────────────────

class _FakeResp:
    def __init__(self, text):
        self.content = [type("Block", (), {"text": text})()]


class _FakeMessages:
    def __init__(self, text, calls):
        self._text, self._calls = text, calls

    async def create(self, **kw):
        self._calls.append(kw)
        return _FakeResp(self._text)


class _FakeClient:
    def __init__(self, text="Storm narrative.", calls=None):
        self.messages = _FakeMessages(text, calls if calls is not None else [])


_TL = [{"region_id": "central-america", "region": "Central America", "tier": "direct",
        "size_ft": 5.0, "period_s": 15.0, "peak_hours": 48, "dir_deg": 270}]


def _storm(**over):
    s = {"id": "np-1", "type": "LOW", "lat": 45.0, "lon": -150.0,
         "pressure_mb": 982, "is_deepening": True, "narrative": "templated narrative",
         "region_timeline": _TL}
    s.update(over)
    return s


# ── compute_input_hash ───────────────────────────────────────────────────────--

def test_hash_stable():
    assert sa.compute_input_hash(_storm(), _TL) == sa.compute_input_hash(_storm(), _TL)


def test_hash_sensitive_to_pressure_and_tier():
    base = sa.compute_input_hash(_storm(), _TL)
    assert sa.compute_input_hash(_storm(pressure_mb=970), _TL) != base
    changed_tier = [{**_TL[0], "tier": "glancing"}]
    assert sa.compute_input_hash(_storm(), changed_tier) != base


def test_hash_ignores_sub_6h_peak_drift():
    base = sa.compute_input_hash(_storm(), _TL)
    drift = [{**_TL[0], "peak_hours": 50}]   # 48 and 50 fall in the same 6h bucket
    assert sa.compute_input_hash(_storm(), drift) == base


# ── generate_analysis ──────────────────────────────────────────────────────────

def test_generate_calls_model(monkeypatch):
    monkeypatch.setattr(sa, "_ANTHROPIC_API_KEY", "test-key")
    calls = []
    out = asyncio.run(sa.generate_analysis(_storm(), _TL, client=_FakeClient("Heading SE.", calls)))
    assert out == "Heading SE."
    assert len(calls) == 1 and calls[0]["model"] == sa.ANALYSIS_MODEL


def test_generate_skips_empty_timeline(monkeypatch):
    monkeypatch.setattr(sa, "_ANTHROPIC_API_KEY", "test-key")
    calls = []
    assert asyncio.run(sa.generate_analysis(_storm(), [], client=_FakeClient("x", calls))) is None
    assert calls == []   # no API call when there's nothing to narrate


def test_generate_no_key(monkeypatch):
    monkeypatch.setattr(sa, "_ANTHROPIC_API_KEY", None)
    calls = []
    assert asyncio.run(sa.generate_analysis(_storm(), _TL, client=_FakeClient("x", calls))) is None
    assert calls == []


# ── enrich_with_analysis (change gate) ──────────────────────────────────────────

def test_enrich_reuses_when_hash_unchanged(monkeypatch):
    gen_calls = []
    async def fake_gen(s, tl, client=None):
        gen_calls.append(s["id"]); return "FRESH"
    monkeypatch.setattr(sa, "generate_analysis", fake_gen)

    storm = _storm()
    h = sa.compute_input_hash(storm, storm["region_timeline"])
    existing = {"np-1": {"analysis_input_hash": h, "analysis_text": "STORED",
                         "analysis_model": "claude-sonnet-4-6", "analysis_generated_at": "t0"}}
    asyncio.run(sa.enrich_with_analysis([storm], existing))

    assert gen_calls == []                       # no LLM call
    assert storm["analysis_text"] == "STORED"    # reused
    assert storm["analysis_input_hash"] == h


def test_enrich_generates_when_changed(monkeypatch):
    async def fake_gen(s, tl, client=None):
        return "NEW ANALYSIS"
    monkeypatch.setattr(sa, "generate_analysis", fake_gen)

    storm = _storm()
    asyncio.run(sa.enrich_with_analysis([storm], {}))   # no prior row → generate
    assert storm["analysis_text"] == "NEW ANALYSIS"
    assert storm["analysis_model"] == sa.ANALYSIS_MODEL
    assert storm["analysis_input_hash"] == sa.compute_input_hash(storm, storm["region_timeline"])
    assert storm["analysis_generated_at"]


def test_enrich_falls_back_to_narrative(monkeypatch):
    async def fake_gen(s, tl, client=None):
        return None                              # simulate LLM failure
    monkeypatch.setattr(sa, "generate_analysis", fake_gen)

    storm = _storm()
    asyncio.run(sa.enrich_with_analysis([storm], {}))
    assert storm["analysis_text"] == "templated narrative"
    assert storm["analysis_input_hash"] is None  # left unset so next run retries
    assert storm["analysis_model"] is None
