from fastapi import APIRouter, Depends
from typing import Dict, Optional

router = APIRouter()

try:
    from auth import optional_auth, is_admin as _is_admin_check
except ImportError:
    optional_auth = None
    _is_admin_check = None


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
