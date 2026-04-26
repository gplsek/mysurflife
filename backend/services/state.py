"""services/state.py — Shared runtime state: semaphores, HTTP client, Sione sessions."""
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
