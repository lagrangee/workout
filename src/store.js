// @ts-check

import { deepClone, isValidUtcInstant, normalizeEmail, opaqueKey } from "./util.js";
import { assembleCanonicalState } from "./canonical-assembler.js";

/** @typedef {Record<string, any>} StoreState */
/** @typedef {{ email: string, displayName: string, timezone: string }} AthleteConfig */
/** @typedef {{ now?: Date | string, initialState?: StoreState }} PersistenceOptions */

/** @param {AthleteConfig} config @returns {StoreState} */
export function emptyAthlete({ email, displayName, timezone }) {
  return {
    athlete_key: opaqueKey("ath"),
    email: normalizeEmail(email),
    display_name: displayName,
    timezone,
    plan_revisions: [],
    plan_day_storage_version: 0,
    planned_days: [],
    plan_changes: [],
    sessions: [],
    aerobic_activities: [],
    routes: [],
    aerobic_projection: { schema_version: 1, source_status: "none", source_statuses: { workout: "none", coros: "none" }, data_as_of: null, updated_at: null, activity_count: 0, publication_key: null },
    aerobic_date_projections: {},
    training_version: 0,
    archive_version: 0,
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

  /** @param {any} state @param {PersistenceOptions} [options] */
  async save(state, options = {}) {
    state.updated_at = persistenceInstant(options.now);
    this.athletes.set(state.email, deepClone(state));
  }

  /** @returns {Promise<any[]>} */
  async all() {
    return Array.from(this.athletes.values(), deepClone);
  }

  /** @param {string} tokenDigest */
  async findByAgentDigest(tokenDigest) {
    return findAgentState(this.athletes.values(), tokenDigest);
  }

  /** @param {(store: any) => any | Promise<any>} fn @param {PersistenceOptions} [options] */
  async transaction(fn, options = {}) {
    const now = persistenceInstant(options.now);
    const working = new Map(Array.from(this.athletes, ([email, state]) => [email, deepClone(state)]));
    /** @type {any} */
    const transactionStore = {
      getByEmail: async (/** @type {string} */ email) => working.get(normalizeEmail(email)) ?? null,
      save: async (/** @type {StoreState} */ state) => { state.updated_at = now; working.set(state.email, deepClone(state)); },
      all: async () => Array.from(working.values(), deepClone),
      findByAgentDigest: async (/** @type {string} */ tokenDigest) => findAgentState(working.values(), tokenDigest),
    };
    const result = await fn(transactionStore);
    this.athletes = working;
    return result;
  }
}

/** @param {Iterable<StoreState>} states @param {string} tokenDigest */
function findAgentState(states, tokenDigest) {
  return Array.from(states).find((state) => state.agent_access && !state.agent_access.revoked_at && state.agent_access.token_digest === tokenDigest) ?? null;
}

export class D1Store {
  /** @param {any} db @param {Record<string, any>} env */
  constructor(db, env) {
    this.db = db;
    this.env = env;
  }

  /** @param {string} email */
  async getByEmail(email) {
    const result = await this.db.prepare("SELECT state_json, state_revision FROM athlete_state WHERE email = ?1").bind(normalizeEmail(email)).first();
    if (!result) return null;
    const state = JSON.parse(result.state_json);
    const cutover = await this.readCutover(state.athlete_key);
    const hydrated = await this.hydrateCanonicalState(state, { canonicalRequired: Boolean(cutover) });
    Object.defineProperty(hydrated, "__canonicalCutover", { value: Boolean(cutover), enumerable: false, writable: true });
    Object.defineProperty(hydrated, "__d1StateRevision", { value: Number(result.state_revision ?? 0), enumerable: false, writable: true });
    attachPersistenceBaseline(hydrated, Boolean(cutover));
    return hydrated;
  }

  /** @param {StoreState} state @param {PersistenceOptions} [options] */
  async save(state, options = {}) {
    await this.saveMany([state], new Map(), options);
  }

  /** @param {StoreState[]} states @param {any} [expectedRevisions] @param {PersistenceOptions} [options] */
  async saveMany(states, expectedRevisions = new Map(), options = {}) {
    if (states.length !== 1) throw storeError("D1_MULTI_ATHLETE_TRANSACTION_UNSUPPORTED", "D1 persistence supports exactly one Athlete per transaction");
    assertImmutablePlanRevisions(states[0]);
    assertImmutablePlanChanges(states[0]);
    const now = persistenceInstant(options.now);
    const cutovers = new Map(/** @type {Array<[string, any]>} */ (await Promise.all(states.map(async (state) => [state.athlete_key, await this.readCutover(state.athlete_key)]))));
    const statements = [];
    const stateStatementIndexes = [];
    for (const state of states) {
      const canonicalCutover = Boolean(cutovers.get(state.athlete_key));
      const timestampedState = { ...deepClone(state), updated_at: now };
      const persistedState = canonicalCutover ? { ...timestampedState, plan_revisions: [], planned_days: [], plan_changes: [], sessions: [] } : timestampedState;
      const expected = expectedRevisions instanceof Map ? (expectedRevisions.get(state.email) ?? state.__d1StateRevision) : (expectedRevisions[state.email] ?? state.__d1StateRevision);
      const mutationOwner = opaqueKey("mutation");
      stateStatementIndexes.push(statements.length);
      if (Number.isInteger(expected)) {
        statements.push(this.db.prepare("UPDATE athlete_state SET state_json = ?1, updated_at = ?2, state_revision = state_revision + 1, mutation_owner = ?3 WHERE email = ?4 AND state_revision = ?5").bind(JSON.stringify(persistedState), now, mutationOwner, state.email, expected));
      } else {
        statements.push(this.db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at, state_revision, mutation_owner) VALUES (?1, ?2, ?3, ?4, 0, ?5)").bind(state.athlete_key, state.email, JSON.stringify(persistedState), now, mutationOwner));
      }
      if (!canonicalCutover) appendLegacyIndexStatements(this.db, statements, state, mutationOwner);
      appendCapabilityLookupStatements(this.db, statements, state, mutationOwner, now);
      appendCanonicalPlanDeltaStatements(this.db, statements, state, mutationOwner);
      appendPlannedDayDeltaStatements(this.db, statements, state, mutationOwner);
      appendCanonicalSessionDeltaStatements(this.db, statements, state, mutationOwner);
    }
    const results = await this.db.batch(statements);
    for (let index = 0; index < stateStatementIndexes.length; index += 1) {
      const result = results[stateStatementIndexes[index]];
      if (result?.meta?.changes !== 1) throw storeError("D1_CONCURRENCY_CONFLICT", "D1 state changed concurrently");
      const state = states[index];
      state.updated_at = now;
      const expected = expectedRevisions instanceof Map ? (expectedRevisions.get(state.email) ?? state.__d1StateRevision) : (expectedRevisions[state.email] ?? state.__d1StateRevision);
      if (Number.isInteger(expected)) Object.defineProperty(state, "__d1StateRevision", { value: expected + 1, enumerable: false, writable: true });
      Object.defineProperty(state, "__canonicalRowsPresent", { value: true, enumerable: false, writable: true });
      attachPersistenceBaseline(state, Boolean(cutovers.get(state.athlete_key)));
    }
  }

  /** @param {AthleteConfig[]} configured */
  async ensureAthletes(configured) {
    const existing = new Set();
    for (const { email } of configured) {
      const row = await this.db.prepare("SELECT athlete_key FROM athlete_state WHERE email = ?1").bind(normalizeEmail(email)).first();
      if (row?.athlete_key) existing.add(normalizeEmail(email));
    }
    /** @type {StoreState[]} */
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
        if (!/no such table|no such column|does not exist/i.test(String((/** @type {{ message?: unknown }} */ (error))?.message))) throw error;
      }
    }
  }

  async all() {
    const result = await this.db.prepare("SELECT email FROM athlete_state ORDER BY email").all();
    const rows = result.results ?? result;
    return Promise.all(rows.map((/** @type {any} */ row) => this.getByEmail(row.email)));
  }

  /** @param {string} tokenDigest */
  async findByCoachDigest(tokenDigest) {
    const result = await this.db.prepare("SELECT a.email FROM coach_share_lookup AS c JOIN athlete_state AS a ON a.athlete_key = c.athlete_key WHERE c.token_digest = ?1 AND c.revoked_at IS NULL").bind(tokenDigest).first();
    const state = result ? await this.getByEmail(result.email) : null;
    return state?.coach_share && !state.coach_share.revoked_at && state.coach_share.token_digest === tokenDigest ? state : null;
  }

  /** @param {string} tokenDigest */
  async findByAgentDigest(tokenDigest) {
    const result = await this.db.prepare("SELECT a.email FROM agent_token_lookup AS t JOIN athlete_state AS a ON a.athlete_key = t.athlete_key WHERE t.token_digest = ?1 AND t.revoked_at IS NULL").bind(tokenDigest).first();
    const state = result ? await this.getByEmail(result.email) : null;
    return state?.agent_access && !state.agent_access.revoked_at && state.agent_access.token_digest === tokenDigest ? state : null;
  }

  /** @param {string} athleteKey */
  async readCutover(athleteKey) {
    try {
      return await this.db.prepare("SELECT canonical_version, rebuilt_at, source_state_revision, rollback_ref FROM workout_storage_cutover WHERE athlete_key = ?1").bind(athleteKey).first();
    } catch (error) {
      if (/no such table|no such column|does not exist/i.test(String((/** @type {{ message?: unknown }} */ (error))?.message))) return null;
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
      const assembled = assembleCanonicalState(state, rows).state;
      Object.defineProperty(assembled, "__canonicalRowsPresent", { value: true, enumerable: false, writable: true });
      return assembled;
    } catch (error) {
      // Local fixtures can open the Worker before the explicit canonical
      // migrations. They retain the legacy state boundary until migration.
      if (!options.canonicalRequired && /no such table|no such column|does not exist/i.test(String((/** @type {{ message?: unknown }} */ (error))?.message))) return state;
      throw error;
    }
  }

  /** @param {(store: D1TransactionStore) => any | Promise<any>} fn @param {PersistenceOptions} [options] */
  async transaction(fn, options = {}) {
    // The state row is serialized as one D1 document. The Worker still uses a
    // single logical transaction boundary; D1 batch is used by the save path.
    const working = new D1TransactionStore(this, persistenceInstant(options.now));
    if (options.initialState) working.prime(options.initialState);
    const result = await fn(working);
    await working.flush();
    return result;
  }
}

