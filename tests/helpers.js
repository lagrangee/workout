import { addDays, localDate, opaqueKey, weekdayKey, WEEKDAYS } from "../src/util.js";
import { emptyAthlete, MemoryStore } from "../src/store.js";
import { createHandler } from "../src/http.js";

export const TEST_NOW = "2026-08-29T04:00:00.000Z";
export const TEST_TODAY = localDate(new Date(TEST_NOW), "Asia/Shanghai");
export const today = TEST_TODAY;
export const testAgentSecret = "test-only-agent-token-secret";
let requestKeySequence = 0;

/** @param {number} [offsetMs] @returns {string} */
export function testInstant(offsetMs = 0) {
  return new Date(Date.parse(TEST_NOW) + offsetMs).toISOString();
}

/** @param {string} date @returns {Date} */
function fixtureInstant(date) {
  return date === TEST_TODAY ? new Date(TEST_NOW) : new Date(`${date}T04:00:00.000Z`);
}

/** @returns {any} */
export function workout(title = "下肢力量") {
  /** @param {string} metric @param {number} min @param {number} max @param {any} resistance @returns {any} */
  const set = (metric = "reps", min = 6, max = min, resistance = null) => ({ target: { metric, min, max }, resistance, target_rir: null, target_rpe: null, tempo: null, rest_after_sec: 60, target_incline_percent: null });
  return { kind: "workout", title, start_time: "08:00", estimated_duration_min: 60, blocks: [{ title: "主训练", exercises: [{ exercise_key: "goblet_squat", name: "高脚杯深蹲", category: "strength", side_mode: "none", sets: [set("reps", 8, 8, { mode: "external_weight", load_kg: 12, quantity: 1 }), set("reps", 6, 8, { mode: "external_weight", load_kg: 12, quantity: 1 })] }, { exercise_key: "split_squat", name: "分腿蹲", category: "strength", side_mode: "left_right", sets: [set("reps", 6, 8, { mode: "bodyweight", load_kg: null, quantity: null })] }] }] };
}

/** @returns {any} */
export function week(slot = workout()) { return { monday: slot, tuesday: { kind: "rest" }, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }; }
/** @returns {string} */
export function packageText(effectiveFrom = addDays(today, 1), slot = workout("未来训练")) { return JSON.stringify({ schema_version: 1, effective_from: effectiveFrom, week: week(slot) }); }

/** @param {{ today?: string }} [options] @returns {any} */
export function fixture(options = {}) {
  const fixtureDate = options.today ?? today;
  const athleteA = emptyAthlete({ email: "athlete-a@example.invalid", displayName: "Athlete A", timezone: "Asia/Shanghai" });
  const athleteB = emptyAthlete({ email: "athlete-b@example.invalid", displayName: "Athlete B", timezone: "Asia/Shanghai" });
  const oldDate = addDays(fixtureDate, -7);
  /** @type {Record<string, any>} */
  const template = Object.fromEntries(WEEKDAYS.map((day) => [day, null]));
  template[weekdayKey(fixtureDate)] = workout();
  template[WEEKDAYS[(WEEKDAYS.indexOf(weekdayKey(fixtureDate)) + 1) % 7]] = { kind: "rest" };
  athleteA.plan_revisions.push({ revision_key: opaqueKey("rev"), revision_sequence: 1, created_at: fixtureInstant(fixtureDate).toISOString(), effective_from: oldDate, week: template });
  return { athleteA, athleteB, store: new MemoryStore([athleteA, athleteB]) };
}

/** @param {{ clock?: () => Date, today?: string }} [options] @returns {any} */
export function appFixture(options = {}) {
  const fixtureDate = options.today ?? TEST_TODAY;
  const value = fixture({ today: fixtureDate });
  return {
    ...value,
    handler: createHandler(
      { STORE: value.store, LOCAL_AUTH: "true", DEFAULT_TIMEZONE: "Asia/Shanghai", PUBLIC_ORIGIN: "https://workout.example", AGENT_TOKEN_SECRET: testAgentSecret },
      { clock: options.clock ?? (() => fixtureInstant(fixtureDate)) },
    ),
  };
}

/** @param {any} handler @param {string} path @param {any} options @param {string} email @returns {Promise<any>} */
export async function call(handler, path, options = {}, email = "athlete-a@example.invalid") {
  const headers = { "x-athlete-email": email, ...(options.headers || {}) };
  const request = new Request(`https://workout.example${path}`, { ...options, headers });
  const response = await handler.fetch(request, { LOCAL_AUTH: "true", PUBLIC_ORIGIN: "https://workout.example", AGENT_TOKEN_SECRET: testAgentSecret });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

/** @param {any} handler @param {string} token @param {string} path @param {any} [options] @returns {Promise<any>} */
export async function agentRequest(handler, token, path, options = {}) {
  const response = await handler.fetch(new Request(`https://workout.example${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  }), {
    LOCAL_AUTH: "true",
    PUBLIC_ORIGIN: "https://workout.example",
    AGENT_TOKEN_SECRET: testAgentSecret,
  });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

/** @param {any} handler @param {string} [email] @returns {Promise<string>} */
export async function createAgentToken(handler, email = "athlete-a@example.invalid") {
  const result = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" }, email);
  if (result.response.status !== 201 || typeof result.body.token !== "string") throw new Error("Agent token creation failed");
  return result.body.token;
}

/** @returns {any} */
/** @param {any} options @param {any} body @returns {any} */
export function json(options = {}, body = {}) { return { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) }, body: JSON.stringify(body) }; }
/** @param {any} body @param {string} id @returns {any} */
export const post = (body, id = `test-request-${++requestKeySequence}`) => json({ method: "POST", headers: { "Idempotency-Key": id } }, body);
