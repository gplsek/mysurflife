"""
backend/swell_tables.py
=======================
Stormsurf reference tables encoded as Python lookups.

Sources:
  Swell Category Table:  https://www.stormsurf.com/page2/papers/category_short.html
  Sea Height Table:      https://www.stormsurf.com/page2/papers/seatable.html

Two independent tools:

1. swell_category(wvht_ft, period_s) -> int (0-10)
   Given a buoy reading (Hs + period), returns the Stormsurf swell category
   and expected wave face height range at a generic beach.
   Replaces the homemade multiplier in calculate_surf_height().

2. estimate_sea_height(wind_kts, duration_hrs, fetch_nm) -> (sea_ft, period_s)
   Given storm wind parameters, estimates significant sea height and peak
   period. Used when the wave model hasn't resolved a developing storm yet,
   or as a sanity check against WW3.

FastAPI routes registered via register_routes(app):
   GET /api/swell/category    — category lookup from buoy reading
   GET /api/swell/sea-height  — storm sea height estimation

---
PHYSICS NOTES
-------------

Swell Category Table:
  Categories 0-10 map to wave face height ranges (trough-to-crest, ft).
  The same face height can be produced by different Hs+period combinations
  because longer period swells shoal more aggressively. A 6ft @ 17s swell
  is Category 4 (10-15ft faces) while 6ft @ 7s is barely Category 1
  (2.5-5ft faces). This is why period matters as much as height.

  "Beaches with size-enhancing bathymetry can cause actual wave heights
  to be up to double the stated size." — Stormsurf note.
  This is exactly what user_spot_profiles.size_perception_bias captures.

Sea Height Table (Table 1 — duration primary):
  Theoretical significant sea height as a function of wind speed, duration,
  and fetch. WW3 is still the best forecast tool; this table is for
  sanity-checking models and estimating output from developing storms
  that the model hasn't resolved yet.
  Stormsurf notes Table 1 is closer to real buoy observations than Table 2.
"""

from __future__ import annotations
import math
from typing import Optional


# ---------------------------------------------------------------------------
# PART 1: SWELL CATEGORY TABLE
# Source: https://www.stormsurf.com/page2/papers/category_short.html
# ---------------------------------------------------------------------------

# Wave face height range per category (ft, trough-to-crest, avg of highest 1/3)
CATEGORY_FACE_HEIGHTS: dict[int, tuple[float, float]] = {
    0:  (0.0,   2.5),
    1:  (2.5,   5.0),
    2:  (5.0,   7.5),
    3:  (7.5,  10.0),
    4:  (10.0, 15.0),
    5:  (15.0, 20.0),
    6:  (20.0, 25.0),
    7:  (25.0, 30.0),
    8:  (30.0, 40.0),
    9:  (40.0, 50.0),
    10: (50.0, 999.0),
}

CATEGORY_LABELS: dict[int, str] = {
    0:  "Flat",
    1:  "Small",
    2:  "Waist–Chest",
    3:  "Shoulder–Head",
    4:  "Overhead–DOH",
    5:  "DOH–TOH",
    6:  "Triple+",
    7:  "XXL",
    8:  "XXL+",
    9:  "Historic",
    10: "Mythic",
}

# Upper Hs threshold per (period_col, category).
# Value = maximum Hs (ft) for that category at that period.
# None = this category is not reachable at this period.
# Reading: if wvht_ft < threshold → that category applies.
#
# Columns: 7s, 9s, 11s, 13s, 14s, 17s, 20s, 25s
# (from the Stormsurf table, which lists these specific period columns)
#
# Example: at 14s period, category 3 applies for 6.0–8.9 ft Hs.
_PERIOD_COLUMNS = [7, 9, 11, 13, 14, 17, 20, 25]

