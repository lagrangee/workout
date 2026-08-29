// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { agentRequest, appFixture, createAgentToken } from "./helpers.js";
import { normalizeCorosActivity, publishAerobicProjection, safeAerobicActivity } from "../src/training-archive.js";
import { normalizeAerobicProjectionForSync } from "../src/training-archive-projection.js";

const now = new Date("2026-08-17T08:00:00.000Z");

function projection() {
  return {
    schema_version: 1,
    publication_key: "training-archive:2026-08-15",
    source_ref: "training-archive:2026-08-15",
    target_date: "2026-08-15",
    timezone: "Asia/Shanghai",
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    workout_source_status: "none",
    source_data_as_of: { workout: null, coros: "2026-08-17T07:00:00.000Z" },
    data_as_of: "2026-08-17T07:00:00.000Z",
    routes: [],
    activities: [{
      schema_version: 1,
      activity_ref: "coros-safe-input",
      source_ref: "coros:activity:coros-safe-input",
      local_date: "2026-08-15",
      timezone: "Asia/Shanghai",
      started_at: "2026-08-15T01:00:00.000Z",
      ended_at: "2026-08-15T02:00:00.000Z",
      sport_type: 102,
      sport_name: "trail_run",
      source_status: "complete",
      data_as_of: "2026-08-17T07:00:00.000Z",
      updated_at: "2026-08-17T07:00:00.000Z",
      summary: {
        duration_sec: 3600,
        total_duration_sec: null,
        distance_km: 8,
        average_heart_rate_bpm: 150,
        max_heart_rate_bpm: null,
        calories_kcal: null,
        training_load: null,
        aerobic_te: null,
        anaerobic_te: null,
        training_focus: null,
        perceived_effort: null,
        sport_metrics: { running: { average_pace_sec_per_km: 450 } },
      },
      route_key: null,
      route_direction: null,
      route_match_status: "unmatched",
      fit_status: "complete",
    }],
  };
}

test("unknown local sport evidence is absent from cloud state and Agent reads", async () => {
  const localActivity = normalizeCorosActivity({
    labelId: "coros-cloud-allowlist",
    sportType: 102,
    startedAt: "2026-08-15T01:00:00.000Z",
    endedAt: "2026-08-15T02:00:00.000Z",
    summary: {
      duration_sec: 3600,
      distance_km: 8,
      sport_metrics: {
        running: { average_pace_sec_per_km: 450, future_metric: 12 },
        position: { x: 39.9, y: 116.4 },
      },
    },
  }, {
    timezone: "Asia/Shanghai",
    targetDate: "2026-08-15",
    dataAsOf: "2026-08-17T07:00:00.000Z",
    updatedAt: "2026-08-17T07:00:00.000Z",
  });

  assert.deepEqual(localActivity.summary.sport_metrics, {
    running: { average_pace_sec_per_km: 450, future_metric: 12 },
    position: { x: 39.9, y: 116.4 },
  });

  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  publishAerobicProjection(state, {
    target_date: "2026-08-15",
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: "2026-08-17T07:00:00.000Z",
    activities: [localActivity],
    routes: [],
  }, now);
  await store.save(state);

  assert.deepEqual(state.aerobic_activities[0].summary.sport_metrics, {
    running: { average_pace_sec_per_km: 450 },
  });

  const token = await createAgentToken(handler);
  const result = await agentRequest(handler, token, "/api/agent/v1/aerobic/activities?from=2026-08-15&to=2026-08-15");
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.items[0].summary.sport_metrics, {
    running: { average_pace_sec_per_km: 450 },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /future_metric|position|"x"|"y"/);
});

test("archive projection rejects a negative summary metric", () => {
  const value = projection();
  value.activities[0].summary.duration_sec = -1;

  assert.throws(
    () => normalizeAerobicProjectionForSync(value, "Asia/Shanghai"),
    (error) => error?.code === "invalid_projection",
  );
});

test("archive projection rejects a negative sport metric", () => {
  const value = projection();
  value.activities[0].summary.sport_metrics.running.average_pace_sec_per_km = -450;

  assert.throws(
    () => normalizeAerobicProjectionForSync(value, "Asia/Shanghai"),
    (error) => error?.code === "invalid_projection",
  );
});

