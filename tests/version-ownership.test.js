// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { agentRequest, appFixture, call, createAgentToken, packageText, post } from "./helpers.js";
import { addDays } from "../src/util.js";
import { publishAerobicProjection } from "../src/training-archive.js";

const now = new Date("2026-08-17T08:00:00.000Z");

function activity(ref, localDate) {
  return {
    activity_ref: ref,
    source_ref: `coros:activity:${ref}`,
    local_date: localDate,
    timezone: "Asia/Shanghai",
    started_at: `${localDate}T01:00:00.000Z`,
    ended_at: `${localDate}T02:00:00.000Z`,
    sport_type: 100,
    sport_name: "outdoor_run",
    source_status: "complete",
    data_as_of: now.toISOString(),
    updated_at: now.toISOString(),
    summary: { duration_sec: 3600, distance_km: 5, average_heart_rate_bpm: 140, calories_kcal: 300, sport_metrics: {} },
    route_key: null,
    route_direction: null,
    route_match_status: "unmatched",
    fit_status: "complete",
  };
}

function publish(state, targetDate, activities) {
  publishAerobicProjection(state, {
    target_date: targetDate,
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: now.toISOString(),
    activities,
    routes: [],
  }, now);
}

test("private Plan apply advances the Workout training version exactly once", async () => {
  const { handler, store } = appFixture();
  const before = await store.getByEmail("athlete-a@example.invalid");
  const result = await call(handler, "/api/private/plan-updates/apply", post({
    package_text: packageText(addDays(before.plan_revisions[0].effective_from, 14)),
  }, "version-owner-plan-apply"));

  assert.equal(result.response.status, 201);
  const after = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(after.training_version, before.training_version + 1);

  const replay = await call(handler, "/api/private/plan-updates/apply", post({
    package_text: packageText(addDays(before.plan_revisions[0].effective_from, 14)),
  }, "version-owner-plan-apply"));
  assert.equal(replay.response.status, 201);
  assert.equal((await store.getByEmail("athlete-a@example.invalid")).training_version, after.training_version);
});

test("Archive cursors bind archive changes and ignore Workout-only version changes", async () => {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  const trainingVersion = state.training_version;
  publish(state, "2026-08-15", [activity("archive-version-a", "2026-08-15"), activity("archive-version-b", "2026-08-15")]);
  assert.equal(state.archive_version, 1);
  assert.equal(state.training_version, trainingVersion);
  await store.save(state);

  const token = await createAgentToken(handler);
  const first = await agentRequest(handler, token, "/api/agent/v1/aerobic/activities?limit=1");
  assert.equal(first.response.status, 200);
  assert.equal(first.body.archive_version, 1);
  assert.equal(typeof first.body.page.next_cursor, "string");

  const workoutOnly = await store.getByEmail("athlete-a@example.invalid");
  workoutOnly.training_version += 1;
  await store.save(workoutOnly);
  const afterWorkout = await agentRequest(handler, token, `/api/agent/v1/aerobic/activities?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(afterWorkout.response.status, 200);
  assert.equal(afterWorkout.body.items.length, 1);

  const archiveChange = await store.getByEmail("athlete-a@example.invalid");
  publish(archiveChange, "2026-08-14", [activity("archive-version-c", "2026-08-14")]);
  assert.equal(archiveChange.archive_version, 2);
  await store.save(archiveChange);
  const stale = await agentRequest(handler, token, `/api/agent/v1/aerobic/activities?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(stale.response.status, 400);
  assert.equal(stale.body.error.code, "invalid_cursor");
});