/** @param {StoreState} state @returns {any[]} */
function canonicalSessionRows(state) {
  return (state.sessions ?? []).filter((/** @type {any} */ session) => session.snapshot?.schema_version === 2 || session.snapshot?.blocks?.some((/** @type {any} */ block) => block.exercises?.some((/** @type {any} */ exercise) => exercise.exercise_id)));
}

/** @param {StoreState} state @param {boolean} [canonicalCutover] */
function attachPersistenceBaseline(state, canonicalCutover = Boolean(state.__canonicalCutover)) {
  const canonicalRowsPresent = canonicalCutover || Boolean(state.__canonicalRowsPresent);
  Object.defineProperty(state, "__d1PersistenceBaseline", {
    value: {
      // Before the explicit cutover, state_json remains the source of truth and
      // may predate the canonical tables. Treat its records as pending so the
      // next save performs the existing recovery dual-write.
      plan_revisions: canonicalRowsPresent ? deepClone(state.plan_revisions ?? []) : [],
      planned_days: canonicalRowsPresent ? deepClone(state.planned_days ?? []) : [],
      plan_changes: canonicalRowsPresent ? deepClone(state.plan_changes ?? []) : [],
      sessions: canonicalRowsPresent ? deepClone(canonicalSessionRows(state)) : [],
    },
    enumerable: false,
    writable: true,
  });
}

