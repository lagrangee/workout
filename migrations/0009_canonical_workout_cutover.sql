-- Explicit clean-cut marker. The Worker never creates this marker for an
-- existing Athlete implicitly; the bounded rebuild operation writes it only
-- after canonical Plan/Session rows and rollback evidence are ready. A newly
-- created empty Athlete may be initialized at this boundary directly.
CREATE TABLE IF NOT EXISTS workout_storage_cutover (
  athlete_key TEXT PRIMARY KEY,
  canonical_version INTEGER NOT NULL CHECK (canonical_version = 1),
  rebuilt_at TEXT NOT NULL,
  source_state_revision INTEGER,
  rollback_ref TEXT,
  FOREIGN KEY (athlete_key) REFERENCES athlete_state(athlete_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workout_storage_cutover_version
  ON workout_storage_cutover(canonical_version, rebuilt_at);
