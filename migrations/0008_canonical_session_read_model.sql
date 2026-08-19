-- Additional immutable snapshot fields and interval rows required by the
-- canonical read assembler. This migration is deliberately explicit: it is
-- not executed implicitly by the Worker or by a normal application startup.
ALTER TABLE sessions ADD COLUMN scheduled_workout_key TEXT;
ALTER TABLE sessions ADD COLUMN local_date TEXT;
ALTER TABLE sessions ADD COLUMN start_time TEXT;
ALTER TABLE sessions ADD COLUMN estimated_duration_min INTEGER;
ALTER TABLE completion_items ADD COLUMN set_ordinal INTEGER CHECK (set_ordinal IS NULL OR set_ordinal > 0);

CREATE TABLE IF NOT EXISTS session_intervals (
  session_key TEXT NOT NULL,
  interval_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  PRIMARY KEY (session_key, interval_key),
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_intervals_session
  ON session_intervals(session_key, started_at);
