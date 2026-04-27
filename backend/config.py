"""config.py — Application-wide constants.

Single source of truth for TTLs and concurrency limits. services/cache.py and
services/state.py read from here so values can't drift between modules.
"""
from datetime import timedelta

# Cache TTLs
CACHE_DURATION     = timedelta(minutes=5)    # generic per-endpoint TTL
TIMELINE_CACHE_TTL = timedelta(minutes=30)   # assembled spot-forecast timelines

# Concurrency limits — applied via asyncio.Semaphore in services/state.py
NDBC_CONCURRENCY     = 12
WIND_CONCURRENCY     = 2
TIMELINE_CONCURRENCY = 5

# Sione session expiry
SIONE_SESSION_TTL = 4 * 3600  # seconds
