CREATE TABLE IF NOT EXISTS athlete_state (
  athlete_key TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_athlete_state_email ON athlete_state(email);
