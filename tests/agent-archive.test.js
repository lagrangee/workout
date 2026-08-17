// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { appFixture, call, createAgentToken, agentRequest, testAgentSecret } from "./helpers.js";
import { publishAerobicProjection } from "../src/training-archive.js";

const now = new Date("2026-08-17T08:00:00.000Z");

function activity(overrides = {}) {
  return {
    activity_ref: "coros-agent-1",
    source_ref: "coros:activity:coros-agent-1",
    local_date: "2026-08-15",
    timezone: "Asia/Shanghai",
    started_at: "2026-08-15T01:00:00.000Z",
    ended_at: "2026-08-15T03:00:00.000Z",
    sport_type: 100,
    sport_name: "outdoor_run",
    source_status: "complete",
    data_as_of: "2026-08-16T23:59:00.000Z",
    updated_at: "2026-08-17T08:00:00.000Z",
    summary: { duration_sec: 7200, distance_km: 12.23, average_heart_rate_bpm: 148, calories_kcal: 800, sport_metrics: {} },
    route_key: "city-loop",
    route_direction: "reverse",
    route_match_status: "matched",
    fit_status: "complete",
    ...overrides,
  };
}

async function seedArchive(store) {
  const state = await store.getByEmail("athlete-a@example.invalid");
  publishAerobicProjection(state, {
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: "2026-08-16T23:59:00.000Z",
    routes: [{ schema_version: 1, route_key: "city-loop", route_name: "城市环线", sport_types: [100], distance_range_km: [10, 13] }],
    activities: [
      activity(),
      activity({ activity_ref: "coros-agent-2", source_ref: "coros:activity:coros-agent-2", local_date: "2026-08-07", started_at: "2026-08-07T01:00:00.000Z", ended_at: "2026-08-07T02:00:00.000Z", route_direction: "forward", summary: { duration_sec: 3600, distance_km: 6.2, average_heart_rate_bpm: null, calories_kcal: null, sport_metrics: {} } }),
      activity({ activity_ref: "coros-agent-indoor", source_ref: "coros:activity:coros-agent-indoor", local_date: "2026-08-15", sport_type: 101, sport_name: "indoor_run", route_key: null, route_direction: null, route_match_status: "ignored", fit_status: "partial" }),
    ],
  }, now);
  await store.save(state);
}

test("private Agent manifest and schema catalog advertise the archive read surface", async () => {
  const { handler, store } = appFixture();
  await seedArchive(store);
  const token = await createAgentToken(handler);
  const manifest = await agentRequest(handler, token, "/api/agent/v1");
  assert.equal(manifest.response.status, 200);
  assert.equal(manifest.body.schema_catalog_url, "/api/agent/v1/schemas");
  assert.equal(manifest.body.links.aerobic_activities, "/api/agent/v1/aerobic/activities");
  assert.equal(manifest.body.links.daily_context, "/api/agent/v1/daily/{local_date}");
  assert.equal(manifest.body.links.route_history, "/api/agent/v1/routes/{route_key}/history");
  assert.equal(manifest.body.endpoints.aerobic_activities.rules.cursor_ttl_minutes, 15);
  const catalog = await agentRequest(handler, token, "/api/agent/v1/schemas");
  assert.equal(catalog.response.status, 200);
  assert.ok(catalog.body.schemas.some((schema) => schema.name === "aerobic_activity_index"));
  const schema = await agentRequest(handler, token, "/api/agent/v1/schemas/route_history");
  assert.equal(schema.response.status, 200);
  assert.deepEqual(schema.body.required, ["schema_version", "generated_at", "data_as_of", "source_status", "source_ref"]);
});

