// @ts-nocheck

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createHandler } from "../src/http.js";
import { D1Store, MemoryStore, emptyAthlete } from "../src/store.js";
import { WEEKDAYS, addDays } from "../src/util.js";
import { appendPlanRevision } from "../src/plan.js";

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
  "0010_plan_recording_intent.sql",
  "0011_mutation_owner.sql",
  "0012_exercise_category.sql",
  "0013_planned_days.sql",
];
const D1_MUTATION_STATEMENT_BUDGET = 40;
const D1_WORKER_QUERY_BUDGET = 45;
const D1_INVOCATION_LIMIT = 50;

class D1SqliteDb {
  /** @param {DatabaseSync} db */
  constructor(db) {
    this.db = db;
    this.batchStatementCounts = [];
    this.queryExecutionCount = 0;
  }

  /** @param {string} sql */
  prepare(sql) {
    const statement = this.db.prepare(sql);
    const execute = (callback) => {
      this.queryExecutionCount += 1;
      return callback();
    };
    const bound = (params = []) => ({
      first: async () => execute(() => statement.get(...params)),
      all: async () => execute(() => ({ results: statement.all(...params) })),
      run: () => execute(() => statement.run(...params)),
      sql,
      params,
    });
    return {
      bind: (...params) => bound(params),
      first: async () => execute(() => statement.get()),
      all: async () => execute(() => ({ results: statement.all() })),
      run: () => execute(() => statement.run()),
      sql,
      params: [],
    };
  }

  /** @param {any[]} statements */
  async batch(statements) {
    this.batchStatementCounts.push(statements.length);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        const result = statement.run();
        return { meta: { changes: Number(result.changes ?? 0) } };
      });
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of MIGRATIONS) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const db = new D1SqliteDb(sqlite);
  return { sqlite, db, store: new D1Store(db, {}) };
}

async function createAthlete(store, email = "athlete-a@example.invalid") {
  await store.ensureAthletes([{ email, displayName: "Athlete A", timezone: "Asia/Shanghai" }]);
  return store.getByEmail(email);
}

function tokenState(digest, suffix = "current") {
  return {
    token_digest: digest,
    share_key: `share-${suffix}`,
    lookup_key_version: 1,
    encryption_key_version: 1,
    revoked_at: null,
  };
}

function canonicalPlan() {
  const exercise = {
    occurrence_key: "dead_bug_main",
    exercise_id: "dead_bug",
    execution_mode: "alternating",
    category: "mobility",
    name: "死虫",
    definition_version: 1,
    sets: [{ set_id: "dead_bug_set_1", ordinal: 1, target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, tempo: "3-1-1-0", rest_after_sec: 45 }],
  };
  return {
    revision_key: "revision-1",
    revision_sequence: 1,
    effective_from: "2026-01-01",
    created_at: "2026-01-01T00:00:00.000Z",
    week: Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, weekday === "monday" ? { kind: "workout", title: "核心", start_time: "21:00", estimated_duration_min: 20, blocks: [{ title: "主训练", exercises: [exercise] }] } : null])),
  };
}

function canonicalSession(index) {
  const scheduledDate = addDays("2026-01-05", index);
  const sessionKey = `session-${String(index).padStart(3, "0")}`;
  return {
    session_key: sessionKey,
    plan_id: null,
    plan_revision_key: "revision-1",
    scheduled_date: scheduledDate,
    local_date: scheduledDate,
    timezone_at_session: "Asia/Shanghai",
    title: "核心",
    status: "completed",
    created_at: `${scheduledDate}T12:00:00.000Z`,
    updated_at: `${scheduledDate}T12:20:00.000Z`,
    scheduled_workout_key: `scheduled-${index}`,
    snapshot: {
      schema_version: 2,
      start_time: "21:00",
      estimated_duration_min: 20,
      blocks: [{ title: "主训练", exercises: [{ exercise_occurrence_key: "dead_bug_main", exercise_id: "dead_bug", execution_mode: "alternating", name: "死虫", definition_version: 1, category: "recovery", sets: [{ set_id: "dead_bug_set_1", ordinal: 1, target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, tempo: "3-1-1-0", rest_after_sec: 45 }] }] }],
      completion_items: [{ completion_item_key: `${sessionKey}-left`, exercise_occurrence_key: "dead_bug_main", set_id: "dead_bug_set_1", set_ordinal: 1, side: "left", target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, tempo: "3-1-1-0", rest_after_sec: 45 }],
    },
    completion_results: [{ completion_item_key: `${sessionKey}-left`, status: "completed", actual: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, rir: 2, note: null, completed_at: `${scheduledDate}T12:10:00.000Z` }],
    training_intervals: [{ interval_key: `${sessionKey}-interval`, started_at: `${scheduledDate}T12:00:00.000Z`, ended_at: `${scheduledDate}T12:20:00.000Z` }],
    exercise_feedback: [],
    note: null,
    skip_reason: null,
    session_rpe: 7,
  };
}