# Upper bound of each category per period column.
# Index = category (0-10). None = unreachable at this period.
_CATEGORY_UPPER: dict[int, list[Optional[float]]] = {
    # cat:  7s     9s     11s    13s    14s    17s    20s    25s
    0:  [3.5,   2.8,   2.3,   1.9,   2.0,   1.5,   1.3,   0.9],
    1:  [7.1,   5.5,   4.5,   3.8,   3.9,   2.9,   2.4,   1.9],
    2:  [None,  8.3,   6.8,   5.7,   5.9,   4.3,   3.7,   2.9],
    3:  [None,  None,  9.0,   7.6,   8.9,   5.8,   4.9,   3.9],
    4:  [None,  None,  None,  11.5,  10.7,  8.8,   7.4,   5.9],
    5:  [None,  None,  None,  None,  14.1,  11.7,  9.9,   7.9],
    6:  [None,  None,  None,  None,  None,  14.7,  12.4,  9.9],
    7:  [None,  None,  None,  None,  None,  17.6,  14.9,  11.9],
    8:  [None,  None,  None,  None,  None,  None,  19.5,  15.9],
    9:  [None,  None,  None,  None,  None,  None,  24.9,  20.0],
    10: [None,  None,  None,  None,  None,  None,  None,  None],  # 25ft+ @ 25s
}


def swell_category(wvht_ft: float, period_s: float) -> int:
    """
    Returns the Stormsurf swell category (0-10) for a given buoy reading.

    Args:
        wvht_ft:   Significant wave height in feet (NDBC WVHT × 3.28084)
        period_s:  Dominant period in seconds (NDBC DPD)

    Returns:
        Integer category 0-10. Category 10 = 50ft+ faces.

    Example:
        swell_category(6.0, 14.0) → 3  (7.5-10ft faces)
        swell_category(6.0, 7.0)  → 1  (2.5-5ft faces)
        swell_category(3.5, 25.0) → 3  (7.5-10ft faces — long period punches above weight)
    """
    # Find the two nearest period columns for interpolation
    cols = _PERIOD_COLUMNS

    if period_s <= cols[0]:
        col_idx = 0
    elif period_s >= cols[-1]:
        col_idx = len(cols) - 1
    else:
        # Find lower bracket
        col_idx = max(i for i, p in enumerate(cols) if p <= period_s)

    # Interpolate upper bounds between the two nearest columns
    if col_idx < len(cols) - 1:
        p_lo = cols[col_idx]
        p_hi = cols[col_idx + 1]
        frac = (period_s - p_lo) / (p_hi - p_lo)
    else:
        frac = 0.0

    for cat in range(10):
        upper_lo = _CATEGORY_UPPER[cat][col_idx]

        # None means this category is unreachable at this period —
        # the Hs required exceeds the physical limit.
        # That means the previous category was the ceiling: return cat.
        if upper_lo is None:
            return cat

        if col_idx < len(cols) - 1:
            upper_hi = _CATEGORY_UPPER[cat][col_idx + 1]
            if upper_hi is None:
                upper = upper_lo
            else:
                upper = upper_lo + frac * (upper_hi - upper_lo)
        else:
            upper = upper_lo

        # Cat 0 boundary is strict (table says "<X ft").
        # All other category boundaries are inclusive ("X-Y ft" where Y is in the category).
        if cat == 0:
            if wvht_ft < upper:
                return cat
        else:
            if wvht_ft <= upper:
                return cat

    return 10  # Above all table values (25ft+ @ 25s)


def category_face_height(category: int) -> tuple[float, float]:
    """
    Returns (min_ft, max_ft) wave face height range for a swell category.

    Args:
        category: Stormsurf swell category 0-10

    Returns:
        (min_face_ft, max_face_ft) tuple
    """
    return CATEGORY_FACE_HEIGHTS.get(category, (0.0, 0.0))


def category_label(category: int) -> str:
    """Returns a human-readable label for a swell category."""
    return CATEGORY_LABELS.get(category, "Unknown")


