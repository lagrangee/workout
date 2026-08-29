// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appFixture, call } from "./helpers.js";
import { normalizeCorosActivity, publishAerobicProjection } from "../src/training-archive.js";
import { corosActivityNote, syncTrainingArchive } from "../src/training-archive-sync.js";

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
  assert.deepEqual(normalized.lap_groups[0].laps[0].normalized_metrics, { duration_sec: 500, average_pace_sec_per_km: 500, distance_m: 1000 });
});

test("COROS trail-run laps normalize screenshot fields and render one table per lap group", () => {
  const normalized = normalizeCorosActivity({
    labelId: "coros-table-shape",
    sportType: 102,
    startedAt: "2026-08-15T01:00:00.000Z",
    endedAt: "2026-08-15T02:00:00.000Z",
    summary: { distance_km: 1, duration_sec: 568.69, average_heart_rate_bpm: 150, calories_kcal: 100 },
    lap_groups: [{
      group_type: 2,
      lap_distance_raw: 100000,
      laps: [{
        lap_index: 1,
        provider_metrics: {
          distance: 100000,
          time: 568.69,
          totalLength: 568.69,
          avgPace: 568.7,
          adjustedPace: 471,
          avgSpeedV2: 633.02,
          vertSpeed: 158.25,
          avgPower: 172,
          avgHr: 150,
          maxHr: 162,
          avgCadence: 137,
          avgStrideLength: 77,
          elevGain: 39,
          totalDescent: 14,
        },
      }],
    }],
  }, { timezone: "Asia/Shanghai", dataAsOf: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:00:00.000Z" });

  assert.deepEqual(normalized.lap_groups[0].laps[0].normalized_metrics, {
    distance_m: 1000,
    duration_sec: 568.69,
    cumulative_duration_sec: 568.69,
    elevation_gain_m: 39,
    elevation_loss_m: 14,
    average_heart_rate_bpm: 150,
    max_heart_rate_bpm: 162,
    average_cadence_spm: 137,
    average_stride_length_cm: 77,
    average_pace_sec_per_km: 568.7,
    adjusted_pace_sec_per_km: 471,
    vertical_speed_m_per_h: 158.25,
    average_power_w: 172,
  });

  const note = corosActivityNote(normalized);
  assert.match(note, /projection_version: 2/);
  assert.match(note, /### 1 km 分段/);
  assert.match(note, /\| 段 \| 距离 \| 时间 \| 累计时间 \| 上升 \| 下降 \| 平均心率 \| 最大心率 \| 步频 \| 步幅 \| 平均配速 \| 等效配速 \| 垂直速度 \| 跑步功率 \|/);
  assert.match(note, /\| 1 \| 1\.00 km \| 9:29 \| 9:29 \| 39 m \| 14 m \| 150 bpm \| 162 bpm \| 137 spm \| 77 cm \| 9'29"\/km \| 7'51"\/km \| 158 m\/h \| 172 W \|/);
  assert.doesNotMatch(note, /avgPace|totalLength|avgSpeedV2/);
});

test("COROS lap notes warn about unknown provider fields without dropping them from JSON", () => {
  const normalized = normalizeCorosActivity({
    labelId: "coros-unknown-field",
    sportType: 102,
    startedAt: "2026-08-15T01:00:00.000Z",
    endedAt: "2026-08-15T02:00:00.000Z",
    summary: { distance_km: 1, duration_sec: 600, average_heart_rate_bpm: 150, calories_kcal: 100 },
    lap_groups: [{
      group_type: 2,
      lap_distance_raw: 100000,
      laps: [{ lap_index: 1, provider_metrics: { distance: 100000, time: 600, futureMetric: 12 } }],
    }],
  }, { timezone: "Asia/Shanghai", dataAsOf: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:00:00.000Z" });

  assert.deepEqual(normalized.lap_groups[0].laps[0].provider_metrics.futureMetric, 12);
  assert.deepEqual(normalized.lap_field_warnings, ["futureMetric"]);
  assert.match(corosActivityNote(normalized), /未识别 provider 字段：futureMetric/);
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
    assert.equal(receipt.privacy_evidence.status, "passed");
    assert.deepEqual(receipt.privacy_evidence.violations, []);
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
    assert.match(activityNote, /fit_status: [\"]?partial[\"]?/);
    assert.match(activityNote, /fit_path: [\"]?data\/coros\/2026-08-16-coros-activity-1\.fit[\"]?/);
    assert.match(activityNote, /fit_file: null/);
    assert.doesNotMatch(activityNote, /\[\[data\/coros\/2026-08-16-coros-activity-1\.fit\]\]/);
    assert.doesNotMatch(activityNote, /\[\[.*route/i);
    assert.equal(JSON.parse(activityRecord).activity_ref, "coros-activity-1");
    assert.doesNotMatch(activityRecord, /gps|raw_fit|provider-bytes/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 01 archive notes preserve Workout details and COROS sport/lap details", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-detail-"));
  try {
    await syncTrainingArchive({
      archiveDir,
      timezone: "Asia/Shanghai",
      targetDate: "2026-08-16",
      now,
      workoutSource: { read: async () => ({
        source_status: "complete",
        data_as_of: "2026-08-16T04:00:00.000Z",
        sessions: [{
          session_key: "sess-detail",
          scheduled_date: "2026-08-16",
          source_ref: "session:2026-08-16:sess-detail",
          title: "力量细节",
          status: "completed",
          completion_fraction: 1,
          training_duration_sec: 1200,
          session_rpe: 5,
          updated_at: "2026-08-16T04:00:00.000Z",
          snapshot: { blocks: [{ title: "腿部", exercises: [{ exercise_key: "squat", name: "深蹲", sets: [{ set_key: "set-1", target: { metric: "reps", min: 6, max: 8 } }] }] }] },
          completion_items: [{ completion_item_key: "item-1", set_key: "set-1", target: { metric: "reps", min: 6, max: 8 } }],
          completion_results: [{ completion_item_key: "item-1", actual: { reps: 7 }, completed: true }],
          training_intervals: [{ started_at: "2026-08-16T03:40:00.000Z", ended_at: "2026-08-16T04:00:00.000Z" }],
          exercise_feedback: [{ exercise_key: "squat", note: "膝盖轨迹稳定" }],
          training_version: 56,
        }],
      }) },
      corosSource: { read: async () => ({
        source_status: "complete",
        data_as_of: "2026-08-16T23:59:00.000Z",
        activities: [activity({
          summary: {
            ...activity().summary,
            training_load: 82,
            aerobic_te: 2.4,
            anaerobic_te: 1.1,
            training_focus: "基础耐力",
          },
          provider_shape: { mode: 15, sub_mode: 1, columns: [{ name: "avgPace", label: "平均配速" }], sport_data_details_present: true },
          lap_groups: [{
            group_type: 2,
            lap_distance_raw: 100000,
            laps: [{ lap_index: 1, provider_metrics: { distance: 100000, avgPace: 400 }, normalized_metrics: { duration_sec: 400, average_pace_sec_per_km: 400 } }],
          }],
        })],
      }) },
      publish: async (projection) => ({ status: "complete", published_count: projection.activities.length }),
    });

    const sessionNote = await readFile(join(archiveDir, "workout/sessions/2026-08-16--sess-detail.md"), "utf8");
    const sessionJson = JSON.parse(await readFile(join(archiveDir, "data/workout/2026-08-16--sess-detail.json"), "utf8"));
    const activityNote = await readFile(join(archiveDir, "data/coros/2026-08-16-coros-activity-1.md"), "utf8");
    assert.match(sessionNote, /深蹲/);
    assert.match(sessionNote, /完成结果/);
    assert.match(sessionNote, /膝盖轨迹稳定/);
    assert.equal(sessionJson.details.training_version, 56);
    assert.equal(sessionJson.details.completion_results[0].actual.reps, 7);
    assert.match(activityNote, /训练负荷：82/);
    assert.match(activityNote, /基础耐力/);
    assert.match(activityNote, /分段/);
    assert.match(activityNote, /平均配速/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("archive sync rejects an ambiguous Workout Session instead of inventing identity fields", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-invalid-session-"));
  try {
    const receipt = await syncTrainingArchive({
      archiveDir,
      timezone: "Asia/Shanghai",
      targetDate: "2026-08-16",
      now,
      workoutSource: { read: async () => ({
        source_status: "complete",
        data_as_of: "2026-08-16T04:00:00.000Z",
        sessions: [{ session_key: "sess-invalid", scheduled_date: "2026-08-16", title: "力量细节", status: "completed" }],
      }) },
      corosSource: { read: async () => ({ source_status: "none", data_as_of: null, activities: [] }) },
      publish: async () => ({ status: "none", published_count: 0 }),
    });

    assert.equal(receipt.source_status.workout, "error");
    assert.equal(receipt.records_written.workout_sessions, 0);
    assert.equal(receipt.errors[0].code, "source_read_failed");
    assert.match(receipt.errors[0].message, /source_ref/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 01 activity note links a completed local FIT sidecar without exposing it to cloud projection", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-fit-link-"));
  let publishedProjection;
  try {
    const receipt = await syncTrainingArchive({
      archiveDir,
      timezone: "Asia/Shanghai",
      targetDate: "2026-08-16",
      now,
      workoutSource: { read: async () => ({ source_status: "none", data_as_of: null, sessions: [] }) },
      corosSource: { read: async () => ({
        source_status: "complete",
        data_as_of: "2026-08-16T23:59:00.000Z",
        activities: [activity({ fit_bytes: [0, 1, 2, 3, 4] })],
      }) },
      publish: async (projection) => {
        publishedProjection = projection;
        return { status: "complete", published_count: projection.activities.length };
      },
    });

    assert.equal(receipt.local_archive.fit_bytes, 5);
    const note = await readFile(join(archiveDir, "data/coros/2026-08-16-coros-activity-1.md"), "utf8");
    const record = JSON.parse(await readFile(join(archiveDir, "data/coros/2026-08-16-coros-activity-1.json"), "utf8"));
    assert.match(note, /fit_status: [\"]?complete[\"]?/);
    assert.match(note, /fit_path: [\"]?data\/coros\/2026-08-16-coros-activity-1\.fit[\"]?/);
    assert.match(note, /fit_file: [\"]?\[\[data\/coros\/2026-08-16-coros-activity-1\.fit\]\][\"]?/);
    assert.match(note, /- FIT：\[\[data\/coros\/2026-08-16-coros-activity-1\.fit\]\]/);
    assert.equal(record.fit_file.relative_path, "data/coros/2026-08-16-coros-activity-1.fit");
    assert.equal(record.fit_file.bytes, 5);
    assert.equal(publishedProjection.activities[0].fit_status, "complete");
    assert.doesNotMatch(JSON.stringify(publishedProjection), /fit_file|fit_path|\.fit\b|raw_fit|gps/i);
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