async function seedCanonicalHistory(store, count) {
  const state = await createAthlete(store);
  state.plan_revisions = [canonicalPlan()];
  state.sessions = Array.from({ length: count }, (_, index) => {
    const session = canonicalSession(index);
    session.plan_id = `plan_${state.athlete_key}`;
    return session;
  });
  state.agent_access = { token_digest: "agent-current", revoked_at: null };
  state.coach_share = tokenState("coach-current");
  await store.save(state);
  return store.getByEmail(state.email);
}

test("MemoryStore transaction uses one explicit persistence instant for every save", async () => {
  const state = emptyAthlete({ email: "memory@example.invalid", displayName: "Memory", timezone: "Asia/Shanghai" });
  const store = new MemoryStore([state]);
  const requestNow = new Date("2026-08-29T03:04:05.678Z");
  const returned = await store.transaction(async (transactionStore) => {
    const current = await transactionStore.getByEmail(state.email);
    current.display_name = "First save";
    await transactionStore.save(current);
    assert.equal(current.updated_at, requestNow.toISOString());
    current.display_name = "Second save";
    await transactionStore.save(current);
    assert.equal(current.updated_at, requestNow.toISOString());
    return current;
  }, { now: requestNow });

  assert.equal(returned.updated_at, requestNow.toISOString());
  assert.equal((await store.getByEmail(state.email)).updated_at, requestNow.toISOString());
});

test("D1 transaction persists state and capability rows with one explicit request instant", async () => {
  const { sqlite, store } = createDatabase();
  try {
    const state = await createAthlete(store);
    const requestNow = "2026-08-29T03:04:05.678Z";
    const returned = await store.transaction(async (transactionStore) => {
      const current = await transactionStore.getByEmail(state.email);
      current.agent_access = { token_digest: "agent-fixed-clock", revoked_at: null };
      current.coach_share = tokenState("coach-fixed-clock", "fixed-clock");
      await transactionStore.save(current);
      assert.equal(current.updated_at, requestNow);
      current.display_name = "Fixed clock";
      await transactionStore.save(current);
      assert.equal(current.updated_at, requestNow);
      return current;
    }, { now: requestNow });

    assert.equal(returned.updated_at, requestNow);
    const stateRow = sqlite.prepare("SELECT state_json, updated_at FROM athlete_state WHERE athlete_key = ?").get(state.athlete_key);
    assert.equal(stateRow.updated_at, requestNow);
    assert.equal(JSON.parse(stateRow.state_json).updated_at, requestNow);
    assert.equal(sqlite.prepare("SELECT updated_at FROM agent_token_lookup WHERE athlete_key = ?").get(state.athlete_key).updated_at, requestNow);
    assert.equal(sqlite.prepare("SELECT updated_at FROM coach_share_lookup WHERE athlete_key = ?").get(state.athlete_key).updated_at, requestNow);
    assert.equal((await store.getByEmail(state.email)).updated_at, requestNow);
  } finally {
    sqlite.close();
  }
});

test("persistence rejects an invalid explicit instant before running a transaction or touching D1", async () => {
  const { sqlite, db, store } = createDatabase();
  try {
    let called = false;
    db.queryExecutionCount = 0;
    await assert.rejects(store.transaction(async () => { called = true; }, { now: "not-an-instant" }), (error) => error?.code === "INVALID_PERSISTENCE_INSTANT");
    assert.equal(called, false);
    assert.equal(db.queryExecutionCount, 0);
    await assert.rejects(new MemoryStore().transaction(async () => { called = true; }, { now: new Date(Number.NaN) }), (error) => error?.code === "INVALID_PERSISTENCE_INSTANT");
    assert.equal(called, false);
  } finally {
    sqlite.close();
  }
});

