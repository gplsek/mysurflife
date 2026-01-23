#!/usr/bin/env python3
"""
Unit tests for utility functions in main.py
Tests json_sanitize, bounds parsing, and timestamp generation.
"""
import pytest
import math
import numpy as np
from datetime import datetime, timedelta
from typing import Tuple

# Import functions from main.py
# Note: Tests should be run from the backend directory with venv activated:
#   source venv/bin/activate
#   pytest test_utils.py -v
import sys
from pathlib import Path

# Add parent directory to path to import main
sys.path.insert(0, str(Path(__file__).parent))

try:
    from main import json_sanitize, _parse_and_validate_bounds, _times_utc_for_run
except ImportError as e:
    pytest.skip(f"Could not import from main.py: {e}. Make sure to run tests with venv activated.", allow_module_level=True)


class TestJsonSanitize:
    """Test json_sanitize function for NaN/Inf handling."""
    
    def test_sanitize_nan(self):
        """Test that NaN is converted to None."""
        assert json_sanitize(float('nan')) is None
        assert json_sanitize(float('-nan')) is None
    
    def test_sanitize_inf(self):
        """Test that Inf is converted to None."""
        assert json_sanitize(float('inf')) is None
        assert json_sanitize(float('-inf')) is None
    
    def test_sanitize_valid_float(self):
        """Test that valid floats pass through."""
        assert json_sanitize(3.14) == 3.14
        assert json_sanitize(-42.0) == -42.0
        assert json_sanitize(0.0) == 0.0
    
    def test_sanitize_list_with_nan(self):
        """Test that lists with NaN are sanitized."""
        result = json_sanitize([1, float('nan'), 3, float('inf')])
        assert result == [1, None, 3, None]
    
    def test_sanitize_dict_with_nan(self):
        """Test that dicts with NaN are sanitized."""
        result = json_sanitize({
            'valid': 42.0,
            'nan_val': float('nan'),
            'inf_val': float('inf'),
            'nested': {
                'deep_nan': float('nan')
            }
        })
        assert result == {
            'valid': 42.0,
            'nan_val': None,
            'inf_val': None,
            'nested': {
                'deep_nan': None
            }
        }
    
    def test_sanitize_numpy_types(self):
        """Test that numpy types are converted properly."""
        assert json_sanitize(np.float64(1.5)) == 1.5
        assert json_sanitize(np.int32(42)) == 42
        assert json_sanitize(np.float64(float('nan'))) is None
        assert json_sanitize(np.float64(float('inf'))) is None
    
    def test_sanitize_numpy_array(self):
        """Test that numpy arrays are handled."""
        arr = np.array([1.0, float('nan'), 3.0])
        result = json_sanitize(arr.tolist())  # Convert to list first
        assert result == [1.0, None, 3.0]
    
    def test_sanitize_primitive_types(self):
        """Test that primitive types pass through."""
        assert json_sanitize(42) == 42
        assert json_sanitize("hello") == "hello"
        assert json_sanitize(True) is True
        assert json_sanitize(None) is None
    
    def test_sanitize_datetime(self):
        """Test that datetime objects are converted to ISO format."""
        dt = datetime(2025, 12, 17, 12, 0, 0)
        result = json_sanitize(dt)
        assert result == "2025-12-17T12:00:00Z" or result.endswith("Z")


