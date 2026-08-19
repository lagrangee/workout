-- Canonical Workout Plan records. The repository Exercise Registry remains
-- bundled Worker data; these tables store only Athlete-owned intent.
CREATE TABLE IF NOT EXISTS plans (
  plan_id TEXT PRIMARY KEY,
  athlete_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (athlete_key, plan_id),
  FOREIGN KEY (athlete_key) REFERENCES athlete_state(athlete_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plan_revisions (
  plan_id TEXT NOT NULL,
  athlete_key TEXT NOT NULL,
  revision_key TEXT NOT NULL PRIMARY KEY,
  revision_sequence INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (athlete_key, revision_sequence),
  UNIQUE (athlete_key, effective_from, revision_sequence),
  UNIQUE (athlete_key, revision_key),
  FOREIGN KEY (athlete_key, plan_id) REFERENCES plans(athlete_key, plan_id) ON DELETE CASCADE,
  FOREIGN KEY (athlete_key) REFERENCES athlete_state(athlete_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plan_slots (
  revision_key TEXT NOT NULL,
  weekday TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('workout', 'rest', 'no_plan')),
  title TEXT,
  start_time TEXT,
  estimated_duration_min INTEGER,
  PRIMARY KEY (revision_key, weekday),
  FOREIGN KEY (revision_key) REFERENCES plan_revisions(revision_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plan_exercises (
  revision_key TEXT NOT NULL,
  athlete_key TEXT NOT NULL,
  weekday TEXT NOT NULL,
  block_ordinal INTEGER NOT NULL,
  block_title TEXT NOT NULL,
  exercise_ordinal INTEGER NOT NULL,
  occurrence_key TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('none', 'bilateral', 'per_side', 'alternating')),
  name_snapshot TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  PRIMARY KEY (revision_key, occurrence_key),
  UNIQUE (revision_key, weekday, occurrence_key),
  FOREIGN KEY (revision_key) REFERENCES plan_revisions(revision_key) ON DELETE CASCADE,
  FOREIGN KEY (athlete_key, revision_key) REFERENCES plan_revisions(athlete_key, revision_key) ON DELETE CASCADE,
  FOREIGN KEY (athlete_key) REFERENCES athlete_state(athlete_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plan_sets (
  revision_key TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  set_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  target_metric TEXT NOT NULL CHECK (target_metric IN ('reps', 'duration_sec')),
  target_value INTEGER NOT NULL,
  resistance_mode TEXT CHECK (resistance_mode IS NULL OR resistance_mode IN ('bodyweight', 'external_load')),
  resistance_kg REAL,
  tempo TEXT,
  rest_after_sec INTEGER,
  PRIMARY KEY (revision_key, occurrence_key, set_id),
  UNIQUE (revision_key, occurrence_key, ordinal),
  FOREIGN KEY (revision_key, occurrence_key) REFERENCES plan_exercises(revision_key, occurrence_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_revisions_athlete_effective
  ON plan_revisions(athlete_key, effective_from, revision_sequence);

CREATE INDEX IF NOT EXISTS idx_plan_exercises_exercise
  ON plan_exercises(athlete_key, exercise_id, revision_key);
