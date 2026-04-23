"""
Surf spot scoring algorithm - calculates real-time surf quality (0-10 scale)
Based on buoy data, swell/wind windows, and spot-specific tuning.
"""

import math
from typing import Dict, List, Optional, Tuple
from database import supabase
from utils import calculate_surf_height


def normalize_direction(degrees: float) -> float:
    """Normalize direction to 0-359 range."""
    while degrees < 0:
        degrees += 360
    while degrees >= 360:
        degrees -= 360
    return degrees


def direction_difference(dir1: float, dir2: float) -> float:
    """
    Calculate shortest angular difference between two directions.
    Returns value between 0-180 degrees.
    """
    diff = abs(dir1 - dir2)
    if diff > 180:
        diff = 360 - diff
    return diff


def is_direction_in_window(direction: float, dir_min: int, dir_max: int) -> Tuple[bool, float]:
    """
    Check if direction falls within a window, handling wraparound.
    Returns (is_in_window, distance_from_optimal).

    Examples:
    - direction=315, window=280-330 → (True, 15)  # 15° from center
    - direction=350, window=330-30 → (True, 10)   # Wraps around north
    """
    # Ensure types are correct (database may return strings)
    direction = float(direction) if direction is not None else 0.0
    dir_min = int(dir_min) if dir_min is not None else 0
    dir_max = int(dir_max) if dir_max is not None else 0

    direction = normalize_direction(direction)

    # Handle wraparound (e.g., 330-30 crosses north)
    if dir_max < dir_min:
        # Window crosses 0/360
        in_window = direction >= dir_min or direction <= dir_max

        # Calculate distance from window center
        window_center = normalize_direction((dir_min + dir_max + 360) / 2)
        distance = direction_difference(direction, window_center)
    else:
        # Normal window
        in_window = dir_min <= direction <= dir_max

        # Distance from window center
        window_center = (dir_min + dir_max) / 2
        distance = direction_difference(direction, window_center)

    return in_window, distance


def calculate_swell_direction_score(
    swell_direction: float,
    swell_windows: List[Dict],
    direction_penalty_deg: int = 20
) -> Tuple[float, Optional[Dict]]:
    """
    Calculate score for swell direction (0-3 points).

    Returns:
        (score, best_matching_window)
    """
    if not swell_windows or swell_direction is None:
        return 0.0, None

    best_score = 0.0
    best_window = None

    for window in swell_windows:
        # Ensure window values are valid
        if 'dir_min' not in window or 'dir_max' not in window:
            continue

        dir_min = int(window['dir_min'])
        dir_max = int(window['dir_max'])
        weight = float(window.get('weight', 1.0))

        in_window, distance = is_direction_in_window(swell_direction, dir_min, dir_max)

        if in_window:
            # Perfect match: 3.0 points * weight
            # Apply penalty for distance from window center
            penalty = min(1.0, distance / direction_penalty_deg)
            score = 3.0 * weight * (1.0 - penalty * 0.3)  # Max 30% penalty for off-center

            if score > best_score:
                best_score = score
                best_window = window
        else:
            # Outside window but close
            if distance < direction_penalty_deg * 2:
                # Partial credit for being near the window
                proximity = 1.0 - (distance / (direction_penalty_deg * 2))
                score = 3.0 * weight * proximity * 0.3  # Max 30% of full score

                if score > best_score:
                    best_score = score
                    best_window = window

    return round(best_score, 2), best_window


