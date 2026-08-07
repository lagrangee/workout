// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { addDays, base64UrlDecode, base64UrlEncode } from "../src/util.js";
import { createSession } from "../src/session.js";
import { appFixture, call, post, testAgentSecret, today } from "./helpers.js";

async function createToken(handler) {
  const result = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" });
  assert.equal(result.response.status, 201);
  return result.body.token;
}

async function agentGet(handler, token, path, headers = {}) {
  const response = await handler.fetch(new Request(`https://workout.example${path}`, { headers: { Authorization: `Bearer ${token}`, ...headers } }), {
    LOCAL_AUTH: "true",
    PUBLIC_ORIGIN: "https://workout.example",
    AGENT_TOKEN_SECRET: testAgentSecret,
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

async function seedHistoricalSession(store, date) {
  const state = await store.getByEmail("athlete-a@example.invalid");
  const result = createSession(state, date, new Date(`${date}T04:00:00.000Z`), "start");
  assert.equal(result.error, undefined);
  await store.save(state);
}

test("Agent Session list preserves bounded filters, provenance, and training version", async () => {
  const { handler } = appFixture();
  const started = await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "agent-history-start"));
  assert.equal(started.response.status, 201);
  const token = await createToken(handler);

  const manifest = await agentGet(handler, token, "/api/agent/v1");
  assert.equal(manifest.response.status, 200);
  assert.equal(manifest.body.links.sessions, "/api/agent/v1/sessions");
  assert.equal(manifest.body.links.progress, "/api/agent/v1/progress");
  assert.equal(manifest.body.links.exercise, "/api/agent/v1/exercises/{exercise_key}");
  assert.equal(manifest.body.endpoints.sessions.rules.cursor_ttl_minutes, 15);
  assert.equal(manifest.body.endpoints.progress.rules.max_days, 3660);

  const listed = await agentGet(handler, token, `/api/agent/v1/sessions?from=${today}&to=${today}&status=in_progress&exercise_key=goblet_squat&limit=1`);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.period.from, today);
  assert.equal(listed.body.period.to, today);
  assert.equal(listed.body.page.limit, 1);
  assert.equal(typeof listed.body.training_version, "number");
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.items[0].status, "in_progress");
  assert.match(listed.body.items[0].source_ref, /^session:/);
});

