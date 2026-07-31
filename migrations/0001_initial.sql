CREATE TABLE IF NOT EXISTS athlete_state (
  athlete_key TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_athlete_state_email ON athlete_state(email);

-- The JSON state is the local/D1 read model, while this guard gives D1 a
-- database-level uniqueness boundary for the one-Session-per-Athlete-date
-- invariant used by the mutation route.
CREATE TABLE IF NOT EXISTS session_date_guard (
  athlete_key TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  session_key TEXT NOT NULL,
  PRIMARY KEY (athlete_key, scheduled_date),
  UNIQUE (session_key)
);

CREATE INDEX IF NOT EXISTS idx_session_guard_date ON session_date_guard(scheduled_date);
