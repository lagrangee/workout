import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../src/util.js";
import { agentRequest, appFixture, call, createAgentToken, json, today } from "./helpers.js";

function canonicalPackage(overrides = {}) {
  const packageValue = {
    schema_version: 2,
    effective_from: addDays(today, 1),
    week: {
      monday: {
        kind: "workout",
        title: "核心与臀桥",
        start_time: "21:00",
        estimated_duration_min: 25,
        blocks: [{
          title: "主训练",
          exercises: [{
            occurrence_key: "dead_bug_main",
            exercise_id: "dead_bug",
            execution_mode: "alternating",
            sets: [{ set_id: "dead_bug_set_1", ordinal: 1, target: { metric: "reps", value: 5 }, resistance: { mode: "bodyweight" }, tempo: "3-1-1-0", rest_after_sec: 45 }],
          }, {
            occurrence_key: "glute_bridge_main",
            exercise_id: "glute_bridge",
            execution_mode: "bilateral",
            sets: [{ set_id: "bridge_set_1", ordinal: 1, target: { metric: "reps", value: 10 }, resistance: { mode: "external_load", value: 10, unit: "lb" }, tempo: null, rest_after_sec: null }],
          }],
        }],
      },
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    },
  };
  return { ...packageValue, ...overrides };
}

/** @returns {any} */
function routeRecordingPackage() {
  /** @type {any} */
  const value = canonicalPackage();
  value.week.monday = {
    kind: "workout",
    title: "香山鸡腿线",
    start_time: "08:30",
    estimated_duration_min: 150,
    recording_intent: {
      schema_version: 1,
      source: "coros",
      sport_type: 102,
      route_key: "香山鸡腿线",
    },
    blocks: [{
      title: "越野专项",
      exercises: [{
        occurrence_key: "chicken_line_trail",
        exercise_id: "trail_run_hike",
        execution_mode: "none",
        sets: [{ set_id: "chicken_line_1", ordinal: 1, target: { metric: "duration_sec", value: 9000, distance_km: 12.5, heart_rate_zone: { min: 1, max: 3 }, rpe: { min: 2, max: 4 }, effort_cue: "测试结构化有氧处方" }, resistance: { mode: "bodyweight" }, tempo: null, rest_after_sec: null }],
      }],
    }],
  };
  return value;
}

test("canonical Plan Update validates registry references and returns fixed prescription details", async () => {
  const { handler } = appFixture();
  const result = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: JSON.stringify(canonicalPackage()) }));

  assert.equal(result.response.status, 200);
  assert.equal(result.body.valid, true);
  const exercise = result.body.preview.week.monday.blocks[0].exercises[0];
  assert.deepEqual(exercise, {
    occurrence_key: "dead_bug_main",
    exercise_id: "dead_bug",
    execution_mode: "alternating",
    name: "死虫",
    definition_version: 1,
    category: "strength",
    sets: [{ set_id: "dead_bug_set_1", ordinal: 1, target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, tempo: "3-1-1-0", rest_after_sec: 45 }],
  });
  const bridge = result.body.preview.week.monday.blocks[0].exercises[1];
  assert.equal(bridge.sets[0].resistance_kg, 4.53592);
  assert.equal(bridge.sets[0].resistance_mode, "external_load");
});

test("canonical Plan Update accepts an explicit COROS route recording intent", async () => {
  const { handler } = appFixture();
  const result = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: JSON.stringify(routeRecordingPackage()) }));

  assert.equal(result.response.status, 200);
  assert.equal(result.body.valid, true);
  assert.deepEqual(result.body.preview.week.monday.recording_intent, {
    schema_version: 1,
    source: "coros",
    sport_type: 102,
    route_key: "香山鸡腿线",
  });
  assert.deepEqual(result.body.preview.week.monday.blocks[0].exercises[0].sets[0].target, routeRecordingPackage().week.monday.blocks[0].exercises[0].sets[0].target);
});

test("canonical Plan Update writes an immutable Athlete-owned revision and reads the same prescription", async () => {
  const { handler } = appFixture();
  const packageText = JSON.stringify(canonicalPackage());
  const applied = await call(handler, "/api/private/plan-updates/apply", json({ method: "POST", headers: { "Idempotency-Key": "canonical-plan-1" } }, { package_text: packageText }));
  assert.equal(applied.response.status, 201);

  const plan = await call(handler, "/api/private/plan");
  const exercise = plan.body.future[0].week.monday.blocks[0].exercises[0];
  assert.equal(exercise.exercise_id, "dead_bug");
  assert.equal(exercise.name, "死虫");
  assert.equal(exercise.sets[0].target.value, 5);
  assert.equal(exercise.sets[0].tempo, "3-1-1-0");
  assert.equal(plan.body.future[0].week.monday.blocks[0].exercises[1].sets[0].resistance_kg, 4.53592);

  const other = await call(handler, "/api/private/plan", {}, "athlete-b@example.invalid");
  assert.notDeepEqual(other.body.future, plan.body.future);
});

