"""services/storm_analysis.py — Sonnet-generated storm trajectory analysis (Phase 3).

The 6h detection job calls this once per storm to narrate the *deterministic*
region_timeline (see services.region_impact.build_region_timeline) into a short
trajectory summary: where the storm is heading and which surf regions it lights up,
in order, with projected size / period / direction.

Key properties:
  - The LLM only PHRASES pre-computed numbers — it never computes or invents values.
  - Change-gated: a storm whose inputs are unchanged since the last run reuses the
    stored text (no API call). See compute_input_hash + enrich_with_analysis.
  - Graceful fallback: on any error / missing API key, callers keep the templated
    narrative (compose_narrative) so the card always has something.

See notes/STORM_LLM_ANALYSIS_PLAN.md (Phase 3).
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
ANALYSIS_MODEL = "claude-sonnet-4-6"

_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def _compass(deg) -> Optional[str]:
    if deg is None:
        return None
    return _COMPASS[round((float(deg) % 360) / 22.5) % 16]


# ── Change gate ────────────────────────────────────────────────────────────────

def compute_input_hash(storm: Dict, region_timeline: List[Dict]) -> str:
    """Stable 16-char hash of the inputs that should trigger a re-analysis.

    Only fields that change the narrative are included; peak timing is bucketed to
    6h so tiny drifts between runs don't force a regeneration.
    """
    payload = {
        "lat":        round(float(storm.get("lat") or 0), 1),
        "lon":        round(float(storm.get("lon") or 0), 1),
        "pressure":   storm.get("pressure_mb"),
        "type":       storm.get("type"),
        "deepening":  storm.get("is_deepening"),
        "landfall":   storm.get("will_make_landfall"),
        "landfall_before_peak": storm.get("landfall_before_peak"),
        "timeline": [
            {
                "r":    t.get("region_id"),
                "tier": t.get("tier"),
                "ft":   t.get("size_ft"),
                "s":    t.get("period_s"),
                "peak6h": round((t.get("peak_hours") or 0) / 6),
            }
            for t in (region_timeline or [])
        ],
    }
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ── Prompt ─────────────────────────────────────────────────────────────────────

_SYSTEM = """\
You are Sione, MySurfLife's surf forecaster. Write a short, factual storm-trajectory \
summary for surfers. You are given one storm and a precomputed, time-ordered list of \
which surf regions its swell will reach and when.

