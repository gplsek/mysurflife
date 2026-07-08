"""
AI Surf Analysis Personas for SURF SPOTS using OpenAI.
Uses actual spot characteristics, swell windows, and break information.
"""

import os
import json
from typing import Dict, Any, Optional
from datetime import datetime
from openai import AsyncOpenAI
from database import supabase

# Environment variable for API key
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Initialize OpenAI client
if OPENAI_API_KEY:
    openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    print("✅ OpenAI API initialized for AI personas")
else:
    openai_client = None
    print("⚠️  OPENAI_API_KEY not set - OpenAI personas disabled")


def degrees_to_cardinal(degrees: float) -> str:
    """Convert degrees to cardinal direction"""
    if degrees is None:
        return "N/A"
    directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    idx = round(degrees / 22.5) % 16
    return directions[idx]


def extract_json_from_response(content: str) -> Dict[str, Any]:
    """Extract JSON from AI response, handling markdown code blocks."""
    content = content.strip()

    if "```json" in content:
        json_str = content.split("```json")[1].split("```")[0].strip()
    elif "```" in content:
        json_str = content.split("```")[1].split("```")[0].strip()
    else:
        json_str = content

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        return {
            "error": f"Failed to parse JSON: {str(e)}",
            "raw_response": content[:500]
        }


async def get_spot_context(spot_slug: str) -> Optional[Dict[str, Any]]:
    """
    Fetch complete spot context from database for AI analysis.
    """
    if not supabase:
        return None

    try:
        # Admin client bypasses RLS so private spots are readable too.
        try:
            from database import get_supabase_admin_client
            client = get_supabase_admin_client() or supabase
        except ImportError:
            client = supabase

        rows = client.table("spots") \
            .select("""
                *,
                spot_characteristics(*),
                spot_swell_windows(*),
                spot_wind_windows(*)
            """) \
            .eq("slug", spot_slug) \
            .limit(1).execute().data or []

        if not rows:
            return None

        return rows[0]

    except Exception as e:
        print(f"❌ Error fetching spot context: {e}")
        return None


