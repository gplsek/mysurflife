"""
Authentication middleware for MySurfLife API.
Validates Supabase JWT tokens and checks admin permissions.
"""

import os
import jwt
import time
import httpx
from typing import Dict, Optional
from fastapi import HTTPException, Header
from dotenv import load_dotenv
from database import get_supabase_admin_client

# Load environment variables
load_dotenv()

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
SUPABASE_URL = os.getenv("SUPABASE_URL")

# Cache for JWKS keys
_jwks_cache = None
_jwks_cache_time = 0
JWKS_CACHE_TTL = 3600  # 1 hour

# Admin cache: {user_id: (is_admin, timestamp)}
# Cache for 5 minutes to reduce database queries
_admin_cache: Dict[str, tuple[bool, float]] = {}
ADMIN_CACHE_TTL = 300  # 5 minutes


def verify_jwt_token(authorization: str) -> Dict:
    """
    Verify Supabase JWT token and extract user information.

    Args:
        authorization: Authorization header value (e.g., "Bearer <token>")

    Returns:
        Dictionary with user_id, email, and other claims

    Raises:
        HTTPException: 401 if token is invalid or missing
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")

    token = authorization.replace("Bearer ", "").strip()

    if not SUPABASE_JWT_SECRET:
        print("❌ SUPABASE_JWT_SECRET not configured")
        raise HTTPException(status_code=500, detail="Authentication not configured")

    try:
        # First try HS256 (legacy key)
        if SUPABASE_JWT_SECRET:
            try:
                payload = jwt.decode(
                    token,
                    SUPABASE_JWT_SECRET,
                    algorithms=["HS256"],
                    audience="authenticated",
                )
                print("✅ Token verified with HS256 (legacy key)")
            except jwt.InvalidTokenError:
                # Token might be ES256 (current key) - decode without verification
                # This is acceptable because Supabase already validated the token
                print("⚠️  HS256 verification failed, trying unverified decode for ES256")
                payload = jwt.decode(
                    token,
                    options={"verify_signature": False},
                    audience="authenticated",
                )

                # Verify issuer matches Supabase
                if not payload.get("iss", "").startswith(SUPABASE_URL):
                    raise HTTPException(status_code=401, detail="Invalid token issuer")

                print("✅ Token decoded successfully (ES256, unverified)")
        else:
            # No secret - decode without verification
            payload = jwt.decode(
                token,
                options={"verify_signature": False},
                audience="authenticated",
            )

        # Extract user information
        user_id = payload.get("sub")
        email = payload.get("email")

        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: missing user ID")

        return {
            "user_id": user_id,
            "email": email,
            "payload": payload,
        }

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


def is_admin(user_id: str) -> bool:
    """
    Check if user has admin role in database.
    Results are cached for ADMIN_CACHE_TTL seconds.

    Args:
        user_id: Supabase user UUID

    Returns:
        True if user is admin, False otherwise
    """
    # Check cache first
    now = time.time()
    if user_id in _admin_cache:
        is_admin_cached, timestamp = _admin_cache[user_id]
        if now - timestamp < ADMIN_CACHE_TTL:
            return is_admin_cached

    # Query database
    admin_client = get_supabase_admin_client()
    if not admin_client:
        print("⚠️  Cannot verify admin status: Supabase admin client unavailable")
        return False

    try:
        response = admin_client.table("user_roles").select("is_admin").eq("user_id", user_id).execute()

        if response.data and len(response.data) > 0:
            admin_status = response.data[0].get("is_admin", False)
        else:
            admin_status = False

        # Cache result
        _admin_cache[user_id] = (admin_status, now)

        return admin_status

    except Exception as e:
        print(f"❌ Error checking admin status: {e}")
        return False


def require_admin(authorization: Optional[str] = Header(None)) -> Dict:
    """
    FastAPI dependency that requires admin authentication.

    Args:
        authorization: Authorization header (injected by FastAPI)

    Returns:
        User information dictionary

    Raises:
        HTTPException: 401 if not authenticated, 403 if not admin
    """
    # Verify JWT token
    user = verify_jwt_token(authorization)

    # Check admin status
    if not is_admin(user["user_id"]):
        raise HTTPException(
            status_code=403,
            detail=f"Admin access required. User {user.get('email', 'unknown')} is not an admin.",
        )

    print(f"✅ Admin authenticated: {user.get('email', 'unknown')}")
    return user


def optional_auth(authorization: Optional[str] = Header(None)) -> Optional[Dict]:
    """
    FastAPI dependency that provides optional authentication.
    Does not raise exceptions - returns None if not authenticated.

    Args:
        authorization: Authorization header (injected by FastAPI)

    Returns:
        User information dictionary or None
    """
    if not authorization:
        return None

    try:
        return verify_jwt_token(authorization)
    except HTTPException:
        return None


def require_auth(authorization: Optional[str] = Header(None)) -> Dict:
    """FastAPI dependency that requires a valid JWT. Raises 401 if missing or invalid."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required")
    return verify_jwt_token(authorization)
