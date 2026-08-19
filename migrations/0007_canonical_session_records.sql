-- Canonical Workout Session snapshot and result records.
CREATE TABLE IF NOT EXISTS sessions (
  athlete_key TEXT NOT NULL,
  session_key TEXT NOT NULL PRIMARY KEY,
  plan_id TEXT NOT NULL,
  plan_revision_key TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  timezone_at_session TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'in_progress', 'completed', 'partial', 'abandoned', 'skipped')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (athlete_key, scheduled_date),
  FOREIGN KEY (athlete_key) REFERENCES athlete_state(athlete_key) ON DELETE CASCADE,
  FOREIGN KEY (athlete_key, plan_id) REFERENCES plans(athlete_key, plan_id),
  FOREIGN KEY (athlete_key, plan_revision_key) REFERENCES plan_revisions(athlete_key, revision_key)
);

CREATE TABLE IF NOT EXISTS session_exercises (
  session_key TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  block_ordinal INTEGER NOT NULL,
  block_title TEXT NOT NULL,
  exercise_ordinal INTEGER NOT NULL,
  exercise_id TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('none', 'bilateral', 'per_side', 'alternating')),
  PRIMARY KEY (session_key, occurrence_key),
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS completion_items (
  session_key TEXT NOT NULL,
  completion_item_key TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  set_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('none', 'both', 'left', 'right')),
  target_metric TEXT NOT NULL CHECK (target_metric IN ('reps', 'duration_sec')),
  target_value INTEGER NOT NULL,
  resistance_mode TEXT CHECK (resistance_mode IS NULL OR resistance_mode IN ('bodyweight', 'external_load')),
  resistance_kg REAL,
  tempo TEXT,
  rest_after_sec INTEGER,
  PRIMARY KEY (session_key, completion_item_key),
  UNIQUE (session_key, occurrence_key, set_id, side),
  FOREIGN KEY (session_key, occurrence_key) REFERENCES session_exercises(session_key, occurrence_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS set_results (
  session_key TEXT NOT NULL,
  completion_item_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'skipped')),
  actual_metric TEXT CHECK (actual_metric IS NULL OR actual_metric IN ('reps', 'duration_sec')),
  actual_value INTEGER CHECK (actual_value IS NULL OR actual_value > 0),
  resistance_mode TEXT CHECK (resistance_mode IS NULL OR resistance_mode IN ('bodyweight', 'external_load')),
  resistance_kg REAL,
  rir INTEGER CHECK (rir IS NULL OR (rir >= 0 AND rir <= 10)),
  note TEXT,
  completed_at TEXT,
  PRIMARY KEY (session_key, completion_item_key),
  FOREIGN KEY (session_key, completion_item_key) REFERENCES completion_items(session_key, completion_item_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exercise_feedback (
  session_key TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (session_key, occurrence_key),
  FOREIGN KEY (session_key, occurrence_key) REFERENCES session_exercises(session_key, occurrence_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_notes (
  session_key TEXT NOT NULL PRIMARY KEY,
  note TEXT,
  skip_reason TEXT,
  session_rpe INTEGER,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_athlete_date
  ON sessions(athlete_key, scheduled_date, session_key);

CREATE INDEX IF NOT EXISTS idx_session_exercises_exercise
  ON session_exercises(exercise_id, session_key);
