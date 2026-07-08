"""
Database configuration and connection management for MySurfLife.
Uses Supabase (PostgreSQL) for data storage.
"""

import os
from typing import Optional
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Supabase configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# Global Supabase clients (anon + service-role), created once per process
_supabase_client: Optional[Client] = None
_supabase_admin_client: Optional[Client] = None


def get_supabase_client() -> Optional[Client]:
    """
    Get or create Supabase client instance.

    Returns:
        Supabase client if configured, None otherwise
    """
    global _supabase_client

    if _supabase_client is not None:
        return _supabase_client

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("⚠️  Supabase not configured (missing SUPABASE_URL or SUPABASE_KEY)")
        return None

    try:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print(f"✅ Supabase connected: {SUPABASE_URL}")
        return _supabase_client
    except Exception as e:
        print(f"❌ Failed to connect to Supabase: {e}")
        return None


def get_supabase_admin_client() -> Optional[Client]:
    """
    Get Supabase client with service role key (admin access).
    Use this for server-side operations that bypass Row Level Security.

    Returns:
        Supabase admin client if configured, None otherwise
    """
    global _supabase_admin_client

    if _supabase_admin_client is not None:
        return _supabase_admin_client

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("⚠️  Supabase admin access not configured")
        return None

    try:
        _supabase_admin_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        return _supabase_admin_client
    except Exception as e:
        print(f"❌ Failed to create Supabase admin client: {e}")
        return None


# Initialize connection on module import
supabase = get_supabase_client()


# ── Spot visibility (M2 anti-leak gate) ───────────────────────────────────────
# Migration 021 added spots.visibility ('public' | 'private'). The service-role
# (admin) client BYPASSES RLS, so every client-facing spots list/map/search built
# on it MUST apply this filter or a user's private spot leaks to others. On the
# anon client it is belt-and-suspenders with the RLS policy. Owner-scoped views
# (a user seeing their OWN private spots) must not use this — filter by owner_id.
SPOT_VISIBILITY_PUBLIC = "public"


def only_public_spots(query):
    """Restrict a Supabase `spots` query to the public catalog. See note above."""
    return query.eq("visibility", SPOT_VISIBILITY_PUBLIC)