"""
Database operations for AI spot analysis (SPOTS, not buoys).
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
from database import get_supabase_admin_client, supabase


async def save_spot_analysis(
    spot_id: str,
    spot_slug: str,
    spot_name: str,
    lat: float,
    lon: float,
    analysis_data: Dict[str, Any],
    persona_type: str = "swell_geometry_analyst",
    model_used: str = "claude-3-haiku-20240307",
    analysis_version: str = "1.0"
) -> Optional[Dict[str, Any]]:
    """
    Save AI analysis for a surf spot.
    Uses admin client to bypass RLS.
    """
    admin_client = get_supabase_admin_client()
    if not admin_client:
        print("⚠️  Supabase admin client not available")
        return None

    try:
        # Delete existing analyses for this spot+persona (using admin client to bypass RLS)
        # This avoids unique constraint violations with multiple 'superseded' records
        delete_result = admin_client.table("ai_spot_analysis") \
            .delete() \
            .eq("spot_id", spot_id) \
            .eq("persona_type", persona_type) \
            .execute()

        if delete_result.data:
            print(f"🗑️  Deleted {len(delete_result.data)} old analysis records for {spot_slug}")

        # Insert new analysis (using admin client to bypass RLS)
        result = admin_client.table("ai_spot_analysis").insert({
            "spot_id": spot_id,
            "buoy_id": None,  # Not buoy-based
            "spot_name": spot_name,
            "latitude": lat,
            "longitude": lon,
            "analysis_data": analysis_data,
            "persona_type": persona_type,
            "model_used": model_used,
            "analysis_version": analysis_version,
            "status": "active"
        }).execute()

        if result.data:
            print(f"✅ Saved AI analysis for spot: {spot_name} ({spot_slug})")
            return result.data[0]
        else:
            print(f"⚠️  Failed to save analysis for {spot_slug}")
            print(f"   Result: {result}")
            return None

    except Exception as e:
        print(f"❌ Error saving spot analysis: {e}")
        import traceback
        traceback.print_exc()
        return None


async def get_spot_analysis(
    spot_slug: str,
    persona_type: str = "swell_geometry_analyst"
) -> Optional[Dict[str, Any]]:
    """
    Retrieve AI analysis for a surf spot by slug.
    Uses admin client to bypass RLS (analyses are public content, no PII).
    """
    client = get_supabase_admin_client()
    if not client:
        return None

    try:
        spot_result = client.table("spots") \
            .select("id") \
            .eq("slug", spot_slug) \
            .single() \
            .execute()

        if not spot_result.data:
            return None

        spot_id = spot_result.data['id']

        result = client.table("ai_spot_analysis") \
            .select("*") \
            .eq("spot_id", spot_id) \
            .eq("persona_type", persona_type) \
            .eq("status", "active") \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()

        if result.data and len(result.data) > 0:
            return result.data[0]
        return None

    except Exception as e:
        print(f"❌ Error retrieving spot analysis: {e}")
        return None


async def get_all_spot_analyses(
    persona_type: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    Get all active spot analyses.
    """
    if not supabase:
        return []

    try:
        query = supabase.table("ai_spot_analysis") \
            .select("*") \
            .eq("status", "active") \
            .is_("spot_id", "not.null")  # Only spot-based analyses

        if persona_type:
            query = query.eq("persona_type", persona_type)

        result = query.order("created_at", desc=True) \
            .limit(limit) \
            .execute()

        return result.data if result.data else []

    except Exception as e:
        print(f"❌ Error retrieving analyses: {e}")
        return []