def calculate_swell_size_score(
    wave_height_m: float,
    optimal_min_ft: float,
    optimal_max_ft: float,
    hs_multiplier: float = 1.0
) -> float:
    """
    Calculate score for swell size (0-3 points).

    Spot-adjusted wave height should be in optimal range.
    """
    if wave_height_m is None or optimal_min_ft is None or optimal_max_ft is None:
        return 0.0

    # Apply spot multiplier
    adjusted_height_m = wave_height_m * hs_multiplier
    adjusted_height_ft = adjusted_height_m * 3.28084  # meters to feet

    if optimal_min_ft <= adjusted_height_ft <= optimal_max_ft:
        # In optimal range - full points
        # Give slightly higher score if in "sweet spot" (middle 50%)
        range_size = optimal_max_ft - optimal_min_ft
        sweet_spot_min = optimal_min_ft + range_size * 0.25
        sweet_spot_max = optimal_max_ft - range_size * 0.25

        if sweet_spot_min <= adjusted_height_ft <= sweet_spot_max:
            return 3.0  # Perfect size
        else:
            return 2.7  # In range but not ideal

    elif adjusted_height_ft < optimal_min_ft:
        # Too small - proportional score
        if adjusted_height_ft <= 0:
            return 0.0
        ratio = adjusted_height_ft / optimal_min_ft
        return max(0.0, ratio * 2.5)  # Up to 2.5 points for undersized

    else:
        # Too big - diminishing score
        excess = adjusted_height_ft - optimal_max_ft
        penalty = min(1.0, excess / optimal_max_ft)
        return max(0.0, 3.0 - (penalty * 2.5))  # Lose up to 2.5 points for oversized


def calculate_wind_score(
    wind_direction: Optional[float],
    wind_speed_ms: Optional[float],
    wind_windows: List[Dict],
    max_onshore_mph: int = 15
) -> float:
    """
    Calculate score for wind conditions (0-2 points).

    Offshore = ideal, light onshore = tolerable, strong onshore = poor
    """
    if not wind_windows:
        # No wind preference defined - neutral score
        return 1.0

    if wind_direction is None:
        # No wind data - assume neutral
        return 1.0

    # Check against wind windows
    best_score = 0.0

    for window in wind_windows:
        dir_min = window['dir_min']
        dir_max = window['dir_max']
        category = window.get('category', 'ideal')
        weight = window.get('weight', 1.0)

        in_window, distance = is_direction_in_window(wind_direction, dir_min, dir_max)

        if in_window:
            if category == 'ideal':
                score = 2.0 * weight
            elif category == 'tolerable':
                score = 1.2 * weight
            else:  # marginal
                score = 0.5 * weight

            # Apply wind speed penalty if too strong
            if wind_speed_ms is not None:
                wind_speed_mph = wind_speed_ms * 2.23694  # m/s to mph
                if wind_speed_mph > max_onshore_mph:
                    speed_penalty = min(1.0, (wind_speed_mph - max_onshore_mph) / max_onshore_mph)
                    score *= (1.0 - speed_penalty * 0.5)  # Up to 50% reduction

            if score > best_score:
                best_score = score

    # If no window matched, penalize based on wind strength
    if best_score == 0.0 and wind_speed_ms is not None:
        wind_speed_mph = wind_speed_ms * 2.23694
        if wind_speed_mph < 5:
            return 1.0  # Light wind, no big deal
        elif wind_speed_mph < 10:
            return 0.5  # Moderate, some effect
        else:
            return 0.0  # Strong onshore, blown out

    return round(best_score, 2)


def calculate_wind_speed_score(wind_speed_ms: Optional[float]) -> float:
    """
    Calculate score for wind speed alone (0-2 points).
    Light wind is best for most spots.
    """
    if wind_speed_ms is None:
        return 1.0  # Neutral if no data

    wind_speed_mph = wind_speed_ms * 2.23694

    if wind_speed_mph < 5:
        return 2.0  # Perfect - light wind
    elif wind_speed_mph < 10:
        return 1.5  # Good - moderate
    elif wind_speed_mph < 15:
        return 0.8  # Marginal
    else:
        return 0.0  # Blown out


def get_rating_text(score: float) -> str:
    """Convert numeric score to text rating."""
    if score >= 8.5:
        return "Epic"
    elif score >= 7.0:
        return "Good"
    elif score >= 5.0:
        return "Fair"
    elif score >= 3.0:
        return "Poor"
    else:
        return "Flat"


def get_rating_emoji(score: float) -> str:
    """Get emoji for score."""
    if score >= 8.5:
        return "🔥"
    elif score >= 7.0:
        return "🟢"
    elif score >= 5.0:
        return "🟡"
    elif score >= 3.0:
        return "🟠"
    else:
        return "🔴"


