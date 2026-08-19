import test from "node:test";
import assert from "node:assert/strict";
import { WEEKDAYS, weekdayKey } from "../src/util.js";
import { agentRequest, appFixture, call, createAgentToken, today } from "./helpers.js";

async function seedAlternatingSession() {
  const fixture = appFixture();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  const slot = {
    kind: "workout",
    title: "交替核心",
    start_time: "21:00",
    estimated_duration_min: 15,
    blocks: [{
      title: "核心",
      exercises: [{
        occurrence_key: "dead_bug_main",
        exercise_id: "dead_bug",
        execution_mode: "alternating",
        name: "死虫",
        definition_version: 1,
        sets: [{ set_id: "dead_bug_set_1", ordinal: 1, target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, tempo: "3-1-1-0", rest_after_sec: 20 }],
      }],
    }],
  };
  state.plan_revisions = [{ revision_key: "rev-alternating", revision_sequence: 1, created_at: new Date().toISOString(), effective_from: "2026-01-01", week: Object.fromEntries(WEEKDAYS.map((day) => [day, day === weekdayKey(today) ? slot : null])) }];
  await fixture.store.save(state);
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, { method: "POST", headers: { "Idempotency-Key": `alternating-start-${Math.random()}` }, body: "{}" });
  assert.equal(started.response.status, 201);
  const detail = await call(fixture.handler, `/api/private/sessions/${started.body.session_key}`);
  assert.equal(detail.response.status, 200);
  return { ...fixture, sessionKey: started.body.session_key, detail: detail.body };
}

async function seedExternalLoadSession() {
  const fixture = appFixture();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  const slot = {
    kind: "workout",
    title: "负重臀桥",
    start_time: "21:00",
    estimated_duration_min: 15,
    blocks: [{
      title: "臀腿",
      exercises: [{
        occurrence_key: "glute_bridge_main",
        exercise_id: "glute_bridge",
        execution_mode: "bilateral",
        name: "臀桥",
        definition_version: 1,
        sets: [{ set_id: "glute_bridge_set_1", ordinal: 1, target: { metric: "reps", value: 8 }, resistance_mode: "external_load", resistance_kg: 12, tempo: "2-1-2-0", rest_after_sec: 30 }],
      }],
    }],
  };
  state.plan_revisions = [{ revision_key: "rev-external", revision_sequence: 1, created_at: new Date().toISOString(), effective_from: "2026-01-01", week: Object.fromEntries(WEEKDAYS.map((day) => [day, day === weekdayKey(today) ? slot : null])) }];
  await fixture.store.save(state);
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, { method: "POST", headers: { "Idempotency-Key": `external-start-${Math.random()}` }, body: "{}" });
  assert.equal(started.response.status, 201);
  const detail = await call(fixture.handler, `/api/private/sessions/${started.body.session_key}`);
  assert.equal(detail.response.status, 200);
  return { ...fixture, sessionKey: started.body.session_key, detail: detail.body };
}

