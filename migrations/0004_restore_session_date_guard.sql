-- 0001_initial.sql was amended after it had already been applied to the
-- production D1. Restore the database-level one-Session-per-Athlete-date
-- guard through a new idempotent migration instead of rewriting history.
CREATE TABLE IF NOT EXISTS session_date_guard (
  athlete_key TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  session_key TEXT NOT NULL,
  PRIMARY KEY (athlete_key, scheduled_date),
  UNIQUE (session_key)
);

CREATE INDEX IF NOT EXISTS idx_session_guard_date
  ON session_date_guard(scheduled_date);
