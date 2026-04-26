"""services/cache.py — Shared in-memory caches and request-deduplication dict."""
import asyncio
from typing import Any, Dict

from config import TIMELINE_CACHE_TTL

cache: Dict[str, Any] = {}

_timeline_cache: Dict[str, Dict] = {}
_TIMELINE_CACHE_TTL = TIMELINE_CACHE_TTL  # single source of truth in config.py

_dataset_cache: Dict[str, Dict] = {}

_in_flight_requests: Dict[str, asyncio.Task] = {}