test("Agent aerobic activities are bounded, cursor-bound, and projection-safe", async () => {
  const { handler, store } = appFixture();
  await seedArchive(store);
  const token = await createAgentToken(handler);
  const first = await agentRequest(handler, token, "/api/agent/v1/aerobic/activities?from=2026-08-01&to=2026-08-16&sport_type=100&route_key=city-loop&limit=1");
  assert.equal(first.response.status, 200);
  assert.equal(first.body.items.length, 1);
  assert.equal(first.body.items[0].activity_ref, "coros-agent-1");
  assert.equal(first.body.items[0].route_direction, "reverse");
  assert.equal(typeof first.body.page.next_cursor, "string");
  assert.equal(first.body.data_as_of, "2026-08-16T23:59:00.000Z");
  assert.match(first.body.items[0].lookup.local_archive ?? "", /^request|^$/i);
  assert.doesNotMatch(JSON.stringify(first.body), /raw_fit|gps|telemetry|\/Users\/|\.fit/);

  const second = await agentRequest(handler, token, `/api/agent/v1/aerobic/activities?from=2026-08-01&to=2026-08-16&sport_type=100&route_key=city-loop&limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.items[0].activity_ref, "coros-agent-2");
  const wrongFilter = await agentRequest(handler, token, `/api/agent/v1/aerobic/activities?from=2026-08-01&to=2026-08-16&sport_type=102&route_key=city-loop&limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(wrongFilter.response.status, 400);
  assert.equal(wrongFilter.body.error.code, "invalid_cursor");
  const invalidRange = await agentRequest(handler, token, "/api/agent/v1/aerobic/activities?from=2020-01-01&to=2031-01-02");
  assert.equal(invalidRange.response.status, 400);
  assert.equal(invalidRange.body.error.code, "invalid_period");
  const unsupported = await agentRequest(handler, token, "/api/agent/v1/aerobic/activities?unexpected=1");
  assert.equal(unsupported.response.status, 400);
  assert.equal(unsupported.body.error.code, "invalid_request");
});

test("Agent detail, daily context, route history, and Athlete isolation preserve safe provenance", async () => {
  const { handler, store } = appFixture();
  await seedArchive(store);
  const token = await createAgentToken(handler);
  const detail = await agentRequest(handler, token, "/api/agent/v1/aerobic/activities/coros-agent-1");
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.activity_ref, "coros-agent-1");
  assert.equal(detail.body.source_ref, "coros:activity:coros-agent-1");
  assert.equal(detail.body.lookup.scope, "single_activity");
  assert.equal(detail.body.fit_status, "complete");
  assert.doesNotMatch(JSON.stringify(detail.body), /fit_file|gps|telemetry|\/Users\/|\.fit/);

  const daily = await agentRequest(handler, token, "/api/agent/v1/daily/2026-08-15");
  assert.equal(daily.response.status, 200);
  assert.equal(daily.body.local_date, "2026-08-15");
  assert.equal(daily.body.context.machine_refs.activity_refs.includes("coros-agent-1"), true);
  assert.equal(daily.body.context.machine_refs.activity_refs.includes("coros-agent-indoor"), true);
  assert.equal(daily.body.source_statuses.coros, "complete");
  assert.doesNotMatch(JSON.stringify(daily.body), /raw_fit|gps|telemetry|\/Users\/|\.fit/);

  const routes = await agentRequest(handler, token, "/api/agent/v1/routes?limit=1");
  assert.equal(routes.response.status, 200);
  assert.equal(routes.body.items[0].route_key, "city-loop");
  const route = await agentRequest(handler, token, "/api/agent/v1/routes/city-loop?limit=1");
  assert.equal(route.response.status, 200);
  assert.equal(route.body.route_name, "城市环线");
  assert.equal(route.body.history.length, 1);
  assert.equal(route.body.history[0].route_direction, "reverse");
  const history = await agentRequest(handler, token, "/api/agent/v1/routes/city-loop/history?from=2026-08-01&to=2026-08-16");
  assert.equal(history.response.status, 200);
  assert.equal(history.body.history.length, 2);
  assert.equal(history.body.source_ref, "agent:route:city-loop:history");

  const otherToken = await createAgentToken(handler, "athlete-b@example.invalid");
  const otherActivities = await agentRequest(handler, otherToken, "/api/agent/v1/aerobic/activities");
  assert.equal(otherActivities.response.status, 200);
  assert.deepEqual(otherActivities.body.items, []);
  const otherRoute = await agentRequest(handler, otherToken, "/api/agent/v1/routes/city-loop");
  assert.equal(otherRoute.response.status, 404);

  const share = await call(handler, "/api/private/coach-share", { method: "POST", headers: { "Idempotency-Key": "agent-archive-share" }, body: "{}" });
  assert.equal(share.response.status, 201);
  const shareCopy = await call(handler, "/api/private/coach-share");
  const coachPath = new URL(shareCopy.body.url).pathname.replace(/^\/coach\//, "/api/coach/v1/");
  const coach = await call(handler, coachPath);
  assert.equal(coach.response.status, 200);
  assert.doesNotMatch(JSON.stringify(coach.body), /city-loop|routes|coros-agent/);
});

test("Agent archive read resources remain read-only and explicit", async () => {
  const { handler, store } = appFixture();
  await seedArchive(store);
  const token = await createAgentToken(handler);
  const response = await agentRequest(handler, token, "/api/agent/v1/aerobic/activities/coros-agent-1", { method: "POST" });
  assert.equal(response.response.status, 405);
  const missing = await agentRequest(handler, token, "/api/agent/v1/aerobic/activities/missing");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "not_found");
  assert.equal(typeof testAgentSecret, "string");
});
