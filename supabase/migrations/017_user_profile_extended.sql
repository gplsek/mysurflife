-- Add stance and years_surfing to user_profiles for the profile drawer
-- Safe to re-run.

alter table public.user_profiles
  add column if not exists stance text check (stance in ('regular', 'goofy')),
  add column if not exists years_surfing integer check (years_surfing >= 0 and years_surfing <= 80);
