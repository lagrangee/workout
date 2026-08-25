// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appFixture, call } from "./helpers.js";
import { syncTrainingArchive } from "../src/training-archive-sync.js";
import {
  dailyHubModel,
  dailyHubNote,
  normalizeWorkoutSessionRecord,
  recordsOverviewModel,
  workoutTableModel,
  workoutSessionNote,
} from "../src/training-records.js";

const now = new Date("2026-08-17T08:00:00.000Z");

function session(overrides = {}) {
  return {
    session_key: "sess-2026-08-15",
    scheduled_date: "2026-08-15",
    title: "下肢力量",
    status: "completed",
    completion_fraction: 1,
    training_duration_sec: 3600,
    session_rpe: 7,
    updated_at: "2026-08-15T03:00:00.000Z",
    source_ref: "session:2026-08-15:sess-2026-08-15",
    snapshot: { blocks: [{ exercises: [{ exercise_key: "squat", name: "深蹲", category: "strength" }] }], completion_items: [] },
    completion_results: [],
    training_intervals: [{ started_at: "2026-08-15T02:00:00.000Z", ended_at: "2026-08-15T03:00:00.000Z" }],
    ...overrides,
  };
}

function activity(overrides = {}) {
  return {
    activity_ref: "coros-2026-08-15",
    source_ref: "coros:activity:coros-2026-08-15",
    local_date: "2026-08-15",
    timezone: "Asia/Shanghai",
    started_at: "2026-08-15T00:00:00.000Z",
    ended_at: "2026-08-15T01:00:00.000Z",
    sport_type: 100,
    sport_name: "outdoor_run",
    source_status: "complete",
    data_as_of: "2026-08-15T23:59:00.000Z",
    updated_at: "2026-08-16T00:00:00.000Z",
    summary: { distance_km: 8.5, duration_sec: 3600, average_heart_rate_bpm: 145, calories_kcal: null, sport_metrics: {} },
    route_key: null,
    route_direction: null,
    fit_status: "partial",
    ...overrides,
  };
}

test("ticket 03 normalizes a Workout Session record without creating a COROS relation", () => {
  const record = normalizeWorkoutSessionRecord(session(), { timezone: "Asia/Shanghai", dataAsOf: now.toISOString() });
  assert.equal(record.kind, "workout-session");
  assert.equal(record.source, "workout");
  assert.equal(record.session_key, "sess-2026-08-15");
  assert.equal(record.local_date, "2026-08-15");
  assert.equal(record.source_status, "complete");
  assert.equal(record.properties.status, "completed");
  assert.equal(record.properties.training_duration_sec, 3600);
  assert.equal(Object.hasOwn(record, "activity_ref"), false);
  assert.throws(() => normalizeWorkoutSessionRecord(session({ status: "unknown" }), { timezone: "Asia/Shanghai" }), /status/);
  assert.throws(() => normalizeWorkoutSessionRecord(session({ session_key: "../escape" }), { timezone: "Asia/Shanghai" }), /session_key/);
  assert.throws(() => normalizeWorkoutSessionRecord(session({ completion_fraction: 1.1 }), { timezone: "Asia/Shanghai" }), /completion_fraction/);
  assert.throws(() => normalizeWorkoutSessionRecord(session({ training_duration_sec: -1 }), { timezone: "Asia/Shanghai" }), /training_duration_sec/);
});

test("ticket 03 daily Hub keeps same-date strength and aerobic records as separate contextual links", () => {
  const hub = dailyHubModel({
    targetDate: "2026-08-15",
    timezone: "Asia/Shanghai",
    now,
    workout: { source_status: "complete", data_as_of: "2026-08-15T04:00:00.000Z", sessions: [session(), session({ scheduled_date: "2026-08-14", session_key: "sess-other-date" })] },
    coros: { source_status: "complete", data_as_of: "2026-08-15T23:59:00.000Z" },
    activities: [activity()],
  });
  assert.equal(hub.kind, "daily-hub");
  assert.deepEqual(hub.machine_refs.workout_session_keys, ["sess-2026-08-15"]);
  assert.deepEqual(hub.machine_refs.activity_refs, ["coros-2026-08-15"]);
  assert.deepEqual(hub.links.workout_sessions, ["[[workout/sessions/2026-08-15--sess-2026-08-15]]"]);
  assert.deepEqual(hub.links.coros_activities, ["[[data/coros/2026-08-15-coros-2026-08-15]]"]);
  assert.equal(hub.relation_policy, "same_local_date_context_only");
  assert.equal(hub.summary.workout.session_count, 1);
  assert.equal(hub.summary.coros.activity_count, 1);
  assert.equal(Object.hasOwn(hub.summary.workout, "activity_ref"), false);
  assert.equal(Object.hasOwn(hub.summary.coros, "session_key"), false);
});