async def blend_buoy_data(buoy_blend: Dict, buoy_data_cache: Dict) -> Optional[Dict]:
    """
    Blend multiple buoy readings using weighted average.

    Args:
        buoy_blend: {"46225": {"weight": 0.5, "role": "primary"}, ...}
        buoy_data_cache: Pre-fetched buoy data

    Returns:
        Blended buoy reading with weighted averages
    """
    if not buoy_blend:
        return None

    # Collect valid buoy readings
    valid_readings = []
    total_weight = 0.0

    for buoy_id, config in buoy_blend.items():
        weight = config.get('weight', 0.0)

        if buoy_id in buoy_data_cache:
            buoy_data = buoy_data_cache[buoy_id]

            # Only include if we have wave data
            if buoy_data.get('wave_height_m') is not None:
                valid_readings.append({
                    'data': buoy_data,
                    'weight': weight
                })
                total_weight += weight

    if not valid_readings or total_weight == 0:
        return None

    # Normalize weights
    for reading in valid_readings:
        reading['weight'] /= total_weight

    # Blend numeric values
    blended = {
        'wave_height_m': 0.0,
        'dominant_period_sec': 0.0,
        'mean_wave_dir': None,
        'wind_speed_ms': 0.0,
        'wind_dir': None,
        'water_temp_c': None,
        'buoys_used': [],
        'primary_buoy': None
    }

    # Weighted average for scalar values
    for reading in valid_readings:
        data = reading['data']
        weight = reading['weight']

        blended['buoys_used'].append({
            'id':              data['station'],
            'name':            data.get('name', data['station']),
            'weight':          round(weight, 2),
            'wave_height_m':   data.get('wave_height_m'),
            'wave_height_ft':  round(data['wave_height_m'] * 3.28084, 1) if data.get('wave_height_m') else None,
            'period_sec':      data.get('dominant_period_sec'),
            'swell_dir':       data.get('mean_wave_dir'),
            'wind_speed_mph':  round(data['wind_speed_ms'] * 2.23694, 1) if data.get('wind_speed_ms') else None,
            'wind_dir':        data.get('wind_dir'),
            'timestamp_utc':   data.get('timestamp_utc'),
            'is_model':        data.get('station') == 'WW3',
        })

        if data.get('wave_height_m') is not None:
            blended['wave_height_m'] += data['wave_height_m'] * weight

        if data.get('dominant_period_sec') is not None:
            blended['dominant_period_sec'] += data['dominant_period_sec'] * weight

        if data.get('wind_speed_ms') is not None:
            blended['wind_speed_ms'] += data['wind_speed_ms'] * weight

    # Use direction from highest-weighted buoy (can't average angles meaningfully)
    highest_weight_reading = max(valid_readings, key=lambda x: x['weight'])
    blended['mean_wave_dir'] = highest_weight_reading['data'].get('mean_wave_dir')
    blended['wind_dir'] = highest_weight_reading['data'].get('wind_dir')
    blended['primary_buoy'] = highest_weight_reading['data']['station']

    # Water temp: use the highest-weighted buoy that actually reports it.
    # Blend weights reflect the buoy's configured relevance to this spot — not proximity.
    # WTMP is a live observation; if the buoy is offline or doesn't report it, skip it.
    for reading in sorted(valid_readings, key=lambda x: x['weight'], reverse=True):
        wt = reading['data'].get('water_temp_c')
        if wt is not None and wt != 0.0:
            blended['water_temp_c'] = round(wt, 1)
            break

    return blended


