-- Migration 007: Add tide station + buoy reference columns to spots
-- Enables /api/tides/timeline and improves Copilot tool data resolution.
--
-- tide_station_id — NOAA CO-OPS station code for tide predictions
-- primary_buoy_id — Closest inshore NDBC buoy (derived from buoy_blend, stored for quick lookup)
-- offshore_buoy_id — Reference offshore buoy for period/direction context

ALTER TABLE public.spots
    ADD COLUMN IF NOT EXISTS tide_station_id TEXT,
    ADD COLUMN IF NOT EXISTS primary_buoy_id TEXT,
    ADD COLUMN IF NOT EXISTS offshore_buoy_id TEXT;

COMMENT ON COLUMN public.spots.tide_station_id   IS 'NOAA CO-OPS station ID for tide predictions (e.g. 9410170)';
COMMENT ON COLUMN public.spots.primary_buoy_id   IS 'NDBC station ID for primary wave data (e.g. 46225)';
COMMENT ON COLUMN public.spots.offshore_buoy_id  IS 'NDBC station ID for offshore period/direction reference';

-- ── California NOAA CO-OPS tide station seeds ─────────────────────────────
-- San Diego County (station 9410170 — San Diego)
UPDATE public.spots SET tide_station_id = '9410170'
WHERE slug IN (
    'blacks-beach', 'swamis', 'cardiff-reef', 'seaside-reef',
    'del-mar', 'oceanside-harbor', 'la-jolla-cove', 'windansea',
    'mission-beach', 'ocean-beach', 'imperial-beach'
);

-- Orange County (station 9410580 — Newport Beach)
UPDATE public.spots SET tide_station_id = '9410580'
WHERE slug IN (
    'lower-trestles', 'upper-trestles', 'san-onofre', 'doheny',
    'salt-creek', 'aliso-beach', 'newport-beach', 'huntington-beach'
);

-- Los Angeles / Ventura County (station 9410840 — Santa Monica)
UPDATE public.spots SET tide_station_id = '9410840'
WHERE slug IN (
    'malibu', 'el-porto', 'manhattan-beach', 'hermosa-beach',
    'redondo-beach', 'palos-verdes', 'topanga', 'point-dume',
    'leo-carrillo', 'county-line', 'rincon', 'ventura-point'
);

-- Santa Barbara County (station 9411340 — Santa Barbara)
UPDATE public.spots SET tide_station_id = '9411340'
WHERE slug IN (
    'santa-barbara-harbor', 'leadbetter', 'hammonds',
    'el-capitan', 'jalama'
);

-- San Luis Obispo County (station 9412110 — Port San Luis)
UPDATE public.spots SET tide_station_id = '9412110'
WHERE slug IN (
    'pismo-beach', 'avila-beach', 'morro-bay', 'cayucos'
);

-- Monterey / Santa Cruz County (station 9413450 — Monterey)
UPDATE public.spots SET tide_station_id = '9413450'
WHERE slug IN (
    'steamer-lane', 'cowells', 'pleasure-point', 'capitola',
    'the-hook', '26th-ave', 'monterey-bay'
);

-- San Francisco Bay / Marin (station 9414290 — San Francisco)
UPDATE public.spots SET tide_station_id = '9414290'
WHERE slug IN (
    'ocean-beach-sf', 'fort-point', 'bolinas', 'stinson-beach',
    'linda-mar', 'pacifica', 'rockaway-beach'
);

-- North Coast (station 9415020 — Point Reyes)
UPDATE public.spots SET tide_station_id = '9415020'
WHERE slug IN (
    'salmon-creek', 'doran-beach', 'jenner', 'goat-rock'
);

-- ── Primary buoy seeds for known spots ───────────────────────────────────
-- These mirror the buoy_blend primary buoys in spot_forecast_tuning.
UPDATE public.spots SET
    primary_buoy_id  = '46225',   -- Torrey Pines (5mi N of Blacks)
    offshore_buoy_id = '46086'    -- Point Dume (open-ocean swell direction)
WHERE slug = 'blacks-beach';

UPDATE public.spots SET
    primary_buoy_id  = '46224',
    offshore_buoy_id = '46225'
WHERE slug IN ('swamis', 'cardiff-reef', 'seaside-reef');

UPDATE public.spots SET
    primary_buoy_id  = '46266',   -- Del Mar
    offshore_buoy_id = '46225'
WHERE slug = 'oceanside-harbor';

UPDATE public.spots SET
    primary_buoy_id  = '46086',   -- Point Dume
    offshore_buoy_id = '46011'    -- Santa Maria Basin
WHERE slug IN ('malibu', 'el-porto', 'topanga', 'leo-carrillo', 'county-line');

UPDATE public.spots SET
    primary_buoy_id  = '46258',   -- San Pedro
    offshore_buoy_id = '46086'
WHERE slug IN ('lower-trestles', 'upper-trestles', 'san-onofre', 'doheny');

UPDATE public.spots SET
    primary_buoy_id  = '46222',   -- Santa Monica
    offshore_buoy_id = '46086'
WHERE slug IN ('manhattan-beach', 'hermosa-beach', 'redondo-beach', 'palos-verdes');

UPDATE public.spots SET
    primary_buoy_id  = '46011',   -- Santa Maria Basin
    offshore_buoy_id = '46023'    -- Point Arguello (if available)
WHERE slug IN ('rincon', 'ventura-point', 'santa-barbara-harbor', 'leadbetter', 'el-capitan', 'jalama');

UPDATE public.spots SET
    primary_buoy_id  = '46011',
    offshore_buoy_id = '46059'    -- West California (offshore)
WHERE slug IN ('pismo-beach', 'avila-beach', 'morro-bay', 'cayucos');

UPDATE public.spots SET
    primary_buoy_id  = '46042',   -- Monterey Bay
    offshore_buoy_id = '46059'
WHERE slug IN ('steamer-lane', 'cowells', 'pleasure-point', 'capitola', 'the-hook', 'monterey-bay');

UPDATE public.spots SET
    primary_buoy_id  = '46026',   -- San Francisco Bar
    offshore_buoy_id = '46059'
WHERE slug IN ('ocean-beach-sf', 'fort-point', 'linda-mar', 'pacifica', 'rockaway-beach');

UPDATE public.spots SET
    primary_buoy_id  = '46014',   -- Point Arena
    offshore_buoy_id = '46059'
WHERE slug IN ('bolinas', 'stinson-beach', 'salmon-creek', 'doran-beach', 'jenner', 'goat-rock');