test("canonical route recording intent survives apply and Plan readback", async () => {
  const { handler } = appFixture();
  const packageText = JSON.stringify(routeRecordingPackage());
  const applied = await call(handler, "/api/private/plan-updates/apply", json({ method: "POST", headers: { "Idempotency-Key": "canonical-route-recording-1" } }, { package_text: packageText }));
  assert.equal(applied.response.status, 201);

  const plan = await call(handler, "/api/private/plan");
  assert.deepEqual(plan.body.future[0].week.monday.recording_intent, routeRecordingPackage().week.monday.recording_intent);
});

test("copy current canonical plan returns a valid schema v2 update-package shape", async () => {
  const { handler, store } = appFixture();
  const packageText = JSON.stringify(canonicalPackage());
  const applied = await call(handler, "/api/private/plan-updates/apply", json({ method: "POST", headers: { "Idempotency-Key": "canonical-copy-plan-1" } }, { package_text: packageText }));
  assert.equal(applied.response.status, 201);

  const state = await store.getByEmail("athlete-a@example.invalid");
  state.plan_revisions.at(-1).effective_from = addDays(today, -1);
  await store.save(state);

  const copied = await call(handler, "/api/private/plan/update-package");
  assert.equal(copied.response.status, 200);
  assert.equal(copied.body.schema_version, 2);
  const set = copied.body.week.monday.blocks[0].exercises[1].sets[0];
  assert.deepEqual(set.resistance, { mode: "external_load", value: 4.53592, unit: "kg" });
  assert.equal("resistance_mode" in set, false);
});

test("Agent Plan readback uses the same canonical Exercise Prescription", async () => {
  const { handler } = appFixture();
  const packageText = JSON.stringify(canonicalPackage());
  const applied = await call(handler, "/api/private/plan-updates/apply", json({ method: "POST", headers: { "Idempotency-Key": "canonical-agent-plan-1" } }, { package_text: packageText }));
  assert.equal(applied.response.status, 201);
  const token = await createAgentToken(handler);
  const result = await agentRequest(handler, token, "/api/agent/v1/plan");
  assert.equal(result.response.status, 200);
  const workoutEntry = result.body.entries.find((entry) => entry.title === "核心与臀桥");
  const exercise = result.body.prescriptions[workoutEntry.prescription_ref].blocks[0].exercises[0];
  assert.equal(exercise.exercise_id, "dead_bug");
  assert.equal(exercise.execution_mode, "alternating");
  assert.equal(exercise.sets[0].target.value, 5);
});

test("canonical Plan Update rejects ranges, unknown IDs, unsupported modes, and invalid tempo without repair", async () => {
  /** @type {Array<[string, (value: any) => void]>} */
  const cases = [
    ["range", (value) => { value.week.monday.blocks[0].exercises[0].sets[0].target = { metric: "reps", min: 4, max: 5 }; }],
    ["unknown exercise", (value) => { value.week.monday.blocks[0].exercises[0].exercise_id = "not_in_registry"; }],
    ["unsupported mode", (value) => { value.week.monday.blocks[0].exercises[0].execution_mode = "bilateral"; }],
    ["invalid tempo", (value) => { value.week.monday.blocks[0].exercises[0].sets[0].tempo = "3-1-1"; }],
    ["endurance requirements on strength", (value) => { value.week.monday.blocks[0].exercises[0].sets[0].target.heart_rate_zone = { min: 2, max: 2 }; }],
    ["recording intent without a compatible route exercise", (value) => { value.week.monday.recording_intent = { schema_version: 1, source: "coros", sport_type: 102, route_key: "香山鸡腿线" }; }],
  ];
  for (const [label, mutate] of cases) {
    const { handler } = appFixture();
    const value = structuredClone(canonicalPackage());
    mutate(value);
    const result = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: JSON.stringify(value) }));
    assert.equal(result.response.status, 400, label);
    assert.equal(result.body.error.code, "invalid_plan_package", label);
    assert.ok(result.body.error.details.length > 0, label);
  }
});