async def calculate_spot_score(spot_slug: str, buoy_data_cache: Dict, buoy_blend_override: Optional[Dict] = None, size_bias: float = 1.0) -> Optional[Dict]:
    """
    Calculate real-time surf score for a spot.

    Args:
        spot_slug: Spot identifier (e.g., "blacks-beach")
        buoy_data_cache: Dictionary of buoy data keyed by station ID
        buoy_blend_override: Optional override for buoy blend weights (for adding WW3 etc.)

    Returns:
        Score breakdown with overall rating (0-10 scale)
    """
    if not supabase:
        return None

    # Fetch spot with all related data
    result = supabase.table("spots") \
        .select("""
            *,
            spot_characteristics(*),
            spot_swell_windows(*),
            spot_wind_windows(*),
            spot_forecast_tuning(*)
        """) \
        .eq("slug", spot_slug) \
        .single() \
        .execute()

    if not result.data:
        return None

    spot = result.data
    chars = spot['spot_characteristics']
    tuning = spot['spot_forecast_tuning']
    swell_windows = spot['spot_swell_windows']
    wind_windows = spot['spot_wind_windows']

    # Use override blend if provided, otherwise use database config
    buoy_blend = buoy_blend_override if buoy_blend_override is not None else tuning['buoy_blend']

    # Blend buoy data
    blended_buoy = await blend_buoy_data(buoy_blend, buoy_data_cache)

    if not blended_buoy:
        return {
            'spot_name': spot['name'],
            'spot_slug': spot_slug,
            'overall_score': 0.0,
            'rating': 'No Data',
            'emoji': '❓',
            'error': 'No buoy data available'
        }

    # Apply spot height multiplier
    hs_multiplier = tuning.get('hs_multiplier', 1.0)
    direction_penalty_deg = tuning.get('direction_penalty_deg', 20)

    # Calculate component scores
    swell_dir_score, best_swell_window = calculate_swell_direction_score(
        blended_buoy['mean_wave_dir'],
        swell_windows,
        direction_penalty_deg
    )

    swell_size_score = calculate_swell_size_score(
        blended_buoy['wave_height_m'],
        chars['works_from_swell_ft'],
        chars['works_to_swell_ft'],
        hs_multiplier
    )

    wind_score = calculate_wind_score(
        blended_buoy['wind_dir'],
        blended_buoy['wind_speed_ms'],
        wind_windows,
        chars.get('max_onshore_mph', 15)
    )

    wind_speed_score = calculate_wind_speed_score(blended_buoy['wind_speed_ms'])

    # Combine scores (out of 10 total)
    # Swell direction: 3 pts, Size: 3 pts, Wind dir: 2 pts, Wind speed: 2 pts
    overall_score = swell_dir_score + swell_size_score + wind_score + wind_speed_score

    # Apply confidence factor
    confidence = tuning.get('confidence_base', 0.7)

    return {
        'spot_name': spot['name'],
        'spot_slug': spot_slug,
        'overall_score': round(overall_score, 1),
        'rating': get_rating_text(overall_score),
        'emoji': get_rating_emoji(overall_score),

        # Component scores
        'swell_direction_score': swell_dir_score,
        'swell_size_score': round(swell_size_score, 2),
        'wind_direction_score': wind_score,
        'wind_speed_score': round(wind_speed_score, 2),

        # Buoy data used
        'wave_height_m': round(blended_buoy['wave_height_m'], 2),
        'wave_height_ft': round(blended_buoy['wave_height_m'] * 3.28084, 1),
        'adjusted_height_ft': round(blended_buoy['wave_height_m'] * hs_multiplier * 3.28084, 1),
        'period_sec': round(blended_buoy['dominant_period_sec'], 1) if blended_buoy['dominant_period_sec'] else None,
        'surf_height_ft': round(calculate_surf_height(blended_buoy['wave_height_m'], blended_buoy['dominant_period_sec'], size_bias) * 3.28084, 1) if blended_buoy['dominant_period_sec'] else None,
        'swell_direction': blended_buoy['mean_wave_dir'],
        'wind_speed_mph': round(blended_buoy['wind_speed_ms'] * 2.23694, 1) if blended_buoy['wind_speed_ms'] else None,
        'wind_direction': blended_buoy['wind_dir'],

        # Water temp: live NDBC WTMP reading from the highest-weighted buoy that reports it.
        # This is always the current observation — water temp doesn't vary in the forecast timeline.
        'water_temp_c': blended_buoy.get('water_temp_c'),

        # Metadata
        'buoys_used': blended_buoy['buoys_used'],
        'primary_buoy': blended_buoy['primary_buoy'],
        'confidence': confidence,
        'best_swell_window': best_swell_window['notes'] if best_swell_window else None,
    }
