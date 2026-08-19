// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { convertLegacyState } from "../src/legacy-workout-converter.js";
import { validateRebuildState } from "../src/canonical-rebuild.js";

const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function legacyState() {
  const week = Object.fromEntries(weekdays.map((day) => [day, null]));
  week.monday = {
    kind: "workout",
    title: "核心",
    start_time: "21:00",
    estimated_duration_min: 20,
    blocks: [{
      title: "主训练",
      exercises: [{
        exercise_key: "dead_bug",
        name: "死虫",
        category: "strength",
        side_mode: "left_right",
        sets: [{
          target: { metric: "reps", min: 8, max: 12 },
          resistance: { mode: "bodyweight", load_kg: null, quantity: null },
          target_rir: 2,
          target_rpe: null,
          tempo: { eccentric_sec: 3, bottom_hold_sec: null, concentric_sec: 1, top_hold_sec: 1 },
          rest_after_sec: 45,
          target_incline_percent: null,
        }],
      }],
    }],
  };
  return {
    athlete_key: "athlete-converter",
    email: "converter@example.invalid",
    timezone: "Asia/Shanghai",
    plan_revisions: [{ revision_key: "rev_legacy", revision_sequence: 1, effective_from: "2026-08-01", created_at: "2026-07-31T00:00:00.000Z", week }],
    sessions: [{
      session_key: "sess_legacy",
      scheduled_workout_key: "sw_legacy_2026-08-17",
      scheduled_date: "2026-08-17",
      timezone_at_session: "Asia/Shanghai",
      title: "核心",
      status: "completed",
      snapshot: {
        title: "核心",
        start_time: "21:00",
        estimated_duration_min: 20,
        blocks: [{
          block_key: "sb1_legacy",
          title: "主训练",
          exercises: [{
            exercise_occurrence_key: "eo_legacy",
            exercise_key: "dead_bug",
            name: "死虫",
            category: "strength",
            side_mode: "left_right",
            sets: [{
              set_key: "ps_legacy",
              target: { metric: "reps", min: 8, max: 12 },
              resistance: { mode: "bodyweight", load_kg: null, quantity: null },
              tempo: { eccentric_sec: 3, bottom_hold_sec: null, concentric_sec: 1, top_hold_sec: 1 },
              rest_after_sec: 45,
            }],
          }],
        }],
        completion_items: [
          { completion_item_key: "ci_legacy_left", exercise_occurrence_key: "eo_legacy", set_key: "ps_legacy", side: "left", target: { metric: "reps", min: 8, max: 12 }, resistance: { mode: "bodyweight", load_kg: null, quantity: null } },
          { completion_item_key: "ci_legacy_right", exercise_occurrence_key: "eo_legacy", set_key: "ps_legacy", side: "right", target: { metric: "reps", min: 8, max: 12 }, resistance: { mode: "bodyweight", load_kg: null, quantity: null } },
        ],
        exercise_occurrence_keys: ["eo_legacy"],
      },
      completion_results: [{ completion_item_key: "ci_legacy_left", completed: true, actual: { metric: "reps", value: 10 }, resistance: { mode: "bodyweight", load_kg: null, quantity: null }, rir: 1, completed_at: "2026-08-17T13:00:00.000Z" }],
      training_intervals: [{ interval_key: "ti_legacy", started_at: "2026-08-17T12:59:00.000Z", ended_at: "2026-08-17T13:01:00.000Z" }],
      session_rpe: 5,
      note: "保留",
      skip_reason: null,
      exercise_feedback: [{ exercise_occurrence_key: "eo_legacy", text: "稳定" }],
      created_at: "2026-08-17T12:59:00.000Z",
      updated_at: "2026-08-17T13:01:00.000Z",
    }],
  };
}

test("legacy conversion keeps exact v1 archive and maps range to max", () => {
  const legacy = legacyState();
  const canonical = convertLegacyState(legacy, { rangePolicy: "max" });
  assert.equal(canonical.plan_revisions[0].week.monday.blocks[0].exercises[0].sets[0].target.value, 12);
  assert.equal(canonical.plan_revisions[0].week.monday.blocks[0].exercises[0].execution_mode, "per_side");
  assert.equal(canonical.plan_revisions[0].week.monday.blocks[0].exercises[0].sets[0].tempo, "3-0-1-1");
  assert.equal(canonical.sessions[0].snapshot.completion_items[0].target.value, 12);
  assert.equal(canonical.sessions[0].completion_results[0].status, "completed");
  assert.equal(canonical.sessions[0].completion_results[0].actual.value, 10);
  assert.equal(canonical.legacy_workout_v1.plan_revisions[0].week.monday.blocks[0].exercises[0].sets[0].target.max, 12);
  assert.equal(canonical.legacy_workout_v1.plan_revisions[0].week.monday.blocks[0].exercises[0].sets[0].target_rir, 2);
  assert.doesNotThrow(() => validateRebuildState(canonical));
});

test("legacy conversion refuses an unsupported range policy", () => {
  assert.throws(() => convertLegacyState(legacyState(), { rangePolicy: "min" }), /range-policy max/);
});

test("legacy conversion refuses an unsupported resistance mode", () => {
  const legacy = legacyState();
  legacy.plan_revisions[0].week.monday.blocks[0].exercises[0].sets[0].resistance = { mode: "assisted_weight", load_kg: null, quantity: 1 };
  assert.throws(() => convertLegacyState(legacy, { rangePolicy: "max" }), /cannot be represented canonically/);
});
