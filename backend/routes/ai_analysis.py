"""routes/ai_analysis.py — AI spot analysis endpoints."""
import asyncio
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends

try:
    from auth import require_admin
except ImportError:
    require_admin = None

try:
    from database import supabase
except ImportError:
    supabase = None

try:
    from ai_personas_spots import analyze_spot_swell_geometry as analyze_spot_ai
    from ai_analysis_db_spots import save_spot_analysis, get_spot_analysis, get_all_spot_analyses
    print("✅ Spot-based AI personas loaded")
except ImportError as e:
    print(f"⚠️  Spot-based AI personas not available: {e}")
    analyze_spot_ai = None
    save_spot_analysis = None
    get_spot_analysis = None
    get_all_spot_analyses = None

try:
    from ai_personas_spots_openai import SpotSwellGeometryAnalystOpenAI
    analyze_spot_ai_openai = SpotSwellGeometryAnalystOpenAI.analyze
    print("✅ OpenAI spot personas loaded")
except ImportError as e:
    print(f"⚠️  OpenAI spot personas not available: {e}")
    analyze_spot_ai_openai = None

router = APIRouter()


@router.get("/api/spots/{spot_slug}/ai-analysis/all")
async def get_all_spot_ai_analyses(spot_slug: str):
    """
    Get ALL AI analyses for a spot (Claude, OpenAI, etc.)
    Returns a dict with model names as keys.
    """
    if not supabase:
        return {"error": "Database not available"}

    try:
        analyses = {}

        # Fetch Claude analysis
        claude = await get_spot_analysis(spot_slug, "swell_geometry_analyst")
        if claude:
            analyses['claude'] = {
                **claude,
                'provider': 'Claude',
                'model_display': 'Sonnet 4'
            }

        # Fetch OpenAI analysis
        openai = await get_spot_analysis(spot_slug, "swell_geometry_analyst_openai")
        if openai:
            analyses['openai'] = {
                **openai,
                'provider': 'OpenAI',
                'model_display': 'GPT-4o'
            }

        return {
            "success": True,
            "spot_slug": spot_slug,
            "analyses": analyses,
            "available_models": list(analyses.keys())
        }

    except Exception as e:
        print(f"❌ Error retrieving spot AI analyses: {e}")
        return {"error": str(e)}


@router.get("/api/spots/{spot_slug}/ai-analysis")
async def get_spot_ai_analysis(spot_slug: str):
    """
    Get AI-powered swell geometry analysis for a surf spot.

    Returns cached analysis if available, otherwise returns 404.
    Use POST endpoint to generate new analysis.
    """
    if not supabase:
        return {"error": "Database not available"}

    try:
        analysis = await get_spot_analysis(spot_slug, "swell_geometry_analyst")

        if analysis:
            return {
                "success": True,
                "cached": True,
                "spot_slug": spot_slug,
                "analysis": analysis
            }
        else:
            return {
                "success": False,
                "cached": False,
                "message": "No analysis found - use POST to generate"
            }

    except Exception as e:
        print(f"❌ Error retrieving spot AI analysis: {e}")
        return {"error": str(e)}


@router.post("/api/spots/{spot_slug}/ai-analysis/generate")
async def generate_spot_ai_analysis(
    spot_slug: str,
    force: bool = False,
    user: Dict = Depends(require_admin) if require_admin else None
):
    """
    Generate new AI-powered swell geometry analysis for a surf spot.

    **Requires admin authentication.**

    Query params:
    - force: If true, regenerate even if cached analysis exists

    This endpoint analyzes the ACTUAL surf spot using its characteristics,
    break type, swell windows, and local geography from the database.
    """
    if not analyze_spot_ai:
        return {"error": "AI personas not configured (missing ANTHROPIC_API_KEY)"}

    try:
        # Check if analysis already exists (unless force=true)
        if not force:
            existing = await get_spot_analysis(spot_slug, "swell_geometry_analyst")

            if existing:
                return {
                    "success": True,
                    "cached": True,
                    "message": "Analysis already exists (use force=true to regenerate)",
                    "analysis": existing
                }

        admin_email = user.get('email', 'unknown') if user else 'unknown'
        print(f"🤖 Admin {admin_email} generating AI analysis for spot: {spot_slug}...")

        # Generate AI analysis using spot characteristics
        result = await analyze_spot_ai(spot_slug)

        if not result.get('success'):
            return {
                "success": False,
                "error": result.get('error', 'Unknown error'),
                "spot_slug": spot_slug
            }

        # Save to database
        saved = await save_spot_analysis(
            spot_id=result['spot_id'],
            spot_slug=spot_slug,
            spot_name=result['spot_name'],
            lat=result['lat'],
            lon=result['lon'],
            analysis_data=result['analysis'],
            persona_type="swell_geometry_analyst",
            model_used=result.get('model', 'claude-3-haiku-20240307'),
            analysis_version="1.0"
        )

        if saved:
            print(f"✅ AI analysis saved for {result['spot_name']}")
            return {
                "success": True,
                "cached": False,
                "generated": True,
                "spot_slug": spot_slug,
                "analysis": saved
            }
        else:
            # Analysis generated but save failed
            return {
                "success": True,
                "cached": False,
                "generated": True,
                "save_failed": True,
                "warning": "Analysis generated but not saved to database",
                "spot_slug": spot_slug,
                "analysis": result
            }

    except Exception as e:
        print(f"❌ Error generating spot AI analysis: {e}")
        return {"error": str(e)}