test("Agent Session cursors bind filters and training version", async () => {
  const { handler, store } = appFixture();
  await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "agent-history-page-start"));
  await seedHistoricalSession(store, addDays(today, -7));
  const token = await createToken(handler);

  const first = await agentGet(handler, token, "/api/agent/v1/sessions?limit=1");
  assert.equal(first.response.status, 200);
  assert.equal(first.body.items.length, 1);
  assert.equal(typeof first.body.page.next_cursor, "string");

  const second = await agentGet(handler, token, `/api/agent/v1/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.items.length, 1);
  assert.notEqual(second.body.items[0].session_key, first.body.items[0].session_key);

  const wrongFilter = await agentGet(handler, token, `/api/agent/v1/sessions?limit=1&status=completed&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(wrongFilter.response.status, 400);
  assert.equal(wrongFilter.body.error.code, "invalid_cursor");

  const expiredCursor = JSON.parse(new TextDecoder().decode(base64UrlDecode(first.body.page.next_cursor)));
  expiredCursor.issued_at = Date.now() - 16 * 60 * 1000;
  const expired = await agentGet(handler, token, `/api/agent/v1/sessions?limit=1&cursor=${encodeURIComponent(base64UrlEncode(new TextEncoder().encode(JSON.stringify(expiredCursor))))}`);
  assert.equal(expired.response.status, 400);
  assert.equal(expired.body.error.code, "invalid_cursor");

  const malformed = await agentGet(handler, token, "/api/agent/v1/sessions?limit=1&cursor=not-a-cursor");
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.body.error.code, "invalid_cursor");

  const state = await store.getByEmail("athlete-a@example.invalid");
  state.training_version += 1;
  await store.save(state);
  const changed = await agentGet(handler, token, `/api/agent/v1/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(changed.response.status, 409);
  assert.equal(changed.body.error.code, "training_version_changed");
});

test("Agent Session list preserves skipped status and empty status boundaries", async () => {
  const { handler } = appFixture();
  const skipped = await call(handler, `/api/private/scheduled-workouts/${today}/skip`, post({ skip_reason: "恢复" }, "agent-history-skip"));
  assert.equal(skipped.response.status, 201);
  const token = await createToken(handler);

  const skippedPage = await agentGet(handler, token, `/api/agent/v1/sessions?from=${today}&to=${today}&status=skipped`);
  assert.equal(skippedPage.response.status, 200);
  assert.equal(skippedPage.body.items.length, 1);
  assert.equal(skippedPage.body.items[0].status, "skipped");

  const completedPage = await agentGet(handler, token, `/api/agent/v1/sessions?from=${today}&to=${today}&status=completed`);
  assert.equal(completedPage.response.status, 200);
  assert.deepEqual(completedPage.body.items, []);
  assert.equal(completedPage.body.page.next_cursor, null);
});

test("Agent Session detail preserves the immutable snapshot and actual training data", async () => {
  const { handler } = appFixture();
  const started = await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "agent-history-detail-start"));
  assert.equal(started.response.status, 201);
  const token = await createToken(handler);

  const detail = await agentGet(handler, token, `/api/agent/v1/sessions/${encodeURIComponent(started.body.session_key)}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.session_key, started.body.session_key);
  assert.equal(detail.body.status, "in_progress");
  assert.equal(Array.isArray(detail.body.snapshot.blocks), true);
  assert.equal(Array.isArray(detail.body.snapshot.completion_items), true);
  assert.equal(Array.isArray(detail.body.completion_results), true);
  assert.equal(Array.isArray(detail.body.training_intervals), true);
  assert.equal(detail.body.session_rpe, null);
  assert.equal(detail.body.note, null);
  assert.deepEqual(detail.body.exercise_feedback, []);
  assert.equal(typeof detail.body.training_version, "number");
  assert.equal(typeof detail.body.data_as_of, "string");
  assert.match(detail.body.source_ref, /^session:/);

  const missing = await agentGet(handler, token, "/api/agent/v1/sessions/not-a-session");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "not_found");

  const tokenBResult = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" }, "athlete-b@example.invalid");
  assert.equal(tokenBResult.response.status, 201);
  const foreign = await agentGet(handler, tokenBResult.body.token, `/api/agent/v1/sessions/${encodeURIComponent(started.body.session_key)}`);
  assert.equal(foreign.response.status, 404);
  assert.equal(foreign.body.error.code, "not_found");
});