test("ticket 03 renders Obsidian-native scalar/link Properties and full Workout detail", () => {
  const detailedSession = session({
    session_key: "sess-detailed",
    snapshot: {
      blocks: [{
        title: "核心",
        exercises: [{
          exercise_key: "dead-bug",
          name: "死虫",
          sets: [{ set_key: "set-1", target: { metric: "reps", min: 8, max: 10 }, resistance: { kind: "bodyweight" } }],
        }],
      }],
    },
    completion_items: [{ completion_item_key: "item-1", set_key: "set-1", target: { metric: "reps", min: 8, max: 10 } }],
    completion_results: [{ completion_item_key: "item-1", actual: { reps: 9 }, completed: true }],
    exercise_feedback: [{ exercise_key: "dead-bug", note: "动作稳定" }],
    training_version: 56,
  });
  const hub = dailyHubModel({
    targetDate: "2026-08-15",
    timezone: "Asia/Shanghai",
    now,
    workout: { source_status: "complete", data_as_of: "2026-08-15T04:00:00.000Z", sessions: [detailedSession] },
    coros: { source_status: "none", data_as_of: null },
    activities: [],
  });
  const daily = dailyHubNote(hub);
  assert.doesNotMatch(daily, /^date:/m);
  assert.match(daily, /^local_date: "2026-08-15"$/m);
  assert.match(daily, /^source_status_workout: "complete"$/m);
  assert.match(daily, /^data_as_of_workout: "2026-08-15T04:00:00.000Z"$/m);
  assert.doesNotMatch(daily, /^source_status:\s*$/m);
  assert.doesNotMatch(daily, /^data_as_of:\s*$/m);
  assert.match(daily, /^  - "\[\[workout\/sessions\/2026-08-15--sess-detailed\]\]"$/m);

  const record = normalizeWorkoutSessionRecord(detailedSession, {
    timezone: "Asia/Shanghai",
    dataAsOf: "2026-08-15T04:00:00.000Z",
    includeDetails: true,
  });
  const sessionNote = workoutSessionNote(record);
  assert.match(sessionNote, /^local_date: "2026-08-15"$/m);
  assert.match(sessionNote, /^daily_hub: "\[\[daily\/2026-08-15\]\]"$/m);
  assert.match(sessionNote, /死虫/);
  assert.match(sessionNote, /完成结果/);
  assert.match(sessionNote, /动作稳定/);
});

test("ticket 03 derives the Workout table from Session Properties and preserves boundary dates", () => {
  const table = workoutTableModel({
    timezone: "Asia/Shanghai",
    sessions: [session({ scheduled_date: "2026-08-07", session_key: "sess-first" }), session({ scheduled_date: "2026-08-15", session_key: "sess-last", status: "partial", completion_fraction: 0.5 })],
  }, "2026-08-07", "2026-08-15", now);
  assert.equal(table.kind, "workout-table");
  assert.equal(table.derived_from, "workout-session-properties");
  assert.deepEqual(table.rows.map((row) => row.local_date), ["2026-08-15", "2026-08-07"]);
  assert.equal(table.rows[0].properties.status, "partial");
  assert.match(table.rows[0].links.daily_hub, /daily\/2026-08-15/);
  assert.equal(Object.hasOwn(table.rows[0], "activity_ref"), false);
});

