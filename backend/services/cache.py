"""services/cache.py — Shared in-memory caches and request-deduplication dict."""
import asyncio
from datetime import timedelta
from typing import Any, Dict

cache: Dict[str, Any] = {}

_timeline_cache: Dict[str, Dict] = {}
_TIMELINE_CACHE_TTL = timedelta(minutes=30)

_dataset_cache: Dict[str, Dict] = {}

_in_flight_requests: Dict[str, asyncio.Task] = {}