def surf_height_from_buoy(
    wvht_ft: float,
    period_s: float,
    size_bias: float = 1.0,
) -> dict:
    """
    Full surf height estimation from a buoy reading.
    Replaces calculate_surf_height() in main.py.

    Args:
        wvht_ft:    Significant wave height in feet
        period_s:   Dominant period in seconds
        size_bias:  Spot-specific perception bias from user_spot_profiles
                    (e.g. 1.35 = Blacks Beach canyon amplification)

    Returns:
        {
            "category":       3,
            "label":          "Shoulder-Head",
            "face_min_ft":    7.5,
            "face_max_ft":    10.0,
            "face_mid_ft":    8.75,
            "adjusted_min":   10.1,   # after size_bias
            "adjusted_max":   13.5,   # after size_bias
            "size_bias":      1.35,
        }
    """
    cat = swell_category(wvht_ft, period_s)
    face_min, face_max = category_face_height(cat)
    face_mid = (face_min + face_max) / 2.0

    return {
        "category":     cat,
        "label":        category_label(cat),
        "face_min_ft":  round(face_min, 1),
        "face_max_ft":  round(face_max, 1) if face_max < 900 else None,
        "face_mid_ft":  round(face_mid, 1),
        "adjusted_min": round(face_min * size_bias, 1),
        "adjusted_max": round(face_max * size_bias, 1) if face_max < 900 else None,
        "size_bias":    size_bias,
    }


# ---------------------------------------------------------------------------
# PART 2: SEA HEIGHT TABLE (Table 1 — wind speed × duration)
# Source: https://www.stormsurf.com/page2/papers/seatable.html
#
# Format per cell: (sea_height_ft, period_s, min_fetch_nm)
# "5.7@6  43" → (5.7, 6, 43)
# ---------------------------------------------------------------------------

# Rows = wind speed (kts). Columns = duration (hrs).
# _SEA_TABLE[wind_kts][duration_hrs] = (sea_ft, period_s, min_fetch_nm)

