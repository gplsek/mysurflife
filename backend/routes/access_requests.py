"""Access requests — public request-access queue + admin approve/decline.

Public:  POST /api/access-requests                      (rate-limited, no auth)
Admin:   GET  /api/admin/access-requests                (list, filter by status)
         POST /api/admin/access-requests/{id}/approve   (sends Supabase invite)
         POST /api/admin/access-requests/{id}/decline
"""

import re
import time
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request

router = APIRouter()

try:
    from database import get_supabase_admin_client
except ImportError:
    get_supabase_admin_client = lambda: None

try:
    from auth import require_admin
except ImportError:
    require_admin = None

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DEFAULT_PLAN = "free"  # all invites get the default plan for now

# Per-IP rate limit for the public endpoint (per-worker, best-effort)
_RATE_WINDOW_S = 3600
_RATE_MAX = 5
_rate_hits: Dict[str, list] = {}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _rate_hits.get(ip, []) if now - t < _RATE_WINDOW_S]
    if len(hits) >= _RATE_MAX:
        _rate_hits[ip] = hits
        return True
    hits.append(now)
    _rate_hits[ip] = hits
    return False


# ── Public ────────────────────────────────────────────────────────────────────

@router.post("/api/access-requests")
async def create_access_request(body: Dict[str, Any], request: Request):
    """Public endpoint: submit a request for an invite."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")

    email = (body.get("email") or "").strip().lower()
    name = (body.get("name") or "").strip()[:120]
    note = (body.get("note") or "").strip()[:1000]

    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="A valid email is required")

    ip = _client_ip(request)
    if _rate_limited(ip):
        raise HTTPException(status_code=429, detail="Too many requests — try again later")

    try:
        existing = (
            admin_client.table("access_requests")
            .select("id, status")
            .eq("email", email)
            .execute()
        )
        if existing.data:
            # Refresh name/note on a repeat submission but keep the status —
            # declines stick, pending stays pending. Response is the same
            # either way so emails can't be enumerated.
            admin_client.table("access_requests").update(
                {"name": name or None, "note": note or None}
            ).eq("id", existing.data[0]["id"]).execute()
        else:
            admin_client.table("access_requests").insert({
                "email": email,
                "name": name or None,
                "note": note or None,
                "plan": DEFAULT_PLAN,
            }).execute()
        print(f"📥 Access request from '{email}' (ip {ip})")
        return {"success": True}
    except Exception as e:
        print(f"❌ Error saving access request for '{email}': {e}")
        raise HTTPException(status_code=500, detail="Could not save request")


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.get("/api/admin/access-requests")
async def list_access_requests(
    status: str = "pending",
    user: Dict = Depends(require_admin),
):
    """List access requests (admin only). status=pending|invited|declined|all."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        query = admin_client.table("access_requests").select("*").order("created_at", desc=True)
        if status != "all":
            query = query.eq("status", status)
        result = query.execute()
        return {"success": True, "requests": result.data or []}
    except Exception as e:
        print(f"❌ Error listing access requests: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _get_request_or_404(admin_client, request_id: str) -> Dict[str, Any]:
    result = admin_client.table("access_requests").select("*").eq("id", request_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Access request not found")
    return result.data[0]


@router.post("/api/admin/access-requests/{request_id}/approve")
async def approve_access_request(request_id: str, user: Dict = Depends(require_admin)):
    """Approve a request: send the Supabase invite on the default plan."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")

    req = _get_request_or_404(admin_client, request_id)
    if req["status"] == "invited":
        raise HTTPException(status_code=400, detail="Request already approved")

    email = req["email"]
    try:
        new_user = admin_client.auth.admin.invite_user_by_email(email)
        user_id = new_user.user.id
        admin_client.table("user_roles").upsert({
            "user_id": user_id,
            "email": email,
            "is_admin": False,
        }, on_conflict="user_id").execute()
        if req.get("name"):
            admin_client.table("user_profiles").upsert({
                "user_id": user_id,
                "display_name": req["name"],
            }).execute()
        admin_client.table("access_requests").update({
            "status": "invited",
            "handled_by": user.get("email"),
            "handled_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", request_id).execute()
        print(f"✅ Access request approved: '{email}' (plan={req.get('plan', DEFAULT_PLAN)}) by {user.get('email', 'unknown')}")
        return {"success": True, "user": {"id": user_id, "email": email}}
    except Exception as e:
        print(f"❌ Error approving access request for '{email}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/admin/access-requests/{request_id}/decline")
async def decline_access_request(request_id: str, user: Dict = Depends(require_admin)):
    """Decline a request (admin only). No email is sent."""
    admin_client = get_supabase_admin_client()
    if not admin_client:
        raise HTTPException(status_code=500, detail="Database not configured")

    req = _get_request_or_404(admin_client, request_id)
    if req["status"] == "invited":
        raise HTTPException(status_code=400, detail="Request already approved")

    try:
        admin_client.table("access_requests").update({
            "status": "declined",
            "handled_by": user.get("email"),
            "handled_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", request_id).execute()
        print(f"🚫 Access request declined: '{req['email']}' by {user.get('email', 'unknown')}")
        return {"success": True}
    except Exception as e:
        print(f"❌ Error declining access request: {e}")
        raise HTTPException(status_code=500, detail=str(e))
