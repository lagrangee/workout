-- Make Athlete-local dates the canonical schedule truth. Weekly Plan
-- Revisions remain immutable prescription batches and provenance; they no
-- longer determine a date at read time.
CREATE TABLE IF NOT EXISTS plan_changes (
  change_key TEXT PRIMARY KEY,
  athlete_key TEXT NOT NULL,
  change_sequence INTEGER NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('weekly_write', 'day_write', 'day_move')),
  created_at TEXT NOT NULL,
  source_date TEXT,
  target_date TEXT,
  UNIQUE (athlete_key, change_sequence),
  UNIQUE (athlete_key, change_key),
  FOREIGN KEY (athlete_key) REFERENCES athlete_state(athlete_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS planned_days (
  athlete_key TEXT NOT NULL,
  planned_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('workout', 'rest', 'no_plan')),
  prescription_revision_key TEXT,
  prescription_weekday TEXT,
  change_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  moved_from_date TEXT,
  moved_to_date TEXT,
  PRIMARY KEY (athlete_key, planned_date),
  FOREIGN KEY (athlete_key) REFERENCES athlete_state(athlete_key) ON DELETE CASCADE,
  FOREIGN KEY (athlete_key, change_key) REFERENCES plan_changes(athlete_key, change_key),
  FOREIGN KEY (prescription_revision_key, prescription_weekday) REFERENCES plan_slots(revision_key, weekday),
  CHECK (
    (kind = 'workout' AND prescription_revision_key IS NOT NULL AND prescription_weekday IS NOT NULL)
    OR
    (kind IN ('rest', 'no_plan') AND prescription_revision_key IS NULL AND prescription_weekday IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_planned_days_athlete_date
  ON planned_days(athlete_key, planned_date);

INSERT INTO plan_changes (
  change_key, athlete_key, change_sequence, change_type, created_at, source_date, target_date
)
SELECT 'legacy_' || revision_key, athlete_key, revision_sequence, 'weekly_write', created_at, NULL, NULL
FROM plan_revisions;

WITH offsets(day_offset) AS (VALUES (0), (1), (2), (3), (4), (5), (6)),
revision_dates AS (
  SELECT
    revision.athlete_key,
    revision.revision_key,
    revision.revision_sequence,
    date(revision.effective_from, '+' || offsets.day_offset || ' days') AS planned_date,
    CASE strftime('%w', date(revision.effective_from, '+' || offsets.day_offset || ' days'))
      WHEN '0' THEN 'sunday'
      WHEN '1' THEN 'monday'
      WHEN '2' THEN 'tuesday'
      WHEN '3' THEN 'wednesday'
      WHEN '4' THEN 'thursday'
      WHEN '5' THEN 'friday'
      WHEN '6' THEN 'saturday'
    END AS weekday
  FROM plan_revisions AS revision
  CROSS JOIN offsets
),
winning_dates AS (
  SELECT candidate.*
  FROM revision_dates AS candidate
  WHERE candidate.revision_sequence = (
    SELECT MAX(other.revision_sequence)
    FROM revision_dates AS other
    WHERE other.athlete_key = candidate.athlete_key
      AND other.planned_date = candidate.planned_date
  )
)
INSERT INTO planned_days (
  athlete_key, planned_date, kind, prescription_revision_key, prescription_weekday,
  change_key, version, moved_from_date, moved_to_date
)
SELECT
  winner.athlete_key,
  winner.planned_date,
  slot.kind,
  CASE WHEN slot.kind = 'workout' THEN winner.revision_key ELSE NULL END,
  CASE WHEN slot.kind = 'workout' THEN winner.weekday ELSE NULL END,
  'legacy_' || winner.revision_key,
  1,
  NULL,
  NULL
FROM winning_dates AS winner
JOIN plan_slots AS slot
  ON slot.revision_key = winner.revision_key
 AND slot.weekday = winner.weekday;
