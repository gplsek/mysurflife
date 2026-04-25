from fastapi import APIRouter, Depends, HTTPException
from typing import Any, Dict, Optional
from datetime import datetime

router = APIRouter()

try:
    from routes.storms import load_storms_config, save_storms_config, _OCEAN_KEYS
except ImportError:
    load_storms_config = None
    save_storms_config = None
    _OCEAN_KEYS = []

try:
    from database import get_supabase_admin_client
except ImportError:
    get_supabase_admin_client = lambda: None

try:
    from auth import require_admin, _admin_cache
except ImportError:
    require_admin = None
    _admin_cache = {}


# ── AI Personas ───────────────────────────────────────────────────────────────

@router.get("/api/admin/personas")
async def list_personas(
    user: Dict = Depends(require_admin) if require_admin else None
):
    """List all AI personas (admin only)."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        return {"error": "Database not configured"}
    try:
        result = admin_client.table("ai_personas").select("*").order("name").execute()
        return {"success": True, "personas": result.data}
    except Exception as e:
        print(f"❌ Error listing personas: {e}")
        return {"error": str(e)}


@router.get("/api/admin/personas/{slug}")
async def get_persona(
    slug: str,
    user: Dict = Depends(require_admin) if require_admin else None
):
    """Get a specific persona by slug (admin only)."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        return {"error": "Database not configured"}
    try:
        result = admin_client.table("ai_personas").select("*").eq("slug", slug).single().execute()
        if not result.data:
            return {"error": f"Persona '{slug}' not found"}
        return {"success": True, "persona": result.data}
    except Exception as e:
        print(f"❌ Error fetching persona: {e}")
        return {"error": str(e)}


@router.put("/api/admin/personas/{slug}")
async def update_persona(
    slug: str,
    persona_data: Dict[str, Any],
    user: Dict = Depends(require_admin) if require_admin else None
):
    """Update a persona (admin only)."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        return {"error": "Database not configured"}

    allowed_fields = ["name", "description", "system_prompt", "model", "max_tokens", "temperature", "is_active"]
    update_data = {k: v for k, v in persona_data.items() if k in allowed_fields}
    if not update_data:
        return {"error": "No valid fields to update"}
    update_data["updated_at"] = datetime.utcnow().isoformat()

    try:
        result = admin_client.table("ai_personas").update(update_data).eq("slug", slug).execute()
        if not result.data:
            return {"error": f"Persona '{slug}' not found"}
        print(f"✅ Persona '{slug}' updated by {user.get('email', 'unknown')}")
        return {"success": True, "persona": result.data[0]}
    except Exception as e:
        print(f"❌ Error updating persona: {e}")
        return {"error": str(e)}


@router.post("/api/admin/personas")
async def create_persona(
    persona_data: Dict[str, Any],
    user: Dict = Depends(require_admin) if require_admin else None
):
    """Create a new persona (admin only)."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        return {"error": "Database not configured"}

    for field in ["slug", "name", "description", "system_prompt"]:
        if field not in persona_data:
            return {"error": f"Missing required field: {field}"}

    try:
        result = admin_client.table("ai_personas").insert(persona_data).execute()
        print(f"✅ Persona '{persona_data['slug']}' created by {user.get('email', 'unknown')}")
        return {"success": True, "persona": result.data[0]}
    except Exception as e:
        print(f"❌ Error creating persona: {e}")
        return {"error": str(e)}


# ── User Management ───────────────────────────────────────────────────────────

VALID_SKILL_LEVELS = {"beginner", "intermediate", "experienced", "expert"}


@router.get("/api/admin/users")
async def list_users(user: Dict = Depends(require_admin)):
    """List all users with roles and profiles (admin only)."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        users_response = admin_client.auth.admin.list_users()
        roles_response = admin_client.table("user_roles").select("*").execute()
        roles_map = {role["user_id"]: role for role in roles_response.data}

        try:
            profiles_response = admin_client.table("user_profiles").select("*").execute()
            profiles_map = {p["user_id"]: p for p in (profiles_response.data or [])}
        except Exception:
            profiles_map = {}

        users_with_roles = [
            {
                "id":             u.id,
                "email":          u.email,
                "created_at":     u.created_at,
                "last_sign_in_at": u.last_sign_in_at,
                "is_admin":       roles_map.get(u.id, {}).get("is_admin", False),
                "role_created_at": roles_map.get(u.id, {}).get("created_at"),
                "profile": profiles_map.get(u.id, {}),
            }
            for u in users_response
        ]
        print(f"📋 Listed {len(users_with_roles)} users for {user.get('email', 'unknown')}")
        return {"success": True, "users": users_with_roles}
    except Exception as e:
        print(f"❌ Error listing users: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/api/admin/users/{user_id}/profile")
async def update_user_profile(
    user_id: str,
    profile_data: Dict[str, Any],
    user: Dict = Depends(require_admin),
):
    """Upsert a user's profile (admin only)."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")

    skill = profile_data.get("skill_level")
    if skill and skill not in VALID_SKILL_LEVELS:
        raise HTTPException(status_code=400, detail=f"Invalid skill_level: {skill}")

    payload: Dict[str, Any] = {"user_id": user_id}
    for field in ("display_name", "skill_level", "home_spot_id", "home_spot_name"):
        if field in profile_data:
            val = profile_data[field]
            payload[field] = val.strip() if isinstance(val, str) else val

    try:
        admin_client.table("user_profiles").upsert(payload).execute()
        updated = admin_client.table("user_profiles").select("*").eq("user_id", user_id).execute()
        result = updated.data[0] if updated.data else payload
        print(f"✅ Profile updated for {user_id} by {user.get('email', 'unknown')}")
        return {"success": True, "profile": result}
    except Exception as e:
        print(f"❌ Error updating profile for {user_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/admin/users/invite")
