import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/0004_restore_session_date_guard.sql", import.meta.url), "utf8");
const initialMigration = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
const agentTokenMigration = readFileSync(new URL("../migrations/0005_agent_token_lookup.sql", import.meta.url), "utf8");
const canonicalPlanMigration = readFileSync(new URL("../migrations/0006_canonical_plan_records.sql", import.meta.url), "utf8");
const routeRecordingMigration = readFileSync(new URL("../migrations/0010_plan_recording_intent.sql", import.meta.url), "utf8");
const mutationOwnerMigration = readFileSync(new URL("../migrations/0011_mutation_owner.sql", import.meta.url), "utf8");
const canonicalSessionMigration = readFileSync(new URL("../migrations/0007_canonical_session_records.sql", import.meta.url), "utf8");
const exerciseCategoryMigration = readFileSync(new URL("../migrations/0012_exercise_category.sql", import.meta.url), "utf8");
const plannedDaysMigration = readFileSync(new URL("../migrations/0013_planned_days.sql", import.meta.url), "utf8");
const endurancePrescriptionMigration = readFileSync(new URL("../migrations/0014_endurance_prescription_external_completion.sql", import.meta.url), "utf8");
const exerciseRegistry = JSON.parse(readFileSync(new URL("../config/exercises.json", import.meta.url), "utf8"));

test("ticket 24 migration restores an idempotent per-Athlete date guard", () => {
  const db = new DatabaseSync(":memory:");

  try {
    db.exec(migration);
    db.exec(migration);

    const insert = db.prepare("INSERT INTO session_date_guard (athlete_key, scheduled_date, session_key) VALUES (?, ?, ?)");
    insert.run("athlete-a", "2026-08-03", "session-a");
    insert.run("athlete-b", "2026-08-03", "session-b");

    assert.throws(
      () => insert.run("athlete-a", "2026-08-03", "session-a-retry"),
      /constraint/i,
      "one Athlete cannot have two Sessions on the same scheduled date"
    );
    assert.throws(
      () => insert.run("athlete-c", "2026-08-04", "session-a"),
      /constraint/i,
      "one Session key cannot be reused across dates or Athletes"
    );

    const indexes = db.prepare("PRAGMA index_list('session_date_guard')").all();
    assert.ok(indexes.some((index) => index.name === "idx_session_guard_date"));
  } finally {
    db.close();
  }
});

test("ticket 01 migration adds an idempotent Agent Token lookup boundary", () => {
  const db = new DatabaseSync(":memory:");

  try {
    db.exec(initialMigration);
    db.exec(agentTokenMigration);
    db.exec(agentTokenMigration);
    db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at) VALUES (?, ?, ?, ?)").run("athlete-a", "a@example.invalid", "{}", "2026-08-07T00:00:00.000Z");
    const insert = db.prepare("INSERT INTO agent_token_lookup (token_digest, athlete_key, revoked_at, updated_at) VALUES (?, ?, ?, ?)");
    insert.run("digest-a", "athlete-a", null, "2026-08-07T00:00:00.000Z");
    assert.throws(() => insert.run("digest-a", "athlete-a", null, "2026-08-07T00:00:00.000Z"), /constraint/i);
    const row = db.prepare("SELECT revoked_at FROM agent_token_lookup WHERE token_digest = ?").get("digest-a");
    assert.ok(row);
    assert.equal(row.revoked_at, null);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_token_lookup'").get());
  } finally {
    db.close();
  }
});

test("plan recording intent migration adds nullable COROS route columns", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(initialMigration);
    db.exec(canonicalPlanMigration);
    db.exec(routeRecordingMigration);
    const columns = db.prepare("PRAGMA table_info('plan_slots')").all().map((column) => column.name);
    assert.ok(columns.includes("recording_source"));
    assert.ok(columns.includes("recording_sport_type"));
    assert.ok(columns.includes("recording_route_key"));
  } finally {
    db.close();
  }
});