test("archive projection rejects an activity ending before it starts", () => {
  const value = projection();
  value.activities[0].ended_at = "2026-08-15T00:59:59.000Z";

  assert.throws(
    () => normalizeAerobicProjectionForSync(value, "Asia/Shanghai"),
    (error) => error?.code === "invalid_projection",
  );
});

test("archive projection binds the start instant to the requested Athlete-local date", () => {
  const value = projection();
  value.activities[0].started_at = "2026-08-14T15:59:59.000Z";

  assert.throws(
    () => normalizeAerobicProjectionForSync(value, "Asia/Shanghai"),
    (error) => error?.code === "invalid_projection",
  );
});

test("local archive normalization rejects a non-finite summary value", () => {
  assert.throws(() => normalizeCorosActivity({
    labelId: "coros-non-finite",
    sportType: 102,
    startedAt: "2026-08-15T01:00:00.000Z",
    endedAt: "2026-08-15T02:00:00.000Z",
    summary: { duration_sec: Number.POSITIVE_INFINITY },
  }, {
    timezone: "Asia/Shanghai",
    targetDate: "2026-08-15",
  }), /duration_sec must be a non-negative finite number/);
});

test("cloud projection rejects an invalid allowlisted sport metric", () => {
  assert.throws(
    () => normalizeCorosActivity({
      labelId: "coros-negative-cloud-metric",
      sportType: 102,
      startedAt: "2026-08-15T01:00:00.000Z",
      endedAt: "2026-08-15T02:00:00.000Z",
      summary: { sport_metrics: { running: { average_power_w: -1 } } },
    }, {
      timezone: "Asia/Shanghai",
      targetDate: "2026-08-15",
    }),
    /running\.average_power_w must be a non-negative finite number or null/,
  );
});

test("local activity cannot enter a cloud projection under the wrong local date", () => {
  const localActivity = normalizeCorosActivity({
    labelId: "coros-wrong-local-date",
    sportType: 102,
    local_date: "2026-08-15",
    startedAt: "2026-08-14T15:59:59.000Z",
    endedAt: "2026-08-14T16:59:59.000Z",
    summary: {},
  }, {
    timezone: "Asia/Shanghai",
    targetDate: "2026-08-15",
  });

  assert.throws(
    () => safeAerobicActivity(localActivity),
    /started_at must fall on local_date in the Athlete timezone/,
  );
});

test("local activity cannot enter a cloud projection with reversed instants", () => {
  const localActivity = normalizeCorosActivity({
    labelId: "coros-reversed-instants",
    sportType: 102,
    startedAt: "2026-08-15T02:00:00.000Z",
    endedAt: "2026-08-15T01:00:00.000Z",
    summary: {},
  }, {
    timezone: "Asia/Shanghai",
    targetDate: "2026-08-15",
  });

  assert.throws(
    () => safeAerobicActivity(localActivity),
    /ended_at must not be before started_at/,
  );
});

test("local archive normalization rejects a non-finite allowlisted sport metric", () => {
  assert.throws(() => normalizeCorosActivity({
    labelId: "coros-non-finite-sport-metric",
    sportType: 102,
    startedAt: "2026-08-15T01:00:00.000Z",
    endedAt: "2026-08-15T02:00:00.000Z",
    summary: { sport_metrics: { running: { average_power_w: Number.NaN } } },
  }, {
    timezone: "Asia/Shanghai",
    targetDate: "2026-08-15",
  }), /running\.average_power_w must be a non-negative finite number or null/);
});

test("archive projection preserves honest missing values as null", () => {
  const value = projection();
  value.activities[0].summary.duration_sec = null;
  value.activities[0].summary.distance_km = null;
  value.activities[0].summary.sport_metrics.running.average_pace_sec_per_km = null;

  const normalized = normalizeAerobicProjectionForSync(value, "Asia/Shanghai");

  assert.equal(normalized.activities[0].summary.duration_sec, null);
  assert.equal(normalized.activities[0].summary.distance_km, null);
  assert.equal(normalized.activities[0].summary.sport_metrics.running.average_pace_sec_per_km, null);
});

test("archive projection rejects a non-finite distance", () => {
  const value = projection();
  value.activities[0].summary.distance_km = Number.POSITIVE_INFINITY;

  assert.throws(
    () => normalizeAerobicProjectionForSync(value, "Asia/Shanghai"),
    (error) => error?.code === "invalid_projection",
  );
});