test("D1 token lookup rejects a stale Agent or Coach index that disagrees with current Athlete state", async () => {
  const { sqlite, store } = createDatabase();
  try {
    const state = await createAthlete(store);
    state.agent_access = { token_digest: "agent-current", revoked_at: null };
    state.coach_share = tokenState("coach-current");
    await store.save(state);

    sqlite.prepare("INSERT INTO agent_token_lookup (token_digest, athlete_key, revoked_at, updated_at) VALUES (?, ?, NULL, ?)").run("agent-stale", state.athlete_key, state.updated_at);
    sqlite.prepare("UPDATE coach_share_lookup SET token_digest = ? WHERE athlete_key = ?").run("coach-stale", state.athlete_key);

    assert.equal(await store.findByAgentDigest("agent-stale"), null);
    assert.equal(await store.findByCoachDigest("coach-stale"), null);
    assert.equal((await store.findByAgentDigest("agent-current")).athlete_key, state.athlete_key);

    sqlite.prepare("UPDATE coach_share_lookup SET token_digest = ? WHERE athlete_key = ?").run("coach-current", state.athlete_key);
    assert.equal((await store.findByCoachDigest("coach-current")).athlete_key, state.athlete_key);
  } finally {
    sqlite.close();
  }
});

test("a stale D1 mutation has zero state, canonical, or capability lookup side effects", async () => {
  const { sqlite, store } = createDatabase();
  try {
    await seedCanonicalHistory(store, 1);
    const winner = await store.getByEmail("athlete-a@example.invalid");
    const stale = await store.getByEmail("athlete-a@example.invalid");

    winner.display_name = "Winner";
    winner.agent_access = { token_digest: "agent-winner", revoked_at: null };
    winner.coach_share = tokenState("coach-winner", "winner");
    winner.sessions[0].note = "winner-note";
    await store.save(winner);

    stale.display_name = "Stale";
    stale.agent_access = { token_digest: "agent-stale", revoked_at: null };
    stale.coach_share = tokenState("coach-stale", "stale");
    stale.sessions[0].note = "stale-note";
    const staleRevision = structuredClone(stale.plan_revisions[0]);
    staleRevision.revision_key = "revision-stale";
    staleRevision.revision_sequence = 2;
    staleRevision.effective_from = "2026-02-01";
    stale.plan_revisions.push(staleRevision);
    await assert.rejects(store.save(stale), (error) => error?.code === "D1_CONCURRENCY_CONFLICT");

    const current = await store.getByEmail("athlete-a@example.invalid");
    assert.equal(current.display_name, "Winner");
    assert.equal(current.sessions[0].note, "winner-note");
    assert.equal((await store.findByAgentDigest("agent-winner")).athlete_key, current.athlete_key);
    assert.equal(await store.findByAgentDigest("agent-stale"), null);
    assert.equal((await store.findByCoachDigest("coach-winner")).athlete_key, current.athlete_key);
    assert.equal(await store.findByCoachDigest("coach-stale"), null);
    assert.equal(sqlite.prepare("SELECT note FROM session_notes WHERE session_key = ?").get(current.sessions[0].session_key).note, "winner-note");
    assert.equal(sqlite.prepare("SELECT title FROM plan_slots WHERE revision_key = ? AND weekday = 'monday'").get("revision-1").title, "核心");
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM plan_revisions WHERE revision_key = ?").get("revision-stale").count, 0);
  } finally {
    sqlite.close();
  }
});

