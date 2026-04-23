-- User profiles table: stores per-user settings (skill level, home break, display name)
-- Apply with: supabase db push  OR  paste into Supabase SQL editor
-- Safe to re-run: uses IF NOT EXISTS and DROP POLICY IF EXISTS guards.

create table if not exists public.user_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  display_name   text,
  skill_level    text check (skill_level in ('beginner', 'intermediate', 'experienced', 'expert')),
  home_spot_id   text,
  home_spot_name text,
  updated_at     timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;

drop policy if exists "users_own_profile_select" on public.user_profiles;
create policy "users_own_profile_select" on public.user_profiles
  for select using (auth.uid() = user_id);

drop policy if exists "users_own_profile_upsert" on public.user_profiles;
create policy "users_own_profile_upsert" on public.user_profiles
  for all using (auth.uid() = user_id);

comment on table public.user_profiles is
  'Optional per-user settings: skill level, home break, display name.';