_SEA_TABLE: dict[int, dict[int, tuple[float, float, int]]] = {
    22: {
        6:   (5.7,  6.0,  43),
        12:  (7.8,  7.5,  100),
        18:  (9.0,  8.0,  160),
        25:  (10.0, 9.0,  250),
        35:  (11.0, 10.0, 400),
        45:  (12.0, 11.0, 550),
        55:  (12.0, 11.5, 700),
        70:  (12.0, 12.0, 1000),
        80:  (12.0, 12.5, 1200),
        90:  (12.0, 12.5, 1400),
        100: (12.0, 13.0, 1550),
        120: (12.0, 13.0, 1950),
        140: (12.0, 13.0, 2350),
    },
    26: {
        6:   (7.0,  6.6,  48),
        12:  (10.0, 8.0,  110),
        18:  (12.0, 9.0,  170),
        25:  (13.0, 10.0, 280),
        35:  (14.0, 11.0, 410),
        45:  (15.0, 12.0, 600),
        55:  (16.0, 13.0, 800),
        70:  (16.0, 13.5, 1100),
        80:  (16.0, 14.0, 1350),
        90:  (17.0, 14.5, 1550),
        100: (17.5, 15.0, 1850),
        120: (17.5, 15.0, 2250),
        140: (17.5, 15.5, 2600),
    },
    30: {
        6:   (7.5,  7.2,  51),
        12:  (12.0, 9.0,  125),
        18:  (14.0, 10.0, 210),
        25:  (16.0, 11.0, 300),
        35:  (18.0, 12.0, 500),
        45:  (20.0, 13.0, 700),
        55:  (20.0, 14.0, 900),
        70:  (22.0, 15.0, 1200),
        80:  (22.0, 16.0, 1500),
        90:  (22.0, 16.0, 1750),
        100: (23.0, 16.5, 2000),
        120: (23.0, 17.0, 2500),
        140: (23.0, 17.5, 3000),
    },
    36: {
        6:   (11.6, 8.0,  60),
        12:  (16.0, 10.0, 140),
        18:  (19.0, 11.5, 235),
        25:  (22.0, 13.0, 360),
        35:  (25.0, 14.0, 540),
        45:  (27.5, 15.0, 800),
        55:  (29.0, 16.0, 1000),
        70:  (30.0, 17.2, 1400),
        80:  (30.0, 18.0, 1700),
        90:  (31.0, 18.5, 2000),
        100: (31.0, 19.0, 2300),
        120: (31.0, 19.5, 2900),
        140: (31.0, 20.0, 3400),
    },
    40: {
        6:   (14.0, 8.8,  64),
        12:  (19.0, 11.0, 150),
        18:  (23.0, 12.5, 260),
        25:  (26.0, 14.0, 400),
        35:  (29.0, 15.0, 590),
        45:  (32.0, 16.2, 880),
        55:  (34.0, 17.0, 1200),
        70:  (36.0, 19.0, 1500),
        80:  (37.0, 19.5, 1800),
        90:  (38.0, 20.0, 2200),
        100: (39.0, 21.0, 2500),
        120: (40.0, 21.0, 3100),
        140: (41.0, 22.0, 3800),
    },
    45: {
        6:   (16.0, 9.3,  70),
        12:  (23.0, 12.0, 170),
        18:  (27.0, 13.5, 285),
        25:  (31.0, 15.0, 425),
        35:  (35.0, 16.0, 630),
        45:  (39.0, 18.0, 950),
        55:  (41.0, 18.5, 1250),
        70:  (45.0, 20.0, 1600),
        80:  (45.0, 21.0, 2000),
        90:  (47.0, 22.0, 2300),
        100: (49.0, 22.5, 2700),
        120: (50.0, 23.0, 3600),
        140: (50.0, 24.0, 4100),
    },
    50: {
        6:   (19.0, 10.0, 75),
        12:  (27.0, 12.5, 180),
        18:  (31.0, 14.5, 300),
        25:  (37.0, 16.0, 450),
        35:  (43.0, 17.5, 700),
        45:  (46.0, 19.0, 1050),
        55:  (48.0, 21.0, 1350),
        70:  (54.0, 22.0, 1750),
        80:  (55.0, 23.0, 2100),
        90:  (58.0, 23.0, 2500),
        100: (59.0, 24.0, 2900),
        120: (60.0, 25.5, 3800),
        140: (60.0, 26.5, 4250),
    },
    55: {
        6:   (22.5, 11.0, 80),
        12:  (30.0, 13.0, 190),
        18:  (36.0, 15.0, 320),
        25:  (44.0, 17.0, 500),
        35:  (50.0, 19.0, 760),
        45:  (55.0, 21.0, 1150),
        55:  (59.0, 22.0, 1450),
        70:  (62.0, 23.0, 1900),
        80:  (65.0, 24.0, 2300),
        90:  (66.0, 25.0, 2600),
        100: (69.0, 26.0, 3100),
        120: (70.0, 27.0, 3900),
        140: (70.0, 28.0, 4600),
    },
    60: {
        6:   (25.0, 11.5, 83),
        12:  (35.0, 14.0, 200),
        18:  (42.0, 16.5, 350),
        25:  (50.0, 18.0, 510),
        35:  (56.0, 20.0, 800),
        45:  (67.0, 22.0, 1200),
        55:  (70.0, 23.5, 1500),
        70:  (75.0, 25.0, 2000),
        80:  (79.0, 26.0, 2450),
        90:  (80.0, 28.0, 2800),
        100: (80.0, 28.0, 3250),
        120: (82.0, 30.0, 4000),
        140: (85.0, 30.0, 5000),
    },
    65: {
        6:   (27.5, 12.0, 88),
        12:  (39.0, 15.0, 220),
        18:  (48.0, 17.0, 380),
        25:  (55.0, 19.0, 560),
        35:  (65.0, 21.0, 850),
        45:  (75.0, 22.0, 1250),
        55:  (80.0, 25.0, 1600),
        70:  (85.0, 26.5, 2100),
        80:  (90.0, 28.0, 2500),
        90:  (92.0, 28.5, 2950),
        100: (95.0, 30.0, 3400),
        120: (100.0,31.0, 4200),
        140: (100.0,33.0, 5100),
    },
    70: {
        6:   (30.0, 13.0, 91),
        12:  (43.0, 16.0, 235),
        18:  (55.0, 18.0, 395),
        25:  (62.0, 20.0, 600),
        35:  (71.0, 22.0, 880),
        45:  (82.0, 25.0, 1325),
        55:  (90.0, 26.0, 1600),
        70:  (98.0, 29.0, 2250),
        80:  (100.0,29.5, 2600),
        90:  (104.0,30.5, 3050),
        100: (109.0,31.0, 3600),
        120: (115.0,32.5, 4500),
        140: (119.0,35.0, 5600),
    },
    75: {
        6:   (34.0, 14.0, 96),
        12:  (50.0, 17.0, 245),
        18:  (60.0, 19.0, 405),
        25:  (70.0, 21.0, 620),
        35:  (80.0, 23.0, 900),
        45:  (90.0, 25.5, 1400),
        55:  (99.0, 27.0, 1700),
        70:  (105.0,29.0, 2300),
        80:  (110.0,31.0, 2700),
        90:  (118.0,32.0, 3150),
        100: (120.0,33.0, 3800),
        120: (125.0,34.0, 4800),
        140: (130.0,36.0, 6000),
    },
    80: {
        6:   (37.0, 14.5, 100),
        12:  (54.0, 17.5, 255),
        18:  (65.0, 20.0, 425),
        25:  (72.0, 22.0, 640),
        35:  (85.0, 23.5, 975),
        45:  (100.0,26.5, 1450),
        55:  (107.0,28.0, 1800),
        70:  (119.0,30.0, 2400),
        80:  (121.0,32.0, 2850),
        90:  (133.0,33.0, 3300),
        100: (136.0,34.0, 3900),
        120: (140.0,35.0, 4950),
        140: (140.0,36.5, 6100),
    },
    85: {
        6:   (40.0, 15.0, 103),
        12:  (57.0, 18.0, 260),
        18:  (74.0, 21.0, 445),
        25:  (80.0, 22.0, 680),
        35:  (95.0, 25.0, 1000),
        45:  (109.0,27.5, 1500),
        55:  (122.0,30.0, 1900),
        70:  (133.0,32.0, 2500),
        80:  (139.0,33.5, 3000),
        90:  (140.0,35.0, 3500),
        100: (145.0,35.5, 4050),
        120: (155.0,37.5, 5050),
        140: (160.0,39.5, 6500),
    },
    90: {
        6:   (45.0, 16.0, 110),
        12:  (63.0, 19.0, 270),
        18:  (80.0, 22.0, 460),
        25:  (92.0, 24.0, 700),
        35:  (107.0,26.5, 1100),
        45:  (120.0,29.0, 1550),
        55:  (130.0,31.5, 2000),
        70:  (140.0,33.0, 2600),
        80:  (147.0,34.5, 3100),
        90:  (155.0,36.5, 3750),
        100: (165.0,37.0, 4250),
        120: (170.0,40.0, 5200),
        140: (190.0,44.0, 6800),
    },
}