test("a stale mutation cannot revive Agent or Coach access after the winning mutation revokes it", async () => {
  const { sqlite, store } = createDatabase();
  try {
    await seedCanonicalHistory(store, 1);
    const winner = await store.getByEmail("athlete-a@example.invalid");
    const stale = await store.getByEmail("athlete-a@example.invalid");
    winner.agent_access.revoked_at = "2026-08-29T00:00:00.000Z";
    winner.coach_share.revoked_at = "2026-08-29T00:00:00.000Z";
    await store.save(winner);

    stale.agent_access = { token_digest: "agent-stale", revoked_at: null };
    stale.coach_share = tokenState("coach-stale", "stale-revival");
    await assert.rejects(store.save(stale), (error) => error?.code === "D1_CONCURRENCY_CONFLICT");

    assert.equal(await store.findByAgentDigest("agent-current"), null);
    assert.equal(await store.findByAgentDigest("agent-stale"), null);
    assert.equal(await store.findByCoachDigest("coach-current"), null);
    assert.equal(await store.findByCoachDigest("coach-stale"), null);
    const current = await store.getByEmail("athlete-a@example.invalid");
    assert.equal(current.agent_access.revoked_at, "2026-08-29T00:00:00.000Z");
    assert.equal(current.coach_share.revoked_at, "2026-08-29T00:00:00.000Z");
  } finally {
    sqlite.close();
  }
});

test("the first save after upgrade backfills canonical rows from pre-cutover state_json", async () => {
  const { sqlite, store } = createDatabase();
  try {
    const state = await createAthlete(store);
    state.plan_revisions = [canonicalPlan()];
    const session = canonicalSession(0);
    session.plan_id = `plan_${state.athlete_key}`;
    state.sessions = [session];
    sqlite.prepare("UPDATE athlete_state SET state_json = ? WHERE athlete_key = ?").run(JSON.stringify(state), state.athlete_key);
    sqlite.prepare("DELETE FROM workout_storage_cutover WHERE athlete_key = ?").run(state.athlete_key);

    const upgraded = await store.getByEmail(state.email);
    upgraded.display_name = "Saved after upgrade";
    await store.save(upgraded);

    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM plan_revisions WHERE athlete_key = ?").get(state.athlete_key).count, 1);
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM sessions WHERE athlete_key = ?").get(state.athlete_key).count, 1);
    assert.equal((await store.getByEmail(state.email)).sessions[0].session_key, session.session_key);
  } finally {
    sqlite.close();
  }
});

test("a pre-cutover stale loser cannot alter legacy indexes or a second Athlete", async () => {
  const { sqlite, store } = createDatabase();
  try {
    const state = await createAthlete(store);
    await store.ensureAthletes([{ email: "athlete-b@example.invalid", displayName: "Athlete B", timezone: "Asia/Shanghai" }]);
    state.plan_revisions = [canonicalPlan()];
    const session = canonicalSession(0);
    session.plan_id = `plan_${state.athlete_key}`;
    state.sessions = [session];
    sqlite.prepare("UPDATE athlete_state SET state_json = ? WHERE athlete_key = ?").run(JSON.stringify(state), state.athlete_key);
    sqlite.prepare("DELETE FROM workout_storage_cutover WHERE athlete_key = ?").run(state.athlete_key);

    const winner = await store.getByEmail(state.email);
    const stale = await store.getByEmail(state.email);
    winner.display_name = "Winner";
    winner.sessions[0].status = "partial";
    winner.sessions[0].note = "winner-note";
    await store.save(winner);

    stale.display_name = "Stale";
    stale.sessions[0].status = "skipped";
    stale.sessions[0].note = "stale-note";
    await assert.rejects(store.save(stale), (error) => error?.code === "D1_CONCURRENCY_CONFLICT");

    assert.equal(sqlite.prepare("SELECT status FROM session_index WHERE athlete_key = ?").get(state.athlete_key).status, "partial");
    assert.equal(sqlite.prepare("SELECT exercise_key FROM session_exercise_index WHERE athlete_key = ?").get(state.athlete_key).exercise_key, "dead_bug");
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM plan_revision_index WHERE athlete_key = ?").get(state.athlete_key).count, 1);
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM session_date_guard WHERE athlete_key = ?").get(state.athlete_key).count, 1);
    assert.equal((await store.getByEmail(state.email)).display_name, "Winner");
    const athleteB = await store.getByEmail("athlete-b@example.invalid");
    assert.equal(athleteB.display_name, "Athlete B");
    assert.equal(sqlite.prepare("SELECT state_revision FROM athlete_state WHERE athlete_key = ?").get(athleteB.athlete_key).state_revision, 0);
  } finally {
    sqlite.close();
  }
});

