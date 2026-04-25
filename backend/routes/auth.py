from fastapi import APIRouter, Depends, HTTPException
from typing import Any, Dict, Optional

router = APIRouter()

try:
    from auth import optional_auth, require_auth, is_admin as _is_admin_check
except ImportError:
    optional_auth = None
    require_auth = None
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


VALID_SKILL_LEVELS = {"beginner", "intermediate", "experienced", "expert"}
VALID_STANCES = {"regular", "goofy"}


@router.put("/api/user/profile")
async def update_own_profile(
    profile_data: Dict[str, Any],
    user: Optional[Dict] = Depends(require_auth) if require_auth else None,
):
    """Update the current user's own profile."""
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = user.get("user_id")
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")

    skill = profile_data.get("skill_level")
    if skill and skill not in VALID_SKILL_LEVELS:
        raise HTTPException(status_code=400, detail=f"Invalid skill_level: {skill}")

    stance = profile_data.get("stance")
    if stance and stance not in VALID_STANCES:
        raise HTTPException(status_code=400, detail=f"Invalid stance: {stance}")

    payload: Dict[str, Any] = {"user_id": user_id}
    for field in ("display_name", "skill_level", "home_spot_id", "home_spot_name", "stance", "years_surfing"):
        if field in profile_data:
            val = profile_data[field]
            payload[field] = val.strip() if isinstance(val, str) else val

    # Fields that require a schema migration — dropped gracefully if the column doesn't exist yet
    _migration_fields = {"stance", "years_surfing"}

    def _do_upsert(p: Dict[str, Any]) -> None:
        admin_client.table("user_profiles").upsert(p).execute()

    try:
        _do_upsert(payload)
    except Exception as e:
        err_str = str(e)
        # PostgREST PGRST204: column not found in schema cache → strip unrecognised columns and retry
        if "PGRST204" in err_str or "column" in err_str.lower():
            fallback = {k: v for k, v in payload.items() if k not in _migration_fields}
            print(f"⚠️  Schema fallback for {user_id}: dropping {_migration_fields & set(payload)} — run migration 017")
            try:
                _do_upsert(fallback)
            except Exception as e2:
                print(f"❌ Error updating own profile for {user_id}: {e2}")
                raise HTTPException(status_code=500, detail=str(e2))
        else:
            print(f"❌ Error updating own profile for {user_id}: {e}")
            raise HTTPException(status_code=500, detail=err_str)

    try:
        updated = admin_client.table("user_profiles").select("*").eq("user_id", user_id).execute()
        result = updated.data[0] if updated.data else payload
    except Exception:
        result = payload
    print(f"✅ Profile self-updated for {user_id}")
    return {"profile": result}
