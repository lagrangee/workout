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
    training_version: 0,
    updated_at: new Date().toISOString(),
    coach_share: null,
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

  async transaction(fn) {
    const working = new Map(Array.from(this.athletes, ([email, state]) => [email, deepClone(state)]));
    const transactionStore = {
      getByEmail: async (email) => working.get(normalizeEmail(email)) ?? null,
      save: async (state) => { state.updated_at = new Date().toISOString(); working.set(state.email, deepClone(state)); },
      all: async () => Array.from(working.values(), deepClone),
    };
    const result = await fn(transactionStore);
    this.athletes = working;
    return result;
  }
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
  const emailA = normalizeEmail(env.ATHLETE_A_EMAIL ?? "athlete-a@example.invalid");
  const emailB = normalizeEmail(env.ATHLETE_B_EMAIL ?? "athlete-b@example.invalid");
  if (emailA === emailB) throw new Error("Configured Athlete identities must be distinct after normalization");
  const displayA = env.ATHLETE_A_DISPLAY_NAME ?? emailA.split("@")[0];
  const displayB = env.ATHLETE_B_DISPLAY_NAME ?? emailB.split("@")[0];
  const configured = [{ email: emailA, displayName: displayA, timezone: defaultTimezone }, { email: emailB, displayName: displayB, timezone: defaultTimezone }];
  if (db) { const store = new D1Store(db, env); await store.ensureAthletes(configured); return store; }
  return new MemoryStore([
    ...configured.map(emptyAthlete),
  ]);
}
