"""config.py — Application-wide constants."""
from datetime import timedelta

CACHE_DURATION = timedelta(minutes=5)
TIMELINE_CACHE_TTL = timedelta(minutes=30)
WIND_CACHE_TTL = timedelta(minutes=10)

NDBC_CONCURRENCY = 12
WIND_CONCURRENCY = 2
TIMELINE_CONCURRENCY = 5

SIONE_SESSION_TTL = 4 * 3600
