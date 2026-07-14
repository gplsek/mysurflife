"""
Test script to verify AI spot analysis table exists in Supabase.
Run: python test_migration.py
"""

import pytest
from database import supabase


def test_migration():
    """Test if ai_spot_analysis table exists and is accessible."""

    if not supabase:
        pytest.skip("Supabase not configured. Check .env file.")

    # Query the table (raises if it doesn't exist)
    result = supabase.table("ai_spot_analysis") \
        .select("*") \
        .limit(1) \
        .execute()

    print("✅ Migration successful!")
    print(f"✅ Table 'ai_spot_analysis' exists and is accessible")
    print(f"✅ Current row count: {len(result.data)}")

    if len(result.data) == 0:
        print("✅ Table is empty (expected for new migration)")
    else:
        print(f"✅ Found {len(result.data)} existing analyses")


if __name__ == "__main__":
    test_migration()
