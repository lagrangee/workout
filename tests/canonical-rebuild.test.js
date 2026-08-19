// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { buildCanonicalRebuildSql } from "../src/canonical-rebuild.js";
import { WEEKDAYS } from "../src/util.js";

const MIGRATIONS = [
  "0001_initial.sql",
  "0002_state_revision.sql",
  "0003_query_indexes.sql",
  "0004_restore_session_date_guard.sql",
  "0005_agent_token_lookup.sql",
  "0006_canonical_plan_records.sql",
  "0007_canonical_session_records.sql",
  "0008_canonical_session_read_model.sql",
  "0009_canonical_workout_cutover.sql",
];

function execMigrations(db) {
  db.exec("PRAGMA foreign_keys = ON;");
  for (const name of MIGRATIONS) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
}

function canonicalState() {
  const set = {
    set_id: "dead_bug_set_1",
    ordinal: 1,
    target: { metric: "reps", value: 5 },
    resistance_mode: "bodyweight",
    resistance_kg: null,
    resistance: { mode: "bodyweight" },
    tempo: "3-1-1-0",
    rest_after_sec: 30,
  };
  const exercise = {
    occurrence_key: "dead_bug_main",
    exercise_occurrence_key: "dead_bug_main",
    exercise_id: "dead_bug",
    name: "死虫",
    definition_version: 1,
    execution_mode: "alternating",
    sets: [{ set_key: set.set_id, ...set }],
  };
  const workout = {
    kind: "workout",
    title: "核心训练",
    start_time: "21:00",
    estimated_duration_min: 20,
    blocks: [{ title: "主训练", exercises: [{ ...exercise, sets: [{ ...set }] }] }],
  };
  const revision = {
    revision_key: "rev-rebuild",
    revision_sequence: 1,
    effective_from: "2026-08-19",
    created_at: "2026-08-19T00:00:00.000Z",
    week: Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, weekday === "wednesday" ? workout : null])),
  };
  const item = (side) => ({
    completion_item_key: `ci-${side}`,
    exercise_occurrence_key: "dead_bug_main",
    occurrence_key: "dead_bug_main",
    set_id: set.set_id,
    set_key: set.set_id,
    set_ordinal: 1,
    side,
    target: { metric: "reps", value: 5 },
    resistance_mode: "bodyweight",
    resistance_kg: null,
    resistance: { mode: "bodyweight" },
    tempo: "3-1-1-0",
    rest_after_sec: 30,
  });
  const snapshot = {
    schema_version: 2,
    title: "核心训练",
    start_time: "21:00",
    estimated_duration_min: 20,
    blocks: [{ block_key: "block-1", title: "主训练", exercises: [{ ...exercise }] }],
    completion_items: [item("left"), item("right")],
    exercise_occurrence_keys: ["dead_bug_main"],
  };
  return {
    athlete_key: "athlete-rebuild",
    email: "rebuild@example.invalid",
    display_name: "Rebuild",
    timezone: "Asia/Shanghai",
    plan_revisions: [revision],
    sessions: [{
      session_key: "sess-rebuild",
      plan_id: "plan_athlete-rebuild",
      plan_revision_key: revision.revision_key,
      scheduled_workout_key: "sw_athlete-rebuild_2026-08-19",
      scheduled_date: "2026-08-19",
      local_date: "2026-08-19",
      timezone_at_session: "Asia/Shanghai",
      title: "核心训练",
      status: "completed",
      snapshot,
      completion_results: ["left", "right"].map((side) => ({
        completion_item_key: `ci-${side}`,
        status: "completed",
        actual: { metric: "reps", value: 5 },
        resistance_mode: "bodyweight",
        resistance_kg: null,
        resistance: { mode: "bodyweight" },
        rir: 2,
        note: null,
        completed_at: "2026-08-19T12:10:00.000Z",
      })),
      set_results: [],
      training_intervals: [{ interval_key: "ti-rebuild", started_at: "2026-08-19T12:00:00.000Z", ended_at: "2026-08-19T12:10:00.000Z" }],
      session_rpe: 7,
      note: "完成",
      skip_reason: null,
      exercise_feedback: [{ exercise_occurrence_key: "dead_bug_main", text: "左右稳定" }],
      created_at: "2026-08-19T12:00:00.000Z",
      updated_at: "2026-08-19T12:10:00.000Z",
    }],
    aerobic_activities: [],
    routes: [],
    aerobic_projection: {},
    aerobic_date_projections: {},
    training_version: 1,
    updated_at: "2026-08-19T12:10:00.000Z",
    coach_share: null,
    agent_access: null,
    idempotency_records: [],
  };
}

test("bounded canonical rebuild replaces rows, clears legacy state arrays, and records rollback evidence", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const state = canonicalState();
    execMigrations(db);
    db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at, state_revision) VALUES (?, ?, ?, ?, ?)").run(state.athlete_key, state.email, JSON.stringify({ ...state, plan_revisions: [{ legacy: true }], sessions: [{ legacy: true }] }), state.updated_at, 4);
    db.exec(buildCanonicalRebuildSql(state, { now: "2026-08-19T12:30:00.000Z", rollbackRef: "workout-rollback-test", sourceStateRevision: 4 }));

    assert.equal(db.prepare("SELECT count(*) AS count FROM plans WHERE athlete_key = ?").get(state.athlete_key).count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM plan_revisions WHERE athlete_key = ?").get(state.athlete_key).count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM plan_sets").get().count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE athlete_key = ?").get(state.athlete_key).count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM completion_items WHERE session_key = ?").get("sess-rebuild").count, 2);
    assert.equal(db.prepare("SELECT count(*) AS count FROM set_results WHERE session_key = ?").get("sess-rebuild").count, 2);
    assert.equal(db.prepare("SELECT rollback_ref FROM workout_storage_cutover WHERE athlete_key = ?").get(state.athlete_key).rollback_ref, "workout-rollback-test");
    const persisted = JSON.parse(db.prepare("SELECT state_json FROM athlete_state WHERE athlete_key = ?").get(state.athlete_key).state_json);
    assert.deepEqual(persisted.plan_revisions, []);
    assert.deepEqual(persisted.sessions, []);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("canonical rebuild rejects legacy ranges and unknown Exercise IDs instead of repairing them", () => {
  const range = canonicalState();
  range.plan_revisions[0].week.wednesday.blocks[0].exercises[0].sets[0].target = { metric: "reps", min: 4, max: 5 };
  assert.throws(() => buildCanonicalRebuildSql(range), /non-canonical Set/);
  const unknown = canonicalState();
  unknown.plan_revisions[0].week.wednesday.blocks[0].exercises[0].exercise_id = "not_in_registry";
  assert.throws(() => buildCanonicalRebuildSql(unknown), /inactive or unknown Exercise/);
});
