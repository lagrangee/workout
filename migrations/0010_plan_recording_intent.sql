-- Optional Plan-owned intent for a route workout that is recorded by COROS.
-- The COROS Activity remains a separate record; these columns only preserve
-- the explicit matching criteria frozen in the Plan revision.
ALTER TABLE plan_slots ADD COLUMN recording_source TEXT
  CHECK (recording_source IS NULL OR recording_source = 'coros');
ALTER TABLE plan_slots ADD COLUMN recording_sport_type INTEGER
  CHECK (recording_sport_type IS NULL OR recording_sport_type IN (100, 102, 104, 200));
ALTER TABLE plan_slots ADD COLUMN recording_route_key TEXT;
