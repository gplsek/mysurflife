"""
AI Surf Analysis Personas
Specialized AI agents for surf forecasting and spot analysis.
"""

import os
import json
import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime
from anthropic import Anthropic

# Environment variable for API key
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Initialize Anthropic client
if ANTHROPIC_API_KEY:
    anthropic_client = Anthropic(api_key=ANTHROPIC_API_KEY)
    print("✅ Anthropic API initialized for AI personas")
else:
    anthropic_client = None
    print("⚠️  ANTHROPIC_API_KEY not set - AI personas disabled")


def degrees_to_cardinal(degrees: float) -> str:
    """Convert degrees to cardinal direction (N, NE, E, etc.)"""
    if degrees is None:
        return "N/A"

    directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    idx = round(degrees / 22.5) % 16
    return directions[idx]


def extract_json_from_response(content: str) -> Dict[str, Any]:
    """
    Extract JSON from AI response, handling markdown code blocks.
    """
    content = content.strip()

    # Try to extract from markdown code blocks
    if "```json" in content:
        json_str = content.split("```json")[1].split("```")[0].strip()
    elif "```" in content:
        json_str = content.split("```")[1].split("```")[0].strip()
    else:
        json_str = content

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        # If JSON parsing fails, return error structure
        return {
            "error": f"Failed to parse JSON: {str(e)}",
            "raw_response": content[:500]
        }