test("ticket 03 Records overview distinguishes only-strength, only-aerobic, both, rest, and no-plan dates", () => {
  const state = {
    athlete_key: "ath-a",
    timezone: "Asia/Shanghai",
    plan_revisions: [{ revision_key: "rev-ticket-03", revision_sequence: 1, effective_from: "2026-08-10", week: {
      monday: { kind: "workout", title: "力量", blocks: [] },
      tuesday: { kind: "rest" },
      wednesday: null, thursday: null, friday: null, saturday: null, sunday: null,
    } }],
    sessions: [session({ scheduled_date: "2026-08-10", session_key: "sess-strength-only" }), session({ scheduled_date: "2026-08-15" }), session({ scheduled_date: "2026-08-01", session_key: "sess-outside-range" })],
    aerobic_activities: [activity({ local_date: "2026-08-11", activity_ref: "coros-aerobic-only" }), activity()],
    aerobic_projection: { source_status: "complete", source_statuses: { workout: "complete", coros: "complete" }, data_as_of: "2026-08-15T23:59:00.000Z" },
  };
  const overview = recordsOverviewModel(state, "2026-08-07", "2026-08-15", now);
  const both = overview.days.find((day) => day.local_date === "2026-08-15");
  assert.equal(both.workout_session_count, 1);
  assert.equal(both.aerobic_activity_count, 1);
  assert.equal(both.relation_policy, "same_local_date_context_only");
  const strengthOnly = overview.days.find((day) => day.local_date === "2026-08-10");
  assert.equal(strengthOnly.schedule_kind, "workout");
  assert.equal(strengthOnly.workout_session_count, 1);
  assert.equal(strengthOnly.aerobic_activity_count, 0);
  const aerobicOnly = overview.days.find((day) => day.local_date === "2026-08-11");
  assert.equal(aerobicOnly.schedule_kind, "rest");
  assert.equal(aerobicOnly.workout_session_count, 0);
  assert.equal(aerobicOnly.aerobic_activity_count, 1);
  const boundary = overview.days.find((day) => day.local_date === "2026-08-07");
  assert.equal(boundary.schedule_kind, "no_plan");
  assert.equal(boundary.workout_session_count, 0);
  assert.equal(boundary.aerobic_activity_count, 0);
  assert.equal(overview.workout.source, "workout");
  assert.equal(overview.workout.session_count, 2);
  assert.equal(overview.aerobic.source, "coros");
});

test("ticket 03 local sync writes idempotent daily Hub, Workout Session records, and derived table", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-ticket-03-"));
  const options = {
    archiveDir,
    timezone: "Asia/Shanghai",
    targetDate: "2026-08-15",
    now,
    workoutSource: { read: async () => ({ source_status: "complete", data_as_of: "2026-08-15T04:00:00.000Z", sessions: [session()] }) },
    corosSource: { read: async () => ({ source_status: "complete", data_as_of: "2026-08-15T23:59:00.000Z", activities: [activity()] }) },
    publish: async (projection) => ({ status: "complete", published_count: projection.activities.length }),
  };
  try {
    const first = await syncTrainingArchive(options);
    const second = await syncTrainingArchive(options);
    assert.equal(first.records_written.workout_sessions, 1);
    assert.equal(second.records_written.workout_sessions, 1);
    const daily = await readFile(join(archiveDir, "daily/2026-08-15.md"), "utf8");
    const workoutNote = await readFile(join(archiveDir, "workout/sessions/2026-08-15--sess-2026-08-15.md"), "utf8");
    const table = await readFile(join(archiveDir, "workout/index.md"), "utf8");
    assert.match(daily, /kind: daily-hub/);
    assert.match(daily, /\[\[workout\/sessions\/2026-08-15--sess-2026-08-15\]\]/);
    assert.match(daily, /\[\[data\/coros\/2026-08-15-coros-2026-08-15\]\]/);
    assert.match(workoutNote, /kind: workout-session/);
    assert.match(workoutNote, /session_key: "sess-2026-08-15"/);
    assert.match(workoutNote, /source_status: "complete"/);
    assert.match(table, /TABLE/);
    assert.match(table, /FROM "workout\/sessions"/);
    assert.equal((daily.match(/\[\[workout\/sessions\/2026-08-15--sess-2026-08-15\]\]/g) || []).length, 1);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 03 private Records and Calendar reads are Athlete-scoped and Calendar returns compact aerobic summary only", async () => {
  const { handler, store } = appFixture();
  const athleteA = await store.getByEmail("athlete-a@example.invalid");
  athleteA.sessions = [session({ scheduled_date: "2026-08-15" })];
  athleteA.aerobic_activities = [activity()];
  athleteA.aerobic_projection = { source_status: "complete", source_statuses: { workout: "complete", coros: "complete" }, data_as_of: "2026-08-15T23:59:00.000Z" };
  await store.save(athleteA);

  const overview = await call(handler, "/api/private/records/overview?from=2026-08-15&to=2026-08-15");
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.days[0].workout_session_count, 1);
  assert.equal(overview.body.days[0].aerobic_activity_count, 1);
  assert.equal(overview.body.days[0].relation_policy, "same_local_date_context_only");

  const calendar = await call(handler, "/api/private/schedule?from=2026-08-15&to=2026-08-15&expand=prescription&include=aerobic_summary");
  assert.equal(calendar.response.status, 200);
  assert.equal(calendar.body.entries[0].aerobic_summary.activity_count, 1);
  assert.equal("items" in calendar.body.entries[0].aerobic_summary, false);
  assert.match(calendar.body.entries[0].aerobic_summary.records_href, /records/);

  const other = await call(handler, "/api/private/records/overview?from=2026-08-15&to=2026-08-15", {}, "athlete-b@example.invalid");
  assert.equal(other.response.status, 200);
  assert.equal(other.body.days[0]?.aerobic_activity_count ?? 0, 0);
  assert.equal(other.body.days[0]?.workout_session_count ?? 0, 0);

  const invalidPeriod = await call(handler, "/api/private/records/overview?from=2026-08-15");
  assert.equal(invalidPeriod.response.status, 400);
  const invalidInclude = await call(handler, "/api/private/schedule?from=2026-08-15&to=2026-08-15&include=full_aerobic_history");
  assert.equal(invalidInclude.response.status, 400);
});