/** @param {StoreState} state */
function assertImmutablePlanRevisions(state) {
  const baseline = state.__d1PersistenceBaseline?.plan_revisions;
  if (!Array.isArray(baseline) || baseline.length === 0) return;
  const current = new Map((state.plan_revisions ?? []).map((/** @type {any} */ revision) => [revision.revision_key, JSON.stringify(revision)]));
  for (const revision of baseline) {
    if (current.get(revision.revision_key) !== JSON.stringify(revision)) {
      throw storeError("IMMUTABLE_PLAN_REVISION", `Plan Revision ${revision.revision_key} is immutable`);
    }
  }
}

/** @param {StoreState} state */
function assertImmutablePlanChanges(state) {
  const baseline = state.__d1PersistenceBaseline?.plan_changes;
  if (!Array.isArray(baseline) || baseline.length === 0) return;
  const current = new Map((state.plan_changes ?? []).map((/** @type {any} */ change) => [change.change_key, JSON.stringify(change)]));
  for (const change of baseline) {
    if (current.get(change.change_key) !== JSON.stringify(change)) throw storeError("IMMUTABLE_PLAN_CHANGE", `Plan Change ${change.change_key} is immutable`);
  }
}

/** @param {string} code @param {string} message */
function storeError(code, message) {
  const error = /** @type {Error & { code?: string }} */ (new Error(message));
  error.code = code;
  return error;
}

/** @param {Date | string | undefined} value */
function persistenceInstant(value) {
  if (value === undefined) return new Date().toISOString();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && isValidUtcInstant(value)) return new Date(value).toISOString();
  throw storeError("INVALID_PERSISTENCE_INSTANT", "Persistence now must be a valid Date or RFC 3339 UTC instant");
}

/** @param {any[]} current @param {any[] | undefined} baseline @param {string} key @returns {any[]} */
function changedRecords(current, baseline, key) {
  if (!Array.isArray(baseline)) return current;
  const previous = new Map(baseline.map((record) => [record[key], JSON.stringify(record)]));
  return current.filter((record) => previous.get(record[key]) !== JSON.stringify(record));
}