Rules:
- Use ONLY the numbers provided. Never invent or recompute sizes, periods, directions, or times.
- Open with what the storm is and where it's heading.
- Then walk the impact timeline in order — which region first, then next — with approximate \
timing ("in about N days"), projected swell size, period, and direction. Round naturally; \
ranges are fine (e.g. "head-high to overhead").
- If the storm makes landfall before peak, note the shortened swell window.
- Be honest when impacts are marginal. Don't oversell.
- 2-4 sentences. Plain prose only: no markdown, no bullet points, no headings.\
"""


def _build_user_prompt(storm: Dict, region_timeline: List[Dict]) -> str:
    facts: Dict = {
        "storm": {
            "type":        storm.get("type"),
            "warning_tier": storm.get("warning_tier"),
            "name":        storm.get("name"),
            "basin":       storm.get("ocean"),
            "lat":         storm.get("lat"),
            "lon":         storm.get("lon"),
            "pressure_mb": storm.get("pressure_mb"),
            "peak_wind_kts": storm.get("wind_kts") or storm.get("peak_wind_kts"),
            "movement":    storm.get("movement"),
            "is_deepening": storm.get("is_deepening"),
            "will_make_landfall": storm.get("will_make_landfall"),
            "landfall_eta_hours": storm.get("landfall_eta_hours"),
            "landfall_before_peak": storm.get("landfall_before_peak"),
        },
        "impact_timeline": [
            {
                "region":        t.get("region"),
                "tier":          t.get("tier"),
                "peak_in_hours": t.get("peak_hours"),
                "peak_in_days":  round((t.get("peak_hours") or 0) / 24, 1) if t.get("peak_hours") is not None else None,
                "size_ft":       t.get("size_ft"),
                "period_s":      t.get("period_s"),
                "swell_from":    _compass(t.get("dir_deg")),
            }
            for t in (region_timeline or [])
        ],
    }
    return (
        "Storm + ordered impact timeline (JSON). Narrate per the rules:\n\n"
        + json.dumps(facts, default=str, indent=2)
    )


# ── Generation ───────────────────────────────────────────────────────────────--

async def generate_analysis(
    storm: Dict,
    region_timeline: List[Dict],
    *,
    client=None,
) -> Optional[str]:
    """Call Sonnet to narrate the timeline. Returns prose, or None on failure /
    missing key / empty timeline (caller falls back to the templated narrative)."""
    if not _ANTHROPIC_API_KEY:
        return None
    if not region_timeline:
        return None  # nothing surf-relevant to narrate; cheap skip, no API call

    try:
        if client is None:
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=_ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model=ANALYSIS_MODEL,
            max_tokens=400,
            system=_SYSTEM,
            messages=[{"role": "user", "content": _build_user_prompt(storm, region_timeline)}],
        )
        text = resp.content[0].text.strip()
        return text or None
    except Exception as e:
        print(f"⚠️  storm_analysis: LLM generation failed for {storm.get('id')}: {e}")
        return None


# ── Orchestration (change-gated batch) ──────────────────────────────────────────

async def enrich_with_analysis(
    storms: List[Dict],
    existing: Optional[Dict[str, Dict]] = None,
    *,
    client=None,
) -> List[Dict]:
    """Mutate each storm in place with analysis_* fields.

    `existing` maps storm_id → its current derived_storms row fields
    (analysis_input_hash, analysis_text, analysis_model, analysis_generated_at).
    When a storm's input hash matches the stored one, the stored text is reused with
    no API call. Otherwise Sonnet is called; on failure the templated narrative is
    kept as analysis_text (and the hash is left unset so the next run retries).
    """
    existing = existing or {}
    reused = generated = fell_back = 0

    # One client for the whole batch (reused by every storm that needs generation).
    if client is None and _ANTHROPIC_API_KEY:
        try:
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=_ANTHROPIC_API_KEY)
        except Exception as e:
            print(f"⚠️  storm_analysis: could not init client ({e}); using templated fallback")
            client = None

    for storm in storms:
        # Significant storms only: most detected lows are not swell producers.
        # Non-relevant or sub-gale systems keep the templated narrative and
        # never cost an API call.
        if not (storm.get("surf_relevant")
                and storm.get("warning_tier") in ("gale", "storm", "hurricane")):
            storm["analysis_text"]         = storm.get("narrative")
            storm["analysis_input_hash"]   = None
            storm["analysis_model"]        = None
            storm["analysis_generated_at"] = None
            continue

        timeline = storm.get("region_timeline") or []
        new_hash = compute_input_hash(storm, timeline)
        prev = existing.get(storm.get("id")) or {}

        if prev.get("analysis_input_hash") == new_hash and prev.get("analysis_text"):
            storm["analysis_text"]         = prev["analysis_text"]
            storm["analysis_input_hash"]   = new_hash
            storm["analysis_model"]        = prev.get("analysis_model")
            storm["analysis_generated_at"] = prev.get("analysis_generated_at")
            reused += 1
            continue

        text = await generate_analysis(storm, timeline, client=client)
        if text:
            storm["analysis_text"]         = text
            storm["analysis_input_hash"]   = new_hash
            storm["analysis_model"]        = ANALYSIS_MODEL
            storm["analysis_generated_at"] = datetime.now(timezone.utc).isoformat()
            generated += 1
        else:
            # No LLM result — keep the deterministic narrative so the card isn't empty.
            # Leave the hash unset so a later run re-attempts real analysis.
            storm["analysis_text"]         = storm.get("narrative")
            storm["analysis_input_hash"]   = None
            storm["analysis_model"]        = None
            storm["analysis_generated_at"] = None
            fell_back += 1

    print(f"🧠 storm_analysis: {generated} generated, {reused} reused, {fell_back} fell back "
          f"(of {len(storms)} storms)")
    return storms