test("Calendar reports explicit COROS route evidence without creating a Workout Session relation", async () => {
  const { handler, store } = appFixture();
  const athlete = await store.getByEmail("athlete-a@example.invalid");
  athlete.plan_revisions[0].effective_from = "2026-08-01";
  athlete.plan_revisions[0].week.saturday = {
    kind: "workout",
    title: "香山鸡腿线",
    start_time: "08:30",
    estimated_duration_min: 150,
    recording_intent: { schema_version: 1, source: "coros", sport_type: 102, route_key: "香山鸡腿线" },
    blocks: [{
      title: "越野专项",
      exercises: [{
        occurrence_key: "chicken_line_trail",
        exercise_id: "trail_run_hike",
        execution_mode: "none",
        name: "越野跑与爬升快走",
        definition_version: 1,
        sets: [{ set_id: "chicken_line_1", ordinal: 1, target: { metric: "duration_sec", value: 9000 }, resistance_mode: "bodyweight", resistance_kg: null, tempo: null, rest_after_sec: null }],
      }],
    }],
  };
  athlete.aerobic_activities = [activity({
    sport_type: 102,
    sport_name: "trail_run",
    route_key: "香山鸡腿线",
    route_direction: "forward",
    route_match_status: "matched",
  })];
  await store.save(athlete);

  const result = await call(handler, "/api/private/schedule?from=2026-08-15&to=2026-08-15&expand=prescription&include=aerobic_summary");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.entries[0].session_key, null);
  assert.equal(result.body.entries[0].recording_evidence.status, "recorded");
  assert.equal(result.body.entries[0].recording_evidence.match_count, 1);
  assert.equal(result.body.entries[0].recording_evidence.route_key, "香山鸡腿线");
  assert.equal("activity_ref" in result.body.entries[0].recording_evidence, false);

  athlete.aerobic_activities = [activity({ activity_ref: "other-route", source_ref: "coros:activity:other-route", sport_type: 102, sport_name: "trail_run", route_key: "其他路线", route_direction: "forward", route_match_status: "matched" })];
  await store.save(athlete);
  const unmatched = await call(handler, "/api/private/schedule?from=2026-08-15&to=2026-08-15&include=aerobic_summary");
  assert.equal(unmatched.body.entries[0].recording_evidence.status, "needs_link");
  assert.equal(unmatched.body.entries[0].recording_evidence.match_count, 0);
});