/** @param {any} db @param {any[]} statements @param {StoreState} state @param {string} mutationOwner */
function appendLegacyIndexStatements(db, statements, state, mutationOwner) {
  const payload = JSON.stringify({ plan_revisions: state.plan_revisions ?? [], sessions: state.sessions ?? [] });
  const ownerSql = "EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?2 AND mutation_owner = ?3)";
  statements.push(db.prepare(`INSERT INTO session_date_guard (athlete_key, scheduled_date, session_key)
    SELECT ?2, json_extract(session.value, '$.scheduled_date'), json_extract(session.value, '$.session_key')
    FROM json_each(?1, '$.sessions') AS session WHERE ${ownerSql}
    ON CONFLICT(athlete_key, scheduled_date) DO UPDATE SET session_key = excluded.session_key
    WHERE session_date_guard.session_key = excluded.session_key`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`DELETE FROM session_exercise_index WHERE athlete_key = ?1 AND EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?1 AND mutation_owner = ?2)`).bind(state.athlete_key, mutationOwner));
  statements.push(db.prepare(`DELETE FROM session_index WHERE athlete_key = ?1 AND EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?1 AND mutation_owner = ?2)`).bind(state.athlete_key, mutationOwner));
  statements.push(db.prepare(`DELETE FROM plan_revision_index WHERE athlete_key = ?1 AND EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?1 AND mutation_owner = ?2)`).bind(state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO plan_revision_index (athlete_key, revision_key, effective_from, revision_sequence)
    SELECT ?2, json_extract(revision.value, '$.revision_key'), json_extract(revision.value, '$.effective_from'), json_extract(revision.value, '$.revision_sequence')
    FROM json_each(?1, '$.plan_revisions') AS revision WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO session_index (athlete_key, session_key, scheduled_date, status, updated_at)
    SELECT ?2, json_extract(session.value, '$.session_key'), json_extract(session.value, '$.scheduled_date'), json_extract(session.value, '$.status'), json_extract(session.value, '$.updated_at')
    FROM json_each(?1, '$.sessions') AS session WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO session_exercise_index (athlete_key, exercise_key, session_key, scheduled_date)
    SELECT DISTINCT ?2,
      COALESCE(json_extract(exercise.value, '$.exercise_key'), json_extract(exercise.value, '$.exercise_id')),
      json_extract(session.value, '$.session_key'), json_extract(session.value, '$.scheduled_date')
    FROM json_each(?1, '$.sessions') AS session,
      json_each(session.value, '$.snapshot.blocks') AS block,
      json_each(block.value, '$.exercises') AS exercise
    WHERE COALESCE(json_extract(exercise.value, '$.exercise_key'), json_extract(exercise.value, '$.exercise_id')) IS NOT NULL
      AND ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
}

/** @param {any} db @param {any[]} statements @param {StoreState} state @param {string} mutationOwner @param {string} now */
function appendCapabilityLookupStatements(db, statements, state, mutationOwner, now) {
  statements.push(db.prepare("DELETE FROM coach_share_lookup WHERE athlete_key = ?1 AND EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?1 AND mutation_owner = ?2)").bind(state.athlete_key, mutationOwner));
  statements.push(db.prepare("DELETE FROM agent_token_lookup WHERE athlete_key = ?1 AND EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?1 AND mutation_owner = ?2)").bind(state.athlete_key, mutationOwner));
  if (state.coach_share) statements.push(db.prepare(`INSERT INTO coach_share_lookup (token_digest, athlete_key, share_key, lookup_key_version, encryption_key_version, revoked_at, updated_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
    WHERE EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?2 AND mutation_owner = ?8)`).bind(state.coach_share.token_digest, state.athlete_key, state.coach_share.share_key, state.coach_share.lookup_key_version, state.coach_share.encryption_key_version, state.coach_share.revoked_at, now, mutationOwner));
  if (state.agent_access) statements.push(db.prepare(`INSERT INTO agent_token_lookup (token_digest, athlete_key, revoked_at, updated_at)
    SELECT ?1, ?2, ?3, ?4
    WHERE EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?2 AND mutation_owner = ?5)`).bind(state.agent_access.token_digest, state.athlete_key, state.agent_access.revoked_at, now, mutationOwner));
}

/** @param {any} db @param {any[]} statements @param {StoreState} state @param {string} mutationOwner */
function appendCanonicalPlanDeltaStatements(db, statements, state, mutationOwner) {
  const baseline = state.__d1PersistenceBaseline?.plan_revisions;
  const candidates = state.__canonicalCutover
    ? (state.plan_revisions ?? [])
    : (state.plan_revisions ?? []).filter((/** @type {any} */ revision) => revision.week && Object.values(revision.week).some((/** @type {any} */ slot) => slot?.kind === "workout" && slot.blocks?.some((/** @type {any} */ block) => block.exercises?.some((/** @type {any} */ exercise) => exercise.occurrence_key))));
  const revisions = changedRecords(candidates, baseline, "revision_key");
  if (revisions.length === 0) return;
  const payload = JSON.stringify(revisions);
  const planId = `plan_${state.athlete_key}`;
  const firstCreatedAt = candidates.slice().sort((/** @type {any} */ left, /** @type {any} */ right) => left.revision_sequence - right.revision_sequence)[0]?.created_at ?? new Date().toISOString();
  const ownerSql = "EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?2 AND mutation_owner = ?3)";
  statements.push(db.prepare(`INSERT OR IGNORE INTO plans (plan_id, athlete_key, name, created_at)
    SELECT ?1, ?2, 'Workout Plan', ?3
    WHERE EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?2 AND mutation_owner = ?4)`).bind(planId, state.athlete_key, firstCreatedAt, mutationOwner));
  statements.push(db.prepare(`INSERT INTO plan_revisions (plan_id, athlete_key, revision_key, revision_sequence, effective_from, created_at)
    SELECT ?4, ?2, json_extract(revision.value, '$.revision_key'), json_extract(revision.value, '$.revision_sequence'), json_extract(revision.value, '$.effective_from'), json_extract(revision.value, '$.created_at')
    FROM json_each(?1) AS revision WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner, planId));
  statements.push(db.prepare(`DELETE FROM plan_exercises
    WHERE revision_key IN (SELECT json_extract(value, '$.revision_key') FROM json_each(?1))
      AND EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?2 AND mutation_owner = ?3)`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`DELETE FROM plan_slots
    WHERE revision_key IN (SELECT json_extract(value, '$.revision_key') FROM json_each(?1))
      AND EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?2 AND mutation_owner = ?3)`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO plan_slots (revision_key, weekday, kind, title, start_time, estimated_duration_min, recording_source, recording_sport_type, recording_route_key)
    SELECT json_extract(revision.value, '$.revision_key'), weekday.key,
      CASE WHEN weekday.type = 'null' THEN 'no_plan' WHEN json_extract(weekday.value, '$.kind') = 'rest' THEN 'rest' ELSE 'workout' END,
      CASE WHEN json_extract(weekday.value, '$.kind') = 'workout' THEN json_extract(weekday.value, '$.title') END,
      CASE WHEN json_extract(weekday.value, '$.kind') = 'workout' THEN json_extract(weekday.value, '$.start_time') END,
      CASE WHEN json_extract(weekday.value, '$.kind') = 'workout' THEN json_extract(weekday.value, '$.estimated_duration_min') END,
      CASE WHEN json_extract(weekday.value, '$.kind') = 'workout' THEN json_extract(weekday.value, '$.recording_intent.source') END,
      CASE WHEN json_extract(weekday.value, '$.kind') = 'workout' THEN json_extract(weekday.value, '$.recording_intent.sport_type') END,
      CASE WHEN json_extract(weekday.value, '$.kind') = 'workout' THEN json_extract(weekday.value, '$.recording_intent.route_key') END
    FROM json_each(?1) AS revision, json_each(revision.value, '$.week') AS weekday
    WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO plan_exercises (revision_key, athlete_key, weekday, block_ordinal, block_title, exercise_ordinal, occurrence_key, exercise_id, execution_mode, name_snapshot, definition_version, category)
    SELECT json_extract(revision.value, '$.revision_key'), ?2, weekday.key, CAST(block.key AS INTEGER) + 1, json_extract(block.value, '$.title'), CAST(exercise.key AS INTEGER) + 1,
      json_extract(exercise.value, '$.occurrence_key'), json_extract(exercise.value, '$.exercise_id'), json_extract(exercise.value, '$.execution_mode'), json_extract(exercise.value, '$.name'), json_extract(exercise.value, '$.definition_version'), json_extract(exercise.value, '$.category')
    FROM json_each(?1) AS revision, json_each(revision.value, '$.week') AS weekday,
      json_each(weekday.value, '$.blocks') AS block, json_each(block.value, '$.exercises') AS exercise
    WHERE json_extract(weekday.value, '$.kind') = 'workout' AND ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO plan_sets (revision_key, occurrence_key, set_id, ordinal, target_metric, target_value, target_distance_km, target_hr_zone_min, target_hr_zone_max, target_incline_percent, target_rpe_min, target_rpe_max, effort_cue, resistance_mode, resistance_kg, tempo, rest_after_sec)
    SELECT json_extract(revision.value, '$.revision_key'), json_extract(exercise.value, '$.occurrence_key'), json_extract(set_value.value, '$.set_id'), json_extract(set_value.value, '$.ordinal'),
      json_extract(set_value.value, '$.target.metric'), json_extract(set_value.value, '$.target.value'), json_extract(set_value.value, '$.target.distance_km'),
      json_extract(set_value.value, '$.target.heart_rate_zone.min'), json_extract(set_value.value, '$.target.heart_rate_zone.max'), json_extract(set_value.value, '$.target.incline_percent'),
      json_extract(set_value.value, '$.target.rpe.min'), json_extract(set_value.value, '$.target.rpe.max'), json_extract(set_value.value, '$.target.effort_cue'),
      COALESCE(json_extract(set_value.value, '$.resistance_mode'), json_extract(set_value.value, '$.resistance.mode')),
      COALESCE(json_extract(set_value.value, '$.resistance_kg'), json_extract(set_value.value, '$.resistance.load_kg')), json_extract(set_value.value, '$.tempo'), json_extract(set_value.value, '$.rest_after_sec')
    FROM json_each(?1) AS revision, json_each(revision.value, '$.week') AS weekday,
      json_each(weekday.value, '$.blocks') AS block, json_each(block.value, '$.exercises') AS exercise,
      json_each(exercise.value, '$.sets') AS set_value
    WHERE json_extract(weekday.value, '$.kind') = 'workout' AND ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
}

/** @param {any} db @param {any[]} statements @param {StoreState} state @param {string} mutationOwner */
function appendPlannedDayDeltaStatements(db, statements, state, mutationOwner) {
  if (state.plan_day_storage_version !== 1) return;
  const baselineChanges = state.__d1PersistenceBaseline?.plan_changes;
  const changes = changedRecords(state.plan_changes ?? [], baselineChanges, "change_key");
  const baselineDays = state.__d1PersistenceBaseline?.planned_days;
  const days = changedRecords(state.planned_days ?? [], baselineDays, "date");
  const ownerSql = "EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?2 AND mutation_owner = ?3)";
  if (changes.length) {
    const payload = JSON.stringify(changes);
    statements.push(db.prepare(`INSERT INTO plan_changes (change_key, athlete_key, change_sequence, change_type, created_at, source_date, target_date)
      SELECT json_extract(change.value, '$.change_key'), ?2, json_extract(change.value, '$.change_sequence'), json_extract(change.value, '$.change_type'),
        json_extract(change.value, '$.created_at'), json_extract(change.value, '$.source_date'), json_extract(change.value, '$.target_date')
      FROM json_each(?1) AS change WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  }
  if (days.length) {
    const payload = JSON.stringify(days);
    statements.push(db.prepare(`INSERT INTO planned_days (
        athlete_key, planned_date, kind, prescription_revision_key, prescription_weekday,
        change_key, version, moved_from_date, moved_to_date
      )
      SELECT ?2, json_extract(day.value, '$.date'), json_extract(day.value, '$.kind'),
        json_extract(day.value, '$.prescription_revision_key'), json_extract(day.value, '$.prescription_weekday'),
        json_extract(day.value, '$.change_key'), json_extract(day.value, '$.version'),
        json_extract(day.value, '$.moved_from_date'), json_extract(day.value, '$.moved_to_date')
      FROM json_each(?1) AS day WHERE ${ownerSql}
      ON CONFLICT(athlete_key, planned_date) DO UPDATE SET
        kind = excluded.kind,
        prescription_revision_key = excluded.prescription_revision_key,
        prescription_weekday = excluded.prescription_weekday,
        change_key = excluded.change_key,
        version = excluded.version,
        moved_from_date = excluded.moved_from_date,
        moved_to_date = excluded.moved_to_date`).bind(payload, state.athlete_key, mutationOwner));
  }
}

/** @param {any} db @param {any[]} statements @param {StoreState} state @param {string} mutationOwner */
function appendCanonicalSessionDeltaStatements(db, statements, state, mutationOwner) {
  const sessions = canonicalSessionRows(state);
  const baseline = state.__d1PersistenceBaseline?.sessions;
  const changed = changedRecords(sessions, baseline, "session_key");
  const currentKeys = new Set(sessions.map((session) => session.session_key));
  const removedKeys = Array.isArray(baseline) ? baseline.map((session) => session.session_key).filter((key) => !currentKeys.has(key)) : [];
  for (const session of changed) {
    if (!session.plan_id || !session.plan_revision_key) throw new Error(`Canonical Session ${session.session_key} requires plan_id and plan_revision_key`);
  }
  const deleteKeys = [...new Set([...changed.map((session) => session.session_key), ...removedKeys])];
  if (deleteKeys.length === 0) return;
  const payload = JSON.stringify({ sessions: changed, delete_keys: deleteKeys });
  const ownerSql = "EXISTS (SELECT 1 FROM athlete_state WHERE athlete_key = ?2 AND mutation_owner = ?3)";
  statements.push(db.prepare(`DELETE FROM sessions
    WHERE athlete_key = ?2 AND session_key IN (SELECT value FROM json_each(?1, '$.delete_keys')) AND ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO sessions (athlete_key, session_key, plan_id, plan_revision_key, scheduled_date, timezone_at_session, title, status, created_at, updated_at, scheduled_workout_key, local_date, start_time, estimated_duration_min)
    SELECT ?2, json_extract(session.value, '$.session_key'), json_extract(session.value, '$.plan_id'), json_extract(session.value, '$.plan_revision_key'),
      COALESCE(json_extract(session.value, '$.local_date'), json_extract(session.value, '$.scheduled_date')), json_extract(session.value, '$.timezone_at_session'), json_extract(session.value, '$.title'), json_extract(session.value, '$.status'),
      json_extract(session.value, '$.created_at'), json_extract(session.value, '$.updated_at'), json_extract(session.value, '$.scheduled_workout_key'),
      COALESCE(json_extract(session.value, '$.local_date'), json_extract(session.value, '$.scheduled_date')), json_extract(session.value, '$.snapshot.start_time'), json_extract(session.value, '$.snapshot.estimated_duration_min')
    FROM json_each(?1, '$.sessions') AS session WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO session_exercises (session_key, occurrence_key, block_ordinal, block_title, exercise_ordinal, exercise_id, name_snapshot, definition_version, execution_mode, category)
    SELECT json_extract(session.value, '$.session_key'), COALESCE(json_extract(exercise.value, '$.exercise_occurrence_key'), json_extract(exercise.value, '$.occurrence_key')),
      CAST(block.key AS INTEGER) + 1, json_extract(block.value, '$.title'), CAST(exercise.key AS INTEGER) + 1, json_extract(exercise.value, '$.exercise_id'), json_extract(exercise.value, '$.name'), json_extract(exercise.value, '$.definition_version'), json_extract(exercise.value, '$.execution_mode'), json_extract(exercise.value, '$.category')
    FROM json_each(?1, '$.sessions') AS session, json_each(session.value, '$.snapshot.blocks') AS block, json_each(block.value, '$.exercises') AS exercise
    WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO session_external_completions (session_key, occurrence_key, schema_version, completed_at, recording_source)
    SELECT json_extract(session.value, '$.session_key'), json_extract(completion.value, '$.occurrence_key'), 1,
      json_extract(completion.value, '$.completed_at'), json_extract(completion.value, '$.recording_source')
    FROM json_each(?1, '$.sessions') AS session, json_each(session.value, '$.external_completions') AS completion
    WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO completion_items (session_key, completion_item_key, occurrence_key, set_id, side, target_metric, target_value, target_distance_km, target_hr_zone_min, target_hr_zone_max, target_incline_percent, target_rpe_min, target_rpe_max, effort_cue, resistance_mode, resistance_kg, tempo, rest_after_sec, set_ordinal)
    SELECT json_extract(session.value, '$.session_key'), json_extract(item.value, '$.completion_item_key'), COALESCE(json_extract(item.value, '$.exercise_occurrence_key'), json_extract(item.value, '$.occurrence_key')),
      COALESCE(json_extract(item.value, '$.set_id'), json_extract(item.value, '$.set_key')), json_extract(item.value, '$.side'), json_extract(item.value, '$.target.metric'), json_extract(item.value, '$.target.value'),
      json_extract(item.value, '$.target.distance_km'), json_extract(item.value, '$.target.heart_rate_zone.min'), json_extract(item.value, '$.target.heart_rate_zone.max'), json_extract(item.value, '$.target.incline_percent'),
      json_extract(item.value, '$.target.rpe.min'), json_extract(item.value, '$.target.rpe.max'), json_extract(item.value, '$.target.effort_cue'),
      COALESCE(json_extract(item.value, '$.resistance_mode'), json_extract(item.value, '$.resistance.mode')), COALESCE(json_extract(item.value, '$.resistance_kg'), json_extract(item.value, '$.resistance.load_kg')),
      json_extract(item.value, '$.tempo'), json_extract(item.value, '$.rest_after_sec'),
      COALESCE(json_extract(item.value, '$.set_ordinal'), (
        SELECT json_extract(set_value.value, '$.ordinal')
        FROM json_each(session.value, '$.snapshot.blocks') AS source_block,
          json_each(source_block.value, '$.exercises') AS source_exercise,
          json_each(source_exercise.value, '$.sets') AS set_value
        WHERE COALESCE(json_extract(source_exercise.value, '$.exercise_occurrence_key'), json_extract(source_exercise.value, '$.occurrence_key')) = COALESCE(json_extract(item.value, '$.exercise_occurrence_key'), json_extract(item.value, '$.occurrence_key'))
          AND COALESCE(json_extract(set_value.value, '$.set_id'), json_extract(set_value.value, '$.set_key')) = COALESCE(json_extract(item.value, '$.set_id'), json_extract(item.value, '$.set_key'))
        LIMIT 1
      ))
    FROM json_each(?1, '$.sessions') AS session, json_each(session.value, '$.snapshot.completion_items') AS item
    WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO set_results (session_key, completion_item_key, status, actual_metric, actual_value, resistance_mode, resistance_kg, rir, note, completed_at)
    SELECT json_extract(session.value, '$.session_key'), json_extract(result.value, '$.completion_item_key'),
      COALESCE(json_extract(result.value, '$.status'), CASE WHEN json_extract(result.value, '$.completed') THEN 'completed' ELSE 'partial' END),
      json_extract(result.value, '$.actual.metric'), json_extract(result.value, '$.actual.value'), COALESCE(json_extract(result.value, '$.resistance_mode'), json_extract(result.value, '$.resistance.mode')),
      COALESCE(json_extract(result.value, '$.resistance_kg'), json_extract(result.value, '$.resistance.load_kg')), json_extract(result.value, '$.rir'), json_extract(result.value, '$.note'), json_extract(result.value, '$.completed_at')
    FROM json_each(?1, '$.sessions') AS session,
      json_each(CASE WHEN json_array_length(json_extract(session.value, '$.set_results')) > 0 THEN json_extract(session.value, '$.set_results') ELSE json_extract(session.value, '$.completion_results') END) AS result
    WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO session_intervals (session_key, interval_key, started_at, ended_at)
    SELECT json_extract(session.value, '$.session_key'), json_extract(interval.value, '$.interval_key'), json_extract(interval.value, '$.started_at'), json_extract(interval.value, '$.ended_at')
    FROM json_each(?1, '$.sessions') AS session, json_each(session.value, '$.training_intervals') AS interval
    WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO exercise_feedback (session_key, occurrence_key, text)
    SELECT json_extract(session.value, '$.session_key'), json_extract(feedback.value, '$.exercise_occurrence_key'), json_extract(feedback.value, '$.text')
    FROM json_each(?1, '$.sessions') AS session, json_each(session.value, '$.exercise_feedback') AS feedback
    WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
  statements.push(db.prepare(`INSERT INTO session_notes (session_key, note, skip_reason, session_rpe)
    SELECT json_extract(session.value, '$.session_key'), json_extract(session.value, '$.note'), json_extract(session.value, '$.skip_reason'), json_extract(session.value, '$.session_rpe')
    FROM json_each(?1, '$.sessions') AS session WHERE ${ownerSql}`).bind(payload, state.athlete_key, mutationOwner));
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
  /** @type {Record<string, any>} */
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
  };
  try {
    const ancillary = await allRows(db, `SELECT 'note' AS row_type, sn.session_key, NULL AS occurrence_key, sn.note, sn.skip_reason, sn.session_rpe, NULL AS text, NULL AS schema_version, NULL AS completed_at, NULL AS recording_source
      FROM session_notes AS sn JOIN sessions AS s ON s.session_key = sn.session_key WHERE s.athlete_key = ?1
      UNION ALL
      SELECT 'feedback', ef.session_key, ef.occurrence_key, NULL, NULL, NULL, ef.text, NULL, NULL, NULL
      FROM exercise_feedback AS ef JOIN sessions AS s ON s.session_key = ef.session_key WHERE s.athlete_key = ?1
      UNION ALL
      SELECT 'external', ec.session_key, ec.occurrence_key, NULL, NULL, NULL, NULL, ec.schema_version, ec.completed_at, ec.recording_source
      FROM session_external_completions AS ec JOIN sessions AS s ON s.session_key = ec.session_key WHERE s.athlete_key = ?1`, [athleteKey]);
    rows.notes = ancillary.filter((/** @type {any} */ row) => row.row_type === "note");
    rows.feedback = ancillary.filter((/** @type {any} */ row) => row.row_type === "feedback");
    rows.externalCompletions = ancillary.filter((/** @type {any} */ row) => row.row_type === "external");
  } catch (error) {
    if (!/no such table|no such column|does not exist/i.test(String((/** @type {{ message?: unknown }} */ (error))?.message))) throw error;
    const ancillary = await allRows(db, `SELECT 'note' AS row_type, sn.session_key, NULL AS occurrence_key, sn.note, sn.skip_reason, sn.session_rpe, NULL AS text
      FROM session_notes AS sn JOIN sessions AS s ON s.session_key = sn.session_key WHERE s.athlete_key = ?1
      UNION ALL
      SELECT 'feedback', ef.session_key, ef.occurrence_key, NULL, NULL, NULL, ef.text
      FROM exercise_feedback AS ef JOIN sessions AS s ON s.session_key = ef.session_key WHERE s.athlete_key = ?1`, [athleteKey]);
    rows.notes = ancillary.filter((/** @type {any} */ row) => row.row_type === "note");
    rows.feedback = ancillary.filter((/** @type {any} */ row) => row.row_type === "feedback");
    rows.externalCompletions = [];
  }
  try {
    const datedPlanRows = await allRows(db, `SELECT 'day' AS row_type, planned_date AS sort_key, planned_date, kind,
        prescription_revision_key, prescription_weekday, change_key, version, moved_from_date, moved_to_date,
        NULL AS change_sequence, NULL AS change_type, NULL AS created_at, NULL AS source_date, NULL AS target_date
      FROM planned_days WHERE athlete_key = ?1
      UNION ALL
      SELECT 'change' AS row_type, printf('%020d', change_sequence) AS sort_key, NULL, NULL,
        NULL, NULL, change_key, NULL, NULL, NULL,
        change_sequence, change_type, created_at, source_date, target_date
      FROM plan_changes WHERE athlete_key = ?1
      ORDER BY row_type, sort_key`, [athleteKey]);
    rows.plannedDays = datedPlanRows.filter((/** @type {any} */ row) => row.row_type === "day");
    rows.planChanges = datedPlanRows.filter((/** @type {any} */ row) => row.row_type === "change");
  } catch (error) {
    if (!/no such table|no such column|does not exist/i.test(String((/** @type {{ message?: unknown }} */ (error))?.message))) throw error;
    rows.plannedDays = null;
    rows.planChanges = [];
  }
  try {
    rows.intervals = await allRows(db, "SELECT si.* FROM session_intervals AS si JOIN sessions AS s ON s.session_key = si.session_key WHERE s.athlete_key = ?1", [athleteKey]);
  } catch (error) {
    if (!/no such table|no such column|does not exist/i.test(String((/** @type {{ message?: unknown }} */ (error))?.message))) throw error;
    rows.intervals = [];
  }
  return rows;
}

class D1TransactionStore {
  /** @param {D1Store} parent @param {string} now */
  constructor(parent, now) { this.parent = parent; this.now = now; this.loaded = new Map(); this.dirty = new Map(); this.revisions = new Map(); }
  /**
   * Reuse a state that was hydrated while authenticating the same request.
   * The captured state_revision remains the conditional-write guard, so a
   * concurrent mutation still fails during flush instead of being overwritten.
   * @param {StoreState} state
   */
  prime(state) {
    const normalized = normalizeEmail(state.email);
    this.loaded.set(normalized, cloneD1State(state));
    this.revisions.set(normalized, state.__d1StateRevision);
  }
  /** @param {string} email */
  async getByEmail(email) {
    const normalized = normalizeEmail(email);
    if (this.loaded.has(normalized)) return this.loaded.get(normalized);
    const state = await this.parent.getByEmail(normalized);
    this.loaded.set(normalized, state);
    this.revisions.set(normalized, state?.__d1StateRevision);
    return state;
  }
  /** @param {StoreState} state */
  async save(state) {
    state.updated_at = this.now;
    this.loaded.set(state.email, state);
    this.dirty.set(state.email, cloneD1State(state));
  }
  async all() { return this.parent.all(); }
  async flush() {
    if (this.dirty.size > 1) throw storeError("D1_MULTI_ATHLETE_TRANSACTION_UNSUPPORTED", "D1 persistence supports exactly one Athlete per transaction");
    if (this.dirty.size) await this.parent.saveMany([...this.dirty.values()], this.revisions, { now: this.now });
  }
}

/** @param {StoreState} state */
function cloneD1State(state) {
  const clone = deepClone(state);
  if (state.__d1PersistenceBaseline) Object.defineProperty(clone, "__d1PersistenceBaseline", { value: deepClone(state.__d1PersistenceBaseline), enumerable: false, writable: true });
  if (state.__canonicalCutover !== undefined) Object.defineProperty(clone, "__canonicalCutover", { value: state.__canonicalCutover, enumerable: false, writable: true });
  if (state.__canonicalRowsPresent !== undefined) Object.defineProperty(clone, "__canonicalRowsPresent", { value: state.__canonicalRowsPresent, enumerable: false, writable: true });
  if (state.__d1StateRevision !== undefined) Object.defineProperty(clone, "__d1StateRevision", { value: state.__d1StateRevision, enumerable: false, writable: true });
  return clone;
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

/** @param {unknown} value @param {string} name */
function requiredProductionEmail(value, name) {
  if (typeof value !== "string" || !value.includes("@")) throw new Error(`${name} must be configured as a production Secret`);
  return normalizeEmail(value);
}
