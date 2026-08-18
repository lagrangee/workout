// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { agentRequest, appFixture, createAgentToken } from "./helpers.js";

const syncPath = "/api/agent/v1/aerobic/sync";

function projection(overrides = {}) {
  return {
    schema_version: 1,
    publication_key: "training-archive:2026-08-15",
    source_ref: "training-archive:2026-08-15",
    target_date: "2026-08-15",
    timezone: "Asia/Shanghai",
    source_status: "complete",
    source_statuses: { workout: "complete", coros: "complete" },
    workout_source_status: "complete",
    source_data_as_of: { workout: "2026-08-17T11:00:53.417Z", coros: "2026-08-17T11:00:56.975Z" },
    data_as_of: "2026-08-17T11:00:56.975Z",
    routes: [{ schema_version: 1, route_key: "香山鸡腿线", route_name: "香山鸡腿线", sport_types: [102, 104], distance_range_km: [11.01, 13.45] }],
    activities: [{
      schema_version: 1,
      activity_ref: "coros-live-2026-08-15",
      source_ref: "coros:activity:coros-live-2026-08-15",
      local_date: "2026-08-15",
      timezone: "Asia/Shanghai",
      started_at: "2026-08-15T07:27:28.000Z",
      ended_at: "2026-08-15T09:51:40.000Z",
      sport_type: 102,
      sport_name: "trail_run",
      source_status: "complete",
      data_as_of: "2026-08-17T11:00:56.975Z",
      updated_at: "2026-08-17T11:00:56.975Z",
      summary: { duration_sec: 8652, total_duration_sec: null, distance_km: 12.23, average_heart_rate_bpm: 157, max_heart_rate_bpm: null, calories_kcal: 1595, training_load: null, aerobic_te: null, anaerobic_te: null, training_focus: null, perceived_effort: null, sport_metrics: { running: { average_pace_sec_per_km: 708 } } },
      route_key: "香山鸡腿线",
      route_direction: "forward",
      route_match_status: "matched",
      fit_status: "complete",
    }],
    ...overrides,
  };
}

async function agentPost(handler, token, path, body, headers = {}) {
  return agentRequest(handler, token, path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("Agent aerobic sync writes the safe projection through the Agent API and remains readable", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);

  const result = await agentPost(handler, token, syncPath, { projection: projection() }, { "Idempotency-Key": "agent-aerobic-2026-08-15" });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.publication_key, "training-archive:2026-08-15");
  assert.equal(result.body.published_count, 1);
  assert.equal(result.body.activity_count, 1);
  assert.equal(result.body.route_count, 1);

  const list = await agentRequest(handler, token, "/api/agent/v1/aerobic/activities?from=2026-08-15&to=2026-08-15");
  assert.equal(list.response.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].activity_ref, "coros-live-2026-08-15");
  assert.equal(list.body.items[0].route_key, "香山鸡腿线");
  assert.doesNotMatch(JSON.stringify(list.body), /fit_file|gps|telemetry|\.fit/i);

  const state = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(state.aerobic_activities.length, 1);
  assert.equal(state.routes.length, 1);
});

test("Agent aerobic sync replays one idempotent success and rejects a conflicting body", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);
  const body = { projection: projection() };
  const headers = { "Idempotency-Key": "agent-aerobic-replay" };

  const first = await agentPost(handler, token, syncPath, body, headers);
  const replay = await agentPost(handler, token, syncPath, body, headers);
  assert.equal(first.response.status, 200);
  assert.equal(replay.response.status, 200);
  assert.deepEqual(replay.body, first.body);

  const conflict = await agentPost(handler, token, syncPath, { projection: projection({ data_as_of: "2026-08-17T12:00:00.000Z" }) }, headers);
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "idempotency_conflict");
  assert.equal((await store.getByEmail("athlete-a@example.invalid")).aerobic_activities.length, 1);
});

test("Agent aerobic sync enforces the write gate, Athlete isolation, and private-path separation", async () => {
  const { handler, store } = appFixture();
  const tokenA = await createAgentToken(handler, "athlete-a@example.invalid");
  const tokenB = await createAgentToken(handler, "athlete-b@example.invalid");

  const missingKey = await agentPost(handler, tokenA, syncPath, { projection: projection() });
  assert.equal(missingKey.response.status, 400);
  assert.equal(missingKey.body.error.code, "idempotency_key_required");

  const raw = projection({ activities: [{ ...projection().activities[0], fit_file: { status: "complete", relative_path: "data/coros/private.fit" } }] });
  const invalid = await agentPost(handler, tokenA, syncPath, { projection: raw }, { "Idempotency-Key": "agent-aerobic-raw" });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, "invalid_projection");

  const published = await agentPost(handler, tokenA, syncPath, { projection: projection() }, { "Idempotency-Key": "agent-aerobic-isolation" });
  assert.equal(published.response.status, 200);
  const other = await agentRequest(handler, tokenB, "/api/agent/v1/aerobic/activities?from=2026-08-15&to=2026-08-15");
  assert.equal(other.response.status, 200);
  assert.deepEqual(other.body.items, []);

  const privatePath = await agentRequest(handler, tokenA, "/api/private/records/aerobic?from=2026-08-15&to=2026-08-15");
  assert.equal(privatePath.response.status, 401);
  assert.equal((await store.getByEmail("athlete-b@example.invalid")).aerobic_activities.length, 0);
});
