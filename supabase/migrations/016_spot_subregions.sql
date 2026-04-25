-- Migration 012: spot subregions
-- Adds subregion_key column to spots and creates subregions lookup table.
-- storm_arrivals.py uses text-match fallback if subregion_key is null —
-- this migration makes the mapping explicit and queryable.

-- ── Subregions table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subregions (
    key            text PRIMARY KEY,
    label          text NOT NULL,
    parent_region  text NOT NULL,
    centroid_lat   numeric(6,3),
    centroid_lon   numeric(7,3),
    display_order  smallint DEFAULT 100
);

-- Seed canonical surf subregions
INSERT INTO public.subregions (key, label, parent_region, centroid_lat, centroid_lon, display_order) VALUES
  ('socal',        'Southern California',  'California',        33.7,   -118.5,   10),
  ('cencal',       'Central California',   'California',        35.5,   -121.0,   20),
  ('norcal',       'Northern California',  'California',        38.5,   -123.5,   30),
  ('pnw',          'Pacific Northwest',    'Washington/Oregon', 47.5,   -124.5,   40),
  ('hawaii_north', 'North Shore Oahu',     'Hawaii',            21.7,   -158.0,   50),
  ('hawaii_south', 'South Shore Oahu',     'Hawaii',            21.2,   -157.9,   60),
  ('baja',         'Baja California',      'Mexico',            29.0,   -115.0,   70),
  ('mainland_mx',  'Mainland Mexico',      'Mexico',            15.5,    -92.0,   80),
  ('oaxaca',       'Oaxaca',              'Mexico',            15.7,    -96.5,   90),
  ('c_america',    'Central America',      'Central America',   10.0,    -85.0,  100),
  ('peru',         'Peru',                'South America',    -12.0,    -77.0,  110),
  ('chile_n',      'Northern Chile',       'South America',   -23.0,    -70.5,  120),
  ('chile_c',      'Central Chile',        'South America',   -33.5,    -71.5,  130),
  ('brazil_ne',    'Northeast Brazil',     'Brazil',            -5.0,    -35.0,  140),
  ('brazil_s',     'Southern Brazil',      'Brazil',           -27.0,    -48.5,  150),
  ('us_east_mid',  'Mid-Atlantic',         'US East Coast',    35.0,    -75.5,  160),
  ('us_east_ne',   'New England',          'US East Coast',    41.5,    -70.5,  170),
  ('oahu_north',   'North Shore Oahu',     'Hawaii',            21.7,   -158.0,  180),
  ('oahu_south',   'South Shore Oahu',     'Hawaii',            21.2,   -157.9,  190),
  ('maui',         'Maui',                'Hawaii',            20.8,   -156.3,  200),
  ('kauai',        'Kauai',               'Hawaii',            22.1,   -159.5,  210),
  ('big_island',   'Big Island',          'Hawaii',            19.7,   -155.5,  220),
  ('bali',         'Bali',                'Indonesia',         -8.7,    115.2,  230),
  ('java',         'Java',                'Indonesia',         -7.7,    109.0,  240),
  ('sumbawa',      'Sumbawa',             'Indonesia',         -8.7,    117.5,  250),
  ('mentawais',    'Mentawais',           'Indonesia',         -2.0,     99.5,  260),
  ('aus_east',     'Gold Coast',          'Australia',        -28.0,    153.5,  270),
  ('aus_west',     'Margaret River',      'Australia',        -33.9,    114.9,  280),
  ('nz_north',     'North Island NZ',     'New Zealand',      -37.0,    174.8,  290),
  ('nz_south',     'South Island NZ',     'New Zealand',      -43.5,    172.5,  300),
  ('ireland',      'West Ireland',        'Europe',           53.5,      -9.5,  310),
  ('cape_town',    'Cape Town',           'South Africa',    -34.0,      18.5,  320),
  ('japan_pac',    'Pacific Coast Japan', 'Japan',            35.5,     136.5,  330)
ON CONFLICT (key) DO NOTHING;

-- ── Spots: add subregion_key column ──────────────────────────────────────────

ALTER TABLE public.spots
    ADD COLUMN IF NOT EXISTS subregion_key text REFERENCES public.subregions(key);

CREATE INDEX IF NOT EXISTS idx_spots_subregion ON public.spots (subregion_key);

-- ── Data: tag existing spots by region string matching ───────────────────────
-- Best-effort mapping from existing region/subregion text values.
-- Unmatched spots stay null (storm_arrivals.py falls back to text-match).

UPDATE public.spots SET subregion_key = 'socal'
  WHERE (region ILIKE '%southern california%' OR region ILIKE '%san diego%'
      OR region ILIKE '%los angeles%' OR region ILIKE '%orange county%')
    AND subregion_key IS NULL;

UPDATE public.spots SET subregion_key = 'cencal'
  WHERE (region ILIKE '%central california%' OR region ILIKE '%santa barbara%'
      OR region ILIKE '%san luis obispo%' OR region ILIKE '%monterey%')
    AND subregion_key IS NULL;

UPDATE public.spots SET subregion_key = 'norcal'
  WHERE (region ILIKE '%northern california%' OR region ILIKE '%san francisco%'
      OR region ILIKE '%marin%' OR region ILIKE '%sonoma%' OR region ILIKE '%humboldt%')
    AND subregion_key IS NULL;

UPDATE public.spots SET subregion_key = 'pnw'
  WHERE (region ILIKE '%oregon%' OR region ILIKE '%washington%'
      OR region ILIKE '%pacific northwest%')
    AND subregion_key IS NULL;

UPDATE public.spots SET subregion_key = 'baja'
  WHERE (region ILIKE '%baja%')
    AND subregion_key IS NULL;

UPDATE public.spots SET subregion_key = 'oahu_north'
  WHERE (region ILIKE '%hawaii%' OR subregion ILIKE '%north shore%')
    AND subregion_key IS NULL;

UPDATE public.spots SET subregion_key = 'oahu_south'
  WHERE (region ILIKE '%hawaii%' AND subregion ILIKE '%south%')
    AND subregion_key IS NULL;
