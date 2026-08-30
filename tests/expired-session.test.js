// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../src/util.js";
import { createSession } from "../src/session.js";
import { appendPlanRevision } from "../src/plan.js";
import { appFixture, call, post, TEST_NOW, today } from "./helpers.js";

async function seedExpiredSession() {
  const fixture = appFixture();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  const scheduledDate = addDays(today, -7);
  appendPlanRevision(state, { effective_from: scheduledDate, week: structuredClone(state.plan_revisions[0].week) }, new Date(`${scheduledDate}T01:00:00.000Z`));
  const startedAt = new Date(`${scheduledDate}T02:00:00.000Z`);
  const created = createSession(state, scheduledDate, startedAt, "start");
  assert.ok(created.session);
  const session = created.session;
  session.updated_at = startedAt.toISOString();
  await fixture.store.save(state);
  return { ...fixture, scheduledDate, sessionKey: session.session_key };
}

test("expired in-progress Sessions normalize to partial, close their interval, and never auto-complete", async () => {
  const fixture = await seedExpiredSession();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  const session = state.sessions.find((item) => item.session_key === fixture.sessionKey);
  session.completion_results = session.snapshot.completion_items.map((item) => ({
    completion_item_key: item.completion_item_key,
    completed: true,
    actual: { metric: item.target.metric, value: item.target.max },
    resistance: item.resistance,
    rir: null,
    completed_at: session.training_intervals[0].started_at,
  }));
  await fixture.store.save(state);

  const normalized = await call(fixture.handler, "/api/private/sessions/normalize-expired", post({}, "normalize-expired-1"));
  assert.equal(normalized.response.status, 200);
  assert.equal(normalized.body.normalized_count, 1);

  const after = await fixture.store.getByEmail("athlete-a@example.invalid");
  const updated = after.sessions.find((item) => item.session_key === fixture.sessionKey);
  assert.equal(updated.status, "partial");
  assert.equal(updated.completion_results.length, updated.snapshot.completion_items.length);
  assert.ok(updated.training_intervals[0].ended_at);
  assert.ok(Date.parse(updated.training_intervals[0].ended_at) > Date.parse(updated.training_intervals[0].started_at));

  const replay = await call(fixture.handler, "/api/private/sessions/normalize-expired", post({}, "normalize-expired-1"));
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.normalized_count, 1);

  const noOp = await call(fixture.handler, "/api/private/sessions/normalize-expired", post({}, "normalize-expired-2"));
  assert.equal(noOp.response.status, 200);
  assert.equal(noOp.body.normalized_count, 0);
});

test("normalization leaves today's in-progress Session untouched", async () => {
  const fixture = await seedExpiredSession();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  const todayStart = createSession(state, today, new Date(TEST_NOW), "start");
  assert.ok(todayStart.session);
  await fixture.store.save(state);

  const normalized = await call(fixture.handler, "/api/private/sessions/normalize-expired", post({}, "normalize-expired-today"));
  assert.equal(normalized.response.status, 200);
  assert.equal(normalized.body.normalized_count, 1);

  const after = await fixture.store.getByEmail("athlete-a@example.invalid");
  const current = after.sessions.find((item) => item.session_key === todayStart.session.session_key);
  assert.equal(current.status, "in_progress");
  assert.equal(current.training_intervals.at(-1).ended_at, null);
});
