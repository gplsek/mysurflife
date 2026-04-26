"""services/state.py — Shared runtime state: semaphores, HTTP client, Sione sessions."""
import asyncio
from typing import Any, Dict, Optional
import httpx

NDBC_SEM = asyncio.Semaphore(12)
WIND_SEM = asyncio.Semaphore(2)
TIMELINE_SEM = asyncio.Semaphore(5)

http_client: Optional[httpx.AsyncClient] = None

_sione_sessions: Dict[str, Dict] = {}
_SESSION_TTL = 4 * 3600
