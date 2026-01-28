"""
Database operations for AI spot analysis.
Handles saving and retrieving analysis results from Supabase.
"""

from typing import Dict, Any, Optional, List
from datetime import datetime
from database import get_supabase_admin_client, supabase


async def save_analysis(
    buoy_id: str,
    spot_name: str,
    lat: float,
    lon: float,
    analysis_data: Dict[str, Any],
    persona_type: str = "swell_geometry_analyst",
    model_used: str = "claude-3-5-sonnet-20241022",
    analysis_version: str = "1.0"
) -> Optional[Dict[str, Any]]:
    """
    Save AI analysis to database.
    Uses admin client to bypass RLS.

    Before inserting, marks any existing analysis for this buoy+persona as 'superseded'.
    """
    admin_client = get_supabase_admin_client()
    if not admin_client:
        print("⚠️  Supabase admin client not available - cannot save analysis")
        return None

    try:
        # Delete existing analyses for this buoy+persona (using admin client to bypass RLS)
        # This avoids unique constraint violations with multiple 'superseded' records
        delete_result = admin_client.table("ai_spot_analysis") \
            .delete() \
            .eq("buoy_id", buoy_id) \
            .eq("persona_type", persona_type) \
            .execute()

        if delete_result.data:
            print(f"🗑️  Deleted {len(delete_result.data)} old analysis records for {buoy_id}")

        # Insert new analysis (using admin client to bypass RLS)
        result = admin_client.table("ai_spot_analysis").insert({
            "buoy_id": buoy_id,
            "spot_name": spot_name,
            "latitude": lat,
            "longitude": lon,
            "analysis_data": analysis_data,
            "persona_type": persona_type,
            "model_used": model_used,
            "analysis_version": analysis_version,
            "status": "active",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }).execute()

        if result.data:
            print(f"✅ Saved AI analysis for {buoy_id} ({spot_name})")
            return result.data[0]
        else:
            print(f"⚠️  Failed to save analysis for {buoy_id}")
            print(f"   Result: {result}")
            return None

    except Exception as e:
        print(f"❌ Error saving AI analysis: {e}")
        return None


async def get_analysis(
    buoy_id: str,
    persona_type: str = "swell_geometry_analyst"
) -> Optional[Dict[str, Any]]:
    """
    Retrieve active AI analysis for a buoy.
    """
    if not supabase:
        return None

    try:
        result = supabase.table("ai_spot_analysis") \
            .select("*") \
            .eq("buoy_id", buoy_id) \
            .eq("persona_type", persona_type) \
            .eq("status", "active") \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()

        if result.data and len(result.data) > 0:
            return result.data[0]
        return None

    except Exception as e:
        print(f"❌ Error retrieving AI analysis: {e}")
        return None


async def get_all_analyses(
    persona_type: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    Get all active analyses, optionally filtered by persona type.
    """
    if not supabase:
        return []

    try:
        query = supabase.table("ai_spot_analysis") \
            .select("*") \
            .eq("status", "active")

        if persona_type:
            query = query.eq("persona_type", persona_type)

        result = query.order("created_at", desc=True) \
            .limit(limit) \
            .execute()

        return result.data if result.data else []

    except Exception as e:
        print(f"❌ Error retrieving analyses: {e}")
        return []


async def delete_analysis(analysis_id: str) -> bool:
    """
    Mark an analysis as archived (soft delete).
    """
    if not supabase:
        return False

    try:
        result = supabase.table("ai_spot_analysis") \
            .update({"status": "archived"}) \
            .eq("id", analysis_id) \
            .execute()

        return bool(result.data)

    except Exception as e:
        print(f"❌ Error archiving analysis: {e}")
        return False


async def update_user_feedback(
    analysis_id: str,
    rating: int,
    notes: Optional[str] = None
) -> bool:
    """
    Update user feedback for an analysis (1-5 star rating).
    """
    if not supabase:
        return False

    try:
        update_data = {"user_feedback_rating": rating}
        if notes:
            update_data["user_feedback_notes"] = notes

        result = supabase.table("ai_spot_analysis") \
            .update(update_data) \
            .eq("id", analysis_id) \
            .execute()

        return bool(result.data)

    except Exception as e:
        print(f"❌ Error updating feedback: {e}")
        return False


async def get_analysis_stats() -> Dict[str, Any]:
    """
    Get statistics about stored analyses.
    """
    if not supabase:
        return {"error": "Database not available"}

    try:
        # Count by persona type
        result = supabase.table("ai_spot_analysis") \
            .select("persona_type", count="exact") \
            .eq("status", "active") \
            .execute()

        return {
            "total_analyses": result.count if hasattr(result, 'count') else 0,
            "buoys_analyzed": len(result.data) if result.data else 0
        }

    except Exception as e:
        print(f"❌ Error getting analysis stats: {e}")
        return {"error": str(e)}