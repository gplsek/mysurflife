-- Migration: Access requests — public "request access" queue managed by admins.
-- Requests are created by the public endpoint POST /api/access-requests and
-- approved/declined from the Manage Users admin screen. All approved invites
-- get the default plan ('free') for now.

CREATE TABLE IF NOT EXISTS public.access_requests (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text        NOT NULL,
    name        text,
    note        text,       -- optional message from the requester
    plan        text        NOT NULL DEFAULT 'free',      -- plan granted on approval
    status      text        NOT NULL DEFAULT 'pending',   -- pending | invited | declined
    handled_by  text,       -- admin email that approved/declined
    handled_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- One request per email address (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_email
    ON public.access_requests (lower(email));

CREATE INDEX IF NOT EXISTS idx_access_requests_status
    ON public.access_requests (status);

-- RLS on with no policies: only the backend's service-role client (which
-- bypasses RLS) reads or writes this table.
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
