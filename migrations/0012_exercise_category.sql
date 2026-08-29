-- Freeze Exercise category in canonical Plan and Session rows. Existing rows
-- are backfilled from this explicit, release-pinned mapping. The migration
-- fails before altering either canonical table if it encounters an unknown ID.
CREATE TABLE _migration_0012_exercise_category_map (
  exercise_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('strength', 'endurance', 'mobility', 'recovery'))
);

INSERT INTO _migration_0012_exercise_category_map (exercise_id, category) VALUES
  ('dead_bug', 'strength'),
  ('side_plank', 'strength'),
  ('glute_bridge', 'strength'),
  ('straight_knee_single_leg_calf_raise', 'strength'),
  ('bent_knee_single_leg_calf_raise', 'strength'),
  ('bulgarian_split_squat', 'strength'),
  ('cable_romanian_deadlift', 'strength'),
  ('step_up', 'strength'),
  ('pull_up', 'strength'),
  ('push_up', 'strength'),
  ('bird_dog', 'strength'),
  ('pallof_press', 'strength'),
  ('cat_cow', 'mobility'),
  ('single_leg_balance', 'mobility'),
  ('wall_toe_raise', 'strength'),
  ('short_foot', 'strength'),
  ('cable_row', 'strength'),
  ('face_pull', 'strength'),
  ('step_down', 'strength'),
  ('cable_lat_pulldown', 'strength'),
  ('cable_chest_press', 'strength'),
  ('cable_fly', 'strength'),
  ('cable_lateral_raise', 'strength'),
  ('outdoor_easy_run', 'endurance'),
  ('trail_run_hike', 'endurance'),
  ('treadmill_incline_walk', 'endurance');

CREATE TABLE _migration_0012_exercise_category_guard (
  exercise_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('strength', 'endurance', 'mobility', 'recovery'))
);

INSERT INTO _migration_0012_exercise_category_guard (exercise_id, category)
SELECT exercise.exercise_id, mapping.category
FROM plan_exercises AS exercise
LEFT JOIN _migration_0012_exercise_category_map AS mapping ON mapping.exercise_id = exercise.exercise_id;

INSERT INTO _migration_0012_exercise_category_guard (exercise_id, category)
SELECT exercise.exercise_id, mapping.category
FROM session_exercises AS exercise
LEFT JOIN _migration_0012_exercise_category_map AS mapping ON mapping.exercise_id = exercise.exercise_id;

ALTER TABLE plan_exercises ADD COLUMN category TEXT
  CHECK (category IS NULL OR category IN ('strength', 'endurance', 'mobility', 'recovery'));
ALTER TABLE session_exercises ADD COLUMN category TEXT
  CHECK (category IS NULL OR category IN ('strength', 'endurance', 'mobility', 'recovery'));

UPDATE plan_exercises
SET category = (SELECT mapping.category FROM _migration_0012_exercise_category_map AS mapping WHERE mapping.exercise_id = plan_exercises.exercise_id);
UPDATE session_exercises
SET category = (SELECT mapping.category FROM _migration_0012_exercise_category_map AS mapping WHERE mapping.exercise_id = session_exercises.exercise_id);

CREATE TRIGGER plan_exercises_category_required_insert
BEFORE INSERT ON plan_exercises
WHEN NEW.category IS NULL
BEGIN
  SELECT RAISE(ABORT, 'plan_exercises.category is required');
END;

CREATE TRIGGER plan_exercises_category_required_update
BEFORE UPDATE OF category ON plan_exercises
WHEN NEW.category IS NULL
BEGIN
  SELECT RAISE(ABORT, 'plan_exercises.category is required');
END;

CREATE TRIGGER session_exercises_category_required_insert
BEFORE INSERT ON session_exercises
WHEN NEW.category IS NULL
BEGIN
  SELECT RAISE(ABORT, 'session_exercises.category is required');
END;

CREATE TRIGGER session_exercises_category_required_update
BEFORE UPDATE OF category ON session_exercises
WHEN NEW.category IS NULL
BEGIN
  SELECT RAISE(ABORT, 'session_exercises.category is required');
END;

DROP TABLE _migration_0012_exercise_category_guard;
DROP TABLE _migration_0012_exercise_category_map;