test("mutation owner migration preserves existing Athlete state and adds the conditional-write identity", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(initialMigration);
    db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at) VALUES (?, ?, ?, ?)").run("athlete-a", "a@example.invalid", '{"display_name":"Existing"}', "2026-08-29T00:00:00.000Z");
    db.exec(mutationOwnerMigration);
    const row = db.prepare("SELECT state_json, mutation_owner FROM athlete_state WHERE athlete_key = ?").get("athlete-a");
    assert.ok(row);
    assert.equal(typeof row.state_json, "string");
    assert.equal(JSON.parse(String(row.state_json)).display_name, "Existing");
    assert.equal(row.mutation_owner, null);
  } finally {
    db.close();
  }
});

function createCategoryMigrationDatabase(exerciseIds) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(initialMigration);
  db.exec(canonicalPlanMigration);
  db.exec(canonicalSessionMigration);
  db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at) VALUES (?, ?, ?, ?)").run("athlete-a", "a@example.invalid", "{}", "2026-08-29T00:00:00.000Z");
  db.prepare("INSERT INTO plans (plan_id, athlete_key, name, created_at) VALUES (?, ?, ?, ?)").run("plan-a", "athlete-a", "Workout", "2026-08-29T00:00:00.000Z");
  db.prepare("INSERT INTO plan_revisions (plan_id, athlete_key, revision_key, revision_sequence, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("plan-a", "athlete-a", "revision-a", 1, "2026-08-29", "2026-08-29T00:00:00.000Z");
  db.prepare("INSERT INTO sessions (athlete_key, session_key, plan_id, plan_revision_key, scheduled_date, timezone_at_session, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("athlete-a", "session-a", "plan-a", "revision-a", "2026-08-29", "Asia/Shanghai", "Workout", "completed", "2026-08-29T00:00:00.000Z", "2026-08-29T01:00:00.000Z");
  const planInsert = db.prepare("INSERT INTO plan_exercises (revision_key, athlete_key, weekday, block_ordinal, block_title, exercise_ordinal, occurrence_key, exercise_id, execution_mode, name_snapshot, definition_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const sessionInsert = db.prepare("INSERT INTO session_exercises (session_key, occurrence_key, block_ordinal, block_title, exercise_ordinal, exercise_id, name_snapshot, definition_version, execution_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  exerciseIds.forEach((exerciseId, index) => {
    const occurrenceKey = `occurrence_${index}`;
    planInsert.run("revision-a", "athlete-a", "monday", 1, "Main", index + 1, occurrenceKey, exerciseId, "none", exerciseId, 1);
    sessionInsert.run("session-a", occurrenceKey, 1, "Main", index + 1, exerciseId, exerciseId, 1, "none");
  });
  return db;
}

test("Exercise category migration backfills its 26 historical pinned IDs and requires future frozen values", () => {
  const expected = new Map(exerciseRegistry.exercises.filter((exercise) => exercise.exercise_id !== "stability_ball_hamstring_curl").map((exercise) => [exercise.exercise_id, exercise.category]));
  assert.equal(expected.size, 26);
  const db = createCategoryMigrationDatabase([...expected.keys()]);
  try {
    db.exec(exerciseCategoryMigration);
    const planRows = db.prepare("SELECT exercise_id, category FROM plan_exercises ORDER BY exercise_id").all();
    const sessionRows = db.prepare("SELECT exercise_id, category FROM session_exercises ORDER BY exercise_id").all();
    assert.deepEqual(new Map(planRows.map((row) => [row.exercise_id, row.category])), expected);
    assert.deepEqual(new Map(sessionRows.map((row) => [row.exercise_id, row.category])), expected);
    assert.throws(() => db.prepare("INSERT INTO plan_exercises (revision_key, athlete_key, weekday, block_ordinal, block_title, exercise_ordinal, occurrence_key, exercise_id, execution_mode, name_snapshot, definition_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("revision-a", "athlete-a", "tuesday", 1, "Main", 1, "missing_category", "dead_bug", "none", "dead_bug", 1), /category is required/);
    assert.throws(() => db.prepare("UPDATE plan_exercises SET category = NULL WHERE occurrence_key = ?").run("occurrence_0"), /category is required/);
    assert.throws(() => db.prepare("UPDATE session_exercises SET category = 'core' WHERE occurrence_key = ?").run("occurrence_0"), /constraint/i);
  } finally {
    db.close();
  }
});

test("Exercise category migration fails closed for an unknown historical Exercise ID", () => {
  const db = createCategoryMigrationDatabase(["unknown_historical_exercise"]);
  try {
    assert.throws(() => db.exec(exerciseCategoryMigration), /category|not null/i);
    assert.equal(db.prepare("PRAGMA table_info('plan_exercises')").all().some((column) => column.name === "category"), false);
    assert.equal(db.prepare("PRAGMA table_info('session_exercises')").all().some((column) => column.name === "category"), false);
  } finally {
    db.close();
  }
});

test("Planned Day migration materializes finite dated windows and lets the later write win overlaps", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(initialMigration);
    db.exec(canonicalPlanMigration);
    db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at) VALUES (?, ?, ?, ?)").run("athlete-a", "a@example.invalid", "{}", "2026-08-29T00:00:00.000Z");
    db.prepare("INSERT INTO plans (plan_id, athlete_key, name, created_at) VALUES (?, ?, ?, ?)").run("plan-a", "athlete-a", "Workout", "2026-08-29T00:00:00.000Z");
    const revisionInsert = db.prepare("INSERT INTO plan_revisions (plan_id, athlete_key, revision_key, revision_sequence, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    revisionInsert.run("plan-a", "athlete-a", "revision-a", 1, "2026-08-29", "2026-08-29T00:00:00.000Z");
    revisionInsert.run("plan-a", "athlete-a", "revision-b", 2, "2026-09-01", "2026-09-01T00:00:00.000Z");
    const slotInsert = db.prepare("INSERT INTO plan_slots (revision_key, weekday, kind, title, start_time, estimated_duration_min) VALUES (?, ?, ?, ?, ?, ?)");
    for (const revision of ["revision-a", "revision-b"]) {
      for (const weekday of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]) {
        const workoutDay = weekday === "saturday";
        slotInsert.run(revision, weekday, workoutDay ? "workout" : "rest", workoutDay ? revision : null, workoutDay ? "08:00" : null, workoutDay ? 60 : null);
      }
    }

    db.exec(plannedDaysMigration);

    assert.equal(db.prepare("SELECT count(*) AS count FROM plan_changes WHERE athlete_key = ?").get("athlete-a").count, 2);
    assert.equal(db.prepare("SELECT count(*) AS count FROM planned_days WHERE athlete_key = ?").get("athlete-a").count, 10);
    assert.equal(db.prepare("SELECT prescription_revision_key FROM planned_days WHERE athlete_key = ? AND planned_date = ?").get("athlete-a", "2026-08-29").prescription_revision_key, "revision-a");
    assert.equal(db.prepare("SELECT change_key FROM planned_days WHERE athlete_key = ? AND planned_date = ?").get("athlete-a", "2026-09-01").change_key, "legacy_revision-b");
    assert.equal(db.prepare("SELECT count(*) AS count FROM planned_days WHERE athlete_key = ? AND planned_date = ?").get("athlete-a", "2026-09-08").count, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("endurance prescription migration adds structured targets and constrained external completions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(initialMigration);
    db.exec(canonicalPlanMigration);
    db.exec(canonicalSessionMigration);
    db.exec(endurancePrescriptionMigration);
    const planColumns = new Set(db.prepare("PRAGMA table_info('plan_sets')").all().map((column) => column.name));
    assert.equal(planColumns.has("target_hr_zone_min"), true);
    assert.equal(planColumns.has("target_incline_percent"), true);
    assert.equal(planColumns.has("effort_cue"), true);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_external_completions'").get().name, "session_external_completions");
  } finally {
    db.close();
  }
});
