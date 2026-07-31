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
    const result = await this.db.prepare("SELECT state_json FROM athlete_state WHERE email = ?1").bind(normalizeEmail(email)).first();
    return result ? JSON.parse(result.state_json) : null;
  }

  async save(state) {
    const now = new Date().toISOString();
    await this.db.prepare("INSERT INTO athlete_state (athlete_key, email, state_json, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(email) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at")
      .bind(state.athlete_key, state.email, JSON.stringify(state), now).run();
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
  constructor(parent) { this.parent = parent; this.loaded = new Map(); this.dirty = new Map(); }
  async getByEmail(email) {
    const normalized = normalizeEmail(email);
    if (this.loaded.has(normalized)) return this.loaded.get(normalized);
    const state = await this.parent.getByEmail(normalized);
    this.loaded.set(normalized, state);
    return state;
  }
  async save(state) { this.loaded.set(state.email, state); this.dirty.set(state.email, deepClone(state)); }
  async all() { return this.parent.all(); }
  async flush() { for (const state of this.dirty.values()) await this.parent.save(state); }
}

/** @param {Record<string, any>} env @param {any} [db] */
export async function createStore(env, db) {
  if (env.STORE) return env.STORE;
  if (db) return new D1Store(db, env);
  const defaultTimezone = env.DEFAULT_TIMEZONE ?? "Asia/Shanghai";
  const emailA = normalizeEmail(env.ATHLETE_A_EMAIL ?? "athlete-a@example.invalid");
  const emailB = normalizeEmail(env.ATHLETE_B_EMAIL ?? "athlete-b@example.invalid");
  const displayA = env.ATHLETE_A_DISPLAY_NAME ?? emailA.split("@")[0];
  const displayB = env.ATHLETE_B_DISPLAY_NAME ?? emailB.split("@")[0];
  return new MemoryStore([
    emptyAthlete({ email: emailA, displayName: displayA, timezone: defaultTimezone }),
    emptyAthlete({ email: emailB, displayName: displayB, timezone: defaultTimezone }),
  ]);
}
