-- Phase D step 4 (WIND_TILES_EXECUTION_PLAN): per-storm max gust from the
-- GFS GUST surface field, box-max around the detected center.
alter table derived_storms add column if not exists max_gust_kts integer;

comment on column derived_storms.max_gust_kts is
  'Peak surface gust (kt) within ~500 km of storm center, from GFS GUST at detection time';
