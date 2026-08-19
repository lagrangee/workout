import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const initial = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const plan = readFileSync(new URL("../migrations/0006_canonical_plan_records.sql", import.meta.url), "utf8");
const session = readFileSync(new URL("../migrations/0007_canonical_session_records.sql", import.meta.url), "utf8");
const readModel = readFileSync(new URL("../migrations/0008_canonical_session_read_model.sql", import.meta.url), "utf8");
const cutover = readFileSync(new URL("../migrations/0009_canonical_workout_cutover.sql", import.meta.url), "utf8");

test("canonical Session migration keeps snapshots, side items, and one current result per item", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(initial);
    db.exec(plan);
    db.exec(session);
    db.exec(readModel);
    db.exec(cutover);
    db.exec(cutover);
    db.exec(session);
    db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at) VALUES (?, ?, ?, ?)").run("athlete-a", "a@example.invalid", "{}", "2026-08-19T00:00:00.000Z");
    db.prepare("INSERT INTO plans (plan_id, athlete_key, name, created_at) VALUES (?, ?, ?, ?)").run("plan-athlete-a", "athlete-a", "Workout", "2026-08-19T00:00:00.000Z");
    db.prepare("INSERT INTO plan_revisions (plan_id, athlete_key, revision_key, revision_sequence, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("plan-athlete-a", "athlete-a", "rev-1", 1, "2026-08-19", "2026-08-19T00:00:00.000Z");
    db.prepare("INSERT INTO sessions (athlete_key, session_key, plan_id, plan_revision_key, scheduled_date, timezone_at_session, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("athlete-a", "sess-1", "plan-athlete-a", "rev-1", "2026-08-19", "Asia/Shanghai", "核心", "in_progress", "2026-08-19T00:00:00.000Z", "2026-08-19T00:00:00.000Z");
    db.prepare("INSERT INTO session_exercises (session_key, occurrence_key, block_ordinal, block_title, exercise_ordinal, exercise_id, name_snapshot, definition_version, execution_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("sess-1", "dead_bug_main", 1, "核心", 1, "dead_bug", "死虫", 1, "alternating");
    db.prepare("INSERT INTO completion_items (session_key, completion_item_key, occurrence_key, set_id, side, target_metric, target_value, resistance_mode, resistance_kg, tempo, rest_after_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("sess-1", "ci-left", "dead_bug_main", "set-1", "left", "reps", 5, "bodyweight", null, "3-1-1-0", 30);
    const insert = db.prepare("INSERT INTO set_results (session_key, completion_item_key, status, actual_metric, actual_value, resistance_mode, resistance_kg, rir, note, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("sess-1", "ci-left", "completed", "reps", 5, "bodyweight", null, 2, null, "2026-08-19T00:00:00.000Z");
    assert.throws(() => insert.run("sess-1", "ci-left", "partial", "reps", 3, "bodyweight", null, null, "修正", "2026-08-19T00:00:00.000Z"), /constraint/i);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'exercise_feedback'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_notes'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_intervals'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workout_storage_cutover'").get());
    assert.ok(db.prepare("PRAGMA table_info(completion_items)").all().some((column) => column.name === "set_ordinal"));
    db.prepare("INSERT INTO workout_storage_cutover (athlete_key, canonical_version, rebuilt_at, source_state_revision, rollback_ref) VALUES (?, ?, ?, ?, ?)").run("athlete-a", 1, "2026-08-19T00:00:00.000Z", 3, "workout-rollback-test");
    const marker = /** @type {any} */ (db.prepare("SELECT canonical_version FROM workout_storage_cutover WHERE athlete_key = ?").get("athlete-a"));
    assert.equal(marker.canonical_version, 1);
  } finally {
    db.close();
  }
});
