// @ts-nocheck

import { deepClone, normalizeEmail, opaqueKey, WEEKDAYS } from "./util.js";
import { assembleCanonicalState } from "./canonical-assembler.js";

/** @returns {any} */
export function emptyAthlete({ email, displayName, timezone }) {
  return {
    athlete_key: opaqueKey("ath"),
    email: normalizeEmail(email),
    display_name: displayName,
    timezone,
    plan_revisions: [],
    sessions: [],
    aerobic_activities: [],
    routes: [],
    aerobic_projection: { schema_version: 1, source_status: "none", source_statuses: { workout: "none", coros: "none" }, data_as_of: null, updated_at: null, activity_count: 0, publication_key: null },
    aerobic_date_projections: {},
    training_version: 0,
    updated_at: new Date().toISOString(),
    coach_share: null,
    agent_access: null,
    idempotency_records: [],
  };
}

export class MemoryStore {
  /** @param {Record<string, any>[]} [athletes] */
  constructor(athletes = []) {
    this.athletes = new Map(athletes.map((athlete) => [athlete.email, deepClone(athlete)]));
  }

  /** @param {string} email */
  async getByEmail(email) {
    const state = this.athletes.get(normalizeEmail(email));
    return state ? deepClone(state) : null;
  }

  /** @param {any} state */
  async save(state) {
    state.updated_at = new Date().toISOString();
    this.athletes.set(state.email, deepClone(state));
  }

  /** @returns {any[]} */
  async all() {
    return Array.from(this.athletes.values(), deepClone);
  }

  async findByAgentDigest(tokenDigest) {
    return findAgentState(this.athletes.values(), tokenDigest);
  }

  async transaction(fn) {
    const working = new Map(Array.from(this.athletes, ([email, state]) => [email, deepClone(state)]));
    const transactionStore = {
      getByEmail: async (email) => working.get(normalizeEmail(email)) ?? null,
      save: async (state) => { state.updated_at = new Date().toISOString(); working.set(state.email, deepClone(state)); },
      all: async () => Array.from(working.values(), deepClone),
      findByAgentDigest: async (tokenDigest) => findAgentState(working.values(), tokenDigest),
    };
    const result = await fn(transactionStore);
    this.athletes = working;
    return result;
  }
}

function findAgentState(states, tokenDigest) {
  return Array.from(states).find((state) => state.agent_access && !state.agent_access.revoked_at && state.agent_access.token_digest === tokenDigest) ?? null;
}

export class D1Store {
  /** @param {any} db @param {Record<string, any>} env */
  constructor(db, env) {
    this.db = db;
    this.env = env;
  }

  async getByEmail(email) {
    const result = await this.db.prepare("SELECT state_json, state_revision FROM athlete_state WHERE email = ?1").bind(normalizeEmail(email)).first();
    if (!result) return null;
    const state = JSON.parse(result.state_json);
    const cutover = await this.readCutover(state.athlete_key);
    const hydrated = await this.hydrateCanonicalState(state, { canonicalRequired: Boolean(cutover) });
    Object.defineProperty(hydrated, "__canonicalCutover", { value: Boolean(cutover), enumerable: false, writable: true });
    Object.defineProperty(hydrated, "__d1StateRevision", { value: Number(result.state_revision ?? 0), enumerable: false, writable: true });
    return hydrated;
  }

  async save(state) {
    await this.saveMany([state]);
  }

