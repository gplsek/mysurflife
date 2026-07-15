-- Phase B (storm-intelligence plan): surf relevance flag on derived storms.
-- True when track-aware region scoring finds at least one non-miss impact.
-- Drives map de-emphasis of noise lows and gates LLM analysis generation.
alter table derived_storms add column if not exists surf_relevant boolean not null default false;

comment on column derived_storms.surf_relevant is
  'Track-aware region scoring found at least one non-miss impact; false = threshold low, not a swell producer';