class TestBoundsParsing:
    """Test _parse_and_validate_bounds function."""
    
    def test_valid_bounds(self):
        """Test parsing valid bounds."""
        result = _parse_and_validate_bounds("30.0,-130.0,42.0,-117.0")
        assert result == (30.0, -130.0, 42.0, -117.0)
    
    def test_valid_global_bounds(self):
        """Test parsing global bounds."""
        result = _parse_and_validate_bounds("-90.0,-180.0,90.0,180.0")
        assert result == (-90.0, -180.0, 90.0, 180.0)
    
    def test_invalid_too_few_values(self):
        """Test that too few values raise ValueError."""
        with pytest.raises(ValueError, match="Expected 4 comma-separated values"):
            _parse_and_validate_bounds("30.0,-130.0,42.0")
    
    def test_invalid_too_many_values(self):
        """Test that too many values raise ValueError."""
        with pytest.raises(ValueError, match="Expected 4 comma-separated values"):
            _parse_and_validate_bounds("30.0,-130.0,42.0,-117.0,50.0")
    
    def test_invalid_latitude_out_of_range_high(self):
        """Test that latitude > 90 raises ValueError."""
        with pytest.raises(ValueError, match="Latitude must be between -90 and 90"):
            _parse_and_validate_bounds("91.0,-130.0,42.0,-117.0")
    
    def test_invalid_latitude_out_of_range_low(self):
        """Test that latitude < -90 raises ValueError."""
        with pytest.raises(ValueError, match="Latitude must be between -90 and 90"):
            _parse_and_validate_bounds("-91.0,-130.0,42.0,-117.0")
    
    def test_invalid_longitude_out_of_range_high(self):
        """Test that longitude > 180 raises ValueError."""
        with pytest.raises(ValueError, match="Longitude must be between -180 and 180"):
            _parse_and_validate_bounds("30.0,181.0,42.0,-117.0")
    
    def test_invalid_longitude_out_of_range_low(self):
        """Test that longitude < -180 raises ValueError."""
        with pytest.raises(ValueError, match="Longitude must be between -180 and 180"):
            _parse_and_validate_bounds("30.0,-181.0,42.0,-117.0")
    
    def test_invalid_min_lat_greater_than_max_lat(self):
        """Test that min_lat >= max_lat raises ValueError."""
        with pytest.raises(ValueError, match="min_lat.*must be less than max_lat"):
            _parse_and_validate_bounds("42.0,-130.0,30.0,-117.0")
    
    def test_invalid_min_lon_greater_than_max_lon(self):
        """Test that min_lon >= max_lon raises ValueError."""
        with pytest.raises(ValueError, match="min_lon.*must be less than max_lon"):
            _parse_and_validate_bounds("30.0,-117.0,42.0,-130.0")
    
    def test_invalid_non_numeric(self):
        """Test that non-numeric values raise ValueError."""
        with pytest.raises(ValueError):
            _parse_and_validate_bounds("abc,-130.0,42.0,-117.0")
    
    def test_invalid_empty_string(self):
        """Test that empty string raises ValueError."""
        with pytest.raises(ValueError):
            _parse_and_validate_bounds("")
    
    def test_invalid_wrong_separator(self):
        """Test that wrong separator raises ValueError."""
        with pytest.raises(ValueError):
            _parse_and_validate_bounds("30.0;-130.0;42.0;-117.0")


class TestTimestampGeneration:
    """Test _times_utc_for_run function."""
    
    def test_times_utc_basic(self):
        """Test basic timestamp generation."""
        run = "2025-12-17T00:00:00Z"
        hours = (0, 3, 6, 12)
        times = _times_utc_for_run(run, hours)
        
        assert len(times) == 4
        assert times[0] == "2025-12-17T00:00:00Z"
        assert times[1] == "2025-12-17T03:00:00Z"
        assert times[2] == "2025-12-17T06:00:00Z"
        assert times[3] == "2025-12-17T12:00:00Z"
    
    def test_times_utc_crosses_midnight(self):
        """Test timestamp generation that crosses midnight."""
        run = "2025-12-17T23:00:00Z"
        hours = (0, 1, 2)
        times = _times_utc_for_run(run, hours)
        
        assert times[0] == "2025-12-17T23:00:00Z"
        assert times[1] == "2025-12-18T00:00:00Z"
        assert times[2] == "2025-12-18T01:00:00Z"
    
    def test_times_utc_crosses_month(self):
        """Test timestamp generation that crosses month boundary."""
        run = "2025-12-31T22:00:00Z"
        hours = (0, 2, 4)
        times = _times_utc_for_run(run, hours)
        
        assert times[0] == "2025-12-31T22:00:00Z"
        assert times[1] == "2026-01-01T00:00:00Z"
        assert times[2] == "2026-01-01T02:00:00Z"
    
    def test_times_utc_empty_hours(self):
        """Test with empty hours tuple."""
        run = "2025-12-17T00:00:00Z"
        hours = ()
        times = _times_utc_for_run(run, hours)
        
        assert times == []
    
    def test_times_utc_large_hours(self):
        """Test with large forecast hours."""
        run = "2025-12-17T00:00:00Z"
        hours = (0, 24, 48, 72, 168)  # 0, 1 day, 2 days, 3 days, 1 week
        times = _times_utc_for_run(run, hours)
        
        assert len(times) == 5
        assert times[0] == "2025-12-17T00:00:00Z"
        assert times[1] == "2025-12-18T00:00:00Z"
        assert times[2] == "2025-12-19T00:00:00Z"
        assert times[3] == "2025-12-20T00:00:00Z"
        assert times[4] == "2025-12-24T00:00:00Z"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

