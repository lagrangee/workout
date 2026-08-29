// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { agentRequest, appFixture, createAgentToken } from "./helpers.js";
import { publishAerobicProjection } from "../src/training-archive.js";

const now = new Date("2026-08-17T08:00:00.000Z");

function activity(index, routeKey) {
  const second = String(index % 60).padStart(2, "0");
  return {
    activity_ref: `pagination-activity-${String(index).padStart(3, "0")}`,
    source_ref: `coros:activity:pagination-activity-${String(index).padStart(3, "0")}`,
    local_date: "2026-08-15",
    timezone: "Asia/Shanghai",
    started_at: `2026-08-15T01:00:${second}.000Z`,
    ended_at: `2026-08-15T01:30:${second}.000Z`,
    sport_type: 100,
    sport_name: "outdoor_run",
    source_status: "complete",
    data_as_of: "2026-08-17T07:59:00.000Z",
    updated_at: "2026-08-17T08:00:00.000Z",
    summary: {
      duration_sec: 1800,
      distance_km: 5,
      average_heart_rate_bpm: 140,
      calories_kcal: 300,
      sport_metrics: {},
    },
    route_key: routeKey,
    route_direction: "forward",
    route_match_status: "matched",
    fit_status: "complete",
  };
}

async function seed(store, activities, routes) {
  const state = await store.getByEmail("athlete-a@example.invalid");
  publishAerobicProjection(state, {
    target_date: "2026-08-15",
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: "2026-08-17T07:59:00.000Z",
    activities,
    routes,
  }, now);
  await store.save(state);
}

async function traverse(handler, token, path, collection) {
  const values = [];
  let cursor = null;
  do {
    const separator = path.includes("?") ? "&" : "?";
    const response = await agentRequest(handler, token, `${path}${cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(response.response.status, 200);
    values.push(...response.body[collection]);
    cursor = response.body.page.next_cursor;
  } while (cursor);
  return values;
}

test("Agent route pagination reaches every route beyond the private presentation limit", async () => {
  const { handler, store } = appFixture();
  const routes = Array.from({ length: 201 }, (_, index) => ({
    schema_version: 1,
    route_key: `route-${String(index).padStart(3, "0")}`,
    route_name: `Route ${String(index).padStart(3, "0")}`,
    sport_types: [100],
    distance_range_km: [4, 6],
  }));
  const activities = routes.map((route, index) => activity(index, route.route_key));
  await seed(store, activities, routes);
  const token = await createAgentToken(handler);

  const items = await traverse(handler, token, "/api/agent/v1/routes?limit=37", "items");
  const routeKeys = items.map((item) => item.route_key);

  assert.equal(routeKeys.length, 201);
  assert.equal(new Set(routeKeys).size, 201);
  assert.ok(routeKeys.includes("route-200"));
});

test("Agent route-history pagination reaches every activity beyond the private presentation limit", async () => {
  const { handler, store } = appFixture();
  const route = {
    schema_version: 1,
    route_key: "long-history",
    route_name: "Long History",
    sport_types: [100],
    distance_range_km: [4, 6],
  };
  const activities = Array.from({ length: 201 }, (_, index) => activity(index, route.route_key));
  await seed(store, activities, [route]);
  const token = await createAgentToken(handler);

  const history = await traverse(handler, token, "/api/agent/v1/routes/long-history/history?limit=43", "history");
  const activityRefs = history.map((item) => item.activity_ref);

  assert.equal(activityRefs.length, 201);
  assert.equal(new Set(activityRefs).size, 201);
  assert.ok(activityRefs.includes("pagination-activity-200"));
});
