-- Migration: Per-user surf condition alerts
-- Stores alert rules that the AI evaluates against live conditions.

CREATE TABLE IF NOT EXISTS public.user_alerts (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    spot_id         text        NOT NULL,   -- spot slug
    spot_name       text,
    condition_text  text        NOT NULL,   -- human-readable rule, e.g. "Swell > 4ft @ 10s+"
    channel         text        NOT NULL DEFAULT 'push',  -- push | email | sms
    active          boolean     NOT NULL DEFAULT true,
    ai_generated    boolean     NOT NULL DEFAULT false,
    last_triggered  timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_user_id ON public.user_alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_user_alerts_spot_id ON public.user_alerts (spot_id);

ALTER TABLE public.user_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own alerts" ON public.user_alerts;
CREATE POLICY "Users manage own alerts"
    ON public.user_alerts
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