async def invite_user(
    invite_data: Dict[str, Any],
    user: Dict = Depends(require_admin)
):
    """Invite a new user by email (admin only)."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")

    email = invite_data.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    make_admin = invite_data.get("is_admin", False)

    try:
        # invite_user_by_email sends the Supabase invite email and creates the account
        new_user = admin_client.auth.admin.invite_user_by_email(email)
        user_id = new_user.user.id
        # Upsert so re-inviting an existing email doesn't 409
        admin_client.table("user_roles").upsert({
            "user_id": user_id,
            "email": email,
            "is_admin": make_admin,
        }, on_conflict="user_id").execute()
        print(f"✅ Invite sent to '{email}' by {user.get('email', 'unknown')} (admin={make_admin})")
        return {"success": True, "user": {"id": user_id, "email": email, "is_admin": make_admin}}
    except Exception as e:
        print(f"❌ Error inviting user: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/api/admin/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    role_data: Dict[str, Any],
    user: Dict = Depends(require_admin)
):
    """Update a user's admin role (admin only)."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")

    make_admin = role_data.get("is_admin")
    if make_admin is None:
        raise HTTPException(status_code=400, detail="is_admin field is required")

    try:
        user_data = admin_client.auth.admin.get_user_by_id(user_id)
        user_email = user_data.user.email
        admin_client.table("user_roles").upsert({
            "user_id": user_id,
            "email": user_email,
            "is_admin": make_admin,
        }).execute()
        if user_id in _admin_cache:
            del _admin_cache[user_id]
        print(f"✅ User role updated: {user_id} ({user_email}) admin={make_admin} by {user.get('email', 'unknown')}")
        return {"success": True, "user_id": user_id, "is_admin": make_admin}
    except Exception as e:
        print(f"❌ Error updating user role: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/admin/users/{user_id}")
async def delete_user(
    user_id: str,
    user: Dict = Depends(require_admin)
):
    """Delete a user (admin only). Cannot delete yourself."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")

    if user_id == user.get("user_id"):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    try:
        admin_client.table("user_roles").delete().eq("user_id", user_id).execute()
        admin_client.auth.admin.delete_user(user_id)
        if user_id in _admin_cache:
            del _admin_cache[user_id]
        print(f"✅ User {user_id} deleted by {user.get('email', 'unknown')}")
        return {"success": True, "user_id": user_id}
    except Exception as e:
        print(f"❌ Error deleting user: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Storm Filter Config ───────────────────────────────────────────────────────

@router.get("/api/admin/storms/config")
async def get_storms_config(
    user: Dict = Depends(require_admin) if require_admin else None
):
    """Return current storm filter configuration (admin only)."""
    if not load_storms_config:
        raise HTTPException(status_code=500, detail="Storm config module unavailable")
    return {"success": True, "config": load_storms_config()}


@router.put("/api/admin/storms/config")
async def update_storms_config(
    body: Dict[str, Any],
    user: Dict = Depends(require_admin) if require_admin else None
):
    """Update storm filter configuration (admin only). Persisted to disk."""
    if not load_storms_config or not save_storms_config:
        raise HTTPException(status_code=500, detail="Storm config module unavailable")

    current = load_storms_config()

    allowed = {"min_pressure_mb", "min_wind_kts", "include_highs", "oceans"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail=f"No valid fields. Allowed: {sorted(allowed)}")

    # Validate
    if "min_pressure_mb" in updates:
        v = int(updates["min_pressure_mb"])
        if not (900 <= v <= 1040):
            raise HTTPException(status_code=400, detail="min_pressure_mb must be 900–1040")
        updates["min_pressure_mb"] = v

    if "min_wind_kts" in updates:
        v = int(updates["min_wind_kts"])
        if not (0 <= v <= 120):
            raise HTTPException(status_code=400, detail="min_wind_kts must be 0–120")
        updates["min_wind_kts"] = v

    if "oceans" in updates:
        bad = [o for o in updates["oceans"] if o not in _OCEAN_KEYS]
        if bad:
            raise HTTPException(status_code=400, detail=f"Unknown oceans: {bad}. Valid: {_OCEAN_KEYS}")

    current.update(updates)
    save_storms_config(current)
    email = user.get("email", "unknown") if user else "unknown"
    print(f"✅ Storm config updated by {email}: {updates}")
    return {"success": True, "config": current}