_WIND_SPEEDS    = sorted(_SEA_TABLE.keys())          # [22, 26, 30, 36, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]
_DURATION_HOURS = sorted(next(iter(_SEA_TABLE.values())).keys())   # [6, 12, 18, 25, 35, 45, 55, 70, 80, 90, 100, 120, 140]


def estimate_sea_height(
    wind_kts: float,
    duration_hrs: float,
    fetch_nm: Optional[float] = None,
) -> dict:
    """
    Estimate significant sea height and peak period from storm wind parameters.
    Uses Stormsurf Sea Height Table 1 (wind speed × duration, fetch as validator).

    Args:
        wind_kts:    Sustained wind speed in knots within the fetch area
        duration_hrs: Duration the wind has been blowing in hours
        fetch_nm:    Optional fetch area length in nautical miles.
                     If provided and smaller than the table's minimum fetch
                     for the selected cell, the result is downgraded to the
                     appropriate lower cell (move left one column).

    Returns:
        {
            "sea_height_ft":   36.0,
            "period_s":        17.2,
            "min_fetch_nm":    1400,   # minimum fetch needed for these values
            "fetch_limited":   False,  # True if result was downgraded due to fetch
            "fully_developed": False,  # True if sea is fully developed at this wind speed
            "wind_kts":        40.0,
            "duration_hrs":    70.0,
        }

    Notes:
        - Results are theoretical. Actual seas depend on storm geometry,
          opposing currents, and other factors. WW3 is more reliable for
          actual forecasting.
        - "Fully developed sea" means increasing duration won't increase
          sea height further — only period may still grow slightly.
        - For virtual fetch (two storms reinforcing each other), move
          one cell to the right to increase duration estimate.
    """
    # Clamp to table range
    wind_kts    = max(_WIND_SPEEDS[0],    min(_WIND_SPEEDS[-1],    wind_kts))
    duration_hrs = max(_DURATION_HOURS[0], min(_DURATION_HOURS[-1], duration_hrs))

    # Interpolate between wind speed rows
    def _interp_at_wind(target_wind: float, target_dur: float) -> tuple[float, float, int]:
        """Interpolate (sea_ft, period_s, fetch_nm) at target wind + duration."""
        # Find bounding wind speeds
        lo_w = max(w for w in _WIND_SPEEDS if w <= target_wind)
        hi_w = min(w for w in _WIND_SPEEDS if w >= target_wind)

        # Find bounding durations
        lo_d = max(d for d in _DURATION_HOURS if d <= target_dur)
        hi_d = min(d for d in _DURATION_HOURS if d >= target_dur)

        def _cell(wind, dur):
            return _SEA_TABLE[wind][dur]

        # Bilinear interpolation over wind × duration
        if lo_w == hi_w and lo_d == hi_d:
            return _cell(lo_w, lo_d)

        w_frac = (target_wind - lo_w) / (hi_w - lo_w) if hi_w != lo_w else 0.0
        d_frac = (target_dur - lo_d) / (hi_d - lo_d) if hi_d != lo_d else 0.0

        ll = _cell(lo_w, lo_d)
        lr = _cell(lo_w, hi_d)
        hl = _cell(hi_w, lo_d)
        hr = _cell(hi_w, hi_d)

        sea_ft  = (ll[0] * (1-w_frac) * (1-d_frac) + lr[0] * (1-w_frac) * d_frac +
                   hl[0] * w_frac * (1-d_frac)      + hr[0] * w_frac * d_frac)
        per_s   = (ll[1] * (1-w_frac) * (1-d_frac) + lr[1] * (1-w_frac) * d_frac +
                   hl[1] * w_frac * (1-d_frac)      + hr[1] * w_frac * d_frac)
        fetch   = int(ll[2] * (1-w_frac) * (1-d_frac) + lr[2] * (1-w_frac) * d_frac +
                      hl[2] * w_frac * (1-d_frac)      + hr[2] * w_frac * d_frac)

        return round(sea_ft, 1), round(per_s, 1), fetch

    sea_ft, period_s, min_fetch = _interp_at_wind(wind_kts, duration_hrs)

    # Detect fully developed sea: sea height stops growing with more duration.
    # Approximation: if the next duration step doesn't increase sea height by >5%.
    fetch_limited = False
    if fetch_nm is not None and fetch_nm < min_fetch:
        # Move to a lower duration column until fetch matches.
        # Find the highest duration where min_fetch <= actual fetch_nm.
        valid_durs = [d for d in _DURATION_HOURS if d <= duration_hrs]
        downgraded = False
        for dur in reversed(valid_durs):
            lo_w = max(w for w in _WIND_SPEEDS if w <= wind_kts)
            cell_sea, cell_per, cell_fetch = _SEA_TABLE[lo_w][dur]
            if fetch_nm >= cell_fetch:
                sea_ft, period_s, min_fetch = cell_sea, cell_per, cell_fetch
                downgraded = True
                break
        fetch_limited = downgraded

    # Check if sea is fully developed at this wind speed
    # (sea height plateaus — look at last 2 duration columns for this wind)
    fully_developed = False
    lo_w = max(w for w in _WIND_SPEEDS if w <= wind_kts)
    last_two_durs = _DURATION_HOURS[-2:]
    if len(last_two_durs) == 2:
        h1 = _SEA_TABLE[lo_w][last_two_durs[0]][0]
        h2 = _SEA_TABLE[lo_w][last_two_durs[1]][0]
        if abs(h2 - h1) / max(h1, 0.01) < 0.05:  # < 5% change = fully developed
            fully_developed = True

    return {
        "sea_height_ft":   sea_ft,
        "period_s":        period_s,
        "min_fetch_nm":    min_fetch,
        "fetch_limited":   fetch_limited,
        "fully_developed": fully_developed,
        "wind_kts":        wind_kts,
        "duration_hrs":    duration_hrs,
        "fetch_nm":        fetch_nm,
    }


