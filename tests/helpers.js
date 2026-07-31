import { addDays, localDate, opaqueKey, weekdayKey, WEEKDAYS } from "../src/util.js";
import { emptyAthlete, MemoryStore } from "../src/store.js";
import { createHandler } from "../src/http.js";

export const today = localDate(new Date(), "Asia/Shanghai");

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

/** @returns {any} */
export function fixture() {
  const athleteA = emptyAthlete({ email: "athlete-a@example.invalid", displayName: "Athlete A", timezone: "Asia/Shanghai" });
  const athleteB = emptyAthlete({ email: "athlete-b@example.invalid", displayName: "Athlete B", timezone: "Asia/Shanghai" });
  const oldDate = addDays(today, -7);
  /** @type {Record<string, any>} */
  const template = Object.fromEntries(WEEKDAYS.map((day) => [day, null]));
  template[weekdayKey(today)] = workout();
  template[WEEKDAYS[(WEEKDAYS.indexOf(weekdayKey(today)) + 1) % 7]] = { kind: "rest" };
  athleteA.plan_revisions.push({ revision_key: opaqueKey("rev"), revision_sequence: 1, created_at: new Date().toISOString(), effective_from: oldDate, week: template });
  return { athleteA, athleteB, store: new MemoryStore([athleteA, athleteB]) };
}

/** @returns {any} */
export function appFixture() { const value = fixture(); return { ...value, handler: createHandler({ STORE: value.store, LOCAL_AUTH: "true", DEFAULT_TIMEZONE: "Asia/Shanghai", PUBLIC_ORIGIN: "https://workout.example" }) }; }

/** @param {any} handler @param {string} path @param {any} options @param {string} email @returns {Promise<any>} */
export async function call(handler, path, options = {}, email = "athlete-a@example.invalid") {
  const headers = { "x-athlete-email": email, ...(options.headers || {}) };
  const request = new Request(`https://workout.example${path}`, { ...options, headers });
  const response = await handler.fetch(request, { LOCAL_AUTH: "true", PUBLIC_ORIGIN: "https://workout.example" });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

/** @returns {any} */
/** @param {any} options @param {any} body @returns {any} */
export function json(options = {}, body = {}) { return { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) }, body: JSON.stringify(body) }; }
/** @param {any} body @param {string} id @returns {any} */
export const post = (body, id = `${Date.now()}-${Math.random()}`) => json({ method: "POST", headers: { "Idempotency-Key": id } }, body);
