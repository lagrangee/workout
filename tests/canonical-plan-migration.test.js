import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const initial = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const canonical = readFileSync(new URL("../migrations/0006_canonical_plan_records.sql", import.meta.url), "utf8");

test("canonical Plan migration creates independent records and enforces occurrence/set identity", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(initial);
    db.exec(canonical);
    db.exec(canonical);
    db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at) VALUES (?, ?, ?, ?)").run("athlete-a", "a@example.invalid", "{}", "2026-08-19T00:00:00.000Z");
    db.prepare("INSERT INTO plans (plan_id, athlete_key, name, created_at) VALUES (?, ?, ?, ?)").run("plan-athlete-a", "athlete-a", "Workout", "2026-08-19T00:00:00.000Z");
    db.prepare("INSERT INTO plan_revisions (plan_id, athlete_key, revision_key, revision_sequence, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("plan-athlete-a", "athlete-a", "rev-1", 1, "2026-08-20", "2026-08-19T00:00:00.000Z");
    db.prepare("INSERT INTO plan_exercises (revision_key, athlete_key, weekday, block_ordinal, block_title, exercise_ordinal, occurrence_key, exercise_id, execution_mode, name_snapshot, definition_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("rev-1", "athlete-a", "monday", 1, "主训练", 1, "dead_bug_main", "dead_bug", "alternating", "死虫", 1);
    const set = db.prepare("INSERT INTO plan_sets (revision_key, occurrence_key, set_id, ordinal, target_metric, target_value, resistance_mode, resistance_kg, tempo, rest_after_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    set.run("rev-1", "dead_bug_main", "set-1", 1, "reps", 5, "bodyweight", null, "3-1-1-0", 45);
    assert.throws(() => set.run("rev-1", "dead_bug_main", "set-1", 1, "reps", 5, "bodyweight", null, null, null), /constraint/i);
    assert.throws(() => db.prepare("INSERT INTO plan_exercises (revision_key, athlete_key, weekday, block_ordinal, block_title, exercise_ordinal, occurrence_key, exercise_id, execution_mode, name_snapshot, definition_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("rev-1", "athlete-b", "monday", 1, "主训练", 1, "wrong_athlete", "dead_bug", "alternating", "死虫", 1), /constraint/i);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plan_exercises'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plan_sets'").get());
  } finally {
    db.close();
  }
});