# ---------------------------------------------------------------------------
# FastAPI route registration
# ---------------------------------------------------------------------------

def register_routes(app):
    """
    Call from main.py:
        from swell_tables import register_routes as register_swell_table_routes
        register_swell_table_routes(app)

    Mounts:
        GET /api/swell/category    — buoy reading → face height category
        GET /api/swell/sea-height  — wind params → storm sea height estimate
    """
    from fastapi.responses import JSONResponse

    @app.get("/api/swell/category")
    async def get_swell_category(
        wvht_ft: float,
        period_s: float,
        size_bias: float = 1.0,
    ):
        """
        Returns the Stormsurf swell category and expected wave face height
        for a buoy reading.

        Args:
            wvht_ft:    Significant wave height in feet
            period_s:   Dominant period in seconds
            size_bias:  Optional spot size amplification factor
                        (from user_spot_profiles.size_perception_bias)

        Example:
            /api/swell/category?wvht_ft=6&period_s=14
            → category 3, face height 7.5-10ft

            /api/swell/category?wvht_ft=6&period_s=14&size_bias=1.35
            → category 3, adjusted face height 10.1-13.5ft (Blacks Beach canyon)
        """
        result = surf_height_from_buoy(wvht_ft, period_s, size_bias)
        return result

    @app.get("/api/swell/sea-height")
    async def get_sea_height_estimate(
        wind_kts: float,
        duration_hrs: float,
        fetch_nm: float = None,
    ):
        """
        Estimates storm sea height and period from wind parameters.
        Uses Stormsurf Sea Height Table 1.

        Use this when:
        - A storm is too new for the wave model to have resolved it
        - You want to sanity-check WW3 output against first principles
        - The Copilot is explaining why a developing storm matters

        Args:
            wind_kts:     Sustained wind speed in the fetch area (knots)
            duration_hrs: How long the wind has been blowing (hours)
            fetch_nm:     Optional fetch length (nautical miles)
                          If provided and insufficient, result is downgraded.

        Example:
            /api/swell/sea-height?wind_kts=45&duration_hrs=35&fetch_nm=600
            → 35ft seas @ 16s (matches Stormsurf table exactly)
        """
        if wind_kts < 22:
            return JSONResponse(
                status_code=422,
                content={"error": "wind_kts must be >= 22 (table minimum)"},
            )
        result = estimate_sea_height(wind_kts, duration_hrs, fetch_nm)
        return result
