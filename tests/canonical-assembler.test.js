// @ts-nocheck

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assembleCanonicalSession, assembleExerciseHistory } from "../src/canonical-assembler.js";
import { schemaResource } from "../src/coach.js";
import { athleteExport } from "../src/export.js";
import { planModel, validatePlanForState } from "../src/plan.js";
import { D1Store } from "../src/store.js";

class D1TestDb {
  /** @param {DatabaseSync} db */
  constructor(db) { this.db = db; }
  /** @param {string} sql */
  prepare(sql) {
    const statement = this.db.prepare(sql);
    return {
      bind: (...params) => ({
        first: async () => statement.get(...params),
        all: async () => ({ results: statement.all(...params) }),
        run: () => statement.run(...params),
        sql,
        params,
      }),
    };
  }
  /** @param {any[]} statements */
  async batch(statements) {
    return statements.map((statement) => {
      const result = statement.run();
      return { meta: { changes: Number(result.changes ?? 0) } };
    });
  }
}

function execMigrations(db) {
  for (const name of [
    "0001_initial.sql",
    "0002_state_revision.sql",
    "0003_query_indexes.sql",
    "0004_restore_session_date_guard.sql",
    "0005_agent_token_lookup.sql",
    "0006_canonical_plan_records.sql",
    "0007_canonical_session_records.sql",
    "0008_canonical_session_read_model.sql",
    "0009_canonical_workout_cutover.sql",
    "0010_plan_recording_intent.sql",
    "0011_mutation_owner.sql",
    "0012_exercise_category.sql",
  ]) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
}

function baseState(athleteKey, email) {
  return { athlete_key: athleteKey, email, display_name: athleteKey, timezone: "Asia/Shanghai", plan_revisions: [], sessions: [], aerobic_activities: [], routes: [], aerobic_projection: {}, aerobic_date_projections: {}, training_version: 0, updated_at: "2026-08-19T00:00:00.000Z", coach_share: null, agent_access: null, idempotency_records: [] };
}

