CREATE TABLE IF NOT EXISTS plan_revision_index (
  athlete_key TEXT NOT NULL,
  revision_key TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  revision_sequence INTEGER NOT NULL,
  PRIMARY KEY (athlete_key, revision_key),
  UNIQUE (revision_key)
);

CREATE INDEX IF NOT EXISTS idx_plan_revision_effective
  ON plan_revision_index(athlete_key, effective_from, revision_sequence);

CREATE TABLE IF NOT EXISTS session_index (
  athlete_key TEXT NOT NULL,
  session_key TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (athlete_key, session_key),
  UNIQUE (session_key)
);

CREATE INDEX IF NOT EXISTS idx_session_index_date
  ON session_index(athlete_key, scheduled_date, session_key);

CREATE INDEX IF NOT EXISTS idx_session_index_status_date
  ON session_index(athlete_key, status, scheduled_date, session_key);

CREATE TABLE IF NOT EXISTS session_exercise_index (
  athlete_key TEXT NOT NULL,
  exercise_key TEXT NOT NULL,
  session_key TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  PRIMARY KEY (athlete_key, exercise_key, session_key),
  FOREIGN KEY (athlete_key, session_key) REFERENCES session_index(athlete_key, session_key)
);

CREATE INDEX IF NOT EXISTS idx_session_exercise_lookup
  ON session_exercise_index(athlete_key, exercise_key, scheduled_date, session_key);

CREATE TABLE IF NOT EXISTS coach_share_lookup (
  token_digest TEXT PRIMARY KEY,
  athlete_key TEXT NOT NULL UNIQUE,
  share_key TEXT NOT NULL UNIQUE,
  lookup_key_version INTEGER NOT NULL,
  encryption_key_version INTEGER NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (athlete_key) REFERENCES athlete_state(athlete_key)
);

CREATE INDEX IF NOT EXISTS idx_coach_share_active
  ON coach_share_lookup(token_digest, revoked_at);
