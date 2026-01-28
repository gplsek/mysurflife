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

# Global Supabase client
_supabase_client: Optional[Client] = None


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
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("⚠️  Supabase admin access not configured")
        return None

    try:
        admin_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        return admin_client
    except Exception as e:
        print(f"❌ Failed to create Supabase admin client: {e}")
        return None


# Initialize connection on module import
supabase = get_supabase_client()