function insertCanonicalRows(db, athleteKey, email, sessionKey, exerciseName) {
  db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at, state_revision) VALUES (?, ?, ?, ?, 0)").run(athleteKey, email, JSON.stringify(baseState(athleteKey, email)), "2026-08-19T00:00:00.000Z");
  db.prepare("INSERT INTO plans (plan_id, athlete_key, name, created_at) VALUES (?, ?, ?, ?)").run(`plan_${athleteKey}`, athleteKey, "Workout", "2026-08-01T00:00:00.000Z");
  db.prepare("INSERT INTO plan_revisions (plan_id, athlete_key, revision_key, revision_sequence, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(`plan_${athleteKey}`, athleteKey, `rev-${athleteKey}`, 1, "2026-08-01", "2026-08-01T00:00:00.000Z");
  db.prepare("INSERT INTO plan_slots (revision_key, weekday, kind, title, start_time, estimated_duration_min) VALUES (?, ?, ?, ?, ?, ?)").run(`rev-${athleteKey}`, "wednesday", "workout", "核心", "21:00", 20);
  db.prepare("INSERT INTO plan_exercises (revision_key, athlete_key, weekday, block_ordinal, block_title, exercise_ordinal, occurrence_key, exercise_id, execution_mode, name_snapshot, definition_version, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(`rev-${athleteKey}`, athleteKey, "wednesday", 1, "核心", 1, "dead_bug_main", "dead_bug", "alternating", exerciseName, 1, "strength");
  db.prepare("INSERT INTO plan_sets (revision_key, occurrence_key, set_id, ordinal, target_metric, target_value, resistance_mode, resistance_kg, tempo, rest_after_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(`rev-${athleteKey}`, "dead_bug_main", "dead_bug_set_1", 1, "reps", 5, "bodyweight", null, "3-1-1-0", 45);
  db.prepare("INSERT INTO sessions (athlete_key, session_key, plan_id, plan_revision_key, scheduled_date, timezone_at_session, title, status, created_at, updated_at, scheduled_workout_key, local_date, start_time, estimated_duration_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(athleteKey, sessionKey, `plan_${athleteKey}`, `rev-${athleteKey}`, "2026-08-19", "Asia/Shanghai", "核心", "partial", "2026-08-19T12:00:00.000Z", "2026-08-19T12:10:00.000Z", `sw_${athleteKey}_2026-08-19`, "2026-08-19", "21:00", 20);
  db.prepare("INSERT INTO session_exercises (session_key, occurrence_key, block_ordinal, block_title, exercise_ordinal, exercise_id, name_snapshot, definition_version, execution_mode, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sessionKey, "dead_bug_main", 1, "核心", 1, "dead_bug", exerciseName, 1, "alternating", "strength");
  const item = db.prepare("INSERT INTO completion_items (session_key, completion_item_key, occurrence_key, set_id, side, target_metric, target_value, resistance_mode, resistance_kg, tempo, rest_after_sec, set_ordinal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  item.run(sessionKey, `${sessionKey}-left`, "dead_bug_main", "dead_bug_set_1", "left", "reps", 5, "bodyweight", null, "3-1-1-0", 45, 1);
  item.run(sessionKey, `${sessionKey}-right`, "dead_bug_main", "dead_bug_set_1", "right", "reps", 5, "bodyweight", null, "3-1-1-0", 45, 1);
  db.prepare("INSERT INTO set_results (session_key, completion_item_key, status, actual_metric, actual_value, resistance_mode, resistance_kg, rir, note, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sessionKey, `${sessionKey}-left`, "completed", "reps", 5, "bodyweight", null, 2, "左侧稳定", "2026-08-19T12:05:00.000Z");
  db.prepare("INSERT INTO set_results (session_key, completion_item_key, status, actual_metric, actual_value, resistance_mode, resistance_kg, rir, note, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sessionKey, `${sessionKey}-right`, "partial", "reps", 3, "bodyweight", null, null, "右侧提前结束", "2026-08-19T12:06:00.000Z");
  db.prepare("INSERT INTO session_intervals (session_key, interval_key, started_at, ended_at) VALUES (?, ?, ?, ?)").run(sessionKey, `${sessionKey}-interval`, "2026-08-19T12:00:00.000Z", "2026-08-19T12:10:00.000Z");
  db.prepare("INSERT INTO exercise_feedback (session_key, occurrence_key, text) VALUES (?, ?, ?)").run(sessionKey, "dead_bug_main", "左右控制不同");
  db.prepare("INSERT INTO session_notes (session_key, note, skip_reason, session_rpe) VALUES (?, ?, ?, ?)").run(sessionKey, "完成训练", null, 7);
}

test("D1 canonical read boundary assembles independent rows, resolves current names, and isolates Athletes", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    execMigrations(db);
    insertCanonicalRows(db, "athlete-a", "a@example.invalid", "sess-a", "历史死虫");
    insertCanonicalRows(db, "athlete-b", "b@example.invalid", "sess-b", "乙的死虫");
    db.prepare("UPDATE plan_exercises SET category = ? WHERE athlete_key = ?").run("mobility", "athlete-a");
    db.prepare("UPDATE session_exercises SET category = ? WHERE session_key = ?").run("recovery", "sess-a");
    const store = new D1Store(new D1TestDb(db), {});
    const stateA = await store.getByEmail("a@example.invalid");
    assert.equal(stateA.plan_revisions[0].week.wednesday.blocks[0].exercises[0].name, "历史死虫");
    assert.equal(stateA.plan_revisions[0].week.wednesday.blocks[0].exercises[0].category, "mobility");
    const currentPlan = planModel(stateA, new Date("2026-08-19T13:00:00.000Z"));
    assert.equal(currentPlan.current.week.wednesday.blocks[0].exercises[0].name, "死虫");
    const session = stateA.sessions[0];
    assert.equal(session.snapshot.blocks[0].exercises[0].name, "历史死虫");
    assert.equal(session.snapshot.blocks[0].exercises[0].category, "recovery");
    assert.equal(session.snapshot.blocks[0].exercises[0].definition_version, 1);
    assert.deepEqual(session.snapshot.completion_items.map((item) => item.side), ["left", "right"]);
    assert.equal(session.completion_results[1].status, "partial");
    assert.equal(session.completion_results[1].note, "右侧提前结束");
    assert.equal(session.training_intervals[0].ended_at, "2026-08-19T12:10:00.000Z");
    assert.equal(session.exercise_feedback[0].text, "左右控制不同");
    const stateB = await store.getByEmail("b@example.invalid");
    assert.deepEqual(stateB.sessions.map((item) => item.session_key), ["sess-b"]);
    assert.notEqual(stateB.sessions[0].session_key, stateA.sessions[0].session_key);
  } finally {
    db.close();
  }
});

test("canonical Session completion items keep plan exercise groups contiguous", () => {
  const session = assembleCanonicalSession({
    session: {
      session_key: "sess-order",
      athlete_key: "athlete-order",
      scheduled_date: "2026-08-19",
      timezone_at_session: "Asia/Shanghai",
      title: "顺序测试",
      status: "in_progress",
      created_at: "2026-08-19T12:00:00.000Z",
      updated_at: "2026-08-19T12:00:00.000Z",
    },
    exercises: [
      { session_key: "sess-order", occurrence_key: "exercise-a", block_ordinal: 1, block_title: "主训练", exercise_ordinal: 1, exercise_id: "dead_bug", name_snapshot: "动作一", definition_version: 1, category: "strength", execution_mode: "none" },
      { session_key: "sess-order", occurrence_key: "exercise-b", block_ordinal: 1, block_title: "主训练", exercise_ordinal: 2, exercise_id: "glute_bridge", name_snapshot: "动作二", definition_version: 1, category: "strength", execution_mode: "none" },
    ],
    completionItems: [
      { session_key: "sess-order", completion_item_key: "b-set-2", occurrence_key: "exercise-b", set_id: "b-2", set_ordinal: 2, side: "none", target_metric: "reps", target_value: 8, resistance_mode: "bodyweight", resistance_kg: null, tempo: null, rest_after_sec: 30 },
      { session_key: "sess-order", completion_item_key: "a-set-1", occurrence_key: "exercise-a", set_id: "a-1", set_ordinal: 1, side: "none", target_metric: "reps", target_value: 8, resistance_mode: "bodyweight", resistance_kg: null, tempo: null, rest_after_sec: 30 },
      { session_key: "sess-order", completion_item_key: "b-set-1", occurrence_key: "exercise-b", set_id: "b-1", set_ordinal: 1, side: "none", target_metric: "reps", target_value: 8, resistance_mode: "bodyweight", resistance_kg: null, tempo: null, rest_after_sec: 30 },
      { session_key: "sess-order", completion_item_key: "a-set-2", occurrence_key: "exercise-a", set_id: "a-2", set_ordinal: 2, side: "none", target_metric: "reps", target_value: 8, resistance_mode: "bodyweight", resistance_kg: null, tempo: null, rest_after_sec: 30 },
    ],
  });

  assert.deepEqual(session.snapshot.completion_items.map((item) => [item.exercise_occurrence_key, item.set_ordinal]), [
    ["exercise-a", 1],
    ["exercise-a", 2],
    ["exercise-b", 1],
    ["exercise-b", 2],
  ]);
});

test("canonical Exercise history groups stable IDs across snapshot name changes and preserves side series", () => {
  const session = {
    session_key: "sess-history",
    scheduled_date: "2026-08-19",
    status: "completed",
    snapshot: {
      blocks: [{ exercises: [{ exercise_occurrence_key: "dead_bug_main", exercise_id: "dead_bug", name: "历史死虫", definition_version: 1 }] }],
      completion_items: [{ completion_item_key: "left", exercise_occurrence_key: "dead_bug_main", set_id: "set-1", side: "left", target: { metric: "reps", value: 5 } }],
    },
    completion_results: [{ completion_item_key: "left", status: "completed", actual: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, resistance: { mode: "bodyweight" }, rir: 2, note: null, completed_at: "2026-08-19T12:00:00.000Z" }],
  };
  const history = assembleExerciseHistory([session], "dead_bug");
  assert.equal(history.exercise_id, "dead_bug");
  assert.equal(history.current_name, "死虫");
  assert.equal(history.display_name_history[0].name, "历史死虫");
  assert.equal(history.series.left[0].actual.value, 5);
  assert.equal(history.series.right.length, 0);
});

test("canonical read adapters expose the same detailed session facts", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    execMigrations(db);
    insertCanonicalRows(db, "athlete-a", "a@example.invalid", "sess-a", "历史死虫");
    const store = new D1Store(new D1TestDb(db), {});
    const state = await store.getByEmail("a@example.invalid");
    const exported = athleteExport(state, new Date("2026-08-20T00:00:00.000Z"));
    assert.equal(exported.status, 200);
    assert.equal(exported.value.sessions[0].snapshot.schema_version, 2);
    assert.equal(exported.value.sessions[0].snapshot.completion_items[0].side, "left");
    assert.equal(exported.value.sessions[0].completion_results[1].status, "partial");
    const schema = schemaResource("session_detail");
    assert.deepEqual(schema.properties.snapshot.properties.schema_version, { const: 2 });
    assert.deepEqual(schema.properties.snapshot.properties.completion_items.items.properties.side.enum, ["none", "both", "left", "right"]);
    assert.deepEqual(schema.properties.completion_results.items.properties.status.enum, ["completed", "partial", "skipped"]);
    const summary = schemaResource("session_index").properties.items.items.properties;
    assert.equal(summary.local_date.type, "string");
    assert.equal(summary.exercise_ids.items.type, "string");
  } finally {
    db.close();
  }
});

test("D1 canonical save replaces Session facts without duplicating immutable Plan rows", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    execMigrations(db);
    insertCanonicalRows(db, "athlete-a", "a@example.invalid", "sess-a", "历史死虫");
    const store = new D1Store(new D1TestDb(db), {});
    const state = await store.getByEmail("a@example.invalid");
    const routeRevision = structuredClone(state.plan_revisions[0]);
    routeRevision.revision_key = "rev-athlete-a-route";
    routeRevision.revision_sequence = 2;
    routeRevision.effective_from = "2026-08-24";
    routeRevision.created_at = "2026-08-20T00:00:00.000Z";
    routeRevision.week.wednesday.recording_intent = { schema_version: 1, source: "coros", sport_type: 102, route_key: "香山鸡腿线" };
    state.plan_revisions.push(routeRevision);
    await store.save(state);
    const rebuilt = await store.getByEmail("a@example.invalid");
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE athlete_key = ?").get("athlete-a").count, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM plan_revisions WHERE athlete_key = ?").get("athlete-a").count, 2);
    assert.equal(db.prepare("SELECT count(*) AS count FROM set_results WHERE session_key = ?").get("sess-a").count, 2);
    assert.equal(rebuilt.sessions[0].snapshot.completion_items[1].side, "right");
    assert.equal(rebuilt.plan_revisions[0].week.wednesday.blocks[0].exercises[0].sets[0].tempo, "3-1-1-0");
    assert.deepEqual(rebuilt.plan_revisions[1].week.wednesday.recording_intent, { schema_version: 1, source: "coros", sport_type: 102, route_key: "香山鸡腿线" });
  } finally {
    db.close();
  }
});