test("bulk persistence derives a missing Completion Item ordinal from its frozen Session set", async () => {
  const { sqlite, store } = createDatabase();
  try {
    const state = await createAthlete(store);
    state.plan_revisions = [canonicalPlan()];
    const session = canonicalSession(0);
    session.plan_id = `plan_${state.athlete_key}`;
    delete session.snapshot.completion_items[0].set_ordinal;
    state.sessions = [session];
    await store.save(state);
    assert.equal((await store.getByEmail(state.email)).sessions[0].snapshot.completion_items[0].set_ordinal, 1);
  } finally {
    sqlite.close();
  }
});

test("D1 canonical Plan and Session round-trip their independently frozen Exercise category", async () => {
  const { sqlite, store } = createDatabase();
  try {
    const state = await seedCanonicalHistory(store, 1);
    assert.equal(state.plan_revisions[0].week.monday.blocks[0].exercises[0].category, "mobility");
    assert.equal(state.sessions[0].snapshot.blocks[0].exercises[0].category, "recovery");
  } finally {
    sqlite.close();
  }
});

test("D1 canonical persistence fails closed when a Plan or Session Exercise lacks frozen category", async () => {
  {
    const { sqlite, store } = createDatabase();
    try {
      const state = await createAthlete(store);
      const plan = canonicalPlan();
      delete plan.week.monday.blocks[0].exercises[0].category;
      state.plan_revisions = [plan];
      await assert.rejects(store.save(state), /plan_exercises\.category is required/);
    } finally {
      sqlite.close();
    }
  }
  {
    const { sqlite, store } = createDatabase();
    try {
      const state = await createAthlete(store);
      state.plan_revisions = [canonicalPlan()];
      await store.save(state);
      const withSession = await store.getByEmail(state.email);
      const session = canonicalSession(0);
      session.plan_id = `plan_${state.athlete_key}`;
      delete session.snapshot.blocks[0].exercises[0].category;
      withSession.sessions = [session];
      await assert.rejects(store.save(withSession), /session_exercises\.category is required/);
    } finally {
      sqlite.close();
    }
  }
});

test("D1 saveMany rejects multi-Athlete writes before any database call or partial commit", async () => {
  const { sqlite, db, store } = createDatabase();
  try {
    const athleteA = await createAthlete(store);
    await store.ensureAthletes([{ email: "athlete-b@example.invalid", displayName: "Athlete B", timezone: "Asia/Shanghai" }]);
    const staleB = await store.getByEmail("athlete-b@example.invalid");
    const winnerB = await store.getByEmail("athlete-b@example.invalid");
    winnerB.display_name = "Athlete B winner";
    await store.save(winnerB);

    athleteA.display_name = "Athlete A must not commit";
    staleB.display_name = "Athlete B stale";
    db.queryExecutionCount = 0;
    db.batchStatementCounts.length = 0;
    await assert.rejects(store.saveMany([athleteA, staleB]), (error) => error?.code === "D1_MULTI_ATHLETE_TRANSACTION_UNSUPPORTED");

    assert.equal(db.queryExecutionCount, 0);
    assert.deepEqual(db.batchStatementCounts, []);
    assert.equal(JSON.parse(sqlite.prepare("SELECT state_json FROM athlete_state WHERE email = ?").get(athleteA.email).state_json).display_name, "Athlete A");
    assert.equal(JSON.parse(sqlite.prepare("SELECT state_json FROM athlete_state WHERE email = ?").get(staleB.email).state_json).display_name, "Athlete B winner");
  } finally {
    sqlite.close();
  }
});

