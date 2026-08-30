-- Structured endurance prescription requirements and occurrence-scoped
-- external completion declarations. Watch telemetry remains provider-owned.
ALTER TABLE plan_sets ADD COLUMN target_distance_km REAL CHECK (target_distance_km IS NULL OR target_distance_km > 0);
ALTER TABLE plan_sets ADD COLUMN target_hr_zone_min INTEGER CHECK (target_hr_zone_min IS NULL OR (target_hr_zone_min BETWEEN 1 AND 5));
ALTER TABLE plan_sets ADD COLUMN target_hr_zone_max INTEGER CHECK (target_hr_zone_max IS NULL OR (target_hr_zone_max BETWEEN 1 AND 5));
ALTER TABLE plan_sets ADD COLUMN target_incline_percent REAL CHECK (target_incline_percent IS NULL OR (target_incline_percent >= 0 AND target_incline_percent <= 40));
ALTER TABLE plan_sets ADD COLUMN target_rpe_min INTEGER CHECK (target_rpe_min IS NULL OR (target_rpe_min BETWEEN 1 AND 10));
ALTER TABLE plan_sets ADD COLUMN target_rpe_max INTEGER CHECK (target_rpe_max IS NULL OR (target_rpe_max BETWEEN 1 AND 10));
ALTER TABLE plan_sets ADD COLUMN effort_cue TEXT;

ALTER TABLE completion_items ADD COLUMN target_distance_km REAL CHECK (target_distance_km IS NULL OR target_distance_km > 0);
ALTER TABLE completion_items ADD COLUMN target_hr_zone_min INTEGER CHECK (target_hr_zone_min IS NULL OR (target_hr_zone_min BETWEEN 1 AND 5));
ALTER TABLE completion_items ADD COLUMN target_hr_zone_max INTEGER CHECK (target_hr_zone_max IS NULL OR (target_hr_zone_max BETWEEN 1 AND 5));
ALTER TABLE completion_items ADD COLUMN target_incline_percent REAL CHECK (target_incline_percent IS NULL OR (target_incline_percent >= 0 AND target_incline_percent <= 40));
ALTER TABLE completion_items ADD COLUMN target_rpe_min INTEGER CHECK (target_rpe_min IS NULL OR (target_rpe_min BETWEEN 1 AND 10));
ALTER TABLE completion_items ADD COLUMN target_rpe_max INTEGER CHECK (target_rpe_max IS NULL OR (target_rpe_max BETWEEN 1 AND 10));
ALTER TABLE completion_items ADD COLUMN effort_cue TEXT;

CREATE TABLE IF NOT EXISTS session_external_completions (
  session_key TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  completed_at TEXT NOT NULL,
  recording_source TEXT NOT NULL CHECK (recording_source IN ('coros', 'apple_watch', 'none')),
  PRIMARY KEY (session_key, occurrence_key),
  FOREIGN KEY (session_key, occurrence_key) REFERENCES session_exercises(session_key, occurrence_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_external_completions_session
  ON session_external_completions(session_key, completed_at);