@router.post("/api/spots/{spot_slug}/ai-analysis/generate-openai")
async def generate_spot_ai_analysis_openai(
    spot_slug: str,
    user: Dict = Depends(require_admin) if require_admin else None
):
    """
    Generate new AI-powered swell geometry analysis for a surf spot using OpenAI GPT-4.

    **Requires admin authentication.**

    Saves with persona_type='swell_geometry_analyst_openai' to coexist with Claude analysis.
    """
    if not analyze_spot_ai_openai:
        return {"error": "OpenAI personas not configured (missing OPENAI_API_KEY)"}

    try:
        admin_email = user.get('email', 'unknown') if user else 'unknown'
        print(f"🤖 Admin {admin_email} generating OpenAI analysis for spot: {spot_slug}...")

        # Generate AI analysis using OpenAI
        result = await analyze_spot_ai_openai(spot_slug)

        if not result.get('success'):
            return {
                "success": False,
                "error": result.get('error', 'Unknown error'),
                "spot_slug": spot_slug
            }

        # Save to database with openai persona_type
        saved = await save_spot_analysis(
            spot_id=result['spot_id'],
            spot_slug=spot_slug,
            spot_name=result['spot_name'],
            lat=result['lat'],
            lon=result['lon'],
            analysis_data=result['analysis'],
            persona_type="swell_geometry_analyst_openai",  # Different from Claude
            model_used="gpt-4o",
            analysis_version="1.0"
        )

        if saved:
            print(f"✅ OpenAI analysis saved for {result['spot_name']}")
            return {
                "success": True,
                "cached": False,
                "generated": True,
                "provider": "openai",
                "model": "gpt-4o",
                "spot_slug": spot_slug,
                "analysis": saved
            }
        else:
            return {
                "success": True,
                "generated": True,
                "save_failed": True,
                "warning": "Analysis generated but not saved to database",
                "spot_slug": spot_slug,
                "analysis": result
            }

    except Exception as e:
        print(f"❌ Error generating OpenAI spot analysis: {e}")
        return {"error": str(e)}


@router.post("/api/spots/ai-analysis/batch-generate")
async def batch_generate_spot_analyses(
    spot_slugs: List[str] = None,
    force: bool = False,
    user: Dict = Depends(require_admin) if require_admin else None
):
    """
    Generate AI analysis for multiple surf spots (background job).

    **Requires admin authentication.**

    Body params:
    - spot_slugs: List of spot slugs (if empty, analyzes all published spots)
    - force: Regenerate even if cached

    Returns immediately with job status. Analyses run in background.
    """
    if not analyze_spot_ai:
        return {"error": "AI personas not configured"}

    try:
        # Get list of spots to analyze
        if not spot_slugs:
            # Get all published spots
            result = supabase.table("spots") \
                .select("slug") \
                .eq("is_published", True) \
                .execute()

            if result.data:
                spot_slugs = [s['slug'] for s in result.data]
            else:
                return {"error": "No published spots found"}

        print(f"🚀 Starting batch AI analysis for {len(spot_slugs)} spots...")

        results = []

        for slug in spot_slugs:
            try:
                result = await generate_spot_ai_analysis(slug, force)
                results.append({
                    "spot_slug": slug,
                    "success": result.get('success', False),
                    "cached": result.get('cached', False)
                })

                # Brief delay to avoid rate limits
                await asyncio.sleep(1)

            except Exception as e:
                print(f"❌ Failed to analyze {slug}: {e}")
                results.append({
                    "spot_slug": slug,
                    "success": False,
                    "error": str(e)
                })

        successful = sum(1 for r in results if r['success'])

        return {
            "success": True,
            "total_requested": len(spot_slugs),
            "successful": successful,
            "failed": len(spot_slugs) - successful,
            "results": results
        }

    except Exception as e:
        print(f"❌ Batch generation error: {e}")
