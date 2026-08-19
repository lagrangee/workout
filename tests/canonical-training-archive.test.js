import test from "node:test";
import assert from "node:assert/strict";
import { dailyHubModel, dailyHubNote, normalizeWorkoutSessionRecord, workoutSessionNote } from "../src/training-records.js";

function canonicalSession() {
  return {
    schema_version: 1,
    session_key: "sess-canonical-2026-08-17",
    scheduled_workout_key: "sw_athlete-a_2026-08-17",
    plan_id: "plan_athlete-a",
    plan_revision_key: "rev-core-1",
    scheduled_date: "2026-08-17",
    local_date: "2026-08-17",
    timezone_at_session: "Asia/Shanghai",
    title: "核心训练",
    status: "partial",
    completion_fraction: 0.5,
    training_duration_sec: 1160,
    session_rpe: 7,
    updated_at: "2026-08-17T14:00:00.000Z",
    source_ref: "session:2026-08-17:sess-canonical-2026-08-17",
    snapshot: {
      schema_version: 2,
      title: "核心训练",
      start_time: "21:00",
      estimated_duration_min: 20,
      blocks: [{
        block_key: "sb1",
        title: "核心",
        exercises: [{
          exercise_occurrence_key: "dead_bug_main",
          occurrence_key: "dead_bug_main",
          exercise_id: "dead_bug",
          name: "死虫",
          definition_version: 1,
          execution_mode: "alternating",
          sets: [{ set_key: "dead_bug_set_1", set_id: "dead_bug_set_1", ordinal: 1, target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, resistance: { mode: "bodyweight" }, tempo: "3-1-1-0", rest_after_sec: 30 }],
        }],
      }],
      completion_items: [
        { completion_item_key: "ci-left", exercise_occurrence_key: "dead_bug_main", occurrence_key: "dead_bug_main", set_key: "dead_bug_set_1", set_id: "dead_bug_set_1", set_ordinal: 1, side: "left", target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, resistance: { mode: "bodyweight" }, tempo: "3-1-1-0", rest_after_sec: 30 },
        { completion_item_key: "ci-right", exercise_occurrence_key: "dead_bug_main", occurrence_key: "dead_bug_main", set_key: "dead_bug_set_1", set_id: "dead_bug_set_1", set_ordinal: 1, side: "right", target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, resistance: { mode: "bodyweight" }, tempo: "3-1-1-0", rest_after_sec: 30 },
      ],
      exercise_occurrence_keys: ["dead_bug_main"],
    },
    completion_results: [
      { completion_item_key: "ci-left", status: "completed", actual: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, resistance: { mode: "bodyweight" }, rir: 2, note: "左侧稳定", completed_at: "2026-08-17T13:50:00.000Z" },
      { completion_item_key: "ci-right", status: "partial", actual: { metric: "reps", value: 3 }, resistance_mode: "bodyweight", resistance_kg: null, resistance: { mode: "bodyweight" }, rir: null, note: "右侧提前结束", completed_at: "2026-08-17T13:51:00.000Z" },
    ],
    training_intervals: [{ interval_key: "interval-1", started_at: "2026-08-17T13:30:00.000Z", ended_at: "2026-08-17T13:50:00.000Z" }],
    note: "核心控制一般",
    skip_reason: null,
    exercise_feedback: [{ exercise_occurrence_key: "dead_bug_main", text: "左右控制不同" }],
  };
}

test("canonical Workout projection keeps the full prescription and per-side results", () => {
  const session = canonicalSession();
  const record = normalizeWorkoutSessionRecord(session, { timezone: "Asia/Shanghai", dataAsOf: "2026-08-17T14:00:00.000Z", sourceStatus: "complete", includeDetails: true });
  assert.deepEqual(record.properties.exercise_ids, ["dead_bug"]);
  assert.equal(record.properties.plan_revision_key, "rev-core-1");
  const note = workoutSessionNote(record);
  assert.match(note, /\| 组 \| 侧别 \| 目标 \| 计划阻力 \| 节奏 \| 休息 \| 实际 \| 实际阻力 \| 状态 \| RIR \| 备注 \|/);
  assert.match(note, /死虫.*dead_bug.*左右交替/);
  assert.match(note, /left.*5 次.*3-1-1-0.*已完成.*左侧稳定/);
  assert.match(note, /right.*5 次.*部分完成.*右侧提前结束/);
  assert.match(note, /左右控制不同/);
});

test("canonical Daily Hub remains scalar and emits only adapter-owned links", () => {
  const session = canonicalSession();
  const hub = dailyHubModel({
    targetDate: "2026-08-17",
    timezone: "Asia/Shanghai",
    now: new Date("2026-08-18T03:00:00.000Z"),
    workout: { source_status: "complete", data_as_of: "2026-08-17T14:00:00.000Z", sessions: [session] },
    coros: { source_status: "none", data_as_of: null },
    activities: [],
  });
  const note = dailyHubNote(hub);
  assert.match(note, /^local_date: "2026-08-17"$/m);
  assert.doesNotMatch(note, /^date:/m);
  assert.match(note, /^source_status_workout: "complete"$/m);
  assert.match(note, /^data_as_of_workout: "2026-08-17T14:00:00.000Z"$/m);
  assert.match(note, /^  - "\[\[workout\/sessions\/2026-08-17--sess-canonical-2026-08-17\]\]"$/m);
  assert.doesNotMatch(note, /source_status:\s*\{/);
  assert.equal(hub.relation_policy, "same_local_date_context_only");
});
