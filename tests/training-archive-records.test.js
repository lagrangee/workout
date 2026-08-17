// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appFixture, call } from "./helpers.js";
import { normalizeCorosActivity, publishAerobicProjection } from "../src/training-archive.js";
import { syncTrainingArchive } from "../src/training-archive-sync.js";

const now = new Date("2026-08-17T08:00:00.000Z");

function activity(overrides = {}) {
  return {
    labelId: "coros-activity-1",
    sportType: 101,
    startedAt: "2026-08-16T02:00:00.000Z",
    endedAt: "2026-08-16T02:35:00.000Z",
    summary: {
      duration_sec: 2100,
      distance_km: 5.25,
      average_heart_rate_bpm: 142,
      calories_kcal: 330,
      sport_metrics: { average_pace_sec_per_km: 400 },
    },
    gps: [{ lat: 39.9, lon: 116.4 }],
    raw_fit: "provider-bytes-must-not-be-copied",
    ...overrides,
  };
}

test("COROS archive retains safe namespaced sport metrics and lap provenance", () => {
  const normalized = normalizeCorosActivity({
    labelId: "coros-lap-shape",
    sportType: 102,
    startedAt: "2026-08-15T01:00:00.000Z",
    endedAt: "2026-08-15T02:00:00.000Z",
    summary: {
      distance_km: 8,
      sport_metrics: {
        running: { average_pace_sec_per_km: 500, gps_track: "must-drop" },
      },
    },
    provider_shape: {
      mode: 15,
      sub_mode: 1,
      columns: [{ name: "avgPace", label: "平均配速" }, { name: "gpsUrl", label: "must-drop" }],
      sport_data_details_present: true,
    },
    lap_groups: [{
      group_type: 2,
      lap_distance_raw: 100000,
      laps: [{
        lap_index: 1,
        provider_metrics: { distance: 100000, avgPace: 500, gps: "must-drop" },
        normalized_metrics: { duration_sec: 500, average_pace_sec_per_km: 500 },
      }],
    }],
  }, { timezone: "Asia/Shanghai", dataAsOf: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:00:00.000Z" });

  assert.deepEqual(normalized.summary.sport_metrics, { running: { average_pace_sec_per_km: 500 } });
  assert.deepEqual(normalized.provider_shape, {
    mode: 15,
    sub_mode: 1,
    columns: [{ name: "avgPace", label: "平均配速" }],
    sport_data_details_present: true,
  });
  assert.equal(normalized.lap_groups.length, 1);
  assert.deepEqual(normalized.lap_groups[0].laps[0].provider_metrics, { distance: 100000, avgPace: 500 });
  assert.deepEqual(normalized.lap_groups[0].laps[0].normalized_metrics, { duration_sec: 500, average_pace_sec_per_km: 500 });
});

test("ticket 01 sync defaults to the previous Athlete-local date and writes a linked safe archive", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-"));
  const reads = [];
  const published = [];
  try {
    const receipt = await syncTrainingArchive({
      archiveDir,
      timezone: "Asia/Shanghai",
      now,
      workoutSource: { read: async (date) => { reads.push(["workout", date]); return { source_status: "none", data_as_of: null, sessions: [] }; } },
      corosSource: { read: async (date) => { reads.push(["coros", date]); return { source_status: "complete", data_as_of: "2026-08-16T23:59:00.000Z", activities: [activity({ route_key: "must-not-attach-to-indoor" })] }; } },
      publish: async (projection) => { published.push(projection); return { status: "complete", published_count: projection.activities.length }; },
    });

    assert.equal(receipt.target_date, "2026-08-16");
    assert.deepEqual(reads, [["workout", "2026-08-16"], ["coros", "2026-08-16"]]);
    assert.equal(receipt.source_status.coros, "complete");
    assert.equal(receipt.local_archive.status, "complete");
    assert.equal(receipt.cloud_publication.status, "complete");
    assert.equal(receipt.records_written.activities, 1);
    assert.equal(published[0].activities[0].activity_ref, "coros-activity-1");
    assert.equal(published[0].activities[0].route_key, null);
    assert.equal("fit_file" in published[0].activities[0], false);
    assert.equal("gps" in published[0].activities[0], false);

    const daily = await readFile(join(archiveDir, "daily/2026-08-16.md"), "utf8");
    const activityRecord = await readFile(join(archiveDir, "data/coros/2026-08-16-coros-activity-1.json"), "utf8");
    const activityNote = await readFile(join(archiveDir, "data/coros/2026-08-16-coros-activity-1.md"), "utf8");
    assert.match(daily, /kind: training-day/);
    assert.match(daily, /activity_refs:/);
    assert.match(daily, /coros-activity-1/);
    assert.match(daily, /\[\[data\/coros\/2026-08-16-coros-activity-1\]\]/);
    assert.match(activityNote, /kind: coros-activity/);
    assert.match(activityNote, /sport_type: 101/);
    assert.match(activityNote, /source_status: [\"]?complete[\"]?/);
    assert.match(activityNote, /route_key: null/);
    assert.doesNotMatch(activityNote, /\[\[.*route/i);
    assert.equal(JSON.parse(activityRecord).activity_ref, "coros-activity-1");
    assert.doesNotMatch(activityRecord, /gps|raw_fit|provider-bytes/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 01 sync accepts an explicit local date and reruns the same activity identity without duplicates", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-"));
  let publishCount = 0;
  try {
    const options = {
      archiveDir,
      timezone: "Asia/Shanghai",
      now,
      targetDate: "2026-08-07",
      workoutSource: { read: async () => ({ source_status: "none", data_as_of: null, sessions: [] }) },
      corosSource: { read: async () => ({ source_status: "complete", data_as_of: "2026-08-07T23:59:00.000Z", activities: [activity({ labelId: "coros-backfill", startedAt: "2026-08-06T16:00:00.000Z", endedAt: "2026-08-06T16:20:00.000Z" })] }) },
      publish: async (projection) => { publishCount += projection.activities.length; return { status: "complete", published_count: projection.activities.length }; },
    };
    const first = await syncTrainingArchive(options);
    const second = await syncTrainingArchive(options);
    assert.equal(first.target_date, "2026-08-07");
    assert.equal(second.target_date, "2026-08-07");
    assert.equal(second.records_written.activities, 1);
    assert.equal(publishCount, 2);
    const daily = await readFile(join(archiveDir, "daily/2026-08-07.md"), "utf8");
    assert.equal((daily.match(/\[\[data\/coros\/2026-08-07-coros-backfill\]\]/g) || []).length, 1);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 01 Athlete Records API returns safe aerobic summaries and isolates activities", async () => {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  state.aerobic_activities = [{
    schema_version: 1,
    activity_ref: "coros-activity-1",
    source_ref: "coros:activity:coros-activity-1",
    local_date: "2026-08-16",
    timezone: "Asia/Shanghai",
    started_at: "2026-08-16T02:00:00.000Z",
    ended_at: "2026-08-16T02:35:00.000Z",
    sport_type: 101,
    sport_name: "indoor_run",
    source_status: "partial",
    data_as_of: "2026-08-16T23:59:00.000Z",
    summary: { duration_sec: 2100, distance_km: 5.25, average_heart_rate_bpm: 142, calories_kcal: null, sport_metrics: {} },
    route_key: null,
    route_direction: null,
    fit_status: "partial",
    raw_fit: "must-not-leak",
    gps: [{ lat: 1, lon: 2 }],
  }];
  state.aerobic_projection = { source_status: "partial", data_as_of: "2026-08-16T23:59:00.000Z", updated_at: now.toISOString() };
  await store.save(state);

  const list = await call(handler, "/api/private/records/aerobic?from=2026-08-16&to=2026-08-16");
  assert.equal(list.response.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].activity_ref, "coros-activity-1");
  assert.equal(list.body.items[0].source_status, "partial");
  assert.equal(list.body.items[0].route_key, null);
  assert.equal("raw_fit" in list.body.items[0], false);
  assert.equal("gps" in list.body.items[0], false);
  assert.equal("fit_file" in list.body.items[0], false);

  const detail = await call(handler, "/api/private/records/aerobic/coros-activity-1");
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.activity_ref, "coros-activity-1");
  assert.equal(detail.body.fit_status, "partial");
  assert.equal(detail.body.sport_type, 101);
  assert.equal("raw_fit" in detail.body, false);
  assert.equal("gps" in detail.body, false);

  const otherAthlete = await call(handler, "/api/private/records/aerobic", {}, "athlete-b@example.invalid");
  assert.deepEqual(otherAthlete.body.items, []);
  const otherDetail = await call(handler, "/api/private/records/aerobic/coros-activity-1", {}, "athlete-b@example.invalid");
  assert.equal(otherDetail.response.status, 404);
});

test("ticket 01 projection publisher upserts only safe activity identities without changing Workout training version", async () => {
  const { store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  const trainingVersion = state.training_version;
  const result = publishAerobicProjection(state, {
    source_status: "complete",
    data_as_of: "2026-08-16T23:59:00.000Z",
    activities: [{
      activity_ref: "coros-safe",
      source_ref: "coros:activity:coros-safe",
      local_date: "2026-08-16",
      timezone: "Asia/Shanghai",
      started_at: null,
      ended_at: null,
      sport_type: 100,
      sport_name: "outdoor_run",
      source_status: "complete",
      data_as_of: "2026-08-16T23:59:00.000Z",
      summary: { duration_sec: null, distance_km: 2, average_heart_rate_bpm: null, calories_kcal: null, sport_metrics: {} },
      route_key: null,
      route_direction: null,
      fit_status: "complete",
    }],
  }, now);
  assert.equal(result.status, "complete");
  assert.equal(state.aerobic_activities.length, 1);
  assert.equal(state.aerobic_activities[0].activity_ref, "coros-safe");
  assert.equal(state.training_version, trainingVersion);
});
