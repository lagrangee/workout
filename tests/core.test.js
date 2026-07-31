import test from "node:test";
import assert from "node:assert/strict";
import { addDays, canonicalJson, localDate, weekdayKey } from "../src/util.js";
import { appFixture, call, json, packageText, post, today, workout, week } from "./helpers.js";

test("ticket 16: private identity is isolated and settings are validated", async () => {
  const { handler } = appFixture();
  const me = await call(handler, "/api/private/me");
  assert.equal(me.response.status, 200); assert.equal(me.body.display_name, "Athlete A");
  const missing = await call(handler, "/api/private/me", {}, "unknown@example.invalid");
  assert.equal(missing.response.status, 403); assert.equal(missing.body.error.code, "forbidden");
  const noAuth = await handler.fetch(new Request("https://workout.example/api/private/me"), { LOCAL_AUTH: "true" });
  assert.equal(noAuth.status, 401);
  const unsignedClaims = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") + "." + Buffer.from(JSON.stringify({ email: "athlete-a@example.invalid", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url") + ".unsigned";
  const unsigned = await handler.fetch(new Request("https://workout.example/api/private/me", { headers: { "CF-Access-Jwt-Assertion": unsignedClaims } }), { ENVIRONMENT: "development" });
  assert.equal(unsigned.status, 401);
  const update = await call(handler, "/api/private/settings", json({ method: "PUT" }, { display_name: "Updated Athlete", timezone: "UTC" }));
  assert.equal(update.response.status, 200); assert.equal(update.body.display_name, "Updated Athlete");
  const other = await call(handler, "/api/private/me", {}, "athlete-b@example.invalid");
  assert.equal(other.body.display_name, "Athlete B"); assert.equal(other.body.timezone, "Asia/Shanghai");
  const invalid = await call(handler, "/api/private/settings", json({ method: "PUT" }, { display_name: "", timezone: "nope" }));
  assert.equal(invalid.response.status, 400); assert.equal(invalid.body.error.code, "invalid_settings");
});

test("ticket 17: plan and dated schedule are read-only projections", async () => {
  const { handler } = appFixture();
  const plan = await call(handler, "/api/private/plan"); assert.equal(plan.response.status, 200); assert.equal(plan.body.current.week[weekdayKey(today)].kind, "workout");
  const schedule = await call(handler, `/api/private/schedule?from=${today}&to=${today}`); assert.equal(schedule.body.entries[0].date, today); assert.equal(schedule.body.entries[0].kind, "workout");
  const rest = await call(handler, `/api/private/schedule?from=${addDays(today, 1)}&to=${addDays(today, 1)}`); assert.equal(rest.body.entries[0].kind, "rest");
  const noPlan = await call(handler, `/api/private/schedule?from=${addDays(today, 2)}&to=${addDays(today, 2)}`); assert.equal(noPlan.body.entries[0].kind, "no_plan");
});

test("ticket 18: strict plan package validation and atomic future application", async () => {
  const { handler, store } = appFixture();
  const duplicate = `{"schema_version":1,"effective_from":"${addDays(today, 1)}","effective_from":"${addDays(today, 2)}","week":{}}`;
  const invalid = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: duplicate }));
  assert.equal(invalid.response.status, 400); assert.equal(invalid.body.error.code, "invalid_plan_package");
  const validText = packageText(addDays(today, 1), workout("明天新计划"));
  const preview = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: validText }));
  assert.equal(preview.response.status, 200); assert.equal(preview.body.preview.effective_from, addDays(today, 1)); assert.ok(preview.body.preview.changed_weekday_slot_count > 0);
  const applied = await call(handler, "/api/private/plan-updates/apply", post({ package_text: validText }, "apply-1"));
  assert.equal(applied.response.status, 201); const state = await store.getByEmail("athlete-a@example.invalid"); assert.equal(state.plan_revisions.length, 2);
  const replay = await call(handler, "/api/private/plan-updates/apply", post({ package_text: validText }, "apply-1")); assert.equal(replay.response.status, 201); assert.equal((await store.getByEmail("athlete-a@example.invalid")).plan_revisions.length, 2);
  const noop = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: validText })); assert.equal(noop.response.status, 400);
});

test("ticket 19: start, skip replay, immutable snapshot and unilateral expansion", async () => {
  const { handler, store } = appFixture();
  const start = await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}));
  assert.equal(start.response.status, 201); assert.equal(start.body.status, "in_progress"); assert.equal(start.body.snapshot.completion_items.length, 4);
  const second = await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "start-replay")); assert.equal(second.response.status, 200);
  const state = await store.getByEmail("athlete-a@example.invalid"); assert.equal(state.sessions.length, 1); const originalSnapshot = canonicalJson(state.sessions[0].snapshot);
  const wrongDate = await call(handler, `/api/private/scheduled-workouts/${addDays(today, 1)}/start`, post({}, "wrong-date")); assert.equal(wrongDate.response.status, 400);
  const detail = await call(handler, `/api/private/sessions/${start.body.session_key}`); assert.equal(canonicalJson(detail.body.snapshot), originalSnapshot);
});