class SpotSwellGeometryAnalystOpenAI:
    """
    Persona 1: Expert Oceanographer - Swell Geometry Analysis for Surf Spots
    Using OpenAI GPT-4.

    Analyzes actual surf spots using their characteristics, break type,
    known swell windows, and local geography.
    """

    @staticmethod
    async def analyze(spot_slug: str) -> Dict[str, Any]:
        """
        Analyze surf spot swell geometry using database context with OpenAI.
        """
        if not openai_client:
            return {
                "success": False,
                "error": "OpenAI personas not configured (missing OPENAI_API_KEY)"
            }

        # Get spot data from database
        spot_data = await get_spot_context(spot_slug)

        if not spot_data:
            return {
                "success": False,
                "error": f"Spot '{spot_slug}' not found in database"
            }

        # Extract spot info
        spot_name = spot_data['name']
        lat = spot_data['latitude']
        lon = spot_data['longitude']
        region = spot_data.get('region', 'California')

        # Extract ALL human-entered data from spot
        location_desc = spot_data.get('location_description', '').strip() or "Not provided"
        access_desc = spot_data.get('access_description', '').strip() or "Not provided"
        parking_info = spot_data.get('parking_info', '').strip() or "Not provided"

        # Extract characteristics
        chars = spot_data.get('spot_characteristics', [])
        if isinstance(chars, list) and len(chars) > 0:
            chars = chars[0]

        break_type = chars.get('break_type', 'unknown')
        bottom_type = chars.get('bottom_type', 'unknown')
        wave_direction = chars.get('wave_direction', 'unknown')
        best_swell_dir = chars.get('best_swell_direction', 'SW, W')
        swell_exposure = chars.get('swell_exposure', 'unknown')
        wave_quality = chars.get('wave_quality', 'unknown')
        skill_level = chars.get('skill_level', 'unknown')
        tide_position = chars.get('tide_position', 'unknown')
        best_wind_dir = chars.get('best_wind_direction', 'unknown')
        hazards = chars.get('hazards', '') or "None specified"
        works_from = chars.get('works_from_swell_ft')
        works_to = chars.get('works_to_swell_ft')
        size_range_desc = f"{works_from}-{works_to}ft" if works_from and works_to else "Not specified"

        # Extract swell windows
        swell_windows = spot_data.get('spot_swell_windows', [])
        swell_window_desc = ""
        if swell_windows:
            windows = []
            for sw in swell_windows:
                windows.append(f"{sw['dir_min']}-{sw['dir_max']}° (weight: {sw.get('weight', 1.0)})")
            swell_window_desc = ", ".join(windows)
        else:
            swell_window_desc = "Not specified"

        # Determine hemisphere and ocean basin from coordinates
        hemisphere = "Northern" if lat > 0 else "Southern"

        # Determine ocean basin and dominant swell directions
        if -180 <= lon <= -80:  # Eastern Pacific / Americas
            ocean_basin = "Eastern Pacific"
            if lat > 0:  # Northern Hemisphere
                swell_context = "North Pacific storms generate NW-W swells in winter, SW swells in summer"
            else:  # Southern Hemisphere
                swell_context = "Southern Ocean storms generate S-SW swells in winter, NW swells in summer"
        elif -80 < lon <= 20:  # Atlantic
            ocean_basin = "Atlantic Ocean"
            if lat > 0:  # Northern Hemisphere
                swell_context = "North Atlantic storms generate N-NW swells in winter, tropical swells from S in summer/fall"
            else:  # Southern Hemisphere
                swell_context = "Southern Ocean storms generate S-SW swells year-round, tropical swells from NE"
        elif 20 < lon <= 180:  # Indian / Western Pacific
            ocean_basin = "Indian Ocean / Western Pacific"
            if lat > 0:  # Northern Hemisphere
                swell_context = "Typhoons generate E-SE swells in summer/fall, NE monsoon swells in winter"
            else:  # Southern Hemisphere
                swell_context = "Southern Ocean storms generate S-SW swells year-round, tropical cyclones bring NW swells"
        else:
            ocean_basin = "Unknown"
            swell_context = "Analyze based on coastline orientation and nearby fetch"

        lat_dir = "N" if lat >= 0 else "S"
        lon_dir = "E" if lon >= 0 else "W"

        prompt = f"""You are an expert oceanographer specializing in surf spot analysis, ocean swell propagation, and coastal geometry. You have deep knowledge of how waves interact with coastlines worldwide.

TASK: Analyze this SPECIFIC SURF SPOT and provide comprehensive swell direction analysis based on its geographic location.

SPOT INFORMATION:
- Name: {spot_name}
- Coordinates: {abs(lat)}°{lat_dir}, {abs(lon)}°{lon_dir}
- Ocean Basin: {ocean_basin}
- Hemisphere: {hemisphere}

BREAK CHARACTERISTICS:
- Break Type: {break_type}
- Bottom Type: {bottom_type}
- Wave Direction: {wave_direction}
- Wave Quality: {wave_quality}
- Skill Level: {skill_level}
- Swell Exposure: {swell_exposure}

KNOWN SWELL DATA:
- Best Swell Directions: {best_swell_dir}
- Swell Size Range: {size_range_desc}
- Database Swell Windows: {swell_window_desc}

ENVIRONMENTAL FACTORS:
- Best Wind Direction: {best_wind_dir}
- Tide Position: {tide_position}
- Hazards: {hazards}

HUMAN-ENTERED CONTEXT (Local Knowledge):
- Location: {location_desc}
- Access: {access_desc}
- Parking: {parking_info}

GEOGRAPHIC CONTEXT:
{swell_context}

ANALYSIS REQUIREMENTS:

1. **IDENTIFY LOCAL GEOGRAPHY** (Use coordinates to reason about nearby features)
   - Consider coastline orientation at this latitude/longitude
   - Identify potential blocking features: nearby islands, peninsulas, headlands, bays
   - Think about what land masses or island chains are in each compass direction
   - Consider continental shelf, underwater canyons, reefs based on coastal geography

2. **PRIMARY SWELL WINDOWS** (Optimal for THIS specific break)
   - Rate each productive window (Excellent / Good / Fair)
   - Explain why these directions work based on coastline orientation and exposure
   - Consider the ocean basin's typical swell patterns
   - Account for local bathymetry and {break_type} characteristics

3. **SHADOW ZONES** (Completely or heavily blocked)
   - Identify what blocks swell from each direction (land, islands, reefs)
   - Estimate blockage percentage (80-100%)
   - Explain the geographic reason (e.g., "behind peninsula", "continental landmass")

4. **PARTIAL BLOCKAGE ANALYSIS**
   - Directions with partial shadowing (40-70% energy)
   - Period-dependency: longer period swells diffract/wrap better
   - Provide threshold periods (e.g., ">16s wraps around headland")

5. **BATHYMETRY & REFRACTION**
   - How underwater features affect waves at this location
   - {break_type} on {bottom_type}: How do these interact?
   - Reefs focus energy, bays disperse, points refract, canyons channel
   - Consider typical bathymetry for this coastal region

6. **OPTIMAL SWELL CHARACTERISTICS**
   - Best swell direction (degrees) based on coastline exposure
   - Optimal period range for {break_type}
   - Size range suitable for {bottom_type}
   - Seasonal patterns for this location

7. **SPOT-SPECIFIC SUMMARY**
   - Why this spot is unique in its region
   - Local characteristics that affect surf quality
   - Any quirks (wind, tide, crowd, access)

REASONING FRAMEWORK:
- Use coordinates to infer nearby geography (don't make up specific place names unless certain)
- Consider hemisphere for seasonal swell patterns
- Account for ocean basin (Pacific storms differ from Atlantic/Indian Ocean patterns)
- Think about typical coastal features at this latitude
- Reason from first principles: coastline angle, fetch, bathymetry

IMPORTANT:
- Do NOT reference California-specific features unless coordinates are actually in California
- Do NOT assume Channel Islands, Point Conception, etc. exist at this location
- DO reason about what ACTUALLY blocks swell at these specific coordinates
- DO consider global swell patterns for this ocean basin and hemisphere

OUTPUT FORMAT: Return ONLY valid JSON (no markdown):
{{
  "primary_windows": [
    {{
      "direction": "SW-W",
      "degrees": "210-270",
      "quality": "Excellent",
      "notes": "Why this works for THIS spot specifically based on coastline orientation and exposure"
    }}
  ],
  "shadow_zones": [
    {{
      "direction": "E",
      "degrees": "45-135",
      "blocker": "Describe actual geographic feature blocking this direction",
      "blockage": "95%",
      "notes": "Impact on THIS spot"
    }}
  ],
  "partial_blockage": [
    {{
      "direction": "NW",
      "degrees": "310-330",
      "blocker": "Describe actual feature (headland, island, peninsula)",
      "energy_pct": 50,
      "period_threshold": 15,
      "notes": "How longer period swells wrap around this feature to reach the spot"
    }}
  ],
  "bathymetry": {{
    "notes": "Spot-specific bathymetry and how it affects waves",
    "depth_characteristics": "Exposed / Protected / Mixed",
    "refraction_effects": "Focusing / Defocusing / Minimal",
    "break_specific_notes": "How {bottom_type} and {break_type} interact with swell"
  }},
  "optimal_swell": {{
    "direction_deg": 240,
    "direction_name": "WSW",
    "period_range": "12-18s",
    "size_range": "4-8ft",
    "season_notes": "Best seasons for this spot"
  }},
  "summary": "Spot-specific summary: This {break_type} at {spot_name}..."
}}

Provide detailed analysis specific to {spot_name} at these exact coordinates, not generic regional info.
Use the coordinates to reason about actual nearby geography and blocking features.
"""

        try:
            # Call OpenAI API
            response = await openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": prompt
                }],
                max_tokens=2048,
                temperature=0.3,
                response_format={"type": "json_object"}
            )

            content = response.choices[0].message.content
            analysis = extract_json_from_response(content)

            if "error" in analysis and "raw_response" in analysis:
                return {
                    "success": False,
                    "error": analysis["error"],
                    "raw_response": analysis["raw_response"],
                    "spot_slug": spot_slug
                }

            return {
                "success": True,
                "spot_slug": spot_slug,
                "spot_name": spot_name,
                "spot_id": spot_data['id'],
                "lat": lat,
                "lon": lon,
                "ocean_basin": ocean_basin,
                "hemisphere": hemisphere,
                "break_type": break_type,
                "bottom_type": bottom_type,
                "analysis": analysis,
                "persona": "swell_geometry_analyst",
                "model": "gpt-4o",
                "analyzed_at": datetime.utcnow().isoformat()
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"AI analysis failed: {str(e)}",
                "spot_slug": spot_slug
            }