test("D1 transaction flush rejects two dirty Athletes without issuing a persistence call", async () => {
  const { sqlite, db, store } = createDatabase();
  try {
    const athleteA = await createAthlete(store);
    await store.ensureAthletes([{ email: "athlete-b@example.invalid", displayName: "Athlete B", timezone: "Asia/Shanghai" }]);

    await assert.rejects(store.transaction(async (transactionStore) => {
      const stateA = await transactionStore.getByEmail(athleteA.email);
      const stateB = await transactionStore.getByEmail("athlete-b@example.invalid");
      stateA.display_name = "Athlete A must not commit";
      stateB.display_name = "Athlete B must not commit";
      await transactionStore.save(stateA);
      await transactionStore.save(stateB);
      db.queryExecutionCount = 0;
      db.batchStatementCounts.length = 0;
    }), (error) => error?.code === "D1_MULTI_ATHLETE_TRANSACTION_UNSUPPORTED");

    assert.equal(db.queryExecutionCount, 0);
    assert.deepEqual(db.batchStatementCounts, []);
    assert.equal(JSON.parse(sqlite.prepare("SELECT state_json FROM athlete_state WHERE email = ?").get(athleteA.email).state_json).display_name, "Athlete A");
    assert.equal(JSON.parse(sqlite.prepare("SELECT state_json FROM athlete_state WHERE email = ?").get("athlete-b@example.invalid").state_json).display_name, "Athlete B");
  } finally {
    sqlite.close();
  }
});

test("D1 persistence rejects mutation or removal of an immutable Plan Revision before database access", async () => {
  const { sqlite, db, store } = createDatabase();
  try {
    const state = await seedCanonicalHistory(store, 1);
    state.plan_revisions[0].week.monday.title = "mutated title";
    db.queryExecutionCount = 0;
    db.batchStatementCounts.length = 0;
    await assert.rejects(store.save(state), (error) => error?.code === "IMMUTABLE_PLAN_REVISION");
    assert.equal(db.queryExecutionCount, 0);
    assert.deepEqual(db.batchStatementCounts, []);
    assert.equal(sqlite.prepare("SELECT title FROM plan_slots WHERE revision_key = ? AND weekday = ?").get("revision-1", "monday").title, "核心");

    const removed = await store.getByEmail(state.email);
    removed.plan_revisions = [];
    db.queryExecutionCount = 0;
    await assert.rejects(store.save(removed), (error) => error?.code === "IMMUTABLE_PLAN_REVISION");
    assert.equal(db.queryExecutionCount, 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS count FROM plan_revisions WHERE athlete_key = ?").get(state.athlete_key).count, 1);
  } finally {
    sqlite.close();
  }
});

test("an ordinary D1 mutation uses a bounded statement count independent of Session history", async (t) => {
  const ordinaryMeasurements = [];
  const correctionMeasurements = [];
  const ordinaryInvocationQueries = [];
  const correctionInvocationQueries = [];
  for (const count of [1, 201]) {
    const { sqlite, db, store } = createDatabase();
    try {
      const state = await seedCanonicalHistory(store, count);
      db.batchStatementCounts.length = 0;
      db.queryExecutionCount = 0;
      state.display_name = `Changed with ${count} Sessions`;
      await store.save(state);
      ordinaryMeasurements.push(db.batchStatementCounts.at(-1));
      ordinaryInvocationQueries.push(db.queryExecutionCount);

      const corrected = await store.getByEmail(state.email);
      corrected.sessions.at(-1).note = "corrected";
      db.queryExecutionCount = 0;
      await store.save(corrected);
      correctionMeasurements.push(db.batchStatementCounts.at(-1));
      correctionInvocationQueries.push(db.queryExecutionCount);
      const readback = await store.getByEmail(state.email);
      assert.equal(readback.sessions.length, count);
      assert.equal(readback.sessions.at(-1).note, "corrected");
    } finally {
      sqlite.close();
    }
  }

  assert.ok(ordinaryMeasurements[0] <= D1_MUTATION_STATEMENT_BUDGET, `one-Session mutation used ${ordinaryMeasurements[0]} statements`);
  assert.ok(ordinaryMeasurements[1] <= D1_MUTATION_STATEMENT_BUDGET, `201-Session mutation used ${ordinaryMeasurements[1]} statements`);
  assert.ok(Math.abs(ordinaryMeasurements[1] - ordinaryMeasurements[0]) <= 2, `statement counts grew from ${ordinaryMeasurements[0]} to ${ordinaryMeasurements[1]}`);
  assert.ok(correctionMeasurements.every((count) => count <= D1_MUTATION_STATEMENT_BUDGET), `Session correction used ${correctionMeasurements.join(" and ")} statements`);
  assert.ok(Math.abs(correctionMeasurements[1] - correctionMeasurements[0]) <= 2, `correction counts grew from ${correctionMeasurements[0]} to ${correctionMeasurements[1]}`);
  assert.ok(ordinaryInvocationQueries.every((count) => count <= D1_WORKER_QUERY_BUDGET), `ordinary invocation used ${ordinaryInvocationQueries.join(" and ")} queries`);
  assert.ok(correctionInvocationQueries.every((count) => count <= D1_WORKER_QUERY_BUDGET), `correction invocation used ${correctionInvocationQueries.join(" and ")} queries`);
  t.diagnostic(`ordinary statement counts: 1 Session = ${ordinaryMeasurements[0]}, 201 Sessions = ${ordinaryMeasurements[1]}`);
  t.diagnostic(`one-Session correction statement counts: 1 Session history = ${correctionMeasurements[0]}, 201 Session history = ${correctionMeasurements[1]}, statement budget = ${D1_MUTATION_STATEMENT_BUDGET}`);
  t.diagnostic(`full mutation query counts including cutover read: ordinary = ${ordinaryInvocationQueries.join("/")}, correction = ${correctionInvocationQueries.join("/")}`);
});

test("a cold private mutation with 201 Sessions stays below the whole Worker invocation query budget", async (t) => {
  const { sqlite, db, store } = createDatabase();
  try {
    await seedCanonicalHistory(store, 201);
    const env = {
      DB: db,
      LOCAL_AUTH: "true",
      PUBLIC_ORIGIN: "https://workout.example",
      ATHLETE_A_EMAIL: "athlete-a@example.invalid",
      ATHLETE_B_EMAIL: "athlete-b@example.invalid",
      DEFAULT_TIMEZONE: "Asia/Shanghai",
    };
    const handler = createHandler(env, { clock: () => new Date("2026-08-29T00:00:00.000Z") });
    db.queryExecutionCount = 0;
    const response = await handler.fetch(new Request("https://workout.example/api/private/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://workout.example",
        "x-athlete-email": "athlete-a@example.invalid",
      },
      body: JSON.stringify({ display_name: "Athlete A updated", timezone: "Asia/Shanghai" }),
    }), env);
    assert.equal(response.status, 200);
    assert.ok(db.queryExecutionCount <= D1_WORKER_QUERY_BUDGET, `cold private mutation used ${db.queryExecutionCount} D1 queries`);
    assert.ok(db.queryExecutionCount < D1_INVOCATION_LIMIT, `cold private mutation exceeded the D1 limit with ${db.queryExecutionCount} queries`);
    t.diagnostic(`cold private mutation query count with 201 Sessions = ${db.queryExecutionCount}, Worker budget = ${D1_WORKER_QUERY_BUDGET}, D1 limit = ${D1_INVOCATION_LIMIT}`);
  } finally {
    sqlite.close();
  }
});

