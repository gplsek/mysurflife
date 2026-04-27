"""services/state.py — Shared runtime state: semaphores, HTTP client, Sione sessions.

⚠️  Do NOT import `http_client` by name (`from services.state import http_client`).
    `http_client` is None at import time and gets reassigned in startup(); a
    `from`-style import binds the original None and never picks up the new value.
    Always use attribute access:
        import services.state as _state
        await _state.http_client.get(url)
"""
import asyncio
from typing import Dict, Optional

import httpx

from config import NDBC_CONCURRENCY, WIND_CONCURRENCY, TIMELINE_CONCURRENCY, SIONE_SESSION_TTL

NDBC_SEM = asyncio.Semaphore(NDBC_CONCURRENCY)
WIND_SEM = asyncio.Semaphore(WIND_CONCURRENCY)
TIMELINE_SEM = asyncio.Semaphore(TIMELINE_CONCURRENCY)

# Initialized by FastAPI startup event in main.py; mutated in place.
http_client: Optional[httpx.AsyncClient] = None

_sione_sessions: Dict[str, Dict] = {}
_SESSION_TTL = SIONE_SESSION_TTL
