import test from "node:test";
import assert from "node:assert/strict";
import { appFixture, call, json, post, TEST_NOW, testInstant, today } from "./helpers.js";
import { createSession } from "../src/session.js";
import { addDays } from "../src/util.js";
import { appendPlanRevision } from "../src/plan.js";

test("Session HTTP seam: pause and resume keep elapsed time server-authoritative", async () => {
  let current = Date.parse(TEST_NOW);
  const fixture = appFixture({ clock: () => new Date(current) });
  const started = await call(
    fixture.handler,
    `/api/private/scheduled-workouts/${today}/start`,
    post({}, "session-feedback-start"),
  );

  assert.equal(started.response.status, 201);
  assert.equal(started.body.status, "in_progress");
  assert.equal(started.body.training_intervals.length, 1);
  assert.equal(started.body.training_intervals[0].ended_at, null);

  current += 3_000;
  const paused = await call(
    fixture.handler,
    `/api/private/sessions/${started.body.session_key}/pause`,
    post({}, "session-feedback-pause"),
  );

  assert.equal(paused.response.status, 200);
  assert.equal(paused.body.status, "in_progress");
  assert.equal(paused.body.training_duration_sec, 3);
  assert.ok(paused.body.training_intervals[0].ended_at);

  current += 60_000;
  const resumed = await call(
    fixture.handler,
    `/api/private/sessions/${started.body.session_key}/resume`,
    post({}, "session-feedback-resume"),
  );

  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.body.training_intervals.length, 2);
  assert.equal(resumed.body.training_intervals[1].started_at, new Date(current).toISOString());
  assert.equal(resumed.body.training_intervals[1].ended_at, null);

  const replayedResume = await call(
    fixture.handler,
    `/api/private/sessions/${started.body.session_key}/resume`,
    post({}, "session-feedback-resume-replay"),
  );
  assert.deepEqual(replayedResume.body.training_intervals, resumed.body.training_intervals);

  current += 2_000;
  const pausedAgain = await call(
    fixture.handler,
    `/api/private/sessions/${started.body.session_key}/pause`,
    post({}, "session-feedback-pause-again"),
  );

  assert.equal(pausedAgain.response.status, 200);
  assert.equal(pausedAgain.body.training_duration_sec, 5);
  assert.ok(pausedAgain.body.training_intervals.every((interval) => interval.ended_at));
});

test("Session HTTP seam: record mutation returns the complete updated Session", async () => {
  let current = Date.parse(TEST_NOW);
  const fixture = appFixture({ clock: () => new Date(current) });
  const started = await call(
    fixture.handler,
    `/api/private/scheduled-workouts/${today}/start`,
    post({}, "session-feedback-record-start"),
  );
  const item = started.body.snapshot.completion_items[0];
  const feedback = { exercise_occurrence_key: item.exercise_occurrence_key, text: "动作很稳" };
  current += 1_000;
  const record = {
    record_schema_version: 1,
    completion_results: [{
      completion_item_key: item.completion_item_key,
      completed: true,
      actual: { metric: item.target.metric, value: 11 },
      resistance: item.resistance,
      rir: null,
      completed_at: testInstant(1_000),
    }],
    training_intervals: started.body.training_intervals,
    session_rpe: null,
    note: null,
    exercise_feedback: [feedback],
    skip_reason: null,
  };

  const updated = await call(
    fixture.handler,
    `/api/private/sessions/${started.body.session_key}/record`,
    json({ method: "PUT" }, record),
  );

  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.session_key, started.body.session_key);
  assert.equal(updated.body.status, "in_progress");
  assert.equal(updated.body.completion_results.length, 1);
  assert.equal(updated.body.completion_results[0].actual.value, 11);
  assert.deepEqual(updated.body.exercise_feedback, [feedback]);
  assert.equal(updated.body.snapshot.completion_items.length, started.body.snapshot.completion_items.length);
  assert.equal(updated.body.training_intervals.at(-1).ended_at, null);
});

test("Session HTTP seam: normalization closes only expired active Sessions as partial", async () => {
  const fixture = appFixture();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  const scheduledDate = addDays(today, -7);
  appendPlanRevision(state, { effective_from: scheduledDate, week: structuredClone(state.plan_revisions[0].week) }, new Date(`${scheduledDate}T01:00:00.000Z`));
  const startedAt = new Date(`${scheduledDate}T02:00:00.000Z`);
  const created = createSession(state, scheduledDate, startedAt, "start");
  assert.ok(created.session);
  created.session.updated_at = startedAt.toISOString();

  const current = createSession(state, today, new Date(TEST_NOW), "start");
  assert.ok(current.session);

  const terminal = structuredClone(created.session);
  terminal.session_key = "session-terminal-control";
  terminal.status = "completed";
  terminal.training_intervals.forEach((interval) => {
    interval.ended_at = new Date(startedAt.getTime() + 60_000).toISOString();
  });
  state.sessions.push(terminal);
  await fixture.store.save(state);

  const otherAthlete = await fixture.store.getByEmail("athlete-b@example.invalid");
  const otherAthleteActive = structuredClone(created.session);
  otherAthleteActive.session_key = "session-other-athlete-control";
  otherAthlete.sessions.push(otherAthleteActive);
  await fixture.store.save(otherAthlete);

  const normalized = await call(
    fixture.handler,
    "/api/private/sessions/normalize-expired",
    post({}, "session-feedback-normalize"),
  );

  assert.equal(normalized.response.status, 200);
  assert.equal(normalized.body.normalized_count, 1);
  assert.deepEqual(normalized.body.session_keys, [created.session.session_key]);

  const detail = await call(
    fixture.handler,
    `/api/private/sessions/${created.session.session_key}`,
  );
  assert.equal(detail.body.status, "partial");
  assert.ok(detail.body.training_intervals.every((interval) => interval.ended_at));

  const after = await fixture.store.getByEmail("athlete-a@example.invalid");
  const currentAfter = after.sessions.find((session) => session.session_key === current.session.session_key);
  const terminalAfter = after.sessions.find((session) => session.session_key === terminal.session_key);
  assert.equal(currentAfter.status, "in_progress");
  assert.equal(currentAfter.training_intervals.at(-1).ended_at, null);
  assert.equal(terminalAfter.status, "completed");
  assert.deepEqual(terminalAfter.training_intervals, terminal.training_intervals);

  const otherAthleteAfter = await fixture.store.getByEmail("athlete-b@example.invalid");
  const isolated = otherAthleteAfter.sessions.find(
    (session) => session.session_key === otherAthleteActive.session_key,
  );
  assert.equal(isolated.status, "in_progress");
  assert.equal(isolated.training_intervals.at(-1).ended_at, null);

  const replay = await call(
    fixture.handler,
    "/api/private/sessions/normalize-expired",
    post({}, "session-feedback-normalize-next"),
  );
  assert.equal(replay.body.normalized_count, 0);
  assert.deepEqual(replay.body.session_keys, []);
});