test("a cold Agent Planned Day move reuses authenticated D1 state and stays below the Worker query budget", async (t) => {
  const { sqlite, db, store } = createDatabase();
  try {
    const seeded = await seedCanonicalHistory(store, 201);
    const state = await store.getByEmail(seeded.email);
    const plan = {
      schema_version: 2,
      effective_from: "2026-08-24",
      week: Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, null])),
    };
    plan.week.saturday = { ...structuredClone(canonicalPlan().week.monday), title: "下肢力量与下坡耐受" };
    plan.week.sunday = { kind: "rest" };
    appendPlanRevision(state, plan, new Date("2026-08-23T04:00:00.000Z"));
    await store.save(state, { now: "2026-08-23T04:00:00.000Z" });

    const env = {
      DB: db,
      LOCAL_AUTH: "true",
      PUBLIC_ORIGIN: "https://workout.example",
      ATHLETE_A_EMAIL: "athlete-a@example.invalid",
      ATHLETE_B_EMAIL: "athlete-b@example.invalid",
      DEFAULT_TIMEZONE: "Asia/Shanghai",
      AGENT_TOKEN_SECRET: "test-only-agent-token-secret",
    };
    const handler = createHandler(env, { clock: () => new Date("2026-08-30T04:00:00.000Z") });
    const accessResponse = await handler.fetch(new Request("https://workout.example/api/private/agent-access", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://workout.example", "x-athlete-email": state.email },
      body: "{}",
    }), env);
    assert.equal(accessResponse.status, 201);
    const token = (await accessResponse.json()).token;
    const move = { source_date: "2026-08-29", target_date: "2026-08-30" };
    const validateResponse = await handler.fetch(new Request("https://workout.example/api/agent/v1/planned-day-moves/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ move }),
    }), env);
    assert.equal(validateResponse.status, 200);
    const preview = await validateResponse.json();

    db.queryExecutionCount = 0;
    const applyResponse = await handler.fetch(new Request("https://workout.example/api/agent/v1/planned-day-moves/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": "d1-planned-day-move" },
      body: JSON.stringify({ move, move_digest: preview.move_digest, base_plan_digest: preview.base_plan_digest, confirmed: true }),
    }), env);
    assert.equal(applyResponse.status, 201);
    assert.ok(db.queryExecutionCount <= D1_WORKER_QUERY_BUDGET, `Agent Planned Day move used ${db.queryExecutionCount} D1 queries`);
    assert.ok(db.queryExecutionCount < D1_INVOCATION_LIMIT, `Agent Planned Day move exceeded the D1 limit with ${db.queryExecutionCount} queries`);
    t.diagnostic(`Agent Planned Day move query count with 201 Sessions = ${db.queryExecutionCount}, Worker budget = ${D1_WORKER_QUERY_BUDGET}, D1 limit = ${D1_INVOCATION_LIMIT}`);

    const readback = await store.getByEmail(state.email);
    assert.equal(readback.planned_days.find((day) => day.date === "2026-08-29").kind, "rest");
    assert.equal(readback.planned_days.find((day) => day.date === "2026-08-30").kind, "workout");
  } finally {
    sqlite.close();
  }
});

