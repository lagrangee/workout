// @ts-nocheck

import { deepClone, normalizeEmail, opaqueKey } from "./util.js";

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
    Object.defineProperty(state, "__d1StateRevision", { value: Number(result.state_revision ?? 0), enumerable: false, writable: true });
    return state;
  }

  async save(state) {
    await this.saveMany([state]);
  }

  async saveMany(states, expectedRevisions = new Map()) {
    const now = new Date().toISOString();
    const statements = [];
    const stateStatementIndexes = [];
    for (const state of states) {
      const expected = expectedRevisions instanceof Map ? (expectedRevisions.get(state.email) ?? state.__d1StateRevision) : (expectedRevisions[state.email] ?? state.__d1StateRevision);
      stateStatementIndexes.push(statements.length);
      if (Number.isInteger(expected)) {
        statements.push(this.db.prepare("UPDATE athlete_state SET state_json = ?1, updated_at = ?2, state_revision = state_revision + 1 WHERE email = ?3 AND state_revision = ?4").bind(JSON.stringify(state), now, state.email, expected));
      } else {
        statements.push(this.db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at, state_revision) VALUES (?1, ?2, ?3, ?4, 0)").bind(state.athlete_key, state.email, JSON.stringify(state), now));
      }
      for (const session of state.sessions ?? []) statements.push(this.db.prepare("INSERT INTO session_date_guard (athlete_key, scheduled_date, session_key) VALUES (?1, ?2, ?3) ON CONFLICT(athlete_key, scheduled_date) DO UPDATE SET session_key = excluded.session_key WHERE session_date_guard.session_key = excluded.session_key").bind(state.athlete_key, session.scheduled_date, session.session_key));
      statements.push(this.db.prepare("DELETE FROM plan_revision_index WHERE athlete_key = ?1").bind(state.athlete_key));
      statements.push(this.db.prepare("DELETE FROM session_exercise_index WHERE athlete_key = ?1").bind(state.athlete_key));
      statements.push(this.db.prepare("DELETE FROM session_index WHERE athlete_key = ?1").bind(state.athlete_key));
      statements.push(this.db.prepare("DELETE FROM coach_share_lookup WHERE athlete_key = ?1").bind(state.athlete_key));
      statements.push(this.db.prepare("DELETE FROM agent_token_lookup WHERE athlete_key = ?1").bind(state.athlete_key));
      for (const revision of state.plan_revisions ?? []) statements.push(this.db.prepare("INSERT INTO plan_revision_index (athlete_key, revision_key, effective_from, revision_sequence) VALUES (?1, ?2, ?3, ?4)").bind(state.athlete_key, revision.revision_key, revision.effective_from, revision.revision_sequence));
      for (const session of state.sessions ?? []) {
        statements.push(this.db.prepare("INSERT INTO session_index (athlete_key, session_key, scheduled_date, status, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(state.athlete_key, session.session_key, session.scheduled_date, session.status, session.updated_at));
        const exerciseKeys = new Set(session.snapshot?.blocks?.flatMap((block) => block.exercises.map((exercise) => exercise.exercise_key)) ?? []);
        for (const exerciseKey of exerciseKeys) statements.push(this.db.prepare("INSERT INTO session_exercise_index (athlete_key, exercise_key, session_key, scheduled_date) VALUES (?1, ?2, ?3, ?4)").bind(state.athlete_key, exerciseKey, session.session_key, session.scheduled_date));
      }
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
    const statements = configured.map(({ email, displayName, timezone }) => {
      const state = emptyAthlete({ email, displayName, timezone });
      return this.db.prepare("INSERT OR IGNORE INTO athlete_state (athlete_key, email, state_json, updated_at, state_revision) VALUES (?1, ?2, ?3, ?4, 0)").bind(state.athlete_key, state.email, JSON.stringify(state), state.updated_at);
    });
    if (statements.length) await this.db.batch(statements);
  }

  async all() {
    const result = await this.db.prepare("SELECT state_json FROM athlete_state ORDER BY email").all();
    return (result.results ?? []).map((row) => JSON.parse(row.state_json));
  }

  async findByCoachDigest(tokenDigest) {
    const result = await this.db.prepare("SELECT a.state_json FROM coach_share_lookup AS c JOIN athlete_state AS a ON a.athlete_key = c.athlete_key WHERE c.token_digest = ?1 AND c.revoked_at IS NULL").bind(tokenDigest).first();
    return result ? JSON.parse(result.state_json) : null;
  }

  async findByAgentDigest(tokenDigest) {
    const result = await this.db.prepare("SELECT a.state_json FROM agent_token_lookup AS t JOIN athlete_state AS a ON a.athlete_key = t.athlete_key WHERE t.token_digest = ?1 AND t.revoked_at IS NULL").bind(tokenDigest).first();
    return result ? JSON.parse(result.state_json) : null;
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
