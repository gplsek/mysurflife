-- User-created private spots: only visible to the owning user.
-- Sharing (is_shared = true) is schema-ready but not yet exposed in the app.
-- Apply: paste into Supabase SQL editor or supabase db push

CREATE TABLE IF NOT EXISTS public.user_spots (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name         text        NOT NULL,
    latitude     double precision NOT NULL,
    longitude    double precision NOT NULL,
    break_type   text,       -- beach | reef | point | river_mouth | jetty | mixed
    description  text,
    is_shared    boolean     NOT NULL DEFAULT false,  -- future: share with other users
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_spots_user_id ON public.user_spots (user_id);

-- RLS: owners see/edit their own spots; shared spots visible to all authenticated users
ALTER TABLE public.user_spots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_spots_owner_all" ON public.user_spots
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "user_spots_shared_read" ON public.user_spots
    FOR SELECT USING (is_shared = true AND auth.role() = 'authenticated');

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER user_spots_updated_at
    BEFORE UPDATE ON public.user_spots
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.user_spots IS
    'User-created custom spots. Private by default (is_shared=false). Sharing not yet exposed in UI.';