test("a real HTTP correction with 201 Sessions stays below the D1 invocation limit", async (t) => {
  const { sqlite, db, store } = createDatabase();
  try {
    const state = await seedCanonicalHistory(store, 201);
    const session = state.sessions.at(-1);
    const env = {
      DB: db,
      LOCAL_AUTH: "true",
      PUBLIC_ORIGIN: "https://workout.example",
      ATHLETE_A_EMAIL: "athlete-a@example.invalid",
      ATHLETE_B_EMAIL: "athlete-b@example.invalid",
      DEFAULT_TIMEZONE: "Asia/Shanghai",
    };
    const handler = createHandler(env, { clock: () => new Date("2026-08-29T00:00:00.000Z") });
    const detailResponse = await handler.fetch(new Request(`https://workout.example/api/private/sessions/${session.session_key}`, {
      headers: { "x-athlete-email": state.email },
    }), env);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    const setResults = detail.set_results.map((result) => ({
      completion_item_key: result.completion_item_key,
      status: result.status,
      actual: result.actual,
      resistance: result.resistance,
      rir: result.rir,
      note: "corrected through HTTP",
      completed_at: result.completed_at,
    }));
    db.queryExecutionCount = 0;
    const response = await handler.fetch(new Request(`https://workout.example/api/private/sessions/${session.session_key}/record`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://workout.example",
        "x-athlete-email": state.email,
      },
      body: JSON.stringify({
        record_schema_version: 2,
        set_results: setResults,
        training_intervals: detail.training_intervals,
        session_rpe: detail.session_rpe,
        note: "corrected through HTTP",
        exercise_feedback: detail.exercise_feedback,
        skip_reason: detail.skip_reason,
      }),
    }), env);
    assert.equal(response.status, 200);
    assert.ok(db.queryExecutionCount <= D1_WORKER_QUERY_BUDGET, `HTTP correction used ${db.queryExecutionCount} D1 queries`);
    assert.ok(db.queryExecutionCount < D1_INVOCATION_LIMIT, `HTTP correction exceeded the D1 limit with ${db.queryExecutionCount} queries`);
    t.diagnostic(`HTTP correction query count with 201 Sessions = ${db.queryExecutionCount}, Worker budget = ${D1_WORKER_QUERY_BUDGET}, D1 limit = ${D1_INVOCATION_LIMIT}`);
  } finally {
    sqlite.close();
  }
});