class SwellGeometryAnalyst:
    """
    Persona 1: Expert Oceanographer - Swell Geometry Analysis

    Analyzes optimal swell directions considering geographic shadows,
    island blockages, and period-dependent diffraction.
    """

    @staticmethod
    async def analyze(
        lat: float,
        lon: float,
        spot_name: str = "Unknown Spot",
        buoy_id: str = None
    ) -> Dict[str, Any]:
        """
        Analyze surf spot swell geometry.

        Returns detailed analysis of optimal swell directions, shadow zones,
        and partial blockage with period-dependency.
        """
        if not anthropic_client:
            return {
                "success": False,
                "error": "AI personas not configured (missing ANTHROPIC_API_KEY)"
            }

        # Determine region for context
        if lat > 40:
            region = "Northern California (Cape Mendocino to Oregon border)"
        elif lat > 37:
            region = "Central California (San Francisco Bay Area)"
        elif lat > 34:
            region = "Central Coast (Monterey to Santa Barbara)"
        else:
            region = "Southern California (Santa Barbara to San Diego)"

        prompt = f"""You are an expert oceanographer specializing in ocean swell propagation, coastal geometry, and wave refraction patterns. You have deep knowledge of how swell interacts with landmasses, islands, and underwater bathymetry along the California coast.

TASK: Analyze the surf spot at the following coordinates and provide a comprehensive swell direction analysis.

SPOT INFORMATION:
- Name: {spot_name}
- Buoy ID: {buoy_id if buoy_id else 'N/A'}
- Latitude: {lat}°N
- Longitude: {abs(lon)}°W
- Region: {region}
- Ocean: Pacific Ocean

ANALYSIS REQUIREMENTS:

1. **PRIMARY SWELL WINDOWS** (Most exposed directions)
   - Identify optimal swell direction ranges (in degrees and cardinal directions)
   - Consider coastline orientation at this location
   - Rate each window: "Excellent" / "Good" / "Fair"
   - Provide specific reasoning for each window

2. **SHADOW ZONES** (Blocked or heavily blocked)
   - Identify major land masses, islands, or peninsulas blocking swell
   - For California, consider: Channel Islands (San Miguel, Santa Rosa, Santa Cruz, Anacapa),
     Point Conception, Palos Verdes Peninsula, offshore islands, headlands
   - Specify blocked direction ranges with clear reasoning
   - Estimate blockage percentage (80-100% for shadow zones)

3. **PARTIAL BLOCKAGE ANALYSIS**
   - For directions with partial blockage (e.g., behind a point or island shadow edge):
     * Estimate % of swell energy reaching the spot (10-80%)
     * Explain period-dependency: longer period swells (>16s) diffract/wrap better around obstacles
     * Provide threshold periods (e.g., "NW swell >16s can partially wrap, <14s mostly blocked")
     * Consider fetch windows and ocean geometry

4. **BATHYMETRY & REFRACTION**
   - Discuss how underwater features (canyons, reefs, continental shelf) affect swell
   - Mention if location is exposed (deep water nearby) or sheltered (shallow bay)
   - Note any focusing or defocusing effects

5. **OPTIMAL SWELL CHARACTERISTICS**
   - Best swell direction (single optimal bearing in degrees)
   - Best period range (seconds) - typically 10-20s for California
   - Best swell size range (feet at buoy) - consider spot's typical range
   - Season considerations if relevant (winter NW swells vs summer SW swells)

6. **PRACTICAL SUMMARY**
   - 2-3 sentence summary for surfers
   - Include "money" direction and backup options
   - Mention any unique characteristics of this location

IMPORTANT CONTEXT FOR CALIFORNIA:
- Northern CA: Exposed to NW-W swells, some NE blockage from land
- Central CA: Point Conception shadows south-facing spots from W-NW
- Southern CA: Channel Islands create shadows for NW swells, but SW-W is exposed
- All regions: Long-period SW swells from Southern Hemisphere wrap well

OUTPUT FORMAT: Return ONLY a valid JSON object with this exact structure (no markdown, no commentary):
{{
  "primary_windows": [
    {{
      "direction": "SW-W",
      "degrees": "210-270",
      "quality": "Excellent",
      "notes": "Fully exposed to Pacific Ocean swells, no obstructions"
    }}
  ],
  "shadow_zones": [
    {{
      "direction": "NW",
      "degrees": "300-330",
      "blocker": "Channel Islands (Santa Cruz, Anacapa)",
      "blockage": "90%",
      "notes": "Strong shadowing except for long-period swells >18s"
    }}
  ],
  "partial_blockage": [
    {{
      "direction": "WNW",
      "degrees": "280-300",
      "blocker": "Point Conception / Santa Barbara coast",
      "energy_pct": 40,
      "period_threshold": 16,
      "notes": "Swells >16s can diffract around Point Conception; shorter periods mostly blocked"
    }}
  ],
  "bathymetry": {{
    "notes": "Deep offshore canyon focuses swell energy; continental shelf refracts incoming swell",
    "depth_characteristics": "Exposed / Protected / Mixed",
    "refraction_effects": "Focusing / Defocusing / Minimal"
  }},
  "optimal_swell": {{
    "direction_deg": 240,
    "direction_name": "WSW",
    "period_range": "12-18s",
    "size_range": "4-10ft",
    "season_notes": "Year-round, best in winter and spring"
  }},
  "summary": "This spot works best on SW-W swells with 12-18s period. Channel Islands block NW swells <16s. Excellent exposure to Pacific storms and Southern Hemisphere swells."
}}

Provide detailed, geographically accurate analysis based on real California coastal features.
"""

        try:
            # Call Claude API
            # Using Claude 3 Haiku - fast, cost-effective, and excellent for structured analysis
            response = anthropic_client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=2048,
                temperature=0.3,  # Lower temp for consistent analysis
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )

            # Extract content
            content = response.content[0].text

            # Parse JSON
            analysis = extract_json_from_response(content)

            # Check for parsing errors
            if "error" in analysis and "raw_response" in analysis:
                return {
                    "success": False,
                    "error": analysis["error"],
                    "raw_response": analysis["raw_response"],
                    "spot_name": spot_name,
                    "buoy_id": buoy_id
                }

            return {
                "success": True,
                "spot_name": spot_name,
                "buoy_id": buoy_id,
                "lat": lat,
                "lon": lon,
                "region": region,
                "analysis": analysis,
                "persona": "swell_geometry_analyst",
                "model": "claude-3-haiku-20240307",
                "analyzed_at": datetime.utcnow().isoformat()
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"AI analysis failed: {str(e)}",
                "spot_name": spot_name,
                "buoy_id": buoy_id
            }


class ConditionsInterpreter:
    """
    Persona 2: Conditions Interpreter

    Translates raw buoy data into plain-English surf report.
    (To be implemented in future)
    """

    @staticmethod
    async def interpret(
        wvht_ft: float,
        dpd_sec: float,
        mwd_deg: int,
        wind_speed_kts: float,
        wind_dir_deg: int,
        spot_name: str = "Unknown Spot"
    ) -> Dict[str, Any]:
        """
        Interpret current conditions into plain English.
        """
        # TODO: Implement in Phase 2
        return {
            "success": False,
            "error": "Conditions interpreter not yet implemented"
        }


# Export main analysis function
async def analyze_spot_swell_geometry(
    lat: float,
    lon: float,
    spot_name: str,
    buoy_id: str = None
) -> Dict[str, Any]:
    """
    Main entry point for swell geometry analysis.
    """
    return await SwellGeometryAnalyst.analyze(lat, lon, spot_name, buoy_id)