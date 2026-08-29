// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { routeDetailModel, routeListModel } from "../src/training-routes.js";
import { appFixture, call } from "./helpers.js";
import { publishAerobicProjection } from "../src/training-archive.js";

const now = new Date("2026-08-17T08:00:00.000Z");

const route = {
  route_key: "香山鸡腿线",
  route_name: "香山鸡腿线",
  sport_types: [102, 104],
  distance_range_km: [10, 14],
};

function activity(overrides = {}) {
  return {
    activity_ref: "coros-route-1",
    source_ref: "coros:activity:coros-route-1",
    local_date: "2026-08-16",
    timezone: "Asia/Shanghai",
    started_at: "2026-08-16T01:00:00.000Z",
    ended_at: "2026-08-16T03:00:00.000Z",
    sport_type: 102,
    sport_name: "trail_run",
    source_status: "complete",
    data_as_of: "2026-08-16T23:59:00.000Z",
    route_key: "香山鸡腿线",
    route_direction: "forward",
    fit_status: "complete",
    summary: { distance_km: 12.23, duration_sec: 7200, average_heart_rate_bpm: 148, calories_kcal: 800, sport_metrics: {} },
    ...overrides,
  };
}

test("route index and detail expose safe route history with direction and core metrics", () => {
  const state = {
    timezone: "Asia/Shanghai",
    routes: [route],
    aerobic_activities: [
      activity(),
      activity({ activity_ref: "coros-route-2", source_ref: "coros:activity:coros-route-2", local_date: "2026-08-07", started_at: "2026-08-07T01:00:00.000Z", ended_at: "2026-08-07T03:00:00.000Z", route_direction: "reverse", source_status: "partial", summary: { distance_km: 11.8, duration_sec: 6900, average_heart_rate_bpm: null, calories_kcal: null, sport_metrics: {} } }),
      activity({ activity_ref: "coros-indoor", source_ref: "coros:activity:coros-indoor", sport_type: 101, sport_name: "indoor_run", route_key: null, route_direction: null }),
    ],
    aerobic_projection: { source_status: "partial", source_statuses: { workout: "none", coros: "partial" }, data_as_of: "2026-08-16T23:59:00.000Z" },
  };

  const list = routeListModel(state, new URL("https://workout.example/api/private/records/routes"), now);
  assert.equal(list.source_status, "partial");
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].route_key, "香山鸡腿线");
  assert.equal(list.items[0].activity_count, 2);
  assert.equal(list.items[0].latest_activity.local_date, "2026-08-16");
  assert.equal("direction_signatures" in list.items[0], false);

  const detail = routeDetailModel(state, "香山鸡腿线", now);
  assert.equal(detail.route_key, "香山鸡腿线");
  assert.equal(detail.history.length, 2);
  assert.deepEqual(detail.history.map((row) => row.route_direction), ["forward", "reverse"]);
  assert.equal(detail.history[1].source_status, "partial");
  assert.equal(detail.history[0].summary.average_heart_rate_bpm, 148);
  assert.equal("gps" in detail, false);
  assert.equal("direction_signatures" in detail, false);
});

test("route detail keeps unknown and indoor activities out of history", () => {
  const state = {
    timezone: "Asia/Shanghai",
    routes: [route],
    aerobic_activities: [activity({ route_key: null, route_direction: null }), activity({ route_key: "missing-route" })],
    aerobic_projection: { source_status: "complete", source_statuses: { workout: "none", coros: "complete" }, data_as_of: null },
  };

  const result = routeDetailModel(state, "香山鸡腿线", now);
  assert.equal(result.history.length, 0);
  assert.equal(result.activity_count, 0);
});

test("private route index, detail, and history are Athlete-scoped and do not widen Coach Share", async () => {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  publishAerobicProjection(state, {
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: "2026-08-16T23:59:00.000Z",
    routes: [route],
    activities: [activity()],
  }, now);
  await store.save(state);

  const list = await call(handler, "/api/private/records/routes");
  assert.equal(list.response.status, 200);
  assert.equal(list.body.items[0].route_key, "香山鸡腿线");
  const detail = await call(handler, "/api/private/records/routes/%E9%A6%99%E5%B1%B1%E9%B8%A1%E8%85%BF%E7%BA%BF");
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.history.length, 1);
  const history = await call(handler, "/api/private/records/routes/%E9%A6%99%E5%B1%B1%E9%B8%A1%E8%85%BF%E7%BA%BF/history");
  assert.equal(history.response.status, 200);
  assert.equal(history.body.history[0].route_direction, "forward");
  assert.doesNotMatch(JSON.stringify(history.body), /direction_signatures|gps|fit_file/);

  const other = await call(handler, "/api/private/records/routes", {}, "athlete-b@example.invalid");
  assert.equal(other.body.items.length, 0);
  const otherState = await store.getByEmail("athlete-b@example.invalid");
  assert.equal(otherState.routes?.length ?? 0, 0);
});
