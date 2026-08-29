// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { appFixture, call, post } from "./helpers.js";

const syncPath = "/api/private/records/aerobic/sync";

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

test("private aerobic sync publishes a safe projection and the Records read model sees it", async () => {
  const { handler, store } = appFixture();
  const result = await call(handler, syncPath, post({ projection: projection() }, "aerobic-sync-2026-08-15"));

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.source_statuses, { workout: "complete", coros: "complete" });
  assert.equal(result.body.published_count, 1);
  assert.equal(result.body.activity_count, 1);
  assert.equal(result.body.route_count, 1);

  const list = await call(handler, "/api/private/records/aerobic?from=2026-08-15&to=2026-08-15");
  assert.equal(list.response.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].activity_ref, "coros-live-2026-08-15");
  assert.equal(list.body.items[0].route_key, "香山鸡腿线");
  assert.equal("fit_file" in list.body.items[0], false);

  const state = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(state.aerobic_activities.length, 1);
  assert.equal(state.routes.length, 1);
});

test("private aerobic sync is idempotent and rejects a conflicting idempotency body", async () => {
  const { handler, store } = appFixture();
  const first = await call(handler, syncPath, post({ projection: projection() }, "aerobic-sync-idempotent"));
  const replay = await call(handler, syncPath, post({ projection: projection() }, "aerobic-sync-idempotent"));
  assert.equal(first.response.status, 200);
  assert.equal(replay.response.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal((await store.getByEmail("athlete-a@example.invalid")).aerobic_activities.length, 1);

  const conflict = await call(handler, syncPath, post({ projection: projection({ data_as_of: "2026-08-17T12:00:00.000Z" }) }, "aerobic-sync-idempotent"));
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "idempotency_conflict");
});

test("private aerobic sync rejects raw FIT/GPS fields and unsupported projection shape", async () => {
  const { handler, store } = appFixture();
  const before = await store.getByEmail("athlete-a@example.invalid");
  const idempotencyCount = before.idempotency_records.length;
  const raw = projection({ activities: [{ ...projection().activities[0], fit_file: { status: "complete", relative_path: "data/coros/private.fit" }, gps: [{ lat: 39.9, lon: 116.4 }] }] });
  const result = await call(handler, syncPath, post({ projection: raw }, "aerobic-sync-raw"));
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "invalid_projection");
  const afterInvalid = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(afterInvalid.aerobic_activities.length, 0);
  assert.equal(afterInvalid.idempotency_records.length, idempotencyCount);

  const corrected = await call(handler, syncPath, post({ projection: projection() }, "aerobic-sync-raw"));
  assert.equal(corrected.response.status, 200);
  assert.equal(corrected.body.published_count, 1);

  const routeGeometry = projection({ routes: [{ ...projection().routes[0], direction_signatures: { forward: { start: { lat: 39.9, lon: 116.4 } } } }] });
  const geometryResult = await call(handler, syncPath, post({ projection: routeGeometry }, "aerobic-sync-geometry"));
  assert.equal(geometryResult.response.status, 400);
  assert.equal(geometryResult.body.error.code, "invalid_projection");

  const nestedCoordinates = projection({ activities: [{ ...projection().activities[0], summary: { ...projection().activities[0].summary, sport_metrics: { location: { latitude: 39.9, longitude: 116.4 } } } }] });
  const coordinateResult = await call(handler, syncPath, post({ projection: nestedCoordinates }, "aerobic-sync-coordinates"));
  assert.equal(coordinateResult.response.status, 400);
  assert.equal(coordinateResult.body.error.code, "invalid_projection");
});

test("private aerobic sync rejects silent date and whitespace repairs", async () => {
  const { handler, store } = appFixture();
  const invalidDate = projection({
    publication_key: "training-archive:2026-02-30",
    source_ref: "training-archive:2026-02-30",
    target_date: "2026-02-30",
  });
  const dateResult = await call(handler, syncPath, post({ projection: invalidDate }, "aerobic-sync-invalid-date"));
  assert.equal(dateResult.response.status, 400);
  assert.equal(dateResult.body.error.code, "invalid_projection");

  const whitespace = projection({ timezone: " Asia/Shanghai" });
  const whitespaceResult = await call(handler, syncPath, post({ projection: whitespace }, "aerobic-sync-whitespace"));
  assert.equal(whitespaceResult.response.status, 400);
  assert.equal(whitespaceResult.body.error.code, "invalid_projection");
  assert.equal((await store.getByEmail("athlete-a@example.invalid")).aerobic_activities.length, 0);
});

test("private aerobic sync remains Athlete-scoped", async () => {
  const { handler } = appFixture();
  const published = await call(handler, syncPath, post({ projection: projection() }, "aerobic-sync-isolation"));
  assert.equal(published.response.status, 200);

  const other = await call(handler, "/api/private/records/aerobic?from=2026-08-15&to=2026-08-15", {}, "athlete-b@example.invalid");
  assert.equal(other.response.status, 200);
  assert.equal(other.body.items.length, 0);
});

test("private aerobic sync requires bounded mutation protocol", async () => {
  const { handler, store } = appFixture();
  const missingKey = await call(handler, syncPath, { method: "POST", body: JSON.stringify({ projection: projection() }) });
  assert.equal(missingKey.response.status, 400);
  assert.equal(missingKey.body.error.code, "idempotency_key_required");

  const oversized = await call(handler, syncPath, {
    method: "POST",
    headers: { "Idempotency-Key": "aerobic-sync-oversized" },
    body: JSON.stringify({ projection: projection(), padding: "x".repeat(300000) }),
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.body.error.code, "payload_too_large");
  assert.equal((await store.getByEmail("athlete-a@example.invalid")).aerobic_activities.length, 0);
});
