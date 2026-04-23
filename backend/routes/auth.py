from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Optional

router = APIRouter()

try:
    from auth import optional_auth, is_admin as _is_admin_check
except ImportError:
    optional_auth = None
    _is_admin_check = None

try:
    from database import get_supabase_admin_client
except ImportError:
    get_supabase_admin_client = lambda: None


@router.get("/api/auth/check-admin")
async def check_admin_status(
    user: Optional[Dict] = Depends(optional_auth) if optional_auth else None
):
    """Check if the current user has admin privileges."""
    if not user:
        return {"is_admin": False, "authenticated": False}

    user_id = user.get("user_id")
    email = user.get("email")
    admin_status = _is_admin_check(user_id) if _is_admin_check else False

    return {
        "is_admin": admin_status,
        "authenticated": True,
        "user_id": user_id,
        "email": email,
    }


@router.get("/api/user/profile")
async def get_own_profile(
    user: Optional[Dict] = Depends(optional_auth) if optional_auth else None
):
    """Return the current user's profile (skill level, home break, display name)."""
    if not user:
        return {"profile": {}}

    user_id = user.get("user_id")
    admin_client = get_supabase_admin_client()
    if not admin_client:
        return {"profile": {}}

    try:
        result = admin_client.table("user_profiles").select("*").eq("user_id", user_id).execute()
        profile = result.data[0] if result.data else {}
        return {"profile": profile}
    except Exception as e:
        print(f"❌ Error fetching profile for {user_id}: {e}")
        return {"profile": {}}
