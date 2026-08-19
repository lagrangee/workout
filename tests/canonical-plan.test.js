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
    sets: [{ set_id: "dead_bug_set_1", ordinal: 1, target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, tempo: "3-1-1-0", rest_after_sec: 45 }],
  });
  const bridge = result.body.preview.week.monday.blocks[0].exercises[1];
  assert.equal(bridge.sets[0].resistance_kg, 4.53592);
  assert.equal(bridge.sets[0].resistance_mode, "external_load");
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

test("Agent Plan readback uses the same canonical Exercise Prescription", async () => {
  const { handler } = appFixture();
  const packageText = JSON.stringify(canonicalPackage());
  const applied = await call(handler, "/api/private/plan-updates/apply", json({ method: "POST", headers: { "Idempotency-Key": "canonical-agent-plan-1" } }, { package_text: packageText }));
  assert.equal(applied.response.status, 201);
  const token = await createAgentToken(handler);
  const result = await agentRequest(handler, token, "/api/agent/v1/plan");
  assert.equal(result.response.status, 200);
  const exercise = result.body.future[0].week.monday.prescription.blocks[0].exercises[0];
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
