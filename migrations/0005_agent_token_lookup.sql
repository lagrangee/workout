CREATE TABLE IF NOT EXISTS agent_token_lookup (
  token_digest TEXT PRIMARY KEY,
  athlete_key TEXT NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (athlete_key) REFERENCES athlete_state(athlete_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_token_lookup_athlete
  ON agent_token_lookup (athlete_key);