  async saveMany(states, expectedRevisions = new Map()) {
    const now = new Date().toISOString();
    const cutovers = new Map(await Promise.all(states.map(async (state) => [state.athlete_key, await this.readCutover(state.athlete_key)])));
    const statements = [];
    const stateStatementIndexes = [];
    for (const state of states) {
      const canonicalCutover = Boolean(cutovers.get(state.athlete_key));
      const persistedState = canonicalCutover ? { ...deepClone(state), plan_revisions: [], sessions: [] } : state;
      const expected = expectedRevisions instanceof Map ? (expectedRevisions.get(state.email) ?? state.__d1StateRevision) : (expectedRevisions[state.email] ?? state.__d1StateRevision);
      stateStatementIndexes.push(statements.length);
      if (Number.isInteger(expected)) {
        statements.push(this.db.prepare("UPDATE athlete_state SET state_json = ?1, updated_at = ?2, state_revision = state_revision + 1 WHERE email = ?3 AND state_revision = ?4").bind(JSON.stringify(persistedState), now, state.email, expected));
      } else {
        statements.push(this.db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at, state_revision) VALUES (?1, ?2, ?3, ?4, 0)").bind(state.athlete_key, state.email, JSON.stringify(persistedState), now));
      }
      if (!canonicalCutover) for (const session of state.sessions ?? []) statements.push(this.db.prepare("INSERT INTO session_date_guard (athlete_key, scheduled_date, session_key) VALUES (?1, ?2, ?3) ON CONFLICT(athlete_key, scheduled_date) DO UPDATE SET session_key = excluded.session_key WHERE session_date_guard.session_key = excluded.session_key").bind(state.athlete_key, session.scheduled_date, session.session_key));
      if (!canonicalCutover) statements.push(this.db.prepare("DELETE FROM plan_revision_index WHERE athlete_key = ?1").bind(state.athlete_key));
      if (!canonicalCutover) statements.push(this.db.prepare("DELETE FROM session_exercise_index WHERE athlete_key = ?1").bind(state.athlete_key));
      if (!canonicalCutover) statements.push(this.db.prepare("DELETE FROM session_index WHERE athlete_key = ?1").bind(state.athlete_key));
      statements.push(this.db.prepare("DELETE FROM coach_share_lookup WHERE athlete_key = ?1").bind(state.athlete_key));
      statements.push(this.db.prepare("DELETE FROM agent_token_lookup WHERE athlete_key = ?1").bind(state.athlete_key));
      if (!canonicalCutover) for (const revision of state.plan_revisions ?? []) statements.push(this.db.prepare("INSERT INTO plan_revision_index (athlete_key, revision_key, effective_from, revision_sequence) VALUES (?1, ?2, ?3, ?4)").bind(state.athlete_key, revision.revision_key, revision.effective_from, revision.revision_sequence));
      if (!canonicalCutover) for (const session of state.sessions ?? []) {
        statements.push(this.db.prepare("INSERT INTO session_index (athlete_key, session_key, scheduled_date, status, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(state.athlete_key, session.session_key, session.scheduled_date, session.status, session.updated_at));
        const exerciseKeys = new Set(session.snapshot?.blocks?.flatMap((block) => block.exercises.map((exercise) => exercise.exercise_key ?? exercise.exercise_id).filter(Boolean)) ?? []);
        for (const exerciseKey of exerciseKeys) statements.push(this.db.prepare("INSERT INTO session_exercise_index (athlete_key, exercise_key, session_key, scheduled_date) VALUES (?1, ?2, ?3, ?4)").bind(state.athlete_key, exerciseKey, session.session_key, session.scheduled_date));
      }
      appendCanonicalSessionDeleteStatements(this.db, statements, state, { force: canonicalCutover });
      appendCanonicalPlanStatements(this.db, statements, state, { canonical: canonicalCutover });
      appendCanonicalSessionInsertStatements(this.db, statements, state);
      if (state.coach_share) statements.push(this.db.prepare("INSERT INTO coach_share_lookup (token_digest, athlete_key, share_key, lookup_key_version, encryption_key_version, revoked_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(state.coach_share.token_digest, state.athlete_key, state.coach_share.share_key, state.coach_share.lookup_key_version, state.coach_share.encryption_key_version, state.coach_share.revoked_at, now));
      if (state.agent_access) statements.push(this.db.prepare("INSERT INTO agent_token_lookup (token_digest, athlete_key, revoked_at, updated_at) VALUES (?1, ?2, ?3, ?4)").bind(state.agent_access.token_digest, state.athlete_key, state.agent_access.revoked_at, now));
    }
    const results = await this.db.batch(statements);
    for (let index = 0; index < stateStatementIndexes.length; index += 1) {
      const result = results[stateStatementIndexes[index]];
      if (result?.meta?.changes !== 1) { const error = new Error("D1 state changed concurrently"); error.code = "D1_CONCURRENCY_CONFLICT"; throw error; }
      const state = states[index];
      const expected = expectedRevisions instanceof Map ? (expectedRevisions.get(state.email) ?? state.__d1StateRevision) : (expectedRevisions[state.email] ?? state.__d1StateRevision);
      if (Number.isInteger(expected)) Object.defineProperty(state, "__d1StateRevision", { value: expected + 1, enumerable: false, writable: true });
    }
  }

  async ensureAthletes(configured) {
    const existing = new Set();
    for (const { email } of configured) {
      const row = await this.db.prepare("SELECT athlete_key FROM athlete_state WHERE email = ?1").bind(normalizeEmail(email)).first();
      if (row?.athlete_key) existing.add(normalizeEmail(email));
    }
    const newStates = [];
    const statements = configured.filter(({ email }) => !existing.has(normalizeEmail(email))).map(({ email, displayName, timezone }) => {
      const state = emptyAthlete({ email, displayName, timezone });
      newStates.push(state);
      return this.db.prepare("INSERT OR IGNORE INTO athlete_state (athlete_key, email, state_json, updated_at, state_revision) VALUES (?1, ?2, ?3, ?4, 0)").bind(state.athlete_key, state.email, JSON.stringify(state), state.updated_at);
    });
    if (statements.length) await this.db.batch(statements);
    if (newStates.length) {
      try {
        await this.db.batch(newStates.map((state) => this.db.prepare("INSERT OR IGNORE INTO workout_storage_cutover (athlete_key, canonical_version, rebuilt_at, source_state_revision, rollback_ref) VALUES (?1, 1, ?2, 0, NULL)").bind(state.athlete_key, state.updated_at)));
      } catch (error) {
        if (!/no such table|no such column|does not exist/i.test(String(error?.message))) throw error;
      }
    }
  }

  async all() {
    const result = await this.db.prepare("SELECT email FROM athlete_state ORDER BY email").all();
    const rows = result.results ?? result;
    return Promise.all(rows.map((row) => this.getByEmail(row.email)));
  }

  async findByCoachDigest(tokenDigest) {
    const result = await this.db.prepare("SELECT a.email FROM coach_share_lookup AS c JOIN athlete_state AS a ON a.athlete_key = c.athlete_key WHERE c.token_digest = ?1 AND c.revoked_at IS NULL").bind(tokenDigest).first();
    return result ? this.getByEmail(result.email) : null;
  }

  async findByAgentDigest(tokenDigest) {
    const result = await this.db.prepare("SELECT a.email FROM agent_token_lookup AS t JOIN athlete_state AS a ON a.athlete_key = t.athlete_key WHERE t.token_digest = ?1 AND t.revoked_at IS NULL").bind(tokenDigest).first();
    return result ? this.getByEmail(result.email) : null;
  }

  /** @param {string} athleteKey */
  async readCutover(athleteKey) {
    try {
      return await this.db.prepare("SELECT canonical_version, rebuilt_at, source_state_revision, rollback_ref FROM workout_storage_cutover WHERE athlete_key = ?1").bind(athleteKey).first();
    } catch (error) {
      if (/no such table|no such column|does not exist/i.test(String(error?.message))) return null;
      throw error;
    }
  }

  /** @param {any} state @param {{ canonicalRequired?: boolean }} [options] */
  async hydrateCanonicalState(state, options = {}) {
    try {
      const rows = await readCanonicalRows(this.db, state.athlete_key);
      if (!rows) {
        if (options.canonicalRequired) return { ...state, plan_revisions: [], sessions: [] };
        return state;
      }
      return assembleCanonicalState(state, rows).state;
    } catch (error) {
      // Local fixtures can open the Worker before the explicit canonical
      // migrations. They retain the legacy state boundary until migration.
      if (!options.canonicalRequired && /no such table|no such column|does not exist/i.test(String(error?.message))) return state;
      throw error;
    }
  }

  async transaction(fn) {
    // The state row is serialized as one D1 document. The Worker still uses a
    // single logical transaction boundary; D1 batch is used by the save path.
    const working = new D1TransactionStore(this);
    const result = await fn(working);
    await working.flush();
    return result;
  }
}

/**
 * Write the canonical Plan read model when the state contains the new v2
 * prescription shape. Legacy state is intentionally not translated here;
 * the explicit clean-cut rebuild owns that boundary.
 *
 * @param {any} db
 * @param {any[]} statements
 * @param {any} state
 * @param {{ canonical?: boolean }} [options]
 */
function appendCanonicalPlanStatements(db, statements, state, options = {}) {
  const revisions = options.canonical
    ? (state.plan_revisions ?? [])
    : (state.plan_revisions ?? []).filter((revision) => revision.week && Object.values(revision.week).some((slot) => slot?.kind === "workout" && slot.blocks?.some((block) => block.exercises?.some((exercise) => exercise.occurrence_key))));
  if (revisions.length === 0) return;
  const planId = `plan_${state.athlete_key}`;
  const firstCreatedAt = revisions.slice().sort((left, right) => left.revision_sequence - right.revision_sequence)[0]?.created_at ?? new Date().toISOString();
  statements.push(db.prepare("INSERT OR IGNORE INTO plans (plan_id, athlete_key, name, created_at) VALUES (?1, ?2, ?3, ?4)").bind(planId, state.athlete_key, "Workout Plan", firstCreatedAt));
  for (const revision of revisions) {
    statements.push(db.prepare("INSERT OR IGNORE INTO plan_revisions (plan_id, athlete_key, revision_key, revision_sequence, effective_from, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(planId, state.athlete_key, revision.revision_key, revision.revision_sequence, revision.effective_from, revision.created_at));
    for (const weekday of WEEKDAYS) {
      const slot = revision.week[weekday];
      const kind = slot === null ? "no_plan" : slot?.kind === "rest" ? "rest" : "workout";
      statements.push(db.prepare("INSERT OR IGNORE INTO plan_slots (revision_key, weekday, kind, title, start_time, estimated_duration_min, recording_source, recording_sport_type, recording_route_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").bind(revision.revision_key, weekday, kind, slot?.kind === "workout" ? slot.title : null, slot?.kind === "workout" ? slot.start_time : null, slot?.kind === "workout" ? slot.estimated_duration_min : null, slot?.kind === "workout" ? slot.recording_intent?.source ?? null : null, slot?.kind === "workout" ? slot.recording_intent?.sport_type ?? null : null, slot?.kind === "workout" ? slot.recording_intent?.route_key ?? null : null));
      if (slot?.kind !== "workout") continue;
      slot.blocks.forEach((block, blockIndex) => block.exercises.forEach((exercise, exerciseIndex) => {
        statements.push(db.prepare("INSERT OR IGNORE INTO plan_exercises (revision_key, athlete_key, weekday, block_ordinal, block_title, exercise_ordinal, occurrence_key, exercise_id, execution_mode, name_snapshot, definition_version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)").bind(revision.revision_key, state.athlete_key, weekday, blockIndex + 1, block.title, exerciseIndex + 1, exercise.occurrence_key, exercise.exercise_id, exercise.execution_mode, exercise.name, exercise.definition_version));
        for (const set of exercise.sets) statements.push(db.prepare("INSERT OR IGNORE INTO plan_sets (revision_key, occurrence_key, set_id, ordinal, target_metric, target_value, resistance_mode, resistance_kg, tempo, rest_after_sec) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)").bind(revision.revision_key, exercise.occurrence_key, set.set_id, set.ordinal, set.target.metric, set.target.value, set.resistance_mode, set.resistance_kg, set.tempo, set.rest_after_sec));
      }));
    }
  }
}

/** @param {any} db @param {any[]} statements @param {any} state */
function canonicalSessionRows(state) {
  return (state.sessions ?? []).filter((session) => session.snapshot?.schema_version === 2 || session.snapshot?.blocks?.some((block) => block.exercises?.some((exercise) => exercise.exercise_id)));
}

/** @param {any} db @param {any[]} statements @param {any} state @param {{ force?: boolean }} [options] */
function appendCanonicalSessionDeleteStatements(db, statements, state, options = {}) {
  const sessions = canonicalSessionRows(state);
  if (sessions.length === 0 && !options.force) return;
  statements.push(db.prepare("DELETE FROM session_notes WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ?1)").bind(state.athlete_key));
  statements.push(db.prepare("DELETE FROM set_results WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ?1)").bind(state.athlete_key));
  statements.push(db.prepare("DELETE FROM completion_items WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ?1)").bind(state.athlete_key));
  statements.push(db.prepare("DELETE FROM session_exercises WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ?1)").bind(state.athlete_key));
  statements.push(db.prepare("DELETE FROM session_intervals WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ?1)").bind(state.athlete_key));
  statements.push(db.prepare("DELETE FROM exercise_feedback WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ?1)").bind(state.athlete_key));
  statements.push(db.prepare("DELETE FROM sessions WHERE athlete_key = ?1").bind(state.athlete_key));
}

/** @param {any} db @param {any[]} statements @param {any} state */
function appendCanonicalSessionInsertStatements(db, statements, state) {
  const sessions = canonicalSessionRows(state);
  if (sessions.length === 0) return;
  for (const session of sessions) {
    if (!session.plan_id || !session.plan_revision_key) throw new Error(`Canonical Session ${session.session_key} requires plan_id and plan_revision_key`);
    statements.push(db.prepare("INSERT INTO sessions (athlete_key, session_key, plan_id, plan_revision_key, scheduled_date, timezone_at_session, title, status, created_at, updated_at, scheduled_workout_key, local_date, start_time, estimated_duration_min) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)").bind(state.athlete_key, session.session_key, session.plan_id ?? null, session.plan_revision_key ?? null, session.local_date ?? session.scheduled_date, session.timezone_at_session, session.title, session.status, session.created_at, session.updated_at, session.scheduled_workout_key ?? null, session.local_date ?? session.scheduled_date, session.snapshot.start_time ?? null, session.snapshot.estimated_duration_min ?? null));
    session.snapshot.blocks.forEach((block, blockIndex) => block.exercises.forEach((exercise, exerciseIndex) => {
      const occurrenceKey = exercise.exercise_occurrence_key ?? exercise.occurrence_key;
      statements.push(db.prepare("INSERT INTO session_exercises (session_key, occurrence_key, block_ordinal, block_title, exercise_ordinal, exercise_id, name_snapshot, definition_version, execution_mode) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").bind(session.session_key, occurrenceKey, blockIndex + 1, block.title, exerciseIndex + 1, exercise.exercise_id, exercise.name, exercise.definition_version, exercise.execution_mode));
    }));
    for (const item of session.snapshot.completion_items) statements.push(db.prepare("INSERT INTO completion_items (session_key, completion_item_key, occurrence_key, set_id, side, target_metric, target_value, resistance_mode, resistance_kg, tempo, rest_after_sec, set_ordinal) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)").bind(session.session_key, item.completion_item_key, item.exercise_occurrence_key ?? item.occurrence_key, item.set_id ?? item.set_key, item.side, item.target.metric, item.target.value, item.resistance_mode ?? item.resistance?.mode ?? null, item.resistance_kg ?? item.resistance?.load_kg ?? null, item.tempo ?? null, item.rest_after_sec ?? null, item.set_ordinal ?? findSnapshotSetOrdinal(session.snapshot, item)));
    const results = Array.isArray(session.set_results) && session.set_results.length > 0 ? session.set_results : (session.completion_results ?? []);
    for (const result of results) statements.push(db.prepare("INSERT INTO set_results (session_key, completion_item_key, status, actual_metric, actual_value, resistance_mode, resistance_kg, rir, note, completed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)").bind(session.session_key, result.completion_item_key, result.status ?? (result.completed ? "completed" : "partial"), result.actual?.metric ?? null, result.actual?.value ?? null, result.resistance_mode ?? result.resistance?.mode ?? null, result.resistance_kg ?? result.resistance?.load_kg ?? null, result.rir ?? null, result.note ?? null, result.completed_at ?? null));
    for (const interval of session.training_intervals ?? []) statements.push(db.prepare("INSERT INTO session_intervals (session_key, interval_key, started_at, ended_at) VALUES (?1, ?2, ?3, ?4)").bind(session.session_key, interval.interval_key, interval.started_at, interval.ended_at));
    for (const feedback of session.exercise_feedback ?? []) statements.push(db.prepare("INSERT INTO exercise_feedback (session_key, occurrence_key, text) VALUES (?1, ?2, ?3)").bind(session.session_key, feedback.exercise_occurrence_key, feedback.text));
    statements.push(db.prepare("INSERT INTO session_notes (session_key, note, skip_reason, session_rpe) VALUES (?1, ?2, ?3, ?4)").bind(session.session_key, session.note ?? null, session.skip_reason ?? null, session.session_rpe ?? null));
  }
}

/** @param {any} db @param {string} sql @param {any[]} params */
async function allRows(db, sql, params = []) {
  const statement = db.prepare(sql);
  const result = params.length ? await statement.bind(...params).all() : await statement.all();
  return result?.results ?? result ?? [];
}

/** @param {any} db @param {string} athleteKey */
async function readCanonicalRows(db, athleteKey) {
  const plans = await allRows(db, "SELECT * FROM plans WHERE athlete_key = ?1", [athleteKey]);
  const revisions = await allRows(db, "SELECT * FROM plan_revisions WHERE athlete_key = ?1 ORDER BY revision_sequence", [athleteKey]);
  const sessions = await allRows(db, "SELECT * FROM sessions WHERE athlete_key = ?1 ORDER BY scheduled_date, session_key", [athleteKey]);
  if (plans.length === 0 && revisions.length === 0 && sessions.length === 0) return null;
  const rows = {
    plan: plans[0] ?? null,
    revisions,
    sessions,
    slots: await allRows(db, "SELECT ps.* FROM plan_slots AS ps JOIN plan_revisions AS pr ON pr.revision_key = ps.revision_key WHERE pr.athlete_key = ?1", [athleteKey]),
    exercises: await allRows(db, "SELECT * FROM plan_exercises WHERE athlete_key = ?1", [athleteKey]),
    sets: await allRows(db, "SELECT ps.* FROM plan_sets AS ps JOIN plan_revisions AS pr ON pr.revision_key = ps.revision_key WHERE pr.athlete_key = ?1", [athleteKey]),
    sessionExercises: await allRows(db, "SELECT se.* FROM session_exercises AS se JOIN sessions AS s ON s.session_key = se.session_key WHERE s.athlete_key = ?1", [athleteKey]),
    completionItems: await allRows(db, "SELECT ci.* FROM completion_items AS ci JOIN sessions AS s ON s.session_key = ci.session_key WHERE s.athlete_key = ?1", [athleteKey]),
    results: await allRows(db, "SELECT sr.* FROM set_results AS sr JOIN sessions AS s ON s.session_key = sr.session_key WHERE s.athlete_key = ?1", [athleteKey]),
    notes: await allRows(db, "SELECT sn.* FROM session_notes AS sn JOIN sessions AS s ON s.session_key = sn.session_key WHERE s.athlete_key = ?1", [athleteKey]),
    feedback: await allRows(db, "SELECT ef.* FROM exercise_feedback AS ef JOIN sessions AS s ON s.session_key = ef.session_key WHERE s.athlete_key = ?1", [athleteKey]),
  };
  try {
    rows.intervals = await allRows(db, "SELECT si.* FROM session_intervals AS si JOIN sessions AS s ON s.session_key = si.session_key WHERE s.athlete_key = ?1", [athleteKey]);
  } catch (error) {
    if (!/no such table|no such column|does not exist/i.test(String(error?.message))) throw error;
    rows.intervals = [];
  }
  return rows;
}

/** @param {any} snapshot @param {any} item */
function findSnapshotSetOrdinal(snapshot, item) {
  const exercise = snapshot.blocks?.flatMap((block) => block.exercises ?? []).find((candidate) => (candidate.exercise_occurrence_key ?? candidate.occurrence_key) === (item.exercise_occurrence_key ?? item.occurrence_key));
  return exercise?.sets?.find((set) => (set.set_id ?? set.set_key) === (item.set_id ?? item.set_key))?.ordinal ?? null;
}

class D1TransactionStore {
  /** @param {D1Store} parent */
  constructor(parent) { this.parent = parent; this.loaded = new Map(); this.dirty = new Map(); this.revisions = new Map(); }
  async getByEmail(email) {
    const normalized = normalizeEmail(email);
    if (this.loaded.has(normalized)) return this.loaded.get(normalized);
    const state = await this.parent.getByEmail(normalized);
    this.loaded.set(normalized, state);
    this.revisions.set(normalized, state?.__d1StateRevision);
    return state;
  }
  async save(state) { this.loaded.set(state.email, state); this.dirty.set(state.email, deepClone(state)); }
  async all() { return this.parent.all(); }
  async flush() { if (this.dirty.size) await this.parent.saveMany([...this.dirty.values()], this.revisions); }
}

/** @param {Record<string, any>} env @param {any} [db] */
export async function createStore(env, db) {
  if (env.STORE) return env.STORE;
  const defaultTimezone = env.DEFAULT_TIMEZONE ?? "Asia/Shanghai";
  const emailA = env.ENVIRONMENT === "production" ? requiredProductionEmail(env.ATHLETE_A_EMAIL, "ATHLETE_A_EMAIL") : normalizeEmail(env.ATHLETE_A_EMAIL ?? "athlete-a@example.invalid");
  const emailB = env.ENVIRONMENT === "production" ? requiredProductionEmail(env.ATHLETE_B_EMAIL, "ATHLETE_B_EMAIL") : normalizeEmail(env.ATHLETE_B_EMAIL ?? "athlete-b@example.invalid");
  if (emailA === emailB) throw new Error("Configured Athlete identities must be distinct after normalization");
  const displayA = env.ATHLETE_A_DISPLAY_NAME ?? emailA.split("@")[0];
  const displayB = env.ATHLETE_B_DISPLAY_NAME ?? emailB.split("@")[0];
  const configured = [{ email: emailA, displayName: displayA, timezone: defaultTimezone }, { email: emailB, displayName: displayB, timezone: defaultTimezone }];
  if (db) { const store = new D1Store(db, env); await store.ensureAthletes(configured); return store; }
  return new MemoryStore([
    ...configured.map(emptyAthlete),
  ]);
}

function requiredProductionEmail(value, name) {
  if (typeof value !== "string" || !value.includes("@")) throw new Error(`${name} must be configured as a production Secret`);
  return normalizeEmail(value);
}