test("canonical Sessions reject the legacy Session Record shape at the write boundary", async () => {
  const fixture = await seedAlternatingSession();
  const result = await call(fixture.handler, `/api/private/sessions/${fixture.sessionKey}/record`, {
    method: "PUT",
    body: JSON.stringify({ record_schema_version: 1, completion_results: [], training_intervals: fixture.detail.training_intervals, session_rpe: null, note: null, exercise_feedback: [], skip_reason: null }),
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "invalid_session_record");
  assert.match(result.body.error.message, /schema_version 2/);
});

/** @param {any} detail @param {string} endedAt */
function closedIntervals(detail, endedAt) {
  return detail.training_intervals.map(/** @param {any} interval */ (interval) => interval.ended_at ? interval : { ...interval, ended_at: endedAt });
}

test("alternating results keep left/right facts while accepting partial status and unit-normalized actual resistance", async () => {
  const fixture = await seedAlternatingSession();
  const now = new Date().toISOString();
  const endedAt = new Date(Date.now() + 1000).toISOString();
  const [left, right] = fixture.detail.snapshot.completion_items;
  const record = {
    record_schema_version: 2,
    set_results: [
      { completion_item_key: left.completion_item_key, status: "completed", actual: { metric: "reps", value: 5 }, resistance: { mode: "bodyweight" }, rir: 2, note: "左侧稳定", completed_at: now },
      { completion_item_key: right.completion_item_key, status: "partial", actual: { metric: "reps", value: 3 }, resistance: { mode: "bodyweight" }, rir: null, note: "右侧提前结束", completed_at: now },
    ],
    training_intervals: closedIntervals(fixture.detail, endedAt),
    session_rpe: 7,
    note: "交替训练记录",
    exercise_feedback: [{ exercise_occurrence_key: "dead_bug_main", text: "左右控制不同" }],
    skip_reason: null,
  };
  const ended = await call(fixture.handler, `/api/private/sessions/${fixture.sessionKey}/end`, { method: "POST", headers: { "Idempotency-Key": "alternating-end" }, body: JSON.stringify({ record, ended_at: endedAt }) });
  assert.equal(ended.response.status, 200);
  assert.equal(ended.body.status, "partial");
  assert.deepEqual(ended.body.set_results.map(/** @param {any} result */ (result) => result.status), ["completed", "partial"]);
  assert.equal(ended.body.set_results[0].actual.value, 5);
  assert.equal(ended.body.set_results[0].resistance_kg, null);
  assert.equal(ended.body.set_results[1].note, "右侧提前结束");
  assert.equal(ended.body.exercise_feedback[0].exercise_occurrence_key, "dead_bug_main");
  const agent = await agentRequest(fixture.handler, await createAgentToken(fixture.handler), `/api/agent/v1/sessions/${fixture.sessionKey}`);
  assert.equal(agent.response.status, 200);
  assert.equal(agent.body.snapshot.blocks[0].exercises[0].exercise_id, "dead_bug");
  assert.equal(agent.body.completion_results[1].status, "partial");
  assert.equal(agent.body.completion_results[1].note, "右侧提前结束");
  const history = await agentRequest(fixture.handler, await createAgentToken(fixture.handler), "/api/agent/v1/exercises/dead_bug");
  assert.equal(history.response.status, 200);
  assert.equal(history.body.exercise_id, "dead_bug");
  assert.equal(history.body.current_name, "死虫");
  assert.equal(history.body.series.left[0].status, "completed");
  assert.equal(history.body.series.right[0].status, "partial");
});

test("canonical Set Results can be corrected once without mutating the frozen snapshot", async () => {
  const fixture = await seedAlternatingSession();
  const beforeSnapshot = structuredClone(fixture.detail.snapshot);
  const now = new Date().toISOString();
  const endedAt = new Date(Date.now() + 1000).toISOString();
  const results = fixture.detail.snapshot.completion_items.map(/** @param {any} item */ (item) => ({ completion_item_key: item.completion_item_key, status: "completed", actual: { metric: item.target.metric, value: item.target.value }, resistance: { mode: "bodyweight" }, rir: 1, note: null, completed_at: now }));
  const body = { record_schema_version: 2, set_results: results, training_intervals: closedIntervals(fixture.detail, endedAt), session_rpe: null, note: null, exercise_feedback: [], skip_reason: null };
  const ended = await call(fixture.handler, `/api/private/sessions/${fixture.sessionKey}/end`, { method: "POST", headers: { "Idempotency-Key": "alternating-correction-end" }, body: JSON.stringify({ record: body, ended_at: endedAt }) });
  assert.equal(ended.response.status, 200);
  const correctedResults = results.map(/** @param {any} result */ (result) => result.completion_item_key === results[1].completion_item_key ? { ...result, actual: { metric: "reps", value: 4 }, note: "修正右侧" } : result);
  const corrected = await call(fixture.handler, `/api/private/sessions/${fixture.sessionKey}/record`, { method: "PUT", body: JSON.stringify({ ...body, set_results: correctedResults, training_intervals: ended.body.training_intervals }) });
  assert.equal(corrected.response.status, 200);
  assert.equal(corrected.body.status, "completed");
  assert.equal(corrected.body.set_results[1].actual.value, 4);
  assert.equal(corrected.body.set_results[1].note, "修正右侧");
  assert.deepEqual(corrected.body.snapshot, beforeSnapshot);
});

test("canonical result validation preserves explicit skipped absence and rejects duplicate Completion Items", async () => {
  const fixture = await seedAlternatingSession();
  const now = new Date().toISOString();
  const [left] = fixture.detail.snapshot.completion_items;
  const base = { record_schema_version: 2, set_results: [{ completion_item_key: left.completion_item_key, status: "skipped", actual: null, resistance: null, rir: null, note: null, completed_at: null }], training_intervals: fixture.detail.training_intervals, session_rpe: null, note: null, exercise_feedback: [], skip_reason: null };
  const skipped = await call(fixture.handler, `/api/private/sessions/${fixture.sessionKey}/record`, { method: "PUT", body: JSON.stringify(base) });
  assert.equal(skipped.response.status, 200);
  assert.equal(skipped.body.set_results[0].status, "skipped");
  assert.equal(skipped.body.set_results[0].actual, null);

  const duplicate = { ...base, set_results: [base.set_results[0], base.set_results[0]] };
  const invalid = await call(fixture.handler, `/api/private/sessions/${fixture.sessionKey}/record`, { method: "PUT", body: JSON.stringify(duplicate) });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "invalid_session_record");
  assert.match(JSON.stringify(invalid.body.error.details), /duplicate/);
  assert.ok(now);
});

test("canonical actual external load accepts lb input and stores canonical kg", async () => {
  const fixture = await seedExternalLoadSession();
  const item = fixture.detail.snapshot.completion_items[0];
  const startedAt = fixture.detail.training_intervals[0].started_at;
  const completedAt = new Date().toISOString();
  const endedAt = new Date(Date.now() + 1000).toISOString();
  const record = {
    record_schema_version: 2,
    set_results: [{ completion_item_key: item.completion_item_key, status: "completed", actual: { metric: "reps", value: 8 }, resistance: { mode: "external_load", value: 22, unit: "lb" }, rir: 2, note: null, completed_at: completedAt }],
    training_intervals: [{ ...fixture.detail.training_intervals[0], ended_at: endedAt }],
    session_rpe: 6,
    note: null,
    exercise_feedback: [],
    skip_reason: null,
  };
  const ended = await call(fixture.handler, `/api/private/sessions/${fixture.sessionKey}/end`, { method: "POST", headers: { "Idempotency-Key": "external-end" }, body: JSON.stringify({ record, ended_at: endedAt }) });
  assert.equal(ended.response.status, 200);
  assert.equal(ended.body.set_results[0].resistance_mode, "external_load");
  assert.equal(ended.body.set_results[0].resistance_kg, 9.97903);
});