/** @param {any} detail @param {number} count @param {number|null} rpe @returns {any} */
function recordFor(detail, count = detail.snapshot.completion_items.length, rpe = null) {
  const now = new Date().toISOString();
  return { record_schema_version: 1, completion_results: detail.snapshot.completion_items.slice(0, count).map(/** @param {any} item */ (item) => ({ completion_item_key: item.completion_item_key, completed: true, actual: { metric: item.target.metric, value: item.target.min }, resistance: item.resistance, rir: null, completed_at: now })), training_intervals: detail.training_intervals, session_rpe: rpe, note: "  split work  ", exercise_feedback: [{ exercise_occurrence_key: detail.snapshot.exercise_occurrence_keys[0], text: "动作稳定" }], skip_reason: null };
}

test("tickets 19-20: record, end, continue, split intervals and terminal correction", async () => {
  const { handler } = appFixture();
  const start = await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "start"));
  let detail = await call(handler, `/api/private/sessions/${start.body.session_key}`); const partialRecord = recordFor(detail.body, 1);
  const saved = await call(handler, `/api/private/sessions/${start.body.session_key}/record`, json({ method: "PUT" }, partialRecord)); assert.equal(saved.response.status, 200);
  detail = await call(handler, `/api/private/sessions/${start.body.session_key}`); const endedAt = new Date().toISOString(); const endedRecord = recordFor(detail.body, 1, 7); endedRecord.training_intervals[0].ended_at = endedAt;
  const ended = await call(handler, `/api/private/sessions/${start.body.session_key}/end`, post({ record: endedRecord, ended_at: endedAt }, "end")); assert.equal(ended.response.status, 200); assert.equal(ended.body.status, "partial"); assert.equal(ended.body.training_intervals[0].ended_at, endedAt);
  const continued = await call(handler, `/api/private/sessions/${start.body.session_key}/continue`, post({}, "continue")); assert.equal(continued.response.status, 200); assert.equal(continued.body.status, "in_progress"); assert.equal(continued.body.training_intervals.length, 2);
  detail = await call(handler, `/api/private/sessions/${start.body.session_key}`); const closed = recordFor(detail.body, 4, 8); closed.training_intervals = detail.body.training_intervals.map(/** @param {any} interval */ (interval) => interval.ended_at ? interval : { ...interval, ended_at: new Date(Math.max(Date.now(), Date.parse(interval.started_at) + 1000)).toISOString() });
  const completed = await call(handler, `/api/private/sessions/${start.body.session_key}/end`, post({ record: closed, ended_at: closed.training_intervals.at(-1).ended_at }, "end-2")); assert.equal(completed.response.status, 200); assert.equal(completed.body.status, "completed");
  const beforeSnapshot = canonicalJson(completed.body.snapshot); const correction = { ...closed, completion_results: closed.completion_results.slice(0, 2), training_intervals: completed.body.training_intervals, session_rpe: 6, note: "corrected", exercise_feedback: [], skip_reason: null };
  const corrected = await call(handler, `/api/private/sessions/${start.body.session_key}/record`, json({ method: "PUT" }, correction)); assert.equal(corrected.response.status, 200); assert.equal(corrected.body.status, "partial"); assert.equal(canonicalJson(corrected.body.snapshot), beforeSnapshot);
});

test("ticket 21: progress exposes evidence and exercise detail", async () => {
  const { handler } = appFixture();
  const progress = await call(handler, "/api/private/progress?preset=30d"); assert.equal(progress.response.status, 200); assert.ok("completion_rate" in progress.body.metrics); assert.ok("current_streak" in progress.body);
  const missing = await call(handler, "/api/private/exercises/not-an-exercise?preset=12w"); assert.equal(missing.response.status, 404);
});

test("tickets 22-23: Coach Share and privacy-filtered export", async () => {
  const { handler, store } = appFixture();
  const created = await call(handler, "/api/private/coach-share", post({}, "share")); assert.equal(created.response.status, 201); assert.equal(created.body.url, undefined); assert.ok(created.body.created_at);
  const copy = await call(handler, "/api/private/coach-share"); assert.equal(copy.response.status, 200); assert.match(copy.body.url, /\/coach\//);
  const token = copy.body.url.split("/coach/")[1]; const manifest = await call(handler, `/api/coach/v1/${token}`, { headers: {} }, "ignored@example.invalid"); assert.equal(manifest.response.status, 200); assert.equal(manifest.body.schema_version, 1);
  const readme = await call(handler, `/coach/${token}`, { headers: {} }, "ignored@example.invalid"); assert.equal(readme.response.status, 200); assert.match(readme.body, /secret/);
  const started = await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "coach-session-start")); const coachDetail = await call(handler, `/api/coach/v1/${token}/sessions/${started.body.session_key}`, { headers: {} }, "ignored@example.invalid");
  assert.equal(coachDetail.response.status, 200); assert.equal("scheduled_workout_key" in coachDetail.body, false); assert.equal("created_at" in coachDetail.body, false); assert.equal("exercise_occurrence_keys" in coachDetail.body.snapshot, false);
  const exported = await call(handler, "/api/private/export"); assert.equal(exported.response.status, 200); assert.equal(exported.body.athlete_export_schema_version, 1); assert.equal("email" in exported.body.athlete, false); assert.equal("coach_share" in exported.body, false);
  const rawState = await store.getByEmail("athlete-a@example.invalid"); assert.equal(rawState.coach_share.token, undefined); assert.equal(rawState.coach_share.plaintext, undefined);
  const revoked = await call(handler, "/api/private/coach-share", { method: "DELETE" }); assert.equal(revoked.response.status, 200); const invalid = await call(handler, `/coach/${token}`, { headers: {} }, "ignored@example.invalid"); assert.equal(invalid.response.status, 404);
});