test("Agent progress preserves metric evidence, incomplete current date, and empty denominators", async () => {
  const { handler } = appFixture();
  const tokenA = await createToken(handler);
  const tokenBResult = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" }, "athlete-b@example.invalid");
  const tokenB = tokenBResult.body.token;
  const empty = await agentGet(handler, tokenB, "/api/agent/v1/progress?preset=all&bucket=week");
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.metrics.completion_rate.value, null);
  assert.equal(empty.body.metrics.completion_rate.evidence.due_workouts, 0);
  assert.equal(empty.body.metrics.training_duration.value_sec, 0);
  assert.equal(empty.body.metrics.strength_training_days.value, 0);
  assert.equal(empty.body.metrics.average_session_rpe.value, null);
  assert.equal(empty.body.period.current_date_may_be_incomplete, true);
  assert.equal(Array.isArray(empty.body.week_buckets), true);
  assert.equal(typeof empty.body.training_version, "number");
  assert.equal(empty.body.source_ref, "progress");

  const started = await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "agent-history-progress-start"));
  const detail = await call(handler, `/api/private/sessions/${started.body.session_key}`);
  const recordedAt = new Date().toISOString();
  const endedAt = new Date(Date.now() + 1000).toISOString();
  const record = {
    record_schema_version: 1,
    completion_results: detail.body.snapshot.completion_items.slice(0, 1).map((item) => ({ completion_item_key: item.completion_item_key, completed: true, actual: { metric: item.target.metric, value: item.target.min }, resistance: item.resistance, rir: 2, completed_at: recordedAt })),
    training_intervals: detail.body.training_intervals,
    session_rpe: 7,
    note: "progress evidence",
    exercise_feedback: [{ exercise_occurrence_key: detail.body.snapshot.exercise_occurrence_keys[0], text: "稳定" }],
    skip_reason: null,
  };
  const ended = await call(handler, `/api/private/sessions/${started.body.session_key}/end`, post({ record, ended_at: endedAt }, "agent-history-progress-end"));
  assert.equal(ended.response.status, 200);
  assert.equal(ended.body.status, "partial");

  const populated = await agentGet(handler, tokenA, `/api/agent/v1/progress?from=${today}&to=${today}&bucket=week`);
  assert.equal(populated.response.status, 200);
  assert.equal(populated.body.metrics.training_duration.value_sec >= 0, true);
  assert.equal(populated.body.metrics.average_session_rpe.value, 7);
  assert.equal(populated.body.metrics.average_session_rpe.included_count, 1);
  assert.equal(populated.body.metrics.completion_rate.evidence.partial, 1);
  assert.equal(populated.body.metrics.completion_rate.evidence.due_workouts, 1);
  assert.equal(populated.body.buckets.length, 1);
});

test("Agent exercise history preserves names, resistance semantics, sides, and Session references", async () => {
  const { handler } = appFixture();
  const started = await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "agent-history-exercise-start"));
  const detail = await call(handler, `/api/private/sessions/${started.body.session_key}`);
  const recordedAt = new Date().toISOString();
  const endedAt = new Date(Date.now() + 1000).toISOString();
  const record = {
    record_schema_version: 1,
    completion_results: detail.body.snapshot.completion_items.map((item) => ({ completion_item_key: item.completion_item_key, completed: true, actual: { metric: item.target.metric, value: item.target.min }, resistance: item.resistance, rir: 1, completed_at: recordedAt })),
    training_intervals: detail.body.training_intervals,
    session_rpe: 8,
    note: "exercise history",
    exercise_feedback: [],
    skip_reason: null,
  };
  const ended = await call(handler, `/api/private/sessions/${started.body.session_key}/end`, post({ record, ended_at: endedAt }, "agent-history-exercise-end"));
  assert.equal(ended.response.status, 200);
  assert.equal(ended.body.status, "completed");
  const token = await createToken(handler);

  const history = await agentGet(handler, token, `/api/agent/v1/exercises/split_squat?from=${today}&to=${today}`);
  assert.equal(history.response.status, 200);
  assert.equal(history.body.exercise_key, "split_squat");
  assert.equal(history.body.performed_session_count, 1);
  assert.equal(history.body.display_name_history[0].name, "分腿蹲");
  assert.equal(history.body.observations[0].source_ref, `session:${today}:${started.body.session_key}`);
  assert.equal(history.body.observations[0].sets.some((set) => set.side === "left"), true);
  assert.equal(history.body.observations[0].sets.some((set) => set.side === "right"), true);
  assert.equal(history.body.series.none.length, 0);
  assert.equal(history.body.series.left.length, 1);
  assert.equal(history.body.series.right.length, 1);
  assert.equal(history.body.series.left[0].resistance.mode, "bodyweight");
  assert.equal(typeof history.body.training_version, "number");
  assert.equal(history.body.source_ref, "exercise:split_squat");

  const missing = await agentGet(handler, token, `/api/agent/v1/exercises/not-an-exercise?from=${today}&to=${today}`);
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "not_found");
});