test("D1 cutover makes canonical rows authoritative and supports clearing canonical Sessions", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    execMigrations(db);
    insertCanonicalRows(db, "athlete-a", "a@example.invalid", "sess-a", "历史死虫");
    const legacyState = baseState("athlete-a", "a@example.invalid");
    legacyState.plan_revisions = [{ revision_key: "legacy-revision" }];
    legacyState.sessions = [{ session_key: "legacy-session", scheduled_date: "2026-08-19" }];
    db.prepare("UPDATE athlete_state SET state_json = ? WHERE athlete_key = ?").run(JSON.stringify(legacyState), "athlete-a");
    db.prepare("INSERT INTO workout_storage_cutover (athlete_key, canonical_version, rebuilt_at, source_state_revision, rollback_ref) VALUES (?, ?, ?, ?, ?)").run("athlete-a", 1, "2026-08-19T00:00:00.000Z", 0, "rollback");
    const store = new D1Store(new D1TestDb(db), {});
    const state = await store.getByEmail("a@example.invalid");
    assert.equal(state.__canonicalCutover, true);
    const legacyPackage = validatePlanForState(state, JSON.stringify({
      schema_version: 1,
      effective_from: "2026-08-20",
      week: { monday: null, tuesday: { kind: "rest" }, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    }), new Date("2026-08-19T00:00:00.000Z"));
    assert.equal(legacyPackage.ok, false);
    assert.match(legacyPackage.errors[0].message, /schema_version 2/);
    assert.equal(state.plan_revisions[0].revision_key, "rev-athlete-a");
    assert.equal(state.sessions[0].session_key, "sess-a");
    await store.save(state);
    const persisted = JSON.parse(db.prepare("SELECT state_json FROM athlete_state WHERE athlete_key = ?").get("athlete-a").state_json);
    assert.deepEqual(persisted.plan_revisions, []);
    assert.deepEqual(persisted.sessions, []);
    assert.equal(db.prepare("SELECT count(*) AS count FROM plan_revision_index WHERE athlete_key = ?").get("athlete-a").count, 0);
    state.sessions = [];
    await store.save(state);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE athlete_key = ?").get("athlete-a").count, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM plan_revisions WHERE athlete_key = ?").get("athlete-a").count, 1);
  } finally {
    db.close();
  }
});

test("new D1 Athletes enter the canonical boundary without an implicit legacy dual-write", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    execMigrations(db);
    const store = new D1Store(new D1TestDb(db), {});
    await store.ensureAthletes([{ email: "new@example.invalid", displayName: "New", timezone: "Asia/Shanghai" }]);
    const row = db.prepare("SELECT athlete_key, state_json FROM athlete_state WHERE email = ?").get("new@example.invalid");
    const marker = db.prepare("SELECT canonical_version FROM workout_storage_cutover WHERE athlete_key = ?").get(row.athlete_key);
    assert.equal(marker.canonical_version, 1);
    assert.deepEqual(JSON.parse(row.state_json).plan_revisions, []);
    const loaded = await store.getByEmail("new@example.invalid");
    assert.deepEqual(loaded.plan_revisions, []);
    assert.deepEqual(loaded.sessions, []);
  } finally {
    db.close();
  }
});